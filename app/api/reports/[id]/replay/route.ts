import { NextRequest, NextResponse } from "next/server";
import { requireRole, requireSession } from "@/lib/auth/rbac";
import { replayLegacyReport, LegacyReplayError } from "@/lib/reports/replay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Explicit administrator action; replay never runs implicitly on read. */
export function POST(req: NextRequest, context: { params: { id: string } }): Promise<NextResponse>;
export function POST(req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse>;
export async function POST(req: NextRequest, context: { params: { id: string } | Promise<{ id: string }> }) {
  const denied = await requireRole(req, ["ADMIN"]);
  if (denied) return denied;
  const session = await requireSession(req);
  if (session.response || !session.user) return session.response ?? NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { id } = await context.params;
  if (!/^rep_[A-Za-z0-9._-]{1,240}$/.test(id)) return NextResponse.json({ error: "Invalid report id" }, { status: 400 });
  try {
    const body = await req.json().catch(() => ({})) as { reason?: unknown };
    const result = await replayLegacyReport(id, session.user.username, typeof body.reason === "string" ? body.reason : undefined);
    return NextResponse.json({ original_report_id: result.original_report_id, new_report_id: result.new_report_id, reasoning_record_id: result.reasoning_record_id, source_analysis_sha256: result.source_analysis_sha256, report: result.report }, { status: 201 });
  } catch (error) {
    if (error instanceof LegacyReplayError) return NextResponse.json({ error: error.code, detail: error.message }, { status: 422 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "legacy replay failed" }, { status: 400 });
  }
}
