import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { checkModelHealth } from "@/lib/models/provider";
import { ensureRegistryHydrated } from "@/lib/models/registryPersistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/models/:id/health - load/validate/unload health check (fails closed). */
export function GET(req: NextRequest, context: { params: { id: string } }): Promise<NextResponse>;
export function GET(req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse>;
export async function GET(req: NextRequest, { params }: { params: { id: string } | Promise<{ id: string }> }) {
  params = await params;
  const denied = await requireRole(req, ["ADMIN", "CLINICIAN", "REVIEWER", "RESEARCHER"]);
  if (denied) return denied;
  await ensureRegistryHydrated();
  const health = await checkModelHealth(params.id);
  return NextResponse.json(health);
}
