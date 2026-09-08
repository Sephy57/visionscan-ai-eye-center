import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { requirePatientScope, requireStudyScope } from "@/lib/auth/scope";
import { assessEncounterCrossModality } from "@/lib/evidence/encounterCrossModality";
import type { StoredEncounter } from "@/lib/patients/service";
import { dbGet } from "@/lib/storage/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only encounter-scoped FUNDUS + OCT comparison.
 *
 * Authorization is deliberately two-dimensional: the caller must have a
 * review role and access to the encounter's patient plus every linked study.
 * The endpoint never starts inference and returns only categorical,
 * provenance-bearing comparison states.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  params = await params;
  const denied = await requireRole(req, ["ADMIN", "CLINICIAN", "REVIEWER"]);
  if (denied) return denied;

  const encounter = await dbGet<StoredEncounter>("encounters", params.id);
  if (!encounter) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const patientScope = await requirePatientScope(req, encounter.patient_id);
  if (patientScope.response) return patientScope.response;
  if (!patientScope.resource) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Linked study ids are untrusted storage references. Require scope for each
  // one before the comparison helper reads its analysis, so a malformed or
  // cross-tenant encounter cannot exfiltrate another patient's result.
  for (const studyId of encounter.linked_study_ids ?? []) {
    const scoped = await requireStudyScope(req, studyId);
    if (scoped.response) return scoped.response;
    if (!scoped.resource) return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const assessment = await assessEncounterCrossModality(encounter);
  return NextResponse.json({
    schema_version: "1",
    ...assessment,
    notice: "Categorical research comparison only. No score fusion, diagnosis, normality claim, or implicit analysis execution.",
  });
}

