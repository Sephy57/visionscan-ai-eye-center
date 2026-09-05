import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { listTestResultsForDocument } from "@/lib/documents/extraction/testResultService";
import { requireDocumentScope } from "@/lib/auth/scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Structured test results extracted from a document (S3).
 * Roles: ADMIN, CLINICIAN, REVIEWER only (results carry clinical values =
 * PHI). TECHNICIAN and RESEARCHER excluded, mirroring the /text policy.
 *
 * Every result is AUTO_EXTRACTED until a clinician verifies it. Ambiguity
 * flags and conflicts are surfaced here - never silently resolved. NOTHING
 * in this response reaches triage, diagnosis, or the analysis pipeline.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } | Promise<{ id: string }> }) {
  params = await params;
  const denied = await requireRole(req, ["ADMIN", "CLINICIAN", "REVIEWER"]);
  if (denied) return denied;
  const scoped = await requireDocumentScope(req, params.id);
  if (scoped.response) return scoped.response;
  if (!scoped.resource) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const results = await listTestResultsForDocument(params.id);
  return NextResponse.json({
    results,
    notice: "AUTO-EXTRACTED, UNREVIEWED STRUCTURED DATA - NOT VERIFIED CLINICAL INFORMATION - NEVER USED FOR DIAGNOSIS OR TRIAGE",
  });
}
