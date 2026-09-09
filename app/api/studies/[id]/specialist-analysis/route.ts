import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { requireStudyScope } from "@/lib/auth/scope";
import { buildStructuredClinicalEvidence } from "@/lib/evidence/structuredClinicalEvidence";
import { DeterministicReasoningEngine } from "@/lib/models/reasoningEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Opt-in specialist routing/consensus view. This endpoint may execute the
 * isolated research capability when its own quality, OOD, and artifact gates
 * allow it; it never writes an analysis record and never turns research
 * output into a diagnosis. The independent triage result remains the urgency
 * authority.
 */
export function GET(req: NextRequest, context: { params: { id: string } }): Promise<NextResponse>;
export function GET(req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse>;
export async function GET(req: NextRequest, { params }: { params: { id: string } | Promise<{ id: string }> }) {
  params = await params;
  const denied = await requireRole(req, ["ADMIN", "CLINICIAN", "REVIEWER"]);
  if (denied) return denied;
  const scoped = await requireStudyScope(req, params.id);
  if (scoped.response) return scoped.response;
  if (!scoped.resource) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const evidence = await buildStructuredClinicalEvidence(params.id, { includeSpecialists: true });
  if ("not_found" in evidence) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const reasoning = new DeterministicReasoningEngine().analyze(evidence);
  return NextResponse.json({
    study_id: params.id,
    specialist_consensus: evidence.specialist_consensus ?? null,
    specialist_bundles: evidence.specialist_bundles,
    specialist_packages: evidence.specialist_packages ?? [],
    reasoning,
    safety_banner: evidence.safety_banner,
    requires_clinician_review: true,
  });
}
