import { NextRequest, NextResponse } from "next/server";
import { setStudySymptoms, getStudyBundle } from "@/lib/studies/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Structured symptom intake for a study. Symptoms are context only - they never create findings. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const result = await setStudySymptoms(params.id, body?.symptoms);
    if (!result.ok) return NextResponse.json({ error: "Invalid symptoms", errors: result.errors }, { status: 400 });
    return NextResponse.json({ stored: true, count: result.symptoms?.length ?? 0, symptoms: result.symptoms });
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const bundle = await getStudyBundle(params.id);
  if (!bundle.study) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ symptoms: bundle.study.symptoms ?? [] });
}
