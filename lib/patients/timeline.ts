/**
 * Patient Timeline (Phase 5, §8).
 *
 * HARD RULE: this is a REFERENCE structure. It orders existing studies (and,
 * through them, existing evidence) chronologically - it never duplicates the
 * underlying StudyRecord/EvidenceItem/Finding data, and it never invents a
 * "Patient" database entity. Study/encounter linkage is read from the
 * explicit PatientEncounter.linked_study_ids relationship when present; a
 * timeline is still built from caller-supplied study ids (or an explicit
 * patient_ref lookup), never from fuzzy identity matching.
 */

import { dbGet, dbAll } from "../storage/db";
import type { StudyRecord } from "../studies/service";
import type { StoredEncounter } from "./service";

export interface TimelineEvent {
  study_id: string;
  encounter_id: string | null; // explicit PatientEncounter link, when one exists
  timestamp: string; // StudyRecord.created_at - always-present study timestamp
  laterality_scope: "OD" | "OS" | "OU" | "PATIENT_LEVEL" | "UNKNOWN";
  modality: string;
}

export interface PatientTimeline {
  patient_ref: string | null;
  study_ids: string[]; // ordered chronologically, oldest first
  events: TimelineEvent[];
  generated_at: string;
}

function scopeFromEye(eye: string): TimelineEvent["laterality_scope"] {
  const e = eye.toLowerCase();
  if (e === "right" || e === "od") return "OD";
  if (e === "left" || e === "os") return "OS";
  if (e === "both" || e === "ou") return "OU";
  return "UNKNOWN";
}

function normalizeTenant(value: string | null | undefined): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
}

/**
 * Builds a timeline from an explicit, caller-supplied list of study ids.
 * Studies are re-fetched and re-sorted by their REAL stored created_at -
 * caller-supplied ORDER is never trusted (§28 - reordered/spoofed
 * encounter ordering must not silently persist).
 */
export async function buildPatientTimeline(studyIds: string[]): Promise<PatientTimeline> {
  const studies: StudyRecord[] = [];
  for (const id of [...new Set(studyIds)]) {
    const s = await dbGet<StudyRecord>("studies", id);
    if (s) studies.push(s);
  }
  studies.sort((a, b) => a.created_at.localeCompare(b.created_at));

  const patientRefs = new Set(studies.map((s) => s.patient_ref).filter((r): r is string => !!r));
  // Cross-patient isolation (§28): if the supplied study ids span more than
  // one distinct patient_ref, this is NOT one patient's timeline - fail
  // closed rather than silently merging two different patients' evidence.
  const patient_ref = patientRefs.size === 1 ? [...patientRefs][0] : null;
  if (patientRefs.size > 1) {
    throw new Error("buildPatientTimeline: supplied study ids belong to more than one distinct patient_ref - refusing to build a merged timeline.");
  }

  // Tenant is an independent isolation boundary. A caller that supplies
  // studies from different tenants (or combines a tenant-bound study with a
  // legacy unscoped study) must not receive a merged timeline, even when the
  // patient_ref happens to be identical. All-legacy studies remain compatible
  // with local development fixtures.
  const tenantIds = new Set(studies.map((s) => normalizeTenant(s.tenant_id)));
  const nonNullTenants = new Set([...tenantIds].filter((tenant): tenant is string => !!tenant));
  const mixesLegacyAndTenant = tenantIds.has(null) && nonNullTenants.size > 0;
  if (nonNullTenants.size > 1 || mixesLegacyAndTenant) {
    throw new Error("buildPatientTimeline: supplied study ids cross tenant boundaries - refusing to build a merged timeline.");
  }

  // Studies created through the eye-center workflow are explicitly linked to
  // an encounter. Pick the most recently-created linked encounter if legacy
  // data contains more than one; an absent link remains null and is surfaced
  // as incomplete context rather than guessed.
  const encounters = await dbAll<StoredEncounter>("encounters");
  const encounterByStudy = new Map<string, StoredEncounter>();
  for (const encounter of encounters) {
    for (const studyId of encounter.linked_study_ids ?? []) {
      const existing = encounterByStudy.get(studyId);
      if (!existing || encounter.created_at > existing.created_at) {
        encounterByStudy.set(studyId, encounter);
      }
    }
  }

  return {
    patient_ref,
    study_ids: studies.map((s) => s.study_id),
    events: studies.map((s) => ({
      study_id: s.study_id,
      encounter_id: encounterByStudy.get(s.study_id)?.encounter_id ?? null,
      timestamp: s.created_at,
      laterality_scope: scopeFromEye(s.eye),
      modality: s.modality,
    })),
    generated_at: new Date().toISOString(),
  };
}

/**
 * Finds every study sharing a given patient_ref (an explicit, honest
 * alternative to caller-supplied study ids). Returns [] for an unset/empty
 * ref rather than matching every unrelated study with no ref at all.
 */
export async function findStudiesByPatientRef(patientRef: string): Promise<string[]> {
  if (!patientRef.trim()) return [];
  const all = await dbAll<StudyRecord>("studies");
  return all.filter((s) => s.patient_ref === patientRef).map((s) => s.study_id);
}
