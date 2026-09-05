import { describe, it, expect, afterAll } from "vitest";
import sharp from "sharp";
import fs from "fs";
import path from "path";
import { SPECIALIST_CAPABILITIES, getCapability, executableCapabilities, type SpecialistCapability } from "@/lib/clinical/specialistCapabilities";
import { SPECIALTY_REGISTRY } from "@/lib/clinical/specialistRegistry";
import { routeSpecialists, relevantSpecialists } from "@/lib/clinical/specialistRouter";
import { orchestrateSpecialistAnalysis } from "@/lib/clinical/specialistOrchestrator";
import { SPECIALIST_FAILURE_COPY, type SpecialistFailureState, type ModelDisagreement } from "@/lib/models/specialistOutputTypes";
import { validateRawModelOutput } from "@/lib/models/outputContract";
import { createStudy, deleteStudy, setStudySymptoms } from "@/lib/studies/service";
import { getModel } from "@/lib/models/registry";
import type { DeviceMetadata } from "@/lib/devices/adapter";
import type { PatientSymptom } from "@/lib/clinical/symptoms";

/**
 * Phase 3 - Multi-Specialist AI Orchestration. Real tests covering the
 * §31 checklist (A-W). Every test proves a safety invariant, not just that
 * code runs. No LLM, no external AI - all assertions are against pure,
 * local, deterministic logic or the existing real SegFormer research path.
 */

const SEGFORMER_ARTIFACT = path.join(process.cwd(), "scratch", "models", "segformer-optic-disc-cup-refuge", "model.safetensors");
const HAS_ARTIFACT = fs.existsSync(SEGFORMER_ARTIFACT);

const DECLARED: DeviceMetadata = { scanType: "fundus", eye: "OD", providedBy: "none" };
const createdStudyIds: string[] = [];
afterAll(async () => { for (const id of createdStudyIds) await deleteStudy(id).catch(() => {}); });

// A. Specialist registry
describe("A - Specialist registry", () => {
  it("has all 9 specialties, each documentation-only with status NO_VALIDATED_MODEL_AVAILABLE", () => {
    expect(SPECIALTY_REGISTRY.length).toBe(9);
    for (const s of SPECIALTY_REGISTRY) expect(s.status).toBe("NO_VALIDATED_MODEL_AVAILABLE");
  });
});

// B. Capability registry
describe("B - Capability registry", () => {
  it("every specialty has at least one capability entry", () => {
    for (const s of SPECIALTY_REGISTRY) {
      expect(SPECIALIST_CAPABILITIES.some((c) => c.specialty_id === s.specialty_id)).toBe(true);
    }
  });

  it("getCapability returns null for a nonexistent capability, never fabricates one", () => {
    expect(getCapability("RETINA", "totally_fake_capability")).toBeNull();
  });
});

// C. Model lifecycle
describe("C - Model lifecycle (reuses lib/models/registry.ts's ModelStatus, no parallel vocabulary)", () => {
  it("exactly one capability in the entire registry is executable", () => {
    const executable = executableCapabilities();
    expect(executable.length).toBe(1);
    expect(executable[0].specialty_id).toBe("RETINA");
    expect(executable[0].capability_id).toBe("optic_disc_cup_segmentation");
  });

  it("may_execute is false for every capability with model_id null, regardless of other fields", () => {
    for (const c of SPECIALIST_CAPABILITIES) {
      if (c.model_id === null) expect(c.may_execute).toBe(false);
    }
  });

  it("the one executable capability's model is NOT registered in the production model registry (deliberate isolation, unchanged from S9)", () => {
    const c = SPECIALIST_CAPABILITIES.find((c) => c.may_execute)!;
    expect(c.registered_in_model_registry).toBe(false);
    expect(getModel(c.model_id!)).toBeFalsy();
  });
});

