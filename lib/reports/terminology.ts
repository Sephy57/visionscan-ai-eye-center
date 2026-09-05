/**
 * S11 - patient-friendly terminology mapping. Internal enum/state values
 * are NEVER renamed or removed from the data model (every technical value
 * remains exactly as-is, available under "Technical Details") - this module
 * only supplies a friendlier label for the SAME value, for use in
 * presentation-facing UI copy.
 */

const LABELS: Record<string, string> = {
  QUALITATIVE_CONFLICT: "Conflicting information",
  VALUE_CONFLICT: "Conflicting measurements",
  LATERALITY_CONFLICT: "Conflicting eye information",
  INFERENCE_UNAVAILABLE: "AI analysis could not be completed",
  OOD_GATE: "Image outside supported analysis conditions",
  OUT_OF_DISTRIBUTION: "Image outside supported analysis conditions",
  AUTO_EXTRACTED: "Automatically extracted — awaiting verification",
  UNREVIEWED: "Awaiting human review",
  UNVERIFIED: "Not yet verified",
  HUMAN_VERIFIED: "Verified by a clinician/reviewer",
  REJECTED: "Rejected — not trusted",
  POSSIBLE_CONDITION: "Possible clinical consideration",
  SUPPORTED_CONDITION: "Clinical consideration with supporting evidence",
  INSUFFICIENT_EVIDENCE: "Insufficient evidence",
  CONFLICTING_EVIDENCE: "Conflicting evidence",
  UNABLE_TO_ASSESS: "Unable to assess",
  UNSUPPORTED_MODALITY: "Image type not supported by this analysis",
  IMAGE_QUALITY_INSUFFICIENT: "Image not suitable for AI analysis",
  NOT_A_STUDY: "Study not found",
  CANDIDATE_ONLY: "Research candidate — not in clinical use",
  NOT_CALIBRATED: "Not calibrated",
};

/** Returns the friendly label for a known internal value, or the original value unchanged if not mapped (never blank, never invented). */
export function friendlyLabel(value: string): string {
  return LABELS[value] ?? value;
}

export const TERMINOLOGY_MAP: Readonly<Record<string, string>> = Object.freeze({ ...LABELS });

/**
 * Final phase - dashboard/history status presentation. One label+tone per
 * lib/studies/service.ts's DashboardStatus, each mapped 1:1 to a real
 * server-computed value (see listStudiesWithStatus()) - never invented.
 */
export const DASHBOARD_STATUS_META: Record<string, { label: string; tone: "ok" | "warn" | "bad" | "info" | "neutral" }> = {
  URGENT_REVIEW: { label: "Urgent review", tone: "bad" },
  CLINICAL_CORRELATION_REQUIRED: { label: "Clinical correlation required", tone: "warn" },
  REVIEW_REQUIRED: { label: "Review required", tone: "info" },
  REVIEWED: { label: "Reviewed", tone: "ok" },
  IMAGE_NOT_SUITABLE: { label: "Image not suitable", tone: "bad" },
  UPLOADED: { label: "Uploaded", tone: "neutral" },
};

/**
 * S11 §41 - five distinct "nothing to show" states (a fifth,
 * IMAGE_OUT_OF_DISTRIBUTION, was added in S13), never collapsed into a
 * single ambiguous "no findings" that could be misread as normal/healthy.
 * Maps the research-analysis pipeline's real states (see
 * lib/evidence/researchAnalysis.ts's ResearchAnalysisState) plus the
 * zero-findings case of a completed run onto this presentation vocabulary.
 */
export type NoResultState =
  | "NO_TARGET_FINDING_DETECTED"      // model ran, found nothing it's built to detect
  | "MODEL_UNAVAILABLE"                // inference could not run at all
  | "MODEL_NOT_VALIDATED_FOR_IMAGE"    // modality mismatch for this model
  | "IMAGE_NOT_SUITABLE"                // quality gate failure
  | "IMAGE_OUT_OF_DISTRIBUTION";        // S13 - distinct from quality/modality: image characteristics fall outside the model's validated operating conditions (see lib/analysis/ood.ts)

export const NO_RESULT_COPY: Record<NoResultState, { headline: string; body: string }> = {
  NO_TARGET_FINDING_DETECTED: {
    headline: "NO TARGET FINDING DETECTED",
    body: "The model did not identify the conditions it was built to look for. This does not exclude other eye disease.",
  },
  MODEL_UNAVAILABLE: {
    headline: "AI ANALYSIS UNAVAILABLE",
    body: "The research model could not be run for this study.",
  },
  MODEL_NOT_VALIDATED_FOR_IMAGE: {
    headline: "NO CLINICAL AI INTERPRETATION AVAILABLE",
    body: "This image's modality is not one the deployed research model supports.",
  },
  IMAGE_NOT_SUITABLE: {
    headline: "IMAGE NOT SUITABLE FOR AI ANALYSIS",
    body: "Image quality is below the threshold required for analysis.",
  },
  IMAGE_OUT_OF_DISTRIBUTION: {
    headline: "IMAGE OUTSIDE SUPPORTED ANALYSIS CONDITIONS",
    body: "This image's characteristics (e.g. acquisition device, illumination, or resolution) fall outside the conditions this research model was built for. No automated finding was produced.",
  },
};

/** Maps a research-analysis result's raw state (+ finding count) to the five distinct presentation states above. Returns null for COMPLETED-with-findings (a real result, not a "nothing to show" state) and for NOT_A_STUDY (handled separately, not a result state at all). */
export function noResultStateFor(
  rawState: "NOT_A_STUDY" | "UNSUPPORTED_MODALITY" | "IMAGE_QUALITY_INSUFFICIENT" | "OUT_OF_DISTRIBUTION" | "INFERENCE_UNAVAILABLE" | "COMPLETED",
  findingCount: number
): NoResultState | null {
  switch (rawState) {
    case "COMPLETED": return findingCount === 0 ? "NO_TARGET_FINDING_DETECTED" : null;
    case "INFERENCE_UNAVAILABLE": return "MODEL_UNAVAILABLE";
    case "UNSUPPORTED_MODALITY": return "MODEL_NOT_VALIDATED_FOR_IMAGE";
    case "IMAGE_QUALITY_INSUFFICIENT": return "IMAGE_NOT_SUITABLE";
    case "OUT_OF_DISTRIBUTION": return "IMAGE_OUT_OF_DISTRIBUTION";
    case "NOT_A_STUDY": return null;
    default: return null;
  }
}
