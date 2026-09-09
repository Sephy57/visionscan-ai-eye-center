/**
 * OCT retinal-class assessment layer.
 *
 * Answers a narrow question: which of the model's four classes did a
 * *specific, installed* research model output for this OCT image? It never
 * turns a class estimate into a diagnosis, and a NORMAL estimate never
 * means a healthy macula.
 */
import type { QualityResult } from "../imaging/quality";
import type { RawModelOutput } from "./outputContract";
import type { OctWorkerOutput } from "./octContract";
import { canonicalModality } from "./modalities";

export type OctAssessmentState =
  | "CLASS_ESTIMATED"
  | "IMAGE_NOT_SUITABLE"
  | "OUT_OF_DISTRIBUTION"
  | "MODEL_UNAVAILABLE";

export interface OctAssessmentResult {
  state: OctAssessmentState;
  predicted_class: string | null;
  predicted_index: number | null;
  /** Raw logits: MODEL_SCOREs, never probabilities. */
  model_scores: number[] | null;
  score_semantics: "MODEL_SCORE_NOT_CALIBRATED" | "NO_SCORE_AVAILABLE";
  calibration_state: "NOT_CALIBRATED" | "NOT_APPLICABLE";
  quality_state: string;
  ood_state: "IN_DISTRIBUTION" | "OUT_OF_DISTRIBUTION" | "UNKNOWN";
  limitations: string[];
  validation_state: "RESEARCH" | "NOT_VALIDATED_FOR_IMAGE" | "MODEL_UNAVAILABLE";
  model_id: string | null;
  model_version: string | null;
}

const UNAVAILABLE_LIMITATION =
  "No installed, validated-for-this-image OCT model is available. This is not a normal-OCT result and requires ophthalmic interpretation.";

export function unavailableOctAssessmentResult(
  quality: QualityResult,
  ood: { detected: boolean; reasons: string[] },
  modality: string
): OctAssessmentResult {
  if (quality.quality_status !== "pass") {
    return {
      state: "IMAGE_NOT_SUITABLE", predicted_class: null, predicted_index: null, model_scores: null,
      score_semantics: "NO_SCORE_AVAILABLE",
      calibration_state: "NOT_APPLICABLE", quality_state: quality.quality_status,
      ood_state: "UNKNOWN", validation_state: "NOT_VALIDATED_FOR_IMAGE",
      limitations: ["Image-quality gate prevented OCT classification.", ...quality.limitations],
      model_id: null, model_version: null,
    };
  }
  if (ood.detected || canonicalModality(modality) !== "OCT") {
    return {
      state: "OUT_OF_DISTRIBUTION", predicted_class: null, predicted_index: null, model_scores: null,
      score_semantics: "NO_SCORE_AVAILABLE",
      calibration_state: "NOT_APPLICABLE", quality_state: quality.quality_status,
      ood_state: "OUT_OF_DISTRIBUTION", validation_state: "NOT_VALIDATED_FOR_IMAGE",
      limitations: ["Input is not accepted as an in-distribution OCT image.", ...ood.reasons],
      model_id: null, model_version: null,
    };
  }
  return {
    state: "MODEL_UNAVAILABLE", predicted_class: null, predicted_index: null, model_scores: null,
    score_semantics: "NO_SCORE_AVAILABLE",
    calibration_state: "NOT_APPLICABLE", quality_state: quality.quality_status,
    ood_state: "IN_DISTRIBUTION", validation_state: "MODEL_UNAVAILABLE",
    limitations: [UNAVAILABLE_LIMITATION],
    model_id: null, model_version: null,
  };
}

/**
 * Maps genuine output from the reviewed OCT provider. The caller must only
 * pass a local, hash-verified artifact. A NORMAL estimate is reported as
 * CLASS_ESTIMATED with class NORMAL — never translated into "healthy".
 */
export function resultFromResearchOct(input: {
  oct: OctWorkerOutput | null;
  raw: RawModelOutput;
  quality: QualityResult;
  ood: { detected: boolean; reasons: string[] };
  modelId: string;
  modelVersion: string;
}): OctAssessmentResult {
  const unavailable = unavailableOctAssessmentResult(input.quality, input.ood, "OCT");
  if (unavailable.state !== "MODEL_UNAVAILABLE") return unavailable;
  if (input.raw.inference_status !== "completed" || !input.oct) {
    return { ...unavailable, model_id: input.modelId, model_version: input.modelVersion, limitations: ["Research OCT classifier failed or timed out; no class was estimated.", ...(input.raw.limitations ?? [])] };
  }
  const w = input.oct;
  return {
    state: "CLASS_ESTIMATED",
    predicted_class: w.predicted_class,
    predicted_index: w.predicted_index,
    model_scores: [...w.raw_logits],
    score_semantics: "MODEL_SCORE_NOT_CALIBRATED",
    calibration_state: "NOT_CALIBRATED",
    quality_state: input.quality.quality_status,
    ood_state: "IN_DISTRIBUTION",
    validation_state: "RESEARCH",
    limitations: [
      "Research class estimate only; it does not establish or exclude macular disease and is not a diagnosis.",
      ...(input.raw.limitations ?? []),
    ],
    model_id: input.modelId,
    model_version: input.modelVersion,
  };
}