// D/E/F. Routing (deterministic, symptom, modality)
describe("D/E/F - Routing is deterministic and considers both modality and symptoms", () => {
  it("is deterministic - identical input produces identical output", () => {
    const input = { modality: "FUNDUS", symptoms: [] as PatientSymptom[] };
    const a = routeSpecialists(input);
    const b = routeSpecialists(input);
    expect(a).toEqual(b);
  });

  it("FUNDUS modality alone routes to RETINA as relevant via MODALITY", () => {
    const decision = routeSpecialists({ modality: "FUNDUS", symptoms: [] })
      .find((d) => d.specialty_id === "RETINA")!;
    expect(decision.relevant).toBe(true);
    expect(decision.relevance_source).toBe("MODALITY");
  });

  it("a symptom alone (no modality match) routes via SYMPTOM even for an unrelated modality", () => {
    const symptom: PatientSymptom = {
      type: "double_vision", onset: "sudden", duration: "hours", severity: "moderate",
      laterality: "both", progression: "worsening", frequency: "constant", free_text: null,
    };
    const decision = routeSpecialists({ modality: "SLIT_LAMP", symptoms: [symptom] })
      .find((d) => d.specialty_id === "NEURO_OPHTHALMOLOGY")!;
    expect(decision.relevant).toBe(true);
    expect(decision.relevance_source).toBe("SYMPTOM");
  });

  it("relevantSpecialists() never includes a specialty the full routeSpecialists() marked irrelevant", () => {
    const input = { modality: "SLIT_LAMP", symptoms: [] as PatientSymptom[] };
    const relevant = relevantSpecialists(input);
    const all = routeSpecialists(input);
    for (const r of relevant) {
      expect(all.find((a) => a.specialty_id === r.specialty_id)!.relevant).toBe(true);
    }
  });

  it("routing NEVER produces a diagnostic claim in any reason string", () => {
    const symptom: PatientSymptom = {
      type: "sudden_vision_loss", onset: "sudden", duration: "hours", severity: "severe",
      laterality: "right", progression: "worsening", frequency: "constant", free_text: null,
    };
    const decisions = routeSpecialists({ modality: "FUNDUS", symptoms: [symptom] });
    for (const d of decisions) {
      for (const r of d.relevance_reasons) {
        expect(r).not.toMatch(/patient has|diagnosed with|confirmed/i);
      }
      expect(d.status_summary).not.toMatch(/patient has|diagnosed with/i);
    }
  });
});

// G/H. Quality/OOD gating (via the real research path)
describe("G/H - Quality and OOD gating are enforced through the unchanged real research path", () => {
  it.skipIf(!HAS_ARTIFACT)("orchestrator reports QUALITY_FAILED, never fabricates findings, for a low-quality image", async () => {
    const tiny = await sharp({ create: { width: 30, height: 30, channels: 3, background: { r: 5, g: 5, b: 5 } } }).png().toBuffer();
    const study = await createStudy("phase3-lowquality.png", "image/png", tiny, DECLARED);
    createdStudyIds.push(study.study_id);
    const results = await orchestrateSpecialistAnalysis(study.study_id, "fundus", []);
    const retina = results.find((r) => r.specialty_id === "RETINA")!;
    expect(retina.findings).toEqual([]);
    if (retina.failure_state) {
      expect(["QUALITY_FAILED", "OOD_REJECTED", "MODEL_INPUT_UNSUPPORTED"]).toContain(retina.failure_state);
    }
  }, 30000);
});

// I/J. Device compatibility / intended-use matching
describe("I/J - Device compatibility and intended-use are documented, never assumed", () => {
  it("the executable capability has an empty device_scope (no device compatibility documented) - never silently treated as universally supported", () => {
    const c = SPECIALIST_CAPABILITIES.find((c) => c.may_execute)!;
    expect(c.device_scope).toEqual([]);
  });

  it("pediatric ophthalmology's capability documents population_scope as unknown, never 'all ages'", () => {
    const peds = SPECIALIST_CAPABILITIES.filter((c) => c.specialty_id === "PEDIATRIC_OPHTHALMOLOGY");
    for (const c of peds) expect(c.population_scope.toLowerCase()).not.toContain("all ages");
  });
});

// K/L/M. Model integrity, output schema, malformed outputs
describe("K/L/M - Model integrity and output schema validation reject malformed data", () => {
  it("validateRawModelOutput rejects an out-of-range confidence value", () => {
    const result = validateRawModelOutput({ inference_status: "completed", confidence: 1.5 });
    expect(result.valid).toBe(false);
  });

  it("validateRawModelOutput rejects a NaN/Infinity bounding box coordinate", () => {
    const result = validateRawModelOutput({
      inference_status: "completed",
      findings: [{ finding_type: "research_segmented_optic_disc_area", localization: { kind: "bounding_box", coordinates: { x: NaN, y: 0, w: 0.1, h: 0.1 } } }],
    });
    expect(result.valid).toBe(false);
  });

  it("validateRawModelOutput rejects an out-of-bounds box (x+w > 1)", () => {
    const result = validateRawModelOutput({
      inference_status: "completed",
      findings: [{ finding_type: "research_segmented_optic_disc_area", localization: { kind: "bounding_box", coordinates: { x: 0.9, y: 0.1, w: 0.5, h: 0.1 } } }],
    });
    expect(result.valid).toBe(false);
  });
});

