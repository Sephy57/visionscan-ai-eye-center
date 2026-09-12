import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { validateRawModelOutput } from "@/lib/models/outputContract";
import {
  OPTIC_CUP_FINDING,
  OPTIC_DISC_FINDING,
  validateSegformerAnatomyOutput,
} from "@/lib/models/anatomyValidation";
import {
  segformerOutputToFindingsWithValidation,
} from "@/lib/models/segformerFindingAdapter";
import {
  SEGFORMER_ARTIFACT_SHA256,
  SEGFORMER_MODEL_DIR,
  verifySegformerResearchArtifact,
} from "@/lib/models/segformerResearchProvider";
import { aggregateOctScans } from "@/lib/models/octAggregation";
import { fuseResearchSignals } from "@/lib/analysis/researchFusion";
import { runEnsemble } from "@/lib/analysis/ensemble";
import { getModel } from "@/lib/models/registry";
import { activeProductionCoverage } from "@/lib/models/ophthalmicCoverage";
import { validateValidationCaseManifest } from "@/lib/validation/casePackage";

function anatomyFinding(
  finding_type: string,
  area: number,
  coordinates: { x: number; y: number; w: number; h: number },
) {
  return {
    finding_type,
    localization: { kind: "bounding_box" as const, coordinates },
    measurement: { key: "mask_area_pixels", value: area, unit: "pixel" },
    evidence: `${area} pixel mask area`,
  };
}

function validSegformerOutput() {
  return {
    inference_status: "completed" as const,
    model_id: "segformer-optic-disc-cup-refuge",
    model_version: "1",
    artifact_sha256: SEGFORMER_ARTIFACT_SHA256,
    preprocessing_version: "segformer-infer-v1",
    findings: [
      anatomyFinding(OPTIC_DISC_FINDING, 1000, { x: 0.2, y: 0.2, w: 0.4, h: 0.4 }),
      anatomyFinding(OPTIC_CUP_FINDING, 250, { x: 0.3, y: 0.3, w: 0.2, h: 0.2 }),
    ],
  };
}

describe("Phase 4 anatomy-output admission", () => {
  it("accepts one complete contained pair without turning geometry into clinical CDR", () => {
    const result = validateSegformerAnatomyOutput(validSegformerOutput().findings);
    expect(result.state).toBe("VALID");
    expect(result.cup_to_disc_area_ratio).toBe(0.25);
    expect(result.reasons.join(" ")).toMatch(/does not establish glaucoma|clinical cup-to-disc ratio/i);
  });

  it("rejects cup area greater than disc area and a cup box outside the disc", () => {
    const result = validateSegformerAnatomyOutput([
      anatomyFinding(OPTIC_DISC_FINDING, 100, { x: 0.4, y: 0.4, w: 0.2, h: 0.2 }),
      anatomyFinding(OPTIC_CUP_FINDING, 101, { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }),
    ]);
    expect(result.state).toBe("INVALID");
    expect(result.reasons.join(" ")).toMatch(/exceeds|not contained/i);
  });

  it("marks missing, duplicate, or unmeasured channels incomplete/invalid", () => {
    expect(validateSegformerAnatomyOutput([
      anatomyFinding(OPTIC_DISC_FINDING, 100, { x: 0.2, y: 0.2, w: 0.4, h: 0.4 }),
    ]).state).toBe("INCOMPLETE");
    expect(validateSegformerAnatomyOutput([
      anatomyFinding(OPTIC_DISC_FINDING, 100, { x: 0.2, y: 0.2, w: 0.4, h: 0.4 }),
      anatomyFinding(OPTIC_DISC_FINDING, 90, { x: 0.2, y: 0.2, w: 0.4, h: 0.4 }),
      anatomyFinding(OPTIC_CUP_FINDING, 20, { x: 0.3, y: 0.3, w: 0.2, h: 0.2 }),
    ]).state).toBe("INVALID");
    const incomplete = validSegformerOutput();
    delete (incomplete.findings[1] as { measurement?: unknown }).measurement;
    expect(validateSegformerAnatomyOutput(incomplete.findings).state).toBe("INCOMPLETE");
  });

  it("withholds invalid and incomplete pairs at the adapter boundary", () => {
    const invalid = validSegformerOutput();
    invalid.findings[1].measurement.value = 2000;
    const invalidResult = segformerOutputToFindingsWithValidation(invalid, "FUNDUS");
    expect(invalidResult.anatomy_validation.state).toBe("INVALID");
    expect(invalidResult.findings).toEqual([]);

    const validResult = segformerOutputToFindingsWithValidation(validSegformerOutput(), "FUNDUS");
    expect(validResult.anatomy_validation.state).toBe("VALID");
    expect(validResult.findings).toHaveLength(2);
    expect(validResult.findings[0].structured_measurements?.[0]).toMatchObject({
      key: "mask_area_pixels",
      value: 1000,
      unit: "pixel",
    });
  });
});

