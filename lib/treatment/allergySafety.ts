/**
 * Medication-allergy cross-check (ophthalmology-center Phase 1, §14).
 *
 * Extends, does not replace, lib/treatment/medications.ts and
 * lib/treatment/treatmentInfo.ts. HARD RULE (mirrors both of those files'
 * headers): this deployment has no connected drug-interaction/allergy
 * cross-reactivity database. This function performs only the ONE honest
 * check it actually can - a case-insensitive substring/class match between
 * a patient's recorded Allergy.allergen and a MedicationRecord's
 * genericName/brandNames/drugClass - and reports every other allergy as
 * UNKNOWN_NOT_CHECKED rather than silently treating "no exact match" as
 * "safe". It never invents cross-reactivity relationships (e.g. it does not
 * know that "sulfa" allergy relates to a specific ophthalmic drug's
 * sulfonamide moiety unless that relationship is explicitly recorded on the
 * MedicationRecord itself, which this deployment's empty MEDICATIONS
 * registry does not yet contain).
 */

import type { MedicationRecord } from "./medications";
import type { Allergy } from "../patients/encounter";
import { resolveMedication } from "./medicationNormalization";

export type AllergyCheckResult =
  | { status: "NO_ALLERGIES_RECORDED"; notice: string }
  | { status: "POSSIBLE_MATCH"; matches: Array<{ allergen: string; matched_field: "genericName" | "brandNames" | "drugClass"; matched_value: string }>; notice: string }
  | { status: "NO_MATCH_FOUND_NOT_CONFIRMED_SAFE"; notice: string };

/**
 * Fail-closed by design: the "no match found" branch is deliberately named
 * to NOT say "safe" - a recorded allergy that doesn't textually match this
 * one medication's name/class is not evidence of safety, only evidence that
 * this specific, limited check found nothing. Clinician review is always
 * still required (see MEDICATION_SUITABILITY_UNKNOWN_NOTICE in
 * treatmentInfo.ts, which this function's callers must still honor).
 */
export function checkMedicationAgainstAllergies(medication: MedicationRecord, allergies: Allergy[]): AllergyCheckResult {
  if (allergies.length === 0) {
    return {
      status: "NO_ALLERGIES_RECORDED",
      notice: "No allergies are recorded for this patient. This is NOT the same as confirming no allergies exist - absence of a record is never treated as absence of risk.",
    };
  }

  const matches: Array<{ allergen: string; matched_field: "genericName" | "brandNames" | "drugClass"; matched_value: string }> = [];
  for (const allergy of allergies) {
    const needle = allergy.allergen.trim().toLowerCase();
    if (!needle) continue;
    if (medication.genericName.toLowerCase().includes(needle) || needle.includes(medication.genericName.toLowerCase())) {
      matches.push({ allergen: allergy.allergen, matched_field: "genericName", matched_value: medication.genericName });
    }
    for (const brand of medication.brandNames) {
      if (brand.toLowerCase().includes(needle) || needle.includes(brand.toLowerCase())) {
        matches.push({ allergen: allergy.allergen, matched_field: "brandNames", matched_value: brand });
      }
    }
    if (medication.drugClass.toLowerCase().includes(needle) || needle.includes(medication.drugClass.toLowerCase())) {
      matches.push({ allergen: allergy.allergen, matched_field: "drugClass", matched_value: medication.drugClass });
    }
  }

  if (matches.length > 0) {
    return {
      status: "POSSIBLE_MATCH",
      matches,
      notice: "A recorded allergy text-matches this medication's name or drug class. This is a possible contraindication requiring clinician review before this medication is considered - it is NOT an automatic block or an automatic approval.",
    };
  }

  return {
    status: "NO_MATCH_FOUND_NOT_CONFIRMED_SAFE",
    notice: "No recorded allergy matched this medication's name or drug class by text. This deployment has no cross-reactivity database, so this does not confirm medication safety for this patient - clinician review of allergies against this medication is still required.",
  };
}

/**
 * Phase 6 (§12-13) - the fuller allergy-safety evaluation, taking a RAW
 * medication name (as actually recorded on a patient, e.g. via
 * MedicationEntry.name) rather than requiring an already-resolved
 * MedicationRecord. Distinguishes an unresolved/unknown medication
 * (allergy safety literally cannot be evaluated) from a resolved one with
 * no textual allergy match, and reports an exact ingredient/brand match as
 * a stronger signal than the broader substring check
 * `checkMedicationAgainstAllergies()` performs.
 */
export type MedicationAllergySafetyStatus =
  | "NO_ALLERGIES_RECORDED"
  | "NO_MATCH_FOUND_NOT_CONFIRMED_SAFE"
  | "POSSIBLE_ALLERGY_MATCH"
  | "KNOWN_ALLERGY_MATCH"
  | "UNKNOWN_ALLERGY_STATUS"
  | "INSUFFICIENT_INFORMATION";

export interface MedicationAllergySafetyResult {
  status: MedicationAllergySafetyStatus;
  raw_medication_name: string;
  matches: Array<{ allergen: string; matched_field: "genericName" | "brandNames" | "drugClass"; matched_value: string }>;
  notice: string;
}

export function evaluateMedicationAllergySafety(rawMedicationName: string, allergies: Allergy[]): MedicationAllergySafetyResult {
  const resolution = resolveMedication(rawMedicationName);

  if (resolution.status === "AMBIGUOUS_MEDICATION") {
    return {
      status: "INSUFFICIENT_INFORMATION", raw_medication_name: rawMedicationName, matches: [],
      notice: `'${rawMedicationName}' matches more than one distinct registered medication - allergy safety cannot be evaluated until the specific medication is disambiguated.`,
    };
  }
  if (resolution.status === "UNKNOWN_MEDICATION") {
    return {
      status: "UNKNOWN_ALLERGY_STATUS", raw_medication_name: rawMedicationName, matches: [],
      notice: `'${rawMedicationName}' is not a recognized medication in this deployment's registry (which is intentionally empty - see lib/treatment/medications.ts). Allergy safety cannot be evaluated for an unresolved medication. This is NOT the same as confirming safety.`,
    };
  }

  const base = checkMedicationAgainstAllergies(resolution.record!, allergies);
  if (base.status === "NO_ALLERGIES_RECORDED") {
    return { status: "NO_ALLERGIES_RECORDED", raw_medication_name: rawMedicationName, matches: [], notice: base.notice };
  }
  if (base.status === "NO_MATCH_FOUND_NOT_CONFIRMED_SAFE") {
    return { status: "NO_MATCH_FOUND_NOT_CONFIRMED_SAFE", raw_medication_name: rawMedicationName, matches: [], notice: base.notice };
  }

  // POSSIBLE_MATCH from the base check - upgrade to KNOWN_ALLERGY_MATCH only
  // for an exact, whole-string match on genericName/a brand name (the
  // strongest signal this deployment can produce); everything else (a
  // substring/class-level match) stays POSSIBLE_ALLERGY_MATCH per §13's
  // "class-level mapping is uncertain -> POSSIBLE_MATCH, not CONFIRMED".
  const exactMatch = base.matches.some((m) =>
    (m.matched_field === "genericName" && m.matched_value.trim().toLowerCase() === m.allergen.trim().toLowerCase()) ||
    (m.matched_field === "brandNames" && m.matched_value.trim().toLowerCase() === m.allergen.trim().toLowerCase())
  );
  return {
    status: exactMatch ? "KNOWN_ALLERGY_MATCH" : "POSSIBLE_ALLERGY_MATCH",
    raw_medication_name: rawMedicationName, matches: base.matches, notice: base.notice,
  };
}
