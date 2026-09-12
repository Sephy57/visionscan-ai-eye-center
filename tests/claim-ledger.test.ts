import { describe, expect, it } from "vitest";
import { buildClaimLedger } from "@/lib/clinical/claimLedger";
import { runSafetyChecks } from "@/lib/clinical/safety";
import type { AnalysisResult } from "@/lib/analysis/schema";

function fixture(): AnalysisResult {
  return {
    schema_version: "1.0.0",
    study: { study_id: "claim-ledger-study", modality: "fundus", eye: "OD", source: "synthetic", metadata_provenance: "none" },
    quality: { score: 0.9, acceptable: true, status: "PASS", artifacts: [], affected_regions: [], recommended_reacquisition: false },
    segmentation: { implemented: false, note: "none" },
    findings: [{
      id: "finding-1", type: "microaneurysm_like_lesion", location: "retina", severity: "mild", confidence: 0.4,
      confidence_category: "LOW CONFIDENCE", explanation: "A research model marked a lesion-like region for review.",
      synthetic: false, model_id: "research-model", model_version: "1.0.0", model_status: "RESEARCH", laterality: "OD", source_asset_id: "asset-1",
    }],
    uncertainty: { overall: 0.8, reasons: ["not calibrated"] },
    recommendation: { priority: "prompt_professional_review", action: "Review with a qualified eye-care professional.", rationale: "Research output requires correlation." },
    ensemble: { performed: false, checks: [], note: "none" },
    demo: { synthetic_result: false, label: "RESEARCH ONLY" },
    diagnosis_gate: { allowed: false, reasons: ["RESEARCH_ONLY"], clinical_interpretation: "REQUIRES_CLINICAL_CORRELATION" },
    provenance: { models: [{ model_id: "research-model" }], ruleset_version: "test", analyzed_at: new Date().toISOString(), input_dimensions: { width: 10, height: 10 }, pipeline_version: "test" },
    safety: { quality_gate_enforced: true, disclaimers: ["NOT CLINICALLY VALIDATED", "A negative automated result does not guarantee that no eye disease is present."], blocked_claims: [] },
  } as AnalysisResult;
}

describe("claim ledger", () => {
  it("retains evidence references and keeps research observations review-only", () => {
    const analysis = fixture();
    analysis.claim_ledger = buildClaimLedger(analysis);
    expect(analysis.claim_ledger.publication_blocked).toBe(false);
    expect(analysis.claim_ledger.entries[0]).toMatchObject({
      claim_type: "OBSERVATION",
      release_status: "RESEARCH_REVIEW_ONLY",
      evidence_refs: ["finding:finding-1", "asset:asset-1"],
      clinician_review_required: true,
    });
    expect(runSafetyChecks(analysis).checks.find((check) => check.rule === "claim_ledger_evidence_gate")?.passed).toBe(true);
  });

  it("fails the safety gate when a claim ledger is tampered into a no-evidence state", () => {
    const analysis = fixture();
    analysis.claim_ledger = buildClaimLedger(analysis);
    analysis.claim_ledger.entries[0].evidence_refs = [];
    expect(runSafetyChecks(analysis).checks.find((check) => check.rule === "claim_ledger_evidence_gate")?.passed).toBe(false);
  });
});
