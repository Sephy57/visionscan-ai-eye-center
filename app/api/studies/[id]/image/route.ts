import { NextRequest, NextResponse } from "next/server";
import { readOriginalScan } from "@/lib/storage/files";
import { EXT_TO_MIME } from "@/lib/imaging/dicom";
import fs from "fs";
import { UPLOAD_ROOT, safeJoin } from "@/lib/config";
import { requireRole } from "@/lib/auth/rbac";
import { requireStudyScope } from "@/lib/auth/scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Serves the original scan bytes for the in-app image viewer. No-cache; requires clinical-staff role. */
export function GET(req: NextRequest, context: { params: { id: string } }): Promise<NextResponse>;
export function GET(req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse>;
export async function GET(req: NextRequest, { params }: { params: { id: string } | Promise<{ id: string }> }) {
  params = await params;
  const denied = await requireRole(req, ["ADMIN", "CLINICIAN", "REVIEWER"]);
  if (denied) return denied;

  const scoped = await requireStudyScope(req, params.id);
  if (scoped.response) return scoped.response;
  if (!scoped.resource) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const bytes = await readOriginalScan(params.id); // fails closed (returns null) on path traversal - see lib/storage/files.ts
  if (!bytes) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let ext = "";
  try {
    const dir = safeJoin(UPLOAD_ROOT, params.id);
    const file = fs.readdirSync(dir).find((f) => f.startsWith("original"));
    ext = file ? file.slice(file.lastIndexOf(".")).toLowerCase() : "";
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": EXT_TO_MIME[ext] ?? "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
