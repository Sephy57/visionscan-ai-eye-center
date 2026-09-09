/**
 * Deterministic, synthetic-only validation case packages.
 *
 * The harness operates on redacted caller projections only: it never runs a
 * model, reads input bytes, stores a case, or promotes a model. The manifest
 * is deliberately narrow so source-controlled fixtures cannot become a store
 * for patient identifiers, notes, or raw clinical output.
 */

export const VALIDATION_CASE_PACKAGE_SCHEMA_VERSION = "visionscan-validation-case-v1" as const;
export type ValidationCaseAssertionKind = "evidence" | "routing" | "model" | "specialist" | "condition" | "forbidden_output" | "contract";
export type ValidationAssertionOperator = "MUST_EXIST" | "MUST_NOT_EXIST" | "MAY_EXIST" | "MUST_EQUAL" | "MUST_REFERENCE" | "MUST_BE_LATERALITY" | "MUST_BE_NEGATED" | "MUST_BE_UNCERTAIN" | "MUST_BE_SOURCE_ATTRIBUTED" | "MUST_BE_RESEARCH_ONLY";
export type ValidationAssertionTarget = "evidence" | "routing" | "model" | "specialist" | "condition" | "presentation";
export type GroundTruthScope = "KNOWN_FACT" | "RESEARCH_OUTPUT" | "CONDITION_ASSESSMENT" | "CLINICAL_DIAGNOSIS";
export type ValidationLaterality = "OD" | "OS" | "OU" | "UNKNOWN";
export type JsonScalar = string | number | boolean | null;
export type JsonRecord = { [key: string]: JsonValue };
export type JsonValue = JsonScalar | JsonValue[] | JsonRecord;

export interface ValidationCaseManifest {
  schema_version: typeof VALIDATION_CASE_PACKAGE_SCHEMA_VERSION;
  package_id: string;
  data_classification: "SYNTHETIC_ONLY";
  cases: ValidationCase[];
}

/** Metadata is optional but, when declared, is a de-identified test contract rather than clinical truth. */
export interface ValidationCase {
  case_id: string;
  fixture_ref: string;
  /** Synthetic asset descriptors; bytes remain outside the source-controlled package. */
  assets?: ValidationCaseAsset[];
  case_version?: string;
  description?: string;
  synthetic_patient_id?: string;
  synthetic_encounter_id?: string;
  expected_laterality?: ValidationLaterality;
  expected_modalities?: string[];
  expected_page_types?: string[];
  expected_models?: Array<{ model_id: string; model_version?: string }>;
  expected_evidence_categories?: string[];
  expected_urgency?: "NONE" | "ROUTINE" | "SOON" | "URGENT" | "EMERGENT" | "UNKNOWN";
  known_limitations?: string[];
  /** Scope controls interpretation: no enum value is a diagnosis assertion or clinical-validation claim. */
  ground_truth_scope?: GroundTruthScope;
  assertions: ValidationCaseAssertion[];
}

export interface ValidationCaseAsset {
  asset_id: string;
  kind: "DOCUMENT" | "FUNDUS" | "OCT" | "REPORT" | "OTHER";
  fixture_ref: string;
  laterality?: ValidationLaterality;
  page?: number;
}

interface MatchAssertionBase { assertion_id: string; match: Record<string, JsonScalar> }
export interface EvidenceAssertion extends MatchAssertionBase { kind: "evidence" }
export interface SpecialistAssertion extends MatchAssertionBase { kind: "specialist" }
export interface ConditionAssertion extends MatchAssertionBase { kind: "condition" }
export interface RoutingAssertion extends MatchAssertionBase { kind: "routing" }
export interface ModelAssertion extends MatchAssertionBase { kind: "model" }
export interface ForbiddenOutputAssertion {
  kind: "forbidden_output";
  assertion_id: string;
  /** Case-insensitive literals. Wildcards and regular expressions are unsupported. */
  forbidden_literals: string[];
}
/**
 * Rich assertion form. `match` filters target records first. For MUST_EQUAL,
 * `path` is a dot-separated field path relative to a matching target record.
 * MUST_REFERENCE requires `path` to equal `reference`; other semantic
 * operators have fixed interpretation and cannot execute code.
 */
