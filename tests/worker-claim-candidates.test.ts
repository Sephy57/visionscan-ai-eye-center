import { afterEach, describe, expect, it } from "vitest";
import { dbDelete, dbPut } from "@/lib/storage/db";
import { makeJobProgress } from "@/lib/jobs/control";
import { listClaimCandidates, type AnalysisJob } from "@/lib/jobs/queue";

const cleanup: string[] = [];
const studyCleanup: string[] = [];
afterEach(async () => {
  while (cleanup.length) await dbDelete("jobs", cleanup.pop()!);
  while (studyCleanup.length) await dbDelete("studies", studyCleanup.pop()!);
});

function job(id: string, status: AnalysisJob["status"], minute: number): AnalysisJob {
  return {
    job_id: id,
    study_id: `study_${id}`,
    kind: "analysis",
    status,
    state: status,
    attempts: status === "queued" ? 0 : 1,
    retry_count: 0,
    version: 0,
    claim_version: 0,
    cancellation_requested: false,
    retry_policy_version: "lease-retry-v1",
    created_at: new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString(),
    progress: makeJobProgress({ stage: "queued", percent: 0, message: "fixture" }),
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

describe("external worker claim candidates", () => {
  it("finds a new queued job behind more than one page of terminal history", async () => {
    // Regression: the worker used to read the 32 oldest jobs and filter them,
    // so any queue history longer than 32 terminal jobs starved new work.
    for (let i = 0; i < 40; i += 1) await put(job(`wcc_done_${String(i).padStart(2, "0")}`, i % 2 ? "completed" : "failed", i));
    await put(job("wcc_new_queued", "queued", 50));

    const candidates = await listClaimCandidates(1);
    expect(candidates.map((c) => c.job_id)).toEqual(["wcc_new_queued"]);
  });

  it("returns queued and retryable jobs oldest first, never terminal ones", async () => {
    await put(job("wcc_b_retryable", "retryable", 2));
    await put(job("wcc_a_queued", "queued", 3));
    await put(job("wcc_c_queued", "queued", 1));
    await put(job("wcc_d_cancelled", "cancelled", 0));

    const ids = (await listClaimCandidates(5)).map((c) => c.job_id).filter((id) => id.startsWith("wcc_"));
    expect(ids).toEqual(["wcc_c_queued", "wcc_b_retryable", "wcc_a_queued"]);
    expect((await listClaimCandidates(1)).length).toBe(1);
  });
});
