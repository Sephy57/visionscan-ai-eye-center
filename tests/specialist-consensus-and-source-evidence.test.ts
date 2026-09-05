import { describe, expect, it } from "vitest";
import { extractClinicalFromPages } from "@/lib/documents/extraction/clinicalExtraction";
import { evidenceFromSourceDocumentDiagnoses, evidenceFromExtractedNegations } from "@/lib/evidence/adapters";
import { buildSpecialistConsensus } from "@/lib/clinical/specialistConsensus";
import type { SpecialistAnalysisResult } from "@/lib/models/specialistOutputTypes";

describe("source-document evidence and specialist consensus safety", () => {
  it("keeps an explicitly labelled source diagnosis separate from VisionScan output", () => {
    const extraction = extractClinicalFromPages(
      [{ page: 3, text: "Assessment: primary open-angle glaucoma. Review fields." }],
      { document_id: "doc-consensus", study_id: "study-consensus" },
    );
    const [item] = evidenceFromSourceDocumentDiagnoses("study-consensus", { ...extraction, annotations: {} });
    expect(item.source_type).toBe("SOURCE_DOCUMENT_DIAGNOSIS");
    expect(item.qualitative_finding).toContain("primary open-angle glaucoma");
    expect(item.provenance.page).toBe(3);
    expect(item.trust_level).toBe("AUTO_EXTRACTED");
    expect(item.uncertainty).toContain("source_document_claim");
    expect(item.provenance.document_id).toBe("doc-consensus");
  });

  it("represents a documented negation as ABSENT evidence, not a positive symptom", () => {
    const extraction = extractClinicalFromPages(
      [{ page: 1, text: "No eye pain, flashes, or floaters." }],
      { document_id: "doc-negation", study_id: "study-negation" },
    );
    const items = evidenceFromExtractedNegations("study-negation", { ...extraction, annotations: {} });
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((item) => item.presence === "ABSENT")).toBe(true);
    expect(items.some((item) => item.category === "eye_pain")).toBe(true);
  });

  it("consensus reports disagreements without averaging or selecting a winner", () => {
    const base = (specialty_id: SpecialistAnalysisResult["specialty_id"], finding_type: string): SpecialistAnalysisResult => ({
      specialty_id,
      capability_id: "capability",
      input_evidence_ids: ["evidence-shared"],
      model_outputs_ref: [finding_type],
      findings: [],
      possible_conditions: [],
      uncertainties: [],
      quality_status: "pass",
      ood_status: "in_distribution",
      validation_status: "RESEARCH_ONLY",
      limitations: [],
      requires_clinician_review: true,
      failure_state: null,
      disagreements: [{
        capability_id: "capability",
        finding_type,
        model_a: { model_id: "a", model_version: "1", output_summary: "one" },
        model_b: { model_id: "b", model_version: "1", output_summary: "two" },
        difference_description: "different output",
        requires_clinician_review: true,
      }],
      provenance: { generated_at: new Date().toISOString(), router_decision_summary: "test" },
    });
    const consensus = buildSpecialistConsensus([base("RETINA", "retinal_signal"), base("GLAUCOMA", "optic_signal")]);
    expect(consensus.status).toBe("REVIEW_REQUIRED");
    expect(consensus.shared_evidence_ids).toEqual(["evidence-shared"]);
    expect(consensus.disagreements).toHaveLength(2);
    expect(consensus.note).toMatch(/No score was averaged/);
    expect(consensus.requires_clinician_review).toBe(true);
  });
});
