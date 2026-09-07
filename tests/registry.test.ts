import { describe, it, expect } from "vitest";
import {
  MODELS, getModel, gateModelUse, supportsModality, deviceCompatible,
  isSupportedModality, auditRegistryConsistency, hashModelArtifact,
  ModelRecord, STATUS_CAPABILITIES,
} from "@/lib/models/registry";
import { verifyModelIntegrity } from "@/lib/models/integrity";
import { checkModalitySupported, canonicalModality } from "@/lib/models/modalities";
import { mayEmitFinding, BLOCKED_TERMS, FINDING_TAXONOMY } from "@/lib/analysis/taxonomy";
import { generateModelCard } from "@/lib/reports/modelCard";
import { assessOod } from "@/lib/analysis/ood";
import type { QualityResult } from "@/lib/imaging/quality";

const demo = getModel("demo-fundus-synthetic-v0")!;

function goodQuality(): QualityResult {
  return {
    quality_score: 0.9, quality_status: "pass", detected_artifacts: [], affected_regions: [],
    recommended_reacquisition: false,
    metrics: {
      width: 1024, height: 768, sharpness_score: 0.8, illumination_mean: 120, illumination_p5: 30,
      illumination_p95: 230, highlight_clip_ratio: 0, shadow_clip_ratio: 0, colorfulness: 0.4,
      grayscale_only: false,
    },
    thresholds: {}, limitations: [],
  };
}

