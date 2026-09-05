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
  return NextResponse.json({
    models,
    consistency_problems: consistencyProblems,
    components: Object.values(COMPONENTS),
    adapters: ADAPTER_REGISTRY,
    model_store_status: {
      path: "D:\\AI EYE ANALYSIS PLATFORM\\data\\models",
      populated: false,
      note: "data\\models is intentionally empty. No validated medical model is installed. This is a correct and acceptable state.",
    },
  });
}
