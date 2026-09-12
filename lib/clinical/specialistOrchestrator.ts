/**
 * Specialist Orchestrator (Phase 3, top-level entry point, §1 pipeline).
 *
 * CLINICAL EVIDENCE -> MODALITY/QUALITY GATES -> SPECIALIST ROUTER ->
 * MODEL CAPABILITY REGISTRY -> APPROPRIATE MODEL(S) -> RAW MODEL OUTPUT ->
 * VALIDATION/SCHEMA CHECK -> OOD/COMPATIBILITY GATES -> NORMALIZED AI
 * FINDING -> UNCERTAINTY -> EVIDENCE GRAPH -> CLINICIAN REVIEW.
 *
 * HARD RULE: this module NEVER runs inference itself and NEVER duplicates
 * lib/evidence/researchAnalysis.ts's fail-closed logic. For the one
 * specialty/capability that has a real executable model
 * (RETINA/optic_disc_cup_segmentation, backed by the isolated SegFormer
 * research path), it calls runResearchAnalysis() - the same, single,
 * already-tested execution path every other consumer of that model uses -
 * and wraps its result. Every other specialty is answered immediately,
 * without attempting anything, as NO_VALIDATED_MODEL_AVAILABLE (§16: "that
 * is a successful safe state").
 */

import type { PatientSymptom } from "./symptoms";
import { routeSpecialists, type SpecialistRoutingDecision } from "./specialistRouter";
import { getCapability } from "./specialistCapabilities";
import { runResearchAnalysis } from "../evidence/researchAnalysis";
import { summarizeEtiology } from "../evidence/etiology";
import { assessConditions } from "../evidence/synthesize";
import { evidenceFromFindings } from "../evidence/adapters";
import type { SpecialistAnalysisResult, SpecialistFailureState } from "../models/specialistOutputTypes";
import type { SpecialtyId } from "./specialistRegistry";
import { canonicalModality } from "../models/modalities";

function failureResult(
  decision: SpecialistRoutingDecision,
  capability_id: string | null,
  failure_state: SpecialistFailureState,
): SpecialistAnalysisResult {
  const noCompatibleImageModel = failure_state === "NO_VALIDATED_MODEL_AVAILABLE";
  return {
    specialty_id: decision.specialty_id,
    capability_id,
    input_evidence_ids: [],
    model_outputs_ref: [],
    findings: [],
    possible_conditions: [],
    uncertainties: [],
    quality_status: "unknown",
    ood_status: "unknown",
    validation_status: "NOT_VALIDATED",
    limitations: [decision.status_summary],
    requires_clinician_review: true,
    failure_state,
    disagreements: [],
    provenance: { generated_at: new Date().toISOString(), router_decision_summary: decision.status_summary },
    execution_state: failure_state === "NO_VALIDATED_MODEL_AVAILABLE" ? "NOT_EXECUTED" : "FAILED",
    models_used: [],
    evidence_reviewed: [],
    evidence_for: [],
    evidence_against: [],
    contradictions: [],
    missing_evidence: [
      ...(noCompatibleImageModel ? ["NO COMPATIBLE IMAGE MODEL"] : []),
      "Clinician examination and specialty-specific confirmation remain missing.",
    ],
    urgency: "UNKNOWN",
    review_required: true,
  };
}

/**
 * Runs the full orchestration pipeline for one study: route, then execute
 * only the one real, isolated, gate-checked capability that exists.
 * Bounded concurrency is moot today (exactly zero-or-one real executions
 * per call), but the per-specialty failure isolation (§34/§35) is real: a
 * failure in the one real capability produces a failure_state for that
 * specialty only, never an exception that would prevent the other 8
 * specialties from reporting their own (NO_VALIDATED_MODEL_AVAILABLE)
 * result.
 */
export async function orchestrateSpecialistAnalysis(
  studyId: string,
  modality: string,
  symptoms: PatientSymptom[],
): Promise<SpecialistAnalysisResult[]> {
  const decisions = routeSpecialists({ modality, symptoms });
  const results: SpecialistAnalysisResult[] = [];

  for (const decision of decisions) {
    if (!decision.relevant) {
      results.push(failureResult(decision, null, "NO_VALIDATED_MODEL_AVAILABLE"));
      continue;
    }
    if (!decision.any_capability_executable) {
      results.push(failureResult(decision, null, "NO_VALIDATED_MODEL_AVAILABLE"));
      continue;
    }

    // Exactly one path in this deployment reaches here: RETINA's
    // optic_disc_cup_segmentation capability, and only for a modality it
    // actually supports (matches the same modality-scoping the router just
    // used to compute any_capability_executable). Every other specialty's
    // capabilities all have may_execute === false (see
    // specialistCapabilities.ts), so any_capability_executable is false
    // for them and they were already handled above.
    const canonical = canonicalModality(modality);
    const executable = decision.capabilities.find((c) => c.may_execute && c.supported_modalities.includes(canonical));
    if (!executable) {
      results.push(failureResult(decision, null, "NO_VALIDATED_MODEL_AVAILABLE"));
      continue;
    }

    try {
      const research = await runResearchAnalysis(studyId);
      results.push(await wrapResearchAnalysisResult(decision.specialty_id, executable.capability_id, studyId, research));
    } catch {
      // A real execution failure isolates to this one specialty's result -
      // it never throws out of the orchestrator and never aborts the loop
      // for the remaining specialties (§34's failure-isolation requirement).
      results.push(failureResult(decision, executable.capability_id, "MODEL_UNAVAILABLE"));
    }
  }

  return results;
}

