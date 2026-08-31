import { NextResponse } from "next/server";
import { listStudies } from "@/lib/studies/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const studies = await listStudies();
  return NextResponse.json({
    studies: studies.map((s) => ({
      study_id: s.study_id,
      created_at: s.created_at,
      modality: s.modality,
      eye: s.eye,
      status: s.status,
      sha256: s.original_sha256,
    })),
  });
}
