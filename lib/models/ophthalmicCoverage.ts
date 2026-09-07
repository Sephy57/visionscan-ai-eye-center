/**
 * Machine-readable negative-space registry.
 *
 * This answers a different question from the model registry: which imaging
 * tasks/pathology targets are actually available in this deployment? A
 * downloaded checkpoint or a research-only capability is never represented
 * as production coverage.
 */

export type OphthalmicCoverageState =
  | "NO_VALIDATED_MODEL_AVAILABLE"
  | "CANDIDATE_DISABLED"
  | "RESEARCH_PIPELINE"
  | "RESEARCH_ANATOMY_ONLY"
  | "UNSUPPORTED_IMAGE_ANALYSIS";

export interface OphthalmicCoverageEntry {
  target_id: string;
  display_name: string;
  modality: "FUNDUS" | "OCT" | "DICOM";
  task: "GENERAL_ABNORMALITY" | "LESION_SEGMENTATION" | "ANATOMY_SEGMENTATION" | "DISEASE_SCREENING" | "DISEASE_GRADING" | "PIXEL_ANALYSIS";
  state: OphthalmicCoverageState;
  model_id: string | null;
  production_available: false;
  /** True once the live analysis pipeline actually executes a model for this target. */
  pipeline_enabled: boolean;
  localization: "NONE" | "RESEARCH_BOUNDING_BOX" | "CANDIDATE_ORIGINAL_IMAGE_GEOMETRY_NOT_EXPOSED";
  calibration: "NOT_CALIBRATED" | "NOT_APPLICABLE";
  result_semantics: string;
  limitations: readonly string[];
}

const NO_MODEL = [
  "No clinically validated model is installed for this target.",
  "Absence of an automated finding must not be interpreted as absence of pathology.",
] as const;

export const OPHTHALMIC_COVERAGE_REGISTRY: readonly OphthalmicCoverageEntry[] = [
  {
    target_id: "fundus_general_abnormality", display_name: "General fundus abnormality screening", modality: "FUNDUS", task: "GENERAL_ABNORMALITY",
    state: "NO_VALIDATED_MODEL_AVAILABLE", model_id: null, production_available: false, pipeline_enabled: false,
    localization: "NONE", calibration: "NOT_APPLICABLE",
    result_semantics: "MODEL_UNAVAILABLE; never normal or target-negative", limitations: NO_MODEL,
  },
  ...(["cotton_wool_spot", "hard_exudate", "retinal_hemorrhage", "microaneurysm_like_lesion"] as const).map((target) => ({
    target_id: target,
    display_name: target.replaceAll("_", " "),
    modality: "FUNDUS" as const,
    task: "LESION_SEGMENTATION" as const,
    state: "RESEARCH_PIPELINE" as const,
    model_id: "fundus-lesions-clementp-unet-seresnext50",
    production_available: false as const,
    pipeline_enabled: true as const,
    localization: "RESEARCH_BOUNDING_BOX" as const,
    calibration: "NOT_CALIBRATED" as const,
    result_semantics: "Research lesion-like region detection; unfiltered argmax components are not validated lesions and a target-negative result is never a healthy-eye claim",
    limitations: ["RESEARCH status: real local inference, no clinical or independent external validation completed.", "Device compatibility unvalidated for every device; domain validation UNKNOWN.", "Argmax components have no operating threshold or calibration; false negatives and false positives occur."],
  })),
  {
    target_id: "dr_grade_estimate", display_name: "dr grade estimate", modality: "FUNDUS", task: "DISEASE_GRADING",
    state: "RESEARCH_PIPELINE", model_id: "fundus-dr-grading-effb0",
    production_available: false, pipeline_enabled: true,
    localization: "NONE", calibration: "NOT_CALIBRATED",
    result_semantics: "Research DR grade estimate from a single uncalibrated regression logit; a low grade never excludes diabetic retinopathy",
    limitations: ["RESEARCH status: real local inference, no clinical or independent external validation completed.", "Grade boundaries uncalibrated; raw logit is a ranking score, not a probability.", "Device compatibility unvalidated for every device; domain validation UNKNOWN."],
  },
  {
    target_id: "optic_disc_cup_anatomy", display_name: "Optic disc/cup anatomy", modality: "FUNDUS", task: "ANATOMY_SEGMENTATION",    state: "RESEARCH_ANATOMY_ONLY", model_id: "segformer-optic-disc-cup-refuge", production_available: false, pipeline_enabled: false,
    localization: "RESEARCH_BOUNDING_BOX", calibration: "NOT_CALIBRATED",
    result_semantics: "Isolated research anatomy localization; not a glaucoma or disease result",
    limitations: ["Not part of the clinical analysis pipeline.", "No diagnosis, disease exclusion, or calibrated confidence."],
  },
  ...([
    ["diabetic_retinopathy", "Diabetic retinopathy"],
    ["diabetic_macular_edema", "Diabetic macular edema"],
    ["age_related_macular_degeneration", "Age-related macular degeneration"],
    ["glaucoma", "Glaucoma"],
    ["retinal_detachment_or_tear", "Retinal detachment or tear"],
    ["retinal_vascular_occlusion", "Retinal vascular occlusion"],
    ["disc_edema_or_papilledema", "Disc edema or papilledema"],
  ] as const).map(([target_id, display_name]) => ({
    target_id, display_name, modality: "FUNDUS" as const, task: "DISEASE_SCREENING" as const,
    state: "NO_VALIDATED_MODEL_AVAILABLE" as const, model_id: null, production_available: false as const, pipeline_enabled: false as const,
    localization: "NONE" as const, calibration: "NOT_APPLICABLE" as const,
    result_semantics: "Unsupported pathology target in this deployment", limitations: NO_MODEL,
  })),
  {
    target_id: "oct_pixel_analysis", display_name: "OCT pixel-level interpretation", modality: "OCT", task: "PIXEL_ANALYSIS",
    state: "UNSUPPORTED_IMAGE_ANALYSIS", model_id: null, production_available: false, pipeline_enabled: false,
    localization: "NONE", calibration: "NOT_APPLICABLE", result_semantics: "Unsupported; structured OCT values may only come from provenance-bearing records",
    limitations: ["No OCT pixel model is installed.", "Document-extracted values remain unreviewed until clinician verification."],
  },
  {
    target_id: "dicom_pixel_analysis", display_name: "DICOM pixel-level interpretation", modality: "DICOM", task: "PIXEL_ANALYSIS",
    state: "UNSUPPORTED_IMAGE_ANALYSIS", model_id: null, production_available: false, pipeline_enabled: false,
    localization: "NONE", calibration: "NOT_APPLICABLE", result_semantics: "Detected and refused by the image-analysis pipeline",
    limitations: ["DICOM input is not decoded for automated clinical interpretation in this deployment."],
  },
] as const;

export const OPHTHALMIC_COVERAGE_VERSION = "2026-09-08.1";

export function activeProductionCoverage(): readonly OphthalmicCoverageEntry[] {
  return OPHTHALMIC_COVERAGE_REGISTRY.filter((entry) => entry.production_available && entry.pipeline_enabled);
}

export function coverageForModality(modality: string): readonly OphthalmicCoverageEntry[] {
  const normalized = modality.toUpperCase();
  return OPHTHALMIC_COVERAGE_REGISTRY.filter((entry) => entry.modality === normalized);
}
