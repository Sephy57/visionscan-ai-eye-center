import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { PROJECT_ROOT } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type JsonRecord = Record<string, any>;

function readJson(relativePath: string): JsonRecord | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, relativePath), "utf8")) as JsonRecord;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const denied = await requireRole(req, ["ADMIN", "REVIEWER", "RESEARCHER"]);
  if (denied) return denied;
  const runtime = readJson("docs/generated/phase9-runtime-controls.json");
  const external = readJson("docs/generated/phase9-external-validation-readiness.json");
  const manifest = readJson("docs/generated/phase9-governed-release-manifest.json");
  return NextResponse.json({
    schema_version: "visionscan-phase9-validation-v1",
    generated_at: new Date().toISOString(),
    scope: "aggregate_internal_research_review",
    phi_included: false,
    notice: "Phase 9 is a controlled research release candidate. It does not establish clinical validation, disease recovery, diagnostic accuracy, or normality.",
    classifications: manifest?.classifications ?? {
      engineering: "ENGINEERING PARTIAL — BLOCKERS REMAIN",
      retinal_review_intelligence: "RETINAL REVIEW INTELLIGENCE PARTIAL — INTERNAL HELD-OUT EVIDENCE ONLY",
      local_runtime: "LOCAL RUNTIME PARTIAL",
      data: "DATA RELEASE BLOCKED",
      clinical: ["NOT CLINICALLY VALIDATED", "NOT A MEDICAL DEVICE", "NOT FOR AUTONOMOUS DIAGNOSIS"],
    },
    runtime_controls: runtime ?? { status: "NOT_MEASURED" },
    external_validation_readiness: external ?? { decision: "NOT_MEASURED" },
    governed_release: manifest ?? { release_state: "BLOCKED" },
  }, { headers: { "cache-control": "no-store" } });
}