export interface ContractAssertion {
  kind: "contract";
  assertion_id: string;
  target: ValidationAssertionTarget;
  operator: ValidationAssertionOperator;
  match?: Record<string, JsonScalar>;
  path?: string;
  value?: JsonScalar;
  reference?: JsonScalar;
  laterality?: ValidationLaterality;
}
export type ValidationCaseAssertion = EvidenceAssertion | SpecialistAssertion | ConditionAssertion | RoutingAssertion | ModelAssertion | ForbiddenOutputAssertion | ContractAssertion;

/** A minimal execution projection, explicitly excluding input bytes and patient identifiers. */
export interface ValidationCaseActual {
  evidence?: Array<Record<string, JsonScalar>>;
  routing?: Record<string, JsonScalar>;
  model?: Record<string, JsonScalar>;
  specialists?: Array<Record<string, JsonScalar>>;
  conditions?: Array<Record<string, JsonScalar>>;
  /** Only structured output intended for presentation is inspected for forbidden claims. */
  presentation?: JsonValue;
}

export interface CaseAssertionResult { assertion_id: string; kind: ValidationCaseAssertionKind; passed: boolean; detail: string }
export interface ValidationCaseRunResult { case_id: string; passed: boolean; assertions: CaseAssertionResult[] }
export interface ValidationCasePackageResult { package_id: string; passed: boolean; cases: ValidationCaseRunResult[] }
export interface ManifestValidationResult { valid: boolean; errors: string[]; manifest: ValidationCaseManifest | null }

const ID = /^[a-z0-9][a-z0-9._-]{2,127}$/;
const SAFE_LABEL = /^[A-Z][A-Z0-9_]{1,63}$/;
const CASE_VERSION = /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/;
const PATH = /^[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*){0,7}$/;
const SYNTHETIC_CASE_ID = /^synthetic-[a-z0-9][a-z0-9-]{2,127}$/;
const SYNTHETIC_FIXTURE = /^synthetic-[a-z0-9][a-z0-9._/-]{2,255}$/;
const SYNTHETIC_PATIENT_ID = /^synthetic-patient-[a-z0-9][a-z0-9-]{2,127}$/;
const SYNTHETIC_ENCOUNTER_ID = /^synthetic-encounter-[a-z0-9][a-z0-9-]{2,127}$/;
const ASSERTION_KINDS = new Set<ValidationCaseAssertionKind>(["evidence", "routing", "model", "specialist", "condition", "forbidden_output", "contract"]);
const OPERATORS = new Set<ValidationAssertionOperator>(["MUST_EXIST", "MUST_NOT_EXIST", "MAY_EXIST", "MUST_EQUAL", "MUST_REFERENCE", "MUST_BE_LATERALITY", "MUST_BE_NEGATED", "MUST_BE_UNCERTAIN", "MUST_BE_SOURCE_ATTRIBUTED", "MUST_BE_RESEARCH_ONLY"]);
const TARGETS = new Set<ValidationAssertionTarget>(["evidence", "routing", "model", "specialist", "condition", "presentation"]);
const LATERALITIES = new Set<ValidationLaterality>(["OD", "OS", "OU", "UNKNOWN"]);
const SCOPES = new Set<GroundTruthScope>(["KNOWN_FACT", "RESEARCH_OUTPUT", "CONDITION_ASSESSMENT", "CLINICAL_DIAGNOSIS"]);
const URGENCY = new Set(["NONE", "ROUTINE", "SOON", "URGENT", "EMERGENT", "UNKNOWN"]);
const ASSET_KINDS = new Set(["DOCUMENT", "FUNDUS", "OCT", "REPORT", "OTHER"]);

function isPlainRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function isScalar(value: unknown): value is JsonScalar { return value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)); }
function isMatch(value: unknown): value is Record<string, JsonScalar> { return isPlainRecord(value) && Object.keys(value).length > 0 && Object.values(value).every(isScalar); }
function matches(candidate: Record<string, JsonScalar>, expected: Record<string, JsonScalar>): boolean { return Object.entries(expected).every(([key, value]) => candidate[key] === value); }
function outputStrings(value: JsonValue | undefined): string[] { if (typeof value === "string") return [value]; if (!value || typeof value !== "object") return []; return Array.isArray(value) ? value.flatMap(outputStrings) : Object.values(value).flatMap(outputStrings); }
function labels(value: unknown): boolean { return Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "string" && SAFE_LABEL.test(v)); }
function ids(value: unknown): boolean { return Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "string" && ID.test(v)); }
function safeDescription(value: unknown): boolean {
  // A bounded fixture caption, not an open clinical-note field. Reject obvious direct identifiers.
  return typeof value === "string" && value.length > 0 && value.length <= 280 && !/[\r\n]/.test(value) && !/\b(?:patient|mrn|medical record|dob)\b|@|\+?\d[\d() -]{7,}\b/i.test(value);
}
function pathValue(record: Record<string, JsonScalar>, path: string): JsonScalar | undefined {
  let value: unknown = record;
  for (const segment of path.split(".")) { if (!isPlainRecord(value) || !(segment in value)) return undefined; value = value[segment]; }
  return isScalar(value) ? value : undefined;
}
function recordFromPresentation(value: JsonValue | undefined): Record<string, JsonScalar> | null {
  if (!isPlainRecord(value) || Object.values(value).some((item) => !isScalar(item))) return null;
  return value as Record<string, JsonScalar>;
}

