import { NextRequest, NextResponse } from "next/server";
import { requireRole, requireSession } from "@/lib/auth/rbac";
import { getDocument } from "@/lib/documents/repository";
import { getExtractionForDelivery } from "@/lib/documents/extraction/service";
import { audit } from "@/lib/audit";
import { requireDocumentScope } from "@/lib/auth/scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Returns the extraction artifact for a document (S2).
 * Roles: ADMIN, CLINICIAN, REVIEWER ONLY - the artifact contains
 * potentially PHI-bearing extracted text; TECHNICIAN and RESEARCHER are
 * deliberately excluded (least privilege, mirrors the S1 file-byte policy).
 *
 * The response is explicitly labeled: AUTO-EXTRACTED, UNREVIEWED,
 * UNCERTAIN - it is NOT a verified clinical result and is not connected to
 * triage, analysis, or diagnosis. Extraction access is audited (metadata
 * only, never text).
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } | Promise<{ id: string }> }) {
  params = await params;
  const denied = await requireRole(req, ["ADMIN", "CLINICIAN", "REVIEWER"]);
  if (denied) return denied;
  const scoped = await requireDocumentScope(req, params.id);
  if (scoped.response) return scoped.response;
  if (!scoped.resource) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const { user } = await requireSession(req);

  const doc = await getDocument(params.id);
  if (!doc) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const artifact = await getExtractionForDelivery(params.id);
  if (!artifact) {
    return NextResponse.json({ error: "NOT_EXTRACTED", message: "No extraction artifact exists for this document." }, { status: 404 });
  }
  await audit({
    actor: `user:${user?.username ?? "unknown"}`,
    action: "document.extraction_accessed",
    resource: "document",
    resourceId: params.id,
    studyId: artifact.study_id,
    outcome: "ok",
    detail: `artifact_status=${artifact.status} pages=${artifact.totals.pages} chars=${artifact.totals.char_count} verification=${artifact.verification.status}`,
  });
  return NextResponse.json({ artifact, notice: "AUTO-EXTRACTED DATA - UNREVIEWED - UNCERTAIN - NOT A VERIFIED CLINICAL RESULT" });
}
