/**
 * Immutable, research-only contract for comparing DR model runs.
 *
 * This module is deliberately independent of providers, pipelines, queues,
 * and model lifecycle state. A run is comparable only when its manifest binds
 * it to the same task, dataset split, case semantics, and preprocessing.
 * Missing measurements remain missing; this contract never estimates or
 * promotes a candidate.
 */

import { createHash } from "node:crypto";

export const DR_COMPETITION_MANIFEST_FORMAT = "visionscan-dr-competition-run-manifest/v1" as const;
export const DR_COMPETITION_RESULT_FORMAT = "visionscan-dr-competition-run-result/v1" as const;
export const DR_COMPETITION_LABELS = ["0", "1", "2", "3", "4"] as const;
export const DR_REFERABLE_THRESHOLD_GRADE = 2 as const;

const SHA256 = /^[a-f0-9]{64}$/;
const NON_EMPTY = /\S/;

export type DrCompetitionGrade = 0 | 1 | 2 | 3 | 4;
export type DrCompetitionMeasurementState = "MEASURED" | "NOT_MEASURED" | "PARTIAL" | "REJECTED";

export interface CompetitionEvidenceRef {
  readonly id: string;
  readonly path: string;
  readonly sha256: string;
  readonly role: "dataset_export" | "validation_summary" | "model_manifest" | "preprocessing_implementation" | "result_source";
}

export interface DrCompetitionTaskSemantics {
  readonly target: "ICDR_DR_GRADE";
  readonly modality: "FUNDUS";
  readonly label_space: readonly ["0", "1", "2", "3", "4"];
  readonly referable_threshold_grade: 2;
  readonly grade_rule: "ROUND_CLAMP_0_4";
  readonly score_semantics: "MODEL_SCORE_NOT_CALIBRATED";
  readonly calibration: "NOT_MEASURED";
}

export interface DrCompetitionDatasetSemantics {
  readonly name: string;
  readonly version: string;
  readonly split: "regular-fundus-validation";
  readonly case_count: number;
  readonly patient_count: number | null;
  readonly patient_separation: "PATIENT_SEPARATED_CONFIRMED" | "PATIENT_SEPARATION_UNVERIFIABLE";
  readonly case_id_source_fields: readonly ["patient_id", "image"];
  readonly result_case_id_policy: "SOURCE_KEYS_MUST_BE_HASHED_OR_STABLE_NON_PHI_IDS";
}

export interface DrCompetitionPreprocessingSemantics {
  readonly version: string;
  readonly implementation_path: string;
  readonly input_shape: "3x512x512";
  readonly decode: "CV2_IMREAD_COLOR_BGR";
  readonly crop: "CHANNEL_0_THRESHOLD_10_AUTOCROP_DEGENERATE_WHOLE_IMAGE";
  readonly resize: "LONGEST_SIDE_512_INTER_LINEAR";
  readonly pad: "CENTERED_ZERO_PAD_TO_512_SQUARE";
  readonly scale: "DIVIDE_BY_255";
  readonly normalization: "IMAGENET_MEAN_STD_IN_SAME_CHANNEL_ORDER";
  readonly tensor_layout: "HWC_TO_CHW_FLOAT32";
  readonly caveats: readonly string[];
}

export interface DrCompetitionProtocolSemantics {
  readonly ground_truth_field: "eye_grade";
  readonly prediction_field: "dr_grade";
  readonly score_field: "dr_logit";
  readonly referable_truth_rule: "GROUND_TRUTH_GRADE_GE_2";
  readonly referable_prediction_rule: "PREDICTED_GRADE_GE_2";
  readonly row_policy: "ALL_ROWS_IN_DECLARED_SPLIT_NO_ADDITIONAL_FILTER";
  readonly score_metrics_policy: "REQUIRE_FINITE_SCORE_ON_EVERY_ROW_OR_REPORT_UNMEASURED";
}

export interface DrCompetitionModelRef {
  readonly role: "BASELINE" | "CANDIDATE";
  readonly model_id: string;
  readonly model_version: string;
  readonly artifact_path: string;
  readonly artifact_sha256: string;
  readonly artifact_format: string;
}

