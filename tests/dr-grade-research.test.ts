import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { PROJECT_ROOT } from "@/lib/config";
import { getModel, gateModelUse, supportsModality } from "@/lib/models/registry";
import { verifyModelIntegrity } from "@/lib/models/integrity";
import { loadModelPackage, validateManifest } from "@/lib/models/package";
import {
  DR_GRADE_MODEL_ID,
  DR_GRADE_MODEL_VERSION,
  DR_GRADE_ARTIFACT_SHA256,
  DR_GRADE_PREPROCESSING_VERSION,
  validateDrGradeWorkerOutput,
} from "@/lib/models/drGradeContract";
import {
  DrGradeLocalProvider,
  drOutputToRaw,
  runDrGradeResearchAnalysis,
} from "@/lib/models/drGradeLocalProvider";
import { getProviderForModel } from "@/lib/models/provider";
import { resultFromResearchGrader } from "@/lib/models/drAssessment";
import type { NormalizedStudy } from "@/lib/devices/adapter";
import { activeProductionCoverage, coverageForModality } from "@/lib/models/ophthalmicCoverage";

/**
 * DR-grade research model: real local single-logit inference wired into the
 * live pipeline next to the lesion detector, with corroboration/disagreement
 * semantics and no diagnosis path. Worker tests skip (not fail) when the
 * installed package is absent (fresh checkout).
 */

const PKG_DIR = path.join(PROJECT_ROOT, "data", "models", DR_GRADE_MODEL_ID);
const HAS_PACKAGE =
  fs.existsSync(path.join(PKG_DIR, "manifest.json")) &&
  fs.existsSync(path.join(PKG_DIR, "model.safetensors"));
const VENV_PYTHON = path.join(
  PROJECT_ROOT,
  ".venv-ophthalmic",
  process.platform === "win32" ? "Scripts" : "bin",
  process.platform === "win32" ? "python.exe" : "python3"
);
const HAS_VENV = fs.existsSync(VENV_PYTHON);
const TEST_IMAGE = path.join(PROJECT_ROOT, "scratch", "test_images", "example_fundus.jpg");
const HAS_TEST_IMAGE = fs.existsSync(TEST_IMAGE);

function fundusStudy(): NormalizedStudy {
  return {
    studyId: "dr-test-study",
    modality: "fundus",
    eye: "unknown",
    source: "file_upload",
    metadata: { providedBy: "none" },
    files: [],
  };
}

describe("dr model package + registry", () => {
  it("is registered as RESEARCH with pinned artifact metadata", () => {
    const m = getModel(DR_GRADE_MODEL_ID);
    expect(m).toBeDefined();
    expect(m!.status).toBe("RESEARCH");
    expect(m!.version).toBe(DR_GRADE_MODEL_VERSION);
    expect(m!.sha256).toBe(DR_GRADE_ARTIFACT_SHA256);
    expect(m!.format).toBe("safetensors");
    expect(m!.modalities).toEqual(["FUNDUS"]);
    expect(m!.supported_findings).toEqual(["dr_grade_estimate"]);
    expect(m!.supported_conditions).toEqual([]);
    expect(m!.input_schema).toBe("IMAGE_ONLY");
    expect(m!.regulatory_status).toBe("research_only");
  });

  it("passes the context-free registry gate with the RESEARCH label", () => {
    const m = getModel(DR_GRADE_MODEL_ID)!;
    const gate = gateModelUse(m);
    expect(gate.allowed).toBe(true);
    expect(gate.findings_use).toBe("research_only");
    expect(gate.label).toContain("RESEARCH USE ONLY");
  });

  it("declares fundus support only", () => {
    const m = getModel(DR_GRADE_MODEL_ID)!;
    expect(supportsModality(m, "FUNDUS")).toBe(true);
    expect(supportsModality(m, "OCT")).toBe(false);
  });

  it("is reachable through the live provider registry as the real provider", () => {
    const p = getProviderForModel(DR_GRADE_MODEL_ID);
    expect(p).not.toBeNull();
    expect(p!).toBeInstanceOf(DrGradeLocalProvider);
  });

  it("coverage marks DR grading RESEARCH_PIPELINE, production stays empty", () => {
    const entries = coverageForModality("fundus").filter((e) => e.target_id === "dr_grade_estimate");
    expect(entries).toHaveLength(1);
    expect(entries[0].state).toBe("RESEARCH_PIPELINE");
    expect(entries[0].pipeline_enabled).toBe(true);
    expect(entries[0].production_available).toBe(false);
    expect(entries[0].calibration).toBe("NOT_CALIBRATED");
    expect(activeProductionCoverage()).toEqual([]);
  });
});

