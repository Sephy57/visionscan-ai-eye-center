/**
 * Medication Contraindication/Concern Architecture (Phase 6, §15).
 *
 * HARD RULE: does NOT build a new, separate contraindication database.
 * Reuses `MedicationRecord.contraindications` (free text, already part of
 * lib/treatment/medications.ts's design). Matches against the patient's
 * documented systemic history (Phase 1's SystemicHistory) only - never
 * infers a contraindication from anything else. Never converts a concern
 * into an instruction ("patient should not take this") - only ever
 * KNOWN_CONCERN / POSSIBLE_CONCERN / KNOWLEDGE_UNAVAILABLE /
 * INSUFFICIENT_INFORMATION.
 */

import { resolveMedication, type MedicationResolutionStatus } from "./medicationNormalization";
import type { SystemicHistory } from "../patients/encounter";

export type ContraindicationCheckStatus =
  | "KNOWLEDGE_UNAVAILABLE"
  | "INSUFFICIENT_INFORMATION"
  | "NO_KNOWN_CONCERN"
  | "POSSIBLE_CONCERN";

export interface ContraindicationCheckResult {
  medication_name: string;
  medication_resolution_status: MedicationResolutionStatus;
  status: ContraindicationCheckStatus;
  matched_contraindications: string[];
  notice: string;
}

function historyConditionTexts(history: SystemicHistory | null): string[] {
  if (!history) return [];
  const texts: string[] = [...history.other_conditions];
  if (history.diabetes === "yes") texts.push("diabetes");
  if (history.hypertension === "yes") texts.push("hypertension");
  return texts;
}

export function checkContraindications(medicationName: string, systemicHistory: SystemicHistory | null): ContraindicationCheckResult {
  const resolution = resolveMedication(medicationName);
  if (resolution.status !== "KNOWN") {
    return {
      medication_name: medicationName, medication_resolution_status: resolution.status,
      status: "KNOWLEDGE_UNAVAILABLE", matched_contraindications: [],
      notice: `'${medicationName}' is not a resolved, registered medication - contraindication knowledge cannot be evaluated.`,
    };
  }
  const record = resolution.record!;
  if (record.contraindications.length === 0) {
    return {
      medication_name: medicationName, medication_resolution_status: "KNOWN",
      status: "KNOWLEDGE_UNAVAILABLE", matched_contraindications: [],
      notice: `No contraindication knowledge is recorded for '${record.genericName}' in this deployment's registry.`,
    };
  }
  if (systemicHistory === null) {
    return {
      medication_name: medicationName, medication_resolution_status: "KNOWN",
      status: "INSUFFICIENT_INFORMATION", matched_contraindications: [],
      notice: "No systemic history is recorded for this patient - contraindication concerns cannot be evaluated against unknown history. Absence of a record is never treated as absence of a concern.",
    };
  }

  const conditionTexts = historyConditionTexts(systemicHistory).map((t) => t.toLowerCase());
  const matched = record.contraindications.filter((c) => conditionTexts.some((cond) => c.toLowerCase().includes(cond) || cond.includes(c.toLowerCase())));

  return {
    medication_name: medicationName, medication_resolution_status: "KNOWN",
    status: matched.length > 0 ? "POSSIBLE_CONCERN" : "NO_KNOWN_CONCERN",
    matched_contraindications: matched,
    notice: matched.length > 0
      ? "A recorded contraindication text-matched documented patient history - this is a possible concern requiring clinician review, never an automatic instruction to avoid the medication."
      : `No recorded contraindication for '${record.genericName}' matched the patient's documented systemic history, among what this deployment's registry documents for it.`,
  };
}
