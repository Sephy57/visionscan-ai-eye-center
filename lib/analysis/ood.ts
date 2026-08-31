/**
 * Out-of-distribution / unsupported-input layer.
 *
 * Detects situations where the input falls outside the declared operating
 * conditions of the models. If detected:
 *  - DO NOT claim normality
 *  - output must carry: "Input is outside the validated operating conditions of this model."
 */

import { QualityResult } from "../imaging/quality";
import { ModelRecord, deviceCompatible } from "../models/registry";
import { canonicalModality } from "../models/modalities";

export interface OodResult {
  detected: boolean;
  reasons: string[];
  message: string;
}

export const OOD_MESSAGE =
  "Input is outside the validated operating conditions of this model.";

export function assessOod(params: {
  modality: string;
  quality: QualityResult;
  model: ModelRecord | null;
  device: { manufacturer?: string; model?: string } | null;
  metadataProvided: boolean;
}): OodResult {
  const reasons: string[] = [];

  const canonical = canonicalModality(params.modality);
  if (params.modality.toLowerCase() === "unknown") {
    reasons.push("Modality was not provided; acquisition characteristics are unverified.");
  }
  if (params.model && !params.model.modalities.includes(canonical)) {
    reasons.push(`Modality ${canonical} is not supported by the current model.`);
  }
  if (!params.metadataProvided) {
    reasons.push("Acquisition metadata (device/protocol) is missing; distribution cannot be verified.");
  }
  if (params.model) {
    const dev = deviceCompatible(params.model, params.device);
    if (!dev.compatible) reasons.push(dev.note);
  }

  // Image-characteristics heuristics (coarse, honest, unvalidated):
  const m = params.quality.metrics;
  if (m.grayscale_only && canonical !== "FAF" && canonical !== "OCT") {
    reasons.push("Image has unusual color characteristics for this modality.");
  }
  if (m.illumination_mean < 15 || m.illumination_mean > 250) {
    reasons.push("Extreme illumination values; image may not resemble the intended imaging distribution.");
  }
  if (m.width < 256 || m.height < 256) {
    reasons.push("Unusually low resolution for ophthalmic imaging.");
  }
  if (params.quality.detected_artifacts.includes("incorrect_field_of_view")) {
    reasons.push("Field of view appears atypical for ophthalmic imaging.");
  }
  if (params.quality.detected_artifacts.filter((a) => a !== "possible_compression_artifacts").length >= 3) {
    reasons.push("Multiple severe acquisition artifacts detected.");
  }

  return {
    detected: reasons.length > 0,
    reasons,
    message: OOD_MESSAGE,
  };
}
