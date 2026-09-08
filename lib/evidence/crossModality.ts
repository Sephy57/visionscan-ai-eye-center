/**
 * Cross-modality fundus<->OCT comparison (encounter-scoped, pure).
 *
 * Compares ONE fundus study's outputs (lesion regions, DR grade) with ONE
 * OCT study's output (macular class) from the same encounter and eye.
 * Categorical conjunction only - no score averaging, no logit fusion, no
 * probabilities. Never a diagnosis, never a progression claim.
 */

import type { AnalysisResult } from "../analysis/schema";

export type CrossModalityAgreement =
  | "CROSS_MODALITY_CORROBORATION"
  | "CROSS_MODALITY_DISAGREEMENT"
  | "NOT_COMPARABLE";

export type NotComparableReason =
  | "MISSING_FUNDUS_STUDY"
  | "MISSING_OCT_STUDY"
  | "MISSING_ANALYSIS"
  | "MODALITY_MISMATCH"
  | "EYE_MISMATCH"
  | "UNKNOWN_EYE"
  | "IMAGE_NOT_SUITABLE"
  | "MODEL_UNAVAILABLE"
  | "OUT_OF_DISTRIBUTION"
  | "CONSISTENT_NEGATIVE_NOT_CORROBORATION";

export type CrossModalityPattern =
  | "DR_DME"
  | "LESION_NEGATIVE_OCT_POSITIVE"
  | "FUNDUS_POSITIVE_OCT_NORMAL"
  | "OTHER"
  | null;

export interface FundusSignal {
  kind: "FUNDUS";
  lesionPositive: boolean;
  diabeticLesionTypes: string[];
  drGrade: number | null;
  drReferable: boolean | null;
}

export interface OctSignal {
  kind: "OCT";
  octClass: "CNV" | "DME" | "DRUSEN" | "NORMAL" | null;
  octPositive: boolean;
}

export interface CrossModalityResult {
  agreement: CrossModalityAgreement;
  notComparableReason: NotComparableReason | null;
  encounter_id: string | null;
  fundus_study_id: string | null;
  oct_study_id: string | null;
  eye: "OD" | "OS" | "UNKNOWN";
  fundusSignal: FundusSignal | null;
  octSignal: OctSignal | null;
  pattern: CrossModalityPattern;
  notes: string[];
  evidenceRefs: { fundusFindingIds: string[]; octFindingIds: string[] };
  compared_at: string;
}

const DIABETIC_LESION_TYPES = new Set([
  "retinal_hemorrhage",
  "microaneurysm_like_lesion",
  "hard_exudate",
  "cotton_wool_spot",
]);

const SAFETY_NOTE =
  "Cross-modality research comparison only. Not a diagnosis, not a referral decision; requires ophthalmic review.";

function notComparable(
  reason: NotComparableReason,
  partial: Partial<CrossModalityResult> & { encounter_id?: string | null; fundus_study_id?: string | null; oct_study_id?: string | null; eye?: "OD" | "OS" | "UNKNOWN" }
): CrossModalityResult {
  return {
    agreement: "NOT_COMPARABLE",
    notComparableReason: reason,
    encounter_id: partial.encounter_id ?? null,
    fundus_study_id: partial.fundus_study_id ?? null,
    oct_study_id: partial.oct_study_id ?? null,
    eye: partial.eye ?? "UNKNOWN",
    fundusSignal: partial.fundusSignal ?? null,
    octSignal: partial.octSignal ?? null,
    pattern: null,
    notes: [`NOT_COMPARABLE (${reason}): ${reasonNote(reason)} ${SAFETY_NOTE}`],
    evidenceRefs: partial.evidenceRefs ?? { fundusFindingIds: [], octFindingIds: [] },
    compared_at: new Date().toISOString(),
  };
}

function reasonNote(reason: NotComparableReason): string {
  switch (reason) {
    case "MISSING_FUNDUS_STUDY": return "No analyzed fundus study is linked for comparison.";
    case "MISSING_OCT_STUDY": return "No analyzed OCT study is linked for comparison.";
    case "MISSING_ANALYSIS": return "One side has no stored analysis; analysis is never triggered implicitly.";
    case "MODALITY_MISMATCH": return "The pair is not exactly one fundus plus one OCT study.";
    case "EYE_MISMATCH": return "The two studies declare different eyes; one eye's evidence never supports the other.";
    case "UNKNOWN_EYE": return "Eye laterality is unknown on at least one side; comparison is refused.";
    case "IMAGE_NOT_SUITABLE": return "At least one image failed the quality gate; blocked input is never read as negative.";
    case "MODEL_UNAVAILABLE": return "At least one research model produced no usable output for its study.";
    case "OUT_OF_DISTRIBUTION": return "At least one input was out of distribution; automated comparison is inconclusive.";
    case "CONSISTENT_NEGATIVE_NOT_CORROBORATION": return "Both sides are target-negative. Consistent negatives are comparable but never corroboration and never normality.";
  }
}

