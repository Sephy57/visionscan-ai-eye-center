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
import { safeValidationRun } from "@/lib/research/validationDashboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/models/:id — full model management payload: status + WHY, integrity, package, evidence, transitions, evaluations, card. */
export function GET(req: NextRequest, context: { params: { id: string } }): Promise<NextResponse>;
export function GET(req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse>;
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
    package: {
      installed: pkg.ok,
      integrity_verified: pkg.ok,
      execution_authorized: pkg.ok && gate.allowed && integrity.trusted,
      reasons: pkg.reasons,
      manifest: pkg.ok ? pkg.manifest : null,
      note: "Package integrity is not execution authorization; registry status and the full integrity gate must also pass.",
    },
    evidence,
    transitions,
    // The model detail endpoint is also available to RESEARCHER sessions:
    // use the same aggregate-only projection as the validation dashboard.
    evaluations: evaluations.map((r) => {
      const safe = safeValidationRun(r);
      return {
        run_id: safe.run_id, split: safe.split, cases: safe.cases,
        patient_count: safe.patient_count, device_count: safe.device_count,
        sensitivity: safe.metrics.sensitivity, specificity: safe.metrics.specificity,
        auroc: safe.metrics.auroc, auprc: safe.metrics.auprc, ece: safe.metrics.ece,
        false_negatives: safe.errors.false_negatives,
        missed_urgent: safe.errors.missed_urgent_cases,
        quality_blocked: safe.errors.quality_blocked,
        out_of_distribution: safe.errors.out_of_distribution,
        created_at: safe.created_at,
      };
    }),
    model_card: generateModelCard(model),
    capabilities: STATUS_CAPABILITIES[model.status],
    note: "No single accuracy score is reported. Metrics exist only where real evaluation evidence exists.",
  });
}
