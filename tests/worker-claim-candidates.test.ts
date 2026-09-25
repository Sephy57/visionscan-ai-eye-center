import { afterEach, describe, expect, it } from "vitest";
import { dbDelete, dbGet, dbPut } from "@/lib/storage/db";
import { makeJobProgress } from "@/lib/jobs/control";
import { claimJob, listClaimCandidates, type AnalysisJob } from "@/lib/jobs/queue";

const cleanup: string[] = [];
const studyCleanup: string[] = [];
afterEach(async () => {
  while (cleanup.length) await dbDelete("jobs", cleanup.pop()!);
  while (studyCleanup.length) await dbDelete("studies", studyCleanup.pop()!);
});

const T0 = Date.UTC(2026, 0, 1);
const at = (minute: number) => new Date(T0 + minute * 60_000).toISOString();

function job(id: string, status: string, minute: number, extra: Partial<AnalysisJob> = {}): AnalysisJob {
  return {
    job_id: id,
    study_id: `study_${id}`,
    kind: "analysis",
    status: status as AnalysisJob["status"],
    state: status as AnalysisJob["status"],
    attempts: status === "queued" ? 0 : 1,
    retry_count: 0,
    version: 0,
    claim_version: 0,
    cancellation_requested: false,
    retry_policy_version: "lease-retry-v1",
    created_at: at(minute),
    progress: makeJobProgress({ stage: "queued", percent: 0, message: "fixture" }),
    ...extra,
  };
}

async function put(record: AnalysisJob): Promise<void> {
  await dbPut("studies", record.study_id, {
    study_id: record.study_id, created_at: record.created_at, modality: "unknown", eye: "unknown",
    source: "test", metadata: {}, files: [], status: "uploaded", original_sha256: "fixture",
  });
  studyCleanup.push(record.study_id);
  await dbPut("jobs", record.job_id, record);
  cleanup.push(record.job_id);
}

/** Candidates restricted to this file's fixtures (the test database is shared per run). */
async function mine(prefix: string, limit = 20, now: number = T0 + 10_000 * 60_000): Promise<string[]> {
  return (await listClaimCandidates(limit, now)).map((c) => c.job_id).filter((id) => id.startsWith(prefix));
}

describe("external worker claim candidates", () => {
  it("finds a new queued job behind more than 32 terminal jobs", async () => {
    // Regression: the worker used to read the 32 oldest jobs and filter them,
    // so any queue history longer than 32 terminal jobs starved new work.
    for (let i = 0; i < 40; i += 1) await put(job(`wccA_done_${String(i).padStart(2, "0")}`, ["completed", "failed", "cancelled"][i % 3], i));
    await put(job("wccA_new_queued", "queued", 50));
    expect(await mine("wccA_")).toEqual(["wccA_new_queued"]);
  });

  it("returns queued and retryable jobs oldest first, never running/stale/terminal ones", async () => {
    // Rows are inserted in creation order, as in production; the scan orders
    // by the row's insertion key, exactly like the paged job listing.
    await put(job("wccB_c_queued", "queued", 1));
    for (const [i, status] of ["running", "stale", "completed", "failed", "cancelled", "claimed", "error"].entries()) {
      await put(job(`wccB_x_${status}`, status, 1));
      if (i === 3) await put(job("wccB_b_retryable", "retryable", 2));
    }
    await put(job("wccB_a_queued", "queued", 3));
    expect(await mine("wccB_")).toEqual(["wccB_c_queued", "wccB_b_retryable", "wccB_a_queued"]);
  });

  it("treats a missing or unknown legacy status as queued, as normalizeJob does", async () => {
    const legacy = job("wccC_legacy", "queued", 0);
    delete (legacy as Partial<AnalysisJob>).status;
    await put(legacy);
    await put(job("wccC_weird", "LEGACY_PENDING", 1));
    expect(await mine("wccC_")).toEqual(["wccC_legacy", "wccC_weird"]);
  });

  it("uses the legacy state field when status is absent, so old finished rows cannot fill the limit", async () => {
    for (let i = 0; i < 10; i += 1) {
      const legacyDone = job(`wccG_legacy_done_${i}`, "completed", i);
      delete (legacyDone as Partial<AnalysisJob>).status;
      await put(legacyDone);
    }
    await put(job("wccG_new_queued", "queued", 20));
    // Max page: other test files may leave older queued rows in the shared run database.
    const ids = (await listClaimCandidates(100, T0 + 10_000 * 60_000)).map((c) => c.job_id);
    expect(ids.filter((id) => id.startsWith("wccG_legacy"))).toEqual([]);
    expect(ids).toContain("wccG_new_queued");
  });

  it("leaves out a retry that is not yet due so it cannot hold newer queued work", async () => {
    await put(job("wccD_retry_later", "retryable", 0, { retry_after_at: at(500) }));
    await put(job("wccD_queued", "queued", 5));
    expect(await mine("wccD_", 1, T0 + 100 * 60_000)).toEqual(["wccD_queued"]);
    // Once due, the older retry is first again.
    expect(await mine("wccD_", 20, T0 + 600 * 60_000)).toEqual(["wccD_retry_later", "wccD_queued"]);
  });

  it("stays bounded and fast with a large terminal history and no candidates", async () => {
    for (let i = 0; i < 250; i += 1) await put(job(`wccE_done_${String(i).padStart(3, "0")}`, "completed", i));
    const started = performance.now();
    expect(await mine("wccE_")).toEqual([]);
    const second = await listClaimCandidates(8, T0);
    expect(second.every((c) => !c.job_id.startsWith("wccE_"))).toBe(true);
    expect(performance.now() - started).toBeLessThan(2_000);
  }, 120_000);

  it("lets exactly one of several concurrent claims win", async () => {
    await put(job("wccF_contended", "queued", 0, { created_at: new Date().toISOString() }));
    const results = await Promise.all(["w1", "w2", "w3", "w4"].map((worker) => claimJob("wccF_contended", worker)));
    const winners = results.filter(Boolean);
    expect(winners).toHaveLength(1);
    const stored = await dbGet<AnalysisJob>("jobs", "wccF_contended");
    expect(stored?.status).toBe("running");
    expect(stored?.worker_id).toBe(winners[0]!.worker_id);
    // A claimed job is no longer a candidate.
    expect(await mine("wccF_", 20, Date.now())).toEqual([]);
  });
});
