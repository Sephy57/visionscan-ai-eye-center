import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { getPatientProfile } from "@/lib/patients/service";
import { buildPatientTimeline } from "@/lib/patients/timeline";
import { requirePatientScope } from "@/lib/auth/scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Patient profile (eye-center workspace): patient record + all encounters
 * (chronological) + the longitudinal study timeline built from REAL stored
 * study timestamps. Read-only; 404 for unknown patients.
 */
export function GET(req: NextRequest, context: { params: { id: string } }): Promise<NextResponse>;
export function GET(req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse>;
export async function GET(req: NextRequest, { params }: { params: { id: string } | Promise<{ id: string }> }) {
  params = await params;
  const denied = await requireRole(req, ["ADMIN", "CLINICIAN", "REVIEWER"]);
  if (denied) return denied;

  const scoped = await requirePatientScope(req, params.id);
  if (scoped.response) return scoped.response;
  if (!scoped.resource) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const profile = await getPatientProfile(params.id);
  if (!profile) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Timeline is built from the patient's linked studies; studies with a
  // matching patient_ref but no encounter linkage are intentionally NOT
  // auto-added here - linkage is explicit (see createEncounter).
  const studyIds = profile.encounters.flatMap((e) => e.linked_study_ids ?? []);
  const timeline = await buildPatientTimeline(studyIds);

  return NextResponse.json({
    patient: profile.patient,
    encounters: profile.encounters,
    timeline,
  });
}
