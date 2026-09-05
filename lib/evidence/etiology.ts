/**
 * Etiology Hypothesis Engine (ophthalmology-center Phase 1, §12).
 *
 * HARD RULE: this module invents NO new clinical logic. It is a pure,
 * deterministic reframing of lib/evidence/synthesize.ts's already-computed
 * ConditionAssessment[] output into the explicit "possible causes / why /
 * evidence for / evidence against / missing / can we actually establish
 * this" shape §12 asks for. It never upgrades a POSSIBLE_CONDITION into an
 * established cause, and `etiology_established` is FALSE for every
 * assessment this deployment can currently produce, because no genuinely
 * validated model exists (see lib/models/diagnosisGate.ts) - there is
 * nothing in this system today that could legitimately flip it to true.
 */

import type { ConditionAssessment, EvidenceItem } from "./types";
import { getConfirmationRequirements, type ConfirmationRequirement } from "./confirmationRequirements";

export interface EtiologyHypothesis {
  /** Phase 4 (§14) - stable per-assessment id, not just the shared condition_id, so two per-eye hypotheses for the same condition are distinguishable. */
  etiology_id: string;
  condition_id: string;
  canonical_name: string;
  laterality: ConditionAssessment["laterality"];
  /** Why this is even being considered - the assessment state that triggered inclusion. */
  why_considered: string;
  evidence_supporting: string[]; // human-readable summaries, not raw ids
  evidence_contradicting: string[];
  missing_information: string[];
  /** Phase 4 (§19) - structurally derived from the condition taxonomy's own required_evidence, never fabricated. */
  confirmation_requirements: ConfirmationRequirement;
  /** ALWAYS false in this deployment - see file header. Present as a field (not omitted) so a future genuinely-validated pathway has a real place to set it true, deliberately, with its own gate. */
  etiology_established: boolean;
  note: string;
}

const STATE_EXPLANATION: Record<ConditionAssessment["state"], string> = {
  POSSIBLE_CONDITION: "Some supporting evidence exists, but not enough independent, trusted sources to call it a supported association.",
  SUPPORTED_CONDITION: "Independent, trusted evidence sources support this association - still not a diagnosis and still requires clinician correlation.",
  INSUFFICIENT_EVIDENCE: "Required evidence for this pattern was not found for this study.",
  CONFLICTING_EVIDENCE: "Evidence both for and against this pattern was found.",
  UNABLE_TO_ASSESS: "This condition could not be assessed from the available evidence.",
};

function summarizeEvidence(items: EvidenceItem[], ids: string[]): string[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  return ids
    .map((id) => byId.get(id))
    .filter((i): i is EvidenceItem => !!i)
    .map((i) => `${i.category}${i.qualitative_finding ? ` (${i.qualitative_finding})` : ""}${i.value !== undefined ? ` = ${i.value}${i.unit ? ` ${i.unit}` : ""}` : ""} [${i.source_type}, ${i.trust_level}]`);
}

/**
 * Reframes ConditionAssessment[] (already computed, already gated) into
 * etiology-hypothesis language. Only includes assessments that have SOME
 * supporting or contradicting evidence (POSSIBLE_CONDITION,
 * SUPPORTED_CONDITION, CONFLICTING_EVIDENCE) - INSUFFICIENT_EVIDENCE and
 * UNABLE_TO_ASSESS conditions are not "hypotheses being considered", they
 * are the absence of one, and are omitted rather than padded in.
 */
export function summarizeEtiology(assessments: ConditionAssessment[], evidence: EvidenceItem[]): EtiologyHypothesis[] {
  return assessments
    .filter((a) => a.state === "POSSIBLE_CONDITION" || a.state === "SUPPORTED_CONDITION" || a.state === "CONFLICTING_EVIDENCE")
    .map((a) => ({
      etiology_id: `etio_${a.condition_id}_${a.laterality}`,
      condition_id: a.condition_id,
      canonical_name: a.canonical_name,
      laterality: a.laterality,
      why_considered: STATE_EXPLANATION[a.state],
      evidence_supporting: summarizeEvidence(evidence, a.supporting_evidence_ids),
      evidence_contradicting: summarizeEvidence(evidence, a.contradicting_evidence_ids),
      missing_information: a.missing_required,
      confirmation_requirements: getConfirmationRequirements(a.condition_id),
      etiology_established: false,
      note: a.state === "SUPPORTED_CONDITION"
        ? "Evidence-supported association only. No genuinely validated model exists in this deployment (Gate A closed) - this is not, and cannot currently become, an established etiology. Clinician correlation is required."
        : "Insufficient independent, trusted evidence to call this even a supported association. Clinician correlation and additional data are required before any conclusion.",
    }));
}

/**
 * True only when zero hypotheses could be formed at all - the honest
 * "etiology cannot be established from the evidence alone" case from §12's
 * own worked example. This is the expected, correct, default outcome for
 * almost every real study in this deployment.
 */
export function etiologyCannotBeEstablished(hypotheses: EtiologyHypothesis[]): boolean {
  return hypotheses.length === 0 || hypotheses.every((h) => !h.etiology_established);
}