function validateMetadata(entry: Record<string, unknown>, prefix: string, errors: string[]): void {
  if (entry.case_version !== undefined && (typeof entry.case_version !== "string" || !CASE_VERSION.test(entry.case_version))) errors.push(`${prefix}.case_version must be a semver-like value`);
  if (entry.description !== undefined && !safeDescription(entry.description)) errors.push(`${prefix}.description must be a bounded de-identified caption`);
  if (entry.synthetic_patient_id !== undefined && (typeof entry.synthetic_patient_id !== "string" || !SYNTHETIC_PATIENT_ID.test(entry.synthetic_patient_id))) errors.push(`${prefix}.synthetic_patient_id must be synthetic-patient-*`);
  if (entry.synthetic_encounter_id !== undefined && (typeof entry.synthetic_encounter_id !== "string" || !SYNTHETIC_ENCOUNTER_ID.test(entry.synthetic_encounter_id))) errors.push(`${prefix}.synthetic_encounter_id must be synthetic-encounter-*`);
  if (entry.expected_laterality !== undefined && (typeof entry.expected_laterality !== "string" || !LATERALITIES.has(entry.expected_laterality as ValidationLaterality))) errors.push(`${prefix}.expected_laterality is invalid`);
  if (entry.expected_modalities !== undefined && !labels(entry.expected_modalities)) errors.push(`${prefix}.expected_modalities must be non-empty controlled labels`);
  if (entry.expected_page_types !== undefined && !labels(entry.expected_page_types)) errors.push(`${prefix}.expected_page_types must be non-empty controlled labels`);
  if (entry.expected_evidence_categories !== undefined && !ids(entry.expected_evidence_categories)) errors.push(`${prefix}.expected_evidence_categories must be safe ids`);
  if (entry.known_limitations !== undefined && !ids(entry.known_limitations)) errors.push(`${prefix}.known_limitations must be safe ids, not free text`);
  if (entry.expected_urgency !== undefined && (typeof entry.expected_urgency !== "string" || !URGENCY.has(entry.expected_urgency))) errors.push(`${prefix}.expected_urgency is invalid`);
  if (entry.ground_truth_scope !== undefined && (typeof entry.ground_truth_scope !== "string" || !SCOPES.has(entry.ground_truth_scope as GroundTruthScope))) errors.push(`${prefix}.ground_truth_scope is invalid`);
  if (entry.expected_models !== undefined) {
    if (!Array.isArray(entry.expected_models) || entry.expected_models.length === 0) errors.push(`${prefix}.expected_models must be non-empty`);
    else entry.expected_models.forEach((model, index) => {
      if (!isPlainRecord(model)) { errors.push(`${prefix}.expected_models[${index}] must be an object`); return; }
      for (const key of Object.keys(model)) if (key !== "model_id" && key !== "model_version") errors.push(`${prefix}.expected_models[${index}] unknown field: ${key}`);
      if (typeof model.model_id !== "string" || !ID.test(model.model_id)) errors.push(`${prefix}.expected_models[${index}].model_id must be a safe id`);
      if (model.model_version !== undefined && (typeof model.model_version !== "string" || !ID.test(model.model_version))) errors.push(`${prefix}.expected_models[${index}].model_version must be a safe id`);
    });
  }
}

