import { describe, it, expect } from "vitest";
import {
  comparePriorCurrent,
  scanComparisonOutput,
  type ComparisonInput,
} from "@/lib/evidence/priorCurrentComparison";
import type { AnalysisResult } from "@/lib/analysis/schema";

/**
 * Same-eye prior-vs-current comparison: observed detection differences only.
 * No progression/worsening/improvement/resolution language may ever appear.
 */

function finding(id: string, type: string, model_id = "fundus-lesions-clementp-unet-seresnext50") {
  return {
    id, type, location: "retina", severity: "indeterminate" as const, confidence: 0,
    confidence_category: "INDETERMINATE" as const, explanation: "test", synthetic: false,
    model_id, model_status: "RESEARCH", taxonomy_level: "observation" as const,
  };
}

function analysis(over: Partial<AnalysisResult> & { findings: ReturnType<typeof finding>[] }): AnalysisResult {
  return {
    schema_version: "1.0.0",
    study: { study_id: "s", modality: "fundus", eye: "OD", source: "file_upload", metadata_provenance: "none" },
    quality: { score: 0.9, acceptable: true, status: "pass", artifacts: [], affected_regions: [], recommended_reacquisition: false },
    segmentation: { implemented: false, note: "n/a" },
    uncertainty: { overall: 0.3, reasons: [] },
    recommendation: { priority: "prompt_professional_review", action: "review", rationale: "test" },
    ensemble: { performed: false, checks: [], note: "n/a" },
    model_registry: {
      model_id: "fundus-lesions-clementp-unet-seresnext50", model_version: "a2cfcb594e483",
      model_status: "RESEARCH", display_label: "RESEARCH", integrity_checks: [],
      device_compatibility: { compatible: false, note: "x" }, model_input: "IMAGE_ONLY",
    },
    demo: { synthetic_result: false, label: "RESEARCH" },
    diagnosis_gate: { allowed: false, reasons: ["x"], clinical_interpretation: "REQUIRES_CLINICAL_CORRELATION" },
    provenance: { models: [], ruleset_version: "r", analyzed_at: new Date().toISOString(), input_dimensions: { width: 1, height: 1 }, pipeline_version: "0.4.0" },
    safety: { quality_gate_enforced: true, disclaimers: [], blocked_claims: [] },
    ...over,
  } as AnalysisResult;
}

function input(over: Partial<ComparisonInput>): ComparisonInput {
  return {
    prior_study_id: "p1", current_study_id: "c1",
    prior_eye: "OD", current_eye: "OD",
    prior_analysis: analysis({ findings: [] }),
    current_analysis: analysis({ findings: [] }),
    prior_device: null, current_device: null,
    ...over,
  };
}

