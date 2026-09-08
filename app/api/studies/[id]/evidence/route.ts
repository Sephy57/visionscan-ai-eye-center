import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { buildEvidenceWorkspace } from "@/lib/evidence/synthesize";
import { requireStudyScope } from "@/lib/auth/scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * S5 - read-only multimodal evidence workspace for one study. Aggregates
 * S3/S4 structured test results, Phase-3 patient-reported symptoms, and the
 * image-analysis pipeline's findings into one comparable, provenance-linked
 * view, with cross-source conflict detection and a non-clinical condition-
 * pattern assessment (POSSIBLE_CONDITION / SUPPORTED_CONDITION /
 * INSUFFICIENT_EVIDENCE / CONFLICTING_EVIDENCE / UNABLE_TO_ASSESS - never a
 * diagnosis, never a probability). See docs/EVIDENCE_SYNTHESIS.md.
 *
 * Roles: ADMIN, CLINICIAN, REVIEWER only - the same PHI-bearing-results
 * policy as /api/documents/{id}/results and /api/results/{id}/verify.
 * This endpoint is read-only: no action here mutates a study, symptom,
 * document, or test result - verification/correction stays on the existing
 * S4 endpoints, which is the only place that produces a HUMAN_VERIFIED
 * trust level for this workspace to read back.
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

  const workspace = await buildEvidenceWorkspace(params.id);
  if ("not_found" in workspace) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(workspace);
}
