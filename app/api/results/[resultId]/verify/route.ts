import { NextRequest, NextResponse } from "next/server";
import { requireRole, requireSession } from "@/lib/auth/rbac";
import { verifyTestResult } from "@/lib/documents/extraction/testResultService";
import { requireResultScope } from "@/lib/auth/scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Human verification of a structured test result (S3 server core of the
 * S4 workflow). Roles: ADMIN, CLINICIAN, REVIEWER - clinical judgment roles
 * only; TECHNICIAN/RESEARCHER excluded.
 *
 * POST body: { action: "verify" | "correct" | "reject" | "unreview", note?, correction? }
 * Corrections NEVER overwrite the original extraction; they are stored as a
 * clinician-authored correction with full history. Every action is audited.
 */
export function POST(req: NextRequest, context: { params: { resultId: string } }): Promise<NextResponse>;
export function POST(req: NextRequest, context: { params: Promise<{ resultId: string }> }): Promise<NextResponse>;
export async function POST(req: NextRequest, { params }: { params: { resultId: string } | Promise<{ resultId: string }> }) {
  params = await params;
  const denied = await requireRole(req, ["ADMIN", "CLINICIAN", "REVIEWER"]);
  if (denied) return denied;
  const body = await req.json().catch(() => null);
  const action = body?.action;
  if (!["verify", "correct", "reject", "unreview"].includes(action)) {
    return NextResponse.json({ error: "VALIDATION", message: "action must be verify | correct | reject | unreview" }, { status: 400 });
  }
  const scoped = await requireResultScope(req, params.resultId);
  if (scoped.response) return scoped.response;
  if (!scoped.resource) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const { user } = await requireSession(req);

  const outcome = await verifyTestResult(params.resultId, {
    action,
    actor: user?.username ?? "unknown",
    note: typeof body?.note === "string" ? body.note.slice(0, 500) : undefined,
    correction: body?.correction,
  });
  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.error }, { status: outcome.httpStatus });
  }
  return NextResponse.json({ result: outcome.result });
}
