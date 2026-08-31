/**
 * Failure analysis for model evaluation — safety-focused.
 *
 * Priorities: false negatives on urgent/red-flag presentations, missed urgent
 * cases, quality failures, OOD failures, device/modality failures.
 * This is the safety counterpart to aggregate metrics: a model that performs
 * well overall can still be unsafe if it misses rare serious abnormalities.
 */

import { BinaryCase } from "./metrics";

export interface FailureCase {
  case_id: string;
  failure_type: "false_negative" | "false_positive";
  y_true: 0 | 1;
  y_pred: 0 | 1;
  score?: number;
  subgroup?: string;
  with_symptoms?: boolean;
  symptom_category?: string;
  urgent_presentation?: boolean;   // case involves a red-flag/urgent symptom
  quality_failed?: boolean;
  ood?: boolean;
}

export interface FailureAnalysisReport {
  total_cases: number;
  false_negatives: number;
  false_positives: number;
  missed_urgent_cases: Array<{ case_id: string; score?: number; subgroup?: string; symptom_category?: string }>;
  fn_by_urgent_vs_non_urgent: {
    fn_urgent: number;
    urgent_total: number;
    fn_non_urgent: number;
    non_urgent_total: number;
    urgent_fn_rate: number | null;
    non_urgent_fn_rate: number | null;
    note: string;
  };
  fn_by_symptom_category: Array<{ category: string; fn: number; total: number; rate: number | null }>;
  fn_by_device: Array<{ subgroup: string; fn: number; total: number; rate: number | null }>;
  fn_by_symptom_context: {
    fn_with_symptoms: number;
    fn_without_symptoms: number;
    note: string;
  };
  quality_failures: number;
  ood_failures: number;
  safety_notes: string[];
}

export function analyzeFailures(cases: FailureCase[]): FailureAnalysisReport {
  const fns = cases.filter((c) => c.y_true === 1 && c.y_pred === 0);
  const fps = cases.filter((c) => c.y_true === 0 && c.y_pred === 1);

  const urgent = cases.filter((c) => c.urgent_presentation === true);
  const nonUrgent = cases.filter((c) => c.urgent_presentation !== true);
  const fnUrgent = urgent.filter((c) => c.y_true === 1 && c.y_pred === 0);
  const fnNonUrgent = nonUrgent.filter((c) => c.y_true === 1 && c.y_pred === 0);
  const rate = (n: number, d: number) => (d === 0 ? null : Math.round((n / d) * 10000) / 10000);

  const catMap = new Map<string, { fn: number; total: number }>();
  for (const c of cases) {
    if (!c.symptom_category) continue;
    const e = catMap.get(c.symptom_category) ?? { fn: 0, total: 0 };
    e.total++;
    if (c.y_true === 1 && c.y_pred === 0) e.fn++;
    catMap.set(c.symptom_category, e);
  }

  const devMap = new Map<string, { fn: number; total: number }>();
  for (const c of cases) {
    const g = c.subgroup ?? "unspecified";
    const e = devMap.get(g) ?? { fn: 0, total: 0 };
    e.total++;
    if (c.y_true === 1 && c.y_pred === 0) e.fn++;
    devMap.set(g, e);
  }

  return {
    total_cases: cases.length,
    false_negatives: fns.length,
    false_positives: fps.length,
    missed_urgent_cases: fnUrgent.map((c) => ({
      case_id: c.case_id, score: c.score, subgroup: c.subgroup, symptom_category: c.symptom_category,
    })),
    fn_by_urgent_vs_non_urgent: {
      fn_urgent: fnUrgent.length,
      urgent_total: urgent.length,
      fn_non_urgent: fnNonUrgent.length,
      non_urgent_total: nonUrgent.length,
      urgent_fn_rate: rate(fnUrgent.length, urgent.length),
      non_urgent_fn_rate: rate(fnNonUrgent.length, nonUrgent.length),
      note:
        "False negatives on urgent presentations are the primary safety concern. " +
        "A higher FN rate on urgent cases than non-urgent cases is a safety signal that must be investigated.",
    },
    fn_by_symptom_category: [...catMap.entries()].map(([category, e]) => ({
      category, fn: e.fn, total: e.total, rate: rate(e.fn, e.total),
    })),
    fn_by_device: [...devMap.entries()].map(([subgroup, e]) => ({
      subgroup, fn: e.fn, total: e.total, rate: rate(e.fn, e.total),
    })),
    fn_by_symptom_context: {
      fn_with_symptoms: fns.filter((c) => c.with_symptoms === true).length,
      fn_without_symptoms: fns.filter((c) => c.with_symptoms === false).length,
      note: "Compares false negatives with and without symptom context — never assumed beneficial; must be measured.",
    },
    quality_failures: cases.filter((c) => c.quality_failed === true).length,
    ood_failures: cases.filter((c) => c.ood === true).length,
    safety_notes: [
      "False negatives on urgent presentations are weighted above aggregate performance.",
      "Zero false negatives is never claimed; probabilistic models are fallible by design.",
      "Device- and modality-specific FN rates prevent a model validated on one device from being silently trusted on another.",
    ],
  };
}
