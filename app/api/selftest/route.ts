import { NextRequest, NextResponse } from "next/server";
import { runSelfTest, SelfTestReport } from "@/tests/selftest";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Locked (S0.3): the self-test exercises the real pipeline against real D:
 * storage, so it must never be publicly reachable once real documents or
 * patient data exist. Narrowest role: ADMIN (system-administration function).
 * Unauthenticated -> 401, authenticated-but-unauthorized -> 403.
 */
export async function GET(req: NextRequest) {
  const denied = await requireRole(req, ["ADMIN"]);
  if (denied) return denied;
  const report: SelfTestReport = await runSelfTest();
  await audit({ actor: "system", action: "selftest", outcome: report.all_passed ? "ok" : "error", detail: `${report.passed}/${report.total} checks passed` });
  return NextResponse.json(report);
}
