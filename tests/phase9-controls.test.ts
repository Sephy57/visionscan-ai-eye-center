import { afterEach, describe, expect, it } from "vitest";
import { dbAll, dbDelete, dbGet, dbPut } from "@/lib/storage/db";
import { persistOnce, recordJobEffect } from "@/lib/jobs/effects";
import { sha256Canonical } from "@/lib/reports/integrity";
import { classifyJobAge, resolveJobDeadlinePolicy } from "@/lib/jobs/deadlinePolicy";
import { WorkerLifecycle } from "@/lib/jobs/workerLifecycle";
import { maybeInjectPhase9Fault, Phase9InjectedFaultError, resetPhase9FaultInjectionForTests } from "@/lib/jobs/phase9FaultInjection";
import { generateReport } from "@/lib/reports/generator";
import { submitReview, type AnalysisRecord } from "@/lib/studies/service";
import type { AnalysisResult } from "@/lib/analysis/schema";
import { EVIDENCE_TAXONOMY_VERSION } from "@/lib/evidence/conditionTaxonomy";
import { REASONING_ENGINE_VERSION } from "@/lib/models/reasoningEngine";
import { SPECIALIST_PACKAGE_VERSION } from "@/lib/clinical/specialistPackages";
import { VALIDATION_REGISTRY_VERSION } from "@/lib/models/validationRegistry";
import { OPHTHALMIC_COVERAGE_VERSION } from "@/lib/models/ophthalmicCoverage";
import { REASONING_RECORD_SCHEMA_VERSION } from "@/lib/reports/integrity";

const originalNodeEnv = process.env.NODE_ENV;
const originalFaults = process.env.VISIONSCAN_PHASE9_FAULT_INJECTION;
const mutableEnv = process.env as Record<string, string | undefined>;

afterEach(async () => {
  if (originalNodeEnv === undefined) delete mutableEnv.NODE_ENV;
  else mutableEnv.NODE_ENV = originalNodeEnv;
  if (originalFaults === undefined) delete mutableEnv.VISIONSCAN_PHASE9_FAULT_INJECTION;
  else mutableEnv.VISIONSCAN_PHASE9_FAULT_INJECTION = originalFaults;
  resetPhase9FaultInjectionForTests();
  await dbDelete("job_effects", "effect_model_result_phase9-test").catch(() => false);
  await dbDelete("job_effects", "effect_report_phase9-report").catch(() => false);
  const events = await dbAll<{ review_event_id: string }>("clinician_reviews");
  for (const event of events.filter((item) => item.review_event_id.startsWith("review_event_"))) await dbDelete("clinician_reviews", event.review_event_id);
  await dbDelete("reports", "rep_phase9-review-concurrency");
  await dbDelete("analyses", "anl_phase9-review-concurrency");
  await dbDelete("studies", "phase9-review-concurrency");
});

