import { describe, expect, it } from "vitest";
import {
  candidateManifestFromBaseline,
  compareDrCompetitionResults,
  computeDrCompetitionMetrics,
  freezeRunManifest,
  measuredResultFromCases,
  notMeasuredResult,
  validateRunManifest,
  validateRunResult,
  type CompetitionEvidenceRef,
  type DrCompetitionModelRef,
} from "@/lib/models/competitionContract";

const evidence: CompetitionEvidenceRef[] = [{ id: "fixture", path: "tests/model-competition-fixture.json", sha256: "a".repeat(64), role: "result_source" }];
const baselineModel: DrCompetitionModelRef = { role: "BASELINE", model_id: "baseline", model_version: "v1", artifact_path: "models/baseline/model.safetensors", artifact_sha256: "b".repeat(64), artifact_format: "safetensors" };

function manifest(model: DrCompetitionModelRef = baselineModel) {
  return freezeRunManifest({
    format: "visionscan-dr-competition-run-manifest/v1",
    manifest_id: `${model.role.toLowerCase()}-manifest`,
    state: "FROZEN",
    frozen_at: "2026-09-13T00:00:00.000Z",
    task: { target: "ICDR_DR_GRADE", modality: "FUNDUS", label_space: ["0", "1", "2", "3", "4"], referable_threshold_grade: 2, grade_rule: "ROUND_CLAMP_0_4", score_semantics: "MODEL_SCORE_NOT_CALIBRATED", calibration: "NOT_MEASURED" },
    dataset: { name: "DeepDRiD regular fundus", version: "fixture", split: "regular-fundus-validation", case_count: 4, patient_count: 2, patient_separation: "PATIENT_SEPARATED_CONFIRMED", case_id_source_fields: ["patient_id", "image"], result_case_id_policy: "SOURCE_KEYS_MUST_BE_HASHED_OR_STABLE_NON_PHI_IDS" },
    preprocessing: { version: "clementp-dr-source-pinned-512-v1", implementation_path: "scripts/inference/dr_grade_probe.py", input_shape: "3x512x512", decode: "CV2_IMREAD_COLOR_BGR", crop: "CHANNEL_0_THRESHOLD_10_AUTOCROP_DEGENERATE_WHOLE_IMAGE", resize: "LONGEST_SIDE_512_INTER_LINEAR", pad: "CENTERED_ZERO_PAD_TO_512_SQUARE", scale: "DIVIDE_BY_255", normalization: "IMAGENET_MEAN_STD_IN_SAME_CHANNEL_ORDER", tensor_layout: "HWC_TO_CHW_FLOAT32", caveats: ["fixture"] },
    protocol: { ground_truth_field: "eye_grade", prediction_field: "dr_grade", score_field: "dr_logit", referable_truth_rule: "GROUND_TRUTH_GRADE_GE_2", referable_prediction_rule: "PREDICTED_GRADE_GE_2", row_policy: "ALL_ROWS_IN_DECLARED_SPLIT_NO_ADDITIONAL_FILTER", score_metrics_policy: "REQUIRE_FINITE_SCORE_ON_EVERY_ROW_OR_REPORT_UNMEASURED" },
    model,
    evidence,
    limitations: ["Synthetic test fixture only."],
  });
}

const cases = [
  { case_id: "case-1", ground_truth_grade: 0 as const, predicted_grade: 0 as const, model_score: 0.1 },
  { case_id: "case-2", ground_truth_grade: 1 as const, predicted_grade: 2 as const, model_score: 0.2 },
  { case_id: "case-3", ground_truth_grade: 2 as const, predicted_grade: 1 as const, model_score: 0.3 },
  { case_id: "case-4", ground_truth_grade: 4 as const, predicted_grade: 3 as const, model_score: 0.4 },
];

