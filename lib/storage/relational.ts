import { dbGet, type Collection } from "./db";

/** Safety-critical relationship vocabulary. The payload model remains
 * flexible, while these links are explicit and auditable. */
export type TypedReferenceField =
  | "patient_id"
  | "encounter_id"
  | "study_id"
  | "document_id"
  | "analysis_id"
  | "report_id"
  | "job_id";

export interface TypedReference {
  field: TypedReferenceField;
  target: Collection;
  id: string;
}

const TARGETS: Partial<Record<Collection, Partial<Record<TypedReferenceField, Collection>>>> = {
  encounters: { patient_id: "patients" },
  studies: { patient_id: "patients", encounter_id: "encounters" },
  documents: { study_id: "studies", patient_id: "patients" },
  analyses: { study_id: "studies" },
  reports: { study_id: "studies", analysis_id: "analyses" },
  clinician_reviews: { report_id: "reports" },
  reasoning_records: { study_id: "studies", analysis_id: "analyses", report_id: "reports" },
  model_executions: { analysis_id: "analyses" },
  evidence: { study_id: "studies", analysis_id: "analyses" },
  jobs: { study_id: "studies", document_id: "documents", analysis_id: "analyses" },
  model_errors: { study_id: "studies", analysis_id: "analyses" },
};

function valueOf(input: unknown, field: string): string | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  const camel = field.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  const value = record[field] ?? record[camel];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function tenantOf(input: unknown): string | null {
  return valueOf(input, "tenant_id");
}

/** Return only explicitly supplied typed links; no identifiers are inferred. */
export function typedReferences(collection: Collection, input: unknown): TypedReference[] {
  const targets = TARGETS[collection] ?? {};
  return (Object.entries(targets) as Array<[TypedReferenceField, Collection]>).flatMap(([field, target]) => {
    const id = valueOf(input, field);
    return id ? [{ field, target, id }] : [];
  });
}

/**
 * Fail-closed service-level check used before rendering/inference. Missing
 * legacy targets are returned as unresolved so callers can choose an explicit
 * migration/reconciliation path; a tenant mismatch always throws.
 */
export async function validateTypedReferences(
  collection: Collection,
  input: unknown,
  options: { requireTargets?: boolean } = {},
): Promise<{ ok: true; unresolved: TypedReference[] } | never> {
  const sourceTenant = tenantOf(input);
  const unresolved: TypedReference[] = [];
  for (const reference of typedReferences(collection, input)) {
    const target = await dbGet<Record<string, unknown>>(reference.target, reference.id);
    if (!target) {
      unresolved.push(reference);
      continue;
    }
    const targetTenant = tenantOf(target);
    if (sourceTenant && targetTenant && sourceTenant !== targetTenant) {
      throw new Error(`CROSS_TENANT_REFERENCE:${collection}.${reference.field}->${reference.target}/${reference.id}`);
    }
  }
  if (options.requireTargets && unresolved.length > 0) {
    throw new Error(`MISSING_TYPED_REFERENCE:${unresolved.map((r) => `${r.field}=${r.id}`).join(",")}`);
  }
  return { ok: true, unresolved };
}

/** Lifecycle values are intentionally finite and shared by all resources. */
export type ResourceLifecycle = "ACTIVE" | "ARCHIVED" | "DELETED";

export function lifecycleOf(input: unknown): ResourceLifecycle {
  const value = valueOf(input, "lifecycle") ?? valueOf(input, "archive_state");
  return value === "ARCHIVED" || value === "DELETED" ? value : "ACTIVE";
}