function validateContractAssertion(assertion: Record<string, unknown>, prefix: string, errors: string[]): void {
  const allowed = new Set(["kind", "assertion_id", "target", "operator", "match", "path", "value", "reference", "laterality"]);
  for (const key of Object.keys(assertion)) if (!allowed.has(key)) errors.push(`${prefix} unknown field: ${key}`);
  if (typeof assertion.target !== "string" || !TARGETS.has(assertion.target as ValidationAssertionTarget)) errors.push(`${prefix}.target is invalid`);
  if (typeof assertion.operator !== "string" || !OPERATORS.has(assertion.operator as ValidationAssertionOperator)) { errors.push(`${prefix}.operator is invalid`); return; }
  const operator = assertion.operator as ValidationAssertionOperator;
  if (assertion.match !== undefined && !isMatch(assertion.match)) errors.push(`${prefix}.match must be a non-empty record of finite scalars`);
  if (["MUST_EXIST", "MUST_NOT_EXIST", "MAY_EXIST", "MUST_BE_LATERALITY", "MUST_BE_NEGATED", "MUST_BE_UNCERTAIN", "MUST_BE_SOURCE_ATTRIBUTED", "MUST_BE_RESEARCH_ONLY"].includes(operator) && !isMatch(assertion.match)) errors.push(`${prefix}.${operator} requires match`);
  if (operator === "MUST_EQUAL" && (!(typeof assertion.path === "string" && PATH.test(assertion.path)) || !isScalar(assertion.value))) errors.push(`${prefix}.MUST_EQUAL requires safe path and finite scalar value`);
  if (operator === "MUST_REFERENCE" && (!(typeof assertion.path === "string" && PATH.test(assertion.path)) || !isScalar(assertion.reference) || !isMatch(assertion.match))) errors.push(`${prefix}.MUST_REFERENCE requires match, safe path, and scalar reference`);
  if (operator === "MUST_BE_LATERALITY" && (typeof assertion.laterality !== "string" || !LATERALITIES.has(assertion.laterality as ValidationLaterality))) errors.push(`${prefix}.MUST_BE_LATERALITY requires laterality`);
}

