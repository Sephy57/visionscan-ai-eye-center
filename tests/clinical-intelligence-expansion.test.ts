import { describe, expect, it } from "vitest";
import { extractClinicalFromPages } from "@/lib/documents/extraction/clinicalExtraction";
import { buildTestResults, materializeResults } from "@/lib/documents/extraction/testResultParser";
import type { ExtractionArtifact } from "@/lib/documents/extraction/types";
import { buildSpecialistEvidencePackages } from "@/lib/clinical/specialistPackages";
import type { EvidenceItem } from "@/lib/evidence/types";

const ctx = { document_id: "doc_expansion", study_id: "study_expansion", patient_ref: "synthetic" };

function artifact(text: string): ExtractionArtifact {
  return {
    document_id: ctx.document_id,
    study_id: ctx.study_id,
    status: "COMPLETE",
    document_level: "text",
    pages: [{ page: 1, method: "text_layer", char_count: text.length, text, warnings: [] }],
    totals: { pages: 1, pages_text_layer: 1, pages_ocr: 0, pages_empty: 0, pages_failed: 0, char_count: text.length },
    limits_applied: { max_chars_per_doc: 10_000, max_chars_per_page: 10_000, max_time_ms: 1000, max_ocr_time_ms: 1000, max_render_dimension_px: 2000 },
    verification: { status: "UNREVIEWED" }, extraction_version: "test", created_at: new Date().toISOString(), warnings: [],
  };
}

describe("clinical-intelligence expansion - document facts stay provenance-bound", () => {
  it("keeps mixed-eye symptoms local and records negated/uncertain/source claims separately", () => {
    const rec = extractClinicalFromPages([{ page: 1, text: [
      "CC: blurred vision OD and eye pain OS.",
      "History: DM x 12 years. Family history negative for glaucoma.",
      "Assessment: glaucoma suspect. Rule out retinal detachment.",
      "Plan: return in 3 months.",
      "No flashes or floaters. Denies eye pain.",
      "No prior ocular surgery. Patient is not taking latanoprost.",
    ].join("\n"), method: "ocr", confidence: 88 }], ctx);
    const blurred = rec.symptoms.find((s) => s.type === "blurred_vision");
    const pain = rec.symptoms.find((s) => s.type === "eye_pain");
    expect(blurred?.laterality).toBe("right");
    expect(pain?.laterality).toBe("left");
    expect(rec.explicit_negations.some((n) => n.kind === "SYMPTOM" && n.type === "eye_pain")).toBe(true);
    expect(rec.explicit_negations.some((n) => n.kind === "MEDICATION")).toBe(true);
    expect(rec.explicit_negations.some((n) => n.kind === "HISTORY")).toBe(true);
    expect(rec.systemic_candidates.some((s) => s.condition === "diabetes" && s.assertion === "PRESENT")).toBe(true);
    expect(rec.source_document_diagnoses.map((d) => d.assertion)).toEqual(expect.arrayContaining(["UNCERTAIN"]));
    expect(rec.plan_candidates[0]?.value_raw).toContain("return in 3 months");
    expect(rec.follow_up_candidates[0]?.value_raw).toContain("3 months");
    expect(rec.entities.length).toBeGreaterThan(0);
    expect(rec.entities.every((e) => e.source_document_id === ctx.document_id && e.page === 1 && e.extraction_method === "ocr")).toBe(true);
  });

  it("preserves an explicit allergy exception without misclassifying it as medication", () => {
    const rec = extractClinicalFromPages([{ page: 2, text: "Allergies: NKDA except penicillin (rash)." }], ctx);
    expect(rec.allergies).toHaveLength(1);
    expect(rec.allergies[0].allergen_raw.toLowerCase()).toContain("penicillin");
    expect(rec.allergies[0].reaction_raw).toContain("rash");
    expect(rec.medications).toHaveLength(0);
    expect(rec.explicit_negations.some((n) => n.kind === "ALLERGY")).toBe(true);
  });

  it("keeps negative source claims absent and does not infer diabetes from a disease adjective", () => {
    const rec = extractClinicalFromPages([{ page: 3, text: "Negative for diabetic retinopathy. Assessment: glaucoma suspect." }], ctx);
    expect(rec.source_document_diagnoses.some((d) => d.assertion === "ABSENT" && /diabetic retinopathy/i.test(d.diagnosis_raw))).toBe(true);
    expect(rec.source_document_diagnoses.some((d) => d.assertion === "UNCERTAIN" && /glaucoma suspect/i.test(d.diagnosis_raw))).toBe(true);
    expect(rec.systemic_candidates.some((s) => s.condition === "diabetes")).toBe(false);
  });

  it("records a plain no-allergies statement as an explicit absence", () => {
    const rec = extractClinicalFromPages([{ page: 4, text: "No allergies." }], ctx);
    expect(rec.allergies).toHaveLength(0);
    expect(rec.explicit_negations.some((n) => n.kind === "ALLERGY")).toBe(true);
  });

  it("marks OCR failures as partial instead of presenting a complete record", () => {
    const rec = extractClinicalFromPages([{ page: 1, text: "CC: blurred vision", method: "text_layer" }, { page: 2, text: "", method: "ocr_failed" }], ctx);
    expect(rec.status).toBe("PARTIAL");
  });
});

