/**
 * Strict RAW model output contract.
 *
 * MODEL INPUT -> PREPROCESSING -> INFERENCE -> RAW OUTPUT
 *     -> validateRawModelOutput() -> calibration -> safety validation -> presentation
 *
 * Every field is optional unless actually produced by the model — missing
 * fields are NEVER manufactured. Raw scores are kept strictly separate from
 * calibrated probabilities. The UI never consumes arbitrary model output:
 * only output that has passed this contract may proceed.
 */

export const OUTPUT_CONTRACT_VERSION = "1.0.0";

export interface RawFinding {
  finding_type: string;                    // must exist in the finding taxonomy
  laterality?: "OD" | "OS" | "both" | "unknown";
  location?: string;
  severity?: "none" | "mild" | "moderate" | "severe" | "indeterminate";
  confidence?: number;                     // RAW model score 0..1 (never presented as calibrated)
  calibrated_confidence?: number | null;   // ONLY set when calibration evidence exists
  uncertainty?: number | null;
  localization?: {
    kind: "bounding_box" | "mask" | "marker" | "heatmap";
    coordinates?: { x: number; y: number; w: number; h: number };
    data_ref?: string;
  } | null;
  evidence?: string;
}

export interface RawModelOutput {
  study_id?: string;
  model_id?: string;
  model_version?: string;
  modality?: string;
  laterality?: "OD" | "OS" | "both" | "unknown";
  findings?: RawFinding[];
  conditions?: Array<{ condition_id: string; confidence?: number }>;
  localization?: RawFinding["localization"][];
  segmentation?: Array<{ data_ref: string; anatomy: string }> | null;
  confidence?: number | null;                 // raw aggregate score or null
  calibrated_confidence?: number | null;      // requires calibration evidence
  uncertainty?: number | null;
  ood_status?: "in_distribution" | "out_of_distribution" | "unknown";
  quality_status?: "pass" | "borderline" | "fail" | "unknown";
  inference_status: "completed" | "failed";   // the only mandatory field
  inference_error?: string;
  limitations?: string[];
}

export interface ContractValidationResult {
  valid: boolean;
  errors: Array<{ path: string; message: string }>;
  output: RawModelOutput | null;
}

export function validateRawModelOutput(raw: unknown): ContractValidationResult {
  const errors: ContractValidationResult["errors"] = [];
  const o = raw as RawModelOutput | null;
  const need = (cond: boolean, path: string, message: string) => { if (!cond) errors.push({ path, message }); };

  if (!o || typeof o !== "object") {
    return { valid: false, errors: [{ path: "$", message: "Model output is not an object" }], output: null };
  }
  need(o.inference_status === "completed" || o.inference_status === "failed", "inference_status", "must be 'completed' or 'failed'");

  if (o.inference_status === "failed") {
    // A failed inference carries NO findings — fail closed with just the reason.
    if (Array.isArray(o.findings) && o.findings.length > 0) {
      errors.push({ path: "findings", message: "Failed inference must not carry findings" });
    }
    return {
      valid: errors.length === 0,
      errors,
      output: errors.length === 0 ? { ...o, findings: [], conditions: [] } : null,
    };
  }

  // Bounds checks
  for (const [field, value] of [["confidence", o.confidence], ["calibrated_confidence", o.calibrated_confidence], ["uncertainty", o.uncertainty]] as const) {
    if (value !== undefined && value !== null && (typeof value !== "number" || value < 0 || value > 1)) {
      errors.push({ path: field, message: "must be null or a number in 0..1" });
    }
  }

  if (o.findings) {
    if (!Array.isArray(o.findings)) errors.push({ path: "findings", message: "must be an array" });
    o.findings?.forEach((f, i) => {
      if (typeof f.finding_type !== "string" || f.finding_type.length === 0) {
        errors.push({ path: `findings[${i}].finding_type`, message: "required" });
      }
      if (f.confidence !== undefined && (typeof f.confidence !== "number" || f.confidence < 0 || f.confidence > 1)) {
        errors.push({ path: `findings[${i}].confidence`, message: "must be 0..1" });
      }
      if (f.calibrated_confidence !== undefined && f.calibrated_confidence !== null &&
          (typeof f.calibrated_confidence !== "number" || f.calibrated_confidence < 0 || f.calibrated_confidence > 1)) {
        errors.push({ path: `findings[${i}].calibrated_confidence`, message: "must be null or 0..1" });
      }
      if (f.localization?.kind === "bounding_box" && !f.localization.coordinates && !f.localization.data_ref) {
        errors.push({ path: `findings[${i}].localization`, message: "bounding_box requires coordinates or data_ref" });
      }
      // S13 - defense-in-depth: a bounding_box's coordinates must be real,
      // in-range, image-relative [0,1] values, never NaN/Infinite/negative/
      // overflowing. The real SegFormer script only ever emits valid boxes
      // today, but nothing upstream of this validator enforced that - this
      // closes the gap found by the S13 localization audit.
      const coords = f.localization?.kind === "bounding_box" ? f.localization.coordinates : undefined;
      if (coords) {
        for (const [k, v] of [["x", coords.x], ["y", coords.y], ["w", coords.w], ["h", coords.h]] as const) {
          if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) {
            errors.push({ path: `findings[${i}].localization.coordinates.${k}`, message: "must be a finite number in 0..1" });
          }
        }
        if (Number.isFinite(coords.x) && Number.isFinite(coords.w) && coords.x + coords.w > 1.0001) {
          errors.push({ path: `findings[${i}].localization.coordinates`, message: "x + w exceeds image bounds" });
        }
        if (Number.isFinite(coords.y) && Number.isFinite(coords.h) && coords.y + coords.h > 1.0001) {
          errors.push({ path: `findings[${i}].localization.coordinates`, message: "y + h exceeds image bounds" });
        }
      }
    });
  }

  // Calibration honesty: calibrated values require explicit calibration metadata
  // provided alongside (checked by the caller against the registry/evidence).
  if (o.ood_status && !["in_distribution", "out_of_distribution", "unknown"].includes(o.ood_status)) {
    errors.push({ path: "ood_status", message: "invalid value" });
  }
  if (o.quality_status && !["pass", "borderline", "fail", "unknown"].includes(o.quality_status)) {
    errors.push({ path: "quality_status", message: "invalid value" });
  }
  if (o.conditions && !Array.isArray(o.conditions)) {
    errors.push({ path: "conditions", message: "must be an array" });
  }

  return { valid: errors.length === 0, errors, output: errors.length === 0 ? o : null };
}
