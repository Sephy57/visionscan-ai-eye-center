/**
 * Strict transport contract for the ONNX OCT retinal-classifier worker.
 *
 * Four logits (CNV/DME/DRUSEN/NORMAL), argmax only. Logits are ranking
 * scores, never probabilities. Passing this contract grants no validity.
 */

export const OCT_MODEL_ID = "oct-retinal-weights-fp32";
export const OCT_MODEL_VERSION = "hf-main-2026";
export const OCT_ARTIFACT_SHA256 = "22b1fffb5a0ab88284d4c5817c581bedb1b54c09011d87c3f6472cb2c36b2b1f";
export const OCT_PREPROCESSING_VERSION = "oct-edge-source-pinned-224-v1";
export const OCT_CLASSES = ["CNV", "DME", "DRUSEN", "NORMAL"] as const;
export type OctRetinalClass = typeof OCT_CLASSES[number];

export interface OctWorkerOutput {
  inference_status: "completed";
  model_id: string;
  model_version: string;
  artifact_sha256: string;
  image_id: string;
  preprocessing_version: string;
  raw_logits: [number, number, number, number];
  score_semantics: "MODEL_SCORE_NOT_CALIBRATED";
  predicted_class: OctRetinalClass;
  predicted_index: number;
  reported_temperature: number | null;
  temperature_applied: false;
  validation_status: "CANDIDATE_ONLY";
  calibration_state: "NOT_CALIBRATED";
  limitations: string[];
}

export interface OctContractResult { valid: boolean; errors: Array<{ path: string; message: string }> }

function validateOctWorkerOutputUnchecked(value: unknown): OctContractResult {
  const errors: OctContractResult["errors"] = [];
  const o = value as OctWorkerOutput | null;
  const fail = (condition: boolean, path: string, message: string) => { if (!condition) errors.push({ path, message }); };
  if (!o || typeof o !== "object") return { valid: false, errors: [{ path: "$", message: "output must be an object" }] };
  fail(o.model_id === OCT_MODEL_ID, "model_id", "unexpected OCT model id");
  fail(o.inference_status === "completed", "inference_status", "contract accepts completed worker output only");
  fail(o.model_version === OCT_MODEL_VERSION, "model_version", "must match the pinned revision");
  fail(o.artifact_sha256 === OCT_ARTIFACT_SHA256, "artifact_sha256", "must match the pinned artifact");
  fail(typeof o.image_id === "string" && /^[a-f0-9]{64}$/.test(o.image_id), "image_id", "must be the source-image SHA-256");
  fail(o.preprocessing_version === OCT_PREPROCESSING_VERSION, "preprocessing_version", "must match the pinned preprocessing contract");
  fail(
    Array.isArray(o.raw_logits) && o.raw_logits.length === 4 &&
    o.raw_logits.every((v) => typeof v === "number" && Number.isFinite(v)),
    "raw_logits", "must be 4 finite numbers"
  );
  fail(o.score_semantics === "MODEL_SCORE_NOT_CALIBRATED", "score_semantics", "logits may not claim calibration");
  fail(Number.isInteger(o.predicted_index) && o.predicted_index >= 0 && o.predicted_index <= 3, "predicted_index", "must be 0..3");
  if (Array.isArray(o.raw_logits) && o.raw_logits.length === 4 && Number.isInteger(o.predicted_index)) {
    let argmax = 0;
    for (let i = 1; i < 4; i++) if ((o.raw_logits[i] as number) > (o.raw_logits[argmax] as number)) argmax = i;
    fail(o.predicted_index === argmax, "predicted_index", "must equal argmax of raw logits");
  }
  fail(o.predicted_class === OCT_CLASSES[o.predicted_index], "predicted_class", "must match the predicted index");
  fail(o.reported_temperature === null || (typeof o.reported_temperature === "number" && Number.isFinite(o.reported_temperature) && o.reported_temperature > 0), "reported_temperature", "must be null or a positive finite number");
  fail(o.temperature_applied === false, "temperature_applied", "temperature must not be silently applied");
  fail(o.validation_status === "CANDIDATE_ONLY", "validation_status", "the offline worker cannot promote its own governance status");
  fail(o.calibration_state === "NOT_CALIBRATED", "calibration_state", "OCT classes may not claim calibration");
  fail(Array.isArray(o.limitations) && o.limitations.length > 0 && o.limitations.length <= 50 && o.limitations.every((l) => typeof l === "string" && l.trim().length > 0 && l.length <= 500), "limitations", "1..50 bounded explicit limitations are required");
  return { valid: errors.length === 0, errors };
}

/** Adversarial envelopes must be rejected as data, never crash the caller. */
export function validateOctWorkerOutput(value: unknown): OctContractResult {
  try {
    return validateOctWorkerOutputUnchecked(value);
  } catch {
    return { valid: false, errors: [{ path: "$", message: "malformed OCT worker output" }] };
  }
}
