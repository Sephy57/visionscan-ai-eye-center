/**
 * S6-E — image suitability gate: a single, named, fail-closed pre-inference
 * state derived from the EXISTING quality gate (lib/imaging/quality.ts) and
 * OOD assessment (lib/analysis/ood.ts). This module adds NO new detection
 * logic of its own - it only classifies signals those two modules already
 * compute into one of the seven states the S6 authorization requires, so a
 * provider can make one fail-closed decision instead of re-deriving it from
 * two separate result shapes.
 *
 * IMAGE -> FORMAT VALIDATION (existing upload validation) -> QUALITY GATE
 *   (lib/imaging/quality.ts) -> OOD/COMPATIBILITY (lib/analysis/ood.ts)
 *   -> classifyImageSuitability() (this file) -> only SUITABLE may proceed
 *   to a real provider's analyzeStudy().
 *
 * This function is pure and is NOT wired into lib/analysis/pipeline.ts -
 * the DEMO provider does not need it (it never inspects distribution), and
 * wiring it in would change existing, already-tested pipeline behavior for
 * no benefit while no real provider exists to consume it.
 *
 * S13: wired into lib/evidence/researchAnalysis.ts (the SegFormer research
 * path), which is the real provider this module was built for. That
 * provider's model is deliberately NOT registered in the model registry
 * (clinical isolation, see docs/S9_REAL_MODEL_INTEGRATION.md), so `.model`
 * accepts any minimal `{ modalities }` descriptor rather than requiring a
 * full registry `ModelRecord` - only `.modalities` is ever read from it.
 */

import type { QualityResult } from "../imaging/quality";
import type { OodResult } from "./ood";
import { Modality, canonicalModality, checkModalitySupported } from "../models/modalities";

export type ImageSuitabilityState =
  | "SUITABLE"
  | "LOW_QUALITY"
  | "INSUFFICIENT_FOV"
  | "UNSUPPORTED_MODALITY"
  | "OUT_OF_DISTRIBUTION"
  | "DEVICE_UNSUPPORTED"
  | "INFERENCE_UNAVAILABLE";

export interface ImageSuitabilityResult {
  state: ImageSuitabilityState;
  suitable_for_inference: boolean;
  reasons: string[];
}

export interface ImageSuitabilityInput {
  modality: string;
  quality: QualityResult;
  ood: OodResult;
  /** null = no provider/model available at all -> INFERENCE_UNAVAILABLE, checked first. */
  model: { modalities: Modality[] } | null;
  device: { manufacturer?: string; model?: string } | null;
}

/**
 * Deterministic precedence (first match wins), most fundamental blocker
 * first: no model to run at all, then modality mismatch, then field-of-view,
 * then quality, then device, then general OOD, else SUITABLE. A state other
 * than SUITABLE MUST prevent a provider's analyzeStudy() from producing a
 * clinical finding (fail closed).
 */
export function classifyImageSuitability(input: ImageSuitabilityInput): ImageSuitabilityResult {
  if (!input.model) {
    return { state: "INFERENCE_UNAVAILABLE", suitable_for_inference: false, reasons: ["No model is registered/available to analyze this input."] };
  }

  const modCheck = checkModalitySupported(input.model, input.modality);
  if (!modCheck.ok) {
    return { state: "UNSUPPORTED_MODALITY", suitable_for_inference: false, reasons: [modCheck.reason ?? `Modality ${canonicalModality(input.modality)} is not supported by this model.`] };
  }

  if (input.quality.detected_artifacts.includes("incorrect_field_of_view")) {
    return { state: "INSUFFICIENT_FOV", suitable_for_inference: false, reasons: ["Field of view is inadequate for reliable analysis."] };
  }

  if (input.quality.quality_status === "fail") {
    return { state: "LOW_QUALITY", suitable_for_inference: false, reasons: [`Quality gate failed (score ${input.quality.quality_score.toFixed(2)}): ${input.quality.detected_artifacts.join(", ") || "below threshold"}.`] };
  }

  const deviceReason = input.ood.reasons.find((r) => r.toLowerCase().includes("device"));
  if (deviceReason) {
    return { state: "DEVICE_UNSUPPORTED", suitable_for_inference: false, reasons: [deviceReason] };
  }

  if (input.ood.detected) {
    return { state: "OUT_OF_DISTRIBUTION", suitable_for_inference: false, reasons: input.ood.reasons };
  }

  return { state: "SUITABLE", suitable_for_inference: true, reasons: [] };
}
