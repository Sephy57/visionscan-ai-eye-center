/**
 * Medication-Symptom / Medication-Finding Association (Phase 6, §22-23).
 *
 * HARD RULE: temporal co-occurrence is NEVER causation. This module only
 * ever produces `POSSIBLE_ASSOCIATION` / `REQUIRES_CLINICIAN_REVIEW` -
 * there is no `CAUSE_CONFIRMED` state anywhere in this file, and none may
 * ever be added without a genuinely validated causal-inference methodology
 * this deployment does not have.
 */

import type { EvidenceItem } from "./types";

export type MedicationAssociationState = "POSSIBLE_ASSOCIATION" | "NO_TEMPORAL_OVERLAP" | "INSUFFICIENT_DATA";

export interface MedicationAssociationResult {
  medication_evidence_id: string;
  associated_evidence_id: string;
  associated_category: string; // a symptom type or AI finding type
  state: MedicationAssociationState;
  requires_clinician_review: true;
  note: string;
}

/**
 * Finds MEDICATION evidence items co-present (same study/visit) with
 * SYMPTOM or AI_FINDING evidence items and flags them as a possible
 * association requiring review - never a causal claim. Deterministic;
 * purely presence-based (§22's own example: "medication listed * patient
 * reports redness -> MEDICATION_SYMPTOM_ASSOCIATION_REQUIRES_REVIEW").
 */
export function findMedicationAssociations(evidence: EvidenceItem[]): MedicationAssociationResult[] {
  const trusted = evidence.filter((e) => e.trust_level !== "REJECTED");
  const medications = trusted.filter((e) => e.source_type === "MEDICATION");
  const symptomsAndFindings = trusted.filter((e) => e.source_type === "SYMPTOM" || e.source_type === "AI_FINDING");

  const results: MedicationAssociationResult[] = [];
  for (const med of medications) {
    for (const other of symptomsAndFindings) {
      if (med.study_id !== other.study_id) continue; // same-visit co-occurrence only - never cross-visit inference here (see medicationHistory.ts for longitudinal)
      results.push({
        medication_evidence_id: med.id,
        associated_evidence_id: other.id,
        associated_category: other.category,
        state: "POSSIBLE_ASSOCIATION",
        requires_clinician_review: true,
        note: `${med.category} (medication) and ${other.category} (${other.source_type.toLowerCase()}) are both recorded for this visit. This is a temporal co-occurrence only - it does not establish a causal link between the medication and the ${other.source_type === "SYMPTOM" ? "symptom" : "finding"}. Clinician correlation is required.`,
      });
    }
  }
  return results;
}
