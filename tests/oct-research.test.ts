import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { PROJECT_ROOT } from "@/lib/config";
import { getModel, gateModelUse, supportsModality } from "@/lib/models/registry";
import { verifyModelIntegrity } from "@/lib/models/integrity";
import { loadModelPackage, validateManifest } from "@/lib/models/package";
import {
  OCT_MODEL_ID,
  OCT_MODEL_VERSION,
  OCT_ARTIFACT_SHA256,
  OCT_PREPROCESSING_VERSION,
  validateOctWorkerOutput,
} from "@/lib/models/octContract";
import {
  OctLocalProvider,
  octOutputToRaw,
  runOctResearchAnalysis,
} from "@/lib/models/octLocalProvider";
import { getProviderForModel } from "@/lib/models/provider";
import { resultFromResearchOct } from "@/lib/models/octAssessment";
import type { NormalizedStudy } from "@/lib/devices/adapter";
import { activeProductionCoverage, coverageForModality } from "@/lib/models/ophthalmicCoverage";

/**
 * OCT retinal-class research model: real local ONNX inference wired into the
 * live pipeline for OCT studies. Classification-only: no localization is ever
 * produced and no overlay is rendered for this model. Worker tests skip (not
 * fail) when the installed package is absent (fresh checkout). OCT fixtures
 * are Kermany-test images (CC-BY-4.0, overlap-disclosed) saved under
 * gitignored scratch/test_images.
 */

const PKG_DIR = path.join(PROJECT_ROOT, "data", "models", OCT_MODEL_ID);
const HAS_PACKAGE =
  fs.existsSync(path.join(PKG_DIR, "manifest.json")) &&
  fs.existsSync(path.join(PKG_DIR, "human_eye_fp32.onnx"));
const VENV_PYTHON = path.join(
  PROJECT_ROOT,
  ".venv-ophthalmic",
  process.platform === "win32" ? "Scripts" : "bin",
  process.platform === "win32" ? "python.exe" : "python3"
);
const HAS_VENV = fs.existsSync(VENV_PYTHON);
const CNV_IMAGE = path.join(PROJECT_ROOT, "scratch", "test_images", "oct_kermany_0.png");
const NORMAL_IMAGE = path.join(PROJECT_ROOT, "scratch", "test_images", "oct_kermany_normal_pass.png");
const HAS_IMAGES = fs.existsSync(CNV_IMAGE) && fs.existsSync(NORMAL_IMAGE);

function octStudy(): NormalizedStudy {
  return {
    studyId: "oct-test-study",
    modality: "oct",
    eye: "unknown",
    source: "file_upload",
    metadata: { providedBy: "none" },
    files: [],
  };
}

describe("oct model package + registry", () => {
  it("is registered as RESEARCH with pinned artifact metadata", () => {
    const m = getModel(OCT_MODEL_ID);
    expect(m).toBeDefined();
    expect(m!.status).toBe("RESEARCH");
    expect(m!.version).toBe(OCT_MODEL_VERSION);
    expect(m!.sha256).toBe(OCT_ARTIFACT_SHA256);
    expect(m!.format).toBe("onnx");
    expect(m!.modalities).toEqual(["OCT"]);
    expect(m!.supported_findings).toEqual(["oct_retinal_class_estimate"]);
    expect(m!.supported_conditions).toEqual([]);
    expect(m!.input_schema).toBe("IMAGE_ONLY");
    expect(m!.regulatory_status).toBe("research_only");
  });

  it("passes the context-free registry gate with the RESEARCH label", () => {
    const m = getModel(OCT_MODEL_ID)!;
    const gate = gateModelUse(m);
    expect(gate.allowed).toBe(true);
    expect(gate.findings_use).toBe("research_only");
    expect(gate.label).toContain("RESEARCH USE ONLY");
  });

  it("declares OCT support only", () => {
    const m = getModel(OCT_MODEL_ID)!;
    expect(supportsModality(m, "OCT")).toBe(true);
    expect(supportsModality(m, "FUNDUS")).toBe(false);
  });

  it("is reachable through the live provider registry as the real provider", () => {
    const p = getProviderForModel(OCT_MODEL_ID);
    expect(p).not.toBeNull();
    expect(p!).toBeInstanceOf(OctLocalProvider);
  });

  it("coverage marks OCT classification RESEARCH_PIPELINE, production stays empty", () => {
    const entries = coverageForModality("oct").filter((e) => e.target_id === "oct_macular_classification");
    expect(entries).toHaveLength(1);
    expect(entries[0].state).toBe("RESEARCH_PIPELINE");
    expect(entries[0].pipeline_enabled).toBe(true);
    expect(entries[0].production_available).toBe(false);
    expect(entries[0].calibration).toBe("NOT_CALIBRATED");
    expect(activeProductionCoverage()).toEqual([]);
  });
});

