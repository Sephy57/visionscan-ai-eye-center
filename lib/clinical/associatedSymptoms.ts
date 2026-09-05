/**
 * "Commonly associated symptoms" (Phase 5, Step 2/7).
 *
 * A hard separation from patient-reported symptoms:
 *   PATIENT REPORTED   -> lib/clinical/symptoms.ts PatientSymptom (what the patient told the system)
 *   MODEL DETECTED     -> Finding[] (what the model actually detected)
 *   COMMONLY ASSOCIATED -> this file (knowledge-base wording only, never attributed to the patient)
 *
 * The AI must never say "patient has X" for a commonly-associated symptom.
 * These are derived entirely from the pre-existing controlled vocabularies
 * already in the codebase (SYMPTOM_VOCABULARY.related_finding_types and
 * ConditionDef.commonly_associated_symptoms) - nothing new is invented here.
 */

import { SYMPTOM_VOCABULARY, SYMPTOM_MAP } from "./symptoms";
import { CONDITION_MAP } from "./conditions";

export interface AssociatedSymptom {
  type: string;
  label: string;
}

export const ASSOCIATED_SYMPTOMS_LABEL = "Commonly associated symptoms — not necessarily reported by this patient.";

/**
 * Symptoms commonly associated with the given (model-detected) finding types,
 * derived by inverting the symptom vocabulary's declared relationships.
 */
export function associatedSymptomsForFindings(findingTypes: string[]): AssociatedSymptom[] {
  const types = new Set(findingTypes);
  const seen = new Set<string>();
  const out: AssociatedSymptom[] = [];
  for (const def of SYMPTOM_VOCABULARY) {
    if (def.related_finding_types.some((t) => types.has(t)) && !seen.has(def.type)) {
      seen.add(def.type);
      out.push({ type: def.type, label: def.label });
    }
  }
  return out;
}

/** Symptoms commonly associated with a possible condition (controlled taxonomy, not patient input). */
export function associatedSymptomsForCondition(conditionId: string): AssociatedSymptom[] {
  const def = CONDITION_MAP[conditionId];
  if (!def) return [];
  return def.commonly_associated_symptoms
    .map((type) => (SYMPTOM_MAP[type] ? { type, label: SYMPTOM_MAP[type].label } : null))
    .filter((x): x is AssociatedSymptom => x !== null);
}
