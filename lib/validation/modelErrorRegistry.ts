/**
 * Persistence-safe registry records for adjudicated validation errors.
 *
 * Records are synthetic-case references only.  They intentionally contain no
 * patient IDs, input bytes, free-text clinical notes, or raw model output.
 * This is an audit schema, not a clinical-risk calculation or a promotion
 * mechanism for a model lifecycle state.
 */

export const MODEL_ERROR_RECORD_SCHEMA_VERSION = "visionscan-model-error-v1" as const;
/** Canonical error types from the validation contract. The *_FAILURE aliases
 * are retained for source compatibility with early v1 fixtures. */
export type ModelErrorCategory =
  | "FALSE_POSITIVE" | "FALSE_NEGATIVE" | "MISCLASSIFICATION"
  | "OOD_FALSE_REJECTION" | "OOD_FALSE_ACCEPTANCE" | "LOCALIZATION_ERROR"
  | "ROUTING_ERROR" | "ROI_ERROR" | "LATERALITY_ERROR" | "MODEL_TIMEOUT"
  | "CONTRACT_FAILURE" | "UNSUPPORTED_PATHOLOGY"
  | "ROUTING_FAILURE" | "OUTPUT_CONTRACT_FAILURE" | "SPECIALIST_FAILURE"
  | "FORBIDDEN_OUTPUT" | "QUALITY_FAILURE" | "DOMAIN_FAILURE"
  | "LATERALITY_MISMATCH" | "URGENCY_SAFETY_FAILURE" | "OTHER_VALIDATION_FAILURE";
export type LegacyModelErrorStatus = "OPEN" | "ADJUDICATED" | "REMEDIATED" | "DISMISSED";
export type ModelErrorStatus = LegacyModelErrorStatus | ModelErrorLifecycle;
/** Canonical lifecycle names. `status` remains the narrow legacy storage mapping. */
export type ModelErrorLifecycle = "UNREVIEWED" | "ENGINEERING_CONFIRMED" | "CLINICIAN_REVIEWED" | "DISMISSED" | "KNOWN_LIMITATION" | "FIXED" | "REGRESSION_PROTECTED";
export type AdjudicationOutcome = "CONFIRMED" | "NOT_CONFIRMED" | "INSUFFICIENT_EVIDENCE";
export type AdjudicationRationaleCode = "REFERENCE_STANDARD" | "CONTRACT_VIOLATION" | "ROUTING_CONFLICT" | "INSUFFICIENT_REFERENCE_STANDARD" | "DUPLICATE";

export interface ModelErrorAdjudication {
  outcome: AdjudicationOutcome;
  rationale_code: AdjudicationRationaleCode;
  adjudicated_at: string;
  /** A role, never a person identifier. */
  adjudicator_role: "CLINICIAN_REVIEWER" | "VALIDATION_REVIEWER";
}

export interface ModelErrorRemediation {
  remediation_id: string;
  verification_case_ids: string[];
  verified_at: string;
}

/** Controlled expected/observed result only; intentionally no narrative or raw output field. */
export interface ModelErrorProjection {
  state: "PRESENT" | "ABSENT" | "UNCERTAIN" | "BLOCKED" | "NOT_RUN" | "INVALID";
  target_id: string;
  evidence_refs: string[];
}

export interface ModelErrorReview {
  reviewer_role: "CLINICIAN_REVIEWER" | "VALIDATION_REVIEWER" | "ENGINEERING_REVIEWER";
  reviewed_at: string;
}

export interface ModelErrorMitigation {
  mitigation_id: string;
  state: "PLANNED" | "IMPLEMENTED" | "VERIFIED";
  verified_at: string | null;
}

export interface ModelErrorRegressionTest {
  case_id: string;
  assertion_ids: string[];
  verified_at: string;
}

