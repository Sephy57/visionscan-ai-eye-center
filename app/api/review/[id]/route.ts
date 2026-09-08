import { NextRequest, NextResponse } from "next/server";
import { submitReview, ReviewInput } from "@/lib/studies/service";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/rbac";
import { validateSession, SESSION_COOKIE } from "@/lib/auth/sessions";
import { requireStudyScope } from "@/lib/auth/scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(req: NextRequest, context: { params: { id: string } }): Promise<NextResponse>;
export function POST(req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse>;
export async function POST(req: NextRequest, { params }: { params: { id: string } | Promise<{ id: string }> }) {
  params = await params;
  const denied = await requireRole(req, ["ADMIN", "CLINICIAN", "REVIEWER"]);
  if (denied) return denied;
  const scoped = await requireStudyScope(req, params.id);
  if (scoped.response) return scoped.response;
  if (!scoped.resource) return NextResponse.json({ error: "Report not found" }, { status: 404 });
  try {
    const body = (await req.json()) as ReviewInput;
    if (!body.action) {
      return NextResponse.json({ error: "action is required" }, { status: 400 });
    }
    // reviewer_id is ALWAYS taken from the authenticated session, never trusted
    // from the request body - otherwise one clinician could attribute a
    // review decision to another clinician's identity in the audit trail.
    const check = await validateSession(req.cookies.get(SESSION_COOKIE)?.value);
    body.reviewer_id = check.session!.username;
    const ALLOWED_ACTIONS = [
      "accept", "reject", "correct", "note", "add_observation", "finalize", "confirm", "indeterminate", "request_new_scan",
      "treatment_accept", "treatment_modify", "treatment_reject",
      "treatment_add_medication", "treatment_remove_medication",
      "treatment_mark_contraindication", "treatment_mark_restriction", "treatment_note",
    ];
    if (!ALLOWED_ACTIONS.includes(body.action)) {
      return NextResponse.json({ error: "invalid action" }, { status: 400 });
    }
    const report = await submitReview(params.id, body);
    if (!report) return NextResponse.json({ error: "Report not found" }, { status: 404 });
    return NextResponse.json({ report });
  } catch (err) {
    await audit({ actor: "clinician", action: "review", studyId: params.id, outcome: "error", detail: String(err).slice(0, 150) });
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 400 });
  }
}
