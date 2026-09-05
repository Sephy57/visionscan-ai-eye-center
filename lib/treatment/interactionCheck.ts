/**
 * Medication Interaction Architecture (Phase 6, §14).
 *
 * HARD RULE: does NOT build a new, separate interaction database. Reuses
 * `MedicationRecord.drugInteractions` (lib/treatment/medications.ts's own
 * per-record field, already part of that file's design). Because
 * `MEDICATIONS` is intentionally empty, this honestly returns
 * `INTERACTION_KNOWLEDGE_UNAVAILABLE` for essentially every real input
 * today - the architecture is real and ready, nothing is fabricated to
 * fill the gap.
 */

import type { MedicationRecord } from "./medications";
import { resolveMedication, type MedicationResolutionStatus } from "./medicationNormalization";

export type InteractionCheckStatus =
  | "INTERACTION_KNOWLEDGE_UNAVAILABLE"
  | "NO_KNOWN_CONCERN"
  | "KNOWN_CONCERN";

export interface InteractionFinding {
  with_medication_name: string;
  severity: "minor" | "moderate" | "major";
  note: string;
}

export interface InteractionCheckResult {
  medication_name: string;
  medication_resolution_status: MedicationResolutionStatus;
  status: InteractionCheckStatus;
  findings: InteractionFinding[];
  notice: string;
}

/**
 * Checks one medication's OWN recorded `drugInteractions` list (a free-text
 * "withMedicationOrClass" field) against the other medication names the
 * patient is taking - a simple, honest, case-insensitive substring match,
 * the same conservative-overmatch philosophy as allergySafety.ts. No
 * transitive/symmetric inference: medication A's record listing an
 * interaction with B does not imply B's record (if B even resolves) lists
 * one with A - each record's own data is authoritative for itself only.
 */
export function checkInteractions(medicationName: string, otherMedicationNames: string[]): InteractionCheckResult {
  const resolution = resolveMedication(medicationName);
  if (resolution.status !== "KNOWN") {
    return {
      medication_name: medicationName, medication_resolution_status: resolution.status,
      status: "INTERACTION_KNOWLEDGE_UNAVAILABLE", findings: [],
      notice: `'${medicationName}' is not a resolved, registered medication - interaction knowledge cannot be evaluated. This is not evidence of no interaction.`,
    };
  }
  const record: MedicationRecord = resolution.record!;
  if (record.drugInteractions.length === 0) {
    return {
      medication_name: medicationName, medication_resolution_status: "KNOWN",
      status: "INTERACTION_KNOWLEDGE_UNAVAILABLE", findings: [],
      notice: `No interaction knowledge is recorded for '${record.genericName}' in this deployment's registry. This does NOT confirm no interactions exist.`,
    };
  }

  const findings: InteractionFinding[] = [];
  for (const other of otherMedicationNames) {
    const needle = other.trim().toLowerCase();
    if (!needle) continue;
    for (const known of record.drugInteractions) {
      if (known.withMedicationOrClass.toLowerCase().includes(needle) || needle.includes(known.withMedicationOrClass.toLowerCase())) {
        findings.push({ with_medication_name: other, severity: known.severity, note: known.note });
      }
    }
  }

  return {
    medication_name: medicationName, medication_resolution_status: "KNOWN",
    status: findings.length > 0 ? "KNOWN_CONCERN" : "NO_KNOWN_CONCERN",
    findings,
    notice: findings.length > 0
      ? "A recorded interaction concern text-matched one of the patient's other medications - requires clinician review, not an automatic block."
      : `No recorded interaction concern for '${record.genericName}' matched the patient's other medications, among the interactions this deployment's registry actually documents for it.`,
  };
}