describe("Phase 4 strict transport and integrity contracts", () => {
  it("rejects null findings and malformed structured measurements", () => {
    const nullFinding = { inference_status: "completed", findings: [null] };
    expect(validateRawModelOutput(nullFinding).valid).toBe(false);
    const malformed = {
      inference_status: "completed",
      findings: [{ finding_type: "research_segmented_optic_disc_area", measurement: { key: "", value: NaN, unit: "" } }],
    };
    expect(validateRawModelOutput(malformed).valid).toBe(false);
  });

  it("keeps the local SegFormer artifact hash explicit and fails closed when absent/tampered", () => {
    const integrity = verifySegformerResearchArtifact();
    expect(integrity.expected_sha256).toBe(SEGFORMER_ARTIFACT_SHA256);
    if (fs.existsSync(path.join(SEGFORMER_MODEL_DIR, "model.safetensors"))) {
      expect(integrity.trusted).toBe(true);
      expect(integrity.actual_sha256).toBe(SEGFORMER_ARTIFACT_SHA256);
    } else {
      expect(integrity.trusted).toBe(false);
    }
  });
});

describe("Phase 4 OCT scan aggregation", () => {
  const scan = (scan_id: string, predicted_class: "CNV" | "DME" | "DRUSEN" | "NORMAL", laterality: "OD" | "OS" | "unknown" = "OD") => ({
    scan_id, status: "EXECUTED" as const, predicted_class, laterality,
  });

  it("does not manufacture a class when every scan is failed or skipped", () => {
    const result = aggregateOctScans([
      { scan_id: "failed", status: "FAILED", predicted_class: null, laterality: "OD" },
      { scan_id: "skipped", status: "SKIPPED", predicted_class: null, laterality: "OD" },
    ]);
    expect(result.state).toBe("INSUFFICIENT_SCAN_QUALITY");
    expect(result.selected_class).toBeNull();
    expect(result.excluded_scan_ids).toEqual(["failed", "skipped"]);
  });

  it("keeps one scan NOT_COMPARABLE and reports same-eye agreement without logit averaging", () => {
    expect(aggregateOctScans([scan("one", "CNV")]).state).toBe("NOT_COMPARABLE");
    const consistent = aggregateOctScans([scan("a", "NORMAL"), scan("b", "NORMAL")]);
    expect(consistent.state).toBe("CONSISTENT_NO_TARGET_CLASS");
    expect(consistent.selected_class).toBe("NORMAL");
    expect(consistent.note).toMatch(/not a healthy|disease-absence/i);
  });

  it("does not pool bilateral scans and does not choose a winner for mixed classes", () => {
    const bilateral = aggregateOctScans([scan("od", "CNV", "OD"), scan("os", "NORMAL", "OS")]);
    expect(bilateral.state).toBe("NOT_COMPARABLE");
    expect(bilateral.selected_class).toBeNull();
    const mixed = aggregateOctScans([scan("a", "CNV"), scan("b", "DME")]);
    expect(mixed.state).toBe("MIXED_OCT_CLASS_RESULTS");
    expect(mixed.disagreement).toBe(true);
    expect(mixed.selected_class).toBeNull();
  });

  it("does not pool multiple scans whose laterality is unknown", () => {
    const unknown = aggregateOctScans([scan("a", "NORMAL", "unknown"), scan("b", "NORMAL", "unknown")]);
    expect(unknown.state).toBe("NOT_COMPARABLE");
    expect(unknown.selected_class).toBeNull();
  });
});

