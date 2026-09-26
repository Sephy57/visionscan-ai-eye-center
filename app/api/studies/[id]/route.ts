import { NextRequest, NextResponse } from "next/server";
import { getStudyBundle, deleteStudy } from "@/lib/studies/service";
import { requireRole } from "@/lib/auth/rbac";
import { requireStudyScope } from "@/lib/auth/scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: NextRequest, context: { params: { id: string } }): Promise<NextResponse>;
export function GET(req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse>;
export async function GET(req: NextRequest, { params }: { params: { id: string } | Promise<{ id: string }> }) {
  params = await params;
  const denied = await requireRole(req, ["ADMIN", "CLINICIAN", "REVIEWER"]);
  if (denied) return denied;
  const scoped = await requireStudyScope(req, params.id);
  if (scoped.response) return scoped.response;
  if (!scoped.resource) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const bundle = await getStudyBundle(params.id);
  if (!bundle.study) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Never send server filesystem locations to the browser: stored-file
  // records keep their relative path and hashes, but not absolutePath.
  const files = (bundle.study as { files?: unknown }).files;
  const study = Array.isArray(files)
    ? { ...bundle.study, files: files.map((f) => { if (!f || typeof f !== "object") return f; const { absolutePath: _absolutePath, ...rest } = f as Record<string, unknown>; return rest; }) }
    : bundle.study;
  return NextResponse.json({ ...bundle, study });
}

export function DELETE(req: NextRequest, context: { params: { id: string } }): Promise<NextResponse>;
export function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse>;
export async function DELETE(req: NextRequest, { params }: { params: { id: string } | Promise<{ id: string }> }) {
  params = await params;
  const denied = await requireRole(req, ["ADMIN", "CLINICIAN"]);
  if (denied) return denied;
  const scoped = await requireStudyScope(req, params.id);
  if (scoped.response) return scoped.response;
  if (!scoped.resource) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const ok = await deleteStudy(params.id);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({
    deleted: true,
    deletion_semantics: "SOURCE_BYTES_REMOVED_HISTORY_RETAINED",
    note: "Source and derived files were removed where applicable; lifecycle-marked study, finalized report history, clinician review events, audit records, and recovery-journal evidence may be retained under policy.",
  });
}
