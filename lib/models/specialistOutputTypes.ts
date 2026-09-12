/**
 * Specialist orchestration output contracts (Phase 3, §5-7, §18, §23, §24, §35).
 *
 * HARD RULES:
 *  - `Finding` (lib/analysis/schema.ts) is REUSED, not duplicated - §19
 *    requires every specialist output to map to the existing finding
 *    taxonomy, so SpecialistAnalysisResult.findings is Finding[], the same
 *    type the DEMO pipeline and the research-analysis path already produce
 *    and the same type localization-range validation
 *    (lib/models/outputContract.ts) already enforces.
 *  - `ModelProvider` (§5) is a TYPE-ONLY interface with zero implementation
 *    anywhere in this file or module. Its §24 sibling, `ReasoningEngine`
 *    (the future LLM-reasoning-layer contract), now lives in
 *    lib/models/reasoningEngine.ts (Phase 4) - see that file's own
 *    `LLMReasoningEngine`, which MUST remain unimplemented.
 */

import type { Finding } from "../analysis/schema";
import type { SpecialtyId } from "../clinical/specialistRegistry";
import type { EtiologyHypothesis } from "../evidence/etiology";

/**
 * Explicit failure states (§35/§36). A model failure is NEVER converted
 * into "no disease detected" - these are categorically different from
 * NO_TARGET_FINDING_DETECTED (lib/reports/terminology.ts), which means
 * "a real model ran successfully and found nothing it's built to detect".
 */
export type SpecialistFailureState =
  | "MODEL_UNAVAILABLE"
  | "MODEL_TIMEOUT"
  | "MODEL_INPUT_UNSUPPORTED"
  | "MODEL_OUTPUT_INVALID"
  | "MODEL_INTEGRITY_FAILURE"
  | "MODEL_NOT_VALIDATED"
  | "QUALITY_FAILED"
  | "OOD_REJECTED"
  | "DEVICE_UNSUPPORTED"
  | "NO_VALIDATED_MODEL_AVAILABLE";

/** Phase 2 execution vocabulary. `NOT_EXECUTED` is an explicit safe state,
 * never a silent empty result. */
export type SpecialistExecutionState = "EXECUTED" | "NOT_EXECUTED" | "BLOCKED" | "FAILED";
export type SpecialistUrgency = "NONE" | "ROUTINE" | "PROMPT" | "URGENT" | "EMERGENT" | "UNKNOWN";

export interface SpecialistModelUse {
  model_id: string;
  model_version: string;
  task: string;
  status: string;
  artifact_sha256: string | null;
}

export const SPECIALIST_FAILURE_COPY: Record<SpecialistFailureState, string> = {
  MODEL_UNAVAILABLE: "The model could not be reached or executed.",
  MODEL_TIMEOUT: "The model did not complete within the allotted time.",
  MODEL_INPUT_UNSUPPORTED: "This input is not in a format the model accepts.",
  MODEL_OUTPUT_INVALID: "The model produced output that failed contract validation and was discarded.",
  MODEL_INTEGRITY_FAILURE: "The model artifact failed an integrity check and was not run.",
  MODEL_NOT_VALIDATED: "This model exists but is not validated for the intended use/population/modality of this input.",
  QUALITY_FAILED: "Image quality did not meet the threshold required for this capability.",
  OOD_REJECTED: "The input falls outside this model's validated operating conditions.",
  DEVICE_UNSUPPORTED: "The acquisition device is not within this model's documented device scope.",
  NO_VALIDATED_MODEL_AVAILABLE: "No validated model exists for this specialist capability in this deployment. This is a correct, safe state - not an error.",
};

/** §18 - explicit disagreement representation. Never resolved by averaging or an arbitrary winner-selection rule. */
export interface ModelDisagreement {
  capability_id: string;
  finding_type: string;
  model_a: { model_id: string; model_version: string; output_summary: string };
  model_b: { model_id: string; model_version: string; output_summary: string };
  difference_description: string;
  requires_clinician_review: true;
}

/** §23 - the structured result of routing + (attempted) execution for one specialty. */
export interface SpecialistAnalysisResult {
  specialty_id: SpecialtyId;
  capability_id: string | null;
  input_evidence_ids: string[];
  model_outputs_ref: string[]; // opaque references (e.g. raw output ids), never inlined raw prose
  findings: Finding[]; // reuses the existing finding taxonomy - see file header
  possible_conditions: EtiologyHypothesis[]; // reuses Phase 1's etiology hypothesis shape, never a diagnosis
  uncertainties: string[];
  quality_status: "pass" | "borderline" | "fail" | "unknown";
  ood_status: "in_distribution" | "out_of_distribution" | "unknown";
  validation_status: "NOT_VALIDATED" | "RESEARCH_ONLY" | "INTERNALLY_VALIDATED" | "EXTERNALLY_VALIDATED" | "CLINICALLY_VALIDATED";
  limitations: string[];
  requires_clinician_review: true; // always true in this deployment - never a computed/overridable field
  failure_state: SpecialistFailureState | null; // set instead of findings when execution did not succeed
  disagreements: ModelDisagreement[];
  provenance: {
    generated_at: string;
    router_decision_summary: string;
  };
  /** Phase 2 explicit specialist-review contract. Optional for legacy rows. */
  execution_state?: SpecialistExecutionState;
  models_used?: SpecialistModelUse[];
  evidence_reviewed?: string[];
  evidence_for?: string[];
  evidence_against?: string[];
  contradictions?: string[];
  missing_evidence?: string[];
  urgency?: SpecialistUrgency;
  review_required?: true;
}

/**
 * §5 - the intended shape a real model integration must satisfy. TYPE ONLY.
 * No class in this codebase implements this yet; lib/models/segformerResearchProvider.ts
 * and lib/models/provider.ts predate this interface and are NOT required to
 * be refactored onto it this phase (would be an unnecessary rewrite of a
 * stable, already-tested system).
 */
export interface ModelProvider<TInput = unknown, TOutput = unknown> {
  getMetadata(): { model_id: string; model_version: string; specialty_id: SpecialtyId; capability_id: string };
  supports(input: TInput): boolean;
  validateInput(input: TInput): { valid: boolean; errors: string[] };
  infer(input: TInput): Promise<TOutput>;
  validateOutput(output: TOutput): { valid: boolean; errors: string[] };
}

// §24's ReasoningEngine stub (originally declared here in Phase 3) was
// superseded by Phase 4's fuller, better-specified version -
// see lib/models/reasoningEngine.ts's `ReasoningEngine` (implemented today
// by `DeterministicReasoningEngine`) and its still-unimplemented
// `LLMReasoningEngine`. Not redeclared here to avoid two same-named,
// differently-shaped interfaces existing in the codebase at once.
