/**
 * S11 - presentation-layer mapping over the existing, unchanged quality
 * scoring (lib/imaging/quality.ts). Fixes a real presentation gap: a
 * "pass" status (score >= 0.7) can still carry real artifacts (e.g.
 * insufficient_resolution costs -0.25, so a 1.0-quality image with that one
 * artifact scores exactly 0.75, still >= the 0.7 pass threshold) - showing
 * that as a bare "GOOD" without surfacing the artifact is misleading. This
 * module NEVER changes the underlying score/status/threshold logic - only
 * how it is worded for a human reader.
 */

import type { QualityResult } from "../imaging/quality";

/**
 * S12 - widened structurally from the exact QualityResult shape to just the
 * two fields presentQuality actually reads. This is a strictly ADDITIVE,
 * backward-compatible relaxation (any real QualityResult still satisfies
 * it) that lets the legacy DEMO pipeline's reduced QualityInfo shape
 * (lib/analysis/schema.ts - score/status/artifacts, not the full raw
 * QualityResult) be presented honestly too, without duplicating logic.
 */
export type QualityPresentationInput = Pick<QualityResult, "detected_artifacts"> & {
  quality_status: QualityResult["quality_status"] | string;
};

export interface QualityPresentation {
  overall_label: "GOOD" | "ACCEPTABLE WITH LIMITATIONS" | "ANALYSIS BLOCKED";
  resolution_label: "Acceptable" | "Below preferred threshold";
  illumination_label: "Acceptable" | "Below preferred threshold";
  field_of_view_label: "Acceptable" | "Atypical";
  artifacts_label: string; // human-readable list, or "None detected"
  impact_note: string;
  blocked: boolean;
}

const RESOLUTION_ARTIFACTS = new Set(["insufficient_resolution"]);
const ILLUMINATION_ARTIFACTS = new Set(["poor_illumination", "overexposure", "glare"]);
const FOV_ARTIFACTS = new Set(["incorrect_field_of_view"]);

function humanizeArtifact(a: string): string {
  return a.replaceAll("_", " ");
}

export function presentQuality(quality: QualityPresentationInput): QualityPresentation {
  const artifacts = quality.detected_artifacts;
  const hasResolutionIssue = artifacts.some((a) => RESOLUTION_ARTIFACTS.has(a));
  const hasIlluminationIssue = artifacts.some((a) => ILLUMINATION_ARTIFACTS.has(a));
  const hasFovIssue = artifacts.some((a) => FOV_ARTIFACTS.has(a));

  const blocked = quality.quality_status === "fail";
  const overall_label: QualityPresentation["overall_label"] = blocked
    ? "ANALYSIS BLOCKED"
    : artifacts.length > 0
      ? "ACCEPTABLE WITH LIMITATIONS"
      : "GOOD";

  const impact_note = blocked
    ? "Image quality is below the minimum threshold for AI analysis. No analysis was performed."
    : artifacts.length > 0
      ? "Analysis may be less reliable given the noted limitation(s)."
      : "No quality limitations were detected.";

  return {
    overall_label,
    resolution_label: hasResolutionIssue ? "Below preferred threshold" : "Acceptable",
    illumination_label: hasIlluminationIssue ? "Below preferred threshold" : "Acceptable",
    field_of_view_label: hasFovIssue ? "Atypical" : "Acceptable",
    artifacts_label: artifacts.length > 0 ? artifacts.map(humanizeArtifact).join(", ") : "None detected",
    impact_note,
    blocked,
  };
}
