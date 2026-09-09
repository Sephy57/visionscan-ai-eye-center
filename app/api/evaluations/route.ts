import { NextRequest, NextResponse } from "next/server";
import { createEvaluationRun, listEvaluationRuns, compareRuns } from "@/lib/research/evaluationRuns";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/rbac";
import { safeValidationRun } from "@/lib/research/validationDashboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** GET: list evaluation runs (optionally per model) + per-split comparison. */
export async function GET(req: NextRequest) {
  const denied = await requireRole(req, ["ADMIN", "RESEARCHER"]);
  if (denied) return denied;
  const modelId = req.nextUrl.searchParams.get("modelId") ?? undefined;
  const runs = await listEvaluationRuns(modelId);
  return NextResponse.json({
    runs: runs.map(safeValidationRun),
    comparison: compareRuns(runs),
    note: "No single 'AI accuracy' score is reported — performance is always per split, per metric, with failure analysis.",
  });
}

/** POST: create an evaluation run (research-only). Input: locked/external dataset cases. */
export async function POST(req: NextRequest) {
  const denied = await requireRole(req, ["ADMIN", "RESEARCHER"]);
  if (denied) return denied;
  try {
    const body = await req.json();
    if (!body?.model_id || !body?.dataset_ref || !body?.split || !Array.isArray(body?.cases)) {
      return NextResponse.json({ error: "model_id, dataset_ref, split, cases required" }, { status: 400 });
    }
    // Model/version identifiers are written to the audit trail. Reject
    // free-form values here so a caller cannot smuggle names or notes into
    // an ADMIN-visible audit record.
    if (typeof body.model_id !== "string" || !SAFE_IDENTIFIER.test(body.model_id) ||
      (body.model_version !== undefined && (typeof body.model_version !== "string" || !SAFE_IDENTIFIER.test(body.model_version)))) {
      return NextResponse.json({ error: "model_id and model_version must be safe identifiers" }, { status: 400 });
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
    // Return the same aggregate-only shape as GET. Case identifiers and
    // caller-supplied free text are never reflected to a research client.
    return NextResponse.json(safeValidationRun(run));
  } catch (err) {
    // Patient-level leakage FAILS VALIDATION here.
    const message = err instanceof Error ? err.message : "Evaluation request rejected";
    const safeMessage = message.startsWith("Patient-level leakage detected")
      ? "Patient-level leakage detected within evaluation run. FAIL VALIDATION."
      : message;
    return NextResponse.json({ error: safeMessage }, { status: 400 });
  }
}
