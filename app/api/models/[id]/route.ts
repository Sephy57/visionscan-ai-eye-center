import { NextRequest, NextResponse } from "next/server";
import { getModel, gateModelUse, STATUS_CAPABILITIES } from "@/lib/models/registry";
import { verifyModelIntegrity } from "@/lib/models/integrity";
import { loadModelPackage } from "@/lib/models/package";
import { generateModelCard } from "@/lib/reports/modelCard";
import { whyStatus, listTransitions, STATUS_LADDER, TRANSITION_REQUIREMENTS } from "@/lib/models/transitions";
import { listEvidence } from "@/lib/research/evidence";
import { listEvaluationRuns } from "@/lib/research/evaluationRuns";
import { dbGet } from "@/lib/storage/db";
import type { StudyRecord } from "@/lib/studies/service";
import { requireRole } from "@/lib/auth/rbac";
import { ensureRegistryHydrated } from "@/lib/models/registryPersistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/models/:id — full model management payload: status + WHY, integrity, package, evidence, transitions, evaluations, card. */
export async function GET(req: NextRequest, { params }: { params: { id: string } | Promise<{ id: string }> }) {
  params = await params;
  const denied = await requireRole(req, ["ADMIN", "CLINICIAN", "REVIEWER", "RESEARCHER"]);
  if (denied) return denied;
  await ensureRegistryHydrated();
  const model = getModel(params.id);
  if (!model) return NextResponse.json({ error: "Model not registered" }, { status: 404 });

  const gate = gateModelUse(model);
  const integrity = verifyModelIntegrity(params.id);
  const pkg = loadModelPackage(params.id);
  const why = await whyStatus(params.id);
  const evidence = await listEvidence(params.id);
  const transitions = await listTransitions(params.id);
  const evaluations = await listEvaluationRuns(params.id);

  return NextResponse.json({
    model,
    gate,
    status_reasons: why,
    ladder: STATUS_LADDER,
    transition_requirements: TRANSITION_REQUIREMENTS,
    integrity: { trusted: integrity.trusted, checks: integrity.checks },
    package: { installed: pkg.ok, reasons: pkg.reasons, manifest: pkg.ok ? pkg.manifest : null },
    evidence,
    transitions,
    evaluations: evaluations.map((r) => ({
      run_id: r.run_id, split: r.split, dataset_ref: r.dataset_ref, cases: r.cases,
      patient_count: r.patient_count, device_count: r.device_count,
      sensitivity: r.metrics.sensitivity, specificity: r.metrics.specificity,
      auroc: r.metrics.auroc, auprc: r.metrics.auprc, ece: r.metrics.ece,
      false_negatives: r.failure_analysis.false_negatives,
      missed_urgent: r.failure_analysis.missed_urgent_cases.length,
      created_at: r.created_at,
    })),
    model_card: generateModelCard(model),
    capabilities: STATUS_CAPABILITIES[model.status],
    note: "No single accuracy score is reported. Metrics exist only where real evaluation evidence exists.",
  });
}
