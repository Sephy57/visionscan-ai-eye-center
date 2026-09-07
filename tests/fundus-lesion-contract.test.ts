import { describe, expect, it } from "vitest";
import { FUNDUS_LESION_ARTIFACT_SHA256, FUNDUS_LESION_MODEL_ID, FUNDUS_LESION_MODEL_VERSION, FUNDUS_LESION_OUTPUT_ORDER, FUNDUS_LESION_PREPROCESSING_VERSION, FUNDUS_LESION_THRESHOLD_VERSION, validateFundusLesionSegmentationOutput } from "@/lib/models/fundusLesionContract";

function output(overrides: Record<string, unknown> = {}) {
  return {
    inference_status: "completed", model_id: FUNDUS_LESION_MODEL_ID, model_version: FUNDUS_LESION_MODEL_VERSION, artifact_sha256: FUNDUS_LESION_ARTIFACT_SHA256, image_id: "a".repeat(64),
    coordinate_space: "ORIGINAL_IMAGE_NORMALIZED", original_image_size: { width: 1024, height: 1024 },
    preprocessing_transform: { coordinate_space: "MODEL_PIXELS_TO_ORIGINAL_IMAGE", original: { width: 1024, height: 1024 }, crop: { x: 0, y: 0, w: 1024, h: 1024 }, model: { width: 1024, height: 1024 }, resized: { width: 1024, height: 1024 }, padding: { left: 0, top: 0, right: 0, bottom: 0 } },
    raw_output_shape: [5, 1024, 1024], output_order: [...FUNDUS_LESION_OUTPUT_ORDER], preprocessing_version: FUNDUS_LESION_PREPROCESSING_VERSION, threshold_version: FUNDUS_LESION_THRESHOLD_VERSION, validation_status: "CANDIDATE_ONLY", image_level_summary: "SUSPICIOUS_ABNORMALITY",
    class_masks: FUNDUS_LESION_OUTPUT_ORDER.map((class_name) => ({ class_name, width: 1024, height: 1024, mask_ref: null, area_pixels: class_name === "background" ? 1024 * 1024 - 10 : class_name === "retinal_hemorrhage" ? 10 : 0 })),
    class_scores: FUNDUS_LESION_OUTPUT_ORDER.map((class_name) => ({ class_name, score_semantics: "NOT_CALIBRATED", score: null })),
    lesion_regions: [{ class_name: "retinal_hemorrhage", area_pixels: 10, centroid: { x: .2, y: .2 }, bounding_box: { x: .1, y: .1, w: .2, h: .2 }, mask_ref: null, raw_score: null, region_semantics: "UNFILTERED_ARGMAX_COMPONENT_NOT_VALIDATED_AS_LESION" }],
    limitations: ["Candidate only"], ...overrides,
  };
}

describe("fundus lesion segmentation contract", () => {
  it("accepts a bounded, non-calibrated, provenance-bearing lesion region", () => expect(validateFundusLesionSegmentationOutput(output()).valid).toBe(true));
  it("rejects a swapped class order", () => expect(validateFundusLesionSegmentationOutput(output({ output_order: ["background", "hard_exudate", "cotton_wool_spot", "retinal_hemorrhage", "microaneurysm_like_lesion"] })).valid).toBe(false));
  it("rejects NaN/Infinity and impossible boxes", () => {
    expect(validateFundusLesionSegmentationOutput(output({ lesion_regions: [{ class_name: "retinal_hemorrhage", area_pixels: 1, centroid: { x: NaN, y: .2 }, bounding_box: { x: .9, y: .2, w: .2, h: .2 }, mask_ref: null, raw_score: Infinity }] })).valid).toBe(false);
  });
  it("rejects a false target-negative summary", () => expect(validateFundusLesionSegmentationOutput(output({ image_level_summary: "NO_TARGET_ABNORMALITY_DETECTED" })).valid).toBe(false));
  it("rejects traversal-like mask references", () => expect(validateFundusLesionSegmentationOutput(output({ class_masks: FUNDUS_LESION_OUTPUT_ORDER.map((class_name) => ({ class_name, width: 1, height: 1, area_pixels: 0, mask_ref: "../bad" })) })).valid).toBe(false));
  it("rejects a worker attempt to promote itself to research status", () => expect(validateFundusLesionSegmentationOutput(output({ validation_status: "RESEARCH" })).valid).toBe(false));
  it("rejects duplicate/reordered channel records", () => {
    const duplicateMasks = FUNDUS_LESION_OUTPUT_ORDER.map((class_name) => ({ class_name, width: 1024, height: 1024, mask_ref: null, area_pixels: 0 }));
    duplicateMasks[1] = { ...duplicateMasks[1], class_name: "background" };
    expect(validateFundusLesionSegmentationOutput(output({ class_masks: duplicateMasks })).valid).toBe(false);
  });
  it("rejects model-space geometry presented without an original-image transform", () => {
    expect(validateFundusLesionSegmentationOutput(output({ coordinate_space: "MODEL_INPUT_NORMALIZED" })).valid).toBe(false);
    const base = output() as { preprocessing_transform: Record<string, unknown> };
    expect(validateFundusLesionSegmentationOutput({ ...base, preprocessing_transform: { ...base.preprocessing_transform, padding: { left: 0, top: 1, right: 0, bottom: 0 } } }).valid).toBe(false);
    expect(validateFundusLesionSegmentationOutput({ ...base, preprocessing_transform: { ...base.preprocessing_transform, model: { width: 2048, height: 1024 }, resized: { width: 2048, height: 1024 } } }).valid).toBe(false);
  });
  it("rejects component areas that do not reconcile to the class mask", () => {
    const base = output() as { lesion_regions: Array<Record<string, unknown>> };
    expect(validateFundusLesionSegmentationOutput({ ...base, lesion_regions: [{ ...base.lesion_regions[0], area_pixels: 9 }] }).valid).toBe(false);
  });
  it("rejects hostile nested shapes without throwing", () => {
    const malformed = { ...output(), preprocessing_transform: {}, class_masks: [null], class_scores: [null], lesion_regions: [null] };
    expect(() => validateFundusLesionSegmentationOutput(malformed)).not.toThrow();
    expect(validateFundusLesionSegmentationOutput(malformed).valid).toBe(false);
  });
  it("pins the completed envelope, artifact, 1024 output, preprocessing, threshold, and null score semantics", () => {
    for (const changed of [
      { inference_status: "failed" }, { artifact_sha256: "b".repeat(64) }, { image_id: "study" },
      { raw_output_shape: [5, 512, 512] }, { preprocessing_version: "other" }, { threshold_version: "other" },
      { lesion_regions: "not-an-array" },
    ]) expect(validateFundusLesionSegmentationOutput(output(changed)).valid).toBe(false);
    const base = output() as { lesion_regions: Array<Record<string, unknown>> };
    expect(validateFundusLesionSegmentationOutput({ ...base, lesion_regions: [{ ...base.lesion_regions[0], raw_score: 0.5 }] }).valid).toBe(false);
  });
});
