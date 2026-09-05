import { describe, it, expect } from "vitest";
import {
  validateSymptoms, redFlagSymptoms, maxSymptomUrgency, SYMPTOM_MAP, SYMPTOM_VOCABULARY,
  PatientSymptom,
} from "@/lib/clinical/symptoms";
import { correlateSymptoms } from "@/lib/clinical/correlation";
import { possibleConditions, CONDITION_MAP } from "@/lib/clinical/conditions";
import { runTriage } from "@/lib/clinical/triage";
import { symptomStratifiedEvaluation, BinaryCase } from "@/lib/research/metrics";
import { validateAnalysisResult } from "@/lib/analysis/schema";
import { runSafetyChecks } from "@/lib/clinical/safety";
import { syntheticDemoSymptom } from "@/lib/clinical/symptoms";
import { makeResult, makeFinding } from "./safety.test";

function symptom(over: Partial<PatientSymptom> = {}): PatientSymptom {
  return {
    type: "blurred_vision", onset: "gradual", duration: "weeks", severity: "moderate",
    laterality: "right", progression: "stable", frequency: "constant", free_text: null,
    ...over,
  };
}

const goodQualityCtx = { qualityAcceptable: true, qualityScore: 0.95, modelStatus: "DEMO", modelUsesSymptoms: false };

describe("symptom validation", () => {
  it("accepts a fully structured symptom", () => {
    const v = validateSymptoms([symptom()]);
    expect(v.valid).toBe(true);
    expect(v.symptoms[0].type).toBe("blurred_vision");
    expect(v.symptoms[0].laterality).toBe("right");
    expect(v.symptoms[0].onset).toBe("gradual");
    expect(v.symptoms[0].severity).toBe("moderate");
  });

  it("rejects unknown symptom types (never coerced)", () => {
    const v = validateSymptoms([{ type: "made_up_symptom", onset: "sudden", duration: "hours", severity: "mild", laterality: "left", progression: "stable", frequency: "unknown" }]);
    expect(v.valid).toBe(false);
    expect(v.errors[0].field).toBe("type");
  });

  it("rejects invalid onset / laterality / severity / duration values", () => {
    const base = symptom();
    for (const [field, bad] of [["onset", "instantly"], ["laterality", "middle"], ["severity", "extreme"], ["duration", "forever"], ["progression", "sideways"], ["frequency", "sometimes"]]) {
      const v = validateSymptoms([{ ...base, [field]: bad }]);
      expect(v.valid).toBe(false);
      expect(v.errors[0].field).toBe(field);
    }
  });

  it("truncates over-long free text", () => {
    const v = validateSymptoms([symptom({ free_text: "x".repeat(5000) })]);
    expect(v.valid).toBe(true);
    expect(v.symptoms[0].free_text!.length).toBeLessThanOrEqual(1000);
  });
});

describe("red-flag symptoms", () => {
  it("identifies configured red flags", () => {
    const flags = redFlagSymptoms([symptom({ type: "sudden_vision_loss" }), symptom({ type: "curtain_shadow" }), symptom({ type: "blurred_vision" })]);
    expect(flags.map((f) => f.type).sort()).toEqual(["curtain_shadow", "sudden_vision_loss"]);
  });

  it("ranks emergency above urgent", () => {
    expect(maxSymptomUrgency([symptom({ type: "new_floaters" })])).toBe("urgent");
    expect(maxSymptomUrgency([symptom({ type: "new_floaters" }), symptom({ type: "sudden_vision_loss" })])).toBe("emergency");
    expect(maxSymptomUrgency([symptom({ type: "blurred_vision" })])).toBe("none");
  });

  it("escalates triage for red-flag symptoms without naming a condition", () => {
    const t = runTriage({
      findings: [], qualityAcceptable: true, qualityScore: 0.95, uncertainty: 0.1,
      modality: "fundus", redFlagSymptoms: ["curtain_shadow"],
    });
    expect(t.priority).toBe("emergency_evaluation");
    expect(t.action.toLowerCase()).not.toContain("detachment");
    expect(t.rationale).toContain("does NOT name or imply any specific condition");
  });

  it("vocabulary marks every red flag with an urgency level", () => {
    for (const s of SYMPTOM_VOCABULARY) {
      if (s.red_flag) expect(["emergency", "urgent"]).toContain(s.urgency);
      else expect(s.urgency).toBe("none");
    }
  });
});

