import { NextResponse } from "next/server";
import { recentAudit } from "@/lib/audit";
import { ADAPTER_REGISTRY } from "@/lib/devices/adapter";
import { COMPONENTS } from "@/lib/models/registry";
import { VALIDATION_STATUS_BANNER } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const events = await recentAudit(200);
  return NextResponse.json({
    validation_banner: VALIDATION_STATUS_BANNER,
    audit_tail: events,
    components: Object.values(COMPONENTS),
    adapters: ADAPTER_REGISTRY,
  });
}
