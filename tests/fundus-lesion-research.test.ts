import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { PROJECT_ROOT } from "@/lib/config";
import { getModel, gateModelUse, supportsModality } from "@/lib/models/registry";
import { verifyModelIntegrity } from "@/lib/models/integrity";
import { loadModelPackage, validateManifest } from "@/lib/models/package";
import {
  FUNDUS_LESION_MODEL_ID,
  FUNDUS_LESION_MODEL_VERSION,
  FUNDUS_LESION_ARTIFACT_SHA256,
  validateFundusLesionSegmentationOutput,
} from "@/lib/models/fundusLesionContract";
import {
  FundusLesionLocalProvider,
  checkFundusLesionEnvironment,
  lesionOutputToRaw,
  runFundusLesionResearchAnalysis,
} from "@/lib/models/fundusLesionLocalProvider";
import { getProviderForModel } from "@/lib/models/provider";
import type { NormalizedStudy } from "@/lib/devices/adapter";
import { activeProductionCoverage, coverageForModality } from "@/lib/models/ophthalmicCoverage";

/**
 * RESEARCH lesion detector: real local SafeTensors inference wired into the
 * live pipeline for fundus studies, with labeled DEMO fallback everywhere
 * else. Fast unit tests run everywhere; worker tests skip (not fail) when
 * the installed package or the dedicated runtime is absent (fresh checkout).
 */

const PKG_DIR = path.join(PROJECT_ROOT, "data", "models", FUNDUS_LESION_MODEL_ID);
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
    studyId: "lesion-test-study",
    modality: "fundus",
    eye: "unknown",
    source: "file_upload",
    metadata: { providedBy: "none" },
    files: [],
  };
}

describe("lesion model package + registry", () => {
  it("is registered as RESEARCH with pinned artifact metadata", () => {
    const m = getModel(FUNDUS_LESION_MODEL_ID);
    expect(m).toBeDefined();
    expect(m!.status).toBe("RESEARCH");
    expect(m!.version).toBe(FUNDUS_LESION_MODEL_VERSION);
    expect(m!.sha256).toBe(FUNDUS_LESION_ARTIFACT_SHA256);
    expect(m!.format).toBe("safetensors");
    expect(m!.modalities).toEqual(["FUNDUS"]);
    expect(m!.supported_findings).toEqual([
      "cotton_wool_spot",
      "hard_exudate",
      "retinal_hemorrhage",
      "microaneurysm_like_lesion",
    ]);
    expect(m!.supported_conditions).toEqual([]);
    expect(m!.input_schema).toBe("IMAGE_ONLY");
    expect(m!.regulatory_status).toBe("research_only");
  });

  it("passes the context-free registry gate with the RESEARCH label", () => {
    const m = getModel(FUNDUS_LESION_MODEL_ID)!;
    const gate = gateModelUse(m);
    expect(gate.allowed).toBe(true);
    expect(gate.findings_use).toBe("research_only");
    expect(gate.label).toContain("RESEARCH USE ONLY");
  });

  it("declares fundus support only", () => {
    const m = getModel(FUNDUS_LESION_MODEL_ID)!;
    expect(supportsModality(m, "FUNDUS")).toBe(true);
    expect(supportsModality(m, "OCT")).toBe(false);
  });

  it("is reachable through the live provider registry as the real provider", () => {
    const p = getProviderForModel(FUNDUS_LESION_MODEL_ID);
    expect(p).not.toBeNull();
    expect(p!).toBeInstanceOf(FundusLesionLocalProvider);
  });

  it("coverage marks the four lesion targets RESEARCH_PIPELINE, production stays empty", () => {
    const targets = coverageForModality("fundus").filter((e) => e.model_id === FUNDUS_LESION_MODEL_ID);
    expect(targets.map((e) => e.target_id)).toEqual([
      "cotton_wool_spot",
      "hard_exudate",
      "retinal_hemorrhage",
      "microaneurysm_like_lesion",
    ]);
    for (const t of targets) {
      expect(t.state).toBe("RESEARCH_PIPELINE");
      expect(t.pipeline_enabled).toBe(true);
      expect(t.production_available).toBe(false);
      expect(t.calibration).toBe("NOT_CALIBRATED");
    }
    expect(activeProductionCoverage()).toEqual([]);
  });
});

