import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { VALIDATION_REGISTRY, VALIDATION_REGISTRY_VERSION } from "@/lib/models/validationRegistry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Read-only validation inventory. It never executes a model. */
export async function GET(req: NextRequest) {
  const denied = await requireRole(req, ["ADMIN"]);
  if (denied) return denied;
  return NextResponse.json({
    schema_version: "1",
    registry_version: VALIDATION_REGISTRY_VERSION,
    entries: VALIDATION_REGISTRY,
    notice: "Research validation evidence only. No entry here is clinical validation; absence of evidence for a target must never be interpreted as normality.",
  });
}
