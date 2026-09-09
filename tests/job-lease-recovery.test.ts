import { afterEach, describe, expect, it } from "vitest";
import { dbDelete, dbGet, dbPut } from "@/lib/storage/db";
import { makeJobProgress } from "@/lib/jobs/control";
import {
  claimJob,
  finalizeJobFailure,
  finalizeJobSuccess,
  heartbeatJob,
  markExpiredJobsAsStale,
  recoverJobsOnStartup,
  recoverStaleJobs,
  reapExpiredJobs,
  type AnalysisJob,
} from "@/lib/jobs/queue";

const cleanup: string[] = [];

afterEach(async () => {
  while (cleanup.length) await dbDelete("jobs", cleanup.pop()!);
});

function fixture(id: string, overrides: Partial<AnalysisJob> = {}): AnalysisJob {
  return {
    job_id: id,
    study_id: `study_${id}`,
    kind: "analysis",
    status: "queued",
    state: "queued",
    attempts: 0,
    retry_count: 0,
    version: 0,
    claim_version: 0,
    cancellation_requested: false,
    retry_policy_version: "lease-retry-v1",
    created_at: "2026-01-01T00:00:00.000Z",
    progress: makeJobProgress({ stage: "queued", percent: 0, message: "fixture" }),
    ...overrides,
  };
}

async function put(job: AnalysisJob): Promise<void> {
  cleanup.push(job.job_id);
  await dbPut("jobs", job.job_id, job);
}

