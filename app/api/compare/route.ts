import { NextRequest, NextResponse } from "next/server";
import { compareStudies } from "@/lib/studies/service";
import { requireRole } from "@/lib/auth/rbac";
import { requireStudyPairScope } from "@/lib/auth/scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const denied = await requireRole(req, ["ADMIN", "CLINICIAN", "REVIEWER"]);
  if (denied) return denied;
  try {
    const { previous, current } = await req.json();
    if (!previous || !current) {
      return NextResponse.json({ error: "previous and current study ids required" }, { status: 400 });
    }
    if (typeof previous !== "string" || typeof current !== "string") {
      return NextResponse.json({ error: "previous and current study ids must be strings" }, { status: 400 });
    }
    const scoped = await requireStudyPairScope(req, previous, current);
    if (scoped.response) return scoped.response;
    const outcome = await compareStudies(previous, current);
    return NextResponse.json(outcome);
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 400 });
  }
}
