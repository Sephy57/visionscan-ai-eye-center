/**
 * Adversarial, non-diagnostic review of a condition hypothesis.
 *
 * This is deliberately a second pass over the immutable evidence graph.  It
 * tries to weaken an assessment by checking laterality, provenance
 * independence, contradictions, temporal uncertainty, and unsupported AI
 * confidence.  It never promotes a hypothesis or invents a condition.
 */

import type { ConditionAssessment, EvidenceItem } from "../evidence/types";

export interface AdversarialReviewCheck {
  check: string;
  passed: boolean;
  detail: string;
}

export interface AdversarialConditionReview {
  condition_id: string;
  laterality: ConditionAssessment["laterality"];
  outcome: "HYPOTHESIS_SURVIVES_REVIEW" | "HYPOTHESIS_WEAKENED";
  checks: AdversarialReviewCheck[];
  disproof_attempts: string[];
  requires_clinician_review: true;
}

function lateralityCompatible(condition: ConditionAssessment, item: EvidenceItem): boolean {
  return condition.laterality === "OU" || item.laterality === "OU" || item.laterality === condition.laterality;
}

export function reviewConditionAdversarially(
  assessment: ConditionAssessment,
  evidence: EvidenceItem[],
): AdversarialConditionReview {
  const byId = new Map(evidence.map((item) => [item.id, item]));
  const support = assessment.supporting_evidence_ids.map((id) => byId.get(id)).filter((x): x is EvidenceItem => !!x);
  const checks: AdversarialReviewCheck[] = [];

  checks.push({
    check: "support_references_resolve",
    passed: support.length === assessment.supporting_evidence_ids.length,
    detail: `${support.length}/${assessment.supporting_evidence_ids.length} supporting evidence references resolve in the canonical graph.`,
  });
  checks.push({
    check: "laterality_is_compatible",
    passed: support.every((item) => lateralityCompatible(assessment, item)),
    detail: support.every((item) => lateralityCompatible(assessment, item))
      ? "Every supporting item is same-eye or explicitly bilateral."
      : "At least one supporting item is for a different eye and cannot support this assessment.",
  });

  const actualGroups = new Set(support.map((item) => item.dependency_group_id ?? `${item.source_type}:${item.source_id}`));
  const declaredGroups = new Set(assessment.dependency_groups ?? []);
  checks.push({
    check: "dependency_groups_not_inflated",
    passed: declaredGroups.size === 0 || [...declaredGroups].every((group) => actualGroups.has(group)),
    detail: `${actualGroups.size} independent dependency group(s) are visible; model outputs sharing one image are not counted as independent sources.`,
  });

  const unresolvedContradiction = assessment.state === "CONFLICTING_EVIDENCE" || assessment.contradicting_evidence_ids.length > 0;
  checks.push({
    check: "contradictions_reconciled",
    passed: !unresolvedContradiction,
    detail: unresolvedContradiction ? "Contradicting evidence remains unresolved; no automatic winner is allowed." : "No unresolved contradiction is attached to this assessment.",
  });

  const temporallyUncertain = support.some((item) => item.temporal_state === "TEMPORALLY_UNCERTAIN");
  checks.push({
    check: "temporal_context_known",
    passed: !temporallyUncertain,
    detail: temporallyUncertain ? "At least one supporting item has an uncertain timestamp/encounter relationship." : "Supporting evidence has a known or explicitly encounter-linked temporal state.",
  });

  const unsupportedAi = assessment.state === "SUPPORTED_CONDITION" && support.some((item) => item.source_type === "AI_FINDING" && item.trust_level === "UNVERIFIED");
  checks.push({
    check: "unsupported_ai_cannot_confirm",
    passed: !unsupportedAi,
    detail: unsupportedAi ? "An unverified AI finding would be doing confirmation work; the hypothesis is weakened." : "No unverified AI-only confirmation was accepted.",
  });

  const disproofAttempts = [
    "Attempted same-eye laterality mismatch disproof.",
    "Attempted shared-image/dependency inflation disproof.",
    "Attempted contradiction and temporal-uncertainty disproof.",
    "Attempted unverified-AI confirmation disproof.",
  ];
  const outcome = checks.every((check) => check.passed) && assessment.state !== "CONFLICTING_EVIDENCE" && assessment.state !== "UNABLE_TO_ASSESS"
    ? "HYPOTHESIS_SURVIVES_REVIEW"
    : "HYPOTHESIS_WEAKENED";
  return {
    condition_id: assessment.condition_id,
    laterality: assessment.laterality,
    outcome,
    checks,
    disproof_attempts: disproofAttempts,
    requires_clinician_review: true,
  };
}

export function reviewConditionsAdversarially(
  assessments: ConditionAssessment[],
  evidence: EvidenceItem[],
): AdversarialConditionReview[] {
  return assessments.map((assessment) => reviewConditionAdversarially(assessment, evidence));
}

