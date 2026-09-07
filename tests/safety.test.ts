import { describe, it, expect } from "vitest";
import { validateAnalysisResult } from "@/lib/analysis/schema";
import { runTriage } from "@/lib/clinical/triage";
import { runSafetyChecks } from "@/lib/clinical/safety";
import { buildDemoFindings, pickDemoScenario } from "@/lib/analysis/findings";
import { runEnsemble, estimateUncertainty } from "@/lib/analysis/ensemble";
import { detectDicom } from "@/lib/imaging/dicom";
import { safeJoin } from "@/lib/config";
import { buildOverallResult, buildLimitations } from "@/lib/reports/generator";
import type { AnalysisResult, Finding } from "@/lib/analysis/schema";

export function makeFinding(over: Partial<Finding> = {}): Finding {
  return {
    id: "find_x",
    type: "possible_retinal_hemorrhage",
    location: "superior_temporal_retina",
    severity: "moderate",
    confidence: 0.7,
    confidence_category: "MODERATE CONFIDENCE",
    explanation: "Automated analysis identified a focal abnormal region consistent with a possible hemorrhagic abnormality. The underlying cause cannot be established from this automated analysis alone.",
    synthetic: true,
    model_id: "fundus-lesion-detector",
    ...over,
  };
}

export function makeResult(over: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    schema_version: "1.0.0",
    study: { study_id: "s1", modality: "fundus", eye: "OD", source: "file_upload", metadata_provenance: "none" },
    quality: { score: 0.9, acceptable: true, status: "pass", artifacts: [], affected_regions: [], recommended_reacquisition: false },
    segmentation: { implemented: false, note: "placeholder" },
    findings: [],
    uncertainty: { overall: 0.2, reasons: [] },
    recommendation: { priority: "routine_follow_up", action: "Routine follow-up.", rationale: "test" },
    ensemble: { performed: true, checks: [], note: "single model" },
    demo: { synthetic_result: true, label: "DEMO" },
    provenance: {
      models: [{ model_id: "x" }],
      ruleset_version: "r1",
      analyzed_at: new Date().toISOString(),
      input_dimensions: { width: 100, height: 100 },
      pipeline_version: "0.4.0",
    },
    safety: { quality_gate_enforced: true, disclaimers: ["d", "This result does not guarantee that no eye disease is present."], blocked_claims: [] },
    ...over,
  };
}

describe("structured schema validation", () => {
  it("accepts a valid result", () => {
    const r = validateAnalysisResult(makeResult());
    expect(r.valid).toBe(true);
  });

  it("rejects findings when quality gate failed", () => {
    const r = validateAnalysisResult(makeResult({ quality: { score: 0.2, acceptable: false, status: "fail", artifacts: ["blur"], affected_regions: [], recommended_reacquisition: true }, findings: [makeFinding()] }));
    expect(r.valid).toBe(false);
  });

  it("rejects out-of-bounds confidence", () => {
    const r = validateAnalysisResult(makeResult({ findings: [makeFinding({ confidence: 1.5 })] }));
    expect(r.valid).toBe(false);
  });

  it("rejects invalid confidence category", () => {
    const r = validateAnalysisResult(makeResult({ findings: [makeFinding({ confidence_category: "TOTALLY SURE" as Finding["confidence_category"] })] }));
    expect(r.valid).toBe(false);
  });
});

describe("triage engine (deterministic, conservative)", () => {
  it("escalates red-flag symptoms to emergency regardless of findings", () => {
    const t = runTriage({ findings: [], qualityAcceptable: true, qualityScore: 1, uncertainty: 0, modality: "fundus", redFlagSymptoms: ["sudden_vision_loss"] });
    expect(t.priority).toBe("emergency_evaluation");
  });

  it("blocks clinical interpretation when quality fails", () => {
    const t = runTriage({ findings: [], qualityAcceptable: false, qualityScore: 0.2, uncertainty: 0.5, modality: "fundus" });
    expect(t.priority).toBe("prompt_professional_review");
    expect(t.rationale).toContain("Quality gate failed");
  });

  it("escalates high-risk findings even with low confidence", () => {
    const lowConf = makeFinding({ confidence: 0.3, confidence_category: "INDETERMINATE" });
    const t = runTriage({ findings: [lowConf], qualityAcceptable: true, qualityScore: 0.95, uncertainty: 0.2, modality: "fundus" });
    expect(["prompt_professional_review", "urgent_eye_care_review"]).toContain(t.priority);
  });

  it("requires review for indeterminate findings", () => {
    const t = runTriage({ findings: [makeFinding({ type: "indeterminate_focal_hyperreflective_region", confidence: 0.5, confidence_category: "INDETERMINATE" })], qualityAcceptable: true, qualityScore: 0.95, uncertainty: 0.3, modality: "fundus" });
    expect(t.priority).not.toBe("routine_follow_up");
  });

  it("routine follow-up only for clean high-quality scans, with mandatory caveat", () => {
    const t = runTriage({
      findings: [], qualityAcceptable: true, qualityScore: 0.95, uncertainty: 0.1, modality: "fundus",
      generalDetector: { state: "NO_TARGET_ABNORMALITY_DETECTED", validation_state: "CLINICALLY_VALIDATED" },
    });
    expect(t.priority).toBe("routine_follow_up");
    expect(t.action).toContain("does not guarantee that no eye disease is present");
  });

  it("never converts a missing or unavailable broad detector into a normality claim", () => {
    const omitted = runTriage({ findings: [], qualityAcceptable: true, qualityScore: 0.95, uncertainty: 0.1, modality: "fundus" });
    const unavailable = runTriage({
      findings: [], qualityAcceptable: true, qualityScore: 0.95, uncertainty: 0.1, modality: "fundus",
      generalDetector: { state: "MODEL_UNAVAILABLE", validation_state: "MODEL_UNAVAILABLE" },
    });
    for (const outcome of [omitted, unavailable]) {
      expect(outcome.priority).toBe("prompt_professional_review");
      expect(outcome.action.toLowerCase()).not.toContain("no significant abnormality");
      expect(outcome.triggered_rules).toContain("general_detector_unavailable_prevents_normality_claim");
    }
  });

  it("keeps an unvalidated target-negative result out of the routine pathway", () => {
    const t = runTriage({
      findings: [], qualityAcceptable: true, qualityScore: 0.95, uncertainty: 0.1, modality: "fundus",
      generalDetector: { state: "NO_TARGET_ABNORMALITY_DETECTED", validation_state: "RESEARCH" },
    });
    expect(t.priority).toBe("prompt_professional_review");
    expect(t.triggered_rules).toContain("unvalidated_target_negative_requires_review");
  });
});

