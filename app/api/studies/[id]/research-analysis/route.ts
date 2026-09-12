import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { runResearchAnalysis } from "@/lib/evidence/researchAnalysis";
import { requireStudyScope } from "@/lib/auth/scope";
import { checkProcessingConsent, consentRequiredPayload, PROCESSING_CONSENT_PURPOSES } from "@/lib/consent/policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * S10 - real research-model inference for one study's fundus image, merged
 * into the S5 evidence workspace. Entirely isolated from `analyzeStudy()`,
 * the model registry, and Gate A - see lib/evidence/researchAnalysis.ts.
 *
 * Roles: ADMIN, CLINICIAN, REVIEWER only - same PHI-bearing-evidence policy
 * as /api/studies/{id}/evidence and /api/documents/{id}/results. Read-only:
 * this route never mutates the study, never writes an `analyses` record.
 *
 * Every response is RESEARCH_INFERENCE / NOT CLINICALLY VALIDATED - see
 * docs/CLINICAL_AI_ARCHITECTURE.md.
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
  const consent = await checkProcessingConsent(params.id, PROCESSING_CONSENT_PURPOSES.clinicalResearchAnalysis);
  if (!consent.ok) return NextResponse.json(consentRequiredPayload(consent), { status: 403 });

  const result = await runResearchAnalysis(params.id);
  if (result.state === "NOT_A_STUDY") {
    return NextResponse.json({ error: "Not found", ...result }, { status: 404 });
  }
  return NextResponse.json(result);
}
