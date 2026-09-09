import type { EvaluationRun } from "./evaluationRuns";

/**
 * Safe, aggregate-only projection for validation consumers.
 *
 * Evaluation cases may be keyed by a local identifier and can carry arbitrary
 * subgroup/symptom text. Neither is needed by the dashboard, so this module
 * deliberately copies only bounded aggregate fields. This is a defense in
 * depth measure for RESEARCHER access: de-identification is not inferred from
 * a caller-supplied dataset reference.
 */
export interface SafeValidationRun {
  run_id: string;
  model_id: string;
  model_version: string;
  split: EvaluationRun["split"] | "unknown";
  cases: number;
  patient_count: number | null;
  device_count: number | null;
  modality: string | null;
  metrics: {
    sensitivity: number | null;
    specificity: number | null;
    ppv: number | null;
    npv: number | null;
    auroc: number | null;
    auprc: number | null;
    ece: number | null;
  };
  errors: {
    false_negatives: number;
    false_positives: number;
    missed_urgent_cases: number;
    quality_blocked: number;
    out_of_distribution: number;
    urgent_fn_rate: number | null;
  };
  created_at: string;
}

const SAFE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SAFE_SPLITS = new Set<EvaluationRun["split"]>(["locked_test", "external_test", "device_specific", "modality_specific", "subgroup"]);

function safeToken(value: string, fallback: string): string {
  return SAFE_TOKEN.test(value) ? value : fallback;
}

function safeSplit(value: EvaluationRun["split"]): EvaluationRun["split"] | "unknown" {
  return SAFE_SPLITS.has(value) ? value : "unknown";
}

function safeModality(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim().toUpperCase();
  return ["FUNDUS", "OCT", "UNKNOWN"].includes(normalized) ? normalized : "OTHER";
}

export function safeValidationRun(run: EvaluationRun): SafeValidationRun {
  return {
    run_id: run.run_id,
    model_id: safeToken(run.model_id, "unregistered-model"),
    model_version: safeToken(run.model_version, "unversioned"),
    split: safeSplit(run.split),
    cases: run.cases,
    patient_count: run.patient_count,
    device_count: run.device_count,
    modality: safeModality(run.modality),
    metrics: {
      sensitivity: run.metrics.sensitivity,
      specificity: run.metrics.specificity,
      ppv: run.metrics.ppv,
      npv: run.metrics.npv,
      auroc: run.metrics.auroc,
      auprc: run.metrics.auprc,
      ece: run.metrics.ece,
    },
    errors: {
      false_negatives: run.failure_analysis.false_negatives,
      false_positives: run.failure_analysis.false_positives,
      missed_urgent_cases: run.failure_analysis.missed_urgent_cases.length,
      quality_blocked: run.failure_analysis.quality_failures,
      out_of_distribution: run.failure_analysis.ood_failures,
      urgent_fn_rate: run.failure_analysis.fn_by_urgent_vs_non_urgent.urgent_fn_rate,
    },
    created_at: run.created_at,
  };
}

export function validationDashboardSummary(runs: EvaluationRun[]) {
  const safeRuns = runs.map(safeValidationRun);
  return {
    schema_version: "validation-dashboard-v1",
    phi_included: false,
    access_scope: "ADMIN_RESEARCHER_AGGREGATE_ONLY",
    notice: "Research validation evidence only. Case identifiers, patient identifiers, dataset references, notes, subgroup labels, and free text are withheld. No clinical validation is claimed.",
    runs: safeRuns,
    totals: safeRuns.reduce((sum, run) => ({
      cases: sum.cases + run.cases,
      false_negatives: sum.false_negatives + run.errors.false_negatives,
      false_positives: sum.false_positives + run.errors.false_positives,
      missed_urgent_cases: sum.missed_urgent_cases + run.errors.missed_urgent_cases,
      quality_blocked: sum.quality_blocked + run.errors.quality_blocked,
      out_of_distribution: sum.out_of_distribution + run.errors.out_of_distribution,
    }), {
      cases: 0, false_negatives: 0, false_positives: 0,
      missed_urgent_cases: 0, quality_blocked: 0, out_of_distribution: 0,
    }),
  };
}
