import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function readJson<T>(relativePath: string): T {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8")) as T;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

function hashWithoutSelfHash<T extends { hash?: unknown }>(value: T): string {
  const copy = { ...value } as T & { hash?: unknown };
  delete copy.hash;
  return crypto.createHash("sha256").update(JSON.stringify(canonical(copy)), "utf8").digest("hex");
}

describe("scientific validation Stage 1 governance artifacts", () => {
  it("freezes the blocked pre-inference protocol and manifest with reproducible hashes", () => {
    const manifest = readJson<{
      manifest_state: string;
      files: unknown[];
      hash: { value: string };
      dataset_file_count: number | null;
      dataset_image_count: number | null;
      dataset_patient_count: number | null;
    }>("docs/generated/dataset-manifest.json");
    const protocol = readJson<{
      protocol_status: string;
      dataset: { manifest_hash: string; inference_authorized: boolean };
      frozen_lesion_rule: { ruleset_id: string; definition: string };
      hash: { value: string };
    }>("docs/generated/scientific-validation-stage1-protocol.json");

    expect(manifest.manifest_state).toBe("NOT_ACQUIRED");
    expect(manifest.files).toEqual([]);
    expect(manifest.dataset_file_count).toBeNull();
    expect(manifest.dataset_image_count).toBeNull();
    expect(manifest.dataset_patient_count).toBeNull();
    expect(hashWithoutSelfHash(manifest)).toBe(manifest.hash.value);

    expect(protocol.protocol_status).toBe("FROZEN_BEFORE_INFERENCE_NOT_ACQUIRED");
    expect(protocol.dataset.inference_authorized).toBe(false);
    expect(protocol.dataset.manifest_hash).toBe(manifest.hash.value);
    expect(protocol.frozen_lesion_rule.ruleset_id).toBe("LESION_ESCALATION_RULE_PHASE7_V1");
    expect(protocol.frozen_lesion_rule.definition).toBe("lesion region_count >= 3");
    expect(hashWithoutSelfHash(protocol)).toBe(protocol.hash.value);
  });

  it("does not turn unavailable denominators or model failures into negative results", () => {
    const results = readJson<{
      status: string;
      inference: { performed: boolean; raw_images_read: number; model_invocations: number };
      coverage: Record<string, number | null> & { executed: number; denominator_note: string };
      primary_endpoint: { status: string; estimate: number | null; missed_escalation_count: number | null };
      clinical_safety: { model_failure_is_not_negative: boolean };
    }>("docs/generated/scientific-validation-stage1-results.json");

    expect(results.status).toBe("NOT_MEASURABLE");
    expect(results.inference.performed).toBe(false);
    expect(results.inference.raw_images_read).toBe(0);
    expect(results.inference.model_invocations).toBe(0);
    expect(results.coverage.executed).toBe(0);
    expect(results.coverage.dataset_total).toBeNull();
    expect(results.coverage.eligible).toBeNull();
    expect(results.coverage.quality_blocked).toBeNull();
    expect(results.coverage.ood_blocked).toBeNull();
    expect(results.primary_endpoint.status).toBe("NOT_MEASURED");
    expect(results.primary_endpoint.estimate).toBeNull();
    expect(results.primary_endpoint.missed_escalation_count).toBeNull();
    expect(results.clinical_safety.model_failure_is_not_negative).toBe(true);
  });

  it("keeps the error registry empty only because no cases were acquired", () => {
    const registry = readJson<{
      status: string;
      errors: unknown[];
      counts: { all_errors: number | null; high_risk_non_escalated: number | null };
      interpretation: string;
      raw_image_bytes_in_artifact: boolean;
      phi_included: boolean;
    }>("docs/generated/scientific-validation-stage1-error-registry.json");

    expect(registry.status).toBe("NOT_RUN_NO_DATA_ACQUIRED");
    expect(registry.errors).toEqual([]);
    expect(registry.counts.all_errors).toBeNull();
    expect(registry.counts.high_risk_non_escalated).toBeNull();
    expect(registry.interpretation).toMatch(/does not mean zero model errors/i);
    expect(registry.raw_image_bytes_in_artifact).toBe(false);
    expect(registry.phi_included).toBe(false);
  });

  it("binds protocol model identity to installed manifests or committed model evidence", () => {
    const protocol = readJson<{
      frozen_models: Array<{ model_id: string; version: string; artifact_sha256: string; status: string }>;
    }>("docs/generated/scientific-validation-stage1-protocol.json");
    const modelPaths = new Map([
      [
        "fundus-lesions-clementp-unet-seresnext50",
        {
          manifest: "data/models/fundus-lesions-clementp-unet-seresnext50/manifest.json",
          evidence: "docs/FUNDUS_LESION_MODEL_INTEGRATION.md",
        },
      ],
      [
        "fundus-dr-grading-effb0",
        {
          manifest: "data/models/fundus-dr-grading-effb0/manifest.json",
          evidence: "docs/DR_GRADE_MODEL_INTEGRATION.md",
        },
      ],
    ]);

    for (const frozen of protocol.frozen_models) {
      const paths = modelPaths.get(frozen.model_id)!;
      if (fs.existsSync(path.join(ROOT, paths.manifest))) {
        const manifest = readJson<{ model_id: string; version: string; artifact: { sha256: string }; regulatory_status: string }>(paths.manifest);
        expect(manifest.model_id).toBe(frozen.model_id);
        expect(manifest.version).toBe(frozen.version);
        expect(manifest.artifact.sha256).toBe(frozen.artifact_sha256);
        expect(manifest.regulatory_status).toBe("research_only");
      } else {
        const evidence = fs.readFileSync(path.join(ROOT, paths.evidence), "utf8");
        expect(evidence).toContain(frozen.model_id);
        expect(evidence).toContain(frozen.version);
        expect(evidence).toContain(frozen.artifact_sha256);
        expect(evidence).toMatch(/research_only|research-only/i);
      }
      expect(frozen.status).toBe("RESEARCH_ONLY");
    }
  });

  it("keeps committed scientific artifacts aggregate-only and non-PHI", () => {
    const relativePaths = [
      "docs/generated/dataset-manifest.json",
      "docs/generated/scientific-validation-stage1-dataset-dossiers.json",
      "docs/generated/scientific-validation-stage1-protocol.json",
      "docs/generated/scientific-validation-stage1-results.json",
      "docs/generated/scientific-validation-stage1-error-registry.json",
    ];
    for (const relativePath of relativePaths) {
      const text = fs.readFileSync(path.join(ROOT, relativePath), "utf8");
      expect(text).not.toMatch(/data:image\//i);
      expect(text).not.toMatch(/base64/i);
      expect(text).not.toMatch(/BEGIN (RSA|OPENSSH|EC) PRIVATE KEY/);
      expect(text).not.toMatch(/patient[_ -]?name/i);
      expect(text).not.toMatch(/raw image bytes/i);
    }
  });
});