describe.skipIf(!HAS_PACKAGE)("oct installed package", () => {
  it("manifest validates and the artifact hash matches", () => {
    const raw = JSON.parse(fs.readFileSync(path.join(PKG_DIR, "manifest.json"), "utf8"));
    expect(validateManifest(raw).ok).toBe(true);
    expect(loadModelPackage(OCT_MODEL_ID).ok).toBe(true);
  });

  it("integrity verification trusts the installed artifact", () => {
    expect(verifyModelIntegrity(OCT_MODEL_ID).trusted).toBe(true);
  });

  it("detects a tampered artifact and refuses to trust it (restores afterwards)", () => {
    const artifact = path.join(PKG_DIR, "human_eye_fp32.onnx");
    const original = fs.readFileSync(artifact);
    try {
      const tampered = Buffer.from(original);
      tampered[tampered.length - 1] ^= 0xff;
      fs.writeFileSync(artifact, tampered);
      expect(loadModelPackage(OCT_MODEL_ID).ok).toBe(false);
      expect(verifyModelIntegrity(OCT_MODEL_ID).trusted).toBe(false);
    } finally {
      fs.writeFileSync(artifact, original);
    }
    expect(loadModelPackage(OCT_MODEL_ID).ok).toBe(true);
  });
});

describe("oct transport contract (no runtime needed)", () => {
  function validOutput(): Record<string, unknown> {
    return {
      inference_status: "completed",
      model_id: OCT_MODEL_ID,
      model_version: OCT_MODEL_VERSION,
      artifact_sha256: OCT_ARTIFACT_SHA256,
      image_id: "c".repeat(64),
      preprocessing_version: OCT_PREPROCESSING_VERSION,
      raw_logits: [0.1, 2.5, 0.3, 0.2],
      score_semantics: "MODEL_SCORE_NOT_CALIBRATED",
      predicted_class: "DME",
      predicted_index: 1,
      reported_temperature: 1.05042436,
      temperature_applied: false,
      validation_status: "CANDIDATE_ONLY",
      calibration_state: "NOT_CALIBRATED",
      limitations: ["CANDIDATE_ONLY; no clinical or independent validation"],
    };
  }

  it("accepts a well-formed worker output", () => {
    expect(validateOctWorkerOutput(validOutput()).valid).toBe(true);
  });

  it("rejects a tampered artifact hash", () => {
    const o = validOutput();
    o.artifact_sha256 = "0".repeat(64);
    expect(validateOctWorkerOutput(o).valid).toBe(false);
  });

  it("rejects NaN/Infinity logits and argmax inconsistencies", () => {
    const nan = validOutput(); nan.raw_logits = [NaN, 0, 0, 0];
    expect(validateOctWorkerOutput(nan).valid).toBe(false);
    const wrong = validOutput(); wrong.predicted_index = 2;
    expect(validateOctWorkerOutput(wrong).valid).toBe(false);
    const wrongClass = validOutput(); wrongClass.predicted_class = "CNV";
    expect(validateOctWorkerOutput(wrongClass).valid).toBe(false);
  });

  it("rejects any calibration claim or silently applied temperature", () => {
    const o = validOutput();
    o.calibration_state = "CALIBRATED";
    expect(validateOctWorkerOutput(o).valid).toBe(false);
    const o2 = validOutput();
    o2.score_semantics = "DIAGNOSTIC_CONFIDENCE";
    expect(validateOctWorkerOutput(o2).valid).toBe(false);
    const o3 = validOutput();
    o3.temperature_applied = true;
    expect(validateOctWorkerOutput(o3).valid).toBe(false);
  });

  it("maps a disease class to RawModelOutput without inventing confidence", () => {
    const raw = octOutputToRaw(validOutput() as never, "study-1", "OD");
    expect(raw.inference_status).toBe("completed");
    expect(raw.findings).toHaveLength(1);
    expect(raw.findings![0].finding_type).toBe("oct_retinal_class_estimate");
    expect(raw.findings![0].laterality).toBe("OD");
    expect(raw.findings![0].confidence).toBeUndefined();
    expect(raw.findings![0].calibrated_confidence).toBeUndefined();
    expect(raw.findings![0].evidence).toContain("DME");
    expect(raw.findings![0].evidence).toContain("NOT probabilities");
  });

  it("emits no finding for a NORMAL estimate", () => {
    const o = validOutput();
    o.raw_logits = [0.01, 0.02, 0.03, 0.94];
    o.predicted_class = "NORMAL";
    o.predicted_index = 3;
    expect(validateOctWorkerOutput(o).valid).toBe(true);
    expect(octOutputToRaw(o as never, "study-1", "unknown").findings).toEqual([]);
  });
});

