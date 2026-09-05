/**
 * Patient Encounter model (ophthalmology-center Phase 1 architecture).
 *
 * HARD RULES (mirrors lib/clinical/symptoms.ts and lib/models/registry.ts):
 *  - Every field is OPTIONAL. Nothing here is forced on a user who has no
 *    reason to provide it (§5's own instruction).
 *  - Every datum carries an explicit DataProvenance (§27) - AI-derived data
 *    can NEVER silently become "verified", and this module enforces that at
 *    the type level (VERIFIED_BY_CLINICIAN is a distinct provenance value a
 *    caller must explicitly set via a clinician-driven action, never a
 *    default).
 *  - This module stores structured facts only. It computes NOTHING clinical:
 *    no diagnosis, no risk score, no treatment decision. It exists purely so
 *    that history/medications/allergies have a real, typed, provenance-aware
 *    home instead of being invented ad hoc by a future feature.
 *  - An encounter links one or more existing studies (lib/studies/service.ts)
 *    together for the same patient over time - it does NOT replace or
 *    duplicate StudyRecord, AnalysisRecord, or ClinicalReport. See
 *    docs/OPHTHALMOLOGY_CENTER_ARCHITECTURE.md.
 */

import { PatientSymptom } from "../clinical/symptoms";

/**
 * Who/what produced a given datum. Distinct from
 * lib/evidence/types.ts's EvidenceTrustLevel (how much the datum can be
 * trusted to participate in evidence synthesis) - provenance is about
 * origin, trust level is about reliability. AI_INFERRED/AI_DERIVED data
 * must never be assigned VERIFIED_BY_CLINICIAN provenance except through an
 * explicit clinician action that records who did it and when.
 */
export type DataProvenance =
  | "PATIENT_REPORTED"
  | "CLINICIAN_ENTERED"
  | "DEVICE_MEASURED"
  | "LAB_IMPORTED"
  | "DOCUMENT_EXTRACTED"
  | "AI_INFERRED"
  | "AI_DERIVED"
  | "VERIFIED_BY_CLINICIAN";

export interface ProvenancedValue<T> {
  value: T;
  provenance: DataProvenance;
  recorded_at: string; // ISO
  recorded_by?: string; // user_id, when CLINICIAN_ENTERED/VERIFIED_BY_CLINICIAN
}

export type YesNoUnknown = "yes" | "no" | "unknown";

export interface OcularHistoryEntry {
  condition: string; // free-text label (e.g. "cataract surgery", "prior retinal detachment") - never coerced into a diagnosis code this deployment doesn't validate
  laterality: "right" | "left" | "both" | "unknown";
  year?: string | null; // free-text year/approximate date, never fabricated
  note?: string | null;
}

export interface Allergy {
  allergen: string; // e.g. a drug class or specific medication name, free text
  reaction?: string | null; // e.g. "rash", "anaphylaxis" - never inferred, only what was reported
  severity?: "mild" | "moderate" | "severe" | "unknown";
}

/** Phase 6 (§11) - explicit medication state. Absence of this field, or "UNKNOWN", must NEVER be treated as ACTIVE, and absence from a later encounter must never be treated as DISCONTINUED - see lib/evidence/medicationHistory.ts. */
export type MedicationStatus = "ACTIVE" | "INACTIVE" | "DISCONTINUED" | "HISTORICAL" | "UNKNOWN";

export interface MedicationEntry {
  name: string; // free text as reported/entered - NOT cross-referenced against lib/treatment/medications.ts's MedicationRecord automatically (that registry is empty by design; see that file's header)
  ocular: boolean; // true if this is specifically an ophthalmic medication (e.g. a glaucoma drop)
  dose?: string | null;
  frequency?: string | null;
  started?: string | null; // free-text date, never fabricated
  stopped?: string | null; // free-text date, never fabricated
  /** Optional (Phase 6) - defaults to UNKNOWN semantically wherever consumed, never ACTIVE. */
  status?: MedicationStatus;
}

export interface SystemicHistory {
  diabetes: YesNoUnknown;
  hypertension: YesNoUnknown;
  other_conditions: string[]; // free-text, patient/clinician-supplied only
}

export interface FamilyHistory {
  ocular_family_history: string[]; // e.g. "glaucoma in mother" - free text, never inferred
  systemic_family_history: string[];
}

export interface PatientEncounter {
  encounter_id: string;
  patient_ref?: string | null; // links to the same user-supplied identifier StudyRecord already carries
  created_at: string;
  updated_at: string;

  chief_complaint?: string | null;
  symptoms: PatientSymptom[]; // reuses the existing, already-validated symptom vocabulary - not duplicated here