export interface DrCompetitionRunManifest {
  readonly format: typeof DR_COMPETITION_MANIFEST_FORMAT;
  readonly manifest_id: string;
  readonly state: "FROZEN";
  readonly frozen_at: string;
  readonly task: DrCompetitionTaskSemantics;
  readonly dataset: DrCompetitionDatasetSemantics;
  readonly preprocessing: DrCompetitionPreprocessingSemantics;
  readonly protocol: DrCompetitionProtocolSemantics;
  readonly model: DrCompetitionModelRef;
  readonly evidence: readonly CompetitionEvidenceRef[];
  readonly limitations: readonly string[];
  readonly semantics_fingerprint: string;
  readonly manifest_sha256: string;
}

export interface DrConfusionMatrix {
  readonly tp: number;
  readonly fp: number;
  readonly tn: number;
  readonly fn: number;
}

export interface DrCompetitionMetrics {
  readonly sample_count: number;
  readonly multiclass: {
    readonly accuracy: number;
    readonly balanced_accuracy: number;
    readonly macro_f1: number;
    readonly quadratic_weighted_kappa: number | null;
    readonly confusion_true_x_pred: Readonly<Record<string, Readonly<Record<string, number>>>>;
  };
  readonly referable: {
    readonly confusion: DrConfusionMatrix;
    readonly sensitivity: number | null;
    readonly specificity: number | null;
    readonly ppv: number | null;
    readonly npv: number | null;
    readonly fpr: number | null;
    readonly fnr: number | null;
    readonly auroc: number | null;
    readonly auprc: number | null;
  };
  readonly confidence_intervals: {
    readonly method: "WILSON_95_PERCENT";
    readonly referable: {
      readonly sensitivity: readonly [number, number] | null;
      readonly specificity: readonly [number, number] | null;
      readonly ppv: readonly [number, number] | null;
      readonly npv: readonly [number, number] | null;
    };
  };
}

export interface DrCompetitionCase {
  readonly case_id: string;
  readonly ground_truth_grade: DrCompetitionGrade;
  readonly predicted_grade: DrCompetitionGrade;
  readonly model_score: number | null;
}

export interface DrCompetitionRunResult {
  readonly format: typeof DR_COMPETITION_RESULT_FORMAT;
  readonly result_id: string;
  readonly manifest_id: string;
  readonly manifest_sha256: string;
  readonly semantics_fingerprint: string;
  readonly measurement_state: DrCompetitionMeasurementState;
  readonly calculation_method: "COPIED_FROM_EXISTING_EVIDENCE_SUMMARY" | "RECOMPUTED_FROM_CASES" | "NO_MEASUREMENT_AVAILABLE";
  readonly model: DrCompetitionModelRef;
  readonly metrics: DrCompetitionMetrics | null;
  readonly evidence: readonly CompetitionEvidenceRef[];
  readonly limitations: readonly string[];
  readonly result_sha256: string;
}

export interface DrCompetitionMetricDelta {
  readonly metric: string;
  readonly baseline: number | null;
  readonly candidate: number | null;
  readonly candidate_minus_baseline: number | null;
}

export interface DrCompetitionComparison {
  readonly status: "COMPARABLE" | "BLOCKED";
  readonly baseline_result_id: string;
  readonly candidate_result_id: string;
  readonly baseline_model_id: string;
  readonly candidate_model_id: string;
  readonly metric_deltas: readonly DrCompetitionMetricDelta[];
  readonly reasons: readonly string[];
  readonly limitations: readonly string[];
}

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function assertFinite(value: unknown, path: string, errors: string[]): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) errors.push(`${path} must be a finite number`);
}

function assertText(value: unknown, path: string, errors: string[]): asserts value is string {
  if (typeof value !== "string" || !NON_EMPTY.test(value)) errors.push(`${path} must be a non-empty string`);
}

function sortJson(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Canonical JSON cannot contain a non-finite number");
    return value;
  }
  if (Array.isArray(value)) return value.map(sortJson);
  if (isRecord(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJson(value[key])])) as { [key: string]: JsonValue };
  }
  throw new Error("Canonical JSON cannot contain unsupported values");
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