describe.skipIf(!HAS_PACKAGE)("dr installed package", () => {
  it("manifest validates and the artifact hash matches", () => {
    const raw = JSON.parse(fs.readFileSync(path.join(PKG_DIR, "manifest.json"), "utf8"));
    expect(validateManifest(raw).ok).toBe(true);
    expect(loadModelPackage(DR_GRADE_MODEL_ID).ok).toBe(true);
  });

  it("integrity verification trusts the installed artifact", () => {
    expect(verifyModelIntegrity(DR_GRADE_MODEL_ID).trusted).toBe(true);
  });

  it("detects a tampered artifact and refuses to trust it (restores afterwards)", () => {
    const artifact = path.join(PKG_DIR, "model.safetensors");
    const original = fs.readFileSync(artifact);
    try {
      const tampered = Buffer.from(original);
      tampered[tampered.length - 1] ^= 0xff;
      fs.writeFileSync(artifact, tampered);
      expect(loadModelPackage(DR_GRADE_MODEL_ID).ok).toBe(false);
      expect(verifyModelIntegrity(DR_GRADE_MODEL_ID).trusted).toBe(false);
    } finally {
      fs.writeFileSync(artifact, original);
    }
    expect(loadModelPackage(DR_GRADE_MODEL_ID).ok).toBe(true);
  });
});

describe("dr transport contract (no runtime needed)", () => {
  function validOutput(): Record<string, unknown> {
    return {
      inference_status: "completed",
      model_id: DR_GRADE_MODEL_ID,
      model_version: DR_GRADE_MODEL_VERSION,
      artifact_sha256: DR_GRADE_ARTIFACT_SHA256,
      image_id: "b".repeat(64),
      preprocessing_version: DR_GRADE_PREPROCESSING_VERSION,
      preprocessing_transform: {
        original: { width: 100, height: 100 },
        crop: { x: 1, y: 2, w: 90, h: 90 },
        model: { width: 512, height: 512 },
      },
      raw_logit: 2.3,
      score_semantics: "MODEL_SCORE_NOT_CALIBRATED",
      predicted_grade: 2,
      grade_label: "moderate_npdr",
      referable_dr: true,
      validation_status: "CANDIDATE_ONLY",
      calibration_state: "NOT_CALIBRATED",
      limitations: ["CANDIDATE_ONLY; no clinical or independent validation"],
    };
  }

  it("accepts a well-formed worker output", () => {
    expect(validateDrGradeWorkerOutput(validOutput()).valid).toBe(true);
  });

  it("rejects a tampered artifact hash", () => {
    const o = validOutput();
    o.artifact_sha256 = "0".repeat(64);
    expect(validateDrGradeWorkerOutput(o).valid).toBe(false);
  });

  it("rejects NaN/Infinity logits and out-of-range grades", () => {
    for (const bad of [{ raw_logit: NaN }, { raw_logit: Infinity }, { predicted_grade: 5 }, { predicted_grade: 1.5 }]) {
      const o = { ...validOutput(), ...bad };
      expect(validateDrGradeWorkerOutput(o).valid).toBe(false);
    }
  });

  it("rejects grade/logit/label/referable inconsistencies", () => {
    const gradeMismatch = validOutput(); gradeMismatch.predicted_grade = 3;
    expect(validateDrGradeWorkerOutput(gradeMismatch).valid).toBe(false);
    const labelMismatch = validOutput(); labelMismatch.grade_label = "mild_npdr";
    expect(validateDrGradeWorkerOutput(labelMismatch).valid).toBe(false);
    const refMismatch = validOutput(); refMismatch.referable_dr = false;
    expect(validateDrGradeWorkerOutput(refMismatch).valid).toBe(false);
  });

  it("rejects any calibration claim", () => {
    const o = validOutput();
    o.calibration_state = "CALIBRATED";
    expect(validateDrGradeWorkerOutput(o).valid).toBe(false);
    const o2 = validOutput();
    o2.score_semantics = "DIAGNOSTIC_CONFIDENCE";
    expect(validateDrGradeWorkerOutput(o2).valid).toBe(false);
  });

  it("maps the grade to RawModelOutput without inventing confidence", () => {
    const raw = drOutputToRaw(validOutput() as never, "study-1", "OS");
    expect(raw.inference_status).toBe("completed");
    expect(raw.findings).toHaveLength(1);
    expect(raw.findings![0].finding_type).toBe("dr_grade_estimate");
    expect(raw.findings![0].laterality).toBe("OS");
    expect(raw.findings![0].severity).toBe("indeterminate");
    expect(raw.findings![0].confidence).toBeUndefined();
    expect(raw.findings![0].calibrated_confidence).toBeUndefined();
    expect(raw.findings![0].evidence).toContain("2/4");
    expect(raw.findings![0].evidence).toContain("NOT a probability");
  });

  it("emits no finding for a grade-0 estimate (grade lives in dr_assessment only)", () => {
    const o = validOutput();
    o.raw_logit = -0.06;
    o.predicted_grade = 0;
    o.grade_label = "no_dr";
    o.referable_dr = false;
    expect(validateDrGradeWorkerOutput(o).valid).toBe(true);
    const raw = drOutputToRaw(o as never, "study-1", "unknown");
    expect(raw.inference_status).toBe("completed");
    expect(raw.findings).toEqual([]);
  });
});

