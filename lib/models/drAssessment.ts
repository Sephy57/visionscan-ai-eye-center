/**
 * DR grade assessment layer.
 *
 * Answers a narrow question: what ICDR grade did a *specific, installed*
 * research model estimate for this image? It never turns a grade estimate
 * into a diagnosis, a referral decision, or a normal-fundus claim — not
 * even for grade 0, which only means this uncalibrated model output its
 * lowest grade.
 */
import type { QualityResult } from "../imaging/quality";
import type { RawModelOutput } from "./outputContract";
import type { DrGradeWorkerOutput } from "./drGradeContract";

export type DrAssessmentState =
  | "GRADE_ESTIMATED"
  | "IMAGE_NOT_SUITABLE"
  | "OUT_OF_DISTRIBUTION"
  | "MODEL_UNAVAILABLE";

export interface DrAssessmentResult {
  state: DrAssessmentState;
  grade: number | null;
  grade_label: string | null;
  /** Raw regression logit: a MODEL_SCORE, never a probability. */
  model_score: number | null;
  score_semantics: "MODEL_SCORE_NOT_CALIBRATED" | "NO_SCORE_AVAILABLE";
  referable_dr: boolean | null;
  calibration_state: "NOT_CALIBRATED" | "NOT_APPLICABLE";
  quality_state: string;
  ood_state: "IN_DISTRIBUTION" | "OUT_OF_DISTRIBUTION" | "UNKNOWN";
  limitations: string[];
  validation_state: "RESEARCH" | "NOT_VALIDATED_FOR_IMAGE" | "MODEL_UNAVAILABLE";
  model_id: string | null;
  model_version: string | null;
}

const UNAVAILABLE_LIMITATION =
  "No installed, validated-for-this-image DR grading model is available. This is not a no-DR result and requires ophthalmic interpretation.";

export function unavailableDrAssessmentResult(
  quality: QualityResult,
  ood: { detected: boolean; reasons: string[] },
  modality: string
): DrAssessmentResult {
  if (quality.quality_status !== "pass") {
    return {
      state: "IMAGE_NOT_SUITABLE", grade: null, grade_label: null, model_score: null,
      score_semantics: "NO_SCORE_AVAILABLE", referable_dr: null,
      calibration_state: "NOT_APPLICABLE", quality_state: quality.quality_status,
      ood_state: "UNKNOWN", validation_state: "NOT_VALIDATED_FOR_IMAGE",
      limitations: ["Image-quality gate prevented DR grade estimation.", ...quality.limitations],
      model_id: null, model_version: null,
    };
  }
  if (ood.detected || modality.toUpperCase() !== "FUNDUS") {
    return {
      state: "OUT_OF_DISTRIBUTION", grade: null, grade_label: null, model_score: null,
      score_semantics: "NO_SCORE_AVAILABLE", referable_dr: null,
      calibration_state: "NOT_APPLICABLE", quality_state: quality.quality_status,
      ood_state: "OUT_OF_DISTRIBUTION", validation_state: "NOT_VALIDATED_FOR_IMAGE",
      limitations: ["Input is not accepted as an in-distribution fundus image.", ...ood.reasons],
      model_id: null, model_version: null,
    };
  }
  return {
    state: "MODEL_UNAVAILABLE", grade: null, grade_label: null, model_score: null,
    score_semantics: "NO_SCORE_AVAILABLE", referable_dr: null,
    calibration_state: "NOT_APPLICABLE", quality_state: quality.quality_status,
    ood_state: "IN_DISTRIBUTION", validation_state: "MODEL_UNAVAILABLE",
    limitations: [UNAVAILABLE_LIMITATION],
    model_id: null, model_version: null,
  };
}

/**
 * Maps genuine output from the reviewed DR provider. The caller must only
 * pass a local, hash-verified artifact. A grade-0 estimate is reported as
 * GRADE_ESTIMATED with grade 0 — never translated into "no DR" or "normal".
 */
export function resultFromResearchGrader(input: {
  grade: DrGradeWorkerOutput | null;
  raw: RawModelOutput;
  quality: QualityResult;
  ood: { detected: boolean; reasons: string[] };
  modelId: string;
  modelVersion: string;
}): DrAssessmentResult {
  const unavailable = unavailableDrAssessmentResult(input.quality, input.ood, "FUNDUS");
  if (unavailable.state !== "MODEL_UNAVAILABLE") return unavailable;
  if (input.raw.inference_status !== "completed" || !input.grade) {
    return { ...unavailable, model_id: input.modelId, model_version: input.modelVersion, limitations: ["Research DR grader failed or timed out; no grade was estimated.", ...(input.raw.limitations ?? [])] };
  }
  const g = input.grade;
  return {
    state: "GRADE_ESTIMATED",
    grade: g.predicted_grade,
    grade_label: g.grade_label,
    model_score: g.raw_logit,
    score_semantics: "MODEL_SCORE_NOT_CALIBRATED",
    referable_dr: g.referable_dr,
    calibration_state: "NOT_CALIBRATED",
    quality_state: input.quality.quality_status,
    ood_state: "IN_DISTRIBUTION",
    validation_state: "RESEARCH",
    limitations: [
      "Research grade estimate only; it does not establish or exclude diabetic retinopathy and is not a referral decision.",
      ...(input.raw.limitations ?? []),
    ],
    model_id: input.modelId,
    model_version: input.modelVersion,
  };
}
