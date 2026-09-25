import { afterEach, describe, expect, it, vi } from "vitest";

// Keep enqueue from dispatching in-process execution: this test covers the
// queue contract only, not model inference.
vi.hoisted(() => { process.env.VISIONSCAN_EXTERNAL_WORKER = "true"; });

import { dbAll, dbDelete, dbGet, dbPut } from "@/lib/storage/db";
import { recordConsent } from "@/lib/consent/consent";
import { enqueueAnalysis, type AnalysisJob } from "@/lib/jobs/queue";

const studies: string[] = [];
afterEach(async () => {
  for (const studyId of studies.splice(0)) {
    for (const job of (await dbAll<AnalysisJob>("jobs")).filter((j) => j.study_id === studyId)) await dbDelete("jobs", job.job_id);
    await dbDelete("studies", studyId);
  }
});

async function consentedStudy(): Promise<string> {
  const studyId = `study_enqueue_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await dbPut("studies", studyId, {
    study_id: studyId, created_at: new Date().toISOString(), modality: "fundus", eye: "OD",
    source: "test", metadata: {}, files: [], status: "uploaded", original_sha256: "fixture",
  });
  studies.push(studyId);
  await recordConsent({ studyId, purpose: "IMAGE_MODEL_ANALYSIS", consentType: "explicit", status: "GRANTED", actor: "test" });
  return studyId;
}

const analysisJobsFor = async (studyId: string) =>
  (await dbAll<AnalysisJob>("jobs")).filter((j) => j.study_id === studyId && j.kind === "analysis");

describe("analysis enqueue idempotency", () => {
  it("concurrent duplicate requests for one study create exactly one job", async () => {
    // Regression: React StrictMode re-ran the processing page effect in
    // development, sending two POST /api/analyze; two jobs then ran
    // concurrently and the second failed with IMMUTABLE_EFFECT_CONFLICT.
    const studyId = await consentedStudy();
    const [a, b, c] = await Promise.all([enqueueAnalysis(studyId), enqueueAnalysis(studyId), enqueueAnalysis(studyId)]);
    expect(new Set([a.job_id, b.job_id, c.job_id]).size).toBe(1);
    expect(await analysisJobsFor(studyId)).toHaveLength(1);
  });

  it("reuses queued, running and retryable jobs but never a terminal one", async () => {
    const studyId = await consentedStudy();
    const first = await enqueueAnalysis(studyId);
    for (const status of ["running", "retryable"] as const) {
      const current = (await dbGet<AnalysisJob>("jobs", first.job_id))!;
      await dbPut("jobs", first.job_id, { ...current, status, state: status });
      expect((await enqueueAnalysis(studyId)).job_id).toBe(first.job_id);
    }
    for (const status of ["completed", "failed", "cancelled"] as const) {
      const jobs = await analysisJobsFor(studyId);
      for (const job of jobs) await dbPut("jobs", job.job_id, { ...job, status, state: status });
      const next = await enqueueAnalysis(studyId);
      expect(jobs.map((j) => j.job_id)).not.toContain(next.job_id);
    }
    // One reusable job plus one new job per terminal state.
    expect(await analysisJobsFor(studyId)).toHaveLength(4);
  });

  it("does not share a job across different studies", async () => {
    const [s1, s2] = [await consentedStudy(), await consentedStudy()];
    const [j1, j2] = await Promise.all([enqueueAnalysis(s1), enqueueAnalysis(s2)]);
    expect(j1.job_id).not.toBe(j2.job_id);
    expect(j1.study_id).toBe(s1);
    expect(j2.study_id).toBe(s2);
  });
});
