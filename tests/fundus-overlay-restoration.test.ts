import { describe, expect, it } from "vitest";
import { convertRawModelOutputToFindings } from "@/lib/models/outputConversion";
import type { ModelRecord } from "@/lib/models/registry";
import { resultFromResearchDetector, unavailableFundusAbnormalityResult, type FundusAbnormalityResult } from "@/lib/models/fundusAbnormality";
import { validateAnalysisResult } from "@/lib/analysis/schema";
import { boxCenter, boxToPercentStyle, clipToUnit, displaySizePx, isBoundedBox, labelPlacement, LABEL_MAX_PX, LABEL_MIN_PX, needsLocator, sameBox, sameRegion } from "@/lib/imaging/overlayGeometry";
import { resolveViewMode, selectionKeyFor } from "@/lib/imaging/viewerMode";
import { deriveViewerAnalysisState } from "@/lib/imaging/viewerAnalysisState";
import { NO_RESULT_COPY, noResultStateFor } from "@/lib/reports/terminology";

const quality = { quality_score: 0.9, quality_status: "pass" as const, detected_artifacts: [], affected_regions: [], recommended_reacquisition: false, metrics: { width: 100, height: 100, sharpness_score: 1, illumination_mean: 1, illumination_p5: 1, illumination_p95: 1, highlight_clip_ratio: 0, shadow_clip_ratio: 0, colorfulness: 1, grayscale_only: false }, thresholds: {}, limitations: [] };
const ood = { detected: false, reasons: [] };
const box = (x: number, y: number, w: number, h: number) => ({ kind: "bounding_box" as const, coordinates: { x, y, w, h } });

function model(model_id: string): ModelRecord {
  return {
    model_id, model_name: model_id, version: "1", sha256: "a".repeat(64), format: "onnx", file_path: `${model_id}/m.onnx`,
    modalities: ["FUNDUS"], supported_anatomy: ["retina"], supported_findings: ["retinal_hemorrhage"], intended_use: "test",
    contraindications: [], limitations: [], training_dataset: null, validation_dataset: null, patient_level_split: null,
    performance: { sensitivity: null, specificity: null, ppv: null, npv: null, auroc: null, auprc: null, calibration: null, evidence_reference: null },
    validation_date: "2026-01-01", external_validation_status: "none", clinical_validation_status: "none", regulatory_status: "none",
    status: "RESEARCH", devices: [], uses_symptoms: false, input_schema: "IMAGE_ONLY", supported_symptom_types: [],
    performance_with_symptoms: null, performance_without_symptoms: null, supported_conditions: [],
  };
}

