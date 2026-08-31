import { NextResponse } from "next/server";
import { runSelfTest, SelfTestReport } from "@/tests/selftest";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const report: SelfTestReport = await runSelfTest();
  await audit({ actor: "system", action: "selftest", outcome: report.all_passed ? "ok" : "error", detail: `${report.passed}/${report.total} checks passed` });
  return NextResponse.json(report);
}
