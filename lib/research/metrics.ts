/**
 * Performance evaluation tooling (research-only).
 * Computes sensitivity, specificity, PPV, NPV, AUROC, AUPRC, confusion matrix,
 * calibration (ECE + bins), FPR/FNR, and subgroup breakdowns.
 * NEVER reports "accuracy" alone; safety-critical conditions prioritize
 * sensitivity and clinically appropriate NPV.
 */

export interface BinaryCase {
  case_id: string;
  y_true: 0 | 1;                 // reference standard
  y_pred: 0 | 1;                 // binarized model output at operating point
  score?: number;                // continuous model score for AUROC/AUPRC/calibration
  subgroup?: string;             // e.g. device id, modality, quality band
  with_symptoms?: boolean;       // whether symptom context was part of the model input for this case
  symptom_category?: string;     // e.g. "visual", "retinal_vitreous" for symptom-stratified analysis
}

export interface ConfusionMatrix {
  tp: number; fp: number; tn: number; fn: number;
}

export interface GroupMetrics {
  group: string;
  n: number;
  sensitivity: number | null;
  specificity: number | null;
  ppv: number | null;
  npv: number | null;
  fpr: number | null;
  fnr: number | null;
}

export interface EvaluationReport {
  n: number;
  confusion: ConfusionMatrix;
  sensitivity: number | null;
  specificity: number | null;
  ppv: number | null;
  npv: number | null;
  fpr: number | null;
  fnr: number | null;
  auroc: number | null;
  auprc: number | null;
  ece: number | null;            // expected calibration error
  calibration_bins: Array<{ bin: string; predicted_mean: number; observed_frequency: number; count: number }> | null;
  subgroups: GroupMetrics[];
  notes: string[];
}

export function confusion(cases: BinaryCase[]): ConfusionMatrix {
  let tp = 0, fp = 0, tn = 0, fn = 0;
  for (const c of cases) {
    if (c.y_true === 1 && c.y_pred === 1) tp++;
    else if (c.y_true === 0 && c.y_pred === 1) fp++;
    else if (c.y_true === 0 && c.y_pred === 0) tn++;
    else fn++;
  }
  return { tp, fp, tn, fn };
}

function ratio(num: number, den: number): number | null {
  return den === 0 ? null : num / den;
}

export function basicMetrics(cases: BinaryCase[]): Omit<EvaluationReport, "auroc" | "auprc" | "ece" | "calibration_bins" | "subgroups" | "notes"> {
  const cm = confusion(cases);
  const n = cases.length;
  return {
    n,
    confusion: cm,
    sensitivity: ratio(cm.tp, cm.tp + cm.fn),
    specificity: ratio(cm.tn, cm.tn + cm.fp),
    ppv: ratio(cm.tp, cm.tp + cm.fp),
    npv: ratio(cm.tn, cm.tn + cm.fn),
    fpr: ratio(cm.fp, cm.fp + cm.tn),
    fnr: ratio(cm.fn, cm.fn + cm.tp),
  };
}

/** Rank-based AUROC with tie handling. Returns null when only one class present. */
export function auroc(cases: BinaryCase[]): number | null {
  const scored = cases.filter((c) => typeof c.score === "number") as Array<BinaryCase & { score: number }>;
  const pos = scored.filter((c) => c.y_true === 1);
  const neg = scored.filter((c) => c.y_true === 0);
  if (pos.length === 0 || neg.length === 0) return null;

  scored.sort((a, b) => a.score - b.score);
  // Midrank assignment
  const ranks = new Map<string, number>();
  let i = 0;
  while (i < scored.length) {
    let j = i;
    while (j + 1 < scored.length && scored[j + 1].score === scored[i].score) j++;
    const mid = (i + j + 2) / 2; // average of 1-based ranks i+1..j+1
    for (let k = i; k <= j; k++) ranks.set(scored[k].case_id, mid);
    i = j + 1;
  }
  let rankSumPos = 0;
  for (const p of pos) rankSumPos += ranks.get(p.case_id)!;
  const n1 = pos.length, n0 = neg.length;
  return (rankSumPos - (n1 * (n1 + 1)) / 2) / (n1 * n0);
}

/** Average Precision (AUPRC). */
export function auprc(cases: BinaryCase[]): number | null {
  const scored = cases.filter((c) => typeof c.score === "number") as Array<BinaryCase & { score: number }>;
  const pos = scored.filter((c) => c.y_true === 1).length;
  const negTotal = scored.length - pos;
  if (pos === 0 || negTotal === 0) return null;
  scored.sort((a, b) => b.score - a.score);
  let tp = 0, fp = 0, ap = 0, prevRecall = 0;
  for (const c of scored) {
    if (c.y_true === 1) tp++; else fp++;
    const precision = tp / (tp + fp);
    const recall = tp / pos;
    ap += precision * (recall - prevRecall);
    prevRecall = recall;
  }
  return ap;
}

