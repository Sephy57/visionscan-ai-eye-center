import { NextRequest, NextResponse } from "next/server";
import { requireRole, requireSession } from "@/lib/auth/rbac";
import { createModelError, listModelErrors, transitionModelError } from "@/lib/validation/modelErrorStore";
import { validateModelErrorRecord } from "@/lib/validation/modelErrorRegistry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Aggregate/structured model-error registry endpoint. It is limited to
 * ADMIN/RESEARCHER roles and accepts only synthetic-case records. Raw model
 * output, source bytes, patient identifiers, and free-text reviewer notes are
 * rejected by the registry validator before persistence.
 */
export async function GET(req: NextRequest) {
  const denied = await requireRole(req, ["ADMIN", "RESEARCHER", "CLINICIAN"]);
  if (denied) return denied;
  const modelId = req.nextUrl.searchParams.get("model_id") ?? undefined;
  const errors = await listModelErrors({ model_id: modelId });
  return NextResponse.json({
    schema_version: "visionscan-model-error-dashboard-v1",
    phi_included: false,
    errors,
    note: "Synthetic validation errors only. Lifecycle transitions require explicit human reviewer roles; no clinical resolution is inferred.",
  });
}

/** POST creates a synthetic error or transitions an existing error. */
export async function POST(req: NextRequest) {
  const denied = await requireRole(req, ["ADMIN", "RESEARCHER", "CLINICIAN"]);
  if (denied) return denied;
  const session = await requireSession(req);
  if (session.response || !session.user) return session.response ?? NextResponse.json({ error: "Authentication required." }, { status: 401 });
  try {
    const body = await req.json();
    if (body?.action === "transition") {
      if (typeof body.error_id !== "string" || typeof body.lifecycle !== "string" || typeof body.reviewer_role !== "string") {
        return NextResponse.json({ error: "error_id, lifecycle, reviewer_role required" }, { status: 400 });
      }
      const expectedRole = session.user.role === "CLINICIAN" ? "CLINICIAN_REVIEWER" : "VALIDATION_REVIEWER";
      if (body.reviewer_role !== expectedRole) {
        return NextResponse.json({ error: "Reviewer role must match the authenticated session." }, { status: 403 });
      }
      const record = await transitionModelError(body.error_id, {
        lifecycle: body.lifecycle,
        reviewer_role: body.reviewer_role,
        outcome: body.outcome,
        rationale_code: body.rationale_code,
        remediation: body.remediation,
      });
      return NextResponse.json(record);
    }
    const validation = validateModelErrorRecord({ ...body, schema_version: body?.schema_version ?? "visionscan-model-error-v1" });
    if (!validation.valid || !validation.record) {
      return NextResponse.json({ error: "Invalid synthetic model error record", details: validation.errors }, { status: 400 });
    }
    const record = await createModelError(validation.record);
    return NextResponse.json(record, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Validation error rejected" }, { status: 400 });
  }
}
