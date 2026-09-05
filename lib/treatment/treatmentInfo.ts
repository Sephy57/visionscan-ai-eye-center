/**
 * Treatment Information Engine (Phase 5).
 *
 * THIS IS NOT A PRESCRIBING ENGINE. It never computes a patient-specific
 * dose, never sends an order, and never accepts/rejects a medication on a
 * patient's behalf. Every output is explicitly labeled
 * "Treatment information - clinician review required."
 *
 * HARD PROVENANCE RULE (finding -> condition -> treatment):
 *   Treatment information may be generated for a condition ONLY if that
 *   condition already passed `possibleConditions()` gating (model support +
 *   modality + evidence + matching finding). If any link in that chain is
 *   missing, this engine returns an explicit "not available" result - it
 *   never falls back to displaying generic treatment information.
 *
 * Because no medication knowledge source is connected yet (see
 * lib/treatment/medications.ts), CONDITION_TREATMENT_MAP is intentionally
 * empty. Every condition therefore honestly returns "no treatment
 * information is registered" - the same honest-empty-state pattern used for
 * the model registry and the medication registry.
 */

import { getMedication, MedicationRecord } from "./medications";

export interface TreatmentApproach {
  approach_label: string;               // e.g. drug class or treatment category
  purpose: string;
  medication_ids: string[];             // must resolve against the medication registry - never free text
  evidence_reference: string;
}

/**
 * condition id -> registered treatment approaches. Intentionally empty: see
 * file header. Populate only from real registered MedicationRecords sourced
 * from an authoritative reference, never from memory.
 */
export const CONDITION_TREATMENT_MAP: Record<string, TreatmentApproach[]> = {};

export interface TreatmentMedicationInfo {
  medication_id: string;
  generic_name: string;
  drug_class: string;
  purpose: string;
  route: string[];
  common_contraindications: string[];
  warnings: string[];
  common_adverse_effects: string[];
  evidence_references: string[];
}

export interface TreatmentInformationItem {
  condition_id: string;
  condition_label: string;
  available: boolean;
  reason: string;                        // always present - explains availability or lack thereof
  approaches: Array<{
    approach_label: string;
    purpose: string;
    medications: TreatmentMedicationInfo[];
    evidence_reference: string;
  }>;
  label: string;                         // mandatory display label
}

export interface TreatmentInformationResult {
  items: TreatmentInformationItem[];
  dosage_notice: string;                 // mandatory, never contains a computed dose
  interaction_notice: string;
  note: string;
}

export const TREATMENT_LABEL = "Treatment information — clinician review required.";
export const DOSAGE_SAFETY_NOTICE = "Medication and dosage must be determined by the treating clinician.";
export const INTERACTION_UNAVAILABLE_NOTICE = "Interaction screening unavailable.";

// Defense-in-depth: even though this engine never generates a dose itself,
// reject any composed string that looks like a specific dosing instruction
// (e.g. "5 mg twice daily") before it can be returned.
const DOSAGE_PATTERN = /\b\d+(\.\d+)?\s?(mg|mcg|g|ml|units?)\b.{0,20}\b(once|twice|three times|daily|per day|bid|tid|qid|q\d+h)\b/i;

export interface GatedCondition {
  id: string;
  label: string;
}

/**
 * Build treatment information for the conditions that already passed
 * `possibleConditions()` gating. `gatedConditions` MUST be exactly the
 * output of that gate - this function does not re-derive eligibility, it
 * only refuses to go further than the chain it is handed.
 */
