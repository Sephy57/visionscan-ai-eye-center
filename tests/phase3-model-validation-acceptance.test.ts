import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { validateValidationCaseManifest } from "@/lib/validation/casePackage";

function readJson(relativePath: string): unknown {
  return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8")) as unknown;
}

describe("Phase 3 model validation acceptance pack", () => {
  it("contains 12 synthetic, bounded, non-diagnostic contracts", () => {
    const manifest = readJson("validation-cases/phase3-model-validation-pack.json");
    const result = validateValidationCaseManifest(manifest);
    expect(result.valid, result.errors.join("; ")).toBe(true);
    expect(result.manifest?.package_id).toBe("phase3-model-validation-acceptance");
    expect(result.manifest?.cases).toHaveLength(12);
    expect(JSON.stringify(manifest)).not.toMatch(/\b(?:mrn|medical record|dob|patient name)\b/i);
    for (const validationCase of result.manifest!.cases) {
      expect(validationCase.ground_truth_scope).not.toBe("CLINICAL_DIAGNOSIS");
      expect(validationCase.expected_medication_behavior).toBe("NO_DEFENSIBLE_SOURCE_FOUND");
      expect(validationCase.forbidden_claims?.length).toBeGreaterThan(0);
      expect(validationCase.known_limitations?.length).toBeGreaterThan(0);
      expect(validationCase.assertions.length).toBeGreaterThan(0);
    }
  });

  it("pins generated Phase 3 model evidence to the observed validation boundaries", () => {
    const summary = readJson("docs/model-validation/validation-summary.json") as {
      models: Array<Record<string, unknown>>;
    };
    const dr = summary.models.find((entry) => (entry.model as Record<string, unknown>)?.model_id === "fundus-dr-grading-effb0")!;
    const lesion = summary.models.find((entry) => (entry.model as Record<string, unknown>)?.model_id === "fundus-lesions-clementp-unet-seresnext50")!;
    const oct = summary.models.find((entry) => (entry.model as Record<string, unknown>)?.model_id === "oct-retinal-weights-fp32")!;

    expect((dr.validation as Record<string, unknown>).n).toBe(400);
    expect(((dr.validation as Record<string, unknown>).referable as Record<string, unknown>).confusion).toMatchObject({ tp: 79, fp: 2, fn: 101 });
    expect((lesion.dataset as Record<string, unknown>).n_images).toBe(27);
    expect((lesion.false_positive_burden as Record<string, unknown>).status).toBe("NOT_MEASURABLE");
    expect((oct.internal_or_overlap_disclosed as Record<string, unknown>).metrics).toMatchObject({ n: 1000, accuracy: 0.977 });
    expect(((oct.independent_external as Record<string, unknown>).metrics as Record<string, unknown>).n).toBe(3231);
    expect(JSON.stringify(summary)).toContain('"DRUSEN-proxy"');
    expect(JSON.stringify(summary)).toContain('"CNV":112');
    expect(JSON.stringify(summary)).not.toMatch(/patient name|medical record|\bDOB\b/i);
  });

  it("keeps the generated failure registries PHI-minimized and research-only", () => {
    const drFailures = readJson("docs/model-validation/dr-failure-registry.json") as { false_negatives: Array<Record<string, unknown>>; false_positives: Array<Record<string, unknown>> };
    const octErrors = readJson("docs/model-validation/oct-error-registry.json") as { errors: Array<Record<string, unknown>> };
    const drCases = [...drFailures.false_negatives, ...drFailures.false_positives];
    expect(drFailures.false_negatives).toHaveLength(101);
    expect(drFailures.false_positives).toHaveLength(2);
    expect(drCases.every((entry) => typeof entry.case_key === "string" && entry.case_key.length === 24 && typeof entry.patient_key === "string" && entry.patient_key.length === 24 && typeof entry.eye_key === "string" && entry.eye_key.length === 24)).toBe(true);
    expect(octErrors.errors).toHaveLength(23);
    expect(octErrors.errors.every((entry) => typeof entry.case_key === "string" && entry.case_key.length === 24)).toBe(true);
    expect(JSON.stringify(drFailures)).not.toMatch(/synthetic-patient|mrn|medical record|\bDOB\b/i);
    expect(JSON.stringify(octErrors)).not.toMatch(/synthetic-patient|mrn|medical record|\bDOB\b/i);
  });

  it("does not reflect server exception details through the analysis API", () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), "app/api/analyze/route.ts"), "utf8");
    expect(source).toContain('error: "ANALYSIS_FAILED"');
    expect(source).not.toContain("err.message");
    expect(source).not.toContain("String(err");
  });
});
