import { afterEach, describe, expect, it } from "vitest";
import { dbAll, dbDelete, dbGet, dbPut } from "@/lib/storage/db";
import { recordConsent } from "@/lib/consent/consent";
import { makeJobProgress } from "@/lib/jobs/control";
import { enqueueAnalysis, type AnalysisJob } from "@/lib/jobs/queue";

// Default (in-process) dispatch mode: VISIONSCAN_EXTERNAL_WORKER is not set.
const studies: string[] = [];
afterEach(async () => {
  for (const studyId of studies.splice(0)) {
    for (const job of (await dbAll<AnalysisJob>("jobs")).filter((j) => j.study_id === studyId)) await dbDelete("jobs", job.job_id);
    await dbDelete("studies", studyId);
  }
});

describe("reused analysis job dispatch (in-process mode)", () => {
  it("runs an orphaned queued job that a duplicate request reuses", async () => {
    expect(process.env.VISIONSCAN_EXTERNAL_WORKER ?? "").not.toMatch(/^(1|true|yes)$/i);
    // The study has no stored original, so execution stops at source
    // validation without running any model.
    const studyId = `study_orphan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await dbPut("studies", studyId, {
      study_id: studyId, created_at: new Date().toISOString(), modality: "fundus", eye: "OD",
      source: "test", metadata: {}, files: [], status: "uploaded", original_sha256: "fixture",
    });
    studies.push(studyId);
    await recordConsent({ studyId, purpose: "IMAGE_MODEL_ANALYSIS", consentType: "explicit", status: "GRANTED", actor: "test" });

    // A queued job left behind by a process that restarted before claiming it.
    const orphanId = `job_orphan_${Date.now()}`;
    await dbPut("jobs", orphanId, {
      job_id: orphanId, study_id: studyId, kind: "analysis", status: "queued", state: "queued",
      attempts: 0, retry_count: 0, version: 0, claim_version: 0, cancellation_requested: false,
      retry_policy_version: "lease-retry-v1", created_at: new Date().toISOString(),
      progress: makeJobProgress({ stage: "queued", percent: 0, message: "orphan fixture" }),
    } satisfies AnalysisJob);

    const reused = await enqueueAnalysis(studyId);
    expect(reused.job_id).toBe(orphanId);

    // Before the fix a reused job was never dispatched and stayed queued forever.
    const deadline = Date.now() + 30_000;
    let current = await dbGet<AnalysisJob>("jobs", orphanId);
    while (current?.status === "queued" && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200));
      current = await dbGet<AnalysisJob>("jobs", orphanId);
    }
    expect(current?.attempts).toBeGreaterThanOrEqual(1);
    expect(current?.status).not.toBe("queued");
  }, 60_000);
});
