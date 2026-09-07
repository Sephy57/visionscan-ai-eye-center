/**
 * Strict transport contract for the four-class ClementP lesion candidate.
 *
 * This is deliberately separate from RawModelOutput: it validates a local
 * segmentation worker's *technical* output before a future reviewed adapter
 * could turn regions into observations. Passing this contract does not grant
 * clinical validity or activate a model.
 */

import type { CropLetterboxTransform } from "../imaging/localizationTransform";
import { validateCropLetterboxTransform } from "../imaging/localizationTransform";

export const FUNDUS_LESION_MODEL_ID = "fundus-lesions-clementp-unet-seresnext50";
export const FUNDUS_LESION_MODEL_VERSION = "a2cfcb594e483";
export const FUNDUS_LESION_ARTIFACT_SHA256 = "a7a7cb45b92328f7c9a8e581eec3944fd435d37fae8cbf340b1319c5f987c6d2";
export const FUNDUS_LESION_PREPROCESSING_VERSION = "clementp-source-pinned-1024-v1";
export const FUNDUS_LESION_THRESHOLD_VERSION = "argmax-components-no-threshold-no-calibration";
export const FUNDUS_LESION_OUTPUT_ORDER = ["background", "cotton_wool_spot", "hard_exudate", "retinal_hemorrhage", "microaneurysm_like_lesion"] as const;
export type FundusLesionClass = typeof FUNDUS_LESION_OUTPUT_ORDER[number];

export interface FundusLesionRegion {
  class_name: Exclude<FundusLesionClass, "background">;
  area_pixels: number;
  centroid: { x: number; y: number };
  bounding_box: { x: number; y: number; w: number; h: number };
  /** A local worker-owned relative mask reference; never a URL or user path. */
  mask_ref: string | null;
  raw_score: number | null;
  region_semantics: "UNFILTERED_ARGMAX_COMPONENT_NOT_VALIDATED_AS_LESION";
}

export interface FundusLesionSegmentationOutput {
  inference_status: "completed";
  model_id: string;
  model_version: string;
  artifact_sha256: string;
  image_id: string;
  coordinate_space: "ORIGINAL_IMAGE_NORMALIZED";
  original_image_size: { width: number; height: number };
  preprocessing_transform: CropLetterboxTransform;
  raw_output_shape: [number, number, number]; // C,H,W after softmax
  output_order: readonly FundusLesionClass[];
  preprocessing_version: string;
  threshold_version: string;
  validation_status: "CANDIDATE_ONLY";
  image_level_summary: "NO_TARGET_ABNORMALITY_DETECTED" | "SUSPICIOUS_ABNORMALITY" | "MULTIPLE_ABNORMALITIES";
  class_masks: Array<{ class_name: FundusLesionClass; width: number; height: number; mask_ref: string | null; area_pixels: number }>;
  class_scores: Array<{ class_name: FundusLesionClass; score_semantics: "NOT_CALIBRATED"; score: number | null }>;
  lesion_regions: FundusLesionRegion[];
  limitations: string[];
}

export interface FundusLesionContractResult { valid: boolean; errors: Array<{ path: string; message: string }> }

const lesionClasses = new Set<string>(FUNDUS_LESION_OUTPUT_ORDER.filter((c) => c !== "background"));

