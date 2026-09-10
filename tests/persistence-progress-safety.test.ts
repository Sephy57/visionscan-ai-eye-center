import { afterEach, describe, expect, it } from "vitest";
import fs from "fs/promises";
import type { AnalysisResult } from "@/lib/analysis/schema";
import type { StructuredClinicalEvidence } from "@/lib/evidence/structuredClinicalEvidence";
import { DeterministicReasoningEngine } from "@/lib/models/reasoningEngine";
import { clearInferenceCache, getInferenceCache, inferenceCacheKey, setInferenceCache } from "@/lib/models/inferenceCache";
import { makeJobProgress } from "@/lib/jobs/control";
import { cancelJob, getJob, retryJob, type AnalysisJob } from "@/lib/jobs/queue";
import { dbDelete, dbPut } from "@/lib/storage/db";
import { generateReport } from "@/lib/reports/generator";
import { verifyReportVersionFreeze } from "@/lib/reports/integrity";
import { getReasoningRecord, persistReasoningRecord } from "@/lib/reports/reasoningRecord";
import { analyzeStudy } from "@/lib/studies/service";
import { recentAudit } from "@/lib/audit";

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  clearInferenceCache();
  while (cleanup.length) await cleanup.pop()?.().catch(() => {});
});

function analysis(studyId: string): AnalysisResult {
  return {
    schema_version: "1.0.0",
    study: { study_id: studyId, modality: "unknown", eye: "unknown", source: "test", metadata_provenance: "none" },
    analysis_mode: "NO_MODEL_EXECUTED",
    model_execution: { models_attempted: [], models_executed: [], models_failed: [], models_skipped: [], artifact_hashes: {}, model_versions: {}, runtime_status: "not_run" },
    quality: { score: 1, acceptable: true, status: "pass", artifacts: [], affected_regions: [], recommended_reacquisition: false },
    segmentation: { implemented: false, note: "not available" },
    findings: [],
    uncertainty: { overall: 1, reasons: ["No model executed"] },
    recommendation: { priority: "specialist_review_required", action: "Clinician review required.", rationale: "No model output." },
    ensemble: { performed: false, checks: [], note: "not performed" },
    demo: { synthetic_result: false, label: "NO MODEL EXECUTED" },
    diagnosis_gate: { allowed: false, reasons: ["No validated model"], clinical_interpretation: "REQUIRES_CLINICAL_CORRELATION" },
    provenance: { models: [], ruleset_version: "clinical-rules-test", analyzed_at: new Date().toISOString(), input_dimensions: { width: 1, height: 1 }, pipeline_version: "pipeline-test" },
    safety: { quality_gate_enforced: true, disclaimers: ["test only"], blocked_claims: [] },
  };
}

function evidence(studyId: string): StructuredClinicalEvidence {
  return {
    study_id: studyId,
    encounter_id: null,
    generated_at: new Date().toISOString(),
    evidence: [],
    conflicts: [],
    possible_conditions: [],
    specialist_bundles: [],
    specialist_packages: [],
    safety_banner: "NOT A DIAGNOSIS",
  };
}

describe("immutable specialist/reasoning report records", () => {
  it("persists a self-contained version-frozen snapshot and detects report AI-field mutation", async () => {
    const studyId = `study_persist_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const a = analysis(studyId);
    const e = evidence(studyId);
    const reasoning = new DeterministicReasoningEngine().analyze(e);
    const snapshot = await persistReasoningRecord({ report_id: `rep_${studyId}`, analysis: a, evidence: e, reasoning });
    cleanup.push(() => dbDelete("reasoning_records", snapshot.reasoning_record_id));

    const report = await generateReport(a, undefined, snapshot);
    cleanup.push(() => dbDelete("reports", report.report_id));
    if (report.exports.json_path) cleanup.push(() => fs.unlink(report.exports.json_path!));

    expect(report.reasoning_snapshot?.payload_sha256).toBe(snapshot.payload_sha256);
    expect(report.version_freeze).toMatchObject({
      pipeline_version: "pipeline-test",
      pipeline_ruleset_version: "clinical-rules-test",
      evidence_taxonomy_version: reasoning.rule_set_version,
      reasoning_engine_version: reasoning.engine_version,
      reasoning_record_schema_version: snapshot.record_schema_version,
      source_analysis_sha256: snapshot.source_analysis_sha256,
    });
    expect(verifyReportVersionFreeze(report)).toEqual({ ok: true });

    report.overall_result = "tampered";
    expect(verifyReportVersionFreeze(report)).toEqual({ ok: false, reason: "AI_PAYLOAD_HASH_MISMATCH" });
  });

  it("returns immutable record copies and refuses to overwrite a finalized report", async () => {
    const studyId = `study_final_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const a = analysis(studyId);
    const e = evidence(studyId);
    const reasoning = new DeterministicReasoningEngine().analyze(e);
    const snapshot = await persistReasoningRecord({ report_id: `rep_${studyId}`, analysis: a, evidence: e, reasoning });
    cleanup.push(() => dbDelete("reasoning_records", snapshot.reasoning_record_id));
    const fetched = await getReasoningRecord(snapshot.reasoning_record_id);
    fetched!.reasoning.limitations.push("caller mutation");
    expect((await getReasoningRecord(snapshot.reasoning_record_id))!.reasoning.limitations).not.toContain("caller mutation");

    const report = await generateReport(a, undefined, snapshot);
    if (report.exports.json_path) cleanup.push(() => fs.unlink(report.exports.json_path!));
    report.review.status = "clinician_finalized";
    await dbPut("reports", report.report_id, report);
    cleanup.push(() => dbDelete("reports", report.report_id));
    await expect(generateReport(a, undefined, snapshot)).rejects.toThrow(/Finalized report is immutable/);
    await dbPut("studies", studyId, {
      study_id: studyId, created_at: new Date().toISOString(), modality: "unknown", eye: "unknown", source: "test",
      metadata: { scanType: "unknown", eye: "unknown", providedBy: "none" }, files: [], status: "analyzed", original_sha256: "a".repeat(64),
    });
    cleanup.push(() => dbDelete("studies", studyId));
    await expect(analyzeStudy(studyId)).rejects.toThrow(/Finalized report is immutable/);
  });
});