export function getTreatmentInformation(gatedConditions: GatedCondition[]): TreatmentInformationResult | undefined {
  if (gatedConditions.length === 0) return undefined;

  const items: TreatmentInformationItem[] = gatedConditions.map((c) => {
    const approaches = CONDITION_TREATMENT_MAP[c.id] ?? [];
    if (approaches.length === 0) {
      return {
        condition_id: c.id,
        condition_label: c.label,
        available: false,
        reason:
          "No treatment information is registered for this condition. This deployment has no connected " +
          "medication knowledge source; treatment information will only appear once evidence-referenced records " +
          "are added.",
        approaches: [],
        label: TREATMENT_LABEL,
      };
    }

    const resolvedApproaches = approaches.map((a) => {
      const meds: TreatmentMedicationInfo[] = a.medication_ids
        .map((id) => getMedication(id))
        .filter((m): m is MedicationRecord => m !== null)
        .map((m) => ({
          medication_id: m.medicationId,
          generic_name: m.genericName,
          drug_class: m.drugClass,
          purpose: a.purpose,
          route: m.route,
          common_contraindications: m.contraindications,
          warnings: m.warnings,
          common_adverse_effects: m.commonAdverseEffects,
          evidence_references: m.evidenceReferences,
        }));
      return { approach_label: a.approach_label, purpose: a.purpose, medications: meds, evidence_reference: a.evidence_reference };
    });

    return {
      condition_id: c.id,
      condition_label: c.label,
      available: resolvedApproaches.some((a) => a.medications.length > 0),
      reason: "Evidence-referenced treatment approaches are available for clinician review.",
      approaches: resolvedApproaches,
      label: TREATMENT_LABEL,
    };
  });

  const result: TreatmentInformationResult = {
    items,
    dosage_notice: DOSAGE_SAFETY_NOTICE,
    interaction_notice: INTERACTION_UNAVAILABLE_NOTICE,
    note:
      "Treatment information is evidence-based reference material, not a prescription. Medication selection, " +
      "dosing, and suitability depend on the patient's complete clinical history and must be determined by the " +
      "treating clinician.",
  };

  // Defense-in-depth dosage check over every generated string.
  const flat = JSON.stringify(result);
  if (DOSAGE_PATTERN.test(flat)) {
    throw new Error("Treatment information generation blocked: output resembles a patient-specific dosing instruction, which this engine must never produce.");
  }

  return result;
}

// ---------------------------------------------------------------------------
// Patient safety check (Step 13) - required patient factors before treatment
// information may be shown as actionable.
// ---------------------------------------------------------------------------

export interface PatientMedicationFactors {
  age: "known" | "unknown";
  allergies: "known" | "unknown";
  currentMedications: "known" | "unknown";
  medicalHistory: "known" | "unknown";
  pregnancyStatus: "known" | "not_applicable" | "unknown";
  renalStatus: "known" | "unknown";
  hepaticStatus: "known" | "unknown";
}

export const MEDICATION_SUITABILITY_UNKNOWN_NOTICE = "Medication suitability cannot be determined from the eye scan alone.";

/** Unknown must remain UNKNOWN - never assumed to be "none"/"normal". */
export function checkPatientSafety(factors: Partial<PatientMedicationFactors>): { sufficient: boolean; notice: string; missing: string[] } {
  const required: Array<keyof PatientMedicationFactors> = [
    "age", "allergies", "currentMedications", "medicalHistory", "pregnancyStatus", "renalStatus", "hepaticStatus",
  ];
  const missing = required.filter((k) => !factors[k] || factors[k] === "unknown");
  if (missing.length > 0) {
    return { sufficient: false, notice: MEDICATION_SUITABILITY_UNKNOWN_NOTICE, missing };
  }
  return { sufficient: true, notice: "Required patient factors are recorded; clinician review is still required before any medication decision.", missing: [] };
}

// ---------------------------------------------------------------------------
// Drug interaction screening (Step 15) - honest "unavailable" stub. No
// interaction database is connected in this deployment.
// ---------------------------------------------------------------------------

export function screenInteractions(_currentMedicationIds: string[], _proposedMedicationId: string): { checked: boolean; notice: string } {
  return { checked: false, notice: INTERACTION_UNAVAILABLE_NOTICE };
}