/** Expected calibration error + reliability bins (equal-width, 10 bins). */
export function calibration(cases: BinaryCase[]): { ece: number | null; bins: EvaluationReport["calibration_bins"] } {
  const scored = cases.filter((c) => typeof c.score === "number") as Array<BinaryCase & { score: number }>;
  if (scored.length === 0) return { ece: null, bins: null };
  const NB = 10;
  const bins: Array<{ sumScore: number; sumY: number; count: number }> = Array.from({ length: NB }, () => ({ sumScore: 0, sumY: 0, count: 0 }));
  for (const c of scored) {
    const b = Math.min(NB - 1, Math.floor(c.score * NB));
    bins[b].sumScore += c.score;
    bins[b].sumY += c.y_true;
    bins[b].count++;
  }
  let ece = 0;
  const out: NonNullable<EvaluationReport["calibration_bins"]> = [];
  for (let b = 0; b < NB; b++) {
    const { sumScore, sumY, count } = bins[b];
    if (count === 0) continue;
    const predMean = sumScore / count;
    const obsFreq = sumY / count;
    ece += (count / scored.length) * Math.abs(predMean - obsFreq);
    out.push({ bin: `${(b / NB).toFixed(1)}-${((b + 1) / NB).toFixed(1)}`, predicted_mean: round4(predMean), observed_frequency: round4(obsFreq), count });
  }
  return { ece: round4(ece), bins: out };
}

export function subgroupMetrics(cases: BinaryCase[]): GroupMetrics[] {
  const groups = new Map<string, BinaryCase[]>();
  for (const c of cases) {
    const g = c.subgroup ?? "all";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(c);
  }
  const out: GroupMetrics[] = [];
  for (const [group, cs] of groups) {
    const bm = basicMetrics(cs);
    out.push({
      group,
      n: bm.n,
      sensitivity: bm.sensitivity, specificity: bm.specificity, ppv: bm.ppv, npv: bm.npv,
      fpr: bm.fpr, fnr: bm.fnr,
    });
  }
  return out.sort((a, b) => a.group.localeCompare(b.group));
}

export function evaluate(cases: BinaryCase[]): EvaluationReport {
  const notes: string[] = [
    "Sensitivity, specificity, PPV, NPV, AUROC, AUPRC, and calibration are the primary reporting metrics.",
    "Overall accuracy is deliberately NOT reported as a headline number: a model with high overall accuracy can still be unsafe if it misses rare serious abnormalities.",
    "For vision-threatening conditions, prioritize sensitivity and clinically appropriate NPV.",
    "Subgroup (device/modality/quality) performance must be reviewed before any per-device validation claim.",
  ];
  const bm = basicMetrics(cases);
  const cal = calibration(cases);
  return {
    ...bm,
    auroc: auroc(cases),
    auprc: auprc(cases),
    ece: cal.ece,
    calibration_bins: cal.bins,
    subgroups: subgroupMetrics(cases),
    notes,
  };
}

/**
 * Symptom-stratified evaluation (Phase 3): IMAGE ONLY vs IMAGE + SYMPTOM CONTEXT.
 * Proves experimentally whether symptom information helps - it is never assumed.
 */
export interface SymptomStratifiedReport {
  with_symptoms: EvaluationReport | null;
  without_symptoms: EvaluationReport | null;
  delta_notes: string[];
  by_symptom_category: Array<{ category: string; report: EvaluationReport }>;
  warning: string;
}

const STRAT_WARNING =
  "Do not assume symptoms improve model performance. Improvements must be demonstrated on held-out, " +
  "patient-level-separated validation data before any claim is made.";

export function symptomStratifiedEvaluation(cases: BinaryCase[]): SymptomStratifiedReport {
  const withS = cases.filter((c) => c.with_symptoms === true);
  const withoutS = cases.filter((c) => c.with_symptoms === false);
  const report: SymptomStratifiedReport = {
    with_symptoms: withS.length > 0 ? evaluate(withS) : null,
    without_symptoms: withoutS.length > 0 ? evaluate(withoutS) : null,
    delta_notes: [],
    by_symptom_category: [],
    warning: STRAT_WARNING,
  };
  if (report.with_symptoms && report.without_symptoms) {
    const d = (a: number | null, b: number | null) => (a === null || b === null ? null : Math.round((a - b) * 10000) / 10000);
    report.delta_notes.push(`Sensitivity delta (with - without): ${d(report.with_symptoms.sensitivity, report.without_symptoms.sensitivity)}`);
    report.delta_notes.push(`Specificity delta: ${d(report.with_symptoms.specificity, report.without_symptoms.specificity)}`);
    report.delta_notes.push(`AUROC delta: ${d(report.with_symptoms.auroc, report.without_symptoms.auroc)}`);
    report.delta_notes.push("False-negative differences must be reviewed for safety-critical conditions.");
  } else {
    report.delta_notes.push("Both strata require data before a with/without-symptoms comparison is possible.");
  }
  const cats = new Map<string, BinaryCase[]>();
  for (const c of cases) {
    if (c.symptom_category) {
      if (!cats.has(c.symptom_category)) cats.set(c.symptom_category, []);
      cats.get(c.symptom_category)!.push(c);
    }
  }
  for (const [category, cs] of cats) report.by_symptom_category.push({ category, report: evaluate(cs) });
  return report;
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}