export interface StudyLike {
  study_id: string;
  modality: string;
  eye: string;
}

function canonicalModalityLocal(modality: string): string {
  const m = (modality ?? "").toLowerCase();
  if (["fundus", "retinal_photo", "macula", "optic_nerve"].includes(m)) return "FUNDUS";
  if (m === "oct" || m === "octa") return m.toUpperCase();
  return "OTHER";
}

/** Categorical signal derivation. Reads states/counts/grades only - never scores, confidences, or logits. */
export function deriveFundusSignal(analysis: AnalysisResult): FundusSignal {
  const regions = analysis.fundus_abnormality?.regions ?? [];
  const types = regions.map((r) => r.finding_type).filter((t) => DIABETIC_LESION_TYPES.has(t));
  const grade = analysis.dr_assessment?.state === "GRADE_ESTIMATED" ? analysis.dr_assessment.grade : null;
  const referable = analysis.dr_assessment?.state === "GRADE_ESTIMATED" ? analysis.dr_assessment.referable_dr : null;
  return {
    kind: "FUNDUS",
    lesionPositive: regions.length > 0,
    diabeticLesionTypes: [...new Set(types)],
    drGrade: grade,
    drReferable: referable,
  };
}

/** Categorical signal derivation. Reads the class only - never logits or scores. */
export function deriveOctSignal(analysis: AnalysisResult): OctSignal {
  const a = analysis.oct_assessment;
  const cls = a?.state === "CLASS_ESTIMATED" ? a.predicted_class : null;
  const valid = cls === "CNV" || cls === "DME" || cls === "DRUSEN" || cls === "NORMAL" ? cls : null;
  return {
    kind: "OCT",
    octClass: valid,
    octPositive: valid !== null && valid !== "NORMAL",
  };
}

function findingIds(analysis: AnalysisResult): string[] {
  return (analysis.findings ?? []).map((f) => f.id);
}