export interface ModelErrorRecord {
  schema_version: typeof MODEL_ERROR_RECORD_SCHEMA_VERSION;
  error_id: string;
  case_id: string;
  model_id: string;
  model_version: string;
  category: ModelErrorCategory;
  /** Alias used by the adjudication worksheet; category remains canonical in storage. */
  error_type?: ModelErrorCategory;
  target_id: string;
  status: ModelErrorStatus;
  /** Optional only for source-compatible reads of v1 records; all new records should set it. */
  lifecycle?: ModelErrorLifecycle;
  input_hash_or_fixture_id?: string;
  modality?: "FUNDUS" | "OCT" | "DOCUMENT" | "MULTIMODAL" | "UNKNOWN";
  laterality?: "OD" | "OS" | "OU" | "UNKNOWN";
  quality_state?: "PASS" | "BORDERLINE" | "FAIL" | "UNKNOWN";
  domain_state?: "IN_DISTRIBUTION" | "OUT_OF_DISTRIBUTION" | "UNKNOWN";
  expected?: ModelErrorProjection;
  observed?: ModelErrorProjection;
  severity?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "UNKNOWN";
  reviewer?: ModelErrorReview | null;
  mitigation?: ModelErrorMitigation | null;
  regression_test?: ModelErrorRegressionTest | null;
  observed_at: string;
  /** Alias for observed_at used by exported registry spreadsheets. */
  date?: string;
  /** Explicit adjudication vocabulary for consumers that do not use status. */
  adjudication_status?: ModelErrorLifecycle;
  assertion_ids: string[];
  adjudication: ModelErrorAdjudication | null;
  remediation: ModelErrorRemediation | null;
}

export interface ModelErrorValidationResult { valid: boolean; errors: string[]; record: ModelErrorRecord | null }

const ID = /^[a-z0-9][a-z0-9._-]{2,127}$/;
const SYNTHETIC_CASE_ID = /^synthetic-[a-z0-9][a-z0-9-]{2,127}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const CATEGORIES = new Set<ModelErrorCategory>([
  "FALSE_POSITIVE", "FALSE_NEGATIVE", "MISCLASSIFICATION", "OOD_FALSE_REJECTION", "OOD_FALSE_ACCEPTANCE", "LOCALIZATION_ERROR",
  "ROUTING_ERROR", "ROI_ERROR", "LATERALITY_ERROR", "MODEL_TIMEOUT", "CONTRACT_FAILURE", "UNSUPPORTED_PATHOLOGY",
  "ROUTING_FAILURE", "OUTPUT_CONTRACT_FAILURE", "SPECIALIST_FAILURE", "FORBIDDEN_OUTPUT", "QUALITY_FAILURE", "DOMAIN_FAILURE",
  "LATERALITY_MISMATCH", "URGENCY_SAFETY_FAILURE", "OTHER_VALIDATION_FAILURE",
]);
const STATUSES = new Set<ModelErrorStatus>(["OPEN", "ADJUDICATED", "REMEDIATED", "DISMISSED", "UNREVIEWED", "ENGINEERING_CONFIRMED", "CLINICIAN_REVIEWED", "KNOWN_LIMITATION", "FIXED", "REGRESSION_PROTECTED"]);
const LIFECYCLES = new Set<ModelErrorLifecycle>(["UNREVIEWED", "ENGINEERING_CONFIRMED", "CLINICIAN_REVIEWED", "DISMISSED", "KNOWN_LIMITATION", "FIXED", "REGRESSION_PROTECTED"]);
const OUTCOMES = new Set<AdjudicationOutcome>(["CONFIRMED", "NOT_CONFIRMED", "INSUFFICIENT_EVIDENCE"]);
const RATIONALES = new Set<AdjudicationRationaleCode>(["REFERENCE_STANDARD", "CONTRACT_VIOLATION", "ROUTING_CONFLICT", "INSUFFICIENT_REFERENCE_STANDARD", "DUPLICATE"]);
const MODALITIES = new Set(["FUNDUS", "OCT", "DOCUMENT", "MULTIMODAL", "UNKNOWN"]);
const LATERALITIES = new Set(["OD", "OS", "OU", "UNKNOWN"]);
const QUALITY = new Set(["PASS", "BORDERLINE", "FAIL", "UNKNOWN"]);
const DOMAIN = new Set(["IN_DISTRIBUTION", "OUT_OF_DISTRIBUTION", "UNKNOWN"]);
const SEVERITY = new Set(["LOW", "MEDIUM", "HIGH", "CRITICAL", "UNKNOWN"]);
const PROJECTION_STATES = new Set(["PRESENT", "ABSENT", "UNCERTAIN", "BLOCKED", "NOT_RUN", "INVALID"]);