describe("prior/current comparison guards", () => {
  it("refuses cross-eye comparison", () => {
    const out = comparePriorCurrent(input({ current_eye: "OS" }));
    expect(out.finding_states).toHaveLength(1);
    expect(out.finding_states[0].state).toBe("NOT_COMPARABLE");
    expect(out.dr_transition!.state).toBe("NOT_COMPARABLE");
  });

  it("flags missing prior evidence instead of calling everything new", () => {
    const out = comparePriorCurrent(input({
      current_analysis: analysis({ findings: [finding("f1", "retinal_hemorrhage")] }),
    }));
    expect(out.finding_states[0].state).toBe("MISSING_PRIOR_EVIDENCE");
    expect(out.finding_states[0].current_finding_id).toBe("f1");
  });

  it("flags model changes (id, version, or status)", () => {
    const cur = analysis({ findings: [finding("f1", "retinal_hemorrhage")] });
    cur.model_registry!.model_version = "other";
    const out = comparePriorCurrent(input({
      prior_analysis: analysis({ findings: [finding("f0", "retinal_hemorrhage")] }),
      current_analysis: cur,
    }));
    expect(out.finding_states[0].state).toBe("MODEL_CHANGED");
    expect(out.dr_transition!.state).toBe("MODEL_CHANGED");
  });

  it("flags device changes including unknown-vs-named", () => {
    const out = comparePriorCurrent(input({
      prior_analysis: analysis({ findings: [finding("f0", "retinal_hemorrhage")] }),
      current_analysis: analysis({ findings: [finding("f1", "retinal_hemorrhage")] }),
      current_device: { manufacturer: "Topcon", model: "NW400" },
    }));
    expect(out.finding_states[0].state).toBe("DEVICE_CHANGED");
  });

  it("reports NEW/PERSISTENT/CHANGED without progression language", () => {
    const out = comparePriorCurrent(input({
      prior_analysis: analysis({ findings: [finding("f0", "retinal_hemorrhage"), finding("f9", "hard_exudate")] }),
      current_analysis: analysis({ findings: [finding("f1", "retinal_hemorrhage"), finding("f2", "cotton_wool_spot")] }),
    }));
    const byType = Object.fromEntries(out.finding_states.map((s) => [s.finding_type, s.state]));
    expect(byType["retinal_hemorrhage"]).toBe("PERSISTENT");
    expect(byType["cotton_wool_spot"]).toBe("NEW");
    expect(byType["hard_exudate"]).toBe("CHANGED");
    expect(scanComparisonOutput(out)).toEqual([]);
  });

  it("reports DR grade transitions as TARGET_CLASS_CHANGED/PERSISTED with integers only", () => {
    const dr = (grade: number, label: string) => ({
      state: "GRADE_ESTIMATED" as const, grade, grade_label: label, model_score: 1.5,
      score_semantics: "MODEL_SCORE_NOT_CALIBRATED" as const, referable_dr: grade >= 2,
      calibration_state: "NOT_CALIBRATED" as const, quality_state: "pass",
      ood_state: "IN_DISTRIBUTION" as const, validation_state: "RESEARCH" as const,
      limitations: [], model_id: "fundus-dr-grading-effb0", model_version: "aa5741419b90",
    });
    const changed = comparePriorCurrent(input({
      prior_analysis: analysis({ findings: [], dr_assessment: dr(1, "mild_npdr") }),
      current_analysis: analysis({ findings: [], dr_assessment: dr(2, "moderate_npdr") }),
    }));
    expect(changed.dr_transition!.state).toBe("TARGET_CLASS_CHANGED");
    expect(changed.dr_transition!.grade_delta).toBe(1);
    expect(scanComparisonOutput(changed)).toEqual([]);
    const same = comparePriorCurrent(input({
      prior_analysis: analysis({ findings: [], dr_assessment: dr(0, "no_dr") }),
      current_analysis: analysis({ findings: [], dr_assessment: dr(0, "no_dr") }),
    }));
    expect(same.dr_transition!.state).toBe("TARGET_CLASS_PERSISTED");
  });

  it("reports OCT class transitions without resolved/improved language", () => {
    const oct = (cls: string, idx: number) => ({
      state: "CLASS_ESTIMATED" as const, predicted_class: cls, predicted_index: idx,
      model_scores: [0, 0, 0, 0], score_semantics: "MODEL_SCORE_NOT_CALIBRATED" as const,
      calibration_state: "NOT_CALIBRATED" as const, quality_state: "pass",
      ood_state: "IN_DISTRIBUTION" as const, validation_state: "RESEARCH" as const,
      limitations: [], model_id: "oct-retinal-weights-fp32", model_version: "hf-main-2026",
    });
    const out = comparePriorCurrent(input({
      prior_analysis: analysis({ findings: [], oct_assessment: oct("DME", 1) }),
      current_analysis: analysis({ findings: [], oct_assessment: oct("NORMAL", 3) }),
    }));
    expect(out.oct_transition!.state).toBe("TARGET_CLASS_CHANGED");
    expect(scanComparisonOutput(out)).toEqual([]);
  });

  it("always requires clinician review and carries limitations", () => {
    const out = comparePriorCurrent(input({}));
    expect(out.requires_clinician_review).toBe(true);
    expect(out.limitations.join(" ")).toMatch(/do not establish disease progression/i);
  });
});
