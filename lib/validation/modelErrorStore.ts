import { dbAll, dbGet, dbPut } from "../storage/db";
import { audit } from "../audit";
import {
  MODEL_ERROR_RECORD_SCHEMA_VERSION,
  type AdjudicationRationaleCode,
  type AdjudicationOutcome,
  type ModelErrorAdjudication,
  type ModelErrorLifecycle,
  type ModelErrorRecord,
  type ModelErrorRemediation,
  type ModelErrorReview,
  parseModelErrorRecord,
  serializeModelErrorRecord,
  validateModelErrorRecord,
} from "./modelErrorRegistry";

/**
 * Append-safe model-error registry facade.
 *
 * The JSON store is intentionally used only as a local persistence adapter;
 * every write is validated at the registry boundary and every transition is
 * role-authenticated by the caller.  There is no AI/automatic adjudication
 * path.  Human review records contain roles and timestamps, never names,
 * patient identifiers, raw output, or clinical free text.
 */

export interface CreateModelErrorInput extends Omit<ModelErrorRecord, "schema_version" | "status" | "lifecycle" | "adjudication" | "remediation" | "reviewer" | "mitigation" | "regression_test"> {
  status?: ModelErrorRecord["status"];
  lifecycle?: ModelErrorLifecycle;
  adjudication?: ModelErrorAdjudication | null;
  remediation?: ModelErrorRemediation | null;
  reviewer?: ModelErrorReview | null;
  mitigation?: ModelErrorRecord["mitigation"];
  regression_test?: ModelErrorRecord["regression_test"];
}