/** Validate structure and the synthetic/de-identified boundary before a package is run. */
export function validateValidationCaseManifest(input: unknown): ManifestValidationResult {
  const errors: string[] = [];
  if (!isPlainRecord(input)) return { valid: false, errors: ["manifest must be a plain object"], manifest: null };
  const topKeys = new Set(["schema_version", "package_id", "data_classification", "cases"]);
  for (const key of Object.keys(input)) if (!topKeys.has(key)) errors.push(`unknown manifest field: ${key}`);
  if (input.schema_version !== VALIDATION_CASE_PACKAGE_SCHEMA_VERSION) errors.push("unsupported schema_version");
  if (typeof input.package_id !== "string" || !ID.test(input.package_id)) errors.push("package_id must be a safe identifier");
  if (input.data_classification !== "SYNTHETIC_ONLY") errors.push("data_classification must be SYNTHETIC_ONLY");
  if (!Array.isArray(input.cases) || input.cases.length === 0) errors.push("cases must be a non-empty array");
  const caseIds = new Set<string>(); const assertionIds = new Set<string>();
  if (Array.isArray(input.cases)) input.cases.forEach((entry, caseIndex) => {
    const prefix = `cases[${caseIndex}]`;
    if (!isPlainRecord(entry)) { errors.push(`${prefix} must be a plain object`); return; }
    const allowedCase = new Set(["case_id", "fixture_ref", "assets", "case_version", "description", "synthetic_patient_id", "synthetic_encounter_id", "expected_laterality", "expected_modalities", "expected_page_types", "expected_models", "expected_evidence_categories", "expected_urgency", "known_limitations", "ground_truth_scope", "assertions"]);
    for (const key of Object.keys(entry)) if (!allowedCase.has(key)) errors.push(`${prefix} unknown field: ${key}`);
    if (typeof entry.case_id !== "string" || !SYNTHETIC_CASE_ID.test(entry.case_id)) errors.push(`${prefix}.case_id must be synthetic-*`); else if (caseIds.has(entry.case_id)) errors.push(`duplicate case_id: ${entry.case_id}`); else caseIds.add(entry.case_id);
    if (typeof entry.fixture_ref !== "string" || !SYNTHETIC_FIXTURE.test(entry.fixture_ref)) errors.push(`${prefix}.fixture_ref must be synthetic-*`);
    if (entry.assets !== undefined) {
      if (!Array.isArray(entry.assets) || entry.assets.length === 0) errors.push(`${prefix}.assets must be a non-empty array`);
      else {
        const assetIds = new Set<string>();
        entry.assets.forEach((asset, assetIndex) => {
          const assetPrefix = `${prefix}.assets[${assetIndex}]`;
          if (!isPlainRecord(asset)) { errors.push(`${assetPrefix} must be a plain object`); return; }
          for (const key of Object.keys(asset)) if (!["asset_id", "kind", "fixture_ref", "laterality", "page"].includes(key)) errors.push(`${assetPrefix} unknown field: ${key}`);
          if (typeof asset.asset_id !== "string" || !ID.test(asset.asset_id) || assetIds.has(asset.asset_id)) errors.push(`${assetPrefix}.asset_id must be unique and safe`); else assetIds.add(asset.asset_id);
          if (typeof asset.kind !== "string" || !ASSET_KINDS.has(asset.kind)) errors.push(`${assetPrefix}.kind is invalid`);
          if (typeof asset.fixture_ref !== "string" || !SYNTHETIC_FIXTURE.test(asset.fixture_ref)) errors.push(`${assetPrefix}.fixture_ref must be synthetic-*`);
          if (asset.laterality !== undefined && (typeof asset.laterality !== "string" || !LATERALITIES.has(asset.laterality as ValidationLaterality))) errors.push(`${assetPrefix}.laterality is invalid`);
          if (asset.page !== undefined && (typeof asset.page !== "number" || !Number.isInteger(asset.page) || asset.page < 1 || asset.page > 10000)) errors.push(`${assetPrefix}.page must be a bounded positive integer`);
        });
      }
    }
    validateMetadata(entry, prefix, errors);
    if (!Array.isArray(entry.assertions) || entry.assertions.length === 0) { errors.push(`${prefix}.assertions must be non-empty`); return; }
    entry.assertions.forEach((assertion, assertionIndex) => {
      const assertionPrefix = `${prefix}.assertions[${assertionIndex}]`;
      if (!isPlainRecord(assertion)) { errors.push(`${assertionPrefix} must be a plain object`); return; }
      const kind = assertion.kind;
      if (typeof kind !== "string" || !ASSERTION_KINDS.has(kind as ValidationCaseAssertionKind)) { errors.push(`${assertionPrefix}.kind is invalid`); return; }
      if (typeof assertion.assertion_id !== "string" || !ID.test(assertion.assertion_id)) errors.push(`${assertionPrefix}.assertion_id must be a safe identifier`); else if (assertionIds.has(assertion.assertion_id)) errors.push(`duplicate assertion_id: ${assertion.assertion_id}`); else assertionIds.add(assertion.assertion_id);
      if (kind === "contract") { validateContractAssertion(assertion, assertionPrefix, errors); return; }
      const allowed = kind === "forbidden_output" ? new Set(["kind", "assertion_id", "forbidden_literals"]) : new Set(["kind", "assertion_id", "match"]);
      for (const key of Object.keys(assertion)) if (!allowed.has(key)) errors.push(`${assertionPrefix} unknown field: ${key}`);
      if (kind === "forbidden_output") { if (!Array.isArray(assertion.forbidden_literals) || assertion.forbidden_literals.length === 0 || assertion.forbidden_literals.some((x) => typeof x !== "string" || x.trim().length === 0)) errors.push(`${assertionPrefix}.forbidden_literals must be non-empty strings`); }
      else if (!isMatch(assertion.match)) errors.push(`${assertionPrefix}.match must be a non-empty record of finite scalars`);
    });
  });
  return { valid: errors.length === 0, errors, manifest: errors.length === 0 ? input as unknown as ValidationCaseManifest : null };
}

function recordsForTarget(actual: ValidationCaseActual, target: ValidationAssertionTarget): Array<Record<string, JsonScalar>> {
  if (target === "evidence") return actual.evidence ?? [];
  if (target === "specialist") return actual.specialists ?? [];
  if (target === "condition") return actual.conditions ?? [];
  if (target === "routing") return actual.routing ? [actual.routing] : [];
  if (target === "model") return actual.model ? [actual.model] : [];
  const presentation = recordFromPresentation(actual.presentation);
  return presentation ? [presentation] : [];
}

