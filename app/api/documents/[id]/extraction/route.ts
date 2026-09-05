import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { getDocument } from "@/lib/documents/repository";
import { getRecordExtraction } from "@/lib/documents/extraction/recordExtractionStore";
import { requireDocumentScope } from "@/lib/auth/scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Automatic clinical extraction for one document (eye-center workspace).
 *
 * Returns the extraction record: candidate symptoms / medications /
 * allergies / systemic candidates, all DOCUMENT_EXTRACTED + UNREVIEWED
 * with per-item clinician annotations. If extraction has not run (or
 * failed) the response says so honestly - it never fabricates an empty
 * "no findings" result.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } | Promise<{ id: string }> }) {
  params = await params;
  const denied = await requireRole(req, ["ADMIN", "CLINICIAN", "REVIEWER"]);
  if (denied) return denied;
  const scoped = await requireDocumentScope(req, params.id);
  if (scoped.response) return scoped.response;
  if (!scoped.resource) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const doc = await getDocument(params.id);
  if (!doc || doc.status === "DELETED") return NextResponse.json({ error: "Not found" }, { status: 404 });

  const extraction = await getRecordExtraction(params.id);
  if (!extraction) {
    return NextResponse.json({
      document_id: params.id,
      status: "NOT_EXTRACTED",
      message: "No clinical extraction has run for this document yet.",
    });
  }
  return NextResponse.json(extraction);
}
