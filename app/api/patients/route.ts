import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { requireSession } from "@/lib/auth/rbac";
import { listPatients, ensurePatient, findPatientByRef } from "@/lib/patients/service";
import { filterScopedResources, hasPatientScope } from "@/lib/auth/scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Patient registry (eye-center workspace).
 * GET  - list/search patients (CLINICIAN, REVIEWER, ADMIN).
 * POST - create a patient record from a user-supplied patient_ref. The ref
 *        is never invented here; a request without one is rejected.
 */
export async function GET(req: NextRequest) {
  const denied = await requireRole(req, ["ADMIN", "CLINICIAN", "REVIEWER"]);
  if (denied) return denied;
  const { user } = await requireSession(req);
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const q = req.nextUrl.searchParams.get("q") ?? undefined;
  const patients = await listPatients(q ?? undefined);
  const visible = await filterScopedResources(user, patients);
  return NextResponse.json({ patients: visible });
}

export async function POST(req: NextRequest) {
  const denied = await requireRole(req, ["ADMIN", "CLINICIAN"]);
  if (denied) return denied;
  try {
    const body = await req.json();
    const ref = typeof body?.patient_ref === "string" ? body.patient_ref.trim() : "";
    if (!ref || ref.length > 64) {
      return NextResponse.json({ error: "patient_ref is required (1-64 characters)" }, { status: 400 });
    }
    // validateSession-derived user is attached by requireRole; fetch it for
    // the audit trail.
    const { requireSession } = await import("@/lib/auth/rbac");
    const { user } = await requireSession(req);
    if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    const existing = await findPatientByRef(ref, { tenant_id: user.tenant_id ?? null });
    if (existing && !(await hasPatientScope(user, existing))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const patient = await ensurePatient(
      ref,
      user?.username ?? "unknown",
      "CLINICIAN_CREATED",
      typeof body?.display_label === "string" ? body.display_label : null,
      { tenant_id: user.tenant_id ?? null, owner_user_id: user.user_id, owner_username: user.username }
    );
    return NextResponse.json({ patient }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}
