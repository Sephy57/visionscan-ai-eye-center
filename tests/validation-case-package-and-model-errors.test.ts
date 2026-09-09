import { describe, expect, it } from "vitest";
import safetyPackage from "../validation-cases/synthetic-safety-package.json";
import { runValidationCasePackage, validateValidationCaseManifest } from "@/lib/validation/casePackage";
import { parseModelErrorRecord, serializeModelErrorRecord, validateModelErrorRecord } from "@/lib/validation/modelErrorRegistry";
import { createModelError, getModelError, transitionModelError } from "@/lib/validation/modelErrorStore";
import { dbDelete } from "@/lib/storage/db";

const acceptanceActuals = {
  "synthetic-001": { routing: { modality: "UNKNOWN" } },
  "synthetic-002": { evidence: [{ category: "retinal_hemorrhage" }] },
  "synthetic-003": { conditions: [{ state: "POSSIBLE_CONDITION" }] },
  "synthetic-004": { specialists: [{ specialty_id: "retina" }] },
  "synthetic-005": { evidence: [{ category: "retinal_hemorrhage", source_ref: "synthetic-source-005" }] },
  "synthetic-006": { evidence: [{ category: "fluid_signal", laterality: "OS" }] },
  "synthetic-007": { evidence: [{ category: "pain", assertion: "ABSENT" }] },
  "synthetic-008": { evidence: [{ category: "glaucoma_suspect", assertion: "UNCERTAIN" }] },
  "synthetic-009": { evidence: [{ category: "retinal_hemorrhage", source_id: "synthetic-source-009" }] },
  "synthetic-010": { model: { model_id: "research-model", validation_status: "RESEARCH_ONLY" } },
  "synthetic-011": { presentation: { summary: "Qualified review is required." } },
  "synthetic-012": { evidence: [{ category: "retinal_hemorrhage", laterality: "OD" }], conditions: [{ condition_id: "diabetic_retinal_disease_pattern", state: "POSSIBLE_CONDITION" }] },
  "synthetic-013": { routing: { modality_state: "AMBIGUOUS" }, model: { inference_status: "blocked" } },
  "synthetic-014": { specialists: [{ specialty_id: "retina", requires_clinician_review: true }] },
  "synthetic-015": { conditions: [{ condition_id: "oct_macular_class_pattern", state: "POSSIBLE_CONDITION", laterality: "OS" }] },
};

describe("synthetic validation case packages", () => {
  it("validates and deterministically runs all 15 synthetic acceptance cases", () => {
    expect(validateValidationCaseManifest(safetyPackage).valid).toBe(true);
    const result = runValidationCasePackage(safetyPackage, acceptanceActuals);
    expect(result.passed).toBe(true);
    expect(result.cases).toHaveLength(15);
    expect(result.cases.map((entry) => entry.case_id)).toEqual(Array.from({ length: 15 }, (_, index) => `synthetic-${String(index + 1).padStart(3, "0")}`));
  });

  it("fails closed for a missing actual case and a forbidden presentation claim", () => {
    const result = runValidationCasePackage(safetyPackage, {
      "synthetic-011": { presentation: { summary: "Diagnosis confirmed." } },
    });
    expect(result.passed).toBe(false);
    expect(result.cases[10].assertions.find((entry) => entry.assertion_id === "c011-no-confirmed-diagnosis")?.passed).toBe(false);
    expect(result.cases.filter((entry) => entry.case_id !== "synthetic-011").every((entry) => entry.assertions.every((assertion) => assertion.detail === "no actual output supplied"))).toBe(true);
  });

  it("rejects packages that could carry non-synthetic case metadata", () => {
    const unsafe = { ...safetyPackage, cases: [{ ...safetyPackage.cases[0], case_id: "case-real-person", extra_patient_name: "not allowed" }] };
    const result = validateValidationCaseManifest(unsafe);
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("synthetic");
    expect(result.errors.join(" ")).toContain("unknown field");
  });
});

