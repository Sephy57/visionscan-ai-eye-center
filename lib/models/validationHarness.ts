/**
 * S6 — Model evaluation / validation harness.
 *
 * INFRASTRUCTURE ONLY. This module is pure and deterministic: no I/O, no
 * network access, no filesystem access, no dependency on the model registry,
 * pipeline, or any specific model (real or demo). It operates exclusively on
 * caller-supplied `LabeledPrediction[]` arrays.
 *
 * HARD RULE: nothing in this file computes, stores, or implies a metric for
 * the DEMO model, any CANDIDATE_ONLY dossier (see candidateDossiers.ts), or
 * any other specific model. It is a general-purpose evaluation calculator
 * that a future, explicitly authorized evaluation run could call with real
 * predictions/labels. Calling this module with zero arguments proves
 * nothing about any model; it is not wired into the pipeline, the registry,
 * or any API route.
 *
 * Metric vocabulary (sensitivity/specificity/ppv/npv/auroc/auprc/calibration/
 * evidence_reference) intentionally mirrors `PerformanceMetrics` in
 * lib/models/registry.ts and the evidence expectations in
 * lib/models/transitions.ts, so a caller can map this harness's output onto
 * a registry record or an evidence submission without renaming fields.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LabeledPrediction {
  case_id: string;
  patient_id: string;
  predicted: boolean;
  actual: boolean;
  predicted_score?: number;
  subgroup?: Record<string, string>;
  device?: string;
  laterality?: "OD" | "OS" | "OU" | "UNKNOWN";
}

export interface ValidationMetrics {
  n: number;
  tp: number;
  fp: number;
  tn: number;
  fn: number;
  sensitivity: number | null; // tp / (tp + fn); null if denominator is 0
  specificity: number | null; // tn / (tn + fp); null if denominator is 0
  ppv: number | null;         // tp / (tp + fp); null if denominator is 0
  npv: number | null;         // tn / (tn + fn); null if denominator is 0
  auroc: number | null;       // only computed when every case has predicted_score
  auprc: number | null;       // only computed when every case has predicted_score
  ece: number | null;         // expected calibration error; requires probability-like scores in [0,1]
  brier_score: number | null; // mean squared probability error; requires scores in [0,1]
}

// ---------------------------------------------------------------------------
// Core confusion-matrix metrics
// ---------------------------------------------------------------------------

function safeDivide(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return numerator / denominator;
}

function allHaveScores(cases: LabeledPrediction[]): boolean {
  return cases.length > 0 && cases.every((c) => typeof c.predicted_score === "number" && Number.isFinite(c.predicted_score));
}

function allHaveProbabilityScores(cases: LabeledPrediction[]): boolean {
  return allHaveScores(cases) && cases.every((c) => (c.predicted_score as number) >= 0 && (c.predicted_score as number) <= 1);
}

export function computeValidationMetrics(cases: LabeledPrediction[]): ValidationMetrics {
  let tp = 0, fp = 0, tn = 0, fn = 0;
  for (const c of cases) {
    if (c.predicted && c.actual) tp++;
    else if (c.predicted && !c.actual) fp++;
    else if (!c.predicted && !c.actual) tn++;
    else fn++;
  }

  const sensitivity = safeDivide(tp, tp + fn);
  const specificity = safeDivide(tn, tn + fp);
  const ppv = safeDivide(tp, tp + fp);
  const npv = safeDivide(tn, tn + fn);

  const auroc = allHaveScores(cases) ? computeAUROC(cases) : null;
  const auprc = allHaveScores(cases) ? computeAUPRC(cases) : null;
  const ece = allHaveProbabilityScores(cases) ? computeECE(cases) : null;
  const brier_score = allHaveProbabilityScores(cases) ? computeBrierScore(cases) : null;

  return { n: cases.length, tp, fp, tn, fn, sensitivity, specificity, ppv, npv, auroc, auprc, ece, brier_score };
}

/**
 * Expected calibration error using ten equal-width probability bins.
 * Returns null unless every case has a finite probability-like score in [0,1].
 * This is descriptive validation evidence only; it never promotes a model.
 */