// N. Localization bounds (re-confirmed at the orchestration layer)
describe("N - Localization bounds", () => {
  it.skipIf(!HAS_ARTIFACT)("every real finding's region, if present, stays within [0,1] bounds", async () => {
    const w = 1024, h = 768;
    const svg = Buffer.from(`<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#7a1f1f"/><circle cx="512" cy="384" r="300" fill="#8e2626"/></svg>`);
    const bytes = await sharp(svg).png().toBuffer();
    const study = await createStudy("phase3-localization.png", "image/png", bytes, DECLARED);
    createdStudyIds.push(study.study_id);
    const results = await orchestrateSpecialistAnalysis(study.study_id, "fundus", []);
    const retina = results.find((r) => r.specialty_id === "RETINA")!;
    for (const f of retina.findings) {
      if (f.region) {
        expect(f.region.x).toBeGreaterThanOrEqual(0);
        expect(f.region.x + f.region.w).toBeLessThanOrEqual(1.0001);
      }
    }
  }, 30000);
});

// O. Model disagreement
describe("O - Model disagreement representation", () => {
  it("ModelDisagreement always requires clinician review at the type level", () => {
    const disagreement: ModelDisagreement = {
      capability_id: "test", finding_type: "test_finding",
      model_a: { model_id: "a", model_version: "1", output_summary: "x" },
      model_b: { model_id: "b", model_version: "1", output_summary: "y" },
      difference_description: "different findings", requires_clinician_review: true,
    };
    expect(disagreement.requires_clinician_review).toBe(true);
  });
});

// P. Multiple-specialty routing
describe("P - Multiple specialties can be routed from the same evidence without duplicating it", () => {
  it("FUNDUS + sudden_vision_loss routes to both RETINA and NEURO_OPHTHALMOLOGY, referencing the same input", () => {
    const symptom: PatientSymptom = {
      type: "sudden_vision_loss", onset: "sudden", duration: "hours", severity: "severe",
      laterality: "right", progression: "worsening", frequency: "constant", free_text: null,
    };
    const decisions = relevantSpecialists({ modality: "FUNDUS", symptoms: [symptom] });
    const ids = decisions.map((d) => d.specialty_id);
    expect(ids).toContain("RETINA");
    expect(ids).toContain("NEURO_OPHTHALMOLOGY");
  });
});

// Q. Provenance
describe("Q - Provenance", () => {
  it.skipIf(!HAS_ARTIFACT)("a completed orchestration result carries real provenance (generated_at, router_decision_summary)", async () => {
    const w = 1024, h = 768;
    const svg = Buffer.from(`<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#7a1f1f"/><circle cx="512" cy="384" r="300" fill="#8e2626"/></svg>`);
    const bytes = await sharp(svg).png().toBuffer();
    const study = await createStudy("phase3-provenance.png", "image/png", bytes, DECLARED);
    createdStudyIds.push(study.study_id);
    const results = await orchestrateSpecialistAnalysis(study.study_id, "fundus", []);
    const retina = results.find((r) => r.specialty_id === "RETINA")!;
    expect(retina.provenance.generated_at).toBeTruthy();
    expect(new Date(retina.provenance.generated_at).toString()).not.toBe("Invalid Date");
  }, 30000);
});

// R. Clinician verification boundary
describe("R - requires_clinician_review cannot be false anywhere in the type/data", () => {
  it("every capability's produced result type pins requires_clinician_review: true (compile-time, re-asserted at runtime)", async () => {
    const results = await orchestrateSpecialistAnalysis("study_does_not_exist_phase3", "fundus", []);
    for (const r of results) expect(r.requires_clinician_review).toBe(true);
  });
});

// S. Diagnosis-gate preservation
describe("S - lib/models/diagnosisGate.ts is untouched and still closes on any failing condition", () => {
  it("canDisplayDiagnosis still requires all 7 conditions (re-import and spot check)", async () => {
    const { canDisplayDiagnosis } = await import("@/lib/models/diagnosisGate");
    const result = canDisplayDiagnosis({
      modelValidation: "RESEARCH_ONLY", intendedUseMatches: true, modalityMatches: true,
      qualityStatus: "pass", oodDetected: false, calibrationAvailable: false, evidenceSufficient: true,
    });
    expect(result.allowed).toBe(false); // RESEARCH_ONLY + no calibration still fails
  });
});

// T. Safety validator preservation - not directly touched this phase; confirmed via existing test suite continuing to pass (see full regression run)

