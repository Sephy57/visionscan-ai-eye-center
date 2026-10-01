/**
 * What the scan viewer says about the analysis behind it.
 *
 * A viewer with nothing drawn must still say why.  Every state below is
 * derived from stored analysis fields (never from message text) and none of
 * them can read as a normal result: "no signals", "unavailable", "failed",
 * "quality", "out of distribution", "unsupported" and "not run" are different
 * statements and keep different codes.
 */
import type { FundusAbnormalityState } from "../models/fundusAbnormality";
import { canonicalModality } from "../models/modalities";

/** The stored fundus result as far as the viewer needs it (pages hold a looser copy of the full type). */
export interface FundusStateInput {
  state: FundusAbnormalityState;
  regions: readonly unknown[];
  model_id: string | null;
  model_version: string | null;
  validation_state: string;
  quality_state?: string;
  ood_state?: string;
}

export type ViewerAnalysisStateCode =
  | "SIGNALS_FOUND"
  | "NO_LOCALIZED_SIGNALS"
  | "MODEL_UNAVAILABLE"
  | "MODEL_FAILED"
  | "IMAGE_QUALITY_INSUFFICIENT"
  | "OUT_OF_DISTRIBUTION"
  | "ANALYSIS_NOT_RUN"
  | "UNSUPPORTED_MODALITY"
  | "INSUFFICIENT_EVIDENCE";

export interface ViewerAnalysisState {
  code: ViewerAnalysisStateCode;
  tone: "warn" | "bad" | "neutral";
  headline: string;
  detail: string;
  regionCount: number;
  /** Only facts present in the stored analysis; absent facts are omitted, not guessed. */
  provenance: Array<{ label: string; value: string }>;
}

export interface ViewerAnalysisInput {
  analysis: {
    analysis_mode?: string;
    fundus_abnormality?: FundusStateInput;
  } | null | undefined;
  modality?: string | null;
  laterality?: string | null;
}

const NOT_NORMAL = "This is not a normal-fundus result.";

function provenanceFor(input: ViewerAnalysisInput, fundus: FundusStateInput | undefined): ViewerAnalysisState["provenance"] {
  const facts: ViewerAnalysisState["provenance"] = [];
  const add = (label: string, value: string | null | undefined) => { if (value) facts.push({ label, value }); };
  add("Model", fundus?.model_id);
  add("Version", fundus?.model_version);
  add("Status", fundus?.validation_state?.replaceAll("_", " ").toLowerCase());
  add("Modality", input.modality ? canonicalModality(input.modality) : null);
  if (input.laterality && input.laterality.toLowerCase() !== "unknown") add("Eye", input.laterality);
  add("Quality", fundus?.quality_state);
  add("Distribution", fundus?.ood_state?.replaceAll("_", " ").toLowerCase());
  return facts;
}

export function deriveViewerAnalysisState(input: ViewerAnalysisInput): ViewerAnalysisState {
  const fundus = input.analysis?.fundus_abnormality;
  const make = (code: ViewerAnalysisStateCode, tone: ViewerAnalysisState["tone"], headline: string, detail: string, regionCount = 0): ViewerAnalysisState =>
    ({ code, tone, headline, detail, regionCount, provenance: provenanceFor(input, fundus) });

  if (!input.analysis) {
    return make("ANALYSIS_NOT_RUN", "neutral", "Analysis not run",
      "No analysis is stored for this study yet, so there is nothing to localize. Run the analysis to see model output.");
  }
  if (!fundus) {
    if (input.modality && canonicalModality(input.modality) !== "FUNDUS") {
      return make("UNSUPPORTED_MODALITY", "neutral", "No localization for this image type",
        "The viewer shows localized research signals for fundus photographs only. Other model output for this study is listed beside the viewer.");
    }
    return make("ANALYSIS_NOT_RUN", "neutral", "No fundus localization recorded",
      `This study has no fundus localization result, so nothing is drawn. ${NOT_NORMAL}`);
  }

  switch (fundus.state) {
    case "SUSPICIOUS_ABNORMALITY":
    case "MULTIPLE_ABNORMALITIES": {
      const n = fundus.regions.length;
      if (n === 0) {
        return make("INSUFFICIENT_EVIDENCE", "warn", "Result recorded without any region",
          "The stored result reports a suspicious state but contains no region geometry, so nothing can be drawn. Treat it as unreviewed.");
      }
      return make("SIGNALS_FOUND", "warn", `Model ran — ${n} localized research signal${n === 1 ? "" : "s"} found`,
        "Boxes mark where a research model flagged a region. They are not diagnoses and need ophthalmic review.", n);
    }
    case "NO_TARGET_ABNORMALITY_DETECTED":
      return make("NO_LOCALIZED_SIGNALS", "neutral", "Model ran — no localized signals",
        `The model found no region of the types it supports. Other abnormalities may still be present. ${NOT_NORMAL}`);
    case "IMAGE_NOT_SUITABLE":
      return make("IMAGE_QUALITY_INSUFFICIENT", "bad", "Image quality too low to analyze",
        "The quality gate stopped localization, so no region was inferred. Acquire a new image or have this one reviewed directly.");
    case "OUT_OF_DISTRIBUTION":
      return make("OUT_OF_DISTRIBUTION", "warn", "Image outside the model's validated range",
        "This image is not accepted as the kind of fundus photograph the model was evaluated on, so no region was drawn and none should be assumed.");
    case "MODEL_NOT_VALIDATED_FOR_IMAGE":
      return make("INSUFFICIENT_EVIDENCE", "warn", "Not enough evidence to localize",
        "No installed model is validated for this image, so nothing was inferred.");
    case "MODEL_UNAVAILABLE":
    default:
      // A model id means a provider was attempted and returned nothing usable.
      if (fundus.model_id || input.analysis.analysis_mode === "MODEL_FAILED") {
        return make("MODEL_FAILED", "bad", "Model failed — no localization produced",
          "The model did not return a valid result. Nothing was inferred and no substitute output was generated. Re-run the analysis, or ask an administrator to check the model runtime.");
      }
      return make("MODEL_UNAVAILABLE", "bad", "No localization model ran",
        `No installed model could evaluate this image on this deployment, so nothing was inferred. ${NOT_NORMAL}`);
  }
}