export function computeECE(cases: LabeledPrediction[], binCount = 10): number | null {
  if (!allHaveProbabilityScores(cases) || !Number.isInteger(binCount) || binCount < 2) return null;
  const bins = Array.from({ length: binCount }, () => ({ score: 0, actual: 0, n: 0 }));
  for (const c of cases) {
    const score = c.predicted_score as number;
    const index = Math.min(binCount - 1, Math.floor(score * binCount));
    bins[index].score += score;
    bins[index].actual += c.actual ? 1 : 0;
    bins[index].n++;
  }
  let ece = 0;
  for (const bin of bins) {
    if (bin.n === 0) continue;
    ece += (bin.n / cases.length) * Math.abs(bin.score / bin.n - bin.actual / bin.n);
  }
  return Math.round(ece * 10000) / 10000;
}

/** Brier score for binary outcomes: lower is better; null means no valid probabilities. */
export function computeBrierScore(cases: LabeledPrediction[]): number | null {
  if (!allHaveProbabilityScores(cases)) return null;
  const score = cases.reduce((sum, c) => {
    const error = (c.predicted_score as number) - (c.actual ? 1 : 0);
    return sum + error * error;
  }, 0) / cases.length;
  return Math.round(score * 10000) / 10000;
}

// ---------------------------------------------------------------------------
// AUROC — rank-sum (Mann-Whitney U) formulation.
//
//   AUROC = (sum of ranks of positive-labeled scores - nPos*(nPos+1)/2)
//           / (nPos * nNeg)
//
// where ranks are assigned over ALL scores ascending, 1-indexed, and tied
// scores share the AVERAGE of the ranks they span. This is mathematically
// equivalent to (and cross-checked in tests against) the pairwise-concordance
// definition: AUROC = P(score_pos > score_neg) + 0.5*P(score_pos == score_neg),
// averaged over all positive/negative pairs.
// ---------------------------------------------------------------------------

export function computeAUROC(cases: LabeledPrediction[]): number | null {
  if (!allHaveScores(cases)) return null;
  const pos = cases.filter((c) => c.actual);
  const neg = cases.filter((c) => !c.actual);
  if (pos.length === 0 || neg.length === 0) return null;

  const withScore = cases.map((c) => ({ score: c.predicted_score as number, actual: c.actual }));
  const sorted = [...withScore].sort((a, b) => a.score - b.score);

  // Assign average ranks (1-indexed) to handle ties correctly.
  const ranks = new Array<number>(sorted.length);
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1].score === sorted[i].score) j++;
    const avgRank = (i + 1 + j + 1) / 2; // 1-indexed average of positions i..j
    for (let k = i; k <= j; k++) ranks[k] = avgRank;
    i = j + 1;
  }

  let sumRanksPos = 0;
  for (let k = 0; k < sorted.length; k++) {
    if (sorted[k].actual) sumRanksPos += ranks[k];
  }

  const nPos = pos.length;
  const nNeg = neg.length;
  const auroc = (sumRanksPos - (nPos * (nPos + 1)) / 2) / (nPos * nNeg);
  return auroc;
}

// ---------------------------------------------------------------------------
// AUPRC — trapezoidal integration over the precision-recall curve.
//
// Cases are grouped by distinct score value (descending). After including
// each group of equal-score cases as "predicted positive" (threshold at that
// score), we compute a (recall, precision) point. The curve starts at
// (recall=0, precision=1) by convention and is integrated with the standard
// trapezoidal rule.
// ---------------------------------------------------------------------------

