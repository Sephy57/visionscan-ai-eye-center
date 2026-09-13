/**
 * Encounter-level cross-modality resolution (I/O boundary).
 *
 * Loads the encounter's linked studies + stored analyses and assesses each
 * same-eye FUNDUS+OCT pair via lib/evidence/crossModality.ts. Never triggers
 * analysis, never writes studies/analyses/reports, never merges evidence
 * across studies. Fails closed to NOT_COMPARABLE with an explicit reason.
 */

import { dbGet } from "../storage/db";
import type { StudyRecord, AnalysisRecord } from "../studies/service";
import type { PatientEncounter } from "../patients/encounter";
import { currentAnalysisId } from "../studies/analysisIdentity";
import {
  compareFundusOctPair,
  type CrossModalityResult,
} from "./crossModality";

function canonicalModalityLocal(modality: string): string {
  const m = (modality ?? "").toLowerCase();
  if (["fundus", "retinal_photo", "macula", "optic_nerve"].includes(m)) return "FUNDUS";
  if (m === "oct" || m === "octa") return m.toUpperCase();
  return "OTHER";
}

export interface EncounterCrossModalityAssessment {
  encounter_id: string;
  pairs: CrossModalityResult[];
  /** Linked studies excluded before pairing (for example, a patient-ref mismatch). */
  excluded_study_ids: string[];
  notes: string[];
  compared_at: string;
}

/** Assess every same-eye FUNDUS+OCT pair linked to the encounter. */
export async function assessEncounterCrossModality(
  encounter: PatientEncounter
): Promise<EncounterCrossModalityAssessment> {
  const pairs: CrossModalityResult[] = [];
  const excludedStudyIds: string[] = [];
  const notes: string[] = [];
  const encounterPatientRef = (encounter.patient_ref ?? "").trim().toLowerCase() ||
    ("patient_id" in encounter && typeof (encounter as { patient_id?: unknown }).patient_id === "string"
      ? ((await dbGet<{ patient_ref?: string }>("patients", (encounter as { patient_id: string }).patient_id))?.patient_ref ?? "").trim().toLowerCase()
      : "");
  const studies: StudyRecord[] = [];
  const analyses = new Map<string, AnalysisRecord>();
  for (const studyId of encounter.linked_study_ids ?? []) {
    const study = await dbGet<StudyRecord>("studies", studyId);
    if (!study) continue;
    // Encounter creation already rejects a mismatched patient_ref, but this
    // second boundary protects legacy/tampered records and prevents an
    // encounter-level comparison from ever mixing patients.
    const studyPatientRef = (study.patient_ref ?? "").trim().toLowerCase();
    if (encounterPatientRef && studyPatientRef && encounterPatientRef !== studyPatientRef) {
      excludedStudyIds.push(study.study_id);
      notes.push(`Excluded ${study.study_id}: patient reference does not match encounter; no cross-patient evidence was compared.`);
      continue;
    }
    studies.push(study);
    const analysis = await dbGet<AnalysisRecord>("analyses", currentAnalysisId(study));
    if (analysis) analyses.set(studyId, analysis);
  }
  const fundus = studies.filter((s) => canonicalModalityLocal(s.modality) === "FUNDUS");
  const octs = studies.filter((s) => canonicalModalityLocal(s.modality) === "OCT");
  for (const f of fundus) {
    for (const o of octs) {
      if ((f.eye ?? "").toUpperCase() !== (o.eye ?? "").toUpperCase()) continue;
      const fundusAnalysis = analyses.get(f.study_id)?.result ?? null;
      const octAnalysis = analyses.get(o.study_id)?.result ?? null;
      pairs.push(
        compareFundusOctPair({
          encounter_id: encounter.encounter_id,
          fundusStudy: { study_id: f.study_id, modality: f.modality, eye: f.eye },
          octStudy: { study_id: o.study_id, modality: o.modality, eye: o.eye },
          fundusAnalysis,
          octAnalysis,
        })
      );
    }
  }
  if (pairs.length === 0 && excludedStudyIds.length === 0) {
    notes.push("No same-eye FUNDUS + OCT pair with stored analyses was available; no analysis was triggered implicitly.");
  }
  return {
    encounter_id: encounter.encounter_id,
    pairs,
    excluded_study_ids: [...new Set(excludedStudyIds)],
    notes,
    compared_at: new Date().toISOString(),
  };
}

/** Resolve an encounter by id, then assess. Fails closed when not found. */
export async function assessEncounterCrossModalityById(
  encounterId: string
): Promise<EncounterCrossModalityAssessment | { encounter_id: string; not_found: true }> {
  const encounter = await dbGet<PatientEncounter>("encounters", encounterId);
  if (!encounter) return { encounter_id: encounterId, not_found: true };
  return assessEncounterCrossModality(encounter);
}
