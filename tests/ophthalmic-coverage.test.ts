import { describe, expect, it } from "vitest";
import { activeProductionCoverage, coverageForModality, OPHTHALMIC_COVERAGE_REGISTRY } from "@/lib/models/ophthalmicCoverage";

describe("ophthalmic coverage negative-space registry", () => {
  it("reports zero active production imaging targets", () => {
    expect(activeProductionCoverage()).toEqual([]);
    expect(OPHTHALMIC_COVERAGE_REGISTRY.every((entry) => !entry.production_available && !entry.pipeline_enabled)).toBe(true);
  });

  it("keeps all four ClementP targets candidate-only and not calibrated", () => {
    const candidates = coverageForModality("fundus").filter((entry) => entry.model_id === "fundus-lesions-clementp-unet-seresnext50");
    expect(candidates.map((entry) => entry.target_id)).toEqual(["cotton_wool_spot", "hard_exudate", "retinal_hemorrhage", "microaneurysm_like_lesion"]);
    expect(candidates.every((entry) => entry.state === "CANDIDATE_DISABLED" && entry.calibration === "NOT_CALIBRATED")).toBe(true);
  });

  it("explicitly records common unsupported pathologies and non-fundus pixel analysis", () => {
    for (const target of ["diabetic_retinopathy", "age_related_macular_degeneration", "glaucoma", "retinal_detachment_or_tear", "oct_pixel_analysis", "dicom_pixel_analysis"]) {
      expect(OPHTHALMIC_COVERAGE_REGISTRY.some((entry) => entry.target_id === target && entry.state !== "RESEARCH_ANATOMY_ONLY")).toBe(true);
    }
  });

  it("never describes missing coverage as a normal or no-disease result", () => {
    for (const entry of OPHTHALMIC_COVERAGE_REGISTRY) {
      const text = `${entry.result_semantics} ${entry.limitations.join(" ")}`.toLowerCase();
      expect(text).not.toContain("no disease detected");
      expect(text).not.toContain("normal fundus");
    }
  });
});