async function wrapResearchAnalysisResult(
  specialty_id: SpecialtyId,
  capability_id: string,
  studyId: string,
  research: Awaited<ReturnType<typeof runResearchAnalysis>>,
): Promise<SpecialistAnalysisResult> {
  const failureMap: Record<string, SpecialistFailureState> = {
    UNSUPPORTED_MODALITY: "MODEL_INPUT_UNSUPPORTED",
    IMAGE_QUALITY_INSUFFICIENT: "QUALITY_FAILED",
    OUT_OF_DISTRIBUTION: "OOD_REJECTED",
    INFERENCE_UNAVAILABLE: "MODEL_UNAVAILABLE",
    NOT_A_STUDY: "MODEL_INPUT_UNSUPPORTED",
  };

  if (research.state !== "COMPLETED") {
    return {
      specialty_id, capability_id,
      input_evidence_ids: [], model_outputs_ref: [], findings: [], possible_conditions: [], uncertainties: [],
      quality_status: (research.quality_status as "pass" | "borderline" | "fail" | undefined) ?? "unknown",
      ood_status: research.state === "OUT_OF_DISTRIBUTION" ? "out_of_distribution" : "unknown",
      validation_status: "RESEARCH_ONLY",
      limitations: [research.reason ?? research.state],
      requires_clinician_review: true,
      failure_state: failureMap[research.state] ?? "MODEL_UNAVAILABLE",
      disagreements: [],
      provenance: { generated_at: research.generated_at, router_decision_summary: research.state },
      execution_state: "FAILED",
      models_used: [],
      evidence_reviewed: [],
      evidence_for: [],
      evidence_against: [],
      contradictions: [],
      missing_evidence: ["A compatible specialty model did not complete.", "Clinician review remains required."],
      urgency: research.state === "OUT_OF_DISTRIBUTION" ? "PROMPT" : "UNKNOWN",
      review_required: true,
    };
  }

  // Real success: reuse the already-computed evidence workspace's condition
  // assessments (never re-derive clinical logic here) and reframe through
  // Phase 1's etiology engine - both already fail-closed.
  const findingEvidence = evidenceFromFindings(studyId, "unknown", research.findings);
  // Prefer the evidence ids already present in the research workspace. The
  // old path created a second set of random ids here, leaving specialist
  // bundles pointing at evidence that was not in StructuredClinicalEvidence.
  const workspaceEvidenceIds = research.evidence_workspace
    ? research.findings.map((f) => research.evidence_workspace!.evidence.find((e) => e.source_type === "AI_FINDING" && e.source_id === f.id)?.id).filter((id): id is string => !!id)
    : [];
  const assessments = research.evidence_workspace
    ? assessConditions(research.evidence_workspace.evidence)
    : assessConditions(findingEvidence);
  const possibleConditions = summarizeEtiology(assessments, research.evidence_workspace?.evidence ?? findingEvidence);

  return {
    specialty_id, capability_id,
    input_evidence_ids: workspaceEvidenceIds.length > 0 ? workspaceEvidenceIds : findingEvidence.map((e) => e.id),
    model_outputs_ref: research.findings.map((f) => f.id),
    findings: research.findings,
    possible_conditions: possibleConditions,
    uncertainties: research.findings.map((f) => `${f.type}: model output, not calibrated confidence`),
    quality_status: (research.quality_status as "pass" | "borderline" | "fail" | undefined) ?? "unknown",
    ood_status: "in_distribution",
    validation_status: "RESEARCH_ONLY",
    limitations: [
      "Research-only model - not clinically validated for any diagnosis.",
      "Requires clinician correlation before any of this information is acted on.",
    ],
    requires_clinician_review: true,
    failure_state: null,
    disagreements: [],
    provenance: { generated_at: research.generated_at, router_decision_summary: "COMPLETED" },
    execution_state: "EXECUTED",
    models_used: [{
      model_id: executableModelIdForResearch(research),
      model_version: executableModelVersionForResearch(research),
      task: "optic disc/cup anatomy segmentation",
      status: "RESEARCH",
      artifact_sha256: null,
    }],
    evidence_reviewed: workspaceEvidenceIds.length > 0 ? workspaceEvidenceIds : findingEvidence.map((e) => e.id),
    evidence_for: (research.evidence_workspace?.evidence ?? findingEvidence)
      .filter((e) => e.source_type === "AI_FINDING" && e.presence === "PRESENT")
      .map((e) => e.id),
    evidence_against: (research.evidence_workspace?.evidence ?? findingEvidence)
      .filter((e) => e.presence === "ABSENT" || e.conflict_ids.length > 0)
      .map((e) => e.id),
    contradictions: research.evidence_workspace?.conflicts.map((c) => c.id) ?? [],
    missing_evidence: ["Clinician optic-nerve examination and validated disease confirmation."],
    urgency: "UNKNOWN",
    review_required: true,
  };
}

function executableModelIdForResearch(research: Awaited<ReturnType<typeof runResearchAnalysis>>): string {
  return research.findings[0]?.model_id ?? "segformer-optic-disc-cup-refuge";
}

function executableModelVersionForResearch(research: Awaited<ReturnType<typeof runResearchAnalysis>>): string {
  return research.findings[0]?.model_version ?? "1";
}
