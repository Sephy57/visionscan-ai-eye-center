import { describe, it, expect } from "vitest";
import {
  compareFundusOctPair,
  deriveFundusSignal,
  deriveOctSignal,
} from "@/lib/evidence/crossModality";
import type { AnalysisResult } from "@/lib/analysis/schema";

/**
 * Cross-modality fundus<->OCT comparison: categorical conjunction only.
 * No score averaging, no automatic winner, never a diagnosis.
 */

function baseAnalysis(over: Partial<AnalysisResult>): AnalysisResult {
  return {
    schema_version: "1.0.0",
    study: { study_id: "s", modality: "fundus", eye: "OD", source: "file_upload", metadata_provenance: "none" },
    quality: { score: 0.9, acceptable: true, status: "pass", artifacts: [], affected_regions: [], recommended_reacquisition: false },
    segmentation: { implemented: false, note: "n/a" },
    findings: [],
    uncertainty: { overall: 0.3, reasons: [] },
    recommendation: { priority: "prompt_professional_review", action: "review", rationale: "test" },
    ensemble: { performed: false, checks: [], note: "n/a" },
    ood: { detected: false, reasons: [], message: "in" },
    model_registry: {
      model_id: "x", model_version: "1", model_status: "RESEARCH", display_label: "RESEARCH",
      integrity_checks: [], device_compatibility: { compatible: false, note: "x" }, model_input: "IMAGE_ONLY",
    },
    demo: { synthetic_result: false, label: "RESEARCH" },
    diagnosis_gate: { allowed: false, reasons: ["x"], clinical_interpretation: "REQUIRES_CLINICAL_CORRELATION" },
    provenance: { models: [], ruleset_version: "r", analyzed_at: new Date().toISOString(), input_dimensions: { width: 1, height: 1 }, pipeline_version: "0.4.0" },
    safety: { quality_gate_enforced: true, disclaimers: [], blocked_claims: [] },
    ...over,
  } as AnalysisResult;
}

function fundusAnalysis(opts: { regions: Array<"retinal_hemorrhage" | "microaneurysm_like_lesion" | "hard_exudate" | "cotton_wool_spot">; grade: number | null }): AnalysisResult {
  return baseAnalysis({
    fundus_abnormality: {
      state: opts.regions.length ? "SUSPICIOUS_ABNORMALITY" : "NO_TARGET_ABNORMALITY_DETECTED",
      regions: opts.regions.map((t, i) => ({
        id: `r${i}`, finding_type: t,
        localization: { kind: "bounding_box" as const, coordinates: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 } },
        source_model_id: "m", source_model_version: "v", raw_score: null, note: "n",
      })),
      model_id: "m", model_version: "v", model_score: null,
      score_semantics: "NOT_A_DIAGNOSTIC_PROBABILITY", calibration_state: "NOT_CALIBRATED",
      quality_state: "pass", ood_state: "IN_DISTRIBUTION",
      limitations: [], validation_state: "RESEARCH",
    },
    dr_assessment: opts.grade === null ? {
      state: "MODEL_UNAVAILABLE", grade: null, grade_label: null, model_score: null,
      score_semantics: "NO_SCORE_AVAILABLE", referable_dr: null, calibration_state: "NOT_APPLICABLE",
      quality_state: "pass", ood_state: "IN_DISTRIBUTION", limitations: [], validation_state: "MODEL_UNAVAILABLE",
      model_id: null, model_version: null,
    } : {
      state: "GRADE_ESTIMATED", grade: opts.grade,
      grade_label: ["no_dr", "mild_npdr", "moderate_npdr", "severe_npdr", "proliferative_dr"][opts.grade],
      model_score: 1.5, score_semantics: "MODEL_SCORE_NOT_CALIBRATED", referable_dr: opts.grade >= 2,
      calibration_state: "NOT_CALIBRATED", quality_state: "pass", ood_state: "IN_DISTRIBUTION",
      limitations: [], validation_state: "RESEARCH", model_id: "m", model_version: "v",
    },
  });
}

function octAnalysis(cls: "DME" | "CNV" | "DRUSEN" | "NORMAL" | null): AnalysisResult {
  const idx = cls === null ? null : (["CNV", "DME", "DRUSEN", "NORMAL"] as const).indexOf(cls);
  return baseAnalysis({
    study: { study_id: "o", modality: "oct", eye: "OD", source: "file_upload", metadata_provenance: "none" },
    oct_assessment: cls === null ? {
      state: "MODEL_UNAVAILABLE", predicted_class: null, predicted_index: null, model_scores: null,
      score_semantics: "NO_SCORE_AVAILABLE", calibration_state: "NOT_APPLICABLE",
      quality_state: "pass", ood_state: "IN_DISTRIBUTION", limitations: [],
      validation_state: "MODEL_UNAVAILABLE", model_id: null, model_version: null,
    } : {
      state: "CLASS_ESTIMATED", predicted_class: cls, predicted_index: idx,
      model_scores: [0, 0, 0, 0], score_semantics: "MODEL_SCORE_NOT_CALIBRATED",
      calibration_state: "NOT_CALIBRATED", quality_state: "pass", ood_state: "IN_DISTRIBUTION",
      limitations: [], validation_state: "RESEARCH", model_id: "m", model_version: "v",
    },
  });
}

