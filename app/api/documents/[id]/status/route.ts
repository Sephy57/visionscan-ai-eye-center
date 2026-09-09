import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { getDocumentStatus } from "@/lib/documents/service";
import { readExtractionArtifact } from "@/lib/documents/extraction/artifacts";
import { requireDocumentScope } from "@/lib/auth/scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Processing/validation status for a document (poll-friendly).
 * Roles: ADMIN, CLINICIAN, REVIEWER, TECHNICIAN.
 * S1 statuses: UPLOADED / VALIDATING / VALID / REJECTED / DELETED.
 * S2 adds: PROCESSING / READY / FAILED plus an extraction SUMMARY -
 * never the extracted text itself (that requires /text and clinical roles).
 */
export function GET(req: NextRequest, context: { params: { id: string } }): Promise<NextResponse>;
export function GET(req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse>;
export async function GET(req: NextRequest, { params }: { params: { id: string } | Promise<{ id: string }> }) {
  params = await params;
  const denied = await requireRole(req, ["ADMIN", "CLINICIAN", "REVIEWER", "TECHNICIAN"]);
  if (denied) return denied;
  const scoped = await requireDocumentScope(req, params.id);
  if (scoped.response) return scoped.response;
  if (!scoped.resource) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const result = await getDocumentStatus(params.id);
  if (!result.found) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const artifact = await readExtractionArtifact(params.id);
  const extraction = artifact
    ? {
        status: artifact.status,
        document_level: artifact.document_level,
        totals: artifact.totals,
        verification: artifact.verification,
        extraction_version: artifact.extraction_version,
        warnings: artifact.warnings,
        created_at: artifact.created_at,
        asset_routing: artifact.asset_routing,
      }
    : null;

  return NextResponse.json({
    document_id: params.id,
    status: result.status,
    validation: result.validation,
    document: result.document,
    extraction,
  });
}