describe("Phase 4 categorical research fusion", () => {
  it("flags a low DR grade with a lesion signal instead of suppressing either output", () => {
    const result = fuseResearchSignals({ lesion_completed: true, lesion_positive: true, lesion_count: 2, dr_completed: true, dr_grade: 1, dr_referable: false });
    expect(result.agreement).toBe("MODEL_DISAGREEMENT");
    expect(result.contradiction_flags).toContain("DR_BELOW_REFERABLE_THRESHOLD_BUT_LESION_SIGNAL");
  });

  it("flags a referable DR estimate without a supported lesion signal", () => {
    const result = fuseResearchSignals({ lesion_completed: true, lesion_positive: false, lesion_count: 0, dr_completed: true, dr_grade: 2, dr_referable: true });
    expect(result.agreement).toBe("MODEL_DISAGREEMENT");
    expect(result.contradiction_flags).toContain("DR_REFERABLE_WITHOUT_SUPPORTED_LESION_SIGNAL");
  });

  it("never creates a score average or a clinical winner", () => {
    const result = fuseResearchSignals({ lesion_completed: true, lesion_positive: true, lesion_count: 1, dr_completed: true, dr_grade: 2, dr_referable: true, oct_completed: true, oct_class: "CNV" });
    expect(JSON.stringify(result).toLowerCase()).not.toContain("average");
    expect(result.agreement).toBe("CORROBORATED_RESEARCH_EVIDENCE");
  });
});

describe("Phase 4 live-model ensemble visibility", () => {
  const finding = (model_id: string) => ({
    id: model_id,
    type: "retinal_hemorrhage",
    location: "retina",
    severity: "indeterminate" as const,
    confidence: 0.95,
    confidence_category: "HIGH CONFIDENCE" as const,
    confidence_raw: 0.95,
    confidence_calibrated: null,
    taxonomy_level: "observation" as const,
    region: null,
    explanation: "research",
    synthetic: false,
    model_id,
    model_status: "RESEARCH",
  });

  it("caps high-risk single-model confidence and recomputes its category", () => {
    const result = runEnsemble([finding("one")], ["one"]);
    expect(result.cappedFindings[0].confidence).toBe(0.75);
    expect(result.cappedFindings[0].confidence_category).toBe("MODERATE CONFIDENCE");
  });

  it("exposes multiple runtime model outputs without claiming a generic score ensemble", () => {
    const result = runEnsemble([finding("one"), finding("two")], ["one", "two"]);
    expect(result.agreement).toBe("not_applicable");
    expect(result.note).toMatch(/categorical agreement or contradiction/i);
  });

  it("does not treat a different-task model as high-risk corroboration", () => {
    const result = runEnsemble([
      finding("lesion-model"),
      { ...finding("dr-model"), type: "dr_grade_estimate" },
    ], ["lesion-model", "dr-model"]);
    expect(result.cappedFindings[0].confidence).toBe(0.75);
    expect(result.cappedFindings[0].confidence_category).toBe("MODERATE CONFIDENCE");
  });
});

describe("Phase 4 synthetic validation pack and promotion boundary", () => {
  it("contains 40 bounded synthetic cases with no clinical-diagnosis scope", () => {
    const manifest = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "validation-cases/phase4-nextgen-local-intelligence-pack.json"), "utf8")) as unknown;
    const result = validateValidationCaseManifest(manifest);
    expect(result.valid, result.errors.join("; ")).toBe(true);
    expect(result.manifest?.cases).toHaveLength(40);
    expect(JSON.stringify(manifest)).not.toMatch(/\b(?:mrn|medical record|dob|patient name)\b/i);
    for (const validationCase of result.manifest!.cases) {
      expect(validationCase.ground_truth_scope).not.toBe("CLINICAL_DIAGNOSIS");
      expect(validationCase.expected_medication_behavior).toBe("NO_DEFENSIBLE_SOURCE_FOUND");
      expect(validationCase.forbidden_claims?.length).toBeGreaterThan(0);
      expect(validationCase.known_limitations?.length).toBeGreaterThan(0);
      expect(validationCase.assertions.length).toBeGreaterThan(0);
    }
  });

  it("keeps every installed model research-only and production coverage empty", () => {
    for (const modelId of [
      "fundus-dr-grading-effb0",
      "fundus-lesions-clementp-unet-seresnext50",
      "oct-retinal-weights-fp32",
    ]) {
      expect(getModel(modelId)?.status).toBe("RESEARCH");
      expect(getModel(modelId)?.regulatory_status).toBe("research_only");
    }
    expect(activeProductionCoverage()).toEqual([]);
  });
});
