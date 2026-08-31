import { NextRequest, NextResponse } from "next/server";
import { submitReview, ReviewInput } from "@/lib/studies/service";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = (await req.json()) as ReviewInput;
    if (!body.reviewer_id || !body.action) {
      return NextResponse.json({ error: "reviewer_id and action are required" }, { status: 400 });
    }
    if (!["accept", "reject", "correct", "note", "finalize", "confirm", "indeterminate", "request_new_scan"].includes(body.action)) {
      return NextResponse.json({ error: "invalid action" }, { status: 400 });
    }
    const report = await submitReview(params.id, body);
    if (!report) return NextResponse.json({ error: "Report not found" }, { status: 404 });
    return NextResponse.json({ report });
  } catch (err) {
    await audit({ actor: "clinician", action: "review", studyId: params.id, outcome: "error", detail: String(err).slice(0, 150) });
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 400 });
  }
}
