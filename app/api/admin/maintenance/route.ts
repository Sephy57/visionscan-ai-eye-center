import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { databaseMaintenance } from "@/lib/storage/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Admin-only integrity/WAL/statistics snapshot. It never runs inference and
 * never performs destructive VACUUM/cleanup work. */
export async function GET(req: NextRequest) {
  const denied = await requireRole(req, ["ADMIN"]);
  if (denied) return denied;
  return NextResponse.json(await databaseMaintenance(), { headers: { "cache-control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const denied = await requireRole(req, ["ADMIN"]);
  if (denied) return denied;
  const action = req.nextUrl.searchParams.get("action") ?? "stats";
  if (!["stats", "integrity_check", "wal_checkpoint"].includes(action)) return NextResponse.json({ error: "unsupported maintenance action" }, { status: 400 });
  const result = await databaseMaintenance();
  return NextResponse.json({ ...result, action }, { status: 200 });
}

