/**
 * Strict transport contract for the four-class ClementP lesion candidate.
 *
 * This is deliberately separate from RawModelOutput: it validates a local
 * segmentation worker's *technical* output before a future reviewed adapter
 * could turn regions into observations. Passing this contract does not grant
 * clinical validity or activate a model.
 */

export const FUNDUS_LESION_MODEL_ID = "fundus-lesions-clementp-unet-seresnext50";
export const FUNDUS_LESION_MODEL_VERSION = "a2cfcb594e483";
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
}

export interface FundusLesionSegmentationOutput {
  model_id: string;
  model_version: string;
  image_id: string;
  raw_output_shape: [number, number, number]; // C,H,W after softmax
  output_order: readonly FundusLesionClass[];
  preprocessing_version: string;
  threshold_version: string;
  validation_status: "CANDIDATE_ONLY" | "RESEARCH";
  image_level_summary: "NO_TARGET_ABNORMALITY_DETECTED" | "SUSPICIOUS_ABNORMALITY" | "MULTIPLE_ABNORMALITIES";
  class_masks: Array<{ class_name: FundusLesionClass; width: number; height: number; mask_ref: string | null; area_pixels: number }>;
  class_scores: Array<{ class_name: FundusLesionClass; score_semantics: "NOT_CALIBRATED"; score: number | null }>;
  lesion_regions: FundusLesionRegion[];
}

export interface FundusLesionContractResult { valid: boolean; errors: Array<{ path: string; message: string }> }

const classes = new Set<string>(FUNDUS_LESION_OUTPUT_ORDER);
const lesionClasses = new Set<string>(FUNDUS_LESION_OUTPUT_ORDER.filter((c) => c !== "background"));

export function validateFundusLesionSegmentationOutput(value: unknown): FundusLesionContractResult {
  const errors: FundusLesionContractResult["errors"] = [];
  const o = value as FundusLesionSegmentationOutput | null;
  const fail = (condition: boolean, path: string, message: string) => { if (!condition) errors.push({ path, message }); };
  if (!o || typeof o !== "object") return { valid: false, errors: [{ path: "$", message: "output must be an object" }] };
  fail(o.model_id === FUNDUS_LESION_MODEL_ID, "model_id", "unexpected lesion model id");
  fail(typeof o.model_version === "string" && o.model_version.length > 0, "model_version", "required");
  fail(typeof o.image_id === "string" && o.image_id.length > 0, "image_id", "required");
  fail(Array.isArray(o.raw_output_shape) && o.raw_output_shape.length === 3 && o.raw_output_shape.every((n) => Number.isInteger(n) && n > 0), "raw_output_shape", "must be [C,H,W] positive integers");
  fail(o.raw_output_shape?.[0] === FUNDUS_LESION_OUTPUT_ORDER.length, "raw_output_shape[0]", "class channel count does not match verified output order");
  fail(Array.isArray(o.output_order) && o.output_order.length === FUNDUS_LESION_OUTPUT_ORDER.length && o.output_order.every((c, i) => c === FUNDUS_LESION_OUTPUT_ORDER[i]), "output_order", "must exactly match the verified class order");
  fail(["CANDIDATE_ONLY", "RESEARCH"].includes(o.validation_status), "validation_status", "invalid status");
  fail(["NO_TARGET_ABNORMALITY_DETECTED", "SUSPICIOUS_ABNORMALITY", "MULTIPLE_ABNORMALITIES"].includes(o.image_level_summary), "image_level_summary", "invalid summary");
  fail(Array.isArray(o.class_masks) && o.class_masks.length === FUNDUS_LESION_OUTPUT_ORDER.length, "class_masks", "must include every model channel exactly once");
  fail(Array.isArray(o.class_scores) && o.class_scores.length === FUNDUS_LESION_OUTPUT_ORDER.length, "class_scores", "must include every model channel exactly once");
  const masks = Array.isArray(o.class_masks) ? o.class_masks : [];
  const scores = Array.isArray(o.class_scores) ? o.class_scores : [];
  const regions = Array.isArray(o.lesion_regions) ? o.lesion_regions : [];
  for (const [i, mask] of masks.entries()) {
    fail(classes.has(mask.class_name), `class_masks[${i}].class_name`, "unknown class");
    fail(Number.isInteger(mask.width) && mask.width > 0 && Number.isInteger(mask.height) && mask.height > 0, `class_masks[${i}]`, "invalid mask dimensions");
    fail(Number.isInteger(mask.area_pixels) && mask.area_pixels >= 0 && mask.area_pixels <= mask.width * mask.height, `class_masks[${i}].area_pixels`, "invalid mask area");
    fail(mask.mask_ref === null || (/^[a-zA-Z0-9._/-]+$/.test(mask.mask_ref) && !mask.mask_ref.includes("..") && !mask.mask_ref.startsWith("/")), `class_masks[${i}].mask_ref`, "must be a safe worker-relative reference or null");
  }
  for (const [i, score] of scores.entries()) {
    fail(classes.has(score.class_name), `class_scores[${i}].class_name`, "unknown class");
    fail(score.score_semantics === "NOT_CALIBRATED", `class_scores[${i}].score_semantics`, "segmentation scores may not claim calibration");
    fail(score.score === null || (typeof score.score === "number" && Number.isFinite(score.score) && score.score >= 0 && score.score <= 1), `class_scores[${i}].score`, "must be null or finite 0..1");
  }
  for (const [i, r] of regions.entries()) {
    const b = r.bounding_box;
    fail(lesionClasses.has(r.class_name), `lesion_regions[${i}].class_name`, "must be a supported non-background class");
    fail(Number.isInteger(r.area_pixels) && r.area_pixels > 0, `lesion_regions[${i}].area_pixels`, "must be a positive integer");
    fail([b?.x, b?.y, b?.w, b?.h].every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1) && (b?.x ?? 0) + (b?.w ?? 0) <= 1 && (b?.y ?? 0) + (b?.h ?? 0) <= 1, `lesion_regions[${i}].bounding_box`, "must be finite normalized in-bounds geometry");
    fail([r.centroid?.x, r.centroid?.y].every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1), `lesion_regions[${i}].centroid`, "must be finite normalized coordinates");
    fail(r.raw_score === null || (typeof r.raw_score === "number" && Number.isFinite(r.raw_score) && r.raw_score >= 0 && r.raw_score <= 1), `lesion_regions[${i}].raw_score`, "must be null or finite 0..1");
  }
  const hasRegions = regions.length > 0;
  if (o.image_level_summary === "NO_TARGET_ABNORMALITY_DETECTED" && hasRegions) errors.push({ path: "image_level_summary", message: "target-negative output cannot include lesion regions" });
  if (o.image_level_summary !== "NO_TARGET_ABNORMALITY_DETECTED" && !hasRegions) errors.push({ path: "image_level_summary", message: "suspicious summary requires real regions" });
  return { valid: errors.length === 0, errors };
}
