import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  runValidationCasePackage,
  validateValidationCaseManifest,
  type JsonScalar,
  type ValidationCaseActual,
  type ValidationCaseManifest,
} from "@/lib/validation/casePackage";

const MANIFEST_PATH = path.resolve(process.cwd(), "validation-cases", "phase5-false-negative-reduction-pack.json");
const CATEGORY_ORDER = ["dr", "lesion", "oct", "worker", "unsupported-specialty", "empty-evidence", "false-reassurance", "security-tamper"] as const;
type Phase5Category = (typeof CATEGORY_ORDER)[number];
type ScalarRecord = Record<string, JsonScalar>;

const DR_MODEL = "fundus-dr-grading-effb0";
const LESION_MODEL = "fundus-lesions-clementp-unet-seresnext50";
const OCT_MODEL = "oct-retinal-weights-fp32";
const UNSUPPORTED_SPECIALTIES = [
  "GLAUCOMA",
  "CORNEA_EXTERNAL_DISEASE",
  "CATARACT_LENS",
  "NEURO_OPHTHALMOLOGY",
  "PEDIATRIC_OPHTHALMOLOGY",
  "UVEITIS_INFLAMMATION",
  "OCULAR_ONCOLOGY",
  "COMPREHENSIVE_OPHTHALMOLOGY",
] as const;

function readManifest(): unknown {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8")) as unknown;
}

function validatedManifest(): ValidationCaseManifest {
  const result = validateValidationCaseManifest(readManifest());
  if (!result.valid || !result.manifest) throw new Error(result.errors.join("; "));
  return result.manifest;
}

function source(category: Phase5Category, ordinal: number, fields: ScalarRecord): ScalarRecord {
  return {
    source_ref: `synthetic-${category}-source-${String(ordinal).padStart(3, "0")}`,
    laterality: "UNKNOWN",
    ...fields,
  };
}

function researchModel(modelId: string, fields: ScalarRecord = {}): ScalarRecord {
  return { model_id: modelId, validation_status: "RESEARCH_ONLY", ...fields };
}

function routedReview(specialty: string): Pick<ValidationCaseActual, "routing" | "specialists"> {
  return {
    routing: { specialty_id: specialty, routing_state: "ROUTED", execution_state: "REVIEW_REQUIRED" },
    specialists: [{ specialty_id: specialty, status: "REVIEW_REQUIRED", requires_clinician_review: true }],
  };
}

function phase5Category(fixtureRef: string): Phase5Category {
  const category = fixtureRef.split("/")[1];
  if (!(CATEGORY_ORDER as readonly string[]).includes(category)) throw new Error(`Unexpected Phase 5 category: ${fixtureRef}`);
  return category as Phase5Category;
}

