import { describe, expect, it } from "vitest";
import { resultFromResearchDetector, unavailableFundusAbnormalityResult } from "@/lib/models/fundusAbnormality";
import { validateAnalysisResult } from "@/lib/analysis/schema";

const quality = { quality_score: 0.9, quality_status: "pass" as const, detected_artifacts: [], affected_regions: [], recommended_reacquisition: false, metrics: { width: 100, height: 100, sharpness_score: 1, illumination_mean: 1, illumination_p5: 1, illumination_p95: 1, highlight_clip_ratio: 0, shadow_clip_ratio: 0, colorfulness: 1, grayscale_only: false }, thresholds: {}, limitations: [] };
const ood = { detected: false, reasons: [] };

describe("fundus abnormality layer", () => {
  it("never represents an unavailable general detector as normal or a target-negative", () => {
    expect(unavailableFundusAbnormalityResult(quality, ood, "FUNDUS").state).toBe("MODEL_UNAVAILABLE");
  });

  it("blocks unsuitable and OOD images before inference", () => {
    expect(unavailableFundusAbnormalityResult({ ...quality, quality_status: "fail" }, ood, "FUNDUS").state).toBe("IMAGE_NOT_SUITABLE");
    expect(unavailableFundusAbnormalityResult(quality, { detected: true, reasons: ["not fundus"] }, "FUNDUS").state).toBe("OUT_OF_DISTRIBUTION");
    expect(unavailableFundusAbnormalityResult(quality, ood, "OCT").state).toBe("OUT_OF_DISTRIBUTION");
  });

  it("uses a real bounded localization as suspicious research evidence, not a disease diagnosis", () => {
    const r = resultFromResearchDetector({ raw: { inference_status: "completed", findings: [{ finding_type: "retinal_hemorrhage", confidence: 0.7, localization: { kind: "bounding_box", coordinates: { x: 0.1, y: 0.2, w: 0.3, h: 0.2 } } }] }, quality, ood, modelId: "research", modelVersion: "1", supportedFindingTypes: new Set(["retinal_hemorrhage"]) });
    expect(r.state).toBe("SUSPICIOUS_ABNORMALITY");
    expect(r.regions[0].finding_type).toBe("retinal_hemorrhage");
    expect(r.calibration_state).toBe("NOT_CALIBRATED");
  });

  it("does not fabricate a region from an unlocalized or invalid model output", () => {
    const r = resultFromResearchDetector({ raw: { inference_status: "completed", findings: [{ finding_type: "anything", localization: { kind: "bounding_box", coordinates: { x: 0.9, y: 0.2, w: 0.3, h: 0.2 } } }] }, quality, ood, modelId: "research", modelVersion: "1", supportedFindingTypes: new Set() });
    // An unusable box is a model fault, not a negative: it must never read as
    // "no target abnormality" (see fundus-overlay-restoration.test.ts).
    expect(r.state).toBe("MODEL_UNAVAILABLE");
    expect(r.regions).toEqual([]);
  });

  it("preserves a detector failure as unavailable rather than a no-finding result", () => {
    const r = resultFromResearchDetector({ raw: { inference_status: "failed", inference_error: "timeout" }, quality, ood, modelId: "research", modelVersion: "1", supportedFindingTypes: new Set() });
    expect(r.state).toBe("MODEL_UNAVAILABLE");
  });

  it("rejects tampered localization geometry in stored results", () => {
    const r = validateAnalysisResult({ schema_version: "1", study: { study_id: "s", eye: "unknown" }, quality: { score: .9, acceptable: true }, findings: [], uncertainty: { overall: .2 }, recommendation: { priority: "routine_follow_up" }, demo: {}, provenance: { models: [] }, fundus_abnormality: { ...unavailableFundusAbnormalityResult(quality, ood, "FUNDUS"), state: "SUSPICIOUS_ABNORMALITY", regions: [{ id: "x", finding_type: "other_suspicious_retinal_region", localization: { kind: "bounding_box", coordinates: { x: 0.9, y: 0, w: .2, h: .2 } }, source_model_id: "x", source_model_version: "1", raw_score: null, note: "x" }] } });
    expect(r.valid).toBe(false);
  });
});
