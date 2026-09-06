import { describe, expect, it } from "vitest";
import { FUNDUS_LESION_MODEL_ID, FUNDUS_LESION_OUTPUT_ORDER, validateFundusLesionSegmentationOutput } from "@/lib/models/fundusLesionContract";

function output(overrides: Record<string, unknown> = {}) {
  return { model_id: FUNDUS_LESION_MODEL_ID, model_version: "a2", image_id: "study", raw_output_shape: [5, 1024, 1024], output_order: [...FUNDUS_LESION_OUTPUT_ORDER], preprocessing_version: "source-pinned", threshold_version: "not-selected", validation_status: "CANDIDATE_ONLY", image_level_summary: "SUSPICIOUS_ABNORMALITY", class_masks: FUNDUS_LESION_OUTPUT_ORDER.map((class_name) => ({ class_name, width: 1024, height: 1024, mask_ref: null, area_pixels: class_name === "background" ? 100 : 10 })), class_scores: FUNDUS_LESION_OUTPUT_ORDER.map((class_name) => ({ class_name, score_semantics: "NOT_CALIBRATED", score: null })), lesion_regions: [{ class_name: "retinal_hemorrhage", area_pixels: 10, centroid: { x: .2, y: .2 }, bounding_box: { x: .1, y: .1, w: .2, h: .2 }, mask_ref: null, raw_score: null }], ...overrides };
}

describe("fundus lesion segmentation contract", () => {
  it("accepts a bounded, non-calibrated, provenance-bearing lesion region", () => expect(validateFundusLesionSegmentationOutput(output()).valid).toBe(true));
  it("rejects a swapped class order", () => expect(validateFundusLesionSegmentationOutput(output({ output_order: ["background", "hard_exudate", "cotton_wool_spot", "retinal_hemorrhage", "microaneurysm_like_lesion"] })).valid).toBe(false));
  it("rejects NaN/Infinity and impossible boxes", () => {
    expect(validateFundusLesionSegmentationOutput(output({ lesion_regions: [{ class_name: "retinal_hemorrhage", area_pixels: 1, centroid: { x: NaN, y: .2 }, bounding_box: { x: .9, y: .2, w: .2, h: .2 }, mask_ref: null, raw_score: Infinity }] })).valid).toBe(false);
  });
  it("rejects a false target-negative summary", () => expect(validateFundusLesionSegmentationOutput(output({ image_level_summary: "NO_TARGET_ABNORMALITY_DETECTED" })).valid).toBe(false));
  it("rejects traversal-like mask references", () => expect(validateFundusLesionSegmentationOutput(output({ class_masks: FUNDUS_LESION_OUTPUT_ORDER.map((class_name) => ({ class_name, width: 1, height: 1, area_pixels: 0, mask_ref: "../bad" })) })).valid).toBe(false));
});
