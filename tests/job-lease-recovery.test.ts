import { afterEach, describe, expect, it } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";
import { spawn } from "child_process";
import { dbDelete, dbGet, dbPut } from "@/lib/storage/db";
import { makeJobProgress } from "@/lib/jobs/control";
import {
  claimJob,
  cancelJob,
  finalizeJobFailure,
  finalizeJobSuccess,
  heartbeatJob,
  markExpiredJobsAsStale,
  recoverJobsOnStartup,
  recoverStaleJobs,
  reapExpiredJobs,
  retryJob,
  type AnalysisJob,
} from "@/lib/jobs/queue";

const cleanup: string[] = [];
const studyCleanup: string[] = [];

afterEach(async () => {
  while (cleanup.length) await dbDelete("jobs", cleanup.pop()!);
  while (studyCleanup.length) await dbDelete("studies", studyCleanup.pop()!);
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
  if (!(await dbGet("studies", job.study_id))) {
    await dbPut("studies", job.study_id, {
      study_id: job.study_id,
      created_at: new Date().toISOString(),
      modality: "unknown",
      eye: "unknown",
      source: "test",
      metadata: {},
      files: [],
      status: "uploaded",
      original_sha256: "fixture",
    });
    studyCleanup.push(job.study_id);
  }
  cleanup.push(job.job_id);
  await dbPut("jobs", job.job_id, job);
}

function runViteNode(scriptPath: string, env: NodeJS.ProcessEnv): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const runner = path.resolve(process.cwd(), "node_modules", "vite-node", "dist", "cli.mjs");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [runner, scriptPath], { cwd: process.cwd(), env, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`vite-node child timed out: ${stderr}`));
    }, 30_000);
    child.on("error", (error) => { clearTimeout(timeout); reject(error); });
    child.on("exit", (code) => { clearTimeout(timeout); resolve({ code, stdout, stderr }); });
  });
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

  it("fences a late worker after stale recovery and prevents a second heartbeat", async () => {
    const id = "job_late_worker";
    await put(fixture(id, {
      status: "running", state: "running", attempts: 1, claim_version: 3, version: 3,
      attempt_id: "attempt-dead", active_attempt_id: "attempt-dead", worker_id: "worker-dead",
      heartbeat_at: "2026-01-01T00:00:01.000Z", lease_expires_at: "2026-01-01T00:00:02.000Z",
      progress: makeJobProgress({ stage: "running_inference", percent: 50, message: "old worker" }),
    }));
    await recoverStaleJobs({ now: "2026-01-01T00:01:00.000Z", heartbeatGraceMs: 0, retryBackoffMs: 0, startWorkers: false });
    const replacement = await claimJob(id, "worker-new", { now: "2026-01-01T00:01:01.000Z", leaseMs: 10_000 });
    expect(replacement?.attempts).toBe(2);
    expect(await heartbeatJob(id, "attempt-dead", "worker-dead", { now: "2026-01-01T00:01:02.000Z", leaseMs: 10_000 })).toBeNull();
    expect(await finalizeJobSuccess(id, "attempt-dead", "worker-dead")).toBeNull();
    expect((await dbGet<AnalysisJob>("jobs", id))?.active_attempt_id).toBe(replacement?.attempt_id);
  });

  it("honors a durable cancel request when the worker lease later expires", async () => {
    const id = "job_cancel_stale";
    await put(fixture(id));
    const claimed = await claimJob(id, "worker-a", { now: "2026-01-01T00:00:01.000Z", leaseMs: 10_000 });
    expect(claimed?.status).toBe("running");
    const requested = await cancelJob(id, "tester");
    expect(requested).toMatchObject({ status: "running", cancellation_requested: true });
    expect((await dbGet<AnalysisJob>("jobs", id))?.cancellation_requested).toBe(true);
    const recovery = await recoverStaleJobs({ now: "2026-01-01T00:01:00.000Z", heartbeatGraceMs: 0, retryBackoffMs: 0, startWorkers: false });
    expect(recovery.cancelled).toContain(id);
    expect((await dbGet<AnalysisJob>("jobs", id))?.status).toBe("cancelled");
    expect(await finalizeJobSuccess(id, claimed!.attempt_id!, "worker-a")).toBeNull();
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

  it("deduplicates concurrent retry requests with the same idempotency key", async () => {
    const id = "job_retry_race";
    await put(fixture(id, {
      status: "failed", state: "failed", attempts: 0, error: "simulated worker crash",
      completed_at: "2026-01-01T00:00:05.000Z",
      progress: makeJobProgress({ stage: "failed", percent: 20, message: "failed" }),
    }));
    const key = "retry-race-key-001";
    const [first, second] = await Promise.all([
      retryJob(id, "tester-a", key),
      retryJob(id, "tester-b", key),
    ]);
    expect(first?.job_id).toBe(id);
    expect(second?.job_id).toBe(id);
    expect((await dbGet<AnalysisJob>("jobs", id))?.retry_idempotency_keys).toEqual([key]);
    // The two callers represent one logical retry; only one claim is
    // possible even when their worker dispatches race.
    for (let i = 0; i < 100 && (await dbGet<AnalysisJob>("jobs", id))?.status === "queued"; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect((await dbGet<AnalysisJob>("jobs", id))?.attempts).toBeLessThanOrEqual(1);
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

describe("process-boundary lease recovery", () => {
  it("persists a claimed attempt through worker death and recovers it after restart", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "visionscan-job-crash-"));
    const dbPath = path.join(root, "database", "eye-ai.db");
    const repoRoot = path.resolve(process.cwd());
    const dbModule = pathToFileURL(path.join(repoRoot, "lib", "storage", "db.ts")).href;
    const queueModule = pathToFileURL(path.join(repoRoot, "lib", "jobs", "queue.ts")).href;
    const controlModule = pathToFileURL(path.join(repoRoot, "lib", "jobs", "control.ts")).href;
    const childPath = path.join(root, "worker-boundary.ts");
    const baseEnv: NodeJS.ProcessEnv = {
      ...process.env,
      PROJECT_ROOT: repoRoot,
      DATA_ROOT: root,
      DATABASE_ROOT: path.join(root, "database"),
      DATABASE_FILE: dbPath,
      LEGACY_DATABASE_FILE: path.join(root, "database", "eye-ai.json"),
      UPLOAD_ROOT: path.join(root, "uploads"),
      DOCUMENTS_ROOT: path.join(root, "documents"),
      PROCESSED_ROOT: path.join(root, "processed"),
      REPORT_ROOT: path.join(root, "reports"),
      LOG_ROOT: path.join(root, "logs"),
      TMP_ROOT: path.join(root, "tmp"),
      MODEL_ROOT: path.join(repoRoot, "data", "models"),
      VISIONSCAN_PERSISTENCE_BACKEND: "sqlite",
      NODE_ENV: "test",
    };
    const script = `
const phase = process.env.VS_JOB_PHASE;
const { dbPut, dbGet, closeDatabase } = await import(${JSON.stringify(dbModule)});
const { makeJobProgress } = await import(${JSON.stringify(controlModule)});
const { claimJob, recoverJobsOnStartup } = await import(${JSON.stringify(queueModule)});
const jobId = "job_process_boundary";
if (phase === "claim") {
  await dbPut("studies", "study_process_boundary", {
    study_id: "study_process_boundary", created_at: "2026-01-01T00:00:00.000Z",
    modality: "unknown", eye: "unknown", source: "test", metadata: {}, files: [],
    status: "uploaded", original_sha256: "fixture",
  });
  await dbPut("jobs", jobId, {
    job_id: jobId, study_id: "study_process_boundary", kind: "analysis", status: "queued", state: "queued",
    attempts: 0, version: 0, claim_version: 0, cancellation_requested: false,
    created_at: "2026-01-01T00:00:00.000Z", progress: makeJobProgress({ stage: "queued", percent: 0, message: "child fixture" }),
  });
  const claimed = await claimJob(jobId, "crashed-worker", { now: "2026-01-01T00:00:01.000Z", leaseMs: 1000 });
  console.log(JSON.stringify({ claimed: { attempt_id: claimed?.attempt_id, status: claimed?.status, attempts: claimed?.attempts } }));
  await closeDatabase();
  process.exit(17);
} else {
  const recovered = await recoverJobsOnStartup({ now: "2026-01-01T00:01:00.000Z", heartbeatGraceMs: 0, retryBackoffMs: 0, startWorkers: false });
  const row = await dbGet("jobs", jobId);
  const next = await claimJob(jobId, "restart-worker", { now: "2026-01-01T00:01:01.000Z", leaseMs: 1000 });
  console.log(JSON.stringify({ recovered, row: { status: row?.status, attempts: row?.attempts, attempt_id: row?.attempt_id, active_attempt_id: row?.active_attempt_id }, next: { status: next?.status, attempts: next?.attempts, worker_id: next?.worker_id, attempt_id: next?.attempt_id } }));
  await closeDatabase();
}
`;
    try {
      await fs.writeFile(childPath, script, "utf8");
      const first = await runViteNode(childPath, { ...baseEnv, VS_JOB_PHASE: "claim" });
      expect(first.code).toBe(17);
      expect(first.stdout).toMatch(/"status":"running"/);
      const second = await runViteNode(childPath, { ...baseEnv, VS_JOB_PHASE: "recover" });
      expect(second.code).toBe(0);
      expect(second.stdout).toMatch(/"status":"queued"/);
      expect(second.stdout).toMatch(/"attempts":2/);
      expect(second.stdout).toMatch(/"worker_id":"restart-worker"/);
      expect(second.stdout).not.toMatch(/"worker_id":"crashed-worker"/);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 45000);
});
