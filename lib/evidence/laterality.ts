import type { Laterality as TestResultLaterality } from "../documents/extraction/testResults";
import type { Laterality as SymptomLaterality } from "../clinical/symptoms";
import type { EvidenceLaterality } from "./types";

/**
 * Explicit, conservative laterality mapping (S5.4). Two source vocabularies
 * exist in this codebase and they are NOT interchangeable:
 *   - TestResult.laterality:    "OD" | "OS" | "OU" | "UNKNOWN"   (from explicit document tokens)
 *   - PatientSymptom.laterality: "right" | "left" | "both" | "unknown" (patient-facing wording)
 * Every mapping function below is named for exactly which vocabulary it
 * reads, so a caller can never accidentally treat one as the other. None of
 * these functions ever infer laterality from context - only from the
 * specific field passed in.
 */

/** TestResult laterality is already the canonical vocabulary - passthrough, no inference. */
export function lateralityFromTestResult(l: TestResultLaterality): EvidenceLaterality {
  return l;
}

/**
 * Maps patient-facing right/left/both/unknown wording to the clinical
 * OD/OS/OU convention. This is a WORDING TRANSLATION of what the patient (or
 * intake form) reported, not a clinical determination, and callers must
 * treat `laterality_source: "mapped_from_symptom_report"` as a weaker
 * evidentiary claim than an explicit OD/OS/OU token extracted from a
 * document (S5.4/S5.22: never silently associate this with same-eye
 * document evidence).
 */
export function lateralityFromSymptomReport(l: SymptomLaterality): EvidenceLaterality {
  switch (l) {
    case "right": return "OD";
    case "left": return "OS";
    case "both": return "OU";
    case "unknown":
    default:
      return "UNKNOWN";
  }
}

/** A study's single declared eye (image findings inherit it) - never OU today (EyeLaterality has no OU value). */
export function lateralityFromStudyEye(eye: string): EvidenceLaterality {
  if (eye === "OD" || eye === "OS") return eye;
  return "UNKNOWN";
}
