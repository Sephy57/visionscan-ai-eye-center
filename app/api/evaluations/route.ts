import { NextRequest, NextResponse } from "next/server";
import { createEvaluationRun, listEvaluationRuns, compareRuns } from "@/lib/research/evaluationRuns";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET: list evaluation runs (optionally per model) + per-split comparison. */
export async function GET(req: NextRequest) {
  const modelId = req.nextUrl.searchParams.get("modelId") ?? undefined;
  const runs = await listEvaluationRuns(modelId);
  return NextResponse.json({
    runs: runs.map((r) => ({
      run_id: r.run_id, model_id: r.model_id, model_version: r.model_version,
      dataset_ref: r.dataset_ref, split: r.split, cases: r.cases,
      patient_count: r.patient_count, device_count: r.device_count, modality: r.modality,
      metrics: r.metrics, failure_analysis: r.failure_analysis,
      symptom_stratified: r.symptom_stratified ? {
        with_symptoms: r.symptom_stratified.with_symptoms && {
          sensitivity: r.symptom_stratified.with_symptoms.sensitivity,
          auroc: r.symptom_stratified.with_symptoms.auroc,
        },
        without_symptoms: r.symptom_stratified.without_symptoms && {
          sensitivity: r.symptom_stratified.without_symptoms.sensitivity,
          auroc: r.symptom_stratified.without_symptoms.auroc,
        },
        delta_notes: r.symptom_stratified.delta_notes,
        warning: r.symptom_stratified.warning,
      } : null,
      created_at: r.created_at, notes: r.notes,
    })),
    comparison: compareRuns(runs),
    note: "No single 'AI accuracy' score is reported — performance is always per split, per metric, with failure analysis.",
  });
}

/** POST: create an evaluation run (research-only). Input: locked/external dataset cases. */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body?.model_id || !body?.dataset_ref || !body?.split || !Array.isArray(body?.cases)) {
      return NextResponse.json({ error: "model_id, dataset_ref, split, cases required" }, { status: 400 });
    }
    const run = await createEvaluationRun({
      model_id: String(body.model_id),
      model_version: String(body.model_version ?? "0"),
      dataset_ref: String(body.dataset_ref),
      split: body.split,
      cases: body.cases,
      patient_ids: Array.isArray(body.patient_ids) ? body.patient_ids.map(String) : undefined,
      device_count: typeof body.device_count === "number" ? body.device_count : undefined,
      modality: body.modality ? String(body.modality) : undefined,
      notes: body.notes ? String(body.notes) : undefined,
    });
    return NextResponse.json({ run_id: run.run_id, metrics: run.metrics, failure_analysis: run.failure_analysis });
  } catch (err) {
    // Patient-level leakage FAILS VALIDATION here.
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 400 });
  }
}
