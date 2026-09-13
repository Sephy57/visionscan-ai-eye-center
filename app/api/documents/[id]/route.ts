import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { getDocument } from "@/lib/documents/repository";
import { toSummary } from "@/lib/documents/types";
import { deleteDocument } from "@/lib/documents/service";
import { requireDocumentScope } from "@/lib/auth/scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Single document metadata (GET) and deletion (DELETE).
 * Metadata/status view: ADMIN, CLINICIAN, REVIEWER, TECHNICIAN.
 * Deletion (removes original bytes; audit/recovery history may be retained): ADMIN, CLINICIAN.
 * Document content is NEVER included in these responses - only metadata.
 */

const VIEW_ROLES = ["ADMIN", "CLINICIAN", "REVIEWER", "TECHNICIAN"] as const;
const DELETE_ROLES = ["ADMIN", "CLINICIAN"] as const;

export function GET(req: NextRequest, context: { params: { id: string } }): Promise<NextResponse>;
export function GET(req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse>;
export async function GET(req: NextRequest, { params }: { params: { id: string } | Promise<{ id: string }> }) {
  params = await params;
  const denied = await requireRole(req, [...VIEW_ROLES]);
  if (denied) return denied;
  const scoped = await requireDocumentScope(req, params.id);
  if (scoped.response) return scoped.response;
  if (!scoped.resource) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const doc = await getDocument(params.id);
  if (!doc) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  return NextResponse.json({ document: toSummary(doc) });
}

export function DELETE(req: NextRequest, context: { params: { id: string } }): Promise<NextResponse>;
export function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse>;
export async function DELETE(req: NextRequest, { params }: { params: { id: string } | Promise<{ id: string }> }) {
  params = await params;
  const denied = await requireRole(req, [...DELETE_ROLES]);
  if (denied) return denied;
  const scoped = await requireDocumentScope(req, params.id);
  if (scoped.response) return scoped.response;
  if (!scoped.resource) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const { requireSession } = await import("@/lib/auth/rbac");
  const { user } = await requireSession(req);
  const result = await deleteDocument(params.id, user?.username ?? "unknown");
  if (!result.ok) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  return NextResponse.json({
    deleted: true,
    deletion_semantics: "SOURCE_BYTES_REMOVED_HISTORY_RETAINED",
    note: "Document source bytes and derived extraction files were removed where applicable; audit and recovery history may be retained under policy.",
  });
}