describe("dr assessment layer (no runtime needed)", () => {
  function quality(status: string) {
    return {
      quality_score: 0.9, quality_status: status, detected_artifacts: [], affected_regions: [],
      recommended_reacquisition: false,
      metrics: { width: 1024, height: 768, sharpness_score: 0.8, illumination_mean: 120, illumination_p5: 30, illumination_p95: 230, highlight_clip_ratio: 0, shadow_clip_ratio: 0, colorfulness: 0.4, grayscale_only: false },
      thresholds: {}, limitations: [],
    } as never;
  }

  it("reports a grade-0 estimate as GRADE_ESTIMATED, never as no-DR", () => {
    const grade = {
      predicted_grade: 0, grade_label: "no_dr", raw_logit: -0.06, referable_dr: false,
      limitations: ["test"],
    } as never;
    const res = resultFromResearchGrader({
      grade, raw: { inference_status: "completed", limitations: [] } as never,
      quality: quality("pass"), ood: { detected: false, reasons: [] },
      modelId: DR_GRADE_MODEL_ID, modelVersion: DR_GRADE_MODEL_VERSION,
    });
    expect(res.state).toBe("GRADE_ESTIMATED");
    expect(res.grade).toBe(0);
    expect(res.calibration_state).toBe("NOT_CALIBRATED");
    expect(res.validation_state).toBe("RESEARCH");
    expect(JSON.stringify(res).toLowerCase()).not.toContain("no diabetic retinopathy");
    expect(JSON.stringify(res).toLowerCase()).not.toContain("normal fundus");
  });

  it("keeps quality/OOD precedence over a completed grade", () => {
    const grade = {
      predicted_grade: 4, grade_label: "proliferative_dr", raw_logit: 3.9, referable_dr: true,
      limitations: [],
    } as never;
    const raw = { inference_status: "completed", limitations: [] } as never;
    expect(resultFromResearchGrader({
      grade, raw, quality: quality("fail"), ood: { detected: false, reasons: [] },
      modelId: DR_GRADE_MODEL_ID, modelVersion: DR_GRADE_MODEL_VERSION,
    }).state).toBe("IMAGE_NOT_SUITABLE");
    expect(resultFromResearchGrader({
      grade, raw, quality: quality("pass"), ood: { detected: true, reasons: ["x"] },
      modelId: DR_GRADE_MODEL_ID, modelVersion: DR_GRADE_MODEL_VERSION,
    }).state).toBe("OUT_OF_DISTRIBUTION");
  });
});