describe("finding ids are unique across providers (regression: viewer list keys and review lookups)", () => {
  it("does not reuse an id when two models each emit their first finding", () => {
    const lesion = convertRawModelOutputToFindings({ raw: { inference_status: "completed", findings: [{ finding_type: "retinal_hemorrhage", localization: box(0.1, 0.1, 0.1, 0.1) }, { finding_type: "retinal_hemorrhage", localization: box(0.5, 0.5, 0.1, 0.1) }] }, study_id: "study_1", model: model("lesion-model"), calibration: null });
    const grade = convertRawModelOutputToFindings({ raw: { inference_status: "completed", findings: [{ finding_type: "dr_grade_estimate" }] }, study_id: "study_1", model: model("grade-model"), calibration: null });
    const ids = [...lesion.findings, ...grade.findings].map((f) => f.id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
  });
});

describe("fundus abnormality: invalid geometry never becomes a negative", () => {
  const run = (findings: Array<{ finding_type: string; localization: ReturnType<typeof box> }>) =>
    resultFromResearchDetector({ raw: { inference_status: "completed", findings }, quality, ood, modelId: "research", modelVersion: "1", supportedFindingTypes: new Set(["retinal_hemorrhage"]) });

  it("reports a model fault, not 'no target abnormality', when every returned region is unusable", () => {
    const r = run([{ finding_type: "retinal_hemorrhage", localization: box(0.9, 0.2, 0.3, 0.2) }]);
    expect(r.state).toBe("MODEL_UNAVAILABLE");
    expect(r.model_id).toBe("research");
    expect(r.regions).toEqual([]);
    expect(r.limitations[0]).toMatch(/without a usable box/);
  });

  it("treats a zero-area box as unusable rather than drawing or ignoring it", () => {
    const r = run([{ finding_type: "retinal_hemorrhage", localization: box(0.4, 0.4, 0, 0.1) }]);
    expect(r.state).toBe("MODEL_UNAVAILABLE");
    expect(r.regions).toEqual([]);
  });

  it("a box that starts at the image edge cannot clip to nothing", () => {
    const r = run([{ finding_type: "retinal_hemorrhage", localization: box(1, 0.4, 5e-5, 0.1) }]);
    expect(r.state).toBe("MODEL_UNAVAILABLE");
    expect(isBoundedBox({ x: 1, y: 0.4, w: 5e-5, h: 0.1 })).toBe(false);
  });

  it("findings that carry no box at all never turn into a negative either", () => {
    const unlocalized = resultFromResearchDetector({ raw: { inference_status: "completed", findings: [{ finding_type: "retinal_hemorrhage", confidence: 0.6 }] }, quality, ood, modelId: "research", modelVersion: "1", supportedFindingTypes: new Set(["retinal_hemorrhage"]) });
    expect(unlocalized.state).toBe("MODEL_UNAVAILABLE");
    expect(unlocalized.model_id).toBe("research");
    expect(unlocalized.limitations[0]).toMatch(/without a usable box/);
    // ...while a real mix keeps the placeable region and says what it left out
    const mixed = resultFromResearchDetector({ raw: { inference_status: "completed", findings: [{ finding_type: "retinal_hemorrhage", localization: box(0.1, 0.1, 0.2, 0.2) }, { finding_type: "retinal_hemorrhage", confidence: 0.6 }] }, quality, ood, modelId: "research", modelVersion: "1", supportedFindingTypes: new Set(["retinal_hemorrhage"]) });
    expect(mixed.state).toBe("SUSPICIOUS_ABNORMALITY");
    expect(mixed.regions).toHaveLength(1);
  });

  it("keeps valid regions and discloses the ones it had to drop", () => {
    const r = run([{ finding_type: "retinal_hemorrhage", localization: box(0.1, 0.1, 0.2, 0.2) }, { finding_type: "retinal_hemorrhage", localization: box(1.4, 0.1, 0.2, 0.2) }]);
    expect(r.state).toBe("SUSPICIOUS_ABNORMALITY");
    expect(r.regions).toHaveLength(1);
    expect(r.limitations.join(" ")).toMatch(/1 further finding was returned without a usable box/);
  });

  it("still reports a genuine empty result as no target abnormality", () => {
    const r = run([]);
    expect(r.state).toBe("NO_TARGET_ABNORMALITY_DETECTED");
  });

  it("clips only rounding noise at the image edge and stays schema-valid", () => {
    const r = run([{ finding_type: "retinal_hemorrhage", localization: box(0.6, 0.5, 0.4 + 5e-5, 0.1) }]);
    expect(r.regions).toHaveLength(1);
    const c = r.regions[0].localization.coordinates;
    expect(c.x + c.w).toBeLessThanOrEqual(1);
    expect(c.x).toBe(0.6);
  });

  it("an all-invalid result is a valid stored analysis (fails closed, not a schema error)", () => {
    const fundus = run([{ finding_type: "retinal_hemorrhage", localization: box(0.9, 0.2, 0.3, 0.2) }]);
    const res = validateAnalysisResult({ schema_version: "1", study: { study_id: "s", eye: "unknown" }, quality: { score: .9, acceptable: true }, findings: [], uncertainty: { overall: .2 }, recommendation: { priority: "routine_follow_up" }, demo: {}, provenance: { models: [] }, fundus_abnormality: fundus });
    expect(res.errors.filter((e) => e.path.startsWith("fundus_abnormality"))).toEqual([]);
  });
});

describe("overlay geometry", () => {
  it("accepts only finite, non-empty, in-image boxes", () => {
    expect(isBoundedBox({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 })).toBe(true);
    expect(isBoundedBox({ x: 0.9, y: 0, w: 0.2, h: 0.2 })).toBe(false);
    expect(isBoundedBox({ x: 0, y: 0, w: 0, h: 0.2 })).toBe(false);
    expect(isBoundedBox({ x: -0.1, y: 0, w: 0.2, h: 0.2 })).toBe(false);
    expect(isBoundedBox({ x: NaN, y: 0, w: 0.2, h: 0.2 })).toBe(false);
    expect(isBoundedBox(null)).toBe(false);
  });

  it("tolerates float rounding at the edge but never a real overshoot", () => {
    expect(isBoundedBox({ x: 0.6, y: 0, w: 0.4 + 1e-12, h: 0.1 })).toBe(true);
    expect(isBoundedBox({ x: 0.6, y: 0, w: 0.41, h: 0.1 })).toBe(false);
    const c = clipToUnit({ x: 0.6, y: 0, w: 0.4 + 5e-5, h: 0.1 });
    expect(c.x + c.w).toBeLessThanOrEqual(1);
  });

  it("positions in image-relative percent, so it scales with any viewport or zoom", () => {
    const css = boxToPercentStyle({ x: 0.5443, y: 0.9043, w: 0.0047, h: 0.0037 });
    expect(Object.values(css).every((v) => v.endsWith("%"))).toBe(true);
    expect([css.left, css.top, css.width, css.height].map(parseFloat)).toEqual([54.43, 90.43, 0.47, 0.37].map((n) => expect.closeTo(n, 6)));
    // the same fractions land on the same anatomy at two different displayed sizes
    const b = { x: 0.25, y: 0.5, w: 0.1, h: 0.2 };
    for (const size of [316, 477, 1200]) {
      const px = { left: b.x * size, width: b.w * size };
      expect(px.left / size).toBeCloseTo(0.25);
      expect(px.width / size).toBeCloseTo(0.1);
    }
  });

  it("finds the centre used for a locator ring", () => {
    expect(boxCenter({ x: 0.2, y: 0.4, w: 0.2, h: 0.1 })).toEqual({ x: 0.30000000000000004, y: 0.45 });
  });

  it("gives a locator ring to the real 7px microaneurysm box, but not to a visible hemorrhage", () => {
    const microaneurysm = { x: 0.544312270501836, y: 0.9043183904528764, w: 0.004679611000611983, h: 0.0037436888004895863 };
    const hemorrhage = { x: 0.489, y: 0.505, w: 0.287, h: 0.185 };
    for (const fitted of [{ w: 316, h: 316 }, { w: 477, h: 477 }]) {
      expect(displaySizePx(microaneurysm, fitted, 1).w).toBeLessThan(3);
      expect(needsLocator(microaneurysm, fitted, 1)).toBe(true);
      expect(needsLocator(hemorrhage, fitted, 1)).toBe(false);
    }
    // zooming in until it is visible removes the need for the ring
    expect(needsLocator(microaneurysm, { w: 477, h: 477 }, 8)).toBe(false);
    expect(needsLocator(microaneurysm, { w: 0, h: 0 }, 1)).toBe(false);
  });

  it("matches a finding region to its fundus localization by exact stored geometry", () => {
    const a = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 };
    expect(sameBox(a, { ...a })).toBe(true);
    expect(sameBox(a, { ...a, x: 0.1000001 })).toBe(false);
    expect(sameBox(a, null)).toBe(false);
  });
});