export interface ModelErrorTransitionInput {
  lifecycle: ModelErrorLifecycle;
  reviewer_role: ModelErrorReview["reviewer_role"];
  outcome?: AdjudicationOutcome;
  rationale_code?: AdjudicationRationaleCode;
  /** Required only for FIXED/REGRESSION_PROTECTED transitions. */
  remediation?: ModelErrorRemediation;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function statusForLifecycle(lifecycle: ModelErrorLifecycle): ModelErrorRecord["status"] {
  if (lifecycle === "UNREVIEWED") return "OPEN";
  if (lifecycle === "DISMISSED") return "DISMISSED";
  if (lifecycle === "FIXED" || lifecycle === "REGRESSION_PROTECTED") return "REMEDIATED";
  return "ADJUDICATED";
}

function isLifecycle(value: unknown): value is ModelErrorLifecycle {
  return ["UNREVIEWED", "ENGINEERING_CONFIRMED", "CLINICIAN_REVIEWED", "DISMISSED", "KNOWN_LIMITATION", "FIXED", "REGRESSION_PROTECTED"].includes(value as ModelErrorLifecycle);
}

function roleAllowedForLifecycle(lifecycle: ModelErrorLifecycle, role: ModelErrorReview["reviewer_role"]): boolean {
  if (lifecycle === "CLINICIAN_REVIEWED") return role === "CLINICIAN_REVIEWER";
  if (lifecycle === "ENGINEERING_CONFIRMED" || lifecycle === "FIXED" || lifecycle === "REGRESSION_PROTECTED") {
    return role === "ENGINEERING_REVIEWER" || role === "VALIDATION_REVIEWER";
  }
  if (lifecycle === "KNOWN_LIMITATION" || lifecycle === "DISMISSED") return role !== "ENGINEERING_REVIEWER";
  return false;
}

function assertValid(record: unknown): ModelErrorRecord {
  const result = validateModelErrorRecord(record);
  if (!result.valid || !result.record) throw new Error(`Invalid model error record: ${result.errors.join("; ")}`);
  return clone(result.record);
}

function readStored(record: unknown): ModelErrorRecord {
  // Re-serialize/re-parse to ensure a persisted object cannot bypass the same
  // exact-key and synthetic-only checks used for writes.
  return parseModelErrorRecord(serializeModelErrorRecord(record));
}

export async function getModelError(errorId: string): Promise<ModelErrorRecord | null> {
  const stored = await dbGet<unknown>("model_errors", errorId);
  return stored ? readStored(stored) : null;
}

export async function listModelErrors(filters?: {
  model_id?: string;
  lifecycle?: ModelErrorLifecycle;
  category?: ModelErrorRecord["category"];
}): Promise<ModelErrorRecord[]> {
  const records = (await dbAll<unknown>("model_errors")).flatMap((value) => {
    try { return [readStored(value)]; } catch { return []; }
  });
  return records
    .filter((record) => !filters?.model_id || record.model_id === filters.model_id)
    .filter((record) => !filters?.category || record.category === filters.category)
    .filter((record) => !filters?.lifecycle || (record.lifecycle ?? (record.status === "OPEN" ? "UNREVIEWED" : undefined)) === filters.lifecycle)
    .sort((a, b) => b.observed_at.localeCompare(a.observed_at));
}

/** Insert-only creation. Reusing an error id is rejected rather than overwritten. */
export async function createModelError(input: CreateModelErrorInput): Promise<ModelErrorRecord> {
  const existing = await dbGet<unknown>("model_errors", input.error_id);
  if (existing) throw new Error("Model error already exists; use the adjudication transition workflow.");
  const lifecycle = input.lifecycle ?? (input.status === undefined ? "UNREVIEWED" : isLifecycle(input.status) ? input.status : input.status === "OPEN" ? "UNREVIEWED" : undefined);
  if (!lifecycle) throw new Error("New model errors require an explicit lifecycle.");
  if (lifecycle !== "UNREVIEWED") throw new Error("New model errors must start UNREVIEWED.");
  const record = assertValid({
    ...input,
    schema_version: MODEL_ERROR_RECORD_SCHEMA_VERSION,
    status: "OPEN",
    lifecycle,
    adjudication_status: lifecycle,
    adjudication: null,
    remediation: null,
    reviewer: null,
    mitigation: null,
    regression_test: null,
  });
  await dbPut("model_errors", record.error_id, clone(record));
  await audit({ actor: "validation", action: "model_error.create", resource: "model_error", resourceId: record.error_id, outcome: "ok", detail: `${record.category} ${record.model_id}` });
  return clone(record);
}

/**
 * Transition an existing record after explicit human review.  AI callers do
 * not have a role accepted by this function, and a clinician-reviewed state
 * always requires CLINICIAN_REVIEWER evidence.
 */
export async function transitionModelError(errorId: string, input: ModelErrorTransitionInput): Promise<ModelErrorRecord> {
  const current = await getModelError(errorId);
  if (!current) throw new Error("Model error not found");
  const previous = current.lifecycle ?? (current.status === "OPEN" ? "UNREVIEWED" : undefined);
  if (!previous) throw new Error("Legacy model error lacks a safe lifecycle; manual migration required.");
  if (previous === "DISMISSED" || previous === "REGRESSION_PROTECTED") throw new Error("Terminal model-error state cannot be changed.");
  if (input.lifecycle === "UNREVIEWED") throw new Error("A reviewed model error cannot return to UNREVIEWED.");
  if (!roleAllowedForLifecycle(input.lifecycle, input.reviewer_role)) throw new Error("Reviewer role cannot establish this lifecycle state.");

  const at = new Date().toISOString();
  const adjudication: ModelErrorAdjudication = {
    outcome: input.outcome ?? (input.lifecycle === "DISMISSED" ? "NOT_CONFIRMED" : "CONFIRMED"),
    rationale_code: input.rationale_code ?? (input.lifecycle === "KNOWN_LIMITATION" ? "INSUFFICIENT_REFERENCE_STANDARD" : "CONTRACT_VIOLATION"),
    adjudicated_at: at,
    adjudicator_role: input.reviewer_role === "CLINICIAN_REVIEWER" ? "CLINICIAN_REVIEWER" : "VALIDATION_REVIEWER",
  };
  const next: ModelErrorRecord = {
    ...current,
    status: statusForLifecycle(input.lifecycle),
    lifecycle: input.lifecycle,
    adjudication_status: input.lifecycle,
    reviewer: { reviewer_role: input.reviewer_role, reviewed_at: at },
    adjudication,
    remediation: input.remediation ?? current.remediation,
    mitigation: input.remediation ? { mitigation_id: input.remediation.remediation_id, state: "VERIFIED", verified_at: input.remediation.verified_at } : current.mitigation,
  };
  if (input.lifecycle === "FIXED" || input.lifecycle === "REGRESSION_PROTECTED") {
    if (!input.remediation) throw new Error(`${input.lifecycle} requires remediation verification.`);
    if (input.lifecycle === "REGRESSION_PROTECTED" && !current.regression_test) throw new Error("REGRESSION_PROTECTED requires a stored regression_test.");
  }
  const verified = assertValid(next);
  await dbPut("model_errors", errorId, clone(verified));
  await audit({ actor: `validation:${input.reviewer_role}`, action: "model_error.transition", resource: "model_error", resourceId: errorId, outcome: "ok", detail: `${previous}->${input.lifecycle}` });
  return clone(verified);
}
