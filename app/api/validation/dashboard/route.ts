import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { listEvaluationRuns } from "@/lib/research/evaluationRuns";
import { validationDashboardSummary } from "@/lib/research/validationDashboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Aggregate-only validation dashboard. Never returns evaluation cases. */
export async function GET(req: NextRequest) {
  const denied = await requireRole(req, ["ADMIN", "RESEARCHER"]);
  if (denied) return denied;
  return NextResponse.json(validationDashboardSummary(await listEvaluationRuns()));
}