function projectionForCase(category: Phase5Category, ordinal: number): ValidationCaseActual {
  switch (category) {
    case "dr": {
      switch (ordinal) {
        case 1:
          return { ...routedReview("RETINA"), evidence: [source(category, ordinal, { category: "dr_false_negative", state: "PRESENT", laterality: "OD", provenance: "FAILURE_REGISTRY" })], model: researchModel(DR_MODEL, { inference_status: "completed" }), presentation: { status: "RESEARCH_ONLY", claim: "missed finding risk remains" } };
        case 2:
          return { ...routedReview("RETINA"), evidence: [source(category, ordinal, { category: "dr_grade_3_undercall", state: "PRESENT", laterality: "OS", severity: "HIGH" })], model: researchModel(DR_MODEL, { inference_status: "completed" }), presentation: { status: "RESEARCH_ONLY", claim: "grade estimate requires review" } };
        case 3:
          return { ...routedReview("RETINA"), evidence: [source(category, ordinal, { category: "dr_grade_4_failure", severity: "HIGH", state: "PRESENT" })], model: researchModel(DR_MODEL, { inference_status: "completed" }), presentation: { status: "RESEARCH_ONLY", claim: "grade four sensitivity is not established" } };
        case 4:
          return { ...routedReview("RETINA"), evidence: [source(category, ordinal, { category: "threshold_sweep", state: "RESEARCH" })], model: researchModel(DR_MODEL, { threshold_state: "RESEARCH", inference_status: "completed" }) };
        case 5:
          return { ...routedReview("RETINA"), evidence: [source(category, ordinal, { category: "sudden_vision_loss", assertion: "PRESENT" }), source(category, ordinal, { category: "dr_image_result", state: "ABSENT", laterality: "OD" })], model: researchModel(DR_MODEL, { inference_status: "completed" }), presentation: { status: "RESEARCH_ONLY", claim: "current symptom urgency is independent of image output" } };
        case 6:
          return { ...routedReview("RETINA"), evidence: [source(category, ordinal, { category: "dr_false_negative", state: "PRESENT", laterality: "OS" })], model: researchModel(DR_MODEL, { inference_status: "completed" }) };
        case 7:
          return { ...routedReview("RETINA"), evidence: [source(category, ordinal, { category: "dr_score", state: "RESEARCH" })], model: researchModel(DR_MODEL, { calibration_state: "NOT_CALIBRATED", score_semantics: "MODEL_SCORE_NOT_CALIBRATED", inference_status: "completed" }) };
        case 8:
          return { ...routedReview("RETINA"), evidence: [source(category, ordinal, { category: "dr_failure_review", state: "PRESENT", laterality: "OU", provenance: "FAILURE_REGISTRY" })], model: researchModel(DR_MODEL, { inference_status: "completed" }) };
        default:
          break;
      }
      break;
    }
    case "lesion": {
      switch (ordinal) {
        case 1:
          return { ...routedReview("RETINA"), evidence: [source(category, ordinal, { category: "lesion_like_region", taxonomy_level: "observation", state: "PRESENT", laterality: "OD" })], model: researchModel(LESION_MODEL, { taxonomy_level: "observation", inference_status: "completed" }) };
        case 2:
          return { ...routedReview("RETINA"), evidence: [source(category, ordinal, { category: "lesion_false_positive_burden", state: "NOT_MEASURABLE" })], model: researchModel(LESION_MODEL, { inference_status: "completed" }), presentation: { status: "RESEARCH_ONLY", claim: "region burden is not measurable" } };
        case 3:
          return { ...routedReview("RETINA"), evidence: [source(category, ordinal, { category: "lesion_taxonomy_gate", taxonomy_level: "observation", finding_state: "UNCLASSIFIED" })], model: researchModel(LESION_MODEL, { taxonomy_level: "observation", inference_status: "completed" }) };
        case 4:
          return { ...routedReview("RETINA"), evidence: [source(category, ordinal, { category: "lesion_region", laterality: "OS", laterality_source: "DECLARED", state: "PRESENT" })], model: researchModel(LESION_MODEL, { inference_status: "completed" }) };
        case 5:
          return { ...routedReview("RETINA"), evidence: [source(category, ordinal, { category: "lesion_output", state: "INVALID" })], model: researchModel(LESION_MODEL, { inference_status: "blocked", output_state: "INVALID", integrity_state: "INVALID_GEOMETRY" }) };
        case 6:
          return { ...routedReview("RETINA"), evidence: [source(category, ordinal, { category: "lesion_metrics", state: "NOT_MEASURABLE" })], model: researchModel(LESION_MODEL, { inference_status: "completed" }), presentation: { status: "RESEARCH_ONLY", claim: "region metric limitation remains" } };
        case 7:
          return { ...routedReview("RETINA"), evidence: [source(category, ordinal, { category: "lesion_score", state: "RESEARCH" })], model: researchModel(LESION_MODEL, { score_semantics: "NOT_CALIBRATED", confidence_state: "NOT_REPORTED", inference_status: "completed" }) };
        case 8:
          return { ...routedReview("RETINA"), evidence: [source(category, ordinal, { category: "model_integrity_failure", state: "BLOCKED" })], model: researchModel(LESION_MODEL, { inference_status: "blocked", integrity_state: "HASH_MISMATCH" }) };
        default:
          break;
      }
      break;
    }
    case "oct": {
      switch (ordinal) {
        case 1:
          return { ...routedReview("RETINA"), evidence: [source(category, ordinal, { category: "oct_class_estimate", class: "CNV", state: "PRESENT", laterality: "OD" })], model: researchModel(OCT_MODEL, { predicted_class: "CNV", score_semantics: "MODEL_SCORE_NOT_CALIBRATED", inference_status: "completed" }) };
        case 2:
          return { ...routedReview("RETINA"), evidence: [source(category, ordinal, { category: "oct_class_estimate", class: "NORMAL", state: "PRESENT" })], model: researchModel(OCT_MODEL, { predicted_class: "NORMAL", score_semantics: "MODEL_SCORE_NOT_CALIBRATED", inference_status: "completed" }), presentation: { status: "RESEARCH_ONLY", claim: "NORMAL class estimate requires clinician review" } };
        case 3:
          return { ...routedReview("RETINA"), evidence: [source(category, ordinal, { category: "oct_class_estimate", class: "DME", state: "PRESENT", laterality: "OS" })], model: researchModel(OCT_MODEL, { predicted_class: "DME", inference_status: "completed" }) };
        case 4:
          return { ...routedReview("RETINA"), evidence: [source(category, ordinal, { category: "oct_scan_failure", state: "BLOCKED" })], model: researchModel(OCT_MODEL, { inference_status: "blocked", failure_state: "INSUFFICIENT_SCAN_QUALITY", selected_class: null }) };
        case 5:
          return { ...routedReview("RETINA"), evidence: [source(category, ordinal, { category: "oct_score", state: "RESEARCH" })], model: researchModel(OCT_MODEL, { predicted_class: "DRUSEN", calibration_state: "NOT_CALIBRATED", score_semantics: "MODEL_SCORE_NOT_CALIBRATED", inference_status: "completed" }) };
        case 6:
          return { ...routedReview("RETINA"), evidence: [source(category, ordinal, { category: "oct_domain_shift", state: "BLOCKED" })], model: researchModel(OCT_MODEL, { inference_status: "blocked", domain_state: "OUT_OF_DISTRIBUTION" }), presentation: { status: "OUT_OF_DISTRIBUTION", claim: "professional review required" } };
        case 7:
          return { ...routedReview("RETINA"), evidence: [source(category, ordinal, { category: "oct_aggregation", state: "NOT_COMPARABLE" })], model: researchModel(OCT_MODEL, { aggregation_state: "NOT_COMPARABLE", selected_class: null, inference_status: "blocked" }) };
        case 8:
          return { ...routedReview("RETINA"), evidence: [source(category, ordinal, { category: "oct_model_identity", state: "BLOCKED" })], model: researchModel(OCT_MODEL, { model_version: "candidate-v2", comparison_state: "MODEL_CHANGED", inference_status: "blocked" }) };
        default:
          break;
      }
      break;
    }
    case "worker": {
      switch (ordinal) {
        case 1:
          return { model: { inference_status: "blocked", failure_state: "WORKER_TIMEOUT", fallback_state: "NONE" } };
        case 2:
          return { model: { inference_status: "blocked", worker_exit: "NONZERO", fallback_state: "NONE" } };
        case 3:
          return { model: { inference_status: "cancelled", cancellation_state: "COOPERATIVE", fallback_state: "NONE" } };
        case 4:
          return { model: { inference_status: "blocked", deadline_state: "EXPIRED", cleanup_state: "REQUESTED" } };
        case 5:
          return { model: { inference_status: "blocked", termination_state: "UNSUPPORTED_PLATFORM", process_tree_attempted: false } };
        case 6:
          return { model: { inference_status: "blocked", termination_state: "FAILED", cleanup_state: "INCOMPLETE" } };
        case 7:
          return { model: { inference_status: "blocked", output_validation: "INVALID", fallback_state: "NONE" } };
        case 8:
          return { model: { inference_status: "blocked", integrity_state: "MISSING_ARTIFACT", fallback_state: "NONE" } };
        default:
          break;
      }
      break;
    }
    case "unsupported-specialty": {
      const specialty = UNSUPPORTED_SPECIALTIES[ordinal - 1];
      if (!specialty) break;
      return {
        routing: { specialty_id: specialty, routing_state: "ROUTED", execution_state: "UNAVAILABLE" },
        specialists: [{ specialty_id: specialty, status: "NO_VALIDATED_MODEL_AVAILABLE", requires_clinician_review: true, ...(specialty === "PEDIATRIC_OPHTHALMOLOGY" ? { population_validation: "REQUIRED" } : {}) }],
        presentation: { status: "NO_VALIDATED_MODEL_AVAILABLE", claim: "specialist review required" },
      };
    }
    case "empty-evidence": {
      switch (ordinal) {
        case 1:
          return { evidence: [], model: { inference_status: "blocked", reason: "NO_EVIDENCE" }, presentation: { status: "INSUFFICIENT_EVIDENCE", claim: "no executable evidence supplied" } };
        case 2:
          return { evidence: [], conditions: [], presentation: { status: "INSUFFICIENT_EVIDENCE", claim: "source attribution is unavailable" } };
        case 3:
          return { evidence: [], conditions: [{ condition_id: "iop_evidence_pattern", state: "UNABLE_TO_ASSESS" }], presentation: { status: "INSUFFICIENT_EVIDENCE", claim: "measurement evidence is unavailable" } };
        case 4:
          return { evidence: [source(category, ordinal, { category: "eye_pain", assertion: "ABSENT" })] };
        case 5:
          return { evidence: [source(category, ordinal, { category: "source_document", state: "PRESENT" })], model: { inference_status: "blocked", reason: "MODEL_UNAVAILABLE" } };
        case 6:
          return { conditions: [{ condition_id: "macular_class_pattern", state: "INSUFFICIENT_EVIDENCE" }], presentation: { status: "INSUFFICIENT_EVIDENCE", claim: "condition evidence is insufficient" } };
        case 7:
          return { conditions: [{ condition_id: "longitudinal_comparison", state: "MISSING_PRIOR_EVIDENCE" }], presentation: { status: "MISSING_PRIOR_EVIDENCE", claim: "prior evidence is unavailable" } };
        case 8:
          return { presentation: { status: "UNAVAILABLE", medication_state: "NO_DEFENSIBLE_SOURCE_FOUND" } };
        default:
          break;
      }
      break;
    }
    case "false-reassurance": {
      switch (ordinal) {
        case 1:
          return { evidence: [source(category, ordinal, { category: "ood_gate", state: "BLOCKED" })], model: { inference_status: "blocked", domain_state: "OUT_OF_DISTRIBUTION" }, presentation: { status: "OUT_OF_DISTRIBUTION", claim: "professional review required" } };
        case 2:
          return { evidence: [source(category, ordinal, { category: "image_quality", state: "FAIL" })], model: { inference_status: "blocked", quality_gate: "FAIL" }, presentation: { status: "IMAGE_NOT_SUITABLE", claim: "professional review required" } };
        case 3:
          return { evidence: [source(category, ordinal, { category: "model_unavailable", state: "BLOCKED" })], model: { inference_status: "blocked", reason: "NO_VALIDATED_MODEL_AVAILABLE" }, presentation: { status: "UNAVAILABLE", claim: "model output is unavailable" } };
        case 4:
          return { evidence: [source(category, ordinal, { category: "worker_failure", state: "BLOCKED" })], model: { inference_status: "blocked", failure_state: "WORKER_TIMEOUT", outcome: "UNAVAILABLE" }, presentation: { status: "UNAVAILABLE", claim: "worker failure requires review" } };
        case 5:
          return { evidence: [], model: researchModel(DR_MODEL, { inference_status: "completed", findings_state: "EMPTY" }), presentation: { status: "RESEARCH_ONLY", claim: "empty findings do not establish absence" } };
        case 6:
          return { evidence: [source(category, ordinal, { category: "oct_class_estimate", class: "NORMAL", state: "PRESENT" })], model: researchModel(OCT_MODEL, { predicted_class: "NORMAL", inference_status: "completed" }), presentation: { status: "RESEARCH_ONLY", claim: "NORMAL class estimate requires clinician review" } };
        case 7:
          return { evidence: [source(category, ordinal, { category: "symptom_assertion", assertion: "ABSENT" })], presentation: { status: "DOCUMENTED_ASSERTION", claim: "symptom report is not an image result" } };
        case 8:
          return { conditions: [{ condition_id: "macular_class_pattern", state: "POSSIBLE_CONDITION" }], presentation: { diagnosis_state: "NOT_CONFIRMED", medication_state: "NO_DEFENSIBLE_SOURCE_FOUND" } };
        default:
          break;
      }
      break;
    }
    case "security-tamper": {
      switch (ordinal) {
        case 1:
          return { model: { model_id: LESION_MODEL, inference_status: "blocked", integrity_state: "HASH_MISMATCH" } };
        case 2:
          return { evidence: [source(category, ordinal, { category: "audit_chain", integrity_state: "BROKEN" })] };
        case 3:
          return { routing: { request_state: "REJECTED", rejection_reason: "PATH_TRAVERSAL" }, presentation: { status: "REJECTED", claim: "request rejected before file access" } };
        case 4:
          return { routing: { authorization_state: "DENIED", http_status: 403 }, presentation: { status: "DENIED", claim: "authorization required" } };
        case 5:
          return { routing: { scope_state: "MISMATCH", authorization_state: "DENIED" }, presentation: { status: "DENIED", claim: "scope check failed" } };
        case 6:
          return { model: { transition_state: "REJECTED", requested_status: "CLINICALLY_VALIDATED" } };
        case 7:
          return { model: { restore_state: "REJECTED", integrity_state: "AUTHENTICATION_FAILED" } };
        case 8:
          return { model: { claim_ledger_state: "BLOCKED", integrity_state: "HASH_MISMATCH" } };
        default:
          break;
      }
      break;
    }
  }
  throw new Error(`No projection for ${category} ordinal ${ordinal}`);
}