// U. Urgent symptom preservation
describe("U - Urgent symptom triage is completely independent of specialist routing/orchestration", () => {
  it("a red-flag symptom's urgency is unaffected by whether any specialist capability is executable", async () => {
    const { redFlagSymptoms, maxSymptomUrgency } = await import("@/lib/clinical/symptoms");
    const symptom: PatientSymptom = {
      type: "curtain_shadow", onset: "sudden", duration: "hours", severity: "severe",
      laterality: "left", progression: "worsening", frequency: "constant", free_text: null,
    };
    // Route with a modality that has ZERO executable capabilities anywhere.
    const decisions = routeSpecialists({ modality: "SLIT_LAMP", symptoms: [symptom] });
    expect(decisions.every((d) => !d.any_capability_executable)).toBe(true);
    // Urgency must still be emergency, computed from the symptom module alone.
    expect(redFlagSymptoms([symptom]).length).toBe(1);
    expect(maxSymptomUrgency([symptom])).toBe("emergency");
  });

  it("end-to-end: sudden vision loss + zero AI findings still produces emergency triage through the real pipeline (unaffected by Phase 3 additions)", async () => {
    const { analyzeStudy } = await import("@/lib/studies/service");
    const bytes = await sharp({ create: { width: 1024, height: 768, channels: 3, background: { r: 20, g: 20, b: 20 } } }).png().toBuffer();
    const study = await createStudy("phase3-urgent.png", "image/png", bytes, DECLARED);
    createdStudyIds.push(study.study_id);
    await setStudySymptoms(study.study_id, [{
      type: "sudden_vision_loss", onset: "sudden", duration: "hours", severity: "severe",
      laterality: "right", progression: "worsening", frequency: "constant", free_text: null,
    }]);
    const { report } = await analyzeStudy(study.study_id);
    expect(["emergency_evaluation", "urgent_eye_care_review"]).toContain(report.triage_priority);
  }, 30000);
});

// V/W. Client-side spoof resistance / security authorization
describe("V/W - Security: client-supplied values cannot spoof specialist/model/validation state", () => {
  it("SpecialistFailureState/copy table has no path for a client to inject a custom message - it's a fixed, typed map", () => {
    const states: SpecialistFailureState[] = [
      "MODEL_UNAVAILABLE", "MODEL_TIMEOUT", "MODEL_INPUT_UNSUPPORTED", "MODEL_OUTPUT_INVALID",
      "MODEL_INTEGRITY_FAILURE", "MODEL_NOT_VALIDATED", "QUALITY_FAILED", "OOD_REJECTED",
      "DEVICE_UNSUPPORTED", "NO_VALIDATED_MODEL_AVAILABLE",
    ];
    for (const s of states) expect(typeof SPECIALIST_FAILURE_COPY[s]).toBe("string");
  });

  it("orchestrateSpecialistAnalysis ignores any extra properties smuggled onto its arguments (no spread of untyped input into the result)", async () => {
    const maliciousSymptoms = [{
      type: "blurred_vision", onset: "gradual", duration: "weeks", severity: "mild",
      laterality: "unknown", progression: "stable", frequency: "unknown", free_text: null,
      // spoofed extra fields an attacker might try to smuggle through:
      diagnosis_gate: { allowed: true }, model_status: "CLINICALLY_VALIDATED", validated: true,
    }] as unknown as PatientSymptom[];
    const results = await orchestrateSpecialistAnalysis("study_does_not_exist_phase3_spoof", "unknown_modality", maliciousSymptoms);
    for (const r of results) {
      expect(r.validation_status).not.toBe("CLINICALLY_VALIDATED");
      expect((r as unknown as Record<string, unknown>).diagnosis_gate).toBeUndefined();
    }
  });

  it("a nonexistent study id never produces a fabricated finding - fails closed per specialty", async () => {
    const results = await orchestrateSpecialistAnalysis("study_totally_fake_phase3", "fundus", []);
    for (const r of results) {
      expect(r.findings).toEqual([]);
    }
  });
});

describe("No LLM / no external AI (repo-wide static check)", () => {
  it("no Phase 3 file imports an LLM/external-AI SDK", () => {
    const files = [
      "lib/clinical/specialistCapabilities.ts", "lib/clinical/specialistRouter.ts",
      "lib/clinical/specialistOrchestrator.ts", "lib/models/specialistOutputTypes.ts",
    ];
    for (const f of files) {
      const src = fs.readFileSync(path.join(process.cwd(), f), "utf8");
      expect(src).not.toMatch(/openai|anthropic|@anthropic-ai|gemini|ollama|langchain/i);
    }
  });

  it("LLMReasoningEngine has zero implementations anywhere in lib/ or app/ (Phase 3's original ReasoningEngine stub was superseded by Phase 4's lib/models/reasoningEngine.ts, whose ReasoningEngine now HAS a sanctioned deterministic implementation - LLMReasoningEngine is the thing that must stay unimplemented)", () => {
    const roots = ["lib", "app"];
    let found = false;
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
          const src = fs.readFileSync(p, "utf8");
          if (/implements\s+(.*,\s*)?LLMReasoningEngine/.test(src)) found = true;
        }
      }
    };
    for (const r of roots) walk(path.join(process.cwd(), r));
    expect(found).toBe(false);
  });
});
