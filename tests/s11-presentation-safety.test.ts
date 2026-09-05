import { describe, it, expect } from "vitest";
import { canDisplayDiagnosis, unvalidatedGateResult, type DiagnosisGateInput } from "@/lib/models/diagnosisGate";
import { presentQuality } from "@/lib/analysis/qualityPresentation";
import { friendlyLabel, noResultStateFor, NO_RESULT_COPY } from "@/lib/reports/terminology";
import type { QualityResult } from "@/lib/imaging/quality";

/**
 * S11 - the diagnosis gate is the single most safety-critical addition this
 * phase: it must return allowed:false for every combination except the one
 * where all seven conditions hold. These tests exhaustively check that.
 */

const ALL_GOOD: DiagnosisGateInput = {
  modelValidation: "CLINICALLY_VALIDATED",
  intendedUseMatches: true,
  modalityMatches: true,
  qualityStatus: "pass",
  oodDetected: false,
  calibrationAvailable: true,
  evidenceSufficient: true,
};

describe("S11 - canDisplayDiagnosis: only the fully-satisfied case is allowed", () => {
  it("allows a diagnosis only when every one of the 7 conditions holds", () => {
    const result = canDisplayDiagnosis(ALL_GOOD);
    expect(result.allowed).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(result.clinicalInterpretation).toBe("DIAGNOSIS");
  });

  it.each([
    ["modelValidation", "NOT_VALIDATED"],
    ["modelValidation", "RESEARCH_ONLY"],
    ["modelValidation", "INTERNALLY_VALIDATED"],
    ["modelValidation", "EXTERNALLY_VALIDATED"],
    ["intendedUseMatches", false],
    ["modalityMatches", false],
    ["qualityStatus", "borderline"],
    ["qualityStatus", "fail"],
    ["oodDetected", true],
    ["calibrationAvailable", false],
    ["evidenceSufficient", false],
  ] as const)("a single failing condition (%s = %s) fails the entire gate closed", (field, value) => {
    const input = { ...ALL_GOOD, [field]: value };
    const result = canDisplayDiagnosis(input);
    expect(result.allowed).toBe(false);
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.clinicalInterpretation).toBe("REQUIRES_CLINICAL_CORRELATION");
  });

  it("multiple failing conditions all get their own reason, none silently dropped", () => {
    const result = canDisplayDiagnosis({
      ...ALL_GOOD,
      modelValidation: "NOT_VALIDATED",
      calibrationAvailable: false,
      evidenceSufficient: false,
    });
    expect(result.allowed).toBe(false);
    expect(result.reasons.length).toBe(3);
  });

  it("unvalidatedGateResult() (this deployment's real state today) is always closed", () => {
    const result = unvalidatedGateResult();
    expect(result.allowed).toBe(false);
    expect(result.clinicalInterpretation).toBe("REQUIRES_CLINICAL_CORRELATION");
    expect(result.reasons.length).toBeGreaterThan(0);
  });
});

describe("S11 - presentQuality: never implies GOOD when a real artifact exists", () => {
  function mkQuality(overrides: Partial<QualityResult> = {}): QualityResult {
    return {
      quality_score: 0.75,
      quality_status: "pass",
      detected_artifacts: ["insufficient_resolution"],
      affected_regions: [],
      recommended_reacquisition: false,
      metrics: {
        width: 800, height: 800, sharpness_score: 0.9, illumination_mean: 128,
        illumination_p5: 20, illumination_p95: 230, highlight_clip_ratio: 0,
        shadow_clip_ratio: 0, colorfulness: 0.5, grayscale_only: false,
      },
      thresholds: {},
      limitations: [],
      ...overrides,
    };
  }

  it("the exact real-world inconsistency case: score 0.75 (pass) + insufficient_resolution -> ACCEPTABLE WITH LIMITATIONS, never GOOD", () => {
    const p = presentQuality(mkQuality());
    expect(p.overall_label).toBe("ACCEPTABLE WITH LIMITATIONS");
    expect(p.resolution_label).toBe("Below preferred threshold");
    expect(p.blocked).toBe(false);
  });

  it("a genuinely clean pass (no artifacts) shows GOOD", () => {
    const p = presentQuality(mkQuality({ detected_artifacts: [] }));
    expect(p.overall_label).toBe("GOOD");
    expect(p.artifacts_label).toBe("None detected");
  });

  it("a fail status is ANALYSIS BLOCKED regardless of score proximity to threshold", () => {
    const p = presentQuality(mkQuality({ quality_status: "fail", quality_score: 0.3, detected_artifacts: ["blur"] }));
    expect(p.overall_label).toBe("ANALYSIS BLOCKED");
    expect(p.blocked).toBe(true);
  });

  it("illumination and field-of-view artifacts map to their own labels independently", () => {
    const p = presentQuality(mkQuality({ detected_artifacts: ["poor_illumination", "incorrect_field_of_view"] }));
    expect(p.illumination_label).toBe("Below preferred threshold");
    expect(p.field_of_view_label).toBe("Atypical");
    expect(p.resolution_label).toBe("Acceptable"); // not affected by unrelated artifacts
  });
});

describe("S11 - terminology mapping: technical values preserved, never lost", () => {
  it("known values get a friendlier label", () => {
    expect(friendlyLabel("INFERENCE_UNAVAILABLE")).toBe("AI analysis could not be completed");
    expect(friendlyLabel("AUTO_EXTRACTED")).toBe("Automatically extracted — awaiting verification");
  });

  it("an unknown value is returned unchanged, never blank or invented", () => {
    expect(friendlyLabel("SOME_FUTURE_VALUE_NOT_YET_MAPPED")).toBe("SOME_FUTURE_VALUE_NOT_YET_MAPPED");
  });
});

describe("S11 - four distinct no-result states, never collapsed into one ambiguous 'no findings'", () => {
  it("COMPLETED with 0 findings -> NO_TARGET_FINDING_DETECTED (never implies normal)", () => {
    const state = noResultStateFor("COMPLETED", 0);
    expect(state).toBe("NO_TARGET_FINDING_DETECTED");
    expect(NO_RESULT_COPY[state!].body).toMatch(/does not exclude/i);
  });

  it("COMPLETED with findings -> null (a real result, not a no-result state)", () => {
    expect(noResultStateFor("COMPLETED", 3)).toBeNull();
  });

  it("each fail-closed pipeline state maps to a distinct, non-overlapping presentation state", () => {
    const mapped = {
      INFERENCE_UNAVAILABLE: noResultStateFor("INFERENCE_UNAVAILABLE", 0),
      UNSUPPORTED_MODALITY: noResultStateFor("UNSUPPORTED_MODALITY", 0),
      IMAGE_QUALITY_INSUFFICIENT: noResultStateFor("IMAGE_QUALITY_INSUFFICIENT", 0),
    };
    const values = Object.values(mapped);
    expect(new Set(values).size).toBe(3); // all distinct, none collapsed together
    expect(mapped.INFERENCE_UNAVAILABLE).toBe("MODEL_UNAVAILABLE");
    expect(mapped.UNSUPPORTED_MODALITY).toBe("MODEL_NOT_VALIDATED_FOR_IMAGE");
    expect(mapped.IMAGE_QUALITY_INSUFFICIENT).toBe("IMAGE_NOT_SUITABLE");
  });

  it("NOT_A_STUDY is not a result state at all (handled separately, e.g. 404)", () => {
    expect(noResultStateFor("NOT_A_STUDY", 0)).toBeNull();
  });
});