export function compareFundusOctPair(input: {
  encounter_id: string | null;
  fundusStudy: StudyLike;
  octStudy: StudyLike;
  fundusAnalysis: AnalysisResult | null;
  octAnalysis: AnalysisResult | null;
}): CrossModalityResult {
  const { encounter_id, fundusStudy, octStudy, fundusAnalysis, octAnalysis } = input;
  const base = { encounter_id, fundus_study_id: fundusStudy.study_id, oct_study_id: octStudy.study_id };

  if (!fundusAnalysis || !octAnalysis) {
    return notComparable("MISSING_ANALYSIS", base);
  }
  if (canonicalModalityLocal(fundusStudy.modality) !== "FUNDUS" || canonicalModalityLocal(octStudy.modality) !== "OCT") {
    return notComparable("MODALITY_MISMATCH", base);
  }
  const fEye = (fundusStudy.eye ?? "").toUpperCase();
  const oEye = (octStudy.eye ?? "").toUpperCase();
  if (fEye !== "OD" && fEye !== "OS") return notComparable("UNKNOWN_EYE", { ...base, eye: "UNKNOWN" });
  if (oEye !== "OD" && oEye !== "OS") return notComparable("UNKNOWN_EYE", { ...base, eye: "UNKNOWN" });
  if (fEye !== oEye) {
    return notComparable("EYE_MISMATCH", { ...base, eye: "UNKNOWN" });
  }
  const eye = fEye as "OD" | "OS";
  if (!fundusAnalysis.quality.acceptable || !octAnalysis.quality.acceptable) {
    return notComparable("IMAGE_NOT_SUITABLE", { ...base, eye });
  }
  // Usability is judged by each model's OWN assessment state (which already
  // internalizes its domain OOD), never by the overall OOD object: that object
  // is assessed against the DEMO model ("modality not supported") and would
  // wrongly block genuine research outputs with a modality-mismatch verdict.
  const fundusOod = fundusAnalysis.fundus_abnormality?.state === "OUT_OF_DISTRIBUTION" ||
    fundusAnalysis.dr_assessment?.state === "OUT_OF_DISTRIBUTION";
  const octOod = octAnalysis.oct_assessment?.state === "OUT_OF_DISTRIBUTION";
  if (fundusOod || octOod) {
    return notComparable("OUT_OF_DISTRIBUTION", { ...base, eye });
  }

  const fundusSignal = deriveFundusSignal(fundusAnalysis);
  const octSignal = deriveOctSignal(octAnalysis);
  const fundusUsable =
    fundusAnalysis.fundus_abnormality !== undefined &&
    fundusAnalysis.dr_assessment !== undefined &&
    fundusAnalysis.fundus_abnormality.state !== "MODEL_UNAVAILABLE" &&
    fundusAnalysis.dr_assessment.state !== "MODEL_UNAVAILABLE";
  const octUsable = octAnalysis.oct_assessment?.state === "CLASS_ESTIMATED";
  if (!fundusUsable || !octUsable) {
    return notComparable("MODEL_UNAVAILABLE", { ...base, eye, fundusSignal, octSignal });
  }

  const evidenceRefs = { fundusFindingIds: findingIds(fundusAnalysis), octFindingIds: findingIds(octAnalysis) };

  // Both target-negative: comparable but never corroboration, never normality.
  if (!fundusSignal.lesionPositive && fundusSignal.drReferable === false && !octSignal.octPositive) {
    return {
      ...notComparable("CONSISTENT_NEGATIVE_NOT_CORROBORATION", { ...base, eye, fundusSignal, octSignal, evidenceRefs }),
    };
  }

  // DR + DME corroboration: referable grade + diabetic lesions + OCT DME, same eye.
  if (
    fundusSignal.drReferable === true &&
    fundusSignal.diabeticLesionTypes.length > 0 &&
    octSignal.octClass === "DME"
  ) {
    return {
      agreement: "CROSS_MODALITY_CORROBORATION",
      notComparableReason: null,
      encounter_id,
      fundus_study_id: fundusStudy.study_id,
      oct_study_id: octStudy.study_id,
      eye,
      fundusSignal,
      octSignal,
      pattern: "DR_DME",
      notes: [
        `CROSS_MODALITY_CORROBORATION (not a confirmed diagnosis): fundus shows ${fundusSignal.diabeticLesionTypes.join("+")} ` +
          `with DR grade ${fundusSignal.drGrade}/4 (referable) and OCT estimates DME — two independent uncalibrated RESEARCH ` +
          `observations from different anatomies agree. Possible diabetic retinal disease pattern with macular-edema-related ` +
          `evidence; REQUIRES_CLINICAL_CORRELATION. ${SAFETY_NOTE}`,
      ],
      evidenceRefs,
      compared_at: new Date().toISOString(),
    };
  }

  // Directed disagreements.
  if (!fundusSignal.lesionPositive && fundusSignal.drReferable === false && octSignal.octPositive) {
    return {
      agreement: "CROSS_MODALITY_DISAGREEMENT",
      notComparableReason: null,
      encounter_id,
      fundus_study_id: fundusStudy.study_id,
      oct_study_id: octStudy.study_id,
      eye,
      fundusSignal,
      octSignal,
      pattern: "LESION_NEGATIVE_OCT_POSITIVE",
      notes: [
        `CROSS_MODALITY_DISAGREEMENT (no automatic winner): fundus is target-negative (no regions, DR grade ${fundusSignal.drGrade}/4) ` +
          `while OCT estimates ${octSignal.octClass}. Different modalities can legitimately diverge; both outputs are uncalibrated ` +
          `research evidence and a clinician must reconcile them. ${SAFETY_NOTE}`,
      ],
      evidenceRefs,
      compared_at: new Date().toISOString(),
    };
  }
  if ((fundusSignal.lesionPositive || fundusSignal.drReferable === true) && !octSignal.octPositive) {
    return {
      agreement: "CROSS_MODALITY_DISAGREEMENT",
      notComparableReason: null,
      encounter_id,
      fundus_study_id: fundusStudy.study_id,
      oct_study_id: octStudy.study_id,
      eye,
      fundusSignal,
      octSignal,
      pattern: "FUNDUS_POSITIVE_OCT_NORMAL",
      notes: [
        `CROSS_MODALITY_DISAGREEMENT (no automatic winner): fundus is research-positive while OCT estimates NORMAL. ` +
          `An OCT NORMAL estimate never means a healthy macula. Both outputs are uncalibrated research evidence and a ` +
          `clinician must reconcile them. ${SAFETY_NOTE}`,
      ],
      evidenceRefs,
      compared_at: new Date().toISOString(),
    };
  }

  // Any other divergent combination.
  return {
    agreement: "CROSS_MODALITY_DISAGREEMENT",
    notComparableReason: null,
    encounter_id,
    fundus_study_id: fundusStudy.study_id,
    oct_study_id: octStudy.study_id,
    eye,
    fundusSignal,
    octSignal,
    pattern: "OTHER",
    notes: [
      `CROSS_MODALITY_DISAGREEMENT (no automatic winner): fundus (regions=${fundusSignal.lesionPositive}, DR grade ${fundusSignal.drGrade}) ` +
        `vs OCT (${octSignal.octClass}). Uncalibrated research evidence only. ${SAFETY_NOTE}`,
    ],
    evidenceRefs,
    compared_at: new Date().toISOString(),
  };
}