function buildRedactedActuals(manifest: ValidationCaseManifest): Record<string, ValidationCaseActual> {
  const nextOrdinal = new Map<Phase5Category, number>();
  return Object.fromEntries(manifest.cases.map((validationCase) => {
    const category = phase5Category(validationCase.fixture_ref);
    const ordinal = (nextOrdinal.get(category) ?? 0) + 1;
    nextOrdinal.set(category, ordinal);
    return [validationCase.case_id, projectionForCase(category, ordinal)];
  }));
}

describe("Phase 5 false-negative reduction acceptance pack", () => {
  it("validates 64 synthetic cases with complete bounded metadata and category coverage", () => {
    const raw = readManifest();
    const result = validateValidationCaseManifest(raw);
    expect(result.valid, result.errors.join("; ")).toBe(true);
    expect(result.manifest?.package_id).toBe("phase5-false-negative-reduction-acceptance");
    expect(result.manifest?.data_classification).toBe("SYNTHETIC_ONLY");
    expect(result.manifest?.cases).toHaveLength(64);
    expect(JSON.stringify(raw)).not.toMatch(/\b(?:mrn|medical record|dob|patient name|ssn|email|phone)\b/i);

    const counts = Object.fromEntries(CATEGORY_ORDER.map((category) => [category, 0])) as Record<Phase5Category, number>;
    for (const validationCase of result.manifest!.cases) {
      counts[phase5Category(validationCase.fixture_ref)] += 1;
      expect(validationCase.case_id).toMatch(/^synthetic-/);
      expect(validationCase.fixture_ref).toMatch(/^synthetic-/);
      expect(validationCase.expected_models).toBeDefined();
      expect(validationCase.expected_routing).toBeDefined();
      expect(validationCase.expected_specialists).toBeDefined();
      expect(validationCase.expected_possible_conditions).toBeDefined();
      expect(validationCase.expected_medication_behavior).toBe("NO_DEFENSIBLE_SOURCE_FOUND");
      expect(validationCase.expected_provenance?.length).toBeGreaterThan(0);
      expect(validationCase.forbidden_claims?.length).toBeGreaterThan(0);
      expect(validationCase.known_limitations?.length).toBeGreaterThan(0);
      expect(validationCase.ground_truth_scope).not.toBe("CLINICAL_DIAGNOSIS");
      expect(validationCase.assertions.length).toBeGreaterThan(0);
    }
    expect(counts).toEqual(Object.fromEntries(CATEGORY_ORDER.map((category) => [category, 8])));
  });

  it("runs deterministic redacted actual projections and passes every case and assertion", () => {
    const manifest = validatedManifest();
    const actuals = buildRedactedActuals(manifest);
    const secondRunActuals = buildRedactedActuals(manifest);
    expect(actuals).toEqual(secondRunActuals);
    expect(JSON.stringify(actuals)).not.toMatch(/\b(?:mrn|medical record|dob|patient name|ssn|email|phone)\b/i);
    expect(Object.keys(actuals).every((caseId) => caseId.startsWith("synthetic-"))).toBe(true);
    expect(Object.values(actuals).every((actual) => !Object.keys(actual).some((key) => /(?:bytes|raw_input|phi|patient_id)/i.test(key)))).toBe(true);

    const result = runValidationCasePackage(manifest, actuals);
    expect(result.package_id).toBe("phase5-false-negative-reduction-acceptance");
    expect(result.passed).toBe(true);
    expect(result.cases).toHaveLength(64);
    expect(result.cases.every((entry) => entry.passed)).toBe(true);
    expect(result.cases.flatMap((entry) => entry.assertions)).toHaveLength(145);
  });

  it("fails closed for missing projections and representative mutations across all categories", () => {
    const manifest = validatedManifest();
    const completeActuals = buildRedactedActuals(manifest);
    const missingActuals = { ...completeActuals };
    delete missingActuals["synthetic-phase5-001"];
    const missingResult = runValidationCasePackage(manifest, missingActuals);
    expect(missingResult.passed).toBe(false);
    expect(missingResult.cases.find((entry) => entry.case_id === "synthetic-phase5-001")?.assertions.every((assertion) => assertion.detail === "no actual output supplied")).toBe(true);

    const mutants: Array<{ caseId: string; mutate: (actual: ValidationCaseActual) => void }> = [
      { caseId: "synthetic-phase5-001", mutate: (actual) => { actual.model = { ...actual.model!, validation_status: "CLINICALLY_VALIDATED" }; } },
      { caseId: "synthetic-phase5-012", mutate: (actual) => { actual.evidence = [{ ...actual.evidence![0], laterality: "OD" }]; } },
      { caseId: "synthetic-phase5-020", mutate: (actual) => { actual.model = { ...actual.model!, predicted_class: "NORMAL" }; } },
      { caseId: "synthetic-phase5-029", mutate: (actual) => { actual.model = { ...actual.model!, process_tree_attempted: true }; } },
      { caseId: "synthetic-phase5-033", mutate: (actual) => { actual.specialists = [{ ...actual.specialists![0], status: "EXECUTED" }]; } },
      { caseId: "synthetic-phase5-041", mutate: (actual) => { actual.evidence = [{ category: "ai_finding" }]; } },
      { caseId: "synthetic-phase5-054", mutate: (actual) => { actual.presentation = { status: "RESEARCH_ONLY", claim: "healthy macula" }; } },
      { caseId: "synthetic-phase5-057", mutate: (actual) => { actual.model = { ...actual.model!, integrity_state: "TRUSTED" }; } },
    ];

    for (const mutant of mutants) {
      const actuals = buildRedactedActuals(manifest);
      mutant.mutate(actuals[mutant.caseId]!);
      const result = runValidationCasePackage(manifest, actuals);
      expect(result.passed, mutant.caseId).toBe(false);
      expect(result.cases.find((entry) => entry.case_id === mutant.caseId)?.passed, mutant.caseId).toBe(false);
    }
  });
});