function validateFundusLesionSegmentationOutputUnchecked(value: unknown): FundusLesionContractResult {
  const errors: FundusLesionContractResult["errors"] = [];
  const o = value as FundusLesionSegmentationOutput | null;
  const fail = (condition: boolean, path: string, message: string) => { if (!condition) errors.push({ path, message }); };
  if (!o || typeof o !== "object") return { valid: false, errors: [{ path: "$", message: "output must be an object" }] };
  fail(o.model_id === FUNDUS_LESION_MODEL_ID, "model_id", "unexpected lesion model id");
  fail(o.inference_status === "completed", "inference_status", "contract accepts completed worker output only");
  fail(o.model_version === FUNDUS_LESION_MODEL_VERSION, "model_version", "must match the pinned candidate revision");
  fail(o.artifact_sha256 === FUNDUS_LESION_ARTIFACT_SHA256, "artifact_sha256", "must match the pinned candidate artifact");
  fail(typeof o.image_id === "string" && /^[a-f0-9]{64}$/.test(o.image_id), "image_id", "must be the source-image SHA-256");
  fail(o.coordinate_space === "ORIGINAL_IMAGE_NORMALIZED", "coordinate_space", "regions must map to the original image");
  fail(Number.isInteger(o.original_image_size?.width) && o.original_image_size.width > 0 && Number.isInteger(o.original_image_size?.height) && o.original_image_size.height > 0, "original_image_size", "must contain positive integer dimensions");
  fail(!!o.preprocessing_transform && validateCropLetterboxTransform(o.preprocessing_transform).length === 0, "preprocessing_transform", "must be a consistent crop/letterbox transform");
  if (o.preprocessing_transform && o.original_image_size) {
    fail(o.preprocessing_transform.original.width === o.original_image_size.width && o.preprocessing_transform.original.height === o.original_image_size.height, "preprocessing_transform.original", "must match original_image_size");
    fail(o.preprocessing_transform.model.width === o.raw_output_shape?.[2] && o.preprocessing_transform.model.height === o.raw_output_shape?.[1], "preprocessing_transform.model", "must match raw output H/W");
  }
  fail(Array.isArray(o.raw_output_shape) && o.raw_output_shape.length === 3 && o.raw_output_shape.every((n) => Number.isInteger(n) && n > 0), "raw_output_shape", "must be [C,H,W] positive integers");
  fail(o.raw_output_shape?.[1] === 1024 && o.raw_output_shape?.[2] === 1024, "raw_output_shape", "candidate output must be exactly 5x1024x1024");
  fail(o.raw_output_shape?.[0] === FUNDUS_LESION_OUTPUT_ORDER.length, "raw_output_shape[0]", "class channel count does not match verified output order");
  fail(Array.isArray(o.output_order) && o.output_order.length === FUNDUS_LESION_OUTPUT_ORDER.length && o.output_order.every((c, i) => c === FUNDUS_LESION_OUTPUT_ORDER[i]), "output_order", "must exactly match the verified class order");
  fail(o.validation_status === "CANDIDATE_ONLY", "validation_status", "the offline worker cannot promote its own governance status");
  fail(o.preprocessing_version === FUNDUS_LESION_PREPROCESSING_VERSION, "preprocessing_version", "must match the pinned preprocessing contract");
  fail(o.threshold_version === FUNDUS_LESION_THRESHOLD_VERSION, "threshold_version", "must disclose the exact uncalibrated component rule");
  fail(["NO_TARGET_ABNORMALITY_DETECTED", "SUSPICIOUS_ABNORMALITY", "MULTIPLE_ABNORMALITIES"].includes(o.image_level_summary), "image_level_summary", "invalid summary");
  fail(Array.isArray(o.class_masks) && o.class_masks.length === FUNDUS_LESION_OUTPUT_ORDER.length, "class_masks", "must include every model channel exactly once");
  fail(Array.isArray(o.class_scores) && o.class_scores.length === FUNDUS_LESION_OUTPUT_ORDER.length, "class_scores", "must include every model channel exactly once");
  fail(Array.isArray(o.lesion_regions), "lesion_regions", "must be an array");
  const masks = Array.isArray(o.class_masks) ? o.class_masks : [];
  const scores = Array.isArray(o.class_scores) ? o.class_scores : [];
  const regions = Array.isArray(o.lesion_regions) ? o.lesion_regions : [];
  fail(regions.length <= 10_000, "lesion_regions", "exceeds bounded component count");
  for (const [i, mask] of masks.entries()) {
    fail(mask.class_name === FUNDUS_LESION_OUTPUT_ORDER[i], `class_masks[${i}].class_name`, "must match verified channel order exactly once");
    fail(mask.width === o.raw_output_shape?.[2] && mask.height === o.raw_output_shape?.[1], `class_masks[${i}]`, "mask dimensions must match raw output H/W");
    fail(Number.isInteger(mask.area_pixels) && mask.area_pixels >= 0 && mask.area_pixels <= mask.width * mask.height, `class_masks[${i}].area_pixels`, "invalid mask area");
    fail(mask.mask_ref === null || (/^[a-zA-Z0-9._/-]+$/.test(mask.mask_ref) && !mask.mask_ref.includes("..") && !mask.mask_ref.startsWith("/")), `class_masks[${i}].mask_ref`, "must be a safe worker-relative reference or null");
  }
  for (const [i, score] of scores.entries()) {
    fail(score.class_name === FUNDUS_LESION_OUTPUT_ORDER[i], `class_scores[${i}].class_name`, "must match verified channel order exactly once");
    fail(score.score_semantics === "NOT_CALIBRATED", `class_scores[${i}].score_semantics`, "segmentation scores may not claim calibration");
    fail(score.score === null || (typeof score.score === "number" && Number.isFinite(score.score) && score.score >= 0 && score.score <= 1), `class_scores[${i}].score`, "must be null or finite 0..1");
  }
  for (const [i, r] of regions.entries()) {
    const b = r.bounding_box;
    fail(lesionClasses.has(r.class_name), `lesion_regions[${i}].class_name`, "must be a supported non-background class");
    fail(Number.isInteger(r.area_pixels) && r.area_pixels > 0, `lesion_regions[${i}].area_pixels`, "must be a positive integer");
    fail([b?.x, b?.y, b?.w, b?.h].every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1) && (b?.w ?? 0) > 0 && (b?.h ?? 0) > 0 && (b?.x ?? 0) + (b?.w ?? 0) <= 1 && (b?.y ?? 0) + (b?.h ?? 0) <= 1, `lesion_regions[${i}].bounding_box`, "must be finite, non-empty original-normalized geometry");
    fail([r.centroid?.x, r.centroid?.y].every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1), `lesion_regions[${i}].centroid`, "must be finite normalized coordinates");
    fail(r.raw_score === null, `lesion_regions[${i}].raw_score`, "must remain null because no calibrated or approved component score exists");
    fail(r.region_semantics === "UNFILTERED_ARGMAX_COMPONENT_NOT_VALIDATED_AS_LESION", `lesion_regions[${i}].region_semantics`, "must disclose unvalidated component semantics");
    fail(r.mask_ref === null || (/^[a-zA-Z0-9._/-]+$/.test(r.mask_ref) && !r.mask_ref.includes("..") && !r.mask_ref.startsWith("/")), `lesion_regions[${i}].mask_ref`, "must be a safe worker-relative reference or null");
  }
  if (masks.length === FUNDUS_LESION_OUTPUT_ORDER.length && o.raw_output_shape?.length === 3) {
    const totalArea = masks.reduce((sum, mask) => sum + (Number.isInteger(mask.area_pixels) ? mask.area_pixels : 0), 0);
    fail(totalArea === o.raw_output_shape[1] * o.raw_output_shape[2], "class_masks", "argmax class-mask areas must cover the model raster exactly once");
  }
  for (const className of lesionClasses) {
    const componentArea = regions.filter((region) => region.class_name === className).reduce((sum, region) => sum + (Number.isInteger(region.area_pixels) ? region.area_pixels : 0), 0);
    const maskArea = masks.find((mask) => mask.class_name === className)?.area_pixels;
    if (typeof maskArea === "number") fail(componentArea === maskArea, "lesion_regions", `component areas for ${className} must equal its class mask area`);
  }
  const hasRegions = regions.length > 0;
  if (o.image_level_summary === "NO_TARGET_ABNORMALITY_DETECTED" && hasRegions) errors.push({ path: "image_level_summary", message: "target-negative output cannot include lesion regions" });
  if (o.image_level_summary !== "NO_TARGET_ABNORMALITY_DETECTED" && !hasRegions) errors.push({ path: "image_level_summary", message: "suspicious summary requires real regions" });
  if (o.image_level_summary === "SUSPICIOUS_ABNORMALITY" && regions.length !== 1) errors.push({ path: "image_level_summary", message: "single-suspicion summary requires exactly one component" });
  if (o.image_level_summary === "MULTIPLE_ABNORMALITIES" && regions.length < 2) errors.push({ path: "image_level_summary", message: "multiple-abnormalities summary requires at least two components" });
  fail(Array.isArray(o.limitations) && o.limitations.length > 0 && o.limitations.length <= 50 && o.limitations.every((l) => typeof l === "string" && l.trim().length > 0 && l.length <= 500), "limitations", "1..50 bounded explicit limitations are required");
  return { valid: errors.length === 0, errors };
}

/** Adversarial envelopes must be rejected as data, never crash the caller. */
export function validateFundusLesionSegmentationOutput(value: unknown): FundusLesionContractResult {
  try {
    return validateFundusLesionSegmentationOutputUnchecked(value);
  } catch {
    return { valid: false, errors: [{ path: "$", message: "malformed candidate output" }] };
  }
}