describe("dr provider fail-closed paths (no runtime needed)", () => {
  it("refuses to run without image bytes", async () => {
    const p = new DrGradeLocalProvider();
    const out = await p.analyzeStudy(fundusStudy(), { qualityScore: 0.9, eye: "unknown" });
    expect(out.findings).toEqual([]);
    expect(out.notes.join(" ")).toContain("No image bytes");
  });

  it("refuses a non-fundus modality", async () => {
    const p = new DrGradeLocalProvider();
    const study = { ...fundusStudy(), modality: "oct" } as NormalizedStudy;
    const out = await p.analyzeStudy(study, { qualityScore: 0.9, eye: "unknown", imageBytes: Buffer.from([1, 2, 3]) });
    expect(out.findings).toEqual([]);
  });

  it("advertises research-only capabilities without localization", async () => {
    const p = new DrGradeLocalProvider();
    const caps = await p.getCapabilities();
    expect(caps.modalities).toEqual(["FUNDUS"]);
    expect(caps.supported_findings).toEqual(["dr_grade_estimate"]);
    expect(caps.supports_localization).toBe(false);
    expect(caps.calibration_available).toBe(false);
  });
});

describe.skipIf(!HAS_PACKAGE || !HAS_VENV || !HAS_TEST_IMAGE)("dr real-pixel inference", () => {
  it("estimates a real grade from real pixels with domain disclosure", async () => {
    const imageBytes = fs.readFileSync(TEST_IMAGE);
    const run = await runDrGradeResearchAnalysis(fundusStudy(), {
      qualityScore: 0.9, eye: "unknown", device: null, imageBytes,
    });
    expect(run.raw.inference_status).toBe("completed");
    expect(run.grade).not.toBeNull();
    // Deterministic worker output for the pinned engineering image.
    expect(run.grade!.predicted_grade).toBe(0);
    expect(run.grade!.referable_dr).toBe(false);
    // Grade 0 emits no finding (grade lives in dr_assessment only).
    expect(run.findings).toEqual([]);
    expect(run.notes.join(" ")).toContain("DOMAIN_VALIDATION_UNKNOWN");
  }, 180_000);
});

describe("diabetic retinal disease evidence pattern", () => {
  async function assess(items: Array<Record<string, unknown>>) {
    const { assessConditions } = await import("@/lib/evidence/synthesize");
    return assessConditions(items as never).filter((a) => a.condition_id === "diabetic_retinal_disease_pattern");
  }

  function item(id: string, source_type: string, category: string, trust_level = "UNVERIFIED"): Record<string, unknown> {
    return {
      id, study_id: "s1", source_type, source_id: `src_${id}`, category,
      laterality: "OD", laterality_source: "study_level", presence: "PRESENT",
      trust_level, conflict_ids: [], provenance: { source: "test" },
    };
  }

  it("multi-source unverified research evidence reaches at most POSSIBLE, never SUPPORTED", async () => {
    const results = await assess([
      item("e1", "AI_FINDING", "dr_grade_estimate"),
      item("e2", "AI_FINDING", "retinal_hemorrhage"),
      item("e3", "SYMPTOM", "blurred_vision"),
    ]);
    const od = results.find((r) => r.laterality === "OD")!;
    expect(od.state).toBe("POSSIBLE_CONDITION");
    expect(od.supporting_evidence_ids).toEqual(expect.arrayContaining(["e1", "e2", "e3"]));
  });

  it("stays POSSIBLE even with one verified item when independent-source threshold is unmet", async () => {
    const results = await assess([
      item("e1", "AI_FINDING", "dr_grade_estimate", "HUMAN_VERIFIED"),
      item("e2", "AI_FINDING", "retinal_hemorrhage"),
    ]);
    const od = results.find((r) => r.laterality === "OD")!;
    expect(od.state).toBe("POSSIBLE_CONDITION");
  });

  it("is INSUFFICIENT with no matching evidence and never leaks across eyes", async () => {
    const results = await assess([item("e1", "SYMPTOM", "blurred_vision")]);
    // Blurred vision alone is supportive: POSSIBLE for OD, INSUFFICIENT for OS.
    expect(results.find((r) => r.laterality === "OD")!.state).toBe("POSSIBLE_CONDITION");
    expect(results.find((r) => r.laterality === "OS")!.state).toBe("INSUFFICIENT_EVIDENCE");
    const empty = await assess([]);
    expect(empty.every((r) => r.state === "INSUFFICIENT_EVIDENCE")).toBe(true);
  });
});

