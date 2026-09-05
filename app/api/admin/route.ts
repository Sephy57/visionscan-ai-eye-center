import { NextRequest, NextResponse } from "next/server";
import { recentAudit, verifyAuditChain } from "@/lib/audit";
import { ADAPTER_REGISTRY } from "@/lib/devices/adapter";
import { COMPONENTS } from "@/lib/models/registry";
import { VALIDATION_STATUS_BANNER } from "@/lib/config";
import { requireRole } from "@/lib/auth/rbac";
import { snapshotMetrics } from "@/lib/observability/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = await requireRole(req, ["ADMIN"]);
  if (denied) return denied;
  const events = await recentAudit(200);
  const chain = await verifyAuditChain();
  return NextResponse.json({
    validation_banner: VALIDATION_STATUS_BANNER,
    audit_tail: events,
    audit_chain_integrity: chain,
    components: Object.values(COMPONENTS),
    adapters: ADAPTER_REGISTRY,
    operational_metrics: {
      scope: "process_local",
      phi_included: false,
      metrics: snapshotMetrics(),
    },
  });
}