describe("matching a finding to its drawn region", () => {
  it("still matches when only the stored fundus region was clipped to the image edge", () => {
    const finding = { x: 0.6, y: 0.5, w: 0.4 + 5e-5, h: 0.1 };      // the model's box, with rounding noise
    const stored = clipToUnit(finding);                              // what the fundus layer persists
    expect(sameBox(finding, stored)).toBe(false);                    // exact comparison would split them
    expect(sameRegion(finding, stored)).toBe(true);
    expect(sameRegion(finding, { ...stored, x: 0.5 })).toBe(false);
    expect(sameRegion(null, stored)).toBe(false);
  });
});

describe("view mode: derived from what can be drawn, remembered per selection", () => {
  it("is Original whenever nothing can be drawn, whatever was chosen", () => {
    expect(resolveViewMode(false, { mode: "overlay", key: null }, null)).toBe("original");
    expect(resolveViewMode(false, { mode: "side_by_side", key: "a#1" }, "a#1")).toBe("original");
  });

  it("opens on the overlay when something can be drawn and nothing was chosen", () => {
    expect(resolveViewMode(true, null, null)).toBe("overlay");
  });

  it("keeps an explicit choice for the same selection", () => {
    expect(resolveViewMode(true, { mode: "original", key: null }, null)).toBe("original");
    expect(resolveViewMode(true, { mode: "side_by_side", key: "r1#0" }, "r1#0")).toBe("side_by_side");
  });

  it("'View on scan' returns to the overlay — for a new region, and for the same region asked again", () => {
    const original = { mode: "original" as const, key: selectionKeyFor("r1", null, 0) };
    expect(resolveViewMode(true, original, selectionKeyFor("r2", null, 1))).toBe("overlay");   // different region
    expect(resolveViewMode(true, original, selectionKeyFor("r1", null, 1))).toBe("overlay");   // same region, new request
    expect(resolveViewMode(true, original, selectionKeyFor("r1", null, 0))).toBe("original");  // no new request: the choice stands
  });

  it("A -> Original, B, A does not resurrect the stale choice", () => {
    const choice = { mode: "original" as const, key: selectionKeyFor("A", null, 1) };
    expect(resolveViewMode(true, choice, selectionKeyFor("B", null, 2))).toBe("overlay");
    expect(resolveViewMode(true, choice, selectionKeyFor("A", null, 3))).toBe("overlay");
  });

  it("keys a bare region by its geometry and has no key without a selection", () => {
    expect(selectionKeyFor(null, { x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, 2)).toBe("0.1,0.2,0.3,0.4#2");
    expect(selectionKeyFor(null, null, 5)).toBeNull();
  });
});

describe("label placement: never cut off by the pane edge", () => {
  const fitted = { w: 280, h: 280 };
  const base = { fitted, zoom: 1, offsetX: 0, ringed: false, paneWidth: 292 };

  it("uses the roomier side and caps the label to it on a narrow pane", () => {
    // a box just right of centre: preferred (left) room is small at 292px, so it must still fit
    const p = labelPlacement({ ...base, box: { x: 0.54, y: 0.9, w: 0.005, h: 0.004 } });
    expect(p.room).toBeLessThanOrEqual(LABEL_MAX_PX);
    expect(p.room).toBeGreaterThanOrEqual(LABEL_MIN_PX);
  });

  it("flips to the open side when the preferred side is cramped", () => {
    const nearRightEdge = labelPlacement({ ...base, paneWidth: 400, fitted: { w: 380, h: 380 }, box: { x: 0.9, y: 0.2, w: 0.05, h: 0.05 } });
    expect(nearRightEdge.end).toBe(true);                               // grows left, away from the edge
    const nearLeftEdge = labelPlacement({ ...base, paneWidth: 400, fitted: { w: 380, h: 380 }, box: { x: 0.02, y: 0.2, w: 0.05, h: 0.05 } });
    expect(nearLeftEdge.end).toBe(false);                               // grows right
    const roomyLeftOfCentre = labelPlacement({ ...base, paneWidth: 1000, fitted: { w: 900, h: 900 }, box: { x: 0.9, y: 0.2, w: 0.05, h: 0.05 } });
    expect(roomyLeftOfCentre.end).toBe(true);
  });

  it("accounts for pan and zoom, and for the ring offset", () => {
    const box = { x: 0.5, y: 0.2, w: 0.05, h: 0.05 };
    const centred = labelPlacement({ ...base, paneWidth: 600, fitted: { w: 560, h: 560 }, box });
    const panned = labelPlacement({ ...base, paneWidth: 600, fitted: { w: 560, h: 560 }, box, offsetX: 250 });
    expect(panned.room).toBeLessThanOrEqual(centred.room);
    const ringed = labelPlacement({ ...base, paneWidth: 300, fitted: { w: 280, h: 280 }, box: { x: 0.3, y: 0.2, w: 0.05, h: 0.05 }, ringed: true });
    const plain = labelPlacement({ ...base, paneWidth: 300, fitted: { w: 280, h: 280 }, box: { x: 0.3, y: 0.2, w: 0.05, h: 0.05 }, ringed: false });
    expect(ringed.room).toBeLessThanOrEqual(plain.room);
  });

  it("falls back to the default before the pane has been measured", () => {
    expect(labelPlacement({ ...base, paneWidth: 0, box: { x: 0.6, y: 0.2, w: 0.1, h: 0.1 } })).toEqual({ end: true, room: LABEL_MAX_PX });
  });
});

describe("no-result copy for the two backend failure states the panel used to leave blank", () => {
  it("maps model-output-invalid and integrity failure to their own explicit states", () => {
    expect(noResultStateFor("MODEL_OUTPUT_INVALID", 0)).toBe("MODEL_OUTPUT_INVALID");
    expect(noResultStateFor("MODEL_INTEGRITY_FAILURE", 0)).toBe("MODEL_INTEGRITY_FAILURE");
    for (const state of ["MODEL_OUTPUT_INVALID", "MODEL_INTEGRITY_FAILURE"] as const) {
      const copy = NO_RESULT_COPY[state];
      expect(copy.headline.length).toBeGreaterThan(5);
      expect(copy.body).toMatch(/no finding was inferred/i);
      expect(`${copy.headline} ${copy.body}`).not.toMatch(/(?<!not a )\bnormal\b(?!-fundus)/i);
    }
  });
});

describe("viewer analysis state: every non-signal outcome is explicit and none reads as normal", () => {
  const withFundus = (f: FundusAbnormalityResult, extra: object = {}) => deriveViewerAnalysisState({ analysis: { fundus_abnormality: f, ...extra }, modality: "FUNDUS", laterality: "OD" });
  const detected = (n: number) => resultFromResearchDetector({ raw: { inference_status: "completed", findings: Array.from({ length: n }, (_, i) => ({ finding_type: "retinal_hemorrhage", localization: box(0.1 + i * 0.2, 0.1, 0.1, 0.1) })) }, quality, ood, modelId: "lesion", modelVersion: "9", supportedFindingTypes: new Set(["retinal_hemorrhage"]) });

  it("signals found: counts regions and carries model/version/status provenance", () => {
    const s = withFundus(detected(3));
    expect(s.code).toBe("SIGNALS_FOUND");
    expect(s.regionCount).toBe(3);
    expect(s.headline).toMatch(/3 localized research signals/);
    expect(s.provenance).toEqual(expect.arrayContaining([{ label: "Model", value: "lesion" }, { label: "Version", value: "9" }, { label: "Status", value: "research" }, { label: "Eye", value: "OD" }]));
    expect(withFundus(detected(1)).headline).toMatch(/1 localized research signal found/);
  });

  it("no localized signals: executed, but never 'normal'", () => {
    const s = withFundus(detected(0));
    expect(s.code).toBe("NO_LOCALIZED_SIGNALS");
    expect(s.detail).toMatch(/not a normal-fundus result/);
    expect(s.regionCount).toBe(0);
  });

  it("model unavailable vs model failed are different states", () => {
    expect(withFundus(unavailableFundusAbnormalityResult(quality, ood, "FUNDUS")).code).toBe("MODEL_UNAVAILABLE");
    const failed = resultFromResearchDetector({ raw: { inference_status: "failed", inference_error: "timeout" }, quality, ood, modelId: "lesion", modelVersion: "9", supportedFindingTypes: new Set() });
    expect(withFundus(failed).code).toBe("MODEL_FAILED");
    expect(withFundus(unavailableFundusAbnormalityResult(quality, ood, "FUNDUS"), { analysis_mode: "MODEL_FAILED" }).code).toBe("MODEL_FAILED");
  });

  it("quality block and out-of-distribution draw nothing and say why", () => {
    const q = withFundus(unavailableFundusAbnormalityResult({ ...quality, quality_status: "fail" }, ood, "FUNDUS"));
    expect(q.code).toBe("IMAGE_QUALITY_INSUFFICIENT");
    expect(q.regionCount).toBe(0);
    expect(withFundus(unavailableFundusAbnormalityResult(quality, { detected: true, reasons: ["not fundus"] }, "FUNDUS")).code).toBe("OUT_OF_DISTRIBUTION");
  });

  it("analysis not run, unsupported modality and unvalidated image are explicit", () => {
    expect(deriveViewerAnalysisState({ analysis: null, modality: "FUNDUS" }).code).toBe("ANALYSIS_NOT_RUN");
    expect(deriveViewerAnalysisState({ analysis: { analysis_mode: "RESEARCH_MODEL_ANALYSIS" }, modality: "OCT" }).code).toBe("UNSUPPORTED_MODALITY");
    expect(deriveViewerAnalysisState({ analysis: {}, modality: "FUNDUS" }).code).toBe("ANALYSIS_NOT_RUN");
    const notValidated: FundusAbnormalityResult = { ...unavailableFundusAbnormalityResult(quality, ood, "FUNDUS"), state: "MODEL_NOT_VALIDATED_FOR_IMAGE" };
    expect(withFundus(notValidated).code).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("a suspicious state with no stored region is not drawn as signals", () => {
    const inconsistent: FundusAbnormalityResult = { ...detected(1), regions: [] };
    expect(withFundus(inconsistent).code).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("no state's copy ever claims a normal result", () => {
    const all = [
      withFundus(detected(0)), withFundus(detected(2)), withFundus(unavailableFundusAbnormalityResult(quality, ood, "FUNDUS")),
      withFundus(unavailableFundusAbnormalityResult({ ...quality, quality_status: "fail" }, ood, "FUNDUS")),
      deriveViewerAnalysisState({ analysis: null }), deriveViewerAnalysisState({ analysis: {}, modality: "OCT" }),
    ];
    for (const s of all) expect(`${s.headline} ${s.detail}`).not.toMatch(/(?<!not a )\bnormal\b(?!-fundus)/i);
  });

  it("omits provenance facts that are not stored instead of guessing them", () => {
    const s = deriveViewerAnalysisState({ analysis: null, modality: "FUNDUS", laterality: "unknown" });
    expect(s.provenance).toEqual([{ label: "Modality", value: "FUNDUS" }]);
  });
});
