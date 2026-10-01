/**
 * Fundus abnormality layer.
 *
 * This deliberately sits apart from disease classifiers.  It represents the
 * answer to a much narrower question: did a *specific, installed* model find
 * a supported abnormal region?  It never turns a target-specific negative,
 * an unavailable model, or an optic-disc segmentation into a global normal
 * result.
 */
import type { QualityResult } from "../imaging/quality";
import type { RawModelOutput } from "./outputContract";
import { canonicalModality } from "./modalities";
import { clipToUnit, isBoundedBox } from "../imaging/overlayGeometry";

export type FundusAbnormalityState =
  | "NO_TARGET_ABNORMALITY_DETECTED"
  | "SUSPICIOUS_ABNORMALITY"
  | "MULTIPLE_ABNORMALITIES"
  | "IMAGE_NOT_SUITABLE"
  | "OUT_OF_DISTRIBUTION"
  | "MODEL_UNAVAILABLE"
  | "MODEL_NOT_VALIDATED_FOR_IMAGE";

export interface FundusAbnormalityRegion {
  id: string;
  finding_type: "other_suspicious_retinal_region" | "retinal_hemorrhage" | "hard_exudate" | "cotton_wool_spot" | "microaneurysm_like_lesion";
  localization: { kind: "bounding_box"; coordinates: { x: number; y: number; w: number; h: number } };
  source_model_id: string;
  source_model_version: string;
  /** Raw score, deliberately not called a probability. */
  raw_score: number | null;
  note: string;
}

export interface FundusAbnormalityResult {
  state: FundusAbnormalityState;
  regions: FundusAbnormalityRegion[];
  model_id: string | null;
  model_version: string | null;
  model_score: number | null;
  score_semantics: "NOT_A_DIAGNOSTIC_PROBABILITY" | "NO_SCORE_AVAILABLE";
  calibration_state: "NOT_CALIBRATED" | "NOT_APPLICABLE";
  quality_state: string;
  ood_state: "IN_DISTRIBUTION" | "OUT_OF_DISTRIBUTION" | "UNKNOWN";
  limitations: string[];
  validation_state: "RESEARCH" | "VALIDATION_PENDING" | "CLINICALLY_VALIDATED" | "MODEL_UNAVAILABLE" | "NOT_VALIDATED_FOR_IMAGE";
}

const UNAVAILABLE_LIMITATION =
  "No installed, validated-for-this-image general fundus abnormality model is available. This is not a normal-fundus result and requires ophthalmic interpretation.";

export function unavailableFundusAbnormalityResult(
  quality: QualityResult,
  ood: { detected: boolean; reasons: string[] },
  modality: string,
): FundusAbnormalityResult {
  if (quality.quality_status !== "pass") {
    return {
      state: "IMAGE_NOT_SUITABLE", regions: [], model_id: null, model_version: null, model_score: null,
      score_semantics: "NO_SCORE_AVAILABLE", calibration_state: "NOT_APPLICABLE", quality_state: quality.quality_status,
      ood_state: "UNKNOWN", validation_state: "NOT_VALIDATED_FOR_IMAGE",
      limitations: ["Image-quality gate prevented fundus-abnormality inference.", ...quality.limitations],
    };
  }
  if (ood.detected || canonicalModality(modality) !== "FUNDUS") {
    return {
      state: "OUT_OF_DISTRIBUTION", regions: [], model_id: null, model_version: null, model_score: null,
      score_semantics: "NO_SCORE_AVAILABLE", calibration_state: "NOT_APPLICABLE", quality_state: quality.quality_status,
      ood_state: "OUT_OF_DISTRIBUTION", validation_state: "NOT_VALIDATED_FOR_IMAGE",
      limitations: ["Input is not accepted as an in-distribution fundus image.", ...ood.reasons],
    };
  }
  return {
    state: "MODEL_UNAVAILABLE", regions: [], model_id: null, model_version: null, model_score: null,
    score_semantics: "NO_SCORE_AVAILABLE", calibration_state: "NOT_APPLICABLE", quality_state: quality.quality_status,
    ood_state: "IN_DISTRIBUTION", validation_state: "MODEL_UNAVAILABLE", limitations: [UNAVAILABLE_LIMITATION],
  };
}