describe.skipIf(!HAS_PACKAGE)("lesion installed package", () => {
  it("manifest validates and the artifact hash matches", () => {
    const raw = JSON.parse(fs.readFileSync(path.join(PKG_DIR, "manifest.json"), "utf8"));
    expect(validateManifest(raw).ok).toBe(true);
    const loaded = loadModelPackage(FUNDUS_LESION_MODEL_ID);
    expect(loaded.ok).toBe(true);
  });

  it("integrity verification trusts the installed artifact", () => {
    const r = verifyModelIntegrity(FUNDUS_LESION_MODEL_ID);
    expect(r.trusted).toBe(true);
  });

  it("detects a tampered artifact and refuses to trust it (restores afterwards)", () => {
    const artifact = path.join(PKG_DIR, "model.safetensors");
    const original = fs.readFileSync(artifact);
    try {
      const tampered = Buffer.from(original);
      tampered[tampered.length - 1] ^= 0xff;
      fs.writeFileSync(artifact, tampered);
      expect(loadModelPackage(FUNDUS_LESION_MODEL_ID).ok).toBe(false);
      expect(verifyModelIntegrity(FUNDUS_LESION_MODEL_ID).trusted).toBe(false);
    } finally {
      fs.writeFileSync(artifact, original);
    }
    // Restored byte-for-byte: trust returns.
    expect(loadModelPackage(FUNDUS_LESION_MODEL_ID).ok).toBe(true);
    expect(verifyModelIntegrity(FUNDUS_LESION_MODEL_ID).trusted).toBe(true);
  });
});

describe("lesion transport contract (no runtime needed)", () => {
  function validOutput(): Record<string, unknown> {
    return {
      inference_status: "completed",
      model_id: FUNDUS_LESION_MODEL_ID,
      model_version: FUNDUS_LESION_MODEL_VERSION,
      artifact_sha256: FUNDUS_LESION_ARTIFACT_SHA256,
      image_id: "a".repeat(64),
      coordinate_space: "ORIGINAL_IMAGE_NORMALIZED",
      original_image_size: { width: 100, height: 100 },
      preprocessing_transform: {
        coordinate_space: "MODEL_PIXELS_TO_ORIGINAL_IMAGE",
        original: { width: 100, height: 100 },
        crop: { x: 0, y: 0, w: 100, h: 100 },
        model: { width: 1024, height: 1024 },
        resized: { width: 1024, height: 1024 },
        padding: { left: 0, top: 0, right: 0, bottom: 0 },
      },
      raw_output_shape: [5, 1024, 1024],
      output_order: ["background", "cotton_wool_spot", "hard_exudate", "retinal_hemorrhage", "microaneurysm_like_lesion"],
      preprocessing_version: "clementp-source-pinned-1024-v1",
      threshold_version: "argmax-components-no-threshold-no-calibration",
      validation_status: "CANDIDATE_ONLY",
      image_level_summary: "SUSPICIOUS_ABNORMALITY",
      class_masks: [
        { class_name: "background", width: 1024, height: 1024, mask_ref: null, area_pixels: 1024 * 1024 - 4 },
        { class_name: "cotton_wool_spot", width: 1024, height: 1024, mask_ref: null, area_pixels: 0 },
        { class_name: "hard_exudate", width: 1024, height: 1024, mask_ref: null, area_pixels: 0 },
        { class_name: "retinal_hemorrhage", width: 1024, height: 1024, mask_ref: null, area_pixels: 4 },
        { class_name: "microaneurysm_like_lesion", width: 1024, height: 1024, mask_ref: null, area_pixels: 0 },
      ],
      class_scores: ["background", "cotton_wool_spot", "hard_exudate", "retinal_hemorrhage", "microaneurysm_like_lesion"].map(
        (c) => ({ class_name: c, score_semantics: "NOT_CALIBRATED", score: null })
      ),
      lesion_regions: [
        {
          class_name: "retinal_hemorrhage",
          area_pixels: 4,
          centroid: { x: 0.5, y: 0.5 },
          bounding_box: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 },
          mask_ref: null,
          raw_score: null,
          region_semantics: "UNFILTERED_ARGMAX_COMPONENT_NOT_VALIDATED_AS_LESION",
        },
      ],
      limitations: ["CANDIDATE_ONLY; no clinical or independent validation"],
    };
  }

  it("accepts a well-formed worker output", () => {
    expect(validateFundusLesionSegmentationOutput(validOutput()).valid).toBe(true);
  });

  it("rejects a tampered artifact hash", () => {
    const o = validOutput();
    o.artifact_sha256 = "0".repeat(64);
    const r = validateFundusLesionSegmentationOutput(o);
    expect(r.valid).toBe(false);
  });

  it("rejects NaN/Infinity/out-of-bounds geometry", () => {
    for (const bad of [
      { x: NaN, y: 0.4, w: 0.2, h: 0.2 },
      { x: 0.4, y: 0.4, w: Infinity, h: 0.2 },
      { x: 0.9, y: 0.9, w: 0.2, h: 0.2 },
      { x: -0.1, y: 0.4, w: 0.2, h: 0.2 },
    ]) {
      const o = validOutput();
      (o.lesion_regions as Array<Record<string, unknown>>)[0].bounding_box = bad;
      expect(validateFundusLesionSegmentationOutput(o).valid).toBe(false);
    }
  });

  it("rejects summary/region-count mismatches", () => {
    const o = validOutput();
    o.image_level_summary = "NO_TARGET_ABNORMALITY_DETECTED";
    expect(validateFundusLesionSegmentationOutput(o).valid).toBe(false);
  });

  it("rejects a fabricated calibrated score", () => {
    const o = validOutput();
    (o.lesion_regions as Array<Record<string, unknown>>)[0].raw_score = 0.99;
    expect(validateFundusLesionSegmentationOutput(o).valid).toBe(false);
  });

  it("rejects a shuffled class order", () => {
    const o = validOutput();
    o.output_order = ["background", "hard_exudate", "cotton_wool_spot", "retinal_hemorrhage", "microaneurysm_like_lesion"];
    expect(validateFundusLesionSegmentationOutput(o).valid).toBe(false);
  });

  it("maps regions to RawModelOutput without inventing scores", () => {
    const raw = lesionOutputToRaw(validOutput() as never, "study-1", "OD");
    expect(raw.inference_status).toBe("completed");
    expect(raw.findings).toHaveLength(1);
    expect(raw.findings![0].finding_type).toBe("retinal_hemorrhage");
    expect(raw.findings![0].laterality).toBe("OD");
    expect(raw.findings![0].severity).toBe("indeterminate");
    expect(raw.findings![0].confidence).toBeUndefined();
    expect(raw.findings![0].calibrated_confidence).toBeUndefined();
    expect(raw.findings![0].localization).toEqual({
      kind: "bounding_box",
      coordinates: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 },
    });
  });
});