describe("symptom / finding correlation", () => {
  it("correlates when a related finding was actually detected", () => {
    const c = correlateSymptoms({
      ...goodQualityCtx,
      symptoms: [symptom({ type: "blurred_vision" })],
      findings: [makeFinding({ type: "retinal_thickening" })],
    });
    expect(c.items[0].state).toBe("correlated");
    expect(c.items[0].matched_finding_types).toContain("retinal_thickening");
    expect(c.items[0].note).toContain("cannot establish");
  });

  it("reports NOT EXPLAINED when findings exist but none match the symptom", () => {
    const c = correlateSymptoms({
      ...goodQualityCtx,
      symptoms: [symptom({ type: "blurred_vision" })],
      findings: [makeFinding({ type: "vessel_tortuosity" })],
    });
    expect(c.items[0].state).toBe("not_explained");
    expect(c.items[0].note).toContain("not explained");
  });

  it("is honest when no findings exist and the model is unvalidated (no normality claim)", () => {
    const c = correlateSymptoms({
      ...goodQualityCtx,
      symptoms: [symptom({ type: "floaters" })],
      findings: [],
    });
    expect(c.items[0].state).toBe("inconclusive");
    expect(c.items[0].note).toContain("cannot confirm or exclude a cause");
  });

  it("never allows symptoms to create findings (empty in -> empty out)", () => {
    const c = correlateSymptoms({
      ...goodQualityCtx,
      symptoms: [symptom({ type: "new_floaters" }), symptom({ type: "eye_pain" })],
      findings: [],
    });
    // Correlation only words relevance; it cannot generate finding objects.
    expect(c.items.every((i) => i.matched_finding_types.length === 0 || i.state === "correlated")).toBe(true);
    expect(c.model_input).toBe("IMAGE_ONLY");
  });

  it("red-flag symptom state is URGENT regardless of imaging", () => {
    const c = correlateSymptoms({
      ...goodQualityCtx,
      symptoms: [symptom({ type: "curtain_shadow" })],
      findings: [],
    });
    expect(c.state).toBe("urgent");
    expect(c.urgency).toBe("emergency");
    expect(c.items[0].note).toContain("Urgent ophthalmic assessment");
  });

  it("marks correlation as research-only", () => {
    const c = correlateSymptoms({ ...goodQualityCtx, symptoms: [symptom()], findings: [] });
    expect(c.label).toContain("RESEARCH CORRELATION");
  });

  it("image-only model honesty: model input declared IMAGE_ONLY", () => {
    const c = correlateSymptoms({ ...goodQualityCtx, symptoms: [symptom()], findings: [] });
    expect(c.model_input).toBe("IMAGE_ONLY");
    expect(c.notes.some((n) => n.includes("IMAGE ONLY"))).toBe(true);
  });

  it("correlation is empty/inconclusive without symptoms", () => {
    const c = correlateSymptoms({ ...goodQualityCtx, symptoms: [], findings: [] });
    expect(c.items).toHaveLength(0);
    expect(c.state).toBe("inconclusive");
  });
});

describe("condition taxonomy gates", () => {
  it("returns NO conditions for DEMO/unvalidated models even with matching findings", () => {
    const r = possibleConditions({
      supported_conditions: ["diabetic_retinopathy"],
      modality: "FUNDUS",
      modelStatus: "DEMO",
      hasValidationEvidence: false,
      findings: [{ type: "retinal_hemorrhage" }],
    });
    expect(r.conditions).toHaveLength(0);
    expect(r.note).toContain("not validated");
  });

  it("blocks conditions not registered on the model", () => {
    const r = possibleConditions({
      supported_conditions: [], // model supports nothing
      modality: "FUNDUS",
      modelStatus: "EXTERNALLY_VALIDATED",
      hasValidationEvidence: true,
      findings: [{ type: "retinal_hemorrhage" }],
    });
    expect(r.conditions).toHaveLength(0);
  });

  it("blocks modality-inappropriate conditions and finding-less inference", () => {
    const r = possibleConditions({
      supported_conditions: ["diabetic_macular_edema", "retinal_tear"],
      modality: "OCT",
      modelStatus: "CLINICALLY_VALIDATED",
      hasValidationEvidence: true,
      findings: [{ type: "retinal_hemorrhage" }], // unrelated to the OCT-supported condition
    });
    expect(r.conditions).toHaveLength(0);
  });

  it("surfaces conditions only with matching modality + findings + validation evidence", () => {
    const r = possibleConditions({
      supported_conditions: ["diabetic_retinopathy"],
      modality: "FUNDUS",
      modelStatus: "CLINICALLY_VALIDATED",
      hasValidationEvidence: true,
      findings: [{ type: "retinal_hemorrhage" }, { type: "microaneurysm_like_lesion" }],
    });
    expect(r.conditions).toHaveLength(1);
    expect(r.conditions[0].label).toBe("Diabetic retinopathy");
    expect(r.note).toContain("NOT an automated diagnosis");
  });

  it("condition vocabulary contains no diagnosis shortcuts for symptom-only inference", () => {
    // Every condition requires imaging finding evidence; none can be inferred from symptoms alone.
    for (const c of Object.values(CONDITION_MAP)) {
      const r = possibleConditions({
        supported_conditions: [c.id],
        modality: c.modalities[0],
        modelStatus: "CLINICALLY_VALIDATED",
        hasValidationEvidence: true,
        findings: [], // no imaging evidence
      });
      expect(r.conditions).toHaveLength(0);
    }
  });
});

