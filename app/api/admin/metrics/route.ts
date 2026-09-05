import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { snapshotMetrics } from "@/lib/observability/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Admin-only operational snapshot. It contains counters and timings only. */
export async function GET(req: NextRequest) {
  const denied = await requireRole(req, ["ADMIN"]);
  if (denied) return denied;
  return NextResponse.json({
    scope: "process_local",
    phi_included: false,
    persistence: "none",
    metrics: snapshotMetrics(),
  });
}

