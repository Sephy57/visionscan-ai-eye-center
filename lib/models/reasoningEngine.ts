/**
 * Reasoning Engine (Phase 4, §22-24, §45).
 *
 * StructuredClinicalEvidence -> ReasoningEngine -> StructuredReasoningResult.
 *
 * HARD RULE: `DeterministicReasoningEngine` is the ONLY implementation of
 * `ReasoningEngine` in this codebase. It calls no network, no LLM, no
 * external service - it purely reframes already-computed data
 * (StructuredClinicalEvidence's evidence/conflicts/possible_conditions,
 * Phase 1's etiology engine, Phase 4's missing-evidence engine) into one
 * result object. `LLMReasoningEngine` is declared as a TYPE-ONLY marker
 * interface (§45) documenting the future contract - it is NOT implemented,
 * and per explicit instruction must not be until a future, separately
 * authorized session builds it.
 *
 * FUTURE LLM BOUNDARY (§24, §45): a future LLMReasoningEngine implementation
 * would (1) receive only a StructuredClinicalEvidence object built the same
 * way this one is - never raw unrestricted patient data by default, (2)
 * never write to the database directly, (3) never assign or change
 * provenance itself (only an explicit clinician action may produce
 * VERIFIED_BY_CLINICIAN), (4) never bypass lib/clinical/safety.ts's
 * validator or lib/models/diagnosisGate.ts, (5) never prescribe or dose,
 * (6) never manufacture certainty beyond what a real calibrated model
 * provides. Its output would have to pass through the exact same
 * `runSafetyValidation` step this deterministic engine's result already
 * does before being presentation-facing.
 */

import type { StructuredClinicalEvidence } from "../evidence/structuredClinicalEvidence";
import { summarizeEtiology, type EtiologyHypothesis } from "../evidence/etiology";
import { identifyMissingEvidence, type MissingEvidenceItem } from "../evidence/missingEvidenceEngine";
import { redFlagSymptoms } from "../clinical/symptoms";
import type { EvidenceItem, ConditionAssessment } from "../evidence/types";
import { DISALLOWED_CLAIM_PATTERNS } from "../analysis/pipeline";
import { reviewConditionsAdversarially, type AdversarialConditionReview } from "../clinical/clinicalRedTeam";
import { verifyReasoningChain, type IndependentReasoningVerification } from "../clinical/independentVerifier";

export const REASONING_ENGINE_VERSION = "1.0.0";
export const RULE_SET_VERSION = "evidence-taxonomy-0.1.0-non-clinical"; // matches lib/evidence/conditionTaxonomy.ts's own version - one rule-set version, not two

export interface UrgentFlag {
  symptom_type: string;
  label: string;
  urgency: "emergency" | "urgent";
  /** Explicit statement that this flag is independent of AI/specialist findings - never suppressible by them. */
  independent_of_ai_findings: true;
}

export interface StructuredReasoningResult {
  study_id: string;
  encounter_id: string | null;
  evidence_references: string[]; // ids only - the evidence itself lives in StructuredClinicalEvidence.evidence
  relevant_symptoms: string[];
  evidence_conflicts: StructuredClinicalEvidence["conflicts"];
  specialist_contributions: StructuredClinicalEvidence["specialist_bundles"];
  possible_conditions: ConditionAssessment[]; // NEVER a diagnosis - see note field on each
  etiology_hypotheses: EtiologyHypothesis[]; // etiology_established is false on every entry this engine can produce
  missing_evidence: Record<string, MissingEvidenceItem[]>; // keyed by condition_id
  urgent_flags: UrgentFlag[];
  uncertainties: string[];
  limitations: string[];
  provenance: { generated_at: string; engine: "DeterministicReasoningEngine" };
  generated_at: string;
  engine_version: string;
  rule_set_version: string;
  requires_clinician_review: true;
  safety_banner: string;
  /** §26 - reuses lib/analysis/pipeline.ts's own DISALLOWED_CLAIM_PATTERNS scan, never a second/divergent list. Non-empty is a defense-in-depth bug signal (a rule/template produced disallowed language), never expected in normal operation of this engine's fixed templates. */
  blocked_claims: string[];
  /** A separate, deterministic attempt to disprove each hypothesis. */
  adversarial_reviews: AdversarialConditionReview[];
  /** Referential/safety verification; disagreement is surfaced, never hidden. */
  independent_verification: IndependentReasoningVerification;
}

export interface ReasoningEngine {
  analyze(evidence: StructuredClinicalEvidence): Promise<StructuredReasoningResult> | StructuredReasoningResult;
}

/**
 * §45 - type-only, deliberately unimplemented. `never` return type is a
 * compile-time assertion that no class can genuinely implement this
 * interface's method body today; any future implementation must first
 * change this signature as an explicit, reviewed decision, not silently
 * satisfy the current one.
 */
export interface LLMReasoningEngine extends ReasoningEngine {
  readonly providerName: string;
  analyze(evidence: StructuredClinicalEvidence): Promise<never>;
}

