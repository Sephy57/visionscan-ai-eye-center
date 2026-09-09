import { NextRequest, NextResponse } from "next/server";
import { recentAuditPage, verifyAuditChain } from "@/lib/audit";
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
  const rawLimit = Number(req.nextUrl.searchParams.get("limit"));
  const limit = Number.isFinite(rawLimit) ? rawLimit : undefined;
  const cursor = req.nextUrl.searchParams.get("cursor") ?? undefined;
  try {
    const [auditPage, chain] = await Promise.all([recentAuditPage({ limit, cursor }), verifyAuditChain()]);
    return NextResponse.json({
      validation_banner: VALIDATION_STATUS_BANNER,
      audit_tail: auditPage.events,
      next_cursor: auditPage.next_cursor,
      has_more: auditPage.has_more,
      limit: auditPage.limit,
      audit_chain_integrity: chain,
      components: Object.values(COMPONENTS),
      adapters: ADAPTER_REGISTRY,
      operational_metrics: {
        scope: "process_local",
        phi_included: false,
        metrics: snapshotMetrics(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid pagination request";
    if (/audit pagination (cursor|scan)/i.test(message)) return NextResponse.json({ error: message }, { status: 400 });
    throw error;
  }
}
