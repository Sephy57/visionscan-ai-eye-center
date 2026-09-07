import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { activeProductionCoverage, OPHTHALMIC_COVERAGE_REGISTRY, OPHTHALMIC_COVERAGE_VERSION } from "@/lib/models/ophthalmicCoverage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Read-only technical/governance inventory. It never executes a model. */
export async function GET(req: NextRequest) {
  const denied = await requireRole(req, ["ADMIN"]);
  if (denied) return denied;
  return NextResponse.json({
    schema_version: "1",
    coverage_version: OPHTHALMIC_COVERAGE_VERSION,
    production_coverage_count: activeProductionCoverage().length,
    entries: OPHTHALMIC_COVERAGE_REGISTRY,
    global_notice: "No clinically validated ophthalmic image model is active. Unsupported or unavailable targets must never be interpreted as normal.",
  });
}