const SAFETY_BANNER =
  "STRUCTURED CLINICAL REASONING — NOT A DIAGNOSIS. NOT CLINICALLY VALIDATED. " +
  "Every possible condition and etiology hypothesis below requires qualified clinician correlation.";

/** §26 - reuses the pipeline's own forbidden-claims list against every free-text field this engine produces. */
function scanForbiddenClaims(texts: string[]): string[] {
  const blocked: string[] = [];
  for (const text of texts) {
    for (const [rx, label] of DISALLOWED_CLAIM_PATTERNS) {
      if (rx.test(text) && !blocked.includes(label)) blocked.push(label);
    }
  }
  return blocked;
}

export class DeterministicReasoningEngine implements ReasoningEngine {
  analyze(evidence: StructuredClinicalEvidence): StructuredReasoningResult {
    const now = new Date().toISOString();

    const symptomItems = evidence.evidence.filter((e) => e.source_type === "SYMPTOM");
    const syntheticSymptoms = symptomItems.map((e) => ({
      type: e.category,
      onset: "unknown" as const, duration: "unknown" as const, severity: "moderate" as const,
      laterality: "unknown" as const, progression: "unknown" as const, frequency: "unknown" as const,
      free_text: null,
    }));
    // Urgency (§17) is derived from the SAME lib/clinical/symptoms.ts red-flag
    // vocabulary the independent triage system uses - never re-derived with
    // different logic, and never influenced by possible_conditions/
    // specialist_bundles below (computed from a disjoint input).
    const urgentFlags: UrgentFlag[] = redFlagSymptoms(syntheticSymptoms).map((d) => ({
      symptom_type: d.type, label: d.label, urgency: d.urgency as "emergency" | "urgent",
      independent_of_ai_findings: true,
    }));

    const etiologyHypotheses = summarizeEtiology(evidence.possible_conditions, evidence.evidence);

    const missingEvidence: Record<string, MissingEvidenceItem[]> = {};
    for (const assessment of evidence.possible_conditions) {
      const missing = identifyMissingEvidence(assessment, evidence.evidence);
      if (missing.length > 0) missingEvidence[assessment.condition_id] = missing;
    }

    const uncertainties: string[] = [];
    for (const bundle of evidence.specialist_bundles) {
      if (bundle.quality_status !== "pass") uncertainties.push(`${bundle.specialty_id}: image quality was ${bundle.quality_status}, not a pass - findings from this capability are limited accordingly.`);
      if (bundle.ood_status === "out_of_distribution") uncertainties.push(`${bundle.specialty_id}: input flagged out-of-distribution - not treated as reliable evidence.`);
    }
    for (const item of evidence.evidence) {
      if (item.trust_level === "UNVERIFIED" && item.source_type === "AI_FINDING") {
        uncertainties.push(`AI finding '${item.category}' is unverified - a heuristic/research model output, never calibrated confidence.`);
      }
    }

    const limitations = [
      "This is a structured evidence synthesis, not a diagnosis.",
      "No genuinely validated model exists in this deployment (Gate A closed).",
      "Etiology is never established automatically - clinician correlation is required.",
    ];

    const textsToScan = [
      ...etiologyHypotheses.flatMap((h) => [h.why_considered, h.note]),
      ...evidence.possible_conditions.map((c) => c.note),
      ...uncertainties, ...limitations,
    ];
    const blockedClaims = scanForbiddenClaims(textsToScan);
    const adversarialReviews = reviewConditionsAdversarially(evidence.possible_conditions, evidence.evidence);
    const independentVerification = verifyReasoningChain({
      evidence: evidence.evidence,
      conditions: evidence.possible_conditions,
      conflicts: evidence.conflicts,
      urgentFlags,
    });
    if (independentVerification.status !== "VERIFIED") {
      limitations.push("Independent verification found a reasoning-chain discrepancy; clinician reconciliation is required before relying on this view.");
    }

    return {
      study_id: evidence.study_id,
      encounter_id: evidence.encounter_id,
      evidence_references: evidence.evidence.map((e) => e.id),
      relevant_symptoms: [...new Set(symptomItems.map((e) => e.category))],
      evidence_conflicts: evidence.conflicts,
      specialist_contributions: evidence.specialist_bundles,
      possible_conditions: evidence.possible_conditions,
      etiology_hypotheses: etiologyHypotheses,
      missing_evidence: missingEvidence,
      urgent_flags: urgentFlags,
      uncertainties,
      limitations,
      provenance: { generated_at: now, engine: "DeterministicReasoningEngine" },
      generated_at: now,
      engine_version: REASONING_ENGINE_VERSION,
      rule_set_version: RULE_SET_VERSION,
      requires_clinician_review: true,
      safety_banner: SAFETY_BANNER,
      blocked_claims: blockedClaims,
      adversarial_reviews: adversarialReviews,
      independent_verification: independentVerification,
    };
  }
}

export function evidenceById(evidence: EvidenceItem[], ids: string[]): EvidenceItem[] {
  const byId = new Map(evidence.map((e) => [e.id, e]));
  return ids.map((id) => byId.get(id)).filter((e): e is EvidenceItem => !!e);
}
