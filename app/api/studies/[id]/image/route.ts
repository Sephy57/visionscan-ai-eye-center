import { NextRequest, NextResponse } from "next/server";
import { readOriginalScan } from "@/lib/storage/files";
import { EXT_TO_MIME } from "@/lib/imaging/dicom";
import fs from "fs";
import path from "path";
import { UPLOAD_ROOT } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Serves the original scan bytes for the in-app image viewer. No-cache; local only. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const bytes = await readOriginalScan(params.id);
  if (!bytes) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const dir = path.join(UPLOAD_ROOT, params.id);
  const file = fs.readdirSync(dir).find((f) => f.startsWith("original"));
  const ext = path.extname(file ?? "").toLowerCase();
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": EXT_TO_MIME[ext] ?? "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