describe("model registry", () => {
  it("registers the DEMO synthetic model with no artifact", () => {
    const ids = Object.keys(MODELS);
    expect(ids).toContain("demo-fundus-synthetic-v0");
    expect(demo.status).toBe("DEMO");
    expect(demo.sha256).toBeNull();
    expect(demo.performance.sensitivity).toBeNull();
    expect(demo.performance.evidence_reference).toBeNull();
  });

  it("registers the RESEARCH lesion model with a pinned artifact checksum", () => {
    const lesion = getModel("fundus-lesions-clementp-unet-seresnext50")!;
    expect(lesion.status).toBe("RESEARCH");
    expect(lesion.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(lesion.supported_conditions).toEqual([]);
    expect(auditRegistryConsistency()).toEqual([]);
  });

  it("DEMO models are allowed only for demo use with a mandatory label", () => {
    const gate = gateModelUse(demo);
    expect(gate.allowed).toBe(true);
    expect(gate.findings_use).toBe("demo_only");
    expect(gate.label).toContain("NOT FOR CLINICAL USE");
  });

  it("rejects use of a model claiming validation without evidence", () => {
    const fake: ModelRecord = {
      ...demo,
      model_id: "fake-validated",
      status: "CLINICALLY_VALIDATED",
      sha256: "abc",
      format: "onnx",
      file_path: "fake.onnx",
      validation_date: null,
      performance: { ...demo.performance, sensitivity: 0.99, evidence_reference: null },
    };
    const gate = gateModelUse(fake);
    expect(gate.allowed).toBe(false);
    expect(gate.reasons.join(" ")).toContain("evidence reference");
  });

  it("rejects RETIRED models entirely", () => {
    const retired: ModelRecord = { ...demo, model_id: "retired-x", status: "RETIRED", file_path: null, sha256: null, format: "placeholder" };
    const gate = gateModelUse(retired);
    expect(gate.allowed).toBe(false);
  });

  it("flags registry inconsistency for validation claims without evidence", () => {
    // The real registry must be consistent.
    expect(auditRegistryConsistency()).toEqual([]);
  });
});

describe("model integrity", () => {
  it("trusts the placeholder DEMO model without an artifact but only via the gate", () => {
    const r = verifyModelIntegrity("demo-fundus-synthetic-v0");
    expect(r.trusted).toBe(true);
  });

  it("refuses a model whose artifact is missing from disk", () => {
    const r = verifyModelIntegrity("no-such-model");
    expect(r.trusted).toBe(false);
  });

  it("hashModelArtifact rejects paths escaping MODEL_ROOT", () => {
    expect(hashModelArtifact("..\\Windows\\evil.onnx").error).toBeDefined();
    expect(hashModelArtifact("does-not-exist.onnx").error).toBeDefined();
  });
});

describe("modality support", () => {
  it("never runs a modality the model does not declare", () => {
    expect(supportsModality(demo, "FUNDUS")).toBe(true);
    expect(supportsModality(demo, "OCT")).toBe(false);
    expect(checkModalitySupported(demo, "oct").ok).toBe(false);
    expect(checkModalitySupported(demo, "fundus").ok).toBe(true);
  });

  it("canonicalizes modality aliases", () => {
    expect(canonicalModality("retinal_photo")).toBe("FUNDUS");
    expect(canonicalModality("ffa")).toBe("FA");
    expect(canonicalModality("nonsense")).toBe("EXTERNAL_EYE");
  });

  it("validates supported modality values", () => {
    expect(isSupportedModality("OCTA")).toBe(true);
    expect(isSupportedModality("XRAY")).toBe(false);
  });
});

describe("device compatibility", () => {
  it("refuses when no device was validated", () => {
    const d = deviceCompatible(demo, { manufacturer: "Zeiss", model: "Visucam" });
    expect(d.compatible).toBe(false);
    expect(d.note).toContain("Device compatibility has not been validated");
  });

  it("refuses an unvalidated device even when the model lists another device", () => {
    const m: ModelRecord = {
      ...demo,
      status: "EXTERNALLY_VALIDATED",
      devices: [{ manufacturer: "Topcon", model: "NW400" }],
    };
    expect(deviceCompatible(m, { manufacturer: "Zeiss", model: "Visucam" }).compatible).toBe(false);
    expect(deviceCompatible(m, { manufacturer: "Topcon", model: "NW400" }).compatible).toBe(true);
    expect(deviceCompatible(m, null).compatible).toBe(false);
  });
});

describe("finding taxonomy", () => {
  it("forbids ambiguous 'blood clot' vocabulary", () => {
    const all = JSON.stringify(Object.values(FINDING_TAXONOMY)).toLowerCase();
    for (const term of BLOCKED_TERMS) expect(all).not.toContain(term);
  });

  it("keeps all findings at observation level and separates associations from diagnoses", () => {
    for (const def of Object.values(FINDING_TAXONOMY)) {
      expect(def.level).not.toBe("diagnosis");
      expect(def.level).toBe("observation");
    }
  });

  it("blocks modality-inappropriate findings", () => {
    expect(mayEmitFinding("retinal_hemorrhage", "FUNDUS", "DEMO").ok).toBe(true);
    expect(mayEmitFinding("retinal_hemorrhage", "OCT", "DEMO").ok).toBe(false);
    expect(mayEmitFinding("not_in_taxonomy", "FUNDUS", "DEMO").ok).toBe(false);
  });

  it("blocks diagnosis-level emission without clinical validation", () => {
    // Simulate a diagnosis-level taxonomy entry and verify the guard blocks it.
    const def = FINDING_TAXONOMY["retinal_hemorrhage"];
    FINDING_TAXONOMY["fake_diagnosis"] = { ...def, type: "fake_diagnosis", level: "diagnosis" };
    const r = mayEmitFinding("fake_diagnosis", "FUNDUS", "EXTERNALLY_VALIDATED");
    delete FINDING_TAXONOMY["fake_diagnosis"];
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("CLINICALLY_VALIDATED");
  });
});

describe("model card generation", () => {
  it("generates honest cards: no performance numbers for unmeasured models", () => {
    const card = generateModelCard(demo);
    expect(card).toContain("Demo Synthetic Fundus Detector");
    expect(card).toContain("Not measured");
    expect(card).toContain("MUST NOT be used for any clinical purpose");
    expect(card.toLowerCase()).toContain("device compatibility has not been validated");
    expect(card).not.toContain("Sensitivity | 99"); // no fabricated metrics
  });
});

describe("out-of-distribution detection", () => {
  it("flags missing metadata and unsupported modality without claiming normality", () => {
    const ood = assessOod({
      modality: "unknown",
      quality: goodQuality(),
      model: demo,
      device: null,
      metadataProvided: false,
    });
    expect(ood.detected).toBe(true);
    expect(ood.message).toContain("outside the validated operating conditions");
  });

  it("does not flag a well-formed supported input", () => {
    const ood = assessOod({
      modality: "fundus",
      quality: goodQuality(),
      model: null,
      device: null,
      metadataProvided: true,
    });
    expect(ood.detected).toBe(false);
  });

  it("flags severe quality artifacts", () => {
    const q = goodQuality();
    q.detected_artifacts = ["blur", "poor_illumination", "glare", "incorrect_field_of_view"];
    const ood = assessOod({ modality: "fundus", quality: q, model: null, device: null, metadataProvided: true });
    expect(ood.detected).toBe(true);
    expect(ood.reasons.some((r) => r.includes("artifacts"))).toBe(true);
  });
});
