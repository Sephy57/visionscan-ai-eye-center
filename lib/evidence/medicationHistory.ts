/**
 * Longitudinal Medication History (Phase 6, §24-25).
 *
 * HARD RULE: reuses Phase 5's philosophy (never infer discontinuation from
 * absence, never silently resolve a contradiction) applied to medication
 * status specifically. A medication missing from a later visit's evidence
 * is NOT_DOCUMENTED at that visit, never assumed DISCONTINUED.
 */

import type { EvidenceItem } from "./types";
import type { MedicationEntry, MedicationStatus } from "../patients/encounter";

export type MedicationHistoryState =
  | "FIRST_DOCUMENTED"
  | "CONTINUED"
  | "STATUS_CHANGED"
  | "NOT_DOCUMENTED"
  | "MEDICATION_HISTORY_CONFLICT";

export interface MedicationVisitRecord {
  study_id: string;
  timestamp: string;
  medication_name: string;
  status: MedicationStatus; // "UNKNOWN" if not explicitly recorded - never defaulted to ACTIVE
  evidence_id: string;
}

export interface MedicationHistoryEntry {
  medication_name: string;
  state: MedicationHistoryState;
  prior_status: MedicationStatus | null;
  current_status: MedicationStatus | null;
  visit_count: number; // how many visits in the supplied history mention this medication by name
  note: string;
}

function key(m: MedicationVisitRecord): string {
  return m.medication_name.trim().toLowerCase();
}

/**
 * Builds a per-medication longitudinal history from an explicit,
 * chronologically-ordered list of visit records (the caller is responsible
 * for real ordering - reuse lib/patients/timeline.ts's buildPatientTimeline()
 * for that, mirroring Phase 5's own division of responsibility).
 */
export function buildMedicationHistory(visits: MedicationVisitRecord[]): MedicationHistoryEntry[] {
  const byMedication = new Map<string, MedicationVisitRecord[]>();
  for (const v of visits) {
    const k = key(v);
    byMedication.set(k, [...(byMedication.get(k) ?? []), v]);
  }

  const results: MedicationHistoryEntry[] = [];
  for (const [, records] of byMedication) {
    const name = records[0].medication_name;
    if (records.length === 1) {
      results.push({
        medication_name: name, state: "FIRST_DOCUMENTED", prior_status: null, current_status: records[0].status,
        visit_count: 1, note: `${name} is documented at only one visit in the supplied history.`,
      });
      continue;
    }

    // Detect a real conflict: the SAME status value contradicted by an
    // intervening different value, then reverted (e.g. ACTIVE ->
    // DISCONTINUED -> ACTIVE) - never silently resolved.
    const statuses = records.map((r) => r.status).filter((s) => s !== "UNKNOWN");
    const distinctSequence = statuses.filter((s, i) => i === 0 || s !== statuses[i - 1]);
    const hasOscillation = distinctSequence.length >= 3 && distinctSequence[0] === distinctSequence[2];

    const prior = records[records.length - 2].status;
    const current = records[records.length - 1].status;

    let state: MedicationHistoryState;
    let note: string;
    if (hasOscillation) {
      state = "MEDICATION_HISTORY_CONFLICT";
      note = `${name}'s recorded status changes non-monotonically across visits (e.g. reported ${distinctSequence.join(" -> ")}) - this contradiction is preserved, not automatically resolved.`;
    } else if (prior === current) {
      state = "CONTINUED";
      note = `${name}'s status (${current}) is unchanged from the immediately preceding documented visit.`;
    } else {
      state = "STATUS_CHANGED";
      note = `${name}'s status changed from ${prior} to ${current} between the two most recent documented visits.`;
    }

    results.push({ medication_name: name, state, prior_status: prior, current_status: current, visit_count: records.length, note });
  }

  return results.sort((a, b) => a.medication_name.localeCompare(b.medication_name));
}

/** True if a medication was reported at an earlier visit but has no record at all (not even UNKNOWN) at the specified later visit - NOT_DOCUMENTED, never DISCONTINUED. */
export function medicationNotDocumentedAt(medicationName: string, visitStudyId: string, allVisits: MedicationVisitRecord[]): boolean {
  return !allVisits.some((v) => v.study_id === visitStudyId && key(v) === medicationName.trim().toLowerCase());
}

/** Adapts encounter-level MedicationEntry records into MedicationVisitRecord[] for one visit - a thin, honest bridge, never inventing a status. */
export function medicationVisitRecordsFromEntries(studyId: string, timestamp: string, entries: Array<{ value: MedicationEntry }>, evidenceItems: EvidenceItem[]): MedicationVisitRecord[] {
  const medEvidence = evidenceItems.filter((e) => e.source_type === "MEDICATION" && e.study_id === studyId);
  return entries.map((e, i) => ({
    study_id: studyId,
    timestamp,
    medication_name: e.value.name,
    status: e.value.status ?? "UNKNOWN",
    evidence_id: medEvidence[i]?.id ?? "",
  }));
}