describe("ensemble & uncertainty", () => {
  it("caps high-risk findings when only one detector exists", () => {
    const out = runEnsemble([makeFinding({ confidence: 0.95, confidence_category: "HIGH CONFIDENCE" })]);
    expect(out.agreement).toBe("single_model");
    expect(out.cappedFindings[0].confidence).toBeLessThanOrEqual(0.75);
  });

  it("never claims cross-model agreement with one detector", () => {
    const out = runEnsemble([makeFinding()]);
    expect(out.agreement).not.toBe("agree");
  });

  it("uncertainty is high while components are placeholders", () => {
    const out = runEnsemble([makeFinding()]);
    const u = estimateUncertainty(0.9, out.cappedFindings, out);
    expect(u.overall).toBeGreaterThanOrEqual(0.4);
  });
});

describe("demo findings", () => {
  it("always marks findings synthetic", () => {
    for (let i = 0; i < 30; i++) {
      const f = buildDemoFindings(pickDemoScenario(Buffer.from([i, i * 7, i * 13])), 0.9);
      expect(f.every((x) => x.synthetic === true)).toBe(true);
      expect(f.every((x) => x.confidence <= 0.85)).toBe(true);
    }
  });

  it("never uses the phrase 'blood clot' (ambiguous vocabulary rule)", () => {
    const all = JSON.stringify(buildDemoFindings({ scenario: "vascular_indeterminate", seed: 1 }, 0.9));
    expect(all.toLowerCase()).not.toContain("blood clot");
  });
});

describe("safety checks", () => {
  it("flags missing demo labeling", () => {
    const res = makeResult({ findings: [makeFinding()], demo: { synthetic_result: false, label: "" } });
    const s = runSafetyChecks(res);
    expect(s.ok).toBe(false);
  });

  it("passes a compliant result", () => {
    const s = runSafetyChecks(makeResult());
    expect(s.ok).toBe(true);
  });
});

describe("report wording", () => {
  it("uses mandatory negative wording", () => {
    const r = makeResult({ findings: [] });
    expect(buildOverallResult(r)).toBe("NO TARGET ABNORMALITY IDENTIFIED BY THE AVAILABLE MODEL — OTHER ABNORMALITIES MAY STILL BE PRESENT");
    expect(buildLimitations(r).join(" ")).toContain("not a medical device");
  });

  it("reports insufficient quality as such", () => {
    const r = makeResult({ findings: [], quality: { score: 0.2, acceptable: false, status: "fail", artifacts: ["blur"], affected_regions: [], recommended_reacquisition: true } });
    expect(buildOverallResult(r)).toBe("IMAGE QUALITY INSUFFICIENT FOR RELIABLE AUTOMATED ANALYSIS");
  });
});

describe("dicom detection", () => {
  it("detects DICM magic", () => {
    const buf = Buffer.alloc(200, 0);
    buf.write("DICM", 128, "ascii");
    expect(detectDicom(buf).isDicom).toBe(true);
  });
  it("does not misclassify ordinary images", () => {
    const buf = Buffer.alloc(200, 1);
    expect(detectDicom(buf).isDicom).toBe(false);
  });
});

describe("path safety", () => {
  it("rejects path traversal", () => {
    expect(() => safeJoin("D:\\data", "..\\..\\Windows\\system32")).toThrow();
  });
  it("allows normal nested paths", () => {
    expect(() => safeJoin("D:\\data", "study1", "original.png")).not.toThrow();
  });
});
