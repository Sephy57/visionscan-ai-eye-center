import { NextRequest, NextResponse } from "next/server";
import { listReportSummariesPage } from "@/lib/reports/generator";
import { requireRole } from "@/lib/auth/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Admin-only report registry index. Full report payloads stay on scoped study routes. */
export async function GET(req: NextRequest) {
  const denied = await requireRole(req, ["ADMIN"]);
  if (denied) return denied;
  const studyId = req.nextUrl.searchParams.get("study_id") ?? undefined;
  if (studyId && !/^study_[A-Za-z0-9._-]{1,240}$/.test(studyId)) {
    return NextResponse.json({ error: "Invalid study id" }, { status: 400 });
  }
  const rawLimit = Number(req.nextUrl.searchParams.get("limit"));
  const limit = Number.isFinite(rawLimit) ? rawLimit : undefined;
  const cursor = req.nextUrl.searchParams.get("cursor") ?? undefined;
  try {
    const page = await listReportSummariesPage({ study_id: studyId, limit, cursor });
    return NextResponse.json({
      reports: page.items,
      next_cursor: page.next_cursor,
      has_more: page.has_more,
      limit: page.limit,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid pagination request";
    if (/pagination (cursor|scan)/i.test(message)) return NextResponse.json({ error: message }, { status: 400 });
    throw error;
  }
}