describe("oct assessment layer (no runtime needed)", () => {
  function quality(status: string) {
    return {
      quality_score: 0.8, quality_status: status, detected_artifacts: [], affected_regions: [],
      recommended_reacquisition: false,
      metrics: { width: 1024, height: 496, sharpness_score: 0.7, illumination_mean: 100, illumination_p5: 20, illumination_p95: 230, highlight_clip_ratio: 0, shadow_clip_ratio: 0, colorfulness: 0.1, grayscale_only: true },
      thresholds: {}, limitations: [],
    } as never;
  }

  it("reports a NORMAL estimate as CLASS_ESTIMATED, never as healthy", () => {
    const oct = {
      predicted_class: "NORMAL", predicted_index: 3, raw_logits: [0.01, 0.02, 0.03, 0.94],
      limitations: ["test"],
    } as never;
    const res = resultFromResearchOct({
      oct, raw: { inference_status: "completed", limitations: [] } as never,
      quality: quality("pass"), ood: { detected: false, reasons: [] },
      modelId: OCT_MODEL_ID, modelVersion: OCT_MODEL_VERSION,
    });
    expect(res.state).toBe("CLASS_ESTIMATED");
    expect(res.predicted_class).toBe("NORMAL");
    expect(res.calibration_state).toBe("NOT_CALIBRATED");
    expect(res.validation_state).toBe("RESEARCH");
    expect(JSON.stringify(res).toLowerCase()).not.toContain("healthy");
    expect(JSON.stringify(res).toLowerCase()).not.toContain("no disease");
  });

  it("keeps quality/OOD precedence over a completed class", () => {
    const oct = {
      predicted_class: "CNV", predicted_index: 0, raw_logits: [0.97, 0.01, 0.01, 0.01],
      limitations: [],
    } as never;
    const raw = { inference_status: "completed", limitations: [] } as never;
    expect(resultFromResearchOct({
      oct, raw, quality: quality("fail"), ood: { detected: false, reasons: [] },
      modelId: OCT_MODEL_ID, modelVersion: OCT_MODEL_VERSION,
    }).state).toBe("IMAGE_NOT_SUITABLE");
    expect(resultFromResearchOct({
      oct, raw, quality: quality("pass"), ood: { detected: true, reasons: ["x"] },
      modelId: OCT_MODEL_ID, modelVersion: OCT_MODEL_VERSION,
    }).state).toBe("OUT_OF_DISTRIBUTION");
  });
});

describe("oct provider fail-closed paths (no runtime needed)", () => {
  it("refuses to run without image bytes", async () => {
    const p = new OctLocalProvider();
    const out = await p.analyzeStudy(octStudy(), { qualityScore: 0.8, eye: "unknown" });
    expect(out.findings).toEqual([]);
    expect(out.notes.join(" ")).toContain("No image bytes");
  });

  it("refuses a non-OCT modality", async () => {
    const p = new OctLocalProvider();
    const study = { ...octStudy(), modality: "fundus" } as NormalizedStudy;
    const out = await p.analyzeStudy(study, { qualityScore: 0.8, eye: "unknown", imageBytes: Buffer.from([1, 2, 3]) });
    expect(out.findings).toEqual([]);
  });

  it("advertises research-only classification without localization", async () => {
    const p = new OctLocalProvider();
    const caps = await p.getCapabilities();
    expect(caps.modalities).toEqual(["OCT"]);
    expect(caps.supported_findings).toEqual(["oct_retinal_class_estimate"]);
    expect(caps.supports_localization).toBe(false);
    expect(caps.calibration_available).toBe(false);
  });
});

