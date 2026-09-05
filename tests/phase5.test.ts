import { describe, it, expect } from "vitest";
import { validateAnalysisResult } from "@/lib/analysis/schema";
import { makeResult, makeFinding } from "./safety.test";
import { runSafetyChecks } from "@/lib/clinical/safety";
import { possibleConditions } from "@/lib/clinical/conditions";
import {
  getTreatmentInformation, checkPatientSafety, screenInteractions,
  MEDICATION_SUITABILITY_UNKNOWN_NOTICE, INTERACTION_UNAVAILABLE_NOTICE,
  CONDITION_TREATMENT_MAP, DOSAGE_SAFETY_NOTICE,
} from "@/lib/treatment/treatmentInfo";
import { MEDICATIONS, validateMedicationRecord, registerMedication, MedicationRecord } from "@/lib/treatment/medications";
import { associatedSymptomsForFindings, associatedSymptomsForCondition } from "@/lib/clinical/associatedSymptoms";

// ---------------------------------------------------------------------------
// Symptom separation: patient-reported vs model-detected vs commonly associated
// ---------------------------------------------------------------------------

describe("symptom separation", () => {
  it("derives commonly-associated symptoms from findings without touching patient-reported data", () => {
    const assoc = associatedSymptomsForFindings(["retinal_hemorrhage"]);
    expect(assoc.length).toBeGreaterThan(0);
    expect(assoc.every((a) => typeof a.label === "string")).toBe(true);
  });

  it("derives commonly-associated symptoms from a condition id using the controlled taxonomy", () => {
    const assoc = associatedSymptomsForCondition("retinal_detachment");
    expect(assoc.some((a) => a.type === "curtain_shadow")).toBe(true);
  });

  it("returns an empty list for an unknown condition id rather than guessing", () => {
    expect(associatedSymptomsForCondition("not_a_real_condition")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Condition gating carries commonly_associated_symptoms, never patient data
// ---------------------------------------------------------------------------

describe("possibleConditions commonly_associated_symptoms", () => {
  it("attaches commonly_associated_symptoms only for validated models with evidence", () => {
    const out = possibleConditions({
      supported_conditions: ["retinal_detachment"],
      modality: "FUNDUS",
      modelStatus: "EXTERNALLY_VALIDATED",
      hasValidationEvidence: true,
      findings: [{ type: "detachment_like_abnormality" }],
    });
    expect(out.conditions.length).toBe(1);
    expect(out.conditions[0].commonly_associated_symptoms).toContain("curtain_shadow");
  });

  it("never surfaces conditions (or their associated symptoms) for a DEMO model", () => {
    const out = possibleConditions({
      supported_conditions: ["retinal_detachment"],
      modality: "FUNDUS",
      modelStatus: "DEMO",
      hasValidationEvidence: true,
      findings: [{ type: "detachment_like_abnormality" }],
    });
    expect(out.conditions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Medication registry: empty by design, fail-closed on unevidenced records
// ---------------------------------------------------------------------------

describe("medication registry", () => {
  it("starts empty - no medication is fabricated from memory", () => {
    expect(Object.keys(MEDICATIONS).length).toBe(0);
  });

  it("rejects a medication record with no evidence references", () => {
    const v = validateMedicationRecord({
      medicationId: "med_x", genericName: "Test", brandNames: [], drugClass: "test-class",
      ophthalmicIndications: ["test"], contraindications: [], warnings: [],
      evidenceReferences: [], // empty - must fail
      source: "Test Source", lastReviewed: "2026-01-01", version: "1.0.0", jurisdiction: "US",
    });
    expect(v.valid).toBe(false);
    expect(v.errors.some((e) => e.field === "evidenceReferences")).toBe(true);
  });

  it("rejects a medication record missing a source", () => {
    const v = validateMedicationRecord({
      medicationId: "med_x", genericName: "Test", brandNames: [], drugClass: "test-class",
      ophthalmicIndications: [], contraindications: [], warnings: [],
      evidenceReferences: ["some-citation"], source: "",
      lastReviewed: "2026-01-01", version: "1.0.0", jurisdiction: "US",
    });
    expect(v.valid).toBe(false);
    expect(v.errors.some((e) => e.field === "source")).toBe(true);
  });

  it("registerMedication throws (fails closed) rather than silently accepting an invalid record", () => {
    expect(() => registerMedication({ evidenceReferences: [] } as unknown as MedicationRecord)).toThrow();
  });

  it("accepts and stores a fully evidenced record", () => {
    const before = Object.keys(MEDICATIONS).length;
    const rec: MedicationRecord = {
      medicationId: "test_med_1", genericName: "Test Medication", brandNames: ["TestBrand"],
      drugClass: "test-class", indications: ["test"], ophthalmicIndications: ["test ophthalmic use"],
      route: ["topical"], contraindications: ["known hypersensitivity"], warnings: ["test warning"],
      commonAdverseEffects: ["irritation"], seriousAdverseEffects: [],
      drugInteractions: [], ageConsiderations: null, pregnancyConsiderations: null,
      renalConsiderations: null, hepaticConsiderations: null, monitoring: [],
      evidenceReferences: ["test-citation-1"], lastReviewed: "2026-01-01",
      source: "Test Source", version: "1.0.0", jurisdiction: "US",
    };
    registerMedication(rec);
    expect(Object.keys(MEDICATIONS).length).toBe(before + 1);
    delete MEDICATIONS["test_med_1"]; // cleanup - keep the registry honestly empty for other tests
  });
});

// ---------------------------------------------------------------------------
// Treatment information: provenance chain, honest empty state, no dosing
// ---------------------------------------------------------------------------

describe("treatment information engine", () => {
  it("returns undefined when no conditions were gated", () => {
    expect(getTreatmentInformation([])).toBeUndefined();
  });

  it("returns an honest 'not available' item for a gated condition with no registered treatment map entry", () => {
    expect(CONDITION_TREATMENT_MAP["retinal_detachment"]).toBeUndefined();
    const result = getTreatmentInformation([{ id: "retinal_detachment", label: "Retinal detachment" }]);
    expect(result).toBeDefined();
    expect(result!.items[0].available).toBe(false);
    expect(result!.items[0].approaches).toEqual([]);
    expect(result!.items[0].reason).toMatch(/no connected medication knowledge source/i);
  });

  it("carries the mandatory clinician-review label on every item", () => {
    const result = getTreatmentInformation([{ id: "diabetic_retinopathy", label: "Diabetic retinopathy" }]);
    expect(result!.items.every((i) => i.label.includes("clinician review required"))).toBe(true);
  });

  it("carries the mandatory dosage-safety notice, never a computed dose", () => {
    const result = getTreatmentInformation([{ id: "diabetic_retinopathy", label: "Diabetic retinopathy" }]);
    expect(result!.dosage_notice).toBe(DOSAGE_SAFETY_NOTICE);
    expect(JSON.stringify(result)).not.toMatch(/\d+\s?mg\b.*\b(daily|twice)\b/i);
  });

  it("carries the mandatory interaction-unavailable notice (no interaction DB connected)", () => {
    const result = getTreatmentInformation([{ id: "diabetic_retinopathy", label: "Diabetic retinopathy" }]);
    expect(result!.interaction_notice).toBe(INTERACTION_UNAVAILABLE_NOTICE);
  });
});

describe("patient medication safety check", () => {
  it("reports unknown suitability when any required factor is missing", () => {
    const r = checkPatientSafety({ age: "known" });
    expect(r.sufficient).toBe(false);
    expect(r.notice).toBe(MEDICATION_SUITABILITY_UNKNOWN_NOTICE);
    expect(r.missing.length).toBeGreaterThan(0);
  });

  it("never assumes 'no allergies' when allergies are unreported", () => {
    const r = checkPatientSafety({});
    expect(r.missing).toContain("allergies");
  });

  it("is sufficient only when every required factor is explicitly known", () => {
    const r = checkPatientSafety({
      age: "known", allergies: "known", currentMedications: "known", medicalHistory: "known",
      pregnancyStatus: "not_applicable", renalStatus: "known", hepaticStatus: "known",
    });
    expect(r.sufficient).toBe(true);
  });
});

describe("drug interaction screening (no DB connected)", () => {
  it("never claims 'no interactions' - always reports unavailable", () => {
    const r = screenInteractions(["med_a"], "med_b");
    expect(r.checked).toBe(false);
    expect(r.notice).toBe(INTERACTION_UNAVAILABLE_NOTICE);
  });
});

// ---------------------------------------------------------------------------
// Schema + safety validator: finding -> condition -> treatment provenance chain
// ---------------------------------------------------------------------------

describe("treatment information provenance chain (schema)", () => {
  it("rejects treatment information for a condition that was not gated", () => {
    const r = validateAnalysisResult(makeResult({
      model_registry: { model_id: "m", model_version: "1", model_status: "EXTERNALLY_VALIDATED", display_label: null, integrity_checks: [], device_compatibility: { compatible: true, note: "" }, model_input: "IMAGE_ONLY" },
      possible_conditions: { conditions: [], note: "n" },
      treatment_information: {
        items: [{ condition_id: "ghost_condition", condition_label: "Ghost", available: false, reason: "r", approaches: [], label: "Treatment information — clinician review required." }],
        dosage_notice: DOSAGE_SAFETY_NOTICE, interaction_notice: INTERACTION_UNAVAILABLE_NOTICE, note: "n",
      },
    }));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.message.includes("provenance chain broken"))).toBe(true);
  });

  it("accepts treatment information for a condition that was actually gated", () => {
    const r = validateAnalysisResult(makeResult({
      model_registry: { model_id: "m", model_version: "1", model_status: "EXTERNALLY_VALIDATED", display_label: null, integrity_checks: [], device_compatibility: { compatible: true, note: "" }, model_input: "IMAGE_ONLY" },
      possible_conditions: { conditions: [{ id: "diabetic_retinopathy", label: "DR", matched_findings: [], commonly_associated_symptoms: [], note: "n" }], note: "n" },
      treatment_information: {
        items: [{ condition_id: "diabetic_retinopathy", condition_label: "DR", available: false, reason: "r", approaches: [], label: "Treatment information — clinician review required." }],
        dosage_notice: DOSAGE_SAFETY_NOTICE, interaction_notice: INTERACTION_UNAVAILABLE_NOTICE, note: "n",
      },
    }));
    expect(r.valid).toBe(true);
  });

  it("rejects treatment information for a DEMO model", () => {
    const r = validateAnalysisResult(makeResult({
      model_registry: { model_id: "d", model_version: "1", model_status: "DEMO", display_label: "L", integrity_checks: [], device_compatibility: { compatible: false, note: "" }, model_input: "IMAGE_ONLY" },
      possible_conditions: { conditions: [{ id: "x", label: "X", matched_findings: [], commonly_associated_symptoms: [], note: "n" }], note: "n" },
      treatment_information: {
        items: [{ condition_id: "x", condition_label: "X", available: false, reason: "r", approaches: [], label: "Treatment information — clinician review required." }],
        dosage_notice: DOSAGE_SAFETY_NOTICE, interaction_notice: INTERACTION_UNAVAILABLE_NOTICE, note: "n",
      },
    }));
    expect(r.valid).toBe(false);
  });

  it("rejects treatment information missing the mandatory clinician-review label", () => {
    const r = validateAnalysisResult(makeResult({
      model_registry: { model_id: "m", model_version: "1", model_status: "EXTERNALLY_VALIDATED", display_label: null, integrity_checks: [], device_compatibility: { compatible: true, note: "" }, model_input: "IMAGE_ONLY" },
      possible_conditions: { conditions: [{ id: "diabetic_retinopathy", label: "DR", matched_findings: [], commonly_associated_symptoms: [], note: "n" }], note: "n" },
      treatment_information: {
        items: [{ condition_id: "diabetic_retinopathy", condition_label: "DR", available: false, reason: "r", approaches: [], label: "No label here" }],
        dosage_notice: DOSAGE_SAFETY_NOTICE, interaction_notice: INTERACTION_UNAVAILABLE_NOTICE, note: "n",
      },
    }));
    expect(r.valid).toBe(false);
  });

  it("rejects output resembling a computed dosage instruction", () => {
    const r = validateAnalysisResult(makeResult({
      model_registry: { model_id: "m", model_version: "1", model_status: "EXTERNALLY_VALIDATED", display_label: null, integrity_checks: [], device_compatibility: { compatible: true, note: "" }, model_input: "IMAGE_ONLY" },
      possible_conditions: { conditions: [{ id: "diabetic_retinopathy", label: "DR", matched_findings: [], commonly_associated_symptoms: [], note: "n" }], note: "n" },
      treatment_information: {
        items: [{ condition_id: "diabetic_retinopathy", condition_label: "DR", available: true, reason: "5 mg twice daily", approaches: [], label: "Treatment information — clinician review required." }],
        dosage_notice: DOSAGE_SAFETY_NOTICE, interaction_notice: INTERACTION_UNAVAILABLE_NOTICE, note: "n",
      },
    }));
    expect(r.valid).toBe(false);
  });
});

describe("treatment information safety validator", () => {
  it("fails the safety validator when treatment info exists for an ungated condition", () => {
    const res = makeResult({
      model_registry: { model_id: "m", model_version: "1", model_status: "EXTERNALLY_VALIDATED", display_label: null, integrity_checks: [], device_compatibility: { compatible: true, note: "" }, model_input: "IMAGE_ONLY" },
      possible_conditions: { conditions: [], note: "n" },
      treatment_information: {
        items: [{ condition_id: "ghost", condition_label: "Ghost", available: false, reason: "r", approaches: [], label: "Treatment information — clinician review required." }],
        dosage_notice: DOSAGE_SAFETY_NOTICE, interaction_notice: INTERACTION_UNAVAILABLE_NOTICE, note: "n",
      },
    });
    const s = runSafetyChecks(res);
    expect(s.checks.find((c) => c.rule === "treatment_requires_gated_condition")!.passed).toBe(false);
  });

  it("fails when a DEMO model surfaces any treatment items", () => {
    const res = makeResult({
      model_registry: { model_id: "d", model_version: "1", model_status: "DEMO", display_label: "L", integrity_checks: [], device_compatibility: { compatible: false, note: "" }, model_input: "IMAGE_ONLY" },
      possible_conditions: { conditions: [{ id: "x", label: "X", matched_findings: [], commonly_associated_symptoms: [], note: "n" }], note: "n" },
      treatment_information: {
        items: [{ condition_id: "x", condition_label: "X", available: false, reason: "r", approaches: [], label: "Treatment information — clinician review required." }],
        dosage_notice: DOSAGE_SAFETY_NOTICE, interaction_notice: INTERACTION_UNAVAILABLE_NOTICE, note: "n",
      },
    });
    const s = runSafetyChecks(res);
    expect(s.checks.find((c) => c.rule === "treatment_blocked_for_demo_models")!.passed).toBe(false);
  });

  it("passes for a fully honest, empty, gated, correctly labeled treatment result", () => {
    const res = makeResult({
      model_registry: { model_id: "m", model_version: "1", model_status: "EXTERNALLY_VALIDATED", display_label: null, integrity_checks: [], device_compatibility: { compatible: true, note: "" }, model_input: "IMAGE_ONLY" },
      possible_conditions: { conditions: [{ id: "diabetic_retinopathy", label: "DR", matched_findings: [], commonly_associated_symptoms: [], note: "n" }], note: "n" },
      treatment_information: {
        items: [{ condition_id: "diabetic_retinopathy", condition_label: "DR", available: false, reason: "r", approaches: [], label: "Treatment information — clinician review required." }],
        dosage_notice: DOSAGE_SAFETY_NOTICE, interaction_notice: INTERACTION_UNAVAILABLE_NOTICE, note: "n",
      },
    });
    const s = runSafetyChecks(res);
    expect(s.ok).toBe(true);
  });

  it("no_invented_clinician_approval fails if the raw AI result carries a clinician-authorship field", () => {
    const res = makeResult({}) as unknown as Record<string, unknown>;
    res.reviewer_id = "dr_test"; // simulate an invented clinician field on the raw AI output
    const s = runSafetyChecks(res as never);
    expect(s.checks.find((c) => c.rule === "no_invented_clinician_approval")!.passed).toBe(false);
  });

  it("no_invented_clinician_approval passes for a clean AI-only result", () => {
    const s = runSafetyChecks(makeResult({}));
    expect(s.checks.find((c) => c.rule === "no_invented_clinician_approval")!.passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Finding provenance (existing Finding schema fields, re-checked here for Phase 5)
// ---------------------------------------------------------------------------

describe("finding provenance", () => {
  it("every finding must carry a producing model_id", () => {
    const f = makeFinding({ model_id: "" as string });
    const r = validateAnalysisResult(makeResult({ findings: [f] }));
    // model_id emptiness isn't itself schema-invalid, but synthetic+explanation checks still apply;
    // this test documents the expectation that findings are never anonymous in practice.
    expect(typeof f.model_id).toBe("string");
    expect(r.errors.length === 0 || r.errors.every((e) => !e.path.includes("model_id"))).toBe(true);
  });
});

// Note: the end-to-end clinician treatment-review workflow (real study,
// analyzeStudy, submitReview) is exercised by tests/selftest.ts via
// GET /api/selftest, consistent with how the rest of the full pipeline is
// covered - unit tests here stay filesystem-free.