  ocular_history: ProvenancedValue<OcularHistoryEntry>[];
  ocular_surgery_history: ProvenancedValue<OcularHistoryEntry>[];
  systemic_history: ProvenancedValue<SystemicHistory> | null;
  family_history: ProvenancedValue<FamilyHistory> | null;

  medications: ProvenancedValue<MedicationEntry>[];
  allergies: ProvenancedValue<Allergy>[];

  contact_lens_use: ProvenancedValue<YesNoUnknown> | null;
  smoking_status: ProvenancedValue<"current" | "former" | "never" | "unknown"> | null;

  /** Studies (scans/visits) linked to this encounter over time - the actual imaging/analysis records live in lib/studies/service.ts, this is only the link. Populated incrementally; never assumed complete. */
  linked_study_ids: string[];
}

export interface EncounterValidationError {
  field: string;
  message: string;
}

const YES_NO_UNKNOWN: YesNoUnknown[] = ["yes", "no", "unknown"];

function validateProvenance(p: unknown, field: string, errors: EncounterValidationError[]): p is DataProvenance {
  const valid: DataProvenance[] = [
    "PATIENT_REPORTED", "CLINICIAN_ENTERED", "DEVICE_MEASURED", "LAB_IMPORTED",
    "DOCUMENT_EXTRACTED", "AI_INFERRED", "AI_DERIVED", "VERIFIED_BY_CLINICIAN",
  ];
  if (typeof p !== "string" || !valid.includes(p as DataProvenance)) {
    errors.push({ field, message: `provenance must be one of ${valid.join("|")}` });
    return false;
  }
  return true;
}

/**
 * Fail-closed validation for a new encounter's non-symptom fields (symptoms
 * are validated by the existing validateSymptoms()). Every provenanced field
 * must carry a real, explicit provenance value - there is no default.
 */
export function validateEncounterInput(input: {
  chief_complaint?: string | null;
  ocular_history?: Array<{ value: OcularHistoryEntry; provenance: unknown }>;
  medications?: Array<{ value: MedicationEntry; provenance: unknown }>;
  allergies?: Array<{ value: Allergy; provenance: unknown }>;
  systemic_history?: { value: Partial<SystemicHistory>; provenance: unknown } | null;
}): { valid: boolean; errors: EncounterValidationError[] } {
  const errors: EncounterValidationError[] = [];

  if (input.chief_complaint !== undefined && input.chief_complaint !== null && typeof input.chief_complaint !== "string") {
    errors.push({ field: "chief_complaint", message: "must be a string or null" });
  }

  (input.ocular_history ?? []).forEach((e, i) => {
    if (!e.value || typeof e.value.condition !== "string" || e.value.condition.trim().length === 0) {
      errors.push({ field: `ocular_history[${i}].condition`, message: "required, non-empty string" });
    }
    validateProvenance(e.provenance, `ocular_history[${i}].provenance`, errors);
  });

  (input.medications ?? []).forEach((e, i) => {
    if (!e.value || typeof e.value.name !== "string" || e.value.name.trim().length === 0) {
      errors.push({ field: `medications[${i}].name`, message: "required, non-empty string" });
    }
    validateProvenance(e.provenance, `medications[${i}].provenance`, errors);
  });

  (input.allergies ?? []).forEach((e, i) => {
    if (!e.value || typeof e.value.allergen !== "string" || e.value.allergen.trim().length === 0) {
      errors.push({ field: `allergies[${i}].allergen`, message: "required, non-empty string" });
    }
    validateProvenance(e.provenance, `allergies[${i}].provenance`, errors);
  });

  if (input.systemic_history) {
    const sh = input.systemic_history.value;
    if (sh.diabetes !== undefined && !YES_NO_UNKNOWN.includes(sh.diabetes)) {
      errors.push({ field: "systemic_history.diabetes", message: `must be one of ${YES_NO_UNKNOWN.join("|")}` });
    }
    if (sh.hypertension !== undefined && !YES_NO_UNKNOWN.includes(sh.hypertension)) {
      errors.push({ field: "systemic_history.hypertension", message: `must be one of ${YES_NO_UNKNOWN.join("|")}` });
    }
    validateProvenance(input.systemic_history.provenance, "systemic_history.provenance", errors);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * An empty allergies/medications array is genuinely ambiguous - it could
 * mean "asked, patient reports none" or "never asked." This encounter model
 * has no explicit "explicitly denied" marker (see lib/evidence/types.ts's
 * PresenceState doc comment for the same, already-acknowledged limitation),
 * so the only field here that distinguishes "recorded" from "not recorded"
 * is systemic_history itself (null vs a real ProvenancedValue). This
 * function is intentionally narrow - it does NOT claim allergies/medications
 * are "complete" from array presence alone.
 */
export function encounterHasRecordedSystemicHistory(e: Pick<PatientEncounter, "systemic_history">): boolean {
  return e.systemic_history !== null;
}