function contractResult(assertion: ContractAssertion, actual: ValidationCaseActual): CaseAssertionResult {
  const candidates = recordsForTarget(actual, assertion.target);
  const match = assertion.match;
  const filtered = match ? candidates.filter((candidate) => matches(candidate, match)) : candidates;
  const present = filtered.length > 0;
  let passed: boolean; let detail: string;
  switch (assertion.operator) {
    case "MUST_EXIST": passed = present; detail = present ? "required structured match present" : "required structured match absent"; break;
    case "MUST_NOT_EXIST": passed = !present; detail = present ? "prohibited structured match present" : "prohibited structured match absent"; break;
    case "MAY_EXIST": passed = true; detail = present ? "optional structured match present" : "optional structured match absent"; break;
    case "MUST_EQUAL": passed = filtered.some((candidate) => pathValue(candidate, assertion.path!) === assertion.value); detail = passed ? "required value matched" : "required value did not match"; break;
    case "MUST_REFERENCE": passed = filtered.some((candidate) => pathValue(candidate, assertion.path!) === assertion.reference); detail = passed ? "required reference matched" : "required reference absent"; break;
    case "MUST_BE_LATERALITY": passed = filtered.some((candidate) => candidate.laterality === assertion.laterality); detail = passed ? "required laterality matched" : "required laterality absent"; break;
    case "MUST_BE_NEGATED": passed = filtered.some((candidate) => candidate.negated === true || candidate.assertion === "ABSENT"); detail = passed ? "negated assertion present" : "negated assertion absent"; break;
    case "MUST_BE_UNCERTAIN": passed = filtered.some((candidate) => candidate.uncertain === true || candidate.assertion === "UNCERTAIN" || candidate.certainty === "UNCERTAIN"); detail = passed ? "uncertain assertion present" : "uncertain assertion absent"; break;
    case "MUST_BE_SOURCE_ATTRIBUTED": passed = filtered.some((candidate) => ["source_id", "source_ref", "evidence_id", "provenance_reference"].some((key) => typeof candidate[key] === "string" && candidate[key].length > 0)); detail = passed ? "source attribution present" : "source attribution absent"; break;
    case "MUST_BE_RESEARCH_ONLY": passed = filtered.some((candidate) => candidate.validation_status === "RESEARCH_ONLY" || candidate.mode === "RESEARCH" || candidate.trust === "RESEARCH"); detail = passed ? "research-only boundary present" : "research-only boundary absent"; break;
  }
  return { assertion_id: assertion.assertion_id, kind: assertion.kind, passed, detail };
}

function assertionResult(assertion: ValidationCaseAssertion, actual: ValidationCaseActual): CaseAssertionResult {
  if (assertion.kind === "contract") return contractResult(assertion, actual);
  if (assertion.kind === "forbidden_output") {
    const text = outputStrings(actual.presentation).join("\n").toLocaleLowerCase("en-US");
    const found = assertion.forbidden_literals.filter((literal) => text.includes(literal.toLocaleLowerCase("en-US")));
    return { assertion_id: assertion.assertion_id, kind: assertion.kind, passed: found.length === 0, detail: found.length ? `forbidden literal(s) present: ${found.join(", ")}` : "no forbidden literals present" };
  }
  const source = recordsForTarget(actual, assertion.kind);
  const passed = source.some((candidate) => matches(candidate, assertion.match));
  return { assertion_id: assertion.assertion_id, kind: assertion.kind, passed, detail: passed ? "expected structured match present" : "expected structured match absent" };
}

/** Execute a single validated synthetic case against a caller-supplied output projection. */
export function runValidationCase(validationCase: ValidationCase, actual: ValidationCaseActual): ValidationCaseRunResult {
  const assertions = validationCase.assertions.map((assertion) => assertionResult(assertion, actual));
  return { case_id: validationCase.case_id, passed: assertions.every((result) => result.passed), assertions };
}

/** Execute in declaration order. Missing actual cases fail closed instead of being skipped. */
export function runValidationCasePackage(manifestInput: unknown, actualByCaseId: Readonly<Record<string, ValidationCaseActual | undefined>>): ValidationCasePackageResult {
  const validation = validateValidationCaseManifest(manifestInput);
  if (!validation.valid || !validation.manifest) throw new Error(`Invalid validation case package: ${validation.errors.join("; ")}`);
  const cases = validation.manifest.cases.map((validationCase) => {
    const actual = actualByCaseId[validationCase.case_id];
    if (!actual) return { case_id: validationCase.case_id, passed: false, assertions: validationCase.assertions.map((a) => ({ assertion_id: a.assertion_id, kind: a.kind, passed: false, detail: "no actual output supplied" })) };
    return runValidationCase(validationCase, actual);
  });
  return { package_id: validation.manifest.package_id, passed: cases.every((result) => result.passed), cases };
}