export function sha256Canonical(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function withoutHash<T extends object, K extends keyof T>(value: T, field: K): Omit<T, K> {
  const copy: Partial<T> = { ...value };
  delete (copy as Record<string, unknown>)[String(field)];
  return copy as Omit<T, K>;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function withManifestHash(manifest: Omit<DrCompetitionRunManifest, "manifest_sha256">): DrCompetitionRunManifest {
  const complete = { ...manifest, manifest_sha256: sha256Canonical(manifest) };
  return deepFreeze(complete);
}

function withResultHash(result: Omit<DrCompetitionRunResult, "result_sha256">): DrCompetitionRunResult {
  const complete = { ...result, result_sha256: sha256Canonical(result) };
  return deepFreeze(complete);
}

export function semanticsFingerprint(input: Pick<DrCompetitionRunManifest, "task" | "dataset" | "preprocessing" | "protocol">): string {
  return sha256Canonical({ task: input.task, dataset: input.dataset, preprocessing: input.preprocessing, protocol: input.protocol });
}

export function freezeRunManifest(input: Omit<DrCompetitionRunManifest, "semantics_fingerprint" | "manifest_sha256">): DrCompetitionRunManifest {
  return withManifestHash({ ...input, semantics_fingerprint: semanticsFingerprint(input) });
}

export function candidateManifestFromBaseline(
  baseline: DrCompetitionRunManifest,
  candidate: Omit<DrCompetitionModelRef, "role"> & { readonly role?: "CANDIDATE" },
  manifestId: string,
  frozenAt: string
): DrCompetitionRunManifest {
  const { manifest_sha256: _manifestHash, semantics_fingerprint: _fingerprint, ...baselineInput } = baseline;
  const result = freezeRunManifest({
    ...baselineInput,
    manifest_id: manifestId,
    frozen_at: frozenAt,
    model: { ...candidate, role: "CANDIDATE" },
  });
  if (result.semantics_fingerprint !== baseline.semantics_fingerprint) throw new Error("Candidate manifest changed the baseline evaluation semantics");
  return result;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

/** Wilson interval for a binomial proportion; no normality claim is made. */
export function wilsonInterval(successes: number, trials: number, z = 1.959963984540054): readonly [number, number] | null {
  if (!Number.isInteger(successes) || !Number.isInteger(trials) || trials <= 0 || successes < 0 || successes > trials || !Number.isFinite(z) || z <= 0) return null;
  const p = successes / trials;
  const z2 = z * z;
  const denominator = 1 + z2 / trials;
  const center = (p + z2 / (2 * trials)) / denominator;
  const margin = (z / denominator) * Math.sqrt((p * (1 - p) / trials) + (z2 / (4 * trials * trials)));
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

function confusion(cases: readonly DrCompetitionCase[], actual: (item: DrCompetitionCase) => boolean, predicted: (item: DrCompetitionCase) => boolean): DrConfusionMatrix {
  let tp = 0; let fp = 0; let tn = 0; let fn = 0;
  for (const item of cases) {
    const truth = actual(item); const pred = predicted(item);
    if (truth && pred) tp += 1;
    else if (!truth && pred) fp += 1;
    else if (!truth && !pred) tn += 1;
    else fn += 1;
  }
  return { tp, fp, tn, fn };
}

function auroc(cases: readonly DrCompetitionCase[]): number | null {
  const scored = cases.filter((item) => item.model_score !== null) as Array<DrCompetitionCase & { model_score: number }>;
  if (scored.length !== cases.length) return null;
  const positives = scored.filter((item) => item.ground_truth_grade >= DR_REFERABLE_THRESHOLD_GRADE);
  const negatives = scored.filter((item) => item.ground_truth_grade < DR_REFERABLE_THRESHOLD_GRADE);
  if (positives.length === 0 || negatives.length === 0) return null;
  scored.sort((a, b) => a.model_score - b.model_score);
  let rankSum = 0;
  for (let start = 0; start < scored.length;) {
    let end = start;
    while (end + 1 < scored.length && scored[end + 1].model_score === scored[start].model_score) end += 1;
    const midrank = (start + end + 2) / 2;
    for (let i = start; i <= end; i += 1) if (scored[i].ground_truth_grade >= DR_REFERABLE_THRESHOLD_GRADE) rankSum += midrank;
    start = end + 1;
  }
  return (rankSum - (positives.length * (positives.length + 1)) / 2) / (positives.length * negatives.length);
}

function auprc(cases: readonly DrCompetitionCase[]): number | null {
  const scored = cases.filter((item) => item.model_score !== null) as Array<DrCompetitionCase & { model_score: number }>;
  if (scored.length !== cases.length) return null;
  const positiveCount = scored.filter((item) => item.ground_truth_grade >= DR_REFERABLE_THRESHOLD_GRADE).length;
  if (positiveCount === 0 || positiveCount === scored.length) return null;
  scored.sort((a, b) => b.model_score - a.model_score);
  let tp = 0; let fp = 0; let previousRecall = 0; let area = 0;
  for (const item of scored) {
    if (item.ground_truth_grade >= DR_REFERABLE_THRESHOLD_GRADE) tp += 1; else fp += 1;
    const recall = tp / positiveCount;
    area += (tp / (tp + fp)) * (recall - previousRecall);
    previousRecall = recall;
  }
  return area;
}

function multiclassConfusion(cases: readonly DrCompetitionCase[]): Record<string, Record<string, number>> {
  const matrix = Object.fromEntries(DR_COMPETITION_LABELS.map((truth) => [truth, Object.fromEntries(DR_COMPETITION_LABELS.map((pred) => [pred, 0]))]));
  for (const item of cases) matrix[String(item.ground_truth_grade)][String(item.predicted_grade)] += 1;
  return matrix;
}

function quadraticWeightedKappa(cases: readonly DrCompetitionCase[], matrix: Record<string, Record<string, number>>): number | null {
  if (cases.length === 0) return null;
  const truthTotals = Object.fromEntries(DR_COMPETITION_LABELS.map((label) => [label, 0]));
  const predictedTotals = Object.fromEntries(DR_COMPETITION_LABELS.map((label) => [label, 0]));
  for (const item of cases) { truthTotals[String(item.ground_truth_grade)] += 1; predictedTotals[String(item.predicted_grade)] += 1; }
  const maxIndex = DR_COMPETITION_LABELS.length - 1;
  let observed = 0; let expected = 0;
  for (let i = 0; i < DR_COMPETITION_LABELS.length; i += 1) for (let j = 0; j < DR_COMPETITION_LABELS.length; j += 1) {
    const weight = ((i - j) / maxIndex) ** 2;
    observed += weight * (matrix[String(i)][String(j)] / cases.length);
    expected += weight * ((truthTotals[String(i)] * predictedTotals[String(j)]) / (cases.length * cases.length));
  }
  return expected === 0 ? null : 1 - observed / expected;
}

function metricValues(cases: readonly DrCompetitionCase[]): DrCompetitionMetrics {
  const matrix = multiclassConfusion(cases);
  let correct = 0;
  const recalls: number[] = []; const f1s: number[] = [];
  for (const label of DR_COMPETITION_LABELS) {
    const tp = matrix[label][label];
    const fn = DR_COMPETITION_LABELS.reduce((sum, other) => sum + (other === label ? 0 : matrix[label][other]), 0);
    const fp = DR_COMPETITION_LABELS.reduce((sum, other) => sum + (other === label ? 0 : matrix[other][label]), 0);
    correct += tp;
    const sensitivity = ratio(tp, tp + fn);
    const f1 = ratio(2 * tp, 2 * tp + fp + fn);
    if (sensitivity !== null) recalls.push(sensitivity);
    if (f1 !== null) f1s.push(f1);
  }
  const referable = confusion(cases, (item) => item.ground_truth_grade >= DR_REFERABLE_THRESHOLD_GRADE, (item) => item.predicted_grade >= DR_REFERABLE_THRESHOLD_GRADE);
  return {
    sample_count: cases.length,
    multiclass: {
      accuracy: correct / cases.length,
      balanced_accuracy: recalls.reduce((sum, value) => sum + value, 0) / recalls.length,
      macro_f1: f1s.reduce((sum, value) => sum + value, 0) / f1s.length,
      quadratic_weighted_kappa: quadraticWeightedKappa(cases, matrix),
      confusion_true_x_pred: matrix,
    },
    referable: {
      confusion: referable,
      sensitivity: ratio(referable.tp, referable.tp + referable.fn),
      specificity: ratio(referable.tn, referable.tn + referable.fp),
      ppv: ratio(referable.tp, referable.tp + referable.fp),
      npv: ratio(referable.tn, referable.tn + referable.fn),
      fpr: ratio(referable.fp, referable.fp + referable.tn),
      fnr: ratio(referable.fn, referable.fn + referable.tp),
      auroc: auroc(cases),
      auprc: auprc(cases),
    },
    confidence_intervals: {
      method: "WILSON_95_PERCENT",
      referable: {
        sensitivity: wilsonInterval(referable.tp, referable.tp + referable.fn),
        specificity: wilsonInterval(referable.tn, referable.tn + referable.fp),
        ppv: wilsonInterval(referable.tp, referable.tp + referable.fp),
        npv: wilsonInterval(referable.tn, referable.tn + referable.fn),
      },
    },
  };
}

export function computeDrCompetitionMetrics(cases: readonly DrCompetitionCase[]): DrCompetitionMetrics {
  if (cases.length === 0) throw new Error("Cannot measure an empty DR competition case set");
  const ids = new Set<string>();
  for (const [index, item] of cases.entries()) {
    if (!item || typeof item.case_id !== "string" || !NON_EMPTY.test(item.case_id)) throw new Error(`cases[${index}].case_id must be non-empty`);
    if (ids.has(item.case_id)) throw new Error(`Duplicate competition case_id: ${item.case_id}`);
    ids.add(item.case_id);
    if (![0, 1, 2, 3, 4].includes(item.ground_truth_grade) || ![0, 1, 2, 3, 4].includes(item.predicted_grade)) throw new Error(`cases[${index}] grade must be an integer in 0..4`);
    if (item.model_score !== null && (typeof item.model_score !== "number" || !Number.isFinite(item.model_score))) throw new Error(`cases[${index}].model_score must be finite or null`);
  }
  return metricValues(cases);
}

export function measuredResultFromCases(input: {
  readonly manifest: DrCompetitionRunManifest;
  readonly result_id: string;
  readonly cases: readonly DrCompetitionCase[];
  readonly evidence: readonly CompetitionEvidenceRef[];
  readonly limitations?: readonly string[];
}): DrCompetitionRunResult {
  if (input.cases.length !== input.manifest.dataset.case_count) throw new Error(`Case count ${input.cases.length} does not match frozen dataset count ${input.manifest.dataset.case_count}`);
  if (input.evidence.length === 0) throw new Error("A measured result requires at least one evidence reference");
  const metrics = computeDrCompetitionMetrics(input.cases);
  const limitations = [...input.manifest.limitations, ...(input.limitations ?? [])];
  if (input.cases.some((item) => item.model_score === null)) limitations.push("A finite continuous model score is not available for every row; AUROC and AUPRC are reported as unmeasured.");
  return withResultHash({
    format: DR_COMPETITION_RESULT_FORMAT,
    result_id: input.result_id,
    manifest_id: input.manifest.manifest_id,
    manifest_sha256: input.manifest.manifest_sha256,
    semantics_fingerprint: input.manifest.semantics_fingerprint,
    measurement_state: "MEASURED",
    calculation_method: "RECOMPUTED_FROM_CASES",
    model: input.manifest.model,
    metrics,
    evidence: [...input.evidence],
    limitations,
  });
}

export function notMeasuredResult(input: {
  readonly manifest: DrCompetitionRunManifest;
  readonly result_id: string;
  readonly limitations: readonly string[];
  readonly evidence?: readonly CompetitionEvidenceRef[];
}): DrCompetitionRunResult {
  if (input.limitations.length === 0) throw new Error("An unmeasured result requires an explicit limitation");
  return withResultHash({
    format: DR_COMPETITION_RESULT_FORMAT,
    result_id: input.result_id,
    manifest_id: input.manifest.manifest_id,
    manifest_sha256: input.manifest.manifest_sha256,
    semantics_fingerprint: input.manifest.semantics_fingerprint,
    measurement_state: "NOT_MEASURED",
    calculation_method: "NO_MEASUREMENT_AVAILABLE",
    model: input.manifest.model,
    metrics: null,
    evidence: [...(input.evidence ?? [])],
    limitations: [...input.limitations],
  });
}

function validUnitMetric(value: unknown): boolean {
  return value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1);
}

function validateEvidence(value: unknown, path: string, errors: string[], required: boolean): void {
  if (!Array.isArray(value)) { errors.push(`${path} must be an array`); return; }
  if (required && value.length === 0) errors.push(`${path} must contain at least one evidence reference`);
  const ids = new Set<string>();
  for (const [index, ref] of value.entries()) {
    if (!isRecord(ref)) { errors.push(`${path}[${index}] must be an object`); continue; }
    for (const key of ["id", "path", "sha256", "role"]) assertText(ref[key], `${path}[${index}].${key}`, errors);
    if (typeof ref.id === "string" && ids.has(ref.id)) errors.push(`${path} contains duplicate evidence id ${ref.id}`);
    if (typeof ref.id === "string") ids.add(ref.id);
    if (typeof ref.sha256 === "string" && !SHA256.test(ref.sha256)) errors.push(`${path}[${index}].sha256 must be SHA-256`);
    if (!["dataset_export", "validation_summary", "model_manifest", "preprocessing_implementation", "result_source"].includes(String(ref.role))) errors.push(`${path}[${index}].role is invalid`);
  }
}

function validateModelRef(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) { errors.push(`${path} must be an object`); return; }
  if (value.role !== "BASELINE" && value.role !== "CANDIDATE") errors.push(`${path}.role is invalid`);
  for (const key of ["model_id", "model_version", "artifact_path", "artifact_sha256", "artifact_format"]) assertText(value[key], `${path}.${key}`, errors);
  if (typeof value.artifact_sha256 === "string" && !SHA256.test(value.artifact_sha256)) errors.push(`${path}.artifact_sha256 must be SHA-256`);
}

function validateConfusion(value: unknown, path: string, errors: string[]): value is DrConfusionMatrix {
  if (!isRecord(value)) { errors.push(`${path} must be an object`); return false; }
  for (const key of ["tp", "fp", "tn", "fn"]) {
    assertFinite(value[key], `${path}.${key}`, errors);
    if (typeof value[key] === "number" && (!Number.isInteger(value[key]) || value[key] < 0)) errors.push(`${path}.${key} must be a non-negative integer`);
  }
  return errors.length === 0;
}

function validateMetrics(value: unknown, errors: string[]): value is DrCompetitionMetrics {
  if (!isRecord(value)) { errors.push("metrics must be an object"); return false; }
  assertFinite(value.sample_count, "metrics.sample_count", errors);
  if (typeof value.sample_count === "number" && (!Number.isInteger(value.sample_count) || value.sample_count <= 0)) errors.push("metrics.sample_count must be a positive integer");
  const multi = value.multiclass;
  if (!isRecord(multi)) errors.push("metrics.multiclass must be an object");
  else {
    for (const key of ["accuracy", "balanced_accuracy", "macro_f1"]) if (!validUnitMetric(multi[key])) errors.push(`metrics.multiclass.${key} must be in [0,1] or null`);
    if (!(multi.quadratic_weighted_kappa === null || (typeof multi.quadratic_weighted_kappa === "number" && Number.isFinite(multi.quadratic_weighted_kappa) && multi.quadratic_weighted_kappa >= -1 && multi.quadratic_weighted_kappa <= 1))) errors.push("metrics.multiclass.quadratic_weighted_kappa must be in [-1,1] or null");
    if (!isRecord(multi.confusion_true_x_pred)) errors.push("metrics.multiclass.confusion_true_x_pred must be an object");
  }
  const ref = value.referable;
  if (!isRecord(ref)) errors.push("metrics.referable must be an object");
  else {
    validateConfusion(ref.confusion, "metrics.referable.confusion", errors);
    for (const key of ["sensitivity", "specificity", "ppv", "npv", "fpr", "fnr", "auroc", "auprc"]) if (!validUnitMetric(ref[key])) errors.push(`metrics.referable.${key} must be in [0,1] or null`);
  }
  const intervals = value.confidence_intervals;
  if (!isRecord(intervals) || intervals.method !== "WILSON_95_PERCENT" || !isRecord(intervals.referable)) errors.push("metrics.confidence_intervals must declare WILSON_95_PERCENT intervals");
  else for (const key of ["sensitivity", "specificity", "ppv", "npv"]) {
    const interval = intervals.referable[key];
    if (!(interval === null || (Array.isArray(interval) && interval.length === 2 && interval.every((item) => typeof item === "number" && Number.isFinite(item) && item >= 0 && item <= 1) && interval[0] <= interval[1]))) errors.push(`metrics.confidence_intervals.referable.${key} must be an ordered [0,1] pair or null`);
  }
  return errors.length === 0;
}

export interface ContractValidation { readonly valid: boolean; readonly errors: readonly string[]; }

export function validateRunManifest(value: unknown): ContractValidation {
  const errors: string[] = [];
  if (!isRecord(value)) return { valid: false, errors: ["manifest must be an object"] };
  if (value.format !== DR_COMPETITION_MANIFEST_FORMAT) errors.push("format is not the DR competition manifest format");
  for (const key of ["manifest_id", "frozen_at", "semantics_fingerprint", "manifest_sha256"]) assertText(value[key], key, errors);
  if (value.state !== "FROZEN") errors.push("state must be FROZEN");
  if (typeof value.manifest_sha256 === "string") {
    if (!SHA256.test(value.manifest_sha256)) errors.push("manifest_sha256 must be SHA-256");
    else if (sha256Canonical(withoutHash(value, "manifest_sha256")) !== value.manifest_sha256) errors.push("manifest_sha256 does not match canonical manifest content");
  }
  if (!isRecord(value.task) || value.task.target !== "ICDR_DR_GRADE" || value.task.modality !== "FUNDUS" || value.task.referable_threshold_grade !== 2 || value.task.grade_rule !== "ROUND_CLAMP_0_4" || value.task.score_semantics !== "MODEL_SCORE_NOT_CALIBRATED" || value.task.calibration !== "NOT_MEASURED") errors.push("task semantics are incomplete or unsafe");
  if (!isRecord(value.dataset) || value.dataset.split !== "regular-fundus-validation" || typeof value.dataset.case_count !== "number" || !Number.isInteger(value.dataset.case_count) || value.dataset.case_count <= 0 || (value.dataset.patient_count !== null && (typeof value.dataset.patient_count !== "number" || !Number.isInteger(value.dataset.patient_count) || value.dataset.patient_count <= 0)) || value.dataset.patient_separation !== "PATIENT_SEPARATED_CONFIRMED") errors.push("dataset semantics are incomplete or unsafe");
  if (!isRecord(value.preprocessing) || value.preprocessing.version !== "clementp-dr-source-pinned-512-v1" || value.preprocessing.input_shape !== "3x512x512") errors.push("preprocessing semantics are incomplete or changed");
  if (!isRecord(value.protocol) || value.protocol.ground_truth_field !== "eye_grade" || value.protocol.prediction_field !== "dr_grade" || value.protocol.score_field !== "dr_logit") errors.push("protocol field semantics are incomplete");
  validateModelRef(value.model, "model", errors);
  validateEvidence(value.evidence, "evidence", errors, true);
  if (!Array.isArray(value.limitations) || value.limitations.length === 0 || value.limitations.some((item) => typeof item !== "string" || !NON_EMPTY.test(item))) errors.push("limitations must contain explicit non-empty strings");
  if (typeof value.semantics_fingerprint === "string" && isRecord(value.task) && isRecord(value.dataset) && isRecord(value.preprocessing) && isRecord(value.protocol) && semanticsFingerprint(value as Pick<DrCompetitionRunManifest, "task" | "dataset" | "preprocessing" | "protocol">) !== value.semantics_fingerprint) errors.push("semantics_fingerprint does not match task/dataset/preprocessing/protocol");
  return { valid: errors.length === 0, errors };
}

export function validateRunResult(value: unknown): ContractValidation {
  const errors: string[] = [];
  if (!isRecord(value)) return { valid: false, errors: ["result must be an object"] };
  if (value.format !== DR_COMPETITION_RESULT_FORMAT) errors.push("format is not the DR competition result format");
  for (const key of ["result_id", "manifest_id", "manifest_sha256", "semantics_fingerprint", "result_sha256"]) assertText(value[key], key, errors);
  if (!["MEASURED", "NOT_MEASURED", "PARTIAL", "REJECTED"].includes(String(value.measurement_state))) errors.push("measurement_state is invalid");
  if (!["COPIED_FROM_EXISTING_EVIDENCE_SUMMARY", "RECOMPUTED_FROM_CASES", "NO_MEASUREMENT_AVAILABLE"].includes(String(value.calculation_method))) errors.push("calculation_method is invalid");
  if (typeof value.manifest_sha256 === "string" && !SHA256.test(value.manifest_sha256)) errors.push("manifest_sha256 must be SHA-256");
  if (typeof value.semantics_fingerprint === "string" && !SHA256.test(value.semantics_fingerprint)) errors.push("semantics_fingerprint must be SHA-256");
  if (typeof value.result_sha256 === "string") {
    if (!SHA256.test(value.result_sha256)) errors.push("result_sha256 must be SHA-256");
    else if (sha256Canonical(withoutHash(value, "result_sha256")) !== value.result_sha256) errors.push("result_sha256 does not match canonical result content");
  }
  validateModelRef(value.model, "result.model", errors);
  if (value.measurement_state === "MEASURED") {
    if (value.metrics === null) errors.push("a MEASURED result must contain metrics");
    else {
      validateMetrics(value.metrics, errors);
      if (isRecord(value.metrics) && isRecord(value.metrics.referable) && isRecord(value.metrics.referable.confusion)) {
        const cm = value.metrics.referable.confusion;
        const counts = [cm.tp, cm.fp, cm.tn, cm.fn];
        if (counts.every((count) => typeof count === "number") && (counts as number[]).reduce((sum, count) => sum + count, 0) !== value.metrics.sample_count) errors.push("referable confusion counts must sum to metrics.sample_count");
      }
    }
  } else if (value.metrics !== null) errors.push("an unmeasured result must not contain metrics");
  if (!Array.isArray(value.limitations) || value.limitations.length === 0 || value.limitations.some((item) => typeof item !== "string" || !NON_EMPTY.test(item))) errors.push("result limitations must be explicit and non-empty");
  validateEvidence(value.evidence, "result.evidence", errors, value.measurement_state === "MEASURED");
  return { valid: errors.length === 0, errors };
}

function resultMetricValues(metrics: DrCompetitionMetrics): Array<[string, number | null]> {
  return [
    ["referable.sensitivity", metrics.referable.sensitivity],
    ["referable.specificity", metrics.referable.specificity],
    ["referable.ppv", metrics.referable.ppv],
    ["referable.npv", metrics.referable.npv],
    ["referable.auroc", metrics.referable.auroc],
    ["referable.auprc", metrics.referable.auprc],
    ["multiclass.accuracy", metrics.multiclass.accuracy],
    ["multiclass.balanced_accuracy", metrics.multiclass.balanced_accuracy],
    ["multiclass.macro_f1", metrics.multiclass.macro_f1],
    ["multiclass.quadratic_weighted_kappa", metrics.multiclass.quadratic_weighted_kappa],
  ];
}

export function compareDrCompetitionResults(baseline: DrCompetitionRunResult, candidate: DrCompetitionRunResult): DrCompetitionComparison {
  const reasons: string[] = [];
  const baselineValidation = validateRunResult(baseline);
  const candidateValidation = validateRunResult(candidate);
  if (!baselineValidation.valid) reasons.push(`Baseline result invalid: ${baselineValidation.errors.join("; ")}`);
  if (!candidateValidation.valid) reasons.push(`Candidate result invalid: ${candidateValidation.errors.join("; ")}`);
  if (baseline.semantics_fingerprint !== candidate.semantics_fingerprint) reasons.push("Dataset, preprocessing, task, or protocol semantics differ; results are not comparable.");
  if (baseline.measurement_state !== "MEASURED") reasons.push("Baseline has no complete measured result.");
  if (candidate.measurement_state !== "MEASURED") reasons.push("Candidate has no complete measured result; no candidate metric is inferred.");
  if (baseline.metrics && candidate.metrics && baseline.metrics.sample_count !== candidate.metrics.sample_count) reasons.push("Measured case counts differ; results are not comparable.");
  const deltas: DrCompetitionMetricDelta[] = [];
  if (baseline.metrics && candidate.metrics) {
    const baselineValues = resultMetricValues(baseline.metrics);
    const candidateValues = resultMetricValues(candidate.metrics);
    for (let i = 0; i < baselineValues.length; i += 1) {
      const [metric, base] = baselineValues[i]; const candidateValue = candidateValues[i][1];
      deltas.push({ metric, baseline: base, candidate: candidateValue, candidate_minus_baseline: base === null || candidateValue === null ? null : candidateValue - base });
    }
  }
  const status = reasons.length === 0 ? "COMPARABLE" : "BLOCKED";
  return deepFreeze({
    status,
    baseline_result_id: baseline.result_id,
    candidate_result_id: candidate.result_id,
    baseline_model_id: baseline.model.model_id,
    candidate_model_id: candidate.model.model_id,
    metric_deltas: deltas,
    reasons,
    limitations: [
      "Comparison is research evidence only; it does not promote a model or establish clinical validity.",
      ...(candidate.limitations ?? []),
    ],
  });
}