describe("clinical-intelligence expansion - objective measurements", () => {
  it("splits explicit OD/OS IOP rows and refuses incompatible units", () => {
    const pair = buildTestResults(artifact("Exam: IOP 24 mmHg OD, 29 mmHg OS"));
    expect(pair.filter((r) => r.test_type === "IOP")).toHaveLength(2);
    expect(pair.map((r) => r.laterality)).toEqual(["OD", "OS"]);
    const bad = buildTestResults(artifact("IOP OD 21 um"))[0];
    expect(bad.value).toBe(21);
    expect(bad.unit_normalized).toBeUndefined();
    expect(bad.ambiguity_flags).toContain("unexpected_unit");
  });

  it("supports C/D, categorical acuity, metric subtypes and ignores OCT header dates", () => {
    const results = buildTestResults(artifact("CDR OS 1.0; VA OD CF; VF OS MD -2.4 dB PSD 1.2 dB; OCT report dated 2026-03-04 RNFL OD 82 um"));
    expect(results.some((r) => r.test_type === "CUP_TO_DISC_RATIO" && r.value === 1 && r.laterality === "OS")).toBe(true);
    expect(results.some((r) => r.test_type === "VISUAL_ACUITY" && r.value_raw === "CF" && r.unit_normalized === "categorical_acuity")).toBe(true);
    expect(results.some((r) => r.test_type === "VISUAL_FIELD" && r.metric_subtype === "MD")).toBe(true);
    expect(results.some((r) => r.test_type === "VISUAL_FIELD" && r.metric_subtype === "PSD")).toBe(true);
    expect(results.filter((r) => r.test_type === "OCT_MEASUREMENT").map((r) => r.value)).toEqual([82]);
  });

  it("does not treat different metric subtypes as conflicts", () => {
    const drafts = buildTestResults(artifact("VF OS MD -2.4 dB PSD 1.2 dB"));
    const results = materializeResults(ctx.document_id, ctx.study_id, drafts);
    expect(results.every((r) => r.conflicts.length === 0)).toBe(true);
  });
});

function evidence(id: string, category: string, source_type: EvidenceItem["source_type"], laterality: EvidenceItem["laterality"] = "OS"): EvidenceItem {
  return { id, study_id: ctx.study_id, source_type, source_id: id, category, laterality, laterality_source: "explicit", presence: "PRESENT", trust_level: "AUTO_EXTRACTED", qualitative_finding: category, provenance: { study_id: ctx.study_id }, conflict_ids: [] };
}

describe("clinical-intelligence expansion - specialist hand-off", () => {
  it("creates four explicit evidence packages without a diagnosis field or opaque score", () => {
    const packages = buildSpecialistEvidencePackages({
      evidence: [evidence("iop", "IOP", "TEST_RESULT"), evidence("vf", "VISUAL_FIELD", "TEST_RESULT"), evidence("sym", "new_floaters", "SYMPTOM")],
      possible_conditions: [],
      analysis: null,
    });
    expect(packages.map((p) => p.specialty)).toEqual(["RETINA", "GLAUCOMA", "MACULA_OCT", "COMPREHENSIVE"]);
    for (const p of packages) {
      expect(p.requires_clinician_review).toBe(true);
      expect(p.available_models).toBeInstanceOf(Array);
      expect(p.observed_findings).toBeInstanceOf(Array);
      expect(p.supporting_evidence).toBeInstanceOf(Array);
      expect(p.missing_evidence.length).toBeGreaterThan(0);
      expect(Object.prototype.hasOwnProperty.call(p, "diagnosis")).toBe(false);
    }
    expect(packages.find((p) => p.specialty === "GLAUCOMA")?.model_status).toBe("NO_VALIDATED_MODEL_AVAILABLE");
    expect(packages.find((p) => p.specialty === "RETINA")?.urgency_notes.join(" ")).toContain("red-flag");
  });
});