describe.skipIf(!HAS_PACKAGE || !HAS_VENV || !HAS_IMAGES)("oct real-pixel inference", () => {
  it("classifies a real CNV scan with domain disclosure", async () => {
    const imageBytes = fs.readFileSync(CNV_IMAGE);
    const run = await runOctResearchAnalysis(octStudy(), {
      qualityScore: 0.8, eye: "unknown", device: null, imageBytes,
    });
    expect(run.raw.inference_status).toBe("completed");
    expect(run.oct).not.toBeNull();
    expect(run.oct!.predicted_class).toBe("CNV");
    expect(run.findings).toHaveLength(1);
    expect(run.findings[0].type).toBe("oct_retinal_class_estimate");
    expect(run.findings[0].synthetic).toBe(false);
    expect(run.findings[0].confidence_category).toBe("INDETERMINATE");
    expect(run.findings[0].model_status).toBe("RESEARCH");
    expect(run.notes.join(" ")).toContain("DOMAIN_VALIDATION_UNKNOWN");
  }, 180_000);

  it("emits no finding for a NORMAL scan (class lives in oct_assessment only)", async () => {
    const imageBytes = fs.readFileSync(NORMAL_IMAGE);
    const run = await runOctResearchAnalysis(octStudy(), {
      qualityScore: 0.8, eye: "unknown", device: null, imageBytes,
    });
    expect(run.raw.inference_status).toBe("completed");
    expect(run.oct!.predicted_class).toBe("NORMAL");
    expect(run.findings).toEqual([]);
  }, 180_000);
});

describe.skipIf(!HAS_PACKAGE || !HAS_VENV || !HAS_IMAGES)("live pipeline OCT path", () => {
  it("analyzes an OCT study with the RESEARCH classifier and keeps every safety boundary", async () => {
    const { runPipeline } = await import("@/lib/analysis/pipeline");
    const imageBytes = fs.readFileSync(CNV_IMAGE);
    const { analysis } = await runPipeline({ study: octStudy(), originalBytes: imageBytes });
    expect(analysis.model_registry?.model_status).toBe("RESEARCH");
    expect(analysis.model_registry?.model_id).toBe(OCT_MODEL_ID);
    expect(analysis.demo.synthetic_result).toBe(false);
    expect(analysis.oct_assessment?.state).toBe("CLASS_ESTIMATED");
    expect(analysis.oct_assessment?.predicted_class).toBe("CNV");
    expect(analysis.oct_assessment?.calibration_state).toBe("NOT_CALIBRATED");
    expect(analysis.findings.some((f) => f.type === "oct_retinal_class_estimate" && f.synthetic === false)).toBe(true);
    // Fundus layers stay unavailable for OCT input; no overlay is produced.
    expect(analysis.fundus_abnormality?.state).toBe("OUT_OF_DISTRIBUTION");
    expect(analysis.dr_assessment?.state).toBe("OUT_OF_DISTRIBUTION");
    expect(analysis.multi_model?.agreement).toBe("SINGLE_RESEARCH_MODEL");
    // Safety boundaries hold.
    expect(analysis.possible_conditions?.conditions ?? []).toEqual([]);
    expect(analysis.diagnosis_gate!.allowed).toBe(false);
    expect(analysis.recommendation.priority).not.toBe("routine_follow_up");
    const text = JSON.stringify(analysis).toLowerCase();
    expect(text).not.toContain("normal macula");
    expect(text).not.toContain("healthy");
    expect(text).not.toContain("no disease");
  }, 180_000);

  it("keeps quality precedence: unusable OCT input yields IMAGE_NOT_SUITABLE with zero findings", async () => {
    const { runPipeline } = await import("@/lib/analysis/pipeline");
    // Nearly-black input fails the quality gate deterministically.
    const dark = Buffer.from(await sharpDarkPng());
    const { analysis } = await runPipeline({ study: octStudy(), originalBytes: dark });
    expect(analysis.quality.acceptable).toBe(false);
    expect(analysis.oct_assessment?.state).toBe("IMAGE_NOT_SUITABLE");
    expect(analysis.findings).toEqual([]);
  }, 120_000);
});

async function sharpDarkPng(): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  return sharp({ create: { width: 200, height: 200, channels: 3, background: { r: 5, g: 5, b: 5 } } }).png().toBuffer();
}