describe("Phase 9 committed-effect controls", () => {
  it("inserts a canonical effect once and refuses a different payload", async () => {
    const first = await persistOnce("job_effects", "effect_model_result_phase9-test", { id: "phase9-test", value: 1 }, (value) => sha256Canonical(value));
    const replay = await persistOnce("job_effects", "effect_model_result_phase9-test", { id: "phase9-test", value: 1 }, (value) => sha256Canonical(value));
    expect(replay).toEqual(first);
    await expect(persistOnce("job_effects", "effect_model_result_phase9-test", { id: "phase9-test", value: 2 }, (value) => sha256Canonical(value))).rejects.toThrow("IMMUTABLE_EFFECT_CONFLICT");
  });

  it("records a stable report effect on replay without rewriting its identity", async () => {
    const first = await recordJobEffect({ effect_type: "REPORT", idempotency_key: "rep_phase9-report", canonical_id: "phase9-report", payload: { hash: "abc" }, study_id: "study_phase9" });
    const replay = await recordJobEffect({ effect_type: "REPORT", idempotency_key: "rep_phase9-report", canonical_id: "phase9-report", payload: { hash: "abc" }, study_id: "study_phase9", attempt_id: "attempt-replay" });
    expect(replay.effect_id).toBe(first.effect_id);
    expect(replay.created_at).toBe(first.created_at);
    expect(await dbGet("job_effects", first.effect_id)).toEqual(first);
  });

  it("exposes bounded queue/service/total-age outcomes", () => {
    const policy = resolveJobDeadlinePolicy({ ...process.env, VISIONSCAN_MAX_QUEUE_WAIT_MS: "1000", VISIONSCAN_MAX_SERVICE_TIME_MS: "5000", VISIONSCAN_MAX_TOTAL_AGE_MS: "6000" });
    const created = "2026-01-01T00:00:00.000Z";
    expect(classifyJobAge({ created_at: created, now: Date.parse("2026-01-01T00:00:00.500Z"), policy }).outcome).toBe("WITHIN_BUDGET");
    expect(classifyJobAge({ created_at: created, now: Date.parse("2026-01-01T00:00:01.500Z"), policy }).outcome).toBe("QUEUE_TIMEOUT");
    expect(classifyJobAge({ created_at: created, claimed_at: "2026-01-01T00:00:00.500Z", now: Date.parse("2026-01-01T00:00:06.000Z"), policy }).outcome).toBe("JOB_DEADLINE_EXCEEDED");
  });

  it("does not claim new work after an explicit shutdown request", () => {
    const lifecycle = new WorkerLifecycle("LEASE_FOR_RECOVERY");
    lifecycle.startJob("job-current");
    const event = lifecycle.requestShutdown("SIGINT");
    expect(event.policy).toBe("LEASE_FOR_RECOVERY");
    expect(lifecycle.canClaim()).toBe(false);
    expect(lifecycle.snapshot()).toMatchObject({ state: "STOP_REQUESTED", current_job_id: "job-current" });
    lifecycle.finishJob("job-current");
    expect(lifecycle.snapshot()).toMatchObject({ state: "STOPPED", current_job_id: null });
  });

  it("activates an injected fault only in the isolated test guard and consumes it once", () => {
    mutableEnv.NODE_ENV = "test";
    mutableEnv.VISIONSCAN_TEST_ISOLATED = "1";
    mutableEnv.VISIONSCAN_PHASE9_FAULT_INJECTION = "AFTER_REPORT_COMMIT";
    resetPhase9FaultInjectionForTests();
    expect(() => maybeInjectPhase9Fault("AFTER_REPORT_COMMIT")).toThrowError(Phase9InjectedFaultError);
    expect(() => maybeInjectPhase9Fault("AFTER_REPORT_COMMIT")).not.toThrow();
    mutableEnv.NODE_ENV = "production";
    mutableEnv.VISIONSCAN_PHASE9_FAULT_INJECTION = "BEFORE_REPORT_COMMIT";
    expect(() => maybeInjectPhase9Fault("BEFORE_REPORT_COMMIT")).not.toThrow();
  });

  it("preserves concurrent review events and marks the projection conflicted", async () => {
    const studyId = "phase9-review-concurrency";
    const analysis: AnalysisResult = {
      schema_version: "1.0.0",
      study: { study_id: studyId, modality: "fundus", eye: "OD", source: "research", metadata_provenance: "none" },
      quality: { score: 0.9, acceptable: true, status: "PASS", artifacts: [], affected_regions: [], recommended_reacquisition: false },
      segmentation: { implemented: false, note: "none" },
      findings: [{ id: "phase9-finding", type: "retinal_signal", location: "retina", severity: "mild", confidence: 0.4, confidence_category: "LOW CONFIDENCE", explanation: "Research output.", synthetic: false, model_id: "research-model", model_version: "1", model_status: "RESEARCH", laterality: "OD" }],
      uncertainty: { overall: 0.8, reasons: ["not calibrated"] },
      recommendation: { priority: "prompt_professional_review", action: "Review with a qualified eye-care professional.", rationale: "Research output requires correlation." },
      ensemble: { performed: false, checks: [], note: "none" },
      demo: { synthetic_result: false, label: "RESEARCH ONLY" },
      diagnosis_gate: { allowed: false, reasons: ["RESEARCH_ONLY"], clinical_interpretation: "REQUIRES_CLINICAL_CORRELATION" },
      provenance: { models: [{ model_id: "research-model" }], ruleset_version: "test", analyzed_at: new Date().toISOString(), input_dimensions: { width: 10, height: 10 }, pipeline_version: "test" },
      safety: { quality_gate_enforced: true, disclaimers: ["NOT CLINICALLY VALIDATED"], blocked_claims: [] },
    } as AnalysisResult;
    const analysisRecord: AnalysisRecord = { analysis_id: `anl_${studyId}`, study_id: studyId, created_at: new Date().toISOString(), result: analysis };
    await dbPut("studies", studyId, { study_id: studyId, created_at: new Date().toISOString(), modality: "fundus", eye: "OD", source: "test", metadata: {}, files: [], status: "uploaded", original_sha256: "fixture" });
    await dbPut("analyses", analysisRecord.analysis_id, analysisRecord);
    const reasoningSnapshot = {
      reasoning_record_id: `reason_${studyId}`,
      report_id: `rep_${studyId}`,
      study_id: studyId,
      record_schema_version: REASONING_RECORD_SCHEMA_VERSION,
      source_analysis_sha256: sha256Canonical(analysis),
      version_freeze: {
        report_version: "1.2.0", pipeline_version: "test", pipeline_ruleset_version: "test",
        evidence_taxonomy_version: EVIDENCE_TAXONOMY_VERSION, condition_knowledge_version: EVIDENCE_TAXONOMY_VERSION,
        specialist_rules_version: SPECIALIST_PACKAGE_VERSION, validation_registry_version: VALIDATION_REGISTRY_VERSION,
        reasoning_engine_version: REASONING_ENGINE_VERSION, coverage_registry_version: OPHTHALMIC_COVERAGE_VERSION,
      },
      evidence_snapshot: [], evidence_conflicts: [], condition_assessments: [], specialist_consensus: null,
      specialist_bundles: [], specialist_packages: [], reasoning: { study_id: studyId, engine_version: REASONING_ENGINE_VERSION, rule_set_version: EVIDENCE_TAXONOMY_VERSION }, payload_sha256: "fixture",
    };
    await generateReport(analysis, undefined, reasoningSnapshot as any);
    const [first, second] = await Promise.all([
      submitReview(studyId, { reviewer_id: "reviewer-a", action: "confirm", finding_id: "phase9-finding" }),
      submitReview(studyId, { reviewer_id: "reviewer-b", action: "reject", finding_id: "phase9-finding" }),
    ]);
    const projection = first?.review.conflict_state === "CONCURRENT_REVIEW_CONFLICT" ? first : second;
    expect(projection?.review.conflict_state).toBe("CONCURRENT_REVIEW_CONFLICT");
    expect((await dbAll<{ report_id: string }>("clinician_reviews")).filter((event) => event.report_id === `rep_${studyId}`)).toHaveLength(2);
  });
});