describe("lesion provider fail-closed paths (no runtime needed)", () => {
  it("refuses to run without image bytes", async () => {
    const p = new FundusLesionLocalProvider();
    const out = await p.analyzeStudy(fundusStudy(), { qualityScore: 0.9, eye: "unknown" });
    expect(out.findings).toEqual([]);
    expect(out.notes.join(" ")).toContain("No image bytes");
  });

  it("refuses a non-fundus modality", async () => {
    const p = new FundusLesionLocalProvider();
    const study = { ...fundusStudy(), modality: "oct" } as NormalizedStudy;
    const out = await p.analyzeStudy(study, { qualityScore: 0.9, eye: "unknown", imageBytes: Buffer.from([1, 2, 3]) });
    expect(out.findings).toEqual([]);
  });

  it("advertises research-only capabilities", async () => {
    const p = new FundusLesionLocalProvider();
    const caps = await p.getCapabilities();
    expect(caps.modalities).toEqual(["FUNDUS"]);
    expect(caps.supports_localization).toBe(true);
    expect(caps.calibration_available).toBe(false);
    expect(caps.supports_measurements).toBe(false);
  });
});

describe.skipIf(!HAS_VENV)("lesion runtime environment", () => {
  it("reports the dedicated runtime ready with pinned packages", async () => {
    const env = await checkFundusLesionEnvironment();
    expect(env.ready).toBe(true);
    expect(env.missing).toEqual([]);
  }, 120_000);
});