describe("model error registry", () => {
  const base = {
    schema_version: "visionscan-model-error-v1",
    error_id: "model-error-synthetic-fn-001",
    case_id: "synthetic-evidence-specialist",
    model_id: "research-model",
    model_version: "v1.0.0",
    category: "FALSE_NEGATIVE",
    target_id: "retinal_hemorrhage",
    status: "ADJUDICATED",
    lifecycle: "CLINICIAN_REVIEWED",
    input_hash_or_fixture_id: "synthetic-fixtures/case-012",
    modality: "FUNDUS",
    laterality: "OD",
    quality_state: "PASS",
    domain_state: "UNKNOWN",
    expected: { state: "PRESENT", target_id: "retinal_hemorrhage", evidence_refs: ["c012-evidence"] },
    observed: { state: "ABSENT", target_id: "retinal_hemorrhage", evidence_refs: ["c012-evidence"] },
    severity: "HIGH",
    reviewer: { reviewer_role: "CLINICIAN_REVIEWER", reviewed_at: "2026-09-09T00:05:00.000Z" },
    mitigation: null,
    regression_test: null,
    observed_at: "2026-09-09T00:00:00.000Z",
    assertion_ids: ["od-evidence"],
    adjudication: { outcome: "CONFIRMED", rationale_code: "REFERENCE_STANDARD", adjudicated_at: "2026-09-09T00:05:00.000Z", adjudicator_role: "CLINICIAN_REVIEWER" },
    remediation: null,
  } as const;

  it("round-trips a narrowly scoped adjudicated record through the persistence boundary", () => {
    const serialized = serializeModelErrorRecord(base);
    expect(parseModelErrorRecord(serialized)).toEqual(base);
  });

  it("rejects PHI-shaped fields, unsafe identifiers, and invalid lifecycle transitions", () => {
    expect(validateModelErrorRecord({ ...base, patient_name: "not allowed" }).valid).toBe(false);
    expect(validateModelErrorRecord({ ...base, case_id: "patient-123" }).valid).toBe(false);
    expect(validateModelErrorRecord({ ...base, status: "REMEDIATED", remediation: null }).valid).toBe(false);
    expect(() => parseModelErrorRecord("{not-json")).toThrow("invalid JSON");
  });

  it("requires structured review, mitigation, and regression evidence for advanced lifecycle states", () => {
    expect(validateModelErrorRecord({ ...base, lifecycle: "REGRESSION_PROTECTED", status: "REMEDIATED", remediation: { remediation_id: "fix-001", verification_case_ids: ["synthetic-012"], verified_at: "2026-09-09T00:10:00.000Z" }, mitigation: { mitigation_id: "fix-001", state: "VERIFIED", verified_at: "2026-09-09T00:10:00.000Z" }, regression_test: { case_id: "synthetic-012", assertion_ids: ["c012-evidence"], verified_at: "2026-09-09T00:11:00.000Z" } }).valid).toBe(true);
    expect(validateModelErrorRecord({ ...base, lifecycle: "REGRESSION_PROTECTED", status: "REMEDIATED", remediation: null, mitigation: null, regression_test: null }).valid).toBe(false);
    expect(validateModelErrorRecord({ ...base, input_hash_or_fixture_id: "patient-jane-input" }).valid).toBe(false);
  });

  it("persists insert-only errors and requires an explicit reviewer for transitions", async () => {
    const errorId = `model-error-synthetic-store-${Date.now()}`;
    try {
      const created = await createModelError({
        error_id: errorId,
        case_id: "synthetic-013",
        model_id: "research-model",
        model_version: "v1.0.0",
        category: "ROUTING_ERROR",
        target_id: "oct-route",
        input_hash_or_fixture_id: "synthetic-fixtures/case-013",
        modality: "OCT",
        laterality: "UNKNOWN",
        quality_state: "UNKNOWN",
        domain_state: "UNKNOWN",
        expected: { state: "BLOCKED", target_id: "oct-route", evidence_refs: ["c013-routing"] },
        observed: { state: "PRESENT", target_id: "oct-route", evidence_refs: ["c013-routing"] },
        severity: "HIGH",
        observed_at: "2026-09-09T00:00:00.000Z",
        assertion_ids: ["c013-routing"],
      });
      expect(created.lifecycle).toBe("UNREVIEWED");
      await expect(transitionModelError(errorId, { lifecycle: "CLINICIAN_REVIEWED", reviewer_role: "VALIDATION_REVIEWER" })).rejects.toThrow(/reviewer role/i);
      const reviewed = await transitionModelError(errorId, { lifecycle: "ENGINEERING_CONFIRMED", reviewer_role: "VALIDATION_REVIEWER" });
      expect(reviewed.status).toBe("ADJUDICATED");
      expect((await getModelError(errorId))?.lifecycle).toBe("ENGINEERING_CONFIRMED");
      await expect(createModelError({
        error_id: errorId,
        case_id: "synthetic-013",
        model_id: "research-model",
        model_version: "v1.0.0",
        category: "ROUTING_ERROR",
        target_id: "oct-route",
        observed_at: "2026-09-09T00:00:00.000Z",
        assertion_ids: ["c013-routing"],
      })).rejects.toThrow(/already exists/i);
    } finally {
      await dbDelete("model_errors", errorId);
    }
  });
});