describe("durable worker lease ownership", () => {
  it("allows exactly one concurrent claimant and persists the attempt envelope", async () => {
    const id = "job_claim_race";
    await put(fixture(id));
    const [a, b] = await Promise.all([
      claimJob(id, "worker-a", { now: "2026-01-01T00:00:01.000Z", leaseMs: 10_000 }),
      claimJob(id, "worker-b", { now: "2026-01-01T00:00:01.000Z", leaseMs: 10_000 }),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    const stored = await dbGet<AnalysisJob>("jobs", id);
    expect(stored).toMatchObject({
      status: "running",
      state: "running",
      attempts: 1,
      claim_version: 1,
      heartbeat_at: "2026-01-01T00:00:01.000Z",
    });
    expect(stored?.attempt_id).toBeTruthy();
    expect(stored?.active_attempt_id).toBe(stored?.attempt_id);
    expect(["worker-a", "worker-b"]).toContain(stored?.worker_id);
  });

  it("accepts a heartbeat only from the current worker and attempt", async () => {
    const id = "job_heartbeat";
    await put(fixture(id));
    const claimed = await claimJob(id, "worker-a", { now: 1_000_000, leaseMs: 10_000 });
    expect(claimed?.attempt_id).toBeTruthy();
    const attemptId = claimed!.attempt_id!;
    expect(await heartbeatJob(id, attemptId, "worker-b", { now: 1_005_000, leaseMs: 10_000 })).toBeNull();
    const refreshed = await heartbeatJob(id, attemptId, "worker-a", { now: 1_005_000, leaseMs: 10_000 });
    expect(refreshed).toMatchObject({ worker_id: "worker-a", heartbeat_at: "1970-01-01T00:16:45.000Z" });
    expect(new Date(refreshed!.lease_expires_at!).getTime()).toBe(1_015_000);
  });

  it("marks an expired lease STALE without implicitly retrying it", async () => {
    const id = "job_stale_only";
    await put(fixture(id, {
      status: "running",
      state: "running",
      attempts: 1,
      claim_version: 4,
      version: 4,
      attempt_id: "attempt-old",
      active_attempt_id: "attempt-old",
      worker_id: "worker-old",
      claimed_at: "2026-01-01T00:00:00.000Z",
      heartbeat_at: "2026-01-01T00:00:01.000Z",
      lease_expires_at: "2026-01-01T00:00:02.000Z",
      progress: makeJobProgress({ stage: "running_inference", percent: 40, message: "working" }),
    }));
    const result = await reapExpiredJobs({ now: "2026-01-01T00:01:00.000Z", heartbeatGraceMs: 0 });
    expect(result.stale).toEqual([id]);
    expect(result.retryable).toEqual([]);
    expect((await dbGet<AnalysisJob>("jobs", id))?.status).toBe("stale");
  });
});

describe("bounded stale recovery policy", () => {
  it("moves stale work to RETRYABLE with a persisted policy and later claims a new attempt", async () => {
    const id = "job_retryable";
    await put(fixture(id, {
      status: "running", state: "running", attempts: 1, claim_version: 2, version: 2,
      attempt_id: "attempt-old", active_attempt_id: "attempt-old", worker_id: "worker-old",
      heartbeat_at: "2026-01-01T00:00:01.000Z", lease_expires_at: "2026-01-01T00:00:02.000Z",
      progress: makeJobProgress({ stage: "running_inference", percent: 35, message: "working" }),
    }));
    const recovery = await recoverStaleJobs({ now: "2026-01-01T00:01:00.000Z", heartbeatGraceMs: 0, retryBackoffMs: 1000, startWorkers: false });
    expect(recovery.retryable).toEqual([id]);
    const retryable = await dbGet<AnalysisJob>("jobs", id);
    expect(retryable).toMatchObject({ status: "retryable", state: "retryable", retry_policy_version: "lease-retry-v1", last_recovery_reason: "LEASE_EXPIRED_POLICY_lease-retry-v1" });
    expect(retryable?.active_attempt_id).toBeUndefined();
    expect(retryable?.attempt_id).toBe("attempt-old");
    expect(await claimJob(id, "worker-new", { now: "2026-01-01T00:01:00.500Z", leaseMs: 10_000 })).toBeNull();
    const reclaimed = await claimJob(id, "worker-new", { now: "2026-01-01T00:01:02.000Z", leaseMs: 10_000 });
    expect(reclaimed).toMatchObject({ status: "running", attempts: 2, worker_id: "worker-new" });
    expect(reclaimed?.attempt_id).not.toBe("attempt-old");
  });

  it("fails exhausted attempts and cancels durable cancellation requests", async () => {
    const failedId = "job_exhausted";
    await put(fixture(failedId, {
      status: "running", state: "running", attempts: 3, claim_version: 2, version: 2,
      attempt_id: "attempt-last", active_attempt_id: "attempt-last", worker_id: "worker-old",
      heartbeat_at: "2026-01-01T00:00:01.000Z", lease_expires_at: "2026-01-01T00:00:02.000Z",
    }));
    const cancelledId = "job_cancelled_after_crash";
    await put(fixture(cancelledId, {
      status: "running", state: "running", attempts: 1, claim_version: 2, version: 2,
      cancellation_requested: true, cancellation_requested_at: "2026-01-01T00:00:03.000Z",
      attempt_id: "attempt-cancel", active_attempt_id: "attempt-cancel", worker_id: "worker-old",
      heartbeat_at: "2026-01-01T00:00:01.000Z", lease_expires_at: "2026-01-01T00:00:02.000Z",
    }));
    const recovery = await recoverStaleJobs({ now: "2026-01-01T00:01:00.000Z", heartbeatGraceMs: 0, retryBackoffMs: 0, startWorkers: false });
    expect(recovery.failed).toContain(failedId);
    expect(recovery.cancelled).toContain(cancelledId);
    expect((await dbGet<AnalysisJob>("jobs", failedId))?.status).toBe("failed");
    expect((await dbGet<AnalysisJob>("jobs", cancelledId))?.status).toBe("cancelled");
  });

  it("recovers stale work on startup without duplicating the old attempt", async () => {
    const id = "job_restart_recovery";
    await put(fixture(id, {
      status: "running", state: "running", attempts: 1, claim_version: 7, version: 7,
      attempt_id: "attempt-before-restart", active_attempt_id: "attempt-before-restart", worker_id: "dead-process",
      heartbeat_at: "2026-01-01T00:00:01.000Z", lease_expires_at: "2026-01-01T00:00:02.000Z",
    }));
    const recovery = await recoverJobsOnStartup({ now: "2026-01-01T00:01:00.000Z", heartbeatGraceMs: 0, retryBackoffMs: 0, startWorkers: false });
    expect(recovery.queued).toContain(id);
    const queued = await dbGet<AnalysisJob>("jobs", id);
    expect(queued).toMatchObject({ status: "queued", attempts: 1, attempt_id: "attempt-before-restart" });
    expect(queued?.active_attempt_id).toBeUndefined();
    const next = await claimJob(id, "new-process", { now: "2026-01-01T00:01:01.000Z", leaseMs: 10_000 });
    expect(next).toMatchObject({ status: "running", attempts: 2, worker_id: "new-process" });
    expect(next?.attempt_id).not.toBe("attempt-before-restart");
  });
});

describe("exactly-once terminal transitions", () => {
  it("allows one terminal finalizer and rejects duplicate or stale finalization", async () => {
    const id = "job_finalize_once";
    await put(fixture(id));
    const claimed = await claimJob(id, "worker-a", { now: "2026-01-01T00:00:01.000Z", leaseMs: 10_000 });
    const attemptId = claimed!.attempt_id!;
    const first = await finalizeJobSuccess(id, attemptId, "worker-a");
    expect(first?.status).toBe("completed");
    expect(await finalizeJobSuccess(id, attemptId, "worker-a")).toBeNull();
    expect(await finalizeJobFailure(id, attemptId, "worker-a", "late worker error")).toBeNull();
    const stored = await dbGet<AnalysisJob>("jobs", id);
    expect(stored).toMatchObject({ status: "completed", attempts: 1 });
    expect(stored?.completed_at).toBeTruthy();
  });
});
