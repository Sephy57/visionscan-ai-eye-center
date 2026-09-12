import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateRunManifest, validateRunResult } from "@/lib/models/competitionContract";

const repo = path.resolve(__dirname, "..");
const candidateManifestPath = path.join(repo, "docs", "model-manifests", "retguard-dr-v1.0.0-candidate.json");
const bundleDir = path.join(repo, "docs", "generated", "model-competition", "phase6-retguard-20260913");
const lesionResultPath = path.join(repo, "docs", "generated", "phase6-lesion-safety-net.json");

function readJson(file: string): any {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function sha256(file: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

describe("Phase 6 candidate and runtime acceptance", () => {
  it("keeps the acquired candidate restricted, candidate-only, and blocked before inference", () => {
    const manifest = readJson(candidateManifestPath);
    expect(manifest.model_id).toBe("retguard-dr-v1.0.0");
    expect(manifest.artifact.format).toBe("onnx");
    expect(manifest.preprocessing_version).toContain("unverified");
    expect(manifest.source_revision).toBe("v1.0.0");
    expect(manifest.license_state).toBe("RIGHTS_RESTRICTED");
    expect(manifest.validation_state).toBe("NOT_BENCHMARK_READY");
    expect(manifest.runtime_state).toBe("GRAPH_LOAD_ONLY");
    expect(manifest.status).toBe("CANDIDATE_ONLY");
    expect(manifest.rights).toEqual(expect.objectContaining({ state: "RIGHTS_RESTRICTED" }));
    expect(manifest.validation).toEqual(expect.objectContaining({ state: "NOT_BENCHMARK_READY", local_head_to_head: "NOT_RUN" }));
    expect(manifest.runtime).toEqual(expect.objectContaining({ local_graph_load: "PASSED", local_inference: "NOT_RUN_BECAUSE_PARITY_GATE_FAILED" }));
    expect(manifest.validation?.publisher_parity_observation?.logit_parity).toBe("FAILED");
    expect(manifest.artifact.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("validates every immutable competition bundle member and preserves the blocked result", () => {
    const files = ["manifest.json", "baseline.json", "candidate.json", "paired-errors.json", "metrics.json", "confusion-matrix.json", "runtime.json", "limitations.json", "review.json", "hashes.json"];
    for (const file of files) expect(fs.existsSync(path.join(bundleDir, file)), file).toBe(true);
    const manifest = readJson(path.join(bundleDir, "manifest.json"));
    const candidate = readJson(path.join(bundleDir, "candidate.json"));
    expect(validateRunManifest(manifest.candidate_manifest).valid).toBe(true);
    expect(validateRunManifest(manifest.frozen_baseline_manifest).valid).toBe(true);
    expect(validateRunResult(candidate).valid).toBe(true);
    expect(candidate.measurement_state).toBe("NOT_MEASURED");
    expect(candidate.metrics).toBeNull();
    expect(manifest.candidate_governance.lifecycle_status).toBe("CANDIDATE_ONLY");

    const hashes = readJson(path.join(bundleDir, "hashes.json"));
    for (const file of files.filter((name) => name !== "hashes.json")) {
      expect(sha256(path.join(bundleDir, file))).toBe(hashes.files[file]);
    }
    const serialized = files.map((file) => fs.readFileSync(path.join(bundleDir, file), "utf8")).join("\n");
    expect(serialized).not.toMatch(/patient\s+name|date\s+of\s+birth|medical[- ]record\s+number/i);
    expect(serialized).not.toMatch(/patient_\d+|IMG\d+\.jpg/i);
  });

  it("detects a tampered candidate manifest instead of trusting its stored hash", () => {
    const manifest = readJson(path.join(bundleDir, "manifest.json")).candidate_manifest;
    const tampered = { ...manifest, model: { ...manifest.model, artifact_sha256: "0".repeat(64) } };
    expect(validateRunManifest(tampered).valid).toBe(false);
  });

  it("keeps lesion escalation aggregate-only and labels partial runs honestly", () => {
    const result = readJson(lesionResultPath);
    expect(result.phi_included).toBe(false);
    expect(result.baseline_fn.label).toBe("REVIEW ESCALATION COVERAGE");
    expect(result.baseline_fn.forbidden_label).toBe("DISEASE RECOVERY");
    expect(result).not.toHaveProperty("cases");
    expect(result).not.toHaveProperty("patient_id");
    expect(result).not.toHaveProperty("image_id");
    if (result.scope.selected_cases < result.scope.frozen_validation_cases) {
      expect(result.measurement_state).toBe("PARTIAL_TECHNICAL_RESEARCH");
    }
    if (result.scope.selected_cases === result.scope.frozen_validation_cases) {
      expect(result.scope.baseline_fn_cases_selected).toBe(result.scope.baseline_fn_cases_expected);
      expect(result.scope.baseline_fn_cases_expected).toBe(101);
      expect(result.aggregate.input_cases).toBe(400);
      expect(result.nonreferable.input_cases).toBe(319);
      expect(result.nonreferable.extra_review_escalations_per_100).toEqual(expect.any(Number));
      expect(result.measurement_state).toBe("MEASURED_TECHNICAL_RESEARCH");
    }
  });

  it("keeps the candidate out of the ordinary live model registry and exposes a read-only Phase 6 route", () => {
    const registry = fs.readFileSync(path.join(repo, "lib", "models", "registry.ts"), "utf8");
    const route = fs.readFileSync(path.join(repo, "app", "api", "validation", "phase6", "route.ts"), "utf8");
    expect(registry).not.toContain('"retguard-dr-v1.0.0"');
    expect(route).toContain("requireRole(req, [\"ADMIN\", \"REVIEWER\", \"RESEARCHER\"])");
    expect(route).toContain("CANDIDATE_ONLY");
    expect(route).not.toContain("NextResponse.json(manifest");
  });
});
