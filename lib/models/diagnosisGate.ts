/**
 * S11 - the hard, server-side gate that decides whether a definitive
 * diagnosis label may ever be shown. This is deliberately a pure function
 * with no UI dependency, so it can be called from an API route (never
 * bypassable by client-side code) and unit-tested exhaustively.
 *
 * In THIS deployment, every required condition is false by construction:
 * no model has clinical validation evidence, no calibration exists, and no
 * intended-use has been formally documented and approved. `canDisplayDiagnosis`
 * therefore always returns `{ allowed: false, ... }` today - that is the
 * correct, expected answer, not a bug. This function exists as the
 * infrastructure that would need to flip every field to true - a real,
 * auditable, all-or-nothing decision point - before Gate A could ever open,
 * not as a UI convenience.
 */

export interface DiagnosisGateInput {
  modelValidation: "NOT_VALIDATED" | "RESEARCH_ONLY" | "INTERNALLY_VALIDATED" | "EXTERNALLY_VALIDATED" | "CLINICALLY_VALIDATED";
  /** Whether the study's actual use matches the model's documented, approved intended use exactly (never a loose/partial match). */
  intendedUseMatches: boolean;
  /** Whether the study's modality matches a modality this specific model is validated for. */
  modalityMatches: boolean;
  qualityStatus: "pass" | "borderline" | "fail";
  /** True if the input was flagged as out-of-distribution for this model. */
  oodDetected: boolean;
  /** True only when documented calibration evidence exists for this model+intended-use. */
  calibrationAvailable: boolean;
  /** True only when the evidence-synthesis layer found sufficient, non-conflicting evidence for the specific condition being considered. */
  evidenceSufficient: boolean;
}

export interface DiagnosisGateResult {
  allowed: boolean;
  reasons: string[];       // every unmet requirement, always populated when allowed is false
  clinicalInterpretation: "DIAGNOSIS" | "REQUIRES_CLINICAL_CORRELATION";
}

/**
 * Returns true ONLY when every one of the seven required conditions holds.
 * Never partially satisfied - a single failing condition fails the whole
 * gate closed. Callers must never construct a "diagnosis" label themselves
 * when this returns allowed: false; they must use
 * `clinicalInterpretation: "REQUIRES_CLINICAL_CORRELATION"` instead.
 */
export function canDisplayDiagnosis(input: DiagnosisGateInput): DiagnosisGateResult {
  const reasons: string[] = [];

  if (input.modelValidation !== "CLINICALLY_VALIDATED") {
    reasons.push(`Model validation status is "${input.modelValidation}", not CLINICALLY_VALIDATED.`);
  }
  if (!input.intendedUseMatches) {
    reasons.push("The study's use does not match the model's documented, approved intended use.");
  }
  if (!input.modalityMatches) {
    reasons.push("The study's modality is not one this model is validated for.");
  }
  if (input.qualityStatus !== "pass") {
    reasons.push(`Image quality gate status is "${input.qualityStatus}", not "pass".`);
  }
  if (input.oodDetected) {
    reasons.push("Input was flagged as outside the model's validated operating conditions (OOD).");
  }
  if (!input.calibrationAvailable) {
    reasons.push("No documented calibration evidence exists for this model/intended-use.");
  }
  if (!input.evidenceSufficient) {
    reasons.push("Evidence-synthesis did not find sufficient, non-conflicting evidence.");
  }

  const allowed = reasons.length === 0;
  return {
    allowed,
    reasons,
    clinicalInterpretation: allowed ? "DIAGNOSIS" : "REQUIRES_CLINICAL_CORRELATION",
  };
}

/** Convenience: the gate result for a model this deployment has never validated, with no evidence claims made. Always closed. */
export function unvalidatedGateResult(): DiagnosisGateResult {
  return canDisplayDiagnosis({
    modelValidation: "NOT_VALIDATED",
    intendedUseMatches: false,
    modalityMatches: false,
    qualityStatus: "fail",
    oodDetected: true,
    calibrationAvailable: false,
    evidenceSufficient: false,
  });
}
