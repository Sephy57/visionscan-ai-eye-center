/**
 * Symptom Trend Engine (Phase 5, §18).
 *
 * HARD RULE: describes how a SYMPTOM's presence changed between two visits'
 * evidence - never infers disease progression from symptom progression
 * alone (§18's own instruction). Laterality-scoped exactly like
 * measurementTrend.ts: a symptom reported OD at visit 1 and OS at visit 2
 * is FIRST_REPORTED for OS and RESOLVED (not "improved") for OD - never
 * merged into one bilateral trend unless both sides genuinely reported it.
 */

import type { EvidenceItem, EvidenceLaterality } from "./types";

export type SymptomTrendState =
  | "FIRST_REPORTED"
  | "PERSISTENT"
  | "RESOLVED_OR_NOT_REPORTED"
  | "RECURRENT"
  | "UNKNOWN";

export interface SymptomTrend {
  symptom_type: string;
  laterality: EvidenceLaterality;
  state: SymptomTrendState;
  prior_evidence_id: string | null;
  current_evidence_id: string | null;
  note: string;
}

function symptomItems(items: EvidenceItem[]): EvidenceItem[] {
  return items.filter((i) => i.source_type === "SYMPTOM" && i.trust_level !== "REJECTED");
}

function key(i: EvidenceItem): string {
  return `${i.category}|${i.laterality}`;
}

/**
 * Compares two visits' symptom evidence. `priorVisits` may include more
 * than the immediately-preceding visit (to detect RECURRENT vs. simply
 * PERSISTENT) - each prior visit's items are checked independently.
 */
export function compareSymptoms(priorVisits: EvidenceItem[][], current: EvidenceItem[]): SymptomTrend[] {
  const currentItems = symptomItems(current);
  const currentByKey = new Map(currentItems.map((i) => [key(i), i]));

  const everReportedKeys = new Set<string>();
  const immediatelyPriorKeys = new Set<string>();
  priorVisits.forEach((visit, idx) => {
    for (const i of symptomItems(visit)) {
      everReportedKeys.add(key(i));
      if (idx === priorVisits.length - 1) immediatelyPriorKeys.add(key(i));
    }
  });

  const results: SymptomTrend[] = [];
  const allKeys = [...new Set([...everReportedKeys, ...currentByKey.keys()])].sort();

  for (const k of allKeys) {
    const [symptom_type, laterality] = k.split("|") as [string, EvidenceLaterality];
    const currentItem = currentByKey.get(k) ?? null;
    const wasImmediatelyPrior = immediatelyPriorKeys.has(k);
    const wasEverReported = everReportedKeys.has(k);

    let state: SymptomTrendState;
    let note: string;
    if (currentItem && !wasEverReported) {
      state = "FIRST_REPORTED";
      note = `${symptom_type} (${laterality}) has not been reported in any prior visit supplied to this comparison.`;
    } else if (currentItem && wasImmediatelyPrior) {
      state = "PERSISTENT";
      note = `${symptom_type} (${laterality}) was reported in the immediately preceding visit and remains reported now.`;
    } else if (currentItem && wasEverReported && !wasImmediatelyPrior) {
      state = "RECURRENT";
      note = `${symptom_type} (${laterality}) was reported in an earlier visit, not the immediately preceding one, and is reported again now.`;
    } else {
      state = "RESOLVED_OR_NOT_REPORTED";
      note = `${symptom_type} (${laterality}) was previously reported but is not reported in the current visit. This does not establish it resolved - only that it was not reported this time.`;
    }

    results.push({
      symptom_type, laterality, state,
      prior_evidence_id: null, // symptom identity across visits isn't a stable id; presence/absence is what's tracked
      current_evidence_id: currentItem?.id ?? null,
      note,
    });
  }

  return results;
}
