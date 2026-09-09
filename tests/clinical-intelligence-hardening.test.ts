import { describe, expect, it } from "vitest";
import { evidenceFromFindings } from "@/lib/evidence/adapters";
import { enrichEvidenceGraph, temporalStateForEvidence } from "@/lib/evidence/canonical";
import { reviewConditionAdversarially } from "@/lib/clinical/clinicalRedTeam";
import { verifyReasoningChain } from "@/lib/clinical/independentVerifier";
import { validateAnalysisResult } from "@/lib/analysis/schema";
import { detectConflicts } from "@/lib/evidence/conflicts";
import type { ConditionAssessment, EvidenceItem } from "@/lib/evidence/types";

function item(overrides: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    id: "raw-1", study_id: "study-hardening", source_type: "TEST_RESULT", source_id: "result-1",
    category: "IOP", laterality: "OD", laterality_source: "explicit", value: 22,
    presence: "PRESENT", trust_level: "HUMAN_VERIFIED", provenance: { study_id: "study-hardening" },
    conflict_ids: [], ...overrides,
  };
}

describe("clinical intelligence hardening", () => {
  it("preserves explicit finding laterality and adds stable provenance ids", () => {
    const findings = evidenceFromFindings("study-hardening", "OD", [
      { id: "f-od", type: "retinal_hemorrhage", location: "macula", severity: "moderate", confidence: 0.4, confidence_category: "LOW CONFIDENCE", explanation: "Research observation only; clinician review required.", synthetic: false, model_id: "research-model", laterality: "OD", source_asset_id: "asset-a" },
      { id: "f-os", type: "retinal_hemorrhage", location: "macula", severity: "moderate", confidence: 0.4, confidence_category: "LOW CONFIDENCE", explanation: "Research observation only; clinician review required.", synthetic: false, model_id: "research-model", laterality: "OS", source_asset_id: "asset-a" },
    ]);
    const enriched = enrichEvidenceGraph(findings, { studyId: "study-hardening", patientId: "patient-1", modality: "fundus", referenceTimestamp: "2026-09-09T00:00:00Z" });
    expect(enriched[0].laterality).toBe("OD");
    expect(enriched[1].laterality).toBe("OS");
    expect(enriched[0].evidence_id).toMatch(/^ev_[a-f0-9]{24}$/);
    expect(enriched[0].dependency_group_id).toBe(enriched[1].dependency_group_id);
    expect(enriched[0].patient_id).toBe("patient-1");
  });

  it("separates dependency groups and records explicit temporal states", () => {
    const ai = item({ source_type: "AI_FINDING", source_id: "f-1", category: "retinal_hemorrhage", provenance: { study_id: "study-hardening", source_asset_id: "asset-a", finding_id: "f-1" }, trust_level: "UNVERIFIED" });
    const test = item({ source_id: "r-2", provenance: { study_id: "study-hardening", result_id: "r-2" }, timestamp: "2026-09-05T00:00:00Z" });
    const enriched = enrichEvidenceGraph([ai, test], { studyId: "study-hardening", referenceTimestamp: "2026-09-09T00:00:00Z" });
    expect(enriched[0].dependency_group_id).not.toBe(enriched[1].dependency_group_id);
    expect(enriched[1].temporal_state).toBe("NEARBY_ENCOUNTER");
    expect(temporalStateForEvidence(item(), "2026-09-09T00:00:00Z")).toBe("TEMPORALLY_UNCERTAIN");
  });

  it("projects richer condition metadata through JSON while retaining the legacy object-key contract", async () => {
    const { assessConditions } = await import("@/lib/evidence/synthesize");
    const [assessment] = assessConditions([item({ id: "iop", category: "IOP" })]).filter((candidate) => candidate.condition_id === "iop_evidence_pattern" && candidate.laterality === "OD");
    expect(assessment.assessment_state).toBeDefined();
    expect(Object.keys(assessment)).not.toContain("assessment_state");
    expect(JSON.parse(JSON.stringify(assessment)).assessment_state).toBeDefined();
  });

  it("weakens a hypothesis with unresolved contradiction or cross-eye support", () => {
    const assessment: ConditionAssessment = {
      condition_id: "test-condition", canonical_name: "test", category: "test", laterality: "OD", state: "POSSIBLE_CONDITION",
      supporting_evidence_ids: ["e-os"], contradicting_evidence_ids: ["e-contra"], missing_required: [], red_flag_candidates: [], differential_relationships: [], taxonomy_version: "test", note: "non-diagnostic",
      dependency_groups: ["group-os"],
    };
    const result = reviewConditionAdversarially(assessment, [
      item({ id: "e-os", laterality: "OS", dependency_group_id: "group-os" }),
      item({ id: "e-contra", source_id: "r-3", value: 30, dependency_group_id: "group-test" }),
    ]);
    expect(result.outcome).toBe("HYPOTHESIS_WEAKENED");
    expect(result.checks.some((c) => c.check === "laterality_is_compatible" && !c.passed)).toBe(true);
    expect(result.requires_clinician_review).toBe(true);
  });

  it("returns a final disagreement when a reasoning reference is missing", () => {
    const result = verifyReasoningChain({
      evidence: [item({ id: "e1" })],
      conditions: [{ condition_id: "c1", canonical_name: "x", category: "x", laterality: "OD", state: "POSSIBLE_CONDITION", supporting_evidence_ids: ["missing"], contradicting_evidence_ids: [], missing_required: [], red_flag_candidates: [], differential_relationships: [], taxonomy_version: "x", note: "x" }],
      urgentFlags: [{ symptom_type: "sudden_vision_loss", urgency: "emergency", independent_of_ai_findings: true }],
    });
    expect(result.status).toBe("FINAL_REASONING_DISAGREEMENT");
    expect(result.discrepancies[0]).toContain("missing evidence");
  });

  it("rejects a malformed execution ledger row", () => {
    const result = validateAnalysisResult({ model_execution_ledger: [{ execution_status: "NOT_A_STATUS" }] });
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.path.includes("model_execution_ledger[0].model_id"))).toBe(true);
    expect(result.errors.some((error) => error.path.includes("model_execution_ledger[0].execution_status"))).toBe(true);
  });

  it("keeps a source-document negative separate and surfaces a semantic AI conflict", () => {
    const conflicts = detectConflicts([
      item({ id: "source-negative", source_type: "SOURCE_DOCUMENT_DIAGNOSIS", source_id: "doc-1", category: "source_document_diagnosis", laterality: "OD", qualitative_finding: "No diabetic retinopathy", presence: "ABSENT", trust_level: "AUTO_EXTRACTED" }),
      item({ id: "ai-positive", source_type: "AI_FINDING", source_id: "finding-1", category: "dr_grade_estimate", laterality: "OD", qualitative_finding: "grade estimate", trust_level: "UNVERIFIED" }),
    ]);
    expect(conflicts.some((conflict) => conflict.conflict_type === "SOURCE_DIAGNOSIS_CONFLICT")).toBe(true);
    expect(conflicts[0].note).toContain("source document");
  });
});
