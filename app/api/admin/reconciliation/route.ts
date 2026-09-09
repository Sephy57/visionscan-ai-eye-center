import { NextRequest, NextResponse } from "next/server";
import { requireRole, requireSession } from "@/lib/auth/rbac";
import { applyReconciliationRepair, scanReconciliation, type ReconciliationIssue } from "@/lib/storage/reconciliation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Admin-only, read-only-by-default reconciliation plan. */
export async function GET(req: NextRequest) {
  const denied = await requireRole(req, ["ADMIN"]);
  if (denied) return denied;
  return NextResponse.json(await scanReconciliation(), { headers: { "cache-control": "no-store" } });
}

/** Explicit repair request. No action is implicit and originals are never
 * deleted or overwritten by this endpoint. */
export async function POST(req: NextRequest) {
  const denied = await requireRole(req, ["ADMIN"]);
  if (denied) return denied;
  const session = await requireSession(req);
  if (session.response || !session.user) return session.response ?? NextResponse.json({ error: "Authentication required." }, { status: 401 });
  try {
    const body = await req.json() as { issue?: ReconciliationIssue; action?: string };
    if (!body.issue || typeof body.issue.issue_id !== "string" || typeof body.action !== "string") return NextResponse.json({ error: "issue and action are required" }, { status: 400 });
    const allowed = ["mark_unavailable", "rebuild_derivative", "reattach_immutable_file", "quarantine_orphan", "manual_review"] as const;
    if (!(allowed as readonly string[]).includes(body.action)) return NextResponse.json({ error: "unsupported repair action" }, { status: 400 });
    const result = await applyReconciliationRepair(body.issue, body.action as (typeof allowed)[number], session.user.username);
    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "repair request rejected" }, { status: 400 });
  }
}

