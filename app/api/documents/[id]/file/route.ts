import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { requireDocumentScope } from "@/lib/auth/scope";
import { readDocumentForDelivery } from "@/lib/documents/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Streams the immutable original PDF for secure in-app viewing.
 * Roles: ADMIN, CLINICIAN, REVIEWER only - TECHNICIAN can upload and see
 * status but never fetch document bytes (least privilege, S1 §26).
 *
 * Security properties (see lib/documents/security.ts):
 *  - access authorized via requireRole BEFORE any file I/O
 *  - storage path derived from the server-generated document id only
 *  - SHA-256 of on-disk bytes verified against the recorded hash
 *  - Content-Security-Policy: sandbox (no embedded script execution)
 *  - nosniff; server-generated Content-Disposition filename
 *  - no-store
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } | Promise<{ id: string }> }) {
  params = await params;
  const denied = await requireRole(req, ["ADMIN", "CLINICIAN", "REVIEWER"]);
  if (denied) return denied;
  const scoped = await requireDocumentScope(req, params.id);
  if (scoped.response) return scoped.response;
  if (!scoped.resource) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { requireSession } = await import("@/lib/auth/rbac");
  const { user } = await requireSession(req);

  const result = await readDocumentForDelivery(params.id, user?.username ?? "unknown");
  if (!result.ok) {
    const status = result.httpStatus === 409 ? 409 : 404;
    return NextResponse.json({ error: result.error ?? "Not found" }, { status });
  }
  return new NextResponse(new Uint8Array(result.bytes!), { status: 200, headers: result.headers });
}