describe("DR competition immutable contract", () => {
  it("freezes a manifest and detects canonical-content tampering", () => {
    const frozen = manifest();
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.dataset)).toBe(true);
    expect(validateRunManifest(frozen).valid).toBe(true);
    const tampered = { ...frozen, dataset: { ...frozen.dataset, version: "changed" } };
    expect(validateRunManifest(tampered).errors).toContain("manifest_sha256 does not match canonical manifest content");
  });

  it("derives a candidate manifest with the exact baseline semantics", () => {
    const base = manifest();
    const candidate = candidateManifestFromBaseline(base, { model_id: "candidate", model_version: "v2", artifact_path: "models/candidate/model.safetensors", artifact_sha256: "c".repeat(64), artifact_format: "safetensors" }, "candidate-manifest", "2026-09-13T00:00:00.000Z");
    expect(candidate.model.role).toBe("CANDIDATE");
    expect(candidate.semantics_fingerprint).toBe(base.semantics_fingerprint);
    expect(validateRunManifest(candidate).valid).toBe(true);
  });

  it("computes declared measurements without treating a score as probability", () => {
    const metrics = computeDrCompetitionMetrics(cases);
    expect(metrics.sample_count).toBe(4);
    expect(metrics.referable.confusion).toEqual({ tp: 1, fp: 1, tn: 1, fn: 1 });
    expect(metrics.referable.sensitivity).toBe(0.5);
    expect(metrics.referable.auroc).toBe(1);
    expect(metrics.referable.auprc).toBe(1);
    expect(metrics.confidence_intervals.method).toBe("WILSON_95_PERCENT");
    expect(metrics.confidence_intervals.referable.sensitivity).toHaveLength(2);
  });

  it("requires the frozen case count and records absent continuous scores", () => {
    const base = manifest();
    expect(() => measuredResultFromCases({ manifest: base, result_id: "bad", cases: cases.slice(0, 3), evidence })).toThrow(/Case count/);
    const result = measuredResultFromCases({ manifest: base, result_id: "measured", cases: cases.map((item, index) => index === 0 ? { ...item, model_score: null } : item), evidence });
    expect(result.metrics?.referable.auroc).toBe(null);
    expect(result.limitations.join(" ")).toMatch(/not available for every row/);
    expect(validateRunResult(result).valid).toBe(true);
  });

  it("blocks candidates that have no measured result instead of inferring metrics", () => {
    const base = manifest();
    const baseline = measuredResultFromCases({ manifest: base, result_id: "baseline-result", cases, evidence });
    const candidateManifest = candidateManifestFromBaseline(base, { model_id: "candidate", model_version: "v2", artifact_path: "models/candidate/model.safetensors", artifact_sha256: "c".repeat(64), artifact_format: "safetensors" }, "candidate-manifest", "2026-09-13T00:00:00.000Z");
    const candidate = notMeasuredResult({ manifest: candidateManifest, result_id: "candidate-result", limitations: ["Candidate artifact and case-level predictions are not available; no candidate measurement was run."], evidence });
    const comparison = compareDrCompetitionResults(baseline, candidate);
    expect(comparison.status).toBe("BLOCKED");
    expect(comparison.reasons.join(" ")).toMatch(/no complete measured result/);
    expect(comparison.metric_deltas).toEqual([]);
  });

  it("compares a measured future candidate only after the semantics match", () => {
    const base = manifest();
    const baseline = measuredResultFromCases({ manifest: base, result_id: "baseline-result", cases, evidence });
    const candidateManifest = candidateManifestFromBaseline(base, { model_id: "candidate", model_version: "v2", artifact_path: "models/candidate/model.safetensors", artifact_sha256: "c".repeat(64), artifact_format: "safetensors" }, "candidate-manifest", "2026-09-13T00:00:00.000Z");
    const candidate = measuredResultFromCases({ manifest: candidateManifest, result_id: "candidate-result", cases: cases.map((item) => ({ ...item, predicted_grade: item.ground_truth_grade })), evidence });
    const comparison = compareDrCompetitionResults(baseline, candidate);
    expect(comparison.reasons).toEqual([]);
    expect(comparison.status).toBe("COMPARABLE");
    expect(comparison.metric_deltas.find((delta) => delta.metric === "referable.sensitivity")?.candidate_minus_baseline).toBe(0.5);
  });

  it("blocks a result whose semantics fingerprint differs", () => {
    const base = manifest();
    const baseline = measuredResultFromCases({ manifest: base, result_id: "baseline-result", cases, evidence });
    const { manifest_sha256: _manifestHash, semantics_fingerprint: _fingerprint, ...baseInput } = base;
    const changed = freezeRunManifest({ ...baseInput, manifest_id: "changed-manifest", dataset: { ...base.dataset, version: "different-dataset" } });
    const candidate = measuredResultFromCases({ manifest: changed, result_id: "changed-result", cases, evidence });
    const comparison = compareDrCompetitionResults(baseline, candidate);
    expect(comparison.status).toBe("BLOCKED");
    expect(comparison.reasons.join(" ")).toMatch(/semantics differ/);
  });
});
