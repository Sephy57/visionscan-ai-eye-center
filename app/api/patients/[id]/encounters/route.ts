import { NextRequest, NextResponse } from "next/server";
import { requireRole, requireSession } from "@/lib/auth/rbac";
import { createEncounter, listEncountersForPatient } from "@/lib/patients/service";
import { requirePatientScope } from "@/lib/auth/scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Encounters for a patient (eye-center workspace).
 * GET  - chronological encounter list.
 * POST - create a validated encounter (fail-closed validation; linked
 *        studies must exist and match the patient's ref).
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } | Promise<{ id: string }> }) {
  params = await params;
  const denied = await requireRole(req, ["ADMIN", "CLINICIAN", "REVIEWER"]);
  if (denied) return denied;
  const scoped = await requirePatientScope(req, params.id);
  if (scoped.response) return scoped.response;
  if (!scoped.resource) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const encounters = await listEncountersForPatient(params.id);
  return NextResponse.json({ encounters });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } | Promise<{ id: string }> }) {
  params = await params;
  const denied = await requireRole(req, ["ADMIN", "CLINICIAN"]);
  if (denied) return denied;
  const scoped = await requirePatientScope(req, params.id);
  if (scoped.response) return scoped.response;
  if (!scoped.resource) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { user } = await requireSession(req);
  try {
    const body = await req.json();
    const result = await createEncounter({
      patient_id: params.id,
      chief_complaint: typeof body?.chief_complaint === "string" ? body.chief_complaint.slice(0, 500) : null,
      symptoms: Array.isArray(body?.symptoms) ? body.symptoms : undefined,
      ocular_history: Array.isArray(body?.ocular_history) ? body.ocular_history : undefined,
      ocular_surgery_history: Array.isArray(body?.ocular_surgery_history) ? body.ocular_surgery_history : undefined,
      medications: Array.isArray(body?.medications) ? body.medications : undefined,
      allergies: Array.isArray(body?.allergies) ? body.allergies : undefined,
      systemic_history: body?.systemic_history ?? null,
      linked_study_ids: Array.isArray(body?.linked_study_ids)
        ? body.linked_study_ids.filter((s: unknown) => typeof s === "string")
        : [],
      created_by: user?.username ?? "unknown",
    });
    if (!result.ok) {
      const status = result.errors ? 400 : (result.status ?? 400);
      return NextResponse.json({ error: result.error ?? "Invalid encounter", errors: result.errors }, { status });
    }
    return NextResponse.json({ encounter: result.encounter }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}
