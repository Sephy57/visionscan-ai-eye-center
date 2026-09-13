import type { Collection, DbTransaction } from "../storage/db";
import { dbGet, dbTransaction } from "../storage/db";
import { sha256Canonical } from "../reports/integrity";

export type JobEffectType =
  | "MODEL_RESULT"
  | "STRUCTURED_EVIDENCE"
  | "REASONING_RECORD"
  | "REPORT"
  | "JOB_COMPLETION";

export interface JobEffectRecord {
  effect_id: string;
  effect_type: JobEffectType;
  idempotency_key: string;
  canonical_id: string;
  study_id?: string;
  job_id?: string;
  attempt_id?: string;
  payload_sha256: string;
  state: "COMMITTED";
  created_at: string;
  note: string;
}

function effectId(type: JobEffectType, canonicalId: string): string {
  return `effect_${type.toLowerCase()}_${canonicalId}`.slice(0, 480);
}

export function jobEffectFingerprint(candidate: JobEffectRecord): string {
  return sha256Canonical({
    effect_type: candidate.effect_type,
    idempotency_key: candidate.idempotency_key,
    canonical_id: candidate.canonical_id,
    study_id: candidate.study_id ?? null,
    payload_sha256: candidate.payload_sha256,
    state: candidate.state,
  });
}

function putOnceInTransaction<T>(
  tx: DbTransaction,
  collection: Collection,
  id: string,
  value: T,
  fingerprintOf: (candidate: T) => string,
): T {
  const existing = tx.get<T>(collection, id);
  if (existing !== null) {
    if (fingerprintOf(existing) !== fingerprintOf(value)) {
      throw new Error(`IMMUTABLE_EFFECT_CONFLICT:${collection}/${id}`);
    }
    return existing;
  }
  tx.put(collection, id, value);
  return value;
}

/** Insert one canonical record and refuse a different payload under the same
 * id. This is the committed-effect primitive used by retry/restart paths. */
export async function persistOnce<T>(
  collection: Collection,
  id: string,
  value: T,
  fingerprintOrFn: string | ((candidate: T) => string) = sha256Canonical(value),
): Promise<T> {
  const fingerprintOf = typeof fingerprintOrFn === "function" ? fingerprintOrFn : (candidate: T) => sha256Canonical(candidate);
  return dbTransaction((tx) => putOnceInTransaction(tx, collection, id, value, fingerprintOf));
}

export async function getJobEffect(effectType: JobEffectType, canonicalId: string): Promise<JobEffectRecord | null> {
  return dbGet<JobEffectRecord>("job_effects", effectId(effectType, canonicalId));
}

export function buildJobEffectRecord(input: {
  effect_type: JobEffectType;
  idempotency_key: string;
  canonical_id: string;
  payload: unknown;
  study_id?: string;
  job_id?: string;
  attempt_id?: string;
  note?: string;
}): JobEffectRecord {
  return {
    effect_id: effectId(input.effect_type, input.canonical_id),
    effect_type: input.effect_type,
    idempotency_key: input.idempotency_key,
    canonical_id: input.canonical_id,
    ...(input.study_id ? { study_id: input.study_id } : {}),
    ...(input.job_id ? { job_id: input.job_id } : {}),
    ...(input.attempt_id ? { attempt_id: input.attempt_id } : {}),
    payload_sha256: sha256Canonical(input.payload),
    state: "COMMITTED",
    created_at: new Date().toISOString(),
    note: input.note ?? "Canonical committed effect; replay reuses this record.",
  };
}

/** Insert/reuse an effect while already inside the caller's transaction. */
export function putJobEffectInTransaction(tx: DbTransaction, record: JobEffectRecord): JobEffectRecord {
  const existing = tx.get<JobEffectRecord>("job_effects", record.effect_id);
  if (existing && jobEffectFingerprint(existing) !== jobEffectFingerprint(record)) {
    throw new Error(`IMMUTABLE_EFFECT_CONFLICT:job_effects/${record.effect_id}`);
  }
  if (existing) return existing;
  tx.put("job_effects", record.effect_id, record);
  return record;
}

export async function recordJobEffect(input: {
  effect_type: JobEffectType;
  idempotency_key: string;
  canonical_id: string;
  payload: unknown;
  study_id?: string;
  job_id?: string;
  attempt_id?: string;
  note?: string;
}): Promise<JobEffectRecord> {
  const record = buildJobEffectRecord(input);
  return dbTransaction((tx) => putJobEffectInTransaction(tx, record));
}
