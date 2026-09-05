import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { requestStatusTransition } from "@/lib/models/transitions";
import { validateSession, SESSION_COOKIE } from "@/lib/auth/sessions";
import { ModelStatus } from "@/lib/models/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ADMIN-only: request a model lifecycle transition. Fails closed without sufficient evidence (see lib/models/transitions.ts). */
export async function POST(req: NextRequest, { params }: { params: { id: string } | Promise<{ id: string }> }) {
  params = await params;
  const denied = await requireRole(req, ["ADMIN"]);
  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as { to_status?: string; evidence_refs?: string[] } | null;
  if (!body?.to_status) return NextResponse.json({ error: "to_status is required" }, { status: 400 });

  const check = await validateSession(req.cookies.get(SESSION_COOKIE)?.value);
  const requestedBy = check.session!.username;

  const rec = await requestStatusTransition({
    model_id: params.id,
    to_status: body.to_status as ModelStatus,
    evidence_refs: Array.isArray(body.evidence_refs) ? body.evidence_refs.map(String) : [],
    requested_by: requestedBy,
  });
  return NextResponse.json({ transition: rec }, { status: rec.decision === "approved" ? 200 : 400 });
}