/**
 * Maps genuine output from a future reviewed provider.  The caller must only
 * pass a local, hash-verified artifact and must supply its real capability
 * list.  Unknown classes become a generic suspicious region, never a guessed
 * lesion.  This function has no filename, EXIF, OCR or query-string input.
 */
export function resultFromResearchDetector(input: {
  raw: RawModelOutput;
  quality: QualityResult;
  ood: { detected: boolean; reasons: string[] };
  modelId: string;
  modelVersion: string;
  supportedFindingTypes: ReadonlySet<string>;
}): FundusAbnormalityResult {
  const unavailable = unavailableFundusAbnormalityResult(input.quality, input.ood, "FUNDUS");
  if (unavailable.state !== "MODEL_UNAVAILABLE") return unavailable;
  const rawLimitations = input.raw.limitations ?? [];
  const attributed = { ...unavailable, model_id: input.modelId, model_version: input.modelVersion };
  if (input.raw.inference_status !== "completed") {
    return { ...attributed, limitations: ["Research detector failed or timed out; no finding was inferred.", ...rawLimitations] };
  }
  const regions: FundusAbnormalityRegion[] = [];
  // Findings the model returned that could not become a drawable region
  // (no box, a non-box localization, or unusable geometry).
  let rejected = 0;
  for (const finding of input.raw.findings ?? []) {
    const loc = finding.localization;
    // Same rounding tolerance the raw-output contract applies; a box is clipped
    // to the image, never moved or resized beyond that noise.
    if (loc?.kind !== "bounding_box" || !isBoundedBox(loc.coordinates)) { rejected += 1; continue; }
    const c = clipToUnit(loc.coordinates);
    const type = input.supportedFindingTypes.has(finding.finding_type)
      ? finding.finding_type as FundusAbnormalityRegion["finding_type"]
      : "other_suspicious_retinal_region";
    regions.push({ id: `fundus_region_${regions.length + 1}`, finding_type: type,
      localization: { kind: "bounding_box", coordinates: c }, source_model_id: input.modelId,
      source_model_version: input.modelVersion, raw_score: finding.confidence ?? null,
      note: type === "other_suspicious_retinal_region" ? "Suspicious region detected by research model; type not established." : "Research-model localization; requires ophthalmic review.",
    });
  }
  const one = rejected === 1;
  if (!regions.length && rejected > 0) {
    // The model did report something, but none of it could be placed on the
    // image.  Reporting that as "no target abnormality" would turn a model
    // fault into a negative.
    return { ...attributed,
      limitations: [`Research detector returned ${rejected} finding${one ? "" : "s"} without a usable box (missing or invalid geometry); none could be shown and nothing was inferred.`, ...rawLimitations] };
  }
  if (!regions.length) {
    return { ...attributed, state: "NO_TARGET_ABNORMALITY_DETECTED",
      limitations: ["No target abnormality was detected by this research model. Other abnormalities may still be present.", ...rawLimitations], validation_state: "RESEARCH" };
  }
  return {
    state: regions.length > 1 ? "MULTIPLE_ABNORMALITIES" : "SUSPICIOUS_ABNORMALITY", regions,
    model_id: input.modelId, model_version: input.modelVersion, model_score: null,
    score_semantics: "NOT_A_DIAGNOSTIC_PROBABILITY", calibration_state: "NOT_CALIBRATED", quality_state: input.quality.quality_status,
    ood_state: "IN_DISTRIBUTION", validation_state: "RESEARCH",
    limitations: [
      "Research output only; it does not establish a diagnosis or rule out other retinal disease.",
      ...(rejected > 0 ? [`${rejected} further finding${one ? " was" : "s were"} returned without a usable box and ${one ? "is" : "are"} not shown.`] : []),
      ...rawLimitations,
    ],
  };
}
