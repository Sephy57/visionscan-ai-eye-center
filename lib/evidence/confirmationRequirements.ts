/**
 * Confirmation Requirements (Phase 4, §19).
 *
 * HARD RULE (§29): a confirmation requirement is only listed here if it is
 * genuinely, structurally implied by the SAME condition taxonomy this
 * repository already ships (lib/evidence/conditionTaxonomy.ts's
 * required_evidence) - "what would need to be present/reviewed to move this
 * pattern toward SUPPORTED_CONDITION" - never an invented clinical
 * guideline. Every entry not backed this way is deliberately left
 * CONFIRMATION_REQUIREMENT_UNSPECIFIED rather than fabricated. This is NOT
 * a substitute for real clinical practice guidelines - none are
 * incorporated into this deployment.
 */

import { EVIDENCE_CONDITION_MAP } from "./conditionTaxonomy";

export type ConfirmationRequirementStatus = "DOCUMENTED" | "CONFIRMATION_REQUIREMENT_UNSPECIFIED";

export interface ConfirmationRequirement {
  condition_id: string;
  status: ConfirmationRequirementStatus;
  /** Always includes "qualified clinician assessment" when status is DOCUMENTED - never replaced by an automated check alone. */
  requirements: string[];
  source_status: "UNSPECIFIED"; // §30 - no authoritative external source is connected in this deployment
}

/**
 * Derives confirmation requirements structurally from the condition's own
 * required_evidence list (already real, already in the repository) plus one
 * fixed, non-clinical-content addition: qualified clinician assessment,
 * which is always required and is not itself a clinical claim.
 */
export function getConfirmationRequirements(condition_id: string): ConfirmationRequirement {
  const def = EVIDENCE_CONDITION_MAP[condition_id];
  if (!def) {
    return { condition_id, status: "CONFIRMATION_REQUIREMENT_UNSPECIFIED", requirements: [], source_status: "UNSPECIFIED" };
  }
  if (def.required_evidence.length === 0) {
    // e.g. acute_vision_change_pattern has no required_evidence (symptom-pattern only) -
    // there is nothing structurally derivable to list beyond clinician assessment itself.
    return {
      condition_id, status: "CONFIRMATION_REQUIREMENT_UNSPECIFIED",
      requirements: ["Qualified clinician assessment"], source_status: "UNSPECIFIED",
    };
  }
  return {
    condition_id,
    status: "DOCUMENTED",
    requirements: [
      ...def.required_evidence.map((m) => `${m.category.replaceAll("_", " ")} (${m.source_type.toLowerCase()})`),
      "Qualified clinician assessment",
    ],
    source_status: "UNSPECIFIED",
  };
}