describe("symptom-stratified evaluation", () => {
  it("compares with vs without symptom context", () => {
    const mk = (i: number, withS: boolean, y: 0 | 1, p: 0 | 1): BinaryCase => ({
      case_id: `c${i}`, y_true: y, y_pred: p, score: y === 1 ? 0.9 : 0.2,
      with_symptoms: withS,
    });
    const cases = [
      ...Array.from({ length: 20 }, (_, i) => mk(i, true, i % 2 === 0 ? 1 : 0, i % 2 === 0 ? 1 : 0)),
      ...Array.from({ length: 20 }, (_, i) => mk(100 + i, false, i % 2 === 0 ? 1 : 0, i % 2 === 0 ? 0 : 0)),
    ];
    const r = symptomStratifiedEvaluation(cases);
    expect(r.with_symptoms!.sensitivity).toBe(1);
    expect(r.without_symptoms!.sensitivity).toBe(0);
    expect(r.delta_notes.some((n) => n.includes("Sensitivity delta"))).toBe(true);
    expect(r.warning).toContain("Do not assume symptoms improve");
  });

  it("handles missing strata honestly", () => {
    const r = symptomStratifiedEvaluation([{ case_id: "x", y_true: 1, y_pred: 1 }]);
    expect(r.with_symptoms).toBeNull();
    expect(r.without_symptoms).toBeNull();
    expect(r.delta_notes[0]).toContain("Both strata require data");
  });
});

describe("safety: symptom causation blocking", () => {
  it("rejects symptom->finding causal wording in explanations", () => {
    const res = makeResult({
      findings: [makeFinding({ explanation: "Retinal tear detected because the patient reports floaters." })],
    });
    const s = runSafetyChecks(res);
    expect(s.ok).toBe(false);
    expect(s.checks.find((c) => c.rule === "no_symptom_driven_findings")!.passed).toBe(false);
  });

  it("allows careful non-causal wording", () => {
    const res = makeResult({
      findings: [makeFinding()],
      patient_context: { reported: true, symptoms: [], red_flags: [], note: "Patient-reported symptoms provide CONTEXT only. They do not create imaging findings and never establish a diagnosis." },
      symptom_correlation: {
        state: "correlated", urgency: "prompt",
        items: [{ symptom_type: "blurred_vision", symptom_label: "Blurred vision", state: "correlated", matched_finding_types: [], note: "may be relevant" }],
        notes: [], label: "RESEARCH CORRELATION - NOT CLINICALLY VALIDATED",
      },
    });
    expect(runSafetyChecks(res).ok).toBe(true);
  });

  it("blocks conditions displayed by DEMO models", () => {
    const res = makeResult({
      model_registry: { model_id: "demo", model_version: "1", model_status: "DEMO", display_label: "L", integrity_checks: [], device_compatibility: { compatible: false, note: "" }, model_input: "IMAGE_ONLY" },
      possible_conditions: { conditions: [{ id: "retinal_detachment", label: "Retinal detachment", matched_findings: ["x"], commonly_associated_symptoms: [], note: "" }], note: "n" },
    });
    const s = runSafetyChecks(res);
    expect(s.checks.find((c) => c.rule === "conditions_blocked_for_demo_models")!.passed).toBe(false);
  });

  it("rejects a result whose correlation label omits the research warning", () => {
    const res = makeResult({
      symptom_correlation: {
        state: "correlated", urgency: "prompt", items: [], notes: [],
        label: "CORRELATED", // missing NOT CLINICALLY VALIDATED
      },
    });
    const s = runSafetyChecks(res);
    expect(s.checks.find((c) => c.rule === "correlation_labeled_research")!.passed).toBe(false);
  });
});

describe("schema validation for symptom structures", () => {
  it("accepts a result with valid patient context + correlation", () => {
    const res = makeResult({
      patient_context: { reported: true, symptoms: [{ type: "blurred_vision", onset: "sudden", duration: "hours", severity: "severe", laterality: "right", progression: "worsening", frequency: "constant" }], red_flags: [], note: "Patient-reported symptoms provide CONTEXT only." },
      symptom_correlation: { state: "correlated", urgency: "prompt", items: [], notes: [], label: "RESEARCH CORRELATION - NOT CLINICALLY VALIDATED" },
    });
    expect(validateAnalysisResult(res).valid).toBe(true);
  });

  it("rejects an invalid correlation state", () => {
    const res = makeResult({
      symptom_correlation: { state: "definitely_correlated" as never, urgency: "prompt", items: [], notes: [], label: "RESEARCH CORRELATION - NOT CLINICALLY VALIDATED" },
    });
    expect(validateAnalysisResult(res).valid).toBe(false);
  });

  it("rejects conditions shown by a DEMO model at schema level", () => {
    const res = makeResult({
      model_registry: { model_id: "d", model_version: "1", model_status: "DEMO", display_label: "L", integrity_checks: [], device_compatibility: { compatible: false, note: "" }, model_input: "IMAGE_ONLY" },
      possible_conditions: { conditions: [{ id: "x", label: "X", matched_findings: [], commonly_associated_symptoms: [], note: "" }], note: "n" },
    });
    expect(validateAnalysisResult(res).valid).toBe(false);
  });
});

describe("demo isolation for symptoms", () => {
  it("synthetic symptom helper is clearly flagged and uses the real vocabulary", () => {
    const s = syntheticDemoSymptom();
    expect(s.synthetic).toBe(true);
    expect(SYMPTOM_MAP[s.type]).toBeDefined();
  });
});
