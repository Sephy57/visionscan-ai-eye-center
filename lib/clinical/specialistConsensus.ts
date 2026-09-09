import type { SpecialtyId } from "./specialistRegistry";
import type { ModelDisagreement, SpecialistAnalysisResult, SpecialistFailureState } from "../models/specialistOutputTypes";

/**
 * A deterministic, non-averaging consensus summary. This is deliberately a
 * coordination object rather than a second diagnostic engine: it reports
 * what each specialist capability actually returned, retains disagreements,
 * and identifies validation/confirmation gaps without choosing a winner.
 */
export interface SpecialistConsensus {
  status: "NO_SPECIALIST_OUTPUT" | "REVIEW_REQUIRED";
  /** Detailed state for clinician review; `status` remains the legacy banner. */
  consensus_state: "SPECIALISTS_CONCORDANT" | "PARTIAL_CORROBORATION" | "SPECIALIST_DISAGREEMENT" | "INSUFFICIENT_SPECIALIST_EVIDENCE";
  specialty_summaries: Array<{
    specialty_id: SpecialtyId;
    capability_id: string | null;
    outcome: "COMPLETED" | "FAILED" | "NO_VALIDATED_MODEL_AVAILABLE";
    findings_count: number;
    possible_conditions_count: number;
    quality_status: SpecialistAnalysisResult["quality_status"];
    ood_status: SpecialistAnalysisResult["ood_status"];
    validation_status: SpecialistAnalysisResult["validation_status"];
    failure_state: SpecialistFailureState | null;
    limitations: string[];
  }>;
  shared_evidence_ids: string[];
  disagreements: ModelDisagreement[];
  missing_confirmation: string[];
  urgent_issues: string[];
  requires_clinician_review: true;
  note: string;
  generated_at: string;
}

function outcomeOf(result: SpecialistAnalysisResult): SpecialistConsensus["specialty_summaries"][number]["outcome"] {
  if (result.failure_state === "NO_VALIDATED_MODEL_AVAILABLE") return "NO_VALIDATED_MODEL_AVAILABLE";
  if (result.failure_state) return "FAILED";
  return "COMPLETED";
}

/**
 * Summarize specialist results without averaging scores or converting model
 * output into a condition. Empty input is an explicit safe state.
 */
export function buildSpecialistConsensus(results: SpecialistAnalysisResult[]): SpecialistConsensus {
  const evidenceCounts = new Map<string, number>();
  for (const result of results) {
    for (const id of new Set(result.input_evidence_ids)) {
      evidenceCounts.set(id, (evidenceCounts.get(id) ?? 0) + 1);
    }
  }

  const disagreements = results.flatMap((result) => result.disagreements ?? []);
  const missing = new Set<string>();
  const urgent = new Set<string>();
  for (const result of results) {
    if (result.validation_status !== "CLINICALLY_VALIDATED") {
      missing.add(`${result.specialty_id}: no clinically validated model for autonomous diagnosis`);
    }
    if (result.quality_status !== "pass" && result.failure_state !== "NO_VALIDATED_MODEL_AVAILABLE") {
      missing.add(`${result.specialty_id}: image quality confirmation is incomplete (${result.quality_status})`);
    }
    if (result.ood_status === "out_of_distribution") {
      missing.add(`${result.specialty_id}: in-distribution applicability is not established`);
    }
    if (result.failure_state === "QUALITY_FAILED" || result.failure_state === "OOD_REJECTED" || result.failure_state === "MODEL_INTEGRITY_FAILURE") {
      urgent.add(`${result.specialty_id}: specialist output is blocked and requires clinician review`);
    }
  }

  const summaries = results.map((result) => ({
    specialty_id: result.specialty_id,
    capability_id: result.capability_id,
    outcome: outcomeOf(result),
    findings_count: result.findings.length,
    possible_conditions_count: result.possible_conditions.length,
    quality_status: result.quality_status,
    ood_status: result.ood_status,
    validation_status: result.validation_status,
    failure_state: result.failure_state,
    limitations: [...result.limitations],
  }));
  const hasActionableOutput = results.some((result) => result.failure_state !== "NO_VALIDATED_MODEL_AVAILABLE");
  const completed = results.filter((result) => !result.failure_state).length;
  const consensusState: SpecialistConsensus["consensus_state"] = !hasActionableOutput
    ? "INSUFFICIENT_SPECIALIST_EVIDENCE"
    : disagreements.length > 0
      ? "SPECIALIST_DISAGREEMENT"
      : completed > 1 && completed === results.length
        ? "SPECIALISTS_CONCORDANT"
        : "PARTIAL_CORROBORATION";

  return {
    status: hasActionableOutput ? "REVIEW_REQUIRED" : "NO_SPECIALIST_OUTPUT",
    consensus_state: consensusState,
    specialty_summaries: summaries,
    shared_evidence_ids: [...evidenceCounts.entries()].filter(([, count]) => count > 1).map(([id]) => id),
    disagreements,
    missing_confirmation: [...missing],
    urgent_issues: [...urgent],
    requires_clinician_review: true,
    note: hasActionableOutput
      ? "Specialist outputs are shown side by side. No score was averaged and no specialist was selected as a winner; independent triage and clinician review remain authoritative."
      : "No specialist model produced an actionable output for this record. This is an explicit safe state, not a normality claim.",
    generated_at: new Date().toISOString(),
  };
}
