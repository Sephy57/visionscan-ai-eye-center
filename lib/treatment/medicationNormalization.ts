/**
 * Medication Normalization (Phase 6, §9).
 *
 * HARD RULE: resolves a raw, free-text medication name to a real
 * `MedicationRecord` (lib/treatment/medications.ts) ONLY via exact,
 * case/whitespace-normalized matches against that record's own
 * `genericName`/`brandNames`. NO fuzzy matching, NO edit-distance, NO
 * partial-substring matching (unlike the deliberately looser allergy
 * text-match in allergySafety.ts, which is a conservative OVER-matcher by
 * design - normalization is the opposite: it must never silently resolve
 * "aspirin" to "aspartame" or similar). Because `MEDICATIONS` is
 * intentionally empty (no connected drug database), `resolveMedication()`
 * honestly returns `UNKNOWN_MEDICATION` for essentially every real input
 * today - this is the CORRECT, safe outcome, not a bug.
 */

import { MEDICATIONS, type MedicationRecord } from "./medications";

export type MedicationResolutionStatus = "KNOWN" | "UNKNOWN_MEDICATION" | "AMBIGUOUS_MEDICATION";

export interface MedicationResolution {
  status: MedicationResolutionStatus;
  raw_name: string;
  normalized_name: string; // lowercased, whitespace-collapsed - for display/logging only, never used to fabricate identity
  record: MedicationRecord | null; // set only when status === "KNOWN"
  candidates: MedicationRecord[]; // set only when status === "AMBIGUOUS_MEDICATION" - more than one exact match
}

function normalize(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Deterministic, exact-match-only resolution. Never guesses. An ambiguous
 * result (the same normalized name exactly matching more than one distinct
 * registered medication, e.g. an alias shared across two records) is
 * reported as AMBIGUOUS_MEDICATION rather than silently picking the first
 * match.
 */
export function resolveMedication(rawName: string): MedicationResolution {
  const normalized_name = normalize(rawName);
  if (!normalized_name) {
    return { status: "UNKNOWN_MEDICATION", raw_name: rawName, normalized_name, record: null, candidates: [] };
  }

  const matches = Object.values(MEDICATIONS).filter((rec) => {
    if (normalize(rec.genericName) === normalized_name) return true;
    return rec.brandNames.some((b) => normalize(b) === normalized_name);
  });

  if (matches.length === 0) {
    return { status: "UNKNOWN_MEDICATION", raw_name: rawName, normalized_name, record: null, candidates: [] };
  }
  if (matches.length > 1) {
    return { status: "AMBIGUOUS_MEDICATION", raw_name: rawName, normalized_name, record: null, candidates: matches };
  }
  return { status: "KNOWN", raw_name: rawName, normalized_name, record: matches[0], candidates: [] };
}