function pair(fundus: AnalysisResult, oct: AnalysisResult, eye = "OD") {
  return compareFundusOctPair({
    encounter_id: "enc1",
    fundusStudy: { study_id: "f1", modality: "fundus", eye },
    octStudy: { study_id: "o1", modality: "oct", eye },
    fundusAnalysis: fundus,
    octAnalysis: oct,
  });
}

describe("cross-modality signal derivation (no scores read)", () => {
  it("derives categorical signals only", () => {
    const f = deriveFundusSignal(fundusAnalysis({ regions: ["retinal_hemorrhage"], grade: 2 }));
    expect(f.lesionPositive).toBe(true);
    expect(f.diabeticLesionTypes).toEqual(["retinal_hemorrhage"]);
    expect(f.drGrade).toBe(2);
    expect(f.drReferable).toBe(true);
    expect(deriveOctSignal(octAnalysis("DME"))).toEqual({ kind: "OCT", octClass: "DME", octPositive: true });
    expect(deriveOctSignal(octAnalysis("NORMAL")).octPositive).toBe(false);
  });
});

describe("cross-modality agreement matrix", () => {
  it("DR + DME corroborates without diagnosing", () => {
    const r = pair(
      fundusAnalysis({ regions: ["retinal_hemorrhage", "microaneurysm_like_lesion"], grade: 2 }),
      octAnalysis("DME")
    );
    expect(r.agreement).toBe("CROSS_MODALITY_CORROBORATION");
    expect(r.pattern).toBe("DR_DME");
    expect(r.notes.join(" ")).toMatch(/not a confirmed diagnosis/i);
  });

  it("lesion-negative fundus + positive OCT disagrees with no winner", () => {
    const r = pair(fundusAnalysis({ regions: [], grade: 0 }), octAnalysis("DME"));
    expect(r.agreement).toBe("CROSS_MODALITY_DISAGREEMENT");
    expect(r.pattern).toBe("LESION_NEGATIVE_OCT_POSITIVE");
    expect(r.notes.join(" ")).toMatch(/no automatic winner/i);
  });

  it("fundus-positive + OCT NORMAL disagrees without calling the macula healthy", () => {
    const r = pair(fundusAnalysis({ regions: ["hard_exudate"], grade: 1 }), octAnalysis("NORMAL"));
    expect(r.agreement).toBe("CROSS_MODALITY_DISAGREEMENT");
    expect(r.pattern).toBe("FUNDUS_POSITIVE_OCT_NORMAL");
    expect(r.notes.join(" ")).toMatch(/never means a healthy macula/i);
  });

  it("double negatives are NOT_COMPARABLE, never corroboration or normality", () => {
    const r = pair(fundusAnalysis({ regions: [], grade: 0 }), octAnalysis("NORMAL"));
    expect(r.agreement).toBe("NOT_COMPARABLE");
    expect(r.notComparableReason).toBe("CONSISTENT_NEGATIVE_NOT_CORROBORATION");
  });

  it("refuses cross-eye pairs", () => {
    const r = pair(fundusAnalysis({ regions: [], grade: 0 }), octAnalysis("NORMAL"), "OD");
    const cross = compareFundusOctPair({
      encounter_id: "enc1",
      fundusStudy: { study_id: "f1", modality: "fundus", eye: "OD" },
      octStudy: { study_id: "o1", modality: "oct", eye: "OS" },
      fundusAnalysis: fundusAnalysis({ regions: [], grade: 0 }),
      octAnalysis: octAnalysis("NORMAL"),
    });
    expect(cross.agreement).toBe("NOT_COMPARABLE");
    expect(cross.notComparableReason).toBe("EYE_MISMATCH");
    expect(r.eye).toBe("OD");
  });

  it("refuses unknown eyes and missing analyses", () => {
    const unk = compareFundusOctPair({
      encounter_id: null,
      fundusStudy: { study_id: "f1", modality: "fundus", eye: "unknown" },
      octStudy: { study_id: "o1", modality: "oct", eye: "OD" },
      fundusAnalysis: fundusAnalysis({ regions: [], grade: 0 }),
      octAnalysis: octAnalysis("NORMAL"),
    });
    expect(unk.notComparableReason).toBe("UNKNOWN_EYE");
    const missing = compareFundusOctPair({
      encounter_id: null,
      fundusStudy: { study_id: "f1", modality: "fundus", eye: "OD" },
      octStudy: { study_id: "o1", modality: "oct", eye: "OD" },
      fundusAnalysis: null,
      octAnalysis: octAnalysis("NORMAL"),
    });
    expect(missing.notComparableReason).toBe("MISSING_ANALYSIS");
  });
});
