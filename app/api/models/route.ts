import { NextRequest, NextResponse } from "next/server";
import { listModels, gateModelUse, auditRegistryConsistency } from "@/lib/models/registry";
import { ensureRegistryHydrated } from "@/lib/models/registryPersistence";
import { verifyModelIntegrity } from "@/lib/models/integrity";
import { ADAPTER_REGISTRY } from "@/lib/devices/adapter";
import { generateModelCard } from "@/lib/reports/modelCard";
import { COMPONENTS } from "@/lib/models/registry";
import { requireRole } from "@/lib/auth/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = await requireRole(req, ["ADMIN", "CLINICIAN", "REVIEWER", "RESEARCHER"]);
  if (denied) return denied;
  await ensureRegistryHydrated();
  const consistencyProblems = auditRegistryConsistency();
  const models = listModels().map((m) => {
    const integrity = verifyModelIntegrity(m.model_id);
    return {
      ...m,
      sha256_masked: m.sha256 ? m.sha256.slice(0, 12) + "…" : null,
      gate: gateModelUse(m),
      integrity: { trusted: integrity.trusted, checks: integrity.checks },
      model_card: generateModelCard(m),
    };
  });
  const installedResearchArtifacts = models.filter((m) => Boolean(m.file_path && m.sha256 && m.integrity.trusted));
  return NextResponse.json({
    models,
    consistency_problems: consistencyProblems,
    components: Object.values(COMPONENTS),
    adapters: ADAPTER_REGISTRY,
    model_store_status: {
      // Redacted: the UI never needs the server filesystem location.
      path: "<configured-model-root>",
      populated: installedResearchArtifacts.length > 0,
      note: installedResearchArtifacts.length > 0
        ? `${installedResearchArtifacts.length} hash-verified research artifact(s) are installed. All remain RESEARCH-only; no clinical validation is claimed.`
        : "No model artifacts are installed. This deployment exposes only the synthetic DEMO path.",
    },
  });
}
