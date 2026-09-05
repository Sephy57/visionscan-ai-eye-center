/**
 * Missing Evidence Engine (Phase 4, §18).
 *
 * HARD RULE: this reframes data that already exists on a ConditionAssessment
 * (`missing_required`, computed by the unmodified lib/evidence/synthesize.ts)
 * plus the condition's own EvidenceConditionDef (unmodified
 * lib/evidence/conditionTaxonomy.ts) into a structured, explainable shape.
 * It never orders a test and never tells a patient "you need this" -
 * every description uses "may be needed" / "would help", never an
 * imperative directed at the patient.
 */

import type { ConditionAssessment, EvidenceItem } from "./types";
import { EVIDENCE_CONDITION_MAP, type EvidenceMatcher } from "./conditionTaxonomy";

export interface MissingEvidenceItem {
  source_type: string;
  category: string;
  required: boolean; // true if from required_evidence, false if from supportive_evidence and currently absent
  already_exists: boolean; // true if evidence of this source_type/category exists elsewhere for this study, just not matching this eye/condition
  why_it_matters: string;
}

function alreadyExistsElsewhere(evidence: EvidenceItem[], m: EvidenceMatcher): boolean {
  return evidence.some((e) => e.source_type === m.source_type && e.category === m.category);
}

/**
 * Given one condition assessment and the full evidence pool it was
 * evaluated against, describe what additional evidence would be useful.
 * Returns [] for a condition that is already SUPPORTED_CONDITION or
 * CONFLICTING_EVIDENCE (both already have positive evidence; "missing
 * evidence" is a concept for UNABLE_TO_ASSESS/INSUFFICIENT_EVIDENCE/
 * POSSIBLE_CONDITION states, where more evidence would change the picture).
 */
export function identifyMissingEvidence(assessment: ConditionAssessment, allEvidence: EvidenceItem[]): MissingEvidenceItem[] {
  const def = EVIDENCE_CONDITION_MAP[assessment.condition_id];
  if (!def) return [];
  if (assessment.state === "SUPPORTED_CONDITION" || assessment.state === "CONFLICTING_EVIDENCE") return [];

  const items: MissingEvidenceItem[] = [];

  for (const m of def.required_evidence) {
    if (assessment.missing_required.includes(`${m.source_type}:${m.category}`)) {
      items.push({
        source_type: m.source_type,
        category: m.category,
        required: true,
        already_exists: alreadyExistsElsewhere(allEvidence, m),
        why_it_matters: `${def.canonical_name} cannot be assessed without ${m.source_type.toLowerCase()} evidence of type '${m.category}' for this eye - this is a required input to the pattern, not an optional one.`,
      });
    }
  }

  // Supportive evidence that would strengthen (never establish on its own)
  // a currently-insufficient/possible assessment, if not already present.
  if (assessment.state === "INSUFFICIENT_EVIDENCE" || assessment.state === "POSSIBLE_CONDITION") {
    for (const m of def.supportive_evidence) {
      const alreadyCounted = assessment.supporting_evidence_ids.length > 0; // coarse - we don't have per-matcher granularity here without re-deriving
      if (!alreadyCounted || assessment.state === "INSUFFICIENT_EVIDENCE") {
        items.push({
          source_type: m.source_type,
          category: m.category,
          required: false,
          already_exists: alreadyExistsElsewhere(allEvidence, m),
          why_it_matters: `Additional supportive evidence of type '${m.category}' (${m.source_type.toLowerCase()}) may strengthen or weaken the case for ${def.canonical_name}, but is not itself sufficient to confirm it.`,
        });
      }
    }
  }

  return items;
}
