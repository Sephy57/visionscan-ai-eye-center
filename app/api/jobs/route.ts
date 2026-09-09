import { NextRequest, NextResponse } from "next/server";
import { listJobsPage, type JobKind, type JobStatus } from "@/lib/jobs/queue";
import { requireRole } from "@/lib/auth/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const JOB_STATUSES = new Set<JobStatus>(["queued", "running", "stale", "retryable", "completed", "failed", "cancelled"]);
const JOB_KINDS = new Set<JobKind>(["analysis", "extraction"]);

/** Admin-only bounded operations listing; individual job scope remains on /api/jobs/:id. */
export async function GET(req: NextRequest) {
  const denied = await requireRole(req, ["ADMIN"]);
  if (denied) return denied;
  const statusParam = req.nextUrl.searchParams.get("status") ?? undefined;
  const kindParam = req.nextUrl.searchParams.get("kind") ?? undefined;
  if (statusParam && !JOB_STATUSES.has(statusParam as JobStatus)) {
    return NextResponse.json({ error: "Invalid job status" }, { status: 400 });
  }
  if (kindParam && !JOB_KINDS.has(kindParam as JobKind)) {
    return NextResponse.json({ error: "Invalid job kind" }, { status: 400 });
  }
  const rawLimit = Number(req.nextUrl.searchParams.get("limit"));
  const limit = Number.isFinite(rawLimit) ? rawLimit : undefined;
  const cursor = req.nextUrl.searchParams.get("cursor") ?? undefined;
  try {
    const page = await listJobsPage({
      status: statusParam as JobStatus | undefined,
      kind: kindParam as JobKind | undefined,
      limit,
      cursor,
    });
    return NextResponse.json({
      jobs: page.items,
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