describe.skipIf(!HAS_PACKAGE || !HAS_VENV || !HAS_TEST_IMAGE)("lesion real-pixel inference", () => {
  it("produces real findings from real pixels with domain disclosure", async () => {
    const imageBytes = fs.readFileSync(TEST_IMAGE);
    const run = await runFundusLesionResearchAnalysis(fundusStudy(), {
      qualityScore: 0.9,
      eye: "unknown",
      device: null,
      imageBytes,
    });
    expect(run.raw.inference_status).toBe("completed");
    // Deterministic worker output for the pinned engineering image.
    expect(run.findings).toHaveLength(1);
    expect(run.findings[0].type).toBe("microaneurysm_like_lesion");
    expect(run.findings[0].synthetic).toBe(false);
    expect(run.findings[0].taxonomy_level).toBe("observation");
    expect(run.findings[0].confidence_category).toBe("INDETERMINATE");
    expect(run.findings[0].confidence_calibrated).toBeNull();
    expect(run.findings[0].model_status).toBe("RESEARCH");
    const region = run.findings[0].region!;
    for (const v of [region.x, region.y, region.w, region.h]) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(region.x + region.w).toBeLessThanOrEqual(1.0001);
    expect(region.y + region.h).toBeLessThanOrEqual(1.0001);
    expect(run.notes.join(" ")).toContain("DOMAIN_VALIDATION_UNKNOWN");
  }, 240_000);

  it("serializes concurrent analyses (one ~1.3GB worker at a time) with identical results", async () => {
    const imageBytes = fs.readFileSync(TEST_IMAGE);
    const ctx = { qualityScore: 0.9, eye: "unknown", device: null, imageBytes };
    const [a, b] = await Promise.all([
      runFundusLesionResearchAnalysis(fundusStudy(), ctx),
      runFundusLesionResearchAnalysis(fundusStudy(), ctx),
    ]);
    expect(a.raw.inference_status).toBe("completed");
    expect(b.raw.inference_status).toBe("completed");
    expect(a.findings).toEqual(b.findings);
  }, 240_000);
});

describe.skipIf(!HAS_PACKAGE || !HAS_VENV || !HAS_TEST_IMAGE)("live pipeline research path", () => {
  it("analyzes a fundus study with the RESEARCH detector and keeps every safety boundary", async () => {
    const { runPipeline } = await import("@/lib/analysis/pipeline");
    const imageBytes = fs.readFileSync(TEST_IMAGE);
    const { analysis } = await runPipeline({ study: fundusStudy(), originalBytes: imageBytes });
    expect(analysis.model_registry?.model_status).toBe("RESEARCH");
    expect(analysis.model_registry?.model_id).toBe(FUNDUS_LESION_MODEL_ID);
    expect(analysis.model_registry?.display_label).toContain("RESEARCH USE ONLY");
    expect(analysis.demo.synthetic_result).toBe(false);
    expect(analysis.fundus_abnormality?.state).toBe("SUSPICIOUS_ABNORMALITY");
    expect(analysis.fundus_abnormality?.validation_state).toBe("RESEARCH");
    expect(analysis.fundus_abnormality?.regions).toHaveLength(1);
    expect(analysis.findings.some((f) => f.type === "microaneurysm_like_lesion" && f.synthetic === false)).toBe(true);
    // A second research model (DR grader) may contribute its own finding;
    // every finding stays non-synthetic with RESEARCH provenance.
    for (const f of analysis.findings) {
      expect(f.synthetic).toBe(false);
      expect(f.model_status).toBe("RESEARCH");
    }
    // Safety boundaries hold on the research path.
    expect(analysis.possible_conditions?.conditions ?? []).toEqual([]);
    expect(analysis.diagnosis_gate!.allowed).toBe(false);
    expect(analysis.diagnosis_gate!.clinical_interpretation).toBe("REQUIRES_CLINICAL_CORRELATION");
    expect(analysis.recommendation.priority).not.toBe("routine_follow_up");
    const text = JSON.stringify(analysis).toLowerCase();
    expect(text).not.toContain("normal fundus");
    expect(text).not.toContain("no disease");
  }, 240_000);

  it("keeps the labeled DEMO path for non-fundus modalities", async () => {
    const { runPipeline } = await import("@/lib/analysis/pipeline");
    const imageBytes = fs.readFileSync(TEST_IMAGE);
    const study = { ...fundusStudy(), modality: "oct" } as NormalizedStudy;
    const { analysis } = await runPipeline({ study, originalBytes: imageBytes });
    expect(analysis.model_registry?.model_status).toBe("DEMO");
    expect(analysis.demo.synthetic_result).toBe(true);
  }, 120_000);
});