function plain(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function exactKeys(value: Record<string, unknown>, keys: string[], prefix: string, errors: string[]): void { for (const key of Object.keys(value)) if (!keys.includes(key)) errors.push(`${prefix} unknown field: ${key}`); }
function safeId(value: unknown): boolean { return typeof value === "string" && ID.test(value); }
function instant(value: unknown): boolean { return typeof value === "string" && ISO_INSTANT.test(value) && Number.isFinite(Date.parse(value)); }
function ids(value: unknown, synthetic = false): value is string[] { return Array.isArray(value) && value.length > 0 && value.every((id) => typeof id === "string" && (synthetic ? SYNTHETIC_CASE_ID.test(id) : ID.test(id))); }
function projection(value: unknown, prefix: string, errors: string[]): boolean {
  if (!plain(value)) { errors.push(`${prefix} must be a structured projection`); return false; }
  exactKeys(value, ["state", "target_id", "evidence_refs"], prefix, errors);
  const valid = typeof value.state === "string" && PROJECTION_STATES.has(value.state) && safeId(value.target_id) && ids(value.evidence_refs);
  if (!valid) errors.push(`${prefix} must contain a controlled state, target_id, and evidence_refs`);
  return valid;
}
function review(value: unknown, prefix: string, errors: string[]): boolean {
  if (!plain(value)) { errors.push(`${prefix} must be null or a review object`); return false; }
  exactKeys(value, ["reviewer_role", "reviewed_at"], prefix, errors);
  const valid = (value.reviewer_role === "CLINICIAN_REVIEWER" || value.reviewer_role === "VALIDATION_REVIEWER" || value.reviewer_role === "ENGINEERING_REVIEWER") && instant(value.reviewed_at);
  if (!valid) errors.push(`${prefix} has invalid reviewer role or date`);
  return valid;
}
function mitigation(value: unknown, prefix: string, errors: string[]): boolean {
  if (!plain(value)) { errors.push(`${prefix} must be null or a mitigation object`); return false; }
  exactKeys(value, ["mitigation_id", "state", "verified_at"], prefix, errors);
  const valid = safeId(value.mitigation_id) && (value.state === "PLANNED" || value.state === "IMPLEMENTED" || value.state === "VERIFIED") && (value.verified_at === null || instant(value.verified_at));
  if (!valid || (value.state === "VERIFIED" && !instant(value.verified_at))) errors.push(`${prefix} has invalid mitigation fields`);
  return valid && (value.state !== "VERIFIED" || instant(value.verified_at));
}
function regressionTest(value: unknown, prefix: string, errors: string[]): boolean {
  if (!plain(value)) { errors.push(`${prefix} must be null or a regression test object`); return false; }
  exactKeys(value, ["case_id", "assertion_ids", "verified_at"], prefix, errors);
  const valid = typeof value.case_id === "string" && SYNTHETIC_CASE_ID.test(value.case_id) && ids(value.assertion_ids) && instant(value.verified_at);
  if (!valid) errors.push(`${prefix} must reference synthetic case and assertion ids`);
  return valid;
}

function legacyStatus(value: ModelErrorStatus): LegacyModelErrorStatus {
  if (value === "UNREVIEWED") return "OPEN";
  if (value === "ENGINEERING_CONFIRMED" || value === "CLINICIAN_REVIEWED" || value === "KNOWN_LIMITATION") return "ADJUDICATED";
  if (value === "FIXED" || value === "REGRESSION_PROTECTED") return "REMEDIATED";
  if (value === "DISMISSED") return "DISMISSED";
  return value;
}

/** Maps legacy storage state to the stricter canonical lifecycle vocabulary. */
export function lifecycleForLegacyStatus(status: ModelErrorStatus, adjudication: ModelErrorAdjudication | null): ModelErrorLifecycle {
  if (status === "OPEN") return "UNREVIEWED";
  if (status === "DISMISSED") return "DISMISSED";
  if (status === "REMEDIATED") return "FIXED";
  return adjudication?.adjudicator_role === "CLINICIAN_REVIEWER" ? "CLINICIAN_REVIEWED" : "ENGINEERING_CONFIRMED";
}

/** Strictly validate a record before it is sent to dbPut or JSON.stringify. */
export function validateModelErrorRecord(input: unknown): ModelErrorValidationResult {
  const errors: string[] = [];
  if (!plain(input)) return { valid: false, errors: ["record must be a plain object"], record: null };
  exactKeys(input, ["schema_version", "error_id", "case_id", "model_id", "model_version", "category", "error_type", "target_id", "status", "lifecycle", "adjudication_status", "input_hash_or_fixture_id", "modality", "laterality", "quality_state", "domain_state", "expected", "observed", "severity", "reviewer", "mitigation", "regression_test", "observed_at", "date", "assertion_ids", "adjudication", "remediation"], "record", errors);
  if (input.schema_version !== MODEL_ERROR_RECORD_SCHEMA_VERSION) errors.push("unsupported schema_version");
  if (typeof input.error_id !== "string" || !/^model-error-[a-z0-9][a-z0-9._-]{2,115}$/.test(input.error_id)) errors.push("error_id must start with model-error-");
  if (typeof input.case_id !== "string" || !SYNTHETIC_CASE_ID.test(input.case_id)) errors.push("case_id must reference a synthetic validation case");
  for (const field of ["model_id", "model_version", "target_id"] as const) if (!safeId(input[field])) errors.push(`${field} must be a safe identifier`);
  const category = (input.category ?? input.error_type) as ModelErrorCategory | undefined;
  if (typeof category !== "string" || !CATEGORIES.has(category)) errors.push("category or error_type is required and invalid");
  if (input.error_type !== undefined && (typeof input.error_type !== "string" || !CATEGORIES.has(input.error_type as ModelErrorCategory))) errors.push("error_type is invalid");
  if (typeof input.error_type === "string" && typeof input.category === "string" && input.error_type !== input.category) errors.push("category and error_type must match");
  if (typeof input.status !== "string" || !STATUSES.has(input.status as ModelErrorStatus)) errors.push("status is invalid");
  const normalizedStatus = typeof input.status === "string" && STATUSES.has(input.status as ModelErrorStatus) ? legacyStatus(input.status as ModelErrorStatus) : null;
  if (input.lifecycle !== undefined && (typeof input.lifecycle !== "string" || !LIFECYCLES.has(input.lifecycle as ModelErrorLifecycle))) errors.push("lifecycle is invalid");
  if (input.adjudication_status !== undefined && (typeof input.adjudication_status !== "string" || !LIFECYCLES.has(input.adjudication_status as ModelErrorLifecycle))) errors.push("adjudication_status is invalid");
  if (typeof input.adjudication_status === "string" && typeof input.lifecycle === "string" && input.adjudication_status !== input.lifecycle) errors.push("lifecycle and adjudication_status must match");
  if (typeof input.status === "string" && typeof input.adjudication_status === "string" && legacyStatus(input.status as ModelErrorStatus) !== legacyStatus(input.adjudication_status as ModelErrorLifecycle)) errors.push("status and adjudication_status must match");
  if (input.input_hash_or_fixture_id !== undefined && (typeof input.input_hash_or_fixture_id !== "string" || !(/^[a-f0-9]{64}$/.test(input.input_hash_or_fixture_id) || /^synthetic-fixtures\/[a-z0-9][a-z0-9._/-]{2,255}$/.test(input.input_hash_or_fixture_id)))) errors.push("input_hash_or_fixture_id must be a SHA-256 or synthetic fixture id");
  if (input.modality !== undefined && (typeof input.modality !== "string" || !MODALITIES.has(input.modality))) errors.push("modality is invalid");
  if (input.laterality !== undefined && (typeof input.laterality !== "string" || !LATERALITIES.has(input.laterality))) errors.push("laterality is invalid");
  if (input.quality_state !== undefined && (typeof input.quality_state !== "string" || !QUALITY.has(input.quality_state))) errors.push("quality_state is invalid");
  if (input.domain_state !== undefined && (typeof input.domain_state !== "string" || !DOMAIN.has(input.domain_state))) errors.push("domain_state is invalid");
  if (input.severity !== undefined && (typeof input.severity !== "string" || !SEVERITY.has(input.severity))) errors.push("severity is invalid");
  if (input.expected !== undefined) projection(input.expected, "expected", errors);
  if (input.observed !== undefined) projection(input.observed, "observed", errors);
  let reviewerValid = false;
  if (input.reviewer !== undefined && input.reviewer !== null) reviewerValid = review(input.reviewer, "reviewer", errors);
  let mitigationValid = false;
  if (input.mitigation !== undefined && input.mitigation !== null) mitigationValid = mitigation(input.mitigation, "mitigation", errors);
  let regressionValid = false;
  if (input.regression_test !== undefined && input.regression_test !== null) regressionValid = regressionTest(input.regression_test, "regression_test", errors);
  const observedAt = input.observed_at ?? input.date;
  if (!instant(observedAt)) errors.push("observed_at or date must be an ISO UTC instant");
  if (input.date !== undefined && !instant(input.date)) errors.push("date must be an ISO UTC instant");
  if (!ids(input.assertion_ids)) errors.push("assertion_ids must be non-empty safe identifiers");

  let adjudicationValid = false;
  if (input.adjudication !== null) {
    if (!plain(input.adjudication)) errors.push("adjudication must be null or a plain object");
    else {
      exactKeys(input.adjudication, ["outcome", "rationale_code", "adjudicated_at", "adjudicator_role"], "adjudication", errors);
      const a = input.adjudication;
      adjudicationValid = typeof a.outcome === "string" && OUTCOMES.has(a.outcome as AdjudicationOutcome) && typeof a.rationale_code === "string" && RATIONALES.has(a.rationale_code as AdjudicationRationaleCode) && instant(a.adjudicated_at) && (a.adjudicator_role === "CLINICIAN_REVIEWER" || a.adjudicator_role === "VALIDATION_REVIEWER");
      if (!adjudicationValid) errors.push("adjudication has invalid or unsafe values");
    }
  }
  let remediationValid = false;
  if (input.remediation !== null) {
    if (!plain(input.remediation)) errors.push("remediation must be null or a plain object");
    else {
      exactKeys(input.remediation, ["remediation_id", "verification_case_ids", "verified_at"], "remediation", errors);
      remediationValid = safeId(input.remediation.remediation_id) && ids(input.remediation.verification_case_ids, true) && instant(input.remediation.verified_at);
      if (!remediationValid) errors.push("remediation has invalid or unsafe values");
    }
  }
  if ((normalizedStatus === "ADJUDICATED" || normalizedStatus === "REMEDIATED" || normalizedStatus === "DISMISSED") && !adjudicationValid) errors.push(`${input.status} records require a valid adjudication`);
  if (normalizedStatus === "OPEN" && input.adjudication !== null) errors.push("OPEN records must not contain an adjudication");
  if (normalizedStatus === "REMEDIATED" && !remediationValid) errors.push("REMEDIATED records require valid remediation verification");
  if (normalizedStatus !== "REMEDIATED" && input.remediation !== null) errors.push("remediation is allowed only for REMEDIATED records");
  if (normalizedStatus === "DISMISSED" && plain(input.adjudication) && input.adjudication.outcome === "CONFIRMED") errors.push("DISMISSED records cannot have CONFIRMED adjudication");
  if (typeof input.status === "string" && STATUSES.has(input.status as ModelErrorStatus) && input.lifecycle !== undefined) {
    const allowed = normalizedStatus === "OPEN" ? ["UNREVIEWED"] : normalizedStatus === "ADJUDICATED" ? ["ENGINEERING_CONFIRMED", "CLINICIAN_REVIEWED", "KNOWN_LIMITATION"] : normalizedStatus === "REMEDIATED" ? ["FIXED", "REGRESSION_PROTECTED"] : ["DISMISSED"];
    if (!allowed.includes(input.lifecycle as ModelErrorLifecycle)) errors.push("lifecycle is incompatible with legacy status");
  }
  if (input.lifecycle === "ENGINEERING_CONFIRMED" && !reviewerValid && !adjudicationValid) errors.push("ENGINEERING_CONFIRMED requires a reviewer or adjudication");
  if (input.lifecycle === "CLINICIAN_REVIEWED" && !(plain(input.reviewer) && input.reviewer.reviewer_role === "CLINICIAN_REVIEWER") && !(plain(input.adjudication) && input.adjudication.adjudicator_role === "CLINICIAN_REVIEWER")) errors.push("CLINICIAN_REVIEWED requires clinician review");
  if (input.lifecycle === "KNOWN_LIMITATION" && !adjudicationValid) errors.push("KNOWN_LIMITATION requires adjudication");
  if ((input.lifecycle === "FIXED" || input.lifecycle === "REGRESSION_PROTECTED") && !mitigationValid && !remediationValid) errors.push(`${input.lifecycle} requires mitigation or remediation`);
  if (input.lifecycle === "REGRESSION_PROTECTED" && !regressionValid) errors.push("REGRESSION_PROTECTED requires a regression_test");
  if (errors.length > 0) return { valid: false, errors, record: null };
  // Normalize the worksheet aliases only when the canonical field was
  // omitted, preserving byte-for-byte round trips for canonical v1 records.
  const normalized = {
    ...input,
    ...(input.category === undefined && category ? { category } : {}),
    ...(input.observed_at === undefined && observedAt ? { observed_at: observedAt } : {}),
    ...(input.lifecycle === undefined && input.adjudication_status ? { lifecycle: input.adjudication_status } : {}),
  } as unknown as ModelErrorRecord;
  return { valid: true, errors, record: normalized };
}

/** Safe JSON boundary for a database/json document store. Invalid records throw before persistence. */
export function serializeModelErrorRecord(input: unknown): string {
  const result = validateModelErrorRecord(input);
  if (!result.valid || !result.record) throw new Error(`Invalid model error record: ${result.errors.join("; ")}`);
  return JSON.stringify(result.record);
}

/** Safe read boundary: malformed, legacy, or PHI-bearing records are rejected rather than coerced. */
export function parseModelErrorRecord(serialized: string): ModelErrorRecord {
  let parsed: unknown;
  try { parsed = JSON.parse(serialized); } catch { throw new Error("Invalid model error record: invalid JSON"); }
  const result = validateModelErrorRecord(parsed);
  if (!result.valid || !result.record) throw new Error(`Invalid model error record: ${result.errors.join("; ")}`);
  return result.record;
}