export function computeAUPRC(cases: LabeledPrediction[]): number | null {
  if (!allHaveScores(cases)) return null;
  const totalPos = cases.filter((c) => c.actual).length;
  if (totalPos === 0) return null;

  const sorted = [...cases].sort((a, b) => (b.predicted_score as number) - (a.predicted_score as number));

  const points: { recall: number; precision: number }[] = [{ recall: 0, precision: 1 }];
  let tp = 0;
  let fp = 0;
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1].predicted_score === sorted[i].predicted_score) j++;
    for (let k = i; k <= j; k++) {
      if (sorted[k].actual) tp++;
      else fp++;
    }
    points.push({ recall: tp / totalPos, precision: tp / (tp + fp) });
    i = j + 1;
  }

  let area = 0;
  for (let k = 1; k < points.length; k++) {
    const dRecall = points[k].recall - points[k - 1].recall;
    area += dRecall * (points[k].precision + points[k - 1].precision) / 2;
  }
  return area;
}

// ---------------------------------------------------------------------------
// Patient-level split leakage detector.
//
// Guards against the exact leakage bug called out for real-model
// authorization: splitting individual images/cases from the SAME patient
// across train and test sets, which inflates apparent performance.
// ---------------------------------------------------------------------------

export interface PatientLevelSeparationResult {
  separated: boolean;
  overlapping_patient_ids: string[];
}

export function checkPatientLevelSeparation(
  train: LabeledPrediction[],
  test: LabeledPrediction[]
): PatientLevelSeparationResult {
  const trainIds = new Set(train.map((c) => c.patient_id));
  const testIds = new Set(test.map((c) => c.patient_id));
  const overlap = new Set<string>();
  for (const id of testIds) {
    if (trainIds.has(id)) overlap.add(id);
  }
  const overlapping_patient_ids = Array.from(overlap).sort();
  return { separated: overlapping_patient_ids.length === 0, overlapping_patient_ids };
}

// ---------------------------------------------------------------------------
// Subgroup breakdown (device / demographic / laterality / any caller-defined
// subgroup key). Cases missing a value for the key go into an explicit
// "unknown" bucket — never silently dropped.
// ---------------------------------------------------------------------------

export function computeSubgroupBreakdown(
  cases: LabeledPrediction[],
  subgroupKey: string
): Record<string, ValidationMetrics> {
  const groups = new Map<string, LabeledPrediction[]>();
  for (const c of cases) {
    const value = c.subgroup?.[subgroupKey] ?? "unknown";
    const bucket = groups.get(value);
    if (bucket) bucket.push(c);
    else groups.set(value, [c]);
  }
  const result: Record<string, ValidationMetrics> = {};
  for (const [key, groupCases] of groups.entries()) {
    result[key] = computeValidationMetrics(groupCases);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Readiness checklist.
//
// NOT a clinical-validation certifier. This is a mechanical checklist that
// flags MISSING evidence a status transition (see lib/models/transitions.ts
// TRANSITION_REQUIREMENTS) would need; it cannot and does not assess clinical
// safety, generalizability, or correctness of a study design. A `ready: true`
// result means only "the checklist below found no missing item it checks
// for" — it is not a substitute for expert/regulatory review.
// ---------------------------------------------------------------------------

export interface ReadinessAssessment {
  ready: boolean;
  blockers: string[];
}

const MIN_SAMPLE_SIZE = 30;

export function assessReadinessForStatusTransition(
  metrics: ValidationMetrics,
  opts: { hasPatientLevelSplit: boolean; hasExternalValidation: boolean; sampleSize: number }
): ReadinessAssessment {
  const blockers: string[] = [];

  if (metrics.n === 0 || opts.sampleSize === 0) {
    blockers.push("no cases evaluated (n = 0)");
  } else if (opts.sampleSize < MIN_SAMPLE_SIZE) {
    blockers.push(`sample size below ${MIN_SAMPLE_SIZE} cases (got ${opts.sampleSize})`);
  }

  if (metrics.sensitivity === null || metrics.specificity === null) {
    blockers.push(
      "sensitivity or specificity cannot be computed - degenerate label distribution (sample contains only one label, so tp+fn or tn+fp is 0)"
    );
  }

  if (!opts.hasPatientLevelSplit) {
    blockers.push("no patient-level split confirmed (risk of same-patient leakage between train/test)");
  }

  if (!opts.hasExternalValidation) {
    blockers.push("no external validation performed");
  }

  return { ready: blockers.length === 0, blockers };
}
