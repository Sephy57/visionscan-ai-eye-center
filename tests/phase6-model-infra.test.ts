import { describe, it, expect } from "vitest";
import { gateModelUse, ModelRecord, deviceCompatible } from "@/lib/models/registry";
import { convertRawModelOutputToFindings } from "@/lib/models/outputConversion";
import { validateRawModelOutput } from "@/lib/models/outputContract";
import { CalibrationRecord, applyCalibration, mayDisplayCalibrated, validateCalibrationRecord } from "@/lib/models/calibration";
import { registerCalibration, getCalibration, getActiveCalibrationForModel, listCalibrations } from "@/lib/models/calibrationRegistry";
import { runSafetyChecks } from "@/lib/clinical/safety";
import { validateAnalysisResult } from "@/lib/analysis/schema";
import { makeResult, makeFinding } from "./safety.test";
import { checkModelHealth } from "@/lib/models/provider";
import { ensureRegistryHydrated } from "@/lib/models/registryPersistence";

function makeTestModel(over: Partial<ModelRecord> = {}): ModelRecord {
  return {
    model_id: "phase6-test-model", model_name: "Phase 6 Test Model", version: "1.0.0",
    sha256: "a".repeat(64), format: "onnx", file_path: "phase6-test-model/model.onnx",
    modalities: ["FUNDUS"], supported_anatomy: ["retina"], supported_findings: ["retinal_hemorrhage"],
    intended_use: "test", contraindications: [], limitations: [],
    training_dataset: null, validation_dataset: null, patient_level_split: null,
    performance: { sensitivity: null, specificity: null, ppv: null, npv: null, auroc: null, auprc: null, calibration: null, evidence_reference: null },
    validation_date: "2026-01-01", external_validation_status: "none", clinical_validation_status: "none", regulatory_status: "none",
    status: "RESEARCH", devices: [{ manufacturer: "Topcon", model: "NW400" }],
    uses_symptoms: false, input_schema: "IMAGE_ONLY", supported_symptom_types: [],
    performance_with_symptoms: null, performance_without_symptoms: null, supported_conditions: [],
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Device compatibility as a real execution gate (not just informational)
// ---------------------------------------------------------------------------

describe("gateModelUse - device compatibility as an execution gate", () => {
  it("omitting device entirely (context-free call) does not check device compatibility", () => {
    const model = makeTestModel();
    const gate = gateModelUse(model); // no device arg at all
    expect(gate.reasons.some((r) => r.includes("Device compatibility"))).toBe(false);
  });

  it("passing a compatible device allows a non-DEMO model", () => {
    const model = makeTestModel();
    const gate = gateModelUse(model, { manufacturer: "Topcon", model: "NW400" });
    expect(gate.allowed).toBe(true);
  });

  it("passing an incompatible device HARD-BLOCKS a non-DEMO model", () => {
    const model = makeTestModel();
    const gate = gateModelUse(model, { manufacturer: "Zeiss", model: "Cirrus 6000" });
    expect(gate.allowed).toBe(false);
    expect(gate.reasons.some((r) => r.includes("Device compatibility"))).toBe(true);
  });

  it("passing null (no device metadata provided) HARD-BLOCKS a non-DEMO model with declared devices", () => {
    const model = makeTestModel();
    const gate = gateModelUse(model, null);
    expect(gate.allowed).toBe(false);
  });

  it("DEMO models are never subject to the device gate, regardless of device argument", () => {
    const demo = makeTestModel({ status: "DEMO", devices: [] });
    expect(gateModelUse(demo, null).allowed).toBe(true);
    expect(gateModelUse(demo, { manufacturer: "Anything", model: "Whatever" }).allowed).toBe(true);
  });

  it("deviceCompatible itself is unchanged and still used for the underlying check", () => {
    const model = makeTestModel();
    expect(deviceCompatible(model, { manufacturer: "Topcon", model: "NW400" }).compatible).toBe(true);
    expect(deviceCompatible(model, { manufacturer: "Zeiss", model: "Cirrus 6000" }).compatible).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Calibration registry
// ---------------------------------------------------------------------------

function makeCalibrationRecord(over: Partial<CalibrationRecord> = {}): CalibrationRecord {
  return {
    calibration_id: `cal_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    model_id: "phase6-test-model", model_version: "1.0.0",
    method: "platt_scaling", parameters: { a: 1, b: 0 },
    // Unique per call (not a fixed date) so getActiveCalibrationForModel's
    // "most recent by date" sort is never ambiguous against records this
    // shared, persisted-across-runs test file has registered previously
    // for the same model_id/version.
    calibration_dataset: "internal-val-v1", calibration_date: new Date().toISOString(),
    ece_after: 0.03, evidence_ref: "evd_test_1",
    ...over,
  };
}

describe("calibration registry", () => {
  it("registers a valid calibration record and can look it up by exact id", async () => {
    const rec = makeCalibrationRecord();
    await registerCalibration(rec);
    const found = await getCalibration(rec.calibration_id);
    expect(found?.calibration_id).toBe(rec.calibration_id);
  });

  it("getActiveCalibrationForModel returns the most recently registered record for that model/version", async () => {
    // Unique model_id per test run avoids any ambiguity with records this
    // shared, persisted store may already hold from a previous test run.
    const modelId = `cal-lookup-test-${Date.now()}`;
    const rec = makeCalibrationRecord({ model_id: modelId, calibration_id: `cal_${Date.now()}_a` });
    await registerCalibration(rec);
    const found = await getActiveCalibrationForModel(modelId, rec.model_version);
    expect(found?.calibration_id).toBe(rec.calibration_id);
  });

  it("refuses to register a record with no evidence reference", async () => {
    const rec = makeCalibrationRecord({ evidence_ref: "" });
    await expect(registerCalibration(rec)).rejects.toThrow(/evidence/i);
  });

  it("returns null for a model/version with no registered calibration", async () => {
    const found = await getActiveCalibrationForModel("no-such-model", "9.9.9");
    expect(found).toBeNull();
  });

  it("listCalibrations filters by model id", async () => {
    const rec = makeCalibrationRecord({ calibration_id: `cal_list_${Date.now()}` });
    await registerCalibration(rec);
    const list = await listCalibrations(rec.model_id);
    expect(list.some((c) => c.calibration_id === rec.calibration_id)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Raw output -> Finding[] conversion (the actual "plumbing")
// ---------------------------------------------------------------------------

describe("convertRawModelOutputToFindings", () => {
  const model = makeTestModel();

  it("fails closed on an output that doesn't pass the contract - no findings, not a best-effort parse", () => {
    const result = convertRawModelOutputToFindings({
      raw: { inference_status: "completed", findings: [{ finding_type: "x", confidence: 5 }] }, // out of bounds
      study_id: "study_1", model, calibration: null,
    });
    expect(result.ok).toBe(false);
    expect(result.findings).toEqual([]);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("a failed inference produces zero findings, not an error", () => {
    const result = convertRawModelOutputToFindings({
      raw: { inference_status: "failed", inference_error: "runtime crashed" },
      study_id: "study_1", model, calibration: null,
    });
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.notes[0]).toMatch(/runtime crashed/);
  });

  it("converts a valid completed output into Finding[] with raw confidence only (no calibration record)", () => {
    const result = convertRawModelOutputToFindings({
      raw: { inference_status: "completed", findings: [{ finding_type: "retinal_hemorrhage", confidence: 0.8, location: "macula" }] },
      study_id: "study_1", model, calibration: null,
    });
    expect(result.ok).toBe(true);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].confidence_raw).toBe(0.8);
    expect(result.findings[0].confidence_calibrated).toBeNull();
    expect(result.findings[0].synthetic).toBe(false);
    expect(result.findings[0].model_id).toBe(model.model_id);
  });

  it("applies calibration when a valid, evidence-backed record is supplied for a non-DEMO model", () => {
    const calibration = makeCalibrationRecord();
    const result = convertRawModelOutputToFindings({
      raw: { inference_status: "completed", findings: [{ finding_type: "retinal_hemorrhage", confidence: 0.8 }] },
      study_id: "study_1", model, calibration,
    });
    expect(result.findings[0].confidence_calibrated).not.toBeNull();
    expect(result.findings[0].confidence_calibrated).toBe(applyCalibration(calibration, 0.8).calibrated_probability);
  });

  it("NEVER trusts a calibration record for a DEMO-status model, even if one is (incorrectly) supplied", () => {
    const demoModel = makeTestModel({ status: "DEMO" });
    const calibration = makeCalibrationRecord({ model_id: demoModel.model_id });
    const result = convertRawModelOutputToFindings({
      raw: { inference_status: "completed", findings: [{ finding_type: "retinal_hemorrhage", confidence: 0.8 }] },
      study_id: "study_1", model: demoModel, calibration,
    });
    expect(result.findings[0].confidence_calibrated).toBeNull();
    expect(result.notes.some((n) => n.includes("not trusted"))).toBe(true);
  });

  it("withholds calibration when the record itself is invalid (defense in depth beyond registry-level validation)", () => {
    const badCalibration = makeCalibrationRecord({ evidence_ref: "" });
    expect(mayDisplayCalibrated(badCalibration)).toBe(false);
    const result = convertRawModelOutputToFindings({
      raw: { inference_status: "completed", findings: [{ finding_type: "retinal_hemorrhage", confidence: 0.8 }] },
      study_id: "study_1", model, calibration: badCalibration,
    });
    expect(result.findings[0].confidence_calibrated).toBeNull();
  });

  it("output contract itself already rejects findings on a failed inference (upstream honesty check)", () => {
    const v = validateRawModelOutput({ inference_status: "failed", findings: [{ finding_type: "x" }] });
    expect(v.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Safety validator: rules updated to permit a real non-DEMO model without
// weakening the DEMO guarantee
// ---------------------------------------------------------------------------

describe("safety validator - synthetic labeling adapted for non-DEMO models", () => {
  it("still REQUIRES synthetic=true for a DEMO-status finding (unchanged, hard rule)", () => {
    const res = makeResult({
      model_registry: { model_id: "demo-fundus-synthetic-v0", model_version: "0.1.0", model_status: "DEMO", display_label: "L", integrity_checks: [], device_compatibility: { compatible: false, note: "" }, model_input: "IMAGE_ONLY" },
      findings: [makeFinding({ synthetic: false, model_status: "DEMO" })],
    });
    const s = runSafetyChecks(res);
    expect(s.checks.find((c) => c.rule === "synthetic_findings_labeled")!.passed).toBe(false);
  });

  it("allows synthetic=false for a finding from a non-DEMO model", () => {
    const res = makeResult({
      model_registry: { model_id: "phase6-test-model", model_version: "1.0.0", model_status: "RESEARCH", display_label: null, integrity_checks: [], device_compatibility: { compatible: true, note: "" }, model_input: "IMAGE_ONLY" },
      findings: [makeFinding({ synthetic: false, model_status: "RESEARCH", model_id: "phase6-test-model" })],
      demo: { synthetic_result: false, label: "" },
    });
    const s = runSafetyChecks(res);
    expect(s.checks.find((c) => c.rule === "synthetic_findings_labeled")!.passed).toBe(true);
    expect(s.checks.find((c) => c.rule === "demo_label_present")!.passed).toBe(true);
  });

  it("schema validator also accepts a non-DEMO, non-synthetic finding", () => {
    const res = makeResult({
      findings: [makeFinding({ synthetic: false, model_status: "RESEARCH", model_id: "phase6-test-model" })],
      demo: { synthetic_result: false, label: "" },
    });
    expect(validateAnalysisResult(res).valid).toBe(true);
  });
});

describe("model health check (fails closed)", () => {
  it("reports unhealthy for a model id with no registered provider", async () => {
    const health = await checkModelHealth("no-such-model-at-all");
    expect(health.healthy).toBe(false);
    expect(health.steps[0].step).toBe("provider_lookup");
    expect(health.steps[0].passed).toBe(false);
  });

  it("the installed DEMO provider is healthy (load/validate/unload all succeed)", async () => {
    await ensureRegistryHydrated();
    const health = await checkModelHealth("demo-fundus-synthetic-v0");
    expect(health.healthy).toBe(true);
    expect(health.steps.map((s) => s.step)).toEqual(["provider_lookup", "load", "validate", "unload"]);
    expect(health.steps.every((s) => s.passed)).toBe(true);
  });
});

describe("safety validator - calibration honesty adapted for non-DEMO models", () => {
  it("still REJECTS calibrated confidence on a DEMO-status finding (unchanged, hard rule)", () => {
    const res = makeResult({
      findings: [makeFinding({ confidence_calibrated: 0.7, model_status: "DEMO" })],
    });
    const s = runSafetyChecks(res);
    expect(s.checks.find((c) => c.rule === "calibration_honesty")!.passed).toBe(false);
  });

  it("allows calibrated confidence on a finding from a non-DEMO model", () => {
    const res = makeResult({
      findings: [makeFinding({ confidence_calibrated: 0.7, model_status: "RESEARCH", model_id: "phase6-test-model" })],
    });
    const s = runSafetyChecks(res);
    expect(s.checks.find((c) => c.rule === "calibration_honesty")!.passed).toBe(true);
  });
});