describe("job progress, cancellation, and retry safety", () => {
  it("cancels a queued job persistently with bounded progress", async () => {
    const jobId = `job_cancel_${Date.now()}`;
    await dbPut("studies", "missing", {
      study_id: "missing", created_at: new Date().toISOString(), modality: "unknown", eye: "unknown",
      source: "test", metadata: {}, files: [], status: "uploaded", original_sha256: "fixture",
    });
    cleanup.push(() => dbDelete("studies", "missing"));
    const job: AnalysisJob = {
      job_id: jobId, study_id: "missing", kind: "analysis", status: "queued", attempts: 0,
      created_at: new Date().toISOString(), progress: makeJobProgress({ stage: "queued", percent: -5, message: "queued" }),
    };
    await dbPut("jobs", jobId, job);
    cleanup.push(() => dbDelete("jobs", jobId));
    const cancelled = await cancelJob(jobId, "tester");
    expect(cancelled?.status).toBe("cancelled");
    expect(cancelled?.progress.stage).toBe("cancelled");
    expect(cancelled?.progress.percent).toBe(0);
    expect((await getJob(jobId))?.cancellation_requested_at).toBeTruthy();
  });

  it("requires an explicit retry key and exact replay never creates another attempt", async () => {
    const jobId = `job_retry_${Date.now()}`;
    const retryStudyId = `missing_${jobId}`;
    await dbPut("studies", retryStudyId, {
      study_id: retryStudyId, created_at: new Date().toISOString(), modality: "unknown", eye: "unknown",
      source: "test", metadata: {}, files: [], status: "uploaded", original_sha256: "fixture",
    });
    cleanup.push(() => dbDelete("studies", retryStudyId));
    const job: AnalysisJob = {
      job_id: jobId, study_id: retryStudyId, kind: "analysis", status: "failed", attempts: 0,
      error: "fixture", created_at: new Date().toISOString(), completed_at: new Date().toISOString(),
      progress: makeJobProgress({ stage: "failed", percent: 10, message: "failed" }),
    };
    await dbPut("jobs", jobId, job);
    cleanup.push(() => dbDelete("jobs", jobId));
    await expect(retryJob(jobId, "tester", "short")).rejects.toThrow(/idempotency key/);
    const key = `retry:${jobId}`;
    await retryJob(jobId, "tester", key);
    await retryJob(jobId, "tester", key);
    const firstAuditCount = (await recentAudit(500)).filter((event) => event.action === "job.retry" && event.detail?.startsWith(jobId)).length;
    for (let i = 0; i < 400 && (await getJob(jobId))?.status !== "failed"; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const afterAttempt = await getJob(jobId);
    expect(afterAttempt?.status).toBe("failed");
    expect(afterAttempt?.attempts).toBe(1);
    await retryJob(jobId, "tester", key);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect((await getJob(jobId))?.attempts).toBe(1);
    const replayAuditCount = (await recentAudit(500)).filter((event) => event.action === "job.retry" && event.detail?.startsWith(jobId)).length;
    expect(replayAuditCount).toBe(firstAuditCount);
  }, 15000);
});

describe("inference cache provenance isolation", () => {
  it("keys content and ROI separately and never returns a mutable stored reference", () => {
    const base = {
      scope: "study-1", contentHash: "a".repeat(64), roiHash: "b".repeat(64),
      modelId: "model", modelVersion: "1", preprocessingVersion: "prep-1", eye: "OD",
    };
    const key = inferenceCacheKey(base);
    expect(inferenceCacheKey({ ...base, roiHash: "c".repeat(64) })).not.toBe(key);
    expect(inferenceCacheKey({ ...base, contentHash: "d".repeat(64) })).not.toBe(key);
    expect(inferenceCacheKey({ ...base, modelVersion: "2" })).not.toBe(key);
    expect(inferenceCacheKey({ ...base, preprocessingVersion: "prep-2" })).not.toBe(key);
    setInferenceCache(key, { nested: { value: 1 } });
    const first = getInferenceCache<{ nested: { value: number } }>(key)!;
    first.nested.value = 99;
    expect(getInferenceCache<{ nested: { value: number } }>(key)!.nested.value).toBe(1);
  });
});