describe.skipIf(!HAS_PACKAGE || !HAS_VENV || !HAS_TEST_IMAGE)("live pipeline dual-model path", () => {
  it("runs lesion + DR models, keeps disagreement visible and every safety boundary", async () => {
    const { runPipeline } = await import("@/lib/analysis/pipeline");
    const imageBytes = fs.readFileSync(TEST_IMAGE);
    const { analysis } = await runPipeline({ study: fundusStudy(), originalBytes: imageBytes });
    expect(analysis.model_registry?.model_status).toBe("RESEARCH");
    expect(analysis.demo.synthetic_result).toBe(false);
    // Lesion output intact.
    expect(analysis.fundus_abnormality?.state).toBe("SUSPICIOUS_ABNORMALITY");
    expect(analysis.findings.some((f) => f.type === "microaneurysm_like_lesion")).toBe(true);
    // DR output present with provenance (grade 0 lives in dr_assessment; no finding emitted).
    expect(analysis.dr_assessment?.state).toBe("GRADE_ESTIMATED");
    expect(analysis.dr_assessment?.grade).toBe(0);
    expect(analysis.dr_assessment?.referable_dr).toBe(false);
    expect(analysis.dr_assessment?.calibration_state).toBe("NOT_CALIBRATED");
    expect(analysis.findings.some((f) => f.type === "dr_grade_estimate")).toBe(false);
    // Disagreement between the MA-like region and the grade-0 estimate stays visible.
    expect(analysis.multi_model?.agreement).toBe("MODEL_DISAGREEMENT");
    expect(analysis.multi_model?.models.map((m) => m.model_id).sort()).toEqual(
      ["fundus-dr-grading-effb0", "fundus-lesions-clementp-unet-seresnext50"]
    );
    expect(analysis.multi_model?.notes.join(" ")).toContain("no automatic winner");
    // Safety boundaries hold on the dual path.
    expect(analysis.possible_conditions?.conditions ?? []).toEqual([]);
    expect(analysis.diagnosis_gate!.allowed).toBe(false);
    expect(analysis.recommendation.priority).not.toBe("routine_follow_up");
    const text = JSON.stringify(analysis).toLowerCase();
    expect(text).not.toContain("normal fundus");
    expect(text).not.toContain("no disease");
    expect(text).not.toContain("no diabetic retinopathy");
  }, 240_000);

  it("keeps the labeled DEMO path for modalities no research model claims", async () => {
    const { runPipeline } = await import("@/lib/analysis/pipeline");
    const imageBytes = fs.readFileSync(TEST_IMAGE);
    const study = { ...fundusStudy(), modality: "slit_lamp" } as NormalizedStudy;
    const { analysis } = await runPipeline({ study, originalBytes: imageBytes });
    expect(analysis.model_registry?.model_status).toBe("DEMO");
    expect(analysis.demo.synthetic_result).toBe(true);
    expect(analysis.dr_assessment?.state).toBe("OUT_OF_DISTRIBUTION");
  }, 120_000);
});
