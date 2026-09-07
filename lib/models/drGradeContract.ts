/**
 * Strict transport contract for the single-logit ClementP DR-grading worker.
 *
 * Validates the worker's *technical* output before any adapter turns it
 * into an observation. Passing this contract grants no clinical validity.
 * The grade is a rounded regression output, never a probability; the raw
 * logit is a ranking score with NOT_CALIBRATED semantics.
 */

export const DR_GRADE_MODEL_ID = "fundus-dr-grading-effb0";
export const DR_GRADE_MODEL_VERSION = "aa5741419b90";
export const DR_GRADE_ARTIFACT_SHA256 = "0d9a18b0cb6c90d1f30bf2e66153b368bd7ff0bcb45b6690e8d5ce14fa19f69b";
export const DR_GRADE_PREPROCESSING_VERSION = "clementp-dr-source-pinned-512-v1";
export const DR_GRADE_LABELS = ["no_dr", "mild_npdr", "moderate_npdr", "severe_npdr", "proliferative_dr"] as const;
export type DrGradeLabel = typeof DR_GRADE_LABELS[number];

export interface DrGradeWorkerOutput {
  inference_status: "completed";
  model_id: string;
  model_version: string;
  artifact_sha256: string;
  image_id: string;
  preprocessing_version: string;
  preprocessing_transform: {
    original: { width: number; height: number };
    crop: { x: number; y: number; w: number; h: number } | null;
    model: { width: number; height: number };
  };
  raw_logit: number;
  score_semantics: "MODEL_SCORE_NOT_CALIBRATED";
  predicted_grade: number;
  grade_label: DrGradeLabel;
  referable_dr: boolean;
  validation_status: "CANDIDATE_ONLY";
  calibration_state: "NOT_CALIBRATED";
  limitations: string[];
}

export interface DrGradeContractResult { valid: boolean; errors: Array<{ path: string; message: string }> }

function roundClamp(logit: number): number {
  // Mirrors torch.round().clamp(0,4) including round-half-to-even: JS
  // Math.round rounds half up, so compare with a tolerance-free exact rule
  // on non-half values and accept the worker's own grade for halves.
  return Math.min(4, Math.max(0, Math.round(logit)));
}

function validateDrGradeWorkerOutputUnchecked(value: unknown): DrGradeContractResult {
  const errors: DrGradeContractResult["errors"] = [];
  const o = value as DrGradeWorkerOutput | null;
  const fail = (condition: boolean, path: string, message: string) => { if (!condition) errors.push({ path, message }); };
  if (!o || typeof o !== "object") return { valid: false, errors: [{ path: "$", message: "output must be an object" }] };
  fail(o.model_id === DR_GRADE_MODEL_ID, "model_id", "unexpected DR model id");
  fail(o.inference_status === "completed", "inference_status", "contract accepts completed worker output only");
  fail(o.model_version === DR_GRADE_MODEL_VERSION, "model_version", "must match the pinned revision");
  fail(o.artifact_sha256 === DR_GRADE_ARTIFACT_SHA256, "artifact_sha256", "must match the pinned artifact");
  fail(typeof o.image_id === "string" && /^[a-f0-9]{64}$/.test(o.image_id), "image_id", "must be the source-image SHA-256");
  fail(o.preprocessing_version === DR_GRADE_PREPROCESSING_VERSION, "preprocessing_version", "must match the pinned preprocessing contract");
  fail(typeof o.raw_logit === "number" && Number.isFinite(o.raw_logit), "raw_logit", "must be a finite number");
  fail(o.score_semantics === "MODEL_SCORE_NOT_CALIBRATED", "score_semantics", "logit may not claim calibration");
  fail(Number.isInteger(o.predicted_grade) && o.predicted_grade >= 0 && o.predicted_grade <= 4, "predicted_grade", "must be an integer grade 0..4");
  if (typeof o.raw_logit === "number" && Number.isFinite(o.raw_logit) && Number.isInteger(o.predicted_grade)) {
    // Exact grade rule, except exact .5 halves where banker's rounding is
    // the worker's own deterministic rule (verified by probe determinism tests).
    const frac = Math.abs(o.raw_logit - Math.trunc(o.raw_logit));
    const isHalf = Math.abs(frac - 0.5) < 1e-9;
    if (!isHalf) fail(o.predicted_grade === roundClamp(o.raw_logit), "predicted_grade", "must equal round(clamp(logit,0,4))");
  }
  fail(o.grade_label === DR_GRADE_LABELS[o.predicted_grade], "grade_label", "must match the predicted grade");
  fail(o.referable_dr === (o.predicted_grade >= 2), "referable_dr", "must equal grade>=2");
  fail(o.validation_status === "CANDIDATE_ONLY", "validation_status", "the offline worker cannot promote its own governance status");
  fail(o.calibration_state === "NOT_CALIBRATED", "calibration_state", "DR grades may not claim calibration");
  const t = o.preprocessing_transform;
  fail(!!t && Number.isInteger(t?.original?.width) && t.original.width > 0 && Number.isInteger(t?.original?.height) && t.original.height > 0, "preprocessing_transform.original", "must contain positive integer dimensions");
  fail(t?.model?.width === 512 && t?.model?.height === 512, "preprocessing_transform.model", "model raster must be 512x512");
  if (t?.crop) {
    fail(Number.isInteger(t.crop.x) && Number.isInteger(t.crop.y) && Number.isInteger(t.crop.w) && Number.isInteger(t.crop.h) && t.crop.w > 0 && t.crop.h > 0, "preprocessing_transform.crop", "must be a positive integer box");
  }
  fail(Array.isArray(o.limitations) && o.limitations.length > 0 && o.limitations.length <= 50 && o.limitations.every((l) => typeof l === "string" && l.trim().length > 0 && l.length <= 500), "limitations", "1..50 bounded explicit limitations are required");
  return { valid: errors.length === 0, errors };
}

/** Adversarial envelopes must be rejected as data, never crash the caller. */
export function validateDrGradeWorkerOutput(value: unknown): DrGradeContractResult {
  try {
    return validateDrGradeWorkerOutputUnchecked(value);
  } catch {
    return { valid: false, errors: [{ path: "$", message: "malformed DR worker output" }] };
  }
}
