import { NextRequest, NextResponse } from "next/server";
import { compareStudies } from "@/lib/studies/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { previous, current } = await req.json();
    if (!previous || !current) {
      return NextResponse.json({ error: "previous and current study ids required" }, { status: 400 });
    }
    const outcome = await compareStudies(previous, current);
    return NextResponse.json(outcome);
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 400 });
  }
}
