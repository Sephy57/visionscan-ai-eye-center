/**
 * Persistent evaluation runs — the backbone of the validation pipeline.
 *
 * Input:  locked/external dataset ref + model + ground truth + predictions
 * Output: a persisted run with full metrics (no headline "accuracy"),
 *         failure analysis, symptom-stratified comparison, and a run_id that
 *         can be registered as EVIDENCE for model status transitions.
 */

import { dbPut, dbGet, dbAll } from "../storage/db";
import { newId } from "../storage/files";
import { audit } from "../audit";
import { evaluate, symptomStratifiedEvaluation, BinaryCase } from "./metrics";
import { analyzeFailures, FailureAnalysisReport, FailureCase } from "./failureAnalysis";

export type EvaluationSplit = "locked_test" | "external_test" | "device_specific" | "modality_specific" | "subgroup";

export interface EvaluationRun {
  run_id: string;
  model_id: string;
  model_version: string;
  dataset_ref: string;                 // dataset registry id (patient-level-split enforced upstream)
  split: EvaluationSplit;
  cases: number;
  patient_count: number | null;
  device_count: number | null;
  modality: string | null;
  metrics: ReturnType<typeof evaluate>;
  failure_analysis: FailureAnalysisReport;
  symptom_stratified: ReturnType<typeof symptomStratifiedEvaluation> | null;
  created_at: string;
  notes?: string;
}

export interface CreateRunInput {
  model_id: string;
  model_version: string;
  dataset_ref: string;
  split: EvaluationSplit;
  cases: Array<BinaryCase & Partial<FailureCase>>;
  patient_ids?: string[];
  device_count?: number;
  modality?: string;
  notes?: string;
}

export async function createEvaluationRun(input: CreateRunInput): Promise<EvaluationRun> {
  if (!Array.isArray(input.cases) || input.cases.length === 0) {
    throw new Error("Evaluation requires at least one case");
  }
  // Patient-level duplication check within the run itself (leakage guard).
  if (input.patient_ids) {
    const seen = new Set<string>();
    for (const p of input.patient_ids) {
      if (seen.has(p)) throw new Error(`Patient-level leakage detected within evaluation run: patient ${p} appears multiple times. FAIL VALIDATION.`);
      seen.add(p);
    }
  }

  const metrics = evaluate(input.cases);
  const failure_analysis = analyzeFailures(input.cases as FailureCase[]);
  const hasSymptomInfo = input.cases.some((c) => c.with_symptoms !== undefined);
  const symptom_stratified = hasSymptomInfo ? symptomStratifiedEvaluation(input.cases) : null;

  const run: EvaluationRun = {
    run_id: newId("run"),
    model_id: input.model_id,
    model_version: input.model_version,
    dataset_ref: input.dataset_ref,
    split: input.split,
    cases: input.cases.length,
    patient_count: input.patient_ids ? new Set(input.patient_ids).size : null,
    device_count: input.device_count ?? null,
    modality: input.modality ?? null,
    metrics,
    failure_analysis,
    symptom_stratified,
    created_at: new Date().toISOString(),
    notes: input.notes,
  };
  await dbPut("evaluation_runs", run.run_id, run);
  await audit({
    actor: "research", action: "evaluation.run", outcome: "ok",
    detail: `${run.run_id} ${input.model_id} split=${input.split} cases=${input.cases.length} FN=${failure_analysis.false_negatives} missedUrgent=${failure_analysis.missed_urgent_cases.length}`,
  });
  return run;
}

export async function getEvaluationRun(runId: string): Promise<EvaluationRun | null> {
  return dbGet<EvaluationRun>("evaluation_runs", runId);
}

export async function listEvaluationRuns(modelId?: string): Promise<EvaluationRun[]> {
  const all = await dbAll<EvaluationRun>("evaluation_runs");
  const sorted = all.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return modelId ? sorted.filter((r) => r.model_id === modelId) : sorted;
}

/** External vs internal comparison: never merge into one number. */
export function compareRuns(runs: EvaluationRun[]): Array<{
  metric: string;
  values: Array<{ run_id: string; split: string; value: number | null }>;
  note: string;
}> {
  const fields: Array<[string, (r: EvaluationRun) => number | null]> = [
    ["sensitivity", (r) => r.metrics.sensitivity],
    ["specificity", (r) => r.metrics.specificity],
    ["ppv", (r) => r.metrics.ppv],
    ["npv", (r) => r.metrics.npv],
    ["auroc", (r) => r.metrics.auroc],
    ["auprc", (r) => r.metrics.auprc],
    ["ece", (r) => r.metrics.ece],
    ["false_negatives", (r) => r.failure_analysis.false_negatives],
  ];
  return fields.map(([metric, get]) => ({
    metric,
    values: runs.map((r) => ({ run_id: r.run_id, split: r.split, value: get(r) })),
    note: "Performance is reported per split — internal test, external test, device- and modality-specific runs are NEVER merged into a single number.",
  }));
}
