/**
 * Analysis job queue — keeps model inference off the UI request path.
 *
 *   UPLOAD -> QUEUE STUDY -> WORKER -> MODEL INFERENCE -> VALIDATION
 *     -> STORE RESULT -> UI POLLING
 *
 * The default remains an in-process local worker for backwards compatibility.
 * `VISIONSCAN_EXTERNAL_WORKER=true` disables web-process dispatch; a separate
 * `npm run worker` process can then claim the same SQLite queue. The worker
 * reuses this module's lease, heartbeat, fencing, retry, cancellation, and
 * service execution path rather than creating a second implementation.
 */

import { dbPut, dbGet, dbPage, dbTransaction, type DbPageResult, type DbTransaction } from "../storage/db";
import { newId } from "../storage/files";
import { audit } from "../audit";
import { JobCancelledError, makeJobProgress, type JobProgress, type ProgressUpdate } from "./control";
import { checkProcessingConsent, PROCESSING_CONSENT_PURPOSES } from "../consent/policy";
import { DEMO_MODE } from "../config";
import { createJobDeadline, resolveOverallJobDeadlineMs, withOverallJobDeadline, JobDeadlineExceededError } from "./jobDeadline";
import { withProcessTreeScope, terminateTrackedProcessTrees } from "./processControl";
import { maybeInjectPhase9Fault } from "./phase9FaultInjection";
import { buildJobEffectRecord, putJobEffectInTransaction } from "./effects";
import { classifyJobAge, resolveJobDeadlinePolicy, type JobDeadlinePolicy } from "./deadlinePolicy";
import {
  reserveJobResourcesHostWide,
  releaseJobResourceLease,
  startResourceLeaseHeartbeat,
  JOB_RESOURCE_REQUESTS,
  type HostWideJobResourceAdmission,
} from "./resourceAdmission";
import { resourceLeaseConfigFromEnv, type ModelJobReservation, type ResourceLeaseConfig, type ResourceLeaseHandle } from "../runtime";

/**
 * Durable lifecycle states. `stale` and `retryable` are intentionally
 * observable intermediate states: a dead worker is never silently treated as
 * a fresh attempt, and a retry is never unbounded or implicit.
 */
export type JobStatus = "queued" | "running" | "stale" | "retryable" | "completed" | "failed" | "cancelled";
export type JobKind = "analysis" | "extraction";

export const JOB_RETRY_POLICY_VERSION = "lease-retry-v1";
export const DEFAULT_JOB_LEASE_MS = 15 * 60 * 1000;
export const DEFAULT_JOB_HEARTBEAT_MS = 30 * 1000;
export const DEFAULT_JOB_HEARTBEAT_GRACE_MS = DEFAULT_JOB_HEARTBEAT_MS * 2;
export const DEFAULT_JOB_RETRY_BACKOFF_MS = 1000;
export const MAX_JOB_ATTEMPTS = 3;
export const DEFAULT_OVERALL_JOB_DEADLINE_MS = resolveOverallJobDeadlineMs();

export interface JobRecoveryOptions {
  /** Reference time used by deterministic tests and maintenance jobs. */
  now?: Date | string | number;
  leaseMs?: number;
  heartbeatMs?: number;
  heartbeatGraceMs?: number;
  retryBackoffMs?: number;
  maxAttempts?: number;
  workerId?: string;
  /** Classify stale rows and, when due, move retryable rows back to queued. */
  applyPolicy?: boolean;
  /** Start due queued jobs after startup recovery. */
  startWorkers?: boolean;
  /** Optional interval for the long-lived in-process reaper helper. */
  intervalMs?: number;
}

export interface JobRecoveryResult {
  scanned: number;
  stale: string[];
  retryable: string[];
  queued: string[];
  failed: string[];
  cancelled: string[];
}

export interface AnalysisJob {
  job_id: string;
  study_id: string;
  kind: JobKind;
  document_id?: string;   // extraction jobs carry the target document
  status: JobStatus;
  /** Alias for status retained in the row for workers that use state naming. */
  state?: JobStatus;
  attempts: number;
  /** Number of retries requested after the initial attempt. */
  retry_count?: number;
  error?: string;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  cancellation_requested_at?: string;
  /** Durable cancellation source of truth. */
  cancellation_requested?: boolean;
  /** Current and historical attempt identifiers are both retained for audit. */
  attempt_id?: string;
  active_attempt_id?: string;
  /** Monotonic CAS version; every ownership/state transition increments it. */
  version?: number;
  claim_version?: number;
  claimed_at?: string;
  heartbeat_at?: string;
  lease_expires_at?: string;
  worker_id?: string;
  /** Overall execution budget starts at claim and is never extended by lease heartbeats. */
  deadline_ms?: number;
  deadline_at?: string;
  /** Explicit queue/service/total-age budgets and observed age metrics. */
  deadline_policy?: JobDeadlinePolicy;
  queue_wait_ms?: number;
  service_time_ms?: number;
  total_age_ms?: number;
  deadline_outcome?: "WITHIN_BUDGET" | "QUEUE_TIMEOUT" | "JOB_DEADLINE_EXCEEDED";
  resource_request?: { memory_bytes: number; threads: number };
  resource_reservation_state?: "waiting" | "admitted" | "released" | "bypassed_demo" | "rejected";
  resource_rejection_reason?: string;
  termination_requested_at?: string;
  termination_outcome?: string;
  /** Latest explicit retry idempotency key, plus a bounded replay ledger. */
  idempotency_key?: string;
  retry_idempotency_keys?: string[];
  retry_policy_version?: string;
  retry_after_at?: string;
  last_recovery_at?: string;
  last_recovery_reason?: string;
  progress: JobProgress;
}

export interface JobListPageOptions {
  limit?: number;
  cursor?: string;
  status?: JobStatus;
  kind?: JobKind;
  /** UI/operations retain newest-first by default; workers request FIFO. */
  direction?: "asc" | "desc";
}

/** Bounded operations view of durable jobs, ordered newest first. */
export async function listJobsPage(options: JobListPageOptions = {}): Promise<DbPageResult<AnalysisJob>> {
  const page = await dbPage<AnalysisJob>("jobs", {
    limit: options.limit,
    cursor: options.cursor,
    direction: options.direction ?? "desc",
    predicate: options.status || options.kind
      ? (job) => {
        const normalized = normalizeJob(job);
        return (!options.status || normalized.status === options.status) && (!options.kind || normalized.kind === options.kind);
      }
      : undefined,
  });
  return { ...page, items: page.items.map((job) => normalizeJob(job)) };
}

const MAX_ATTEMPTS = MAX_JOB_ATTEMPTS;

function boundedPositive(value: unknown, fallback: number, minimum = 1): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= minimum ? Math.min(Math.floor(parsed), 24 * 60 * 60 * 1000) : fallback;
}

const configuredLeaseMs = boundedPositive(process.env.VISIONSCAN_JOB_LEASE_MS, DEFAULT_JOB_LEASE_MS, 1000);
const configuredHeartbeatMs = boundedPositive(process.env.VISIONSCAN_JOB_HEARTBEAT_MS, Math.min(DEFAULT_JOB_HEARTBEAT_MS, Math.floor(configuredLeaseMs / 3)), 250);
const configuredHeartbeatGraceMs = boundedPositive(process.env.VISIONSCAN_JOB_HEARTBEAT_GRACE_MS, configuredHeartbeatMs * 2, 0);
const configuredRetryBackoffMs = boundedPositive(process.env.VISIONSCAN_JOB_RETRY_BACKOFF_MS, DEFAULT_JOB_RETRY_BACKOFF_MS, 0);
const configuredOverallDeadlineMs = resolveOverallJobDeadlineMs();
const configuredResourceWaitPollMs = boundedPositive(process.env.VISIONSCAN_RESOURCE_WAIT_POLL_MS, 250, 25);

const terminalStatuses = new Set<JobStatus>(["completed", "failed", "cancelled"]);
const workerInstanceId = process.env.VISIONSCAN_WORKER_ID?.trim() || `worker-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
const externalWorkerMode = /^(?:1|true|yes)$/i.test(process.env.VISIONSCAN_EXTERNAL_WORKER ?? "");
const workerProcessMode = /^(?:1|true|yes)$/i.test(process.env.VISIONSCAN_WORKER_PROCESS ?? "");

/** True when the web process intentionally leaves durable work for npm run worker. */
export function isExternalWorkerMode(): boolean {
  return externalWorkerMode && !workerProcessMode;
}

function consentPurposeForJob(kind: JobKind) {
  return kind === "extraction"
    ? PROCESSING_CONSENT_PURPOSES.documentExtraction
    : PROCESSING_CONSENT_PURPOSES.imageModelAnalysis;
}

function asTimestamp(value: Date | string | number | undefined, fallback = Date.now()): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function isoAt(value: Date | string | number | undefined, fallback = Date.now()): string {
  return new Date(asTimestamp(value, fallback)).toISOString();
}

function stateProgress(stage: "stale" | "retryable" | "cancelled" | "failed", current: AnalysisJob, message: string): JobProgress {
  return makeJobProgress({
    stage,
    percent: current.progress?.percent ?? 0,
    completed_units: current.progress?.completed_units,
    total_units: current.progress?.total_units,
    message,
  });
}

function normalizeStatus(value: unknown): JobStatus {
  const normalized = String(value ?? "queued").toLowerCase();
  if (normalized === "claimed") return "running";
  if (normalized === "error") return "failed";
  if (["queued", "running", "stale", "retryable", "completed", "failed", "cancelled"].includes(normalized)) return normalized as JobStatus;
  return "queued";
}

/** Normalize rows written by pre-lease releases without inventing evidence. */
function normalizeJob<T extends AnalysisJob>(job: T): T {
  const status = normalizeStatus(job.status ?? job.state);
  const attempts = Number.isFinite(job.attempts) ? job.attempts : 0;
  const version = Number.isFinite(job.claim_version) ? job.claim_version : (Number.isFinite(job.version) ? job.version : 0);
  const attemptId = job.attempt_id ?? job.active_attempt_id;
  return {
    ...job,
    status,
    state: status,
    attempts,
    retry_count: Number.isFinite(job.retry_count) ? job.retry_count : Math.max(0, attempts - 1),
    version,
    claim_version: version,
    attempt_id: attemptId,
    active_attempt_id: job.active_attempt_id ?? attemptId,
    cancellation_requested: job.cancellation_requested === true || String(job.cancellation_requested).toLowerCase() === "true" || Boolean(job.cancellation_requested_at),
    retry_policy_version: job.retry_policy_version ?? JOB_RETRY_POLICY_VERSION,
  } as T;
}

function durableJob<T extends AnalysisJob>(job: T, overrides: Partial<AnalysisJob> = {}): T {
  const merged = normalizeJob({ ...job, ...overrides } as T);
  const status = (overrides.status ?? merged.status) as JobStatus;
  const version = (overrides.claim_version ?? overrides.version ?? merged.claim_version ?? merged.version ?? 0);
  const attemptId = overrides.attempt_id ?? overrides.active_attempt_id ?? merged.attempt_id;
  return {
    ...merged,
    ...overrides,
    status,
    state: status,
    version,
    claim_version: version,
    attempt_id: attemptId,
    active_attempt_id: Object.prototype.hasOwnProperty.call(overrides, "active_attempt_id") ? overrides.active_attempt_id : merged.active_attempt_id,
    cancellation_requested: overrides.cancellation_requested ?? merged.cancellation_requested ?? false,
    retry_count: overrides.retry_count ?? merged.retry_count ?? Math.max(0, (merged.attempts ?? 0) - 1),
    retry_policy_version: overrides.retry_policy_version ?? merged.retry_policy_version ?? JOB_RETRY_POLICY_VERSION,
  } as T;
}

function persistJob(tx: DbTransaction, id: string, job: AnalysisJob): void {
  // Callers normalize/build the row before entering the transaction. Do not
  // normalize a second time here: an explicit `active_attempt_id: undefined`
  // is the durable ownership revocation marker during stale recovery.
  tx.put("jobs", id, job);
}

function isCancelled(job: AnalysisJob): boolean {
  return Boolean(job.cancellation_requested || job.cancellation_requested_at);
}

function leaseExpiryAt(nowMs: number, leaseMs: number, deadlineAt?: string): string {
  const deadlineMs = deadlineAt ? asTimestamp(deadlineAt, Number.POSITIVE_INFINITY) : Number.POSITIVE_INFINITY;
  return new Date(Math.min(nowMs + leaseMs, deadlineMs)).toISOString();
}

// Cooperative cancellation: extraction checks its flag between pages.
const cancelFlags = new Set<string>();
export function isJobCancelled(jobId: string): boolean {
  return cancelFlags.has(jobId);
}

/** Read cancellation from the durable job row; process-local flags are only a
 * latency optimization for an already-running worker. */
export async function isJobCancellationRequested(jobId: string): Promise<boolean> {
  const job = await dbGet<AnalysisJob>("jobs", jobId);
  const requested = !!job && isCancelled(normalizeJob(job));
  if (requested) cancelFlags.add(jobId);
  else cancelFlags.delete(jobId);
  // The persisted field is authoritative. The in-memory set is retained only
  // as a compatibility aid for callers of the old synchronous helper.
  return requested;
}

function queuedJob(studyId: string, kind: JobKind, documentId?: string): AnalysisJob {
  const deadlinePolicy = resolveJobDeadlinePolicy();
  const job: AnalysisJob = {
    job_id: newId("job"),
    study_id: studyId,
    kind,
    document_id: documentId,
    status: "queued",
    state: "queued",
    attempts: 0,
    retry_count: 0,
    version: 0,
    claim_version: 0,
    cancellation_requested: false,
    retry_policy_version: JOB_RETRY_POLICY_VERSION,
    deadline_policy: deadlinePolicy,
    created_at: new Date().toISOString(),
    progress: makeJobProgress({ stage: "queued", percent: 0, message: "Waiting for a worker" }),
  };
  return job;
}

export async function enqueueAnalysis(studyId: string): Promise<AnalysisJob> {
  const consent = await checkProcessingConsent(studyId, consentPurposeForJob("analysis"));
  if (!consent.ok) {
    await audit({ actor: "system", action: "job.enqueue", studyId, outcome: "rejected", detail: `CONSENT_REQUIRED:${consentPurposeForJob("analysis")}:${consent.status}` });
    throw new Error(`CONSENT_REQUIRED:${consentPurposeForJob("analysis")}:${consent.status}`);
  }
  await ensureStartupRecovery();
  const job = queuedJob(studyId, "analysis");
  await dbPut("jobs", job.job_id, job);
  await audit({ actor: "system", action: "job.enqueue", studyId, outcome: "ok", detail: job.job_id });
  // Fire-and-forget worker execution; UI polls job status.
  dispatchJob(job.job_id);
  return job;
}

/** Enqueue document text/OCR extraction as an async job (S2). */
export async function enqueueExtraction(documentId: string, studyId: string): Promise<AnalysisJob> {
  const consent = await checkProcessingConsent(studyId, consentPurposeForJob("extraction"));
  if (!consent.ok) {
    await audit({ actor: "system", action: "job.enqueue", studyId, resource: "document", resourceId: documentId, outcome: "rejected", detail: `CONSENT_REQUIRED:${consentPurposeForJob("extraction")}:${consent.status}` });
    throw new Error(`CONSENT_REQUIRED:${consentPurposeForJob("extraction")}:${consent.status}`);
  }
  await ensureStartupRecovery();
  const job = queuedJob(studyId, "extraction", documentId);
  await dbPut("jobs", job.job_id, job);
  await audit({ actor: "system", action: "job.enqueue", studyId, resource: "document", resourceId: documentId, outcome: "ok", detail: `extraction ${job.job_id}` });
  dispatchJob(job.job_id);
  return job;
}

/**
 * Cancels a queued or running job. Queued jobs are marked cancelled
 * immediately; running extraction jobs observe the flag between pages.
 */
export async function cancelJob(jobId: string, requestedBy: string): Promise<AnalysisJob | null> {
  const job = await dbGet<AnalysisJob>("jobs", jobId);
  if (!job) return null;
  const normalized = normalizeJob(job);
  if (terminalStatuses.has(normalized.status)) return normalized;
  if (normalized.status === "running" && ["persisting_analysis", "generating_report", "completed"].includes(normalized.progress?.stage)) {
    await audit({ actor: requestedBy, action: "job.cancel", studyId: normalized.study_id, outcome: "rejected", detail: `${jobId} passed its safe cancellation boundary` });
    throw new Error("Cancellation is no longer safe because result publication has started.");
  }
  cancelFlags.add(jobId);
  let updated: AnalysisJob | null;
  try {
    updated = await dbTransaction((tx) => {
      const currentRaw = tx.get<AnalysisJob>("jobs", jobId);
      const current = currentRaw ? normalizeJob(currentRaw) : null;
      if (!current) return null;
      if (terminalStatuses.has(current.status)) return current;
      if (current.status === "running" && ["persisting_analysis", "generating_report", "completed"].includes(current.progress?.stage)) {
        throw new Error("Cancellation is no longer safe because result publication has started.");
      }
      const at = new Date().toISOString();
      const next: AnalysisJob = durableJob(current, {
        version: (current.version ?? 0) + 1,
        claim_version: (current.claim_version ?? current.version ?? 0) + 1,
        cancellation_requested_at: at,
        cancellation_requested: true,
        last_recovery_at: undefined,
        last_recovery_reason: undefined,
      });
      if (current.status === "queued") {
        next.status = "cancelled";
        next.state = "cancelled";
        next.completed_at = at;
        next.progress = stateProgress("cancelled", current, "Cancelled before execution");
      } else if (current.status === "stale" || current.status === "retryable") {
        next.status = "cancelled";
        next.state = "cancelled";
        next.active_attempt_id = undefined;
        next.completed_at = at;
        next.retry_after_at = undefined;
        next.progress = stateProgress("cancelled", current, "Cancelled before worker recovery");
      } else {
        next.progress = makeJobProgress({
          stage: "cancellation_requested",
          percent: current.progress?.percent ?? 0,
          completed_units: current.progress?.completed_units,
          total_units: current.progress?.total_units,
          message: "Cancellation requested; waiting for the current bounded stage to stop",
        });
      }
      persistJob(tx, jobId, next);
      return next;
    });
  } catch (error) {
    cancelFlags.delete(jobId);
    throw error;
  }
  if (!updated) return null;
  if (terminalStatuses.has(updated.status)) {
    cancelFlags.delete(jobId);
    await audit({ actor: requestedBy, action: "job.cancel", studyId: updated.study_id, resource: "document", resourceId: updated.document_id, outcome: "ok", detail: `${jobId} cancelled by ${requestedBy}` });
    return updated;
  }
  // Cancellation is durable first; then best-effort tree termination stops a
  // currently running local Python worker without touching another job's
  // process tree.
  if (updated.status === "running") {
    void terminateTrackedProcessTrees(jobId).catch(() => undefined);
  }
  await audit({ actor: requestedBy, action: "job.cancel", studyId: job.study_id, resource: "document", resourceId: job.document_id, outcome: "ok", detail: `${jobId} cancelled by ${requestedBy}` });
  return updated;
}

export async function getJob(jobId: string): Promise<AnalysisJob | null> {
  await ensureStartupRecovery();
  const job = await dbGet<AnalysisJob>("jobs", jobId);
  return job ? normalizeJob(job) : null;
}

export async function retryJob(jobId: string, requestedBy: string, idempotencyKey: string): Promise<AnalysisJob | null> {
  const job = await dbGet<AnalysisJob>("jobs", jobId);
  if (!job) return null;
  if (typeof idempotencyKey !== "string" || !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
    throw new Error("A valid idempotency key (8-128 safe characters) is required for retry.");
  }
  const outcome = await dbTransaction((tx) => {
    const currentRaw = tx.get<AnalysisJob>("jobs", jobId);
    const current = currentRaw ? normalizeJob(currentRaw) : null;
    if (!current) return { job: null, replayed: false };
    if (current.retry_idempotency_keys?.includes(idempotencyKey)) return { job: current, replayed: true };
    if (current.status !== "failed" && current.status !== "retryable") throw new Error("Only failed or retryable jobs can be retried.");
    if (current.attempts >= MAX_ATTEMPTS) throw new Error(`Job exceeded maximum attempts (${MAX_ATTEMPTS}).`);
    const next: AnalysisJob = durableJob(current, {
      version: (current.version ?? 0) + 1,
      claim_version: (current.claim_version ?? current.version ?? 0) + 1,
      status: "queued",
      state: "queued",
      error: undefined,
      started_at: undefined,
      completed_at: undefined,
      cancellation_requested_at: undefined,
      cancellation_requested: false,
      active_attempt_id: undefined,
      claimed_at: undefined,
      heartbeat_at: undefined,
      lease_expires_at: undefined,
      worker_id: undefined,
      idempotency_key: idempotencyKey,
      retry_after_at: undefined,
      last_recovery_at: undefined,
      last_recovery_reason: undefined,
      progress: makeJobProgress({ stage: "queued", percent: 0, message: "Retry waiting for a worker" }),
      retry_idempotency_keys: [...(current.retry_idempotency_keys ?? []), idempotencyKey].slice(-16),
      retry_count: (current.retry_count ?? Math.max(0, current.attempts - 1)) + 1,
    });
    persistJob(tx, jobId, next);
    return { job: next, replayed: false };
  });
  if (!outcome.job) return null;
  if (outcome.replayed) return outcome.job;
  const retryJobRecord = outcome.job;
  cancelFlags.delete(jobId);
  await audit({ actor: requestedBy, action: "job.retry", studyId: retryJobRecord.study_id, outcome: "ok", detail: `${jobId} attempt ${retryJobRecord.attempts + 1}` });
  dispatchJob(jobId);
  return retryJobRecord;
}

/**
 * Atomically claim one queued job.  The attempt/worker/claim version are
 * persisted in the same transaction as the state transition, so two workers
 * racing after a restart cannot both own the same attempt.
 */
export async function claimJob(
  jobId: string,
  workerId = workerInstanceId,
  options: { now?: Date | string | number; leaseMs?: number; canClaim?: () => boolean } = {},
): Promise<AnalysisJob | null> {
  const nowMs = asTimestamp(options.now);
  const nowIso = new Date(nowMs).toISOString();
  const leaseMs = boundedPositive(options.leaseMs, configuredLeaseMs, 1000);
  const claimed = await dbTransaction((tx) => {
    const raw = tx.get<AnalysisJob>("jobs", jobId);
    const current = raw ? normalizeJob(raw) : null;
    if (!current || (current.status !== "queued" && current.status !== "retryable")) return null;
    if (current.retry_after_at && asTimestamp(current.retry_after_at) > nowMs) return null;
    // Evaluate the lifecycle guard inside the same synchronous transaction as
    // the durable claim. A shutdown cannot slip between a separate check and
    // this state transition.
    if (options.canClaim && !options.canClaim()) return null;
    if (isCancelled(current)) {
      const cancelled = durableJob(current, {
        version: (current.version ?? 0) + 1,
        claim_version: (current.claim_version ?? current.version ?? 0) + 1,
        status: "cancelled",
        state: "cancelled",
        active_attempt_id: undefined,
        completed_at: nowIso,
        lease_expires_at: undefined,
        heartbeat_at: undefined,
        worker_id: undefined,
        progress: stateProgress("cancelled", current, "Cancelled before execution"),
      });
      persistJob(tx, jobId, cancelled);
      return null;
    }
    const deadlinePolicy = current.deadline_policy ?? resolveJobDeadlinePolicy();
    const queuedAge = classifyJobAge({ created_at: current.created_at, now: nowMs, policy: deadlinePolicy });
    if (queuedAge.outcome !== "WITHIN_BUDGET") {
      const timedOut = durableJob(current, {
        version: (current.version ?? 0) + 1,
        claim_version: (current.claim_version ?? current.version ?? 0) + 1,
        status: "failed",
        state: "failed",
        error: `${queuedAge.outcome}: queue/service budget exceeded before worker claim`,
        completed_at: nowIso,
        deadline_policy: deadlinePolicy,
        queue_wait_ms: queuedAge.queue_wait_ms,
        service_time_ms: queuedAge.service_time_ms,
        total_age_ms: queuedAge.total_age_ms,
        deadline_outcome: queuedAge.outcome,
        progress: stateProgress("failed", current, `${queuedAge.outcome}; no result was published`),
      });
      persistJob(tx, jobId, timedOut);
      return null;
    }
    const attemptId = newId("attempt");
    const attempts = current.attempts + 1;
    const deadlineMs = current.deadline_ms && Number.isSafeInteger(current.deadline_ms) && current.deadline_ms > 0
      ? current.deadline_ms
      : configuredOverallDeadlineMs;
    const deadlineAt = new Date(nowMs + deadlineMs).toISOString();
    const running = durableJob(current, {
      version: (current.version ?? 0) + 1,
      claim_version: (current.claim_version ?? current.version ?? 0) + 1,
      status: "running",
      state: "running",
      started_at: current.started_at ?? nowIso,
      completed_at: undefined,
      attempts,
      retry_count: Math.max(0, attempts - 1),
      attempt_id: attemptId,
      active_attempt_id: attemptId,
      claimed_at: nowIso,
      heartbeat_at: nowIso,
      lease_expires_at: leaseExpiryAt(nowMs, leaseMs, deadlineAt),
      worker_id: workerId,
      deadline_ms: deadlineMs,
      deadline_at: deadlineAt,
      deadline_policy: deadlinePolicy,
      queue_wait_ms: queuedAge.queue_wait_ms,
      service_time_ms: 0,
      total_age_ms: queuedAge.total_age_ms,
      deadline_outcome: "WITHIN_BUDGET",
      resource_request: {
        memory_bytes: JOB_RESOURCE_REQUESTS[current.kind].memoryBytes,
        threads: JOB_RESOURCE_REQUESTS[current.kind].threads,
      },
      resource_reservation_state: undefined,
      resource_rejection_reason: undefined,
      termination_requested_at: undefined,
      termination_outcome: undefined,
      retry_after_at: undefined,
      last_recovery_reason: undefined,
      progress: makeJobProgress({ stage: "preparing", percent: 2, message: "Worker claimed the job" }),
    });
    persistJob(tx, jobId, running);
    return running;
  });
  return claimed ? normalizeJob(claimed) : null;
}

/** Extend a worker lease only when the attempt and worker still own it. */
export async function heartbeatJob(
  jobId: string,
  attemptId: string,
  workerId: string,
  options: { now?: Date | string | number; leaseMs?: number } = {},
): Promise<AnalysisJob | null> {
  const nowMs = asTimestamp(options.now);
  const nowIso = new Date(nowMs).toISOString();
  const leaseMs = boundedPositive(options.leaseMs, configuredLeaseMs, 1000);
  return dbTransaction((tx) => {
    const raw = tx.get<AnalysisJob>("jobs", jobId);
    const current = raw ? normalizeJob(raw) : null;
    if (!current || current.status !== "running" || current.active_attempt_id !== attemptId || current.worker_id !== workerId) return null;
    // Once the lease is expired, a heartbeat cannot steal ownership back from
    // a reaper that may already have marked the attempt stale.
    if (current.lease_expires_at && asTimestamp(current.lease_expires_at) <= nowMs) return null;
    const next = durableJob(current, {
      version: (current.version ?? 0) + 1,
      claim_version: (current.claim_version ?? current.version ?? 0) + 1,
      heartbeat_at: nowIso,
      lease_expires_at: leaseExpiryAt(nowMs, leaseMs, current.deadline_at),
    });
    persistJob(tx, jobId, next);
    return next;
  });
}

function leaseExpired(job: AnalysisJob, nowMs: number, graceMs: number): boolean {
  const expiry = job.lease_expires_at ? asTimestamp(job.lease_expires_at, Number.NaN) : Number.NaN;
  const heartbeat = job.heartbeat_at ?? job.claimed_at ?? job.started_at;
  const heartbeatMs = heartbeat ? asTimestamp(heartbeat, Number.NaN) : Number.NaN;
  // Legacy running rows may have no explicit lease. Their started_at is the
  // safe fallback; no row is considered stale merely because it lacks fields.
  if (!Number.isFinite(expiry) || expiry > nowMs) return false;
  return !Number.isFinite(heartbeatMs) || heartbeatMs + graceMs <= nowMs;
}

/**
 * Mark expired running attempts STALE only.  This function deliberately does
 * not requeue anything; callers must opt into the versioned policy via
 * `recoverStaleJobs`/`recoverJobsOnStartup`.
 */
export async function markExpiredJobsAsStale(options: JobRecoveryOptions = {}): Promise<JobRecoveryResult> {
  const nowMs = asTimestamp(options.now);
  const nowIso = new Date(nowMs).toISOString();
  const graceMs = boundedPositive(options.heartbeatGraceMs, options.heartbeatMs !== undefined ? boundedPositive(options.heartbeatMs, configuredHeartbeatMs, 250) * 2 : configuredHeartbeatGraceMs, 0);
  const result: JobRecoveryResult = { scanned: 0, stale: [], retryable: [], queued: [], failed: [], cancelled: [] };
  await dbTransaction((tx) => {
    const rows = tx.all<AnalysisJob>("jobs");
    result.scanned = rows.length;
    for (const row of rows) {
      const current = normalizeJob(row);
      if (current.status !== "running" || !leaseExpired(current, nowMs, graceMs)) continue;
      const next = durableJob(current, {
        version: (current.version ?? 0) + 1,
        claim_version: (current.claim_version ?? current.version ?? 0) + 1,
        status: "stale",
        state: "stale",
        completed_at: undefined,
        last_recovery_at: nowIso,
        last_recovery_reason: "LEASE_EXPIRED",
        progress: stateProgress("stale", current, "Worker lease expired; awaiting recovery policy"),
      });
      // Keep attempt_id for provenance, but clear active ownership so the old
      // process can no longer publish progress or a terminal state.
      next.active_attempt_id = undefined;
      next.lease_expires_at = undefined;
      next.worker_id = undefined;
      persistJob(tx, current.job_id, next);
      result.stale.push(current.job_id);
    }
  });
  return result;
}

function retryDelayMs(attempts: number, baseMs: number): number {
  if (baseMs <= 0) return 0;
  return Math.min(baseMs * (2 ** Math.max(0, attempts - 1)), 60 * 60 * 1000);
}

/** Apply the explicit, versioned stale-attempt policy. */
export async function recoverStaleJobs(options: JobRecoveryOptions = {}): Promise<JobRecoveryResult> {
  const marked = await markExpiredJobsAsStale(options);
  const nowMs = asTimestamp(options.now);
  const nowIso = new Date(nowMs).toISOString();
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? MAX_ATTEMPTS));
  const baseBackoff = boundedPositive(options.retryBackoffMs, configuredRetryBackoffMs, 0);
  const applyPolicy = options.applyPolicy ?? true;
  if (!applyPolicy) return marked;
  const delayed: Array<{ jobId: string; delayMs: number }> = [];

  await dbTransaction((tx) => {
    for (const row of tx.all<AnalysisJob>("jobs")) {
      const current = normalizeJob(row);
      if (current.status !== "stale") continue;
      if (isCancelled(current)) {
        const next = durableJob(current, {
          version: (current.version ?? 0) + 1,
          claim_version: (current.claim_version ?? current.version ?? 0) + 1,
          status: "cancelled",
          state: "cancelled",
          completed_at: nowIso,
          active_attempt_id: undefined,
          heartbeat_at: undefined,
          lease_expires_at: undefined,
          worker_id: undefined,
          last_recovery_at: nowIso,
          last_recovery_reason: "CANCEL_REQUESTED_DURING_LEASE_EXPIRY",
          progress: stateProgress("cancelled", current, "Cancelled after worker lease expiry"),
        });
        persistJob(tx, current.job_id, next);
        marked.cancelled.push(current.job_id);
        continue;
      }
      if (current.attempts >= maxAttempts) {
        const next = durableJob(current, {
          version: (current.version ?? 0) + 1,
          claim_version: (current.claim_version ?? current.version ?? 0) + 1,
          status: "failed",
          state: "failed",
          error: `Worker lease expired after retry policy ${JOB_RETRY_POLICY_VERSION} exhausted (${maxAttempts} attempts).`,
          completed_at: nowIso,
          active_attempt_id: undefined,
          heartbeat_at: undefined,
          lease_expires_at: undefined,
          worker_id: undefined,
          last_recovery_at: nowIso,
          last_recovery_reason: "RETRY_POLICY_EXHAUSTED",
          progress: stateProgress("failed", current, "Worker lease expired; retry policy exhausted"),
        });
        persistJob(tx, current.job_id, next);
        marked.failed.push(current.job_id);
        continue;
      }
      const delay = retryDelayMs(current.attempts, baseBackoff);
      const retryAfter = new Date(nowMs + delay).toISOString();
      const next = durableJob(current, {
        version: (current.version ?? 0) + 1,
        claim_version: (current.claim_version ?? current.version ?? 0) + 1,
        status: "retryable",
        state: "retryable",
        active_attempt_id: undefined,
        heartbeat_at: undefined,
        lease_expires_at: undefined,
        worker_id: undefined,
        retry_after_at: retryAfter,
        last_recovery_at: nowIso,
        last_recovery_reason: `LEASE_EXPIRED_POLICY_${JOB_RETRY_POLICY_VERSION}`,
        progress: stateProgress("retryable", current, `Retryable after worker lease expiry; next attempt after ${retryAfter}`),
      });
      persistJob(tx, current.job_id, next);
      marked.retryable.push(current.job_id);
      if (delay <= 0) {
        const queued = durableJob(next, {
          version: (next.version ?? 0) + 1,
          claim_version: (next.claim_version ?? next.version ?? 0) + 1,
          status: "queued",
          state: "queued",
          active_attempt_id: undefined,
          heartbeat_at: undefined,
          lease_expires_at: undefined,
          worker_id: undefined,
          retry_after_at: undefined,
          progress: makeJobProgress({ stage: "queued", percent: current.progress?.percent ?? 0, message: "Retry queued after worker lease recovery" }),
        });
        persistJob(tx, current.job_id, queued);
        marked.queued.push(current.job_id);
      } else {
        delayed.push({ jobId: current.job_id, delayMs: delay });
      }
    }
  });
  if (options.startWorkers !== false) {
    for (const jobId of marked.queued) dispatchJob(jobId);
    for (const pending of delayed) scheduleProcess(pending.jobId, pending.delayMs);
  }
  return marked;
}

/** Run the bounded reaper/recovery pass used after a process restart. */
export async function recoverJobsOnStartup(options: JobRecoveryOptions = {}): Promise<JobRecoveryResult> {
  return recoverStaleJobs({
    ...options,
    workerId: options.workerId ?? workerInstanceId,
    applyPolicy: options.applyPolicy ?? true,
    startWorkers: options.startWorkers ?? true,
  });
}

/** Backwards-readable name for maintenance callers. Defaults to mark-only. */
export async function reapExpiredJobs(options: JobRecoveryOptions = {}): Promise<JobRecoveryResult> {
  if (options.applyPolicy) return recoverStaleJobs(options);
  return markExpiredJobsAsStale(options);
}

/** Explicit alias for operators and tests that call the maintenance action a
 * reaper rather than a recovery pass. */
export async function runJobReaper(options: JobRecoveryOptions = {}): Promise<JobRecoveryResult> {
  return recoverStaleJobs({ ...options, applyPolicy: options.applyPolicy ?? true });
}

/**
 * Start a bounded in-process reaper. The handle is explicit so an embedding
 * server can stop it during graceful shutdown/tests; `unref` prevents a
 * maintenance timer from keeping a short-lived CLI process alive.
 */
export function startJobLeaseReaper(options: JobRecoveryOptions = {}): () => void {
  const intervalMs = boundedPositive(options.intervalMs, Math.max(configuredHeartbeatMs, 1000), 250);
  let stopped = false;
  const timer = setInterval(() => {
    if (stopped) return;
    void runJobReaper({ ...options, startWorkers: options.startWorkers ?? true }).catch(() => undefined);
  }, intervalMs);
  timer.unref?.();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

let startupRecovery: Promise<JobRecoveryResult> | null = null;
async function ensureStartupRecovery(): Promise<void> {
  if (!startupRecovery) {
    startupRecovery = recoverJobsOnStartup({ startWorkers: true }).catch((error) => {
      // Recovery is retried on the next explicit maintenance call. Do not
      // turn a transient database startup failure into an unhandled rejection.
      startupRecovery = null;
      throw error;
    });
  }
  await startupRecovery;
}

/** Keep a worker lease alive without leaving an open process handle. */
function startLeaseHeartbeat(jobId: string, attemptId: string, workerId: string): () => void {
  let stopped = false;
  const timer = setInterval(() => {
    if (stopped) return;
    void heartbeatJob(jobId, attemptId, workerId).catch(() => undefined);
  }, configuredHeartbeatMs);
  timer.unref?.();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

async function updateRunningJobMetadata(
  jobId: string,
  attemptId: string,
  workerId: string,
  metadata: Partial<Pick<AnalysisJob, "resource_reservation_state" | "resource_rejection_reason" | "termination_requested_at" | "termination_outcome" | "deadline_outcome" | "service_time_ms" | "total_age_ms">>,
): Promise<void> {
  await dbTransaction((tx) => {
    const raw = tx.get<AnalysisJob>("jobs", jobId);
    const current = raw ? normalizeJob(raw) : null;
    if (!current || current.status !== "running" || current.active_attempt_id !== attemptId || current.worker_id !== workerId) return;
    const next = durableJob(current, {
      ...metadata,
      version: (current.version ?? 0) + 1,
      claim_version: (current.claim_version ?? current.version ?? 0) + 1,
    });
    persistJob(tx, jobId, next);
  });
}

function waitDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/**
 * Capacity is a bounded wait, not an implicit failure.  The durable job has
 * already been claimed, but no provider is started until both the process-local
 * governor and the host-wide lease admit it.  The same absolute job deadline
 * covers this wait; expiry is therefore recorded as a timeout rather than a
 * provider failure or a stale reservation.
 */
async function waitForJobResources(options: {
  kind: JobKind;
  jobId: string;
  attemptId: string;
  workerId: string;
  demoMode: boolean;
  startedAt?: string;
  timeoutMs?: number;
  leaseConfig?: ResourceLeaseConfig;
}): Promise<HostWideJobResourceAdmission> {
  return withOverallJobDeadline(async (deadline) => {
    while (true) {
      deadline.throwIfExpired();
      if (await isJobCancellationRequested(options.jobId)) throw new JobCancelledError();
      const admission = await reserveJobResourcesHostWide(options.kind, {
        jobId: options.jobId,
        workerId: options.workerId,
        modelId: `job:${options.kind}`,
        demoMode: options.demoMode,
        leaseConfig: options.leaseConfig,
      });
      if (admission.admitted) return admission;
      await updateRunningJobMetadata(options.jobId, options.attemptId, options.workerId, {
        resource_reservation_state: "waiting",
        resource_rejection_reason: admission.reason ?? "capacity_unavailable",
      });
      deadline.throwIfExpired();
      await waitDelay(Math.min(configuredResourceWaitPollMs, Math.max(1, deadline.remainingMs())));
    }
  }, {
    startedAt: options.startedAt,
    timeoutMs: options.timeoutMs,
    onExpired: async () => {
      await terminateTrackedProcessTrees(options.jobId);
    },
  });
}

/**
 * Oldest claimable (queued or retryable) jobs. The status filter runs inside
 * the bounded page scanner, so claimable jobs are found however many terminal
 * jobs precede them; filtering a fixed page of the oldest rows would starve
 * every new job once the history exceeded that page.
 */
export async function listClaimCandidates(limit: number): Promise<AnalysisJob[]> {
  const [queued, retryable] = await Promise.all([
    listJobsPage({ limit, direction: "asc", status: "queued" }),
    listJobsPage({ limit, direction: "asc", status: "retryable" }),
  ]);
  return [...queued.items, ...retryable.items]
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.job_id.localeCompare(b.job_id))
    .slice(0, limit);
}

/** Schedule a bounded retry without keeping the process alive solely for a
 * maintenance timer. The durable retry_after_at remains authoritative if the
 * process exits before this callback fires. */
function scheduleProcess(jobId: string, delayMs: number): void {
  if (isExternalWorkerMode()) return;
  const timer = setTimeout(() => void processJob(jobId).catch(() => undefined), Math.max(0, delayMs));
  timer.unref?.();
}

function dispatchJob(jobId: string): void {
  if (isExternalWorkerMode()) return;
  void processJob(jobId).catch(() => undefined);
}

/**
 * Publish a terminal job state exactly once for the owning attempt.  The
 * attempt and worker checks are inside the SQLite transaction; a stale worker
 * or a duplicate finalizer therefore receives null and cannot publish a
 * second terminal transition.
 */
export async function finalizeJobSuccess(jobId: string, attemptId: string, workerId: string): Promise<AnalysisJob | null> {
  return dbTransaction((tx) => {
    const raw = tx.get<AnalysisJob>("jobs", jobId);
    const current = raw ? normalizeJob(raw) : null;
    if (!current || current.status !== "running" || current.active_attempt_id !== attemptId || current.worker_id !== workerId || isCancelled(current)) return null;
    const next = durableJob(current, {
      version: (current.version ?? 0) + 1,
      claim_version: (current.claim_version ?? current.version ?? 0) + 1,
      status: "completed",
      state: "completed",
      completed_at: new Date().toISOString(),
      active_attempt_id: undefined,
      heartbeat_at: undefined,
      lease_expires_at: undefined,
      worker_id: undefined,
      resource_reservation_state: current.resource_reservation_state === "admitted" ? "released" : current.resource_reservation_state,
      progress: makeJobProgress({ stage: "completed", percent: 100, completed_units: 1, total_units: 1, message: "Job completed" }),
    });
    putJobEffectInTransaction(tx, buildJobEffectRecord({
      effect_type: "JOB_COMPLETION",
      idempotency_key: jobId,
      canonical_id: jobId,
      payload: { job_id: jobId, attempt_id: attemptId, status: "completed" },
      study_id: current.study_id,
      job_id: jobId,
      attempt_id: attemptId,
      note: "Terminal completion is atomically fenced with the job transition; duplicate finalizers are rejected.",
    }));
    persistJob(tx, jobId, next);
    return next;
  });
}

export async function finalizeJobCancelled(jobId: string, attemptId: string, workerId: string): Promise<AnalysisJob | null> {
  return dbTransaction((tx) => {
    const raw = tx.get<AnalysisJob>("jobs", jobId);
    const current = raw ? normalizeJob(raw) : null;
    if (!current || current.status !== "running" || current.active_attempt_id !== attemptId || current.worker_id !== workerId) return null;
    const next = durableJob(current, {
      version: (current.version ?? 0) + 1,
      claim_version: (current.claim_version ?? current.version ?? 0) + 1,
      status: "cancelled",
      state: "cancelled",
      completed_at: new Date().toISOString(),
      error: undefined,
      cancellation_requested: true,
      active_attempt_id: undefined,
      heartbeat_at: undefined,
      lease_expires_at: undefined,
      worker_id: undefined,
      resource_reservation_state: current.resource_reservation_state === "admitted" ? "released" : current.resource_reservation_state,
      progress: stateProgress("cancelled", current, "Cancelled without publishing a result"),
    });
    persistJob(tx, jobId, next);
    return next;
  });
}

export async function finalizeJobFailure(jobId: string, attemptId: string, workerId: string, error: string): Promise<AnalysisJob | null> {
  return dbTransaction((tx) => {
    const raw = tx.get<AnalysisJob>("jobs", jobId);
    const current = raw ? normalizeJob(raw) : null;
    if (!current || current.status !== "running" || current.active_attempt_id !== attemptId || current.worker_id !== workerId) return null;
    const next = durableJob(current, {
      version: (current.version ?? 0) + 1,
      claim_version: (current.claim_version ?? current.version ?? 0) + 1,
      status: "failed",
      state: "failed",
      error: error.slice(0, 400),
      completed_at: new Date().toISOString(),
      active_attempt_id: undefined,
      heartbeat_at: undefined,
      lease_expires_at: undefined,
      worker_id: undefined,
      resource_reservation_state: current.resource_reservation_state === "admitted" ? "released" : current.resource_reservation_state,
      progress: stateProgress("failed", current, "Job failed; no result was published"),
    });
    persistJob(tx, jobId, next);
    return next;
  });
}

/** Execute one queued job. Exported for the separate local worker process. */
export interface ProcessJobCallbacks {
  /** Checked immediately before the transactional claim. */
  canClaim?: () => boolean | Promise<boolean>;
  /** Synchronous guard evaluated inside the claim transaction. */
  canClaimSync?: () => boolean;
  /** Called synchronously after a durable claim and before model work. */
  onJobClaimed?: (job: AnalysisJob) => void | Promise<void>;
  /** Called after resource cleanup, regardless of terminal outcome. */
  onJobFinished?: (jobId: string) => void | Promise<void>;
}

export async function processJob(
  jobId: string,
  requestedWorkerId = workerInstanceId,
  callbacks: ProcessJobCallbacks = {},
): Promise<void> {
  if (callbacks.canClaim && !(await callbacks.canClaim())) return;
  const claimedJob = await claimJob(jobId, requestedWorkerId, { canClaim: callbacks.canClaimSync });
  if (!claimedJob || !claimedJob.active_attempt_id) return;
  const claim = { job: claimedJob, attemptId: claimedJob.active_attempt_id };
  if (!claim.job || !claim.attemptId) return;
  const job = claim.job;
  const attemptId = claim.attemptId;
  const workerId = job.worker_id ?? requestedWorkerId;
  await callbacks.onJobClaimed?.(job);
  const finishClaimedJob = async (): Promise<void> => {
    try { await callbacks.onJobFinished?.(jobId); } catch { /* lifecycle telemetry is best effort */ }
  };
  let reservation: ModelJobReservation | null = null;
  let hostResourceLease: ResourceLeaseHandle | null = null;
  let stopHeartbeat: (() => void) | null = null;
  let stopResourceLeaseHeartbeat: (() => void) | null = null;
  const hostResourceLeaseConfig = resourceLeaseConfigFromEnv();
  let consent;
  try {
    consent = await checkProcessingConsent(job.study_id, consentPurposeForJob(job.kind));
  } catch (error) {
    const failed = await finalizeJobFailure(jobId, attemptId, workerId, `CONSENT_CHECK_FAILED:${String(error instanceof Error ? error.message : error)}`);
    if (failed) {
      await audit({
        actor: "system",
        action: "job.fail",
        studyId: job.study_id,
        resource: job.kind === "extraction" ? "document" : undefined,
        resourceId: job.document_id,
        outcome: "error",
        detail: `${jobId}: consent check failed before processing`,
      });
    }
    await finishClaimedJob();
    return;
  }
  if (!consent.ok) {
    const failed = await finalizeJobFailure(
      jobId,
      attemptId,
      workerId,
      `CONSENT_REQUIRED:${consentPurposeForJob(job.kind)}:${consent.status}`,
    );
    if (failed) {
      await audit({
        actor: "system",
        action: "job.fail",
        studyId: job.study_id,
        resource: job.kind === "extraction" ? "document" : undefined,
        resourceId: job.document_id,
        outcome: "rejected",
        detail: `${jobId}: consent ${consentPurposeForJob(job.kind)} ${consent.status}`,
      });
    }
    await finishClaimedJob();
    return;
  }
  let admission: HostWideJobResourceAdmission;
  try {
    admission = await waitForJobResources({
      kind: job.kind,
      jobId,
      attemptId,
      workerId,
      demoMode: DEMO_MODE,
      startedAt: job.claimed_at ?? job.started_at,
      timeoutMs: job.deadline_ms,
      leaseConfig: hostResourceLeaseConfig,
    });
  } catch (error) {
    if (error instanceof JobCancelledError || await isJobCancellationRequested(jobId)) {
      const cancelled = await finalizeJobCancelled(jobId, attemptId, workerId);
      if (cancelled) cancelFlags.delete(jobId);
      try { await callbacks.onJobFinished?.(jobId); } catch { /* lifecycle telemetry is best effort */ }
      return;
    }
    const deadlineExceeded = error instanceof JobDeadlineExceededError;
    const serviceTimeMs = Math.max(0, Date.now() - asTimestamp(job.claimed_at ?? job.started_at));
    await updateRunningJobMetadata(jobId, attemptId, workerId, {
      resource_reservation_state: "rejected",
      resource_rejection_reason: deadlineExceeded ? "RESOURCE_WAIT_DEADLINE_EXCEEDED" : "RESOURCE_WAIT_FAILED",
      deadline_outcome: deadlineExceeded ? "JOB_DEADLINE_EXCEEDED" : undefined,
      service_time_ms: serviceTimeMs,
      total_age_ms: Math.max(0, Date.now() - asTimestamp(job.created_at)),
    });
    const failure = deadlineExceeded
      ? `JOB_DEADLINE_EXCEEDED:${(error as JobDeadlineExceededError).deadlineAt}`
      : `RESOURCE_WAIT_FAILED:${String(error instanceof Error ? error.message : error).slice(0, 300)}`;
    const failed = await finalizeJobFailure(jobId, attemptId, workerId, failure);
    if (failed) {
      await audit({
        actor: "system",
        action: "job.fail",
        studyId: job.study_id,
        outcome: "error",
        detail: `${jobId}: ${deadlineExceeded ? "resource wait exceeded the job deadline" : "resource wait failed"}`,
      });
    }
    try { await callbacks.onJobFinished?.(jobId); } catch { /* lifecycle telemetry is best effort */ }
    return;
  }
  await updateRunningJobMetadata(jobId, attemptId, workerId, {
    resource_reservation_state: admission.bypassedDemoMode ? "bypassed_demo" : "admitted",
    resource_rejection_reason: undefined,
  });
  reservation = admission.reservation;
  hostResourceLease = admission.resourceLease;
  stopHeartbeat = startLeaseHeartbeat(jobId, attemptId, workerId);
  if (hostResourceLease) stopResourceLeaseHeartbeat = startResourceLeaseHeartbeat(hostResourceLease, { leaseConfig: hostResourceLeaseConfig });

  const updateProgress = async (update: ProgressUpdate): Promise<void> => {
    await dbTransaction((tx) => {
      const raw = tx.get<AnalysisJob>("jobs", jobId);
      const current = raw ? normalizeJob(raw) : null;
      if (!current || current.status !== "running" || current.active_attempt_id !== attemptId || current.worker_id !== workerId) return;
      const next = makeJobProgress(update);
      if (next.percent < (current.progress?.percent ?? 0)) next.percent = current.progress.percent;
      const at = new Date().toISOString();
      const refreshed = durableJob(current, {
        version: (current.version ?? 0) + 1,
        claim_version: (current.claim_version ?? current.version ?? 0) + 1,
        progress: next,
        heartbeat_at: at,
        lease_expires_at: leaseExpiryAt(Date.now(), configuredLeaseMs, current.deadline_at),
      });
      persistJob(tx, jobId, refreshed);
    });
  };

  const finalizeCancelled = async (): Promise<boolean> => {
    const finalized = await finalizeJobCancelled(jobId, attemptId, workerId);
    if (finalized) cancelFlags.delete(jobId);
    return !!finalized;
  };

  try {
    await withProcessTreeScope(jobId, () => withOverallJobDeadline(async (deadline) => {
      deadline.throwIfExpired();
      const shouldCancel = async () => deadline.signal.aborted || await isJobCancellationRequested(jobId);
      if (job.kind === "extraction") {
        const { extractDocument } = await import("../documents/extraction/service");
        const outcome = await extractDocument(job.document_id!, "job_worker", {
          shouldCancel,
          onProgress: updateProgress,
        });
        if (!outcome.ok && outcome.error_code === "CANCELLED") {
          await finalizeCancelled();
          return;
        }
        if (!outcome.ok) throw new Error(outcome.error_code ?? "EXTRACTION_FAILED");
      } else {
        // Lazy import avoids a circular dependency (service -> queue is fine;
        // keeping the import here keeps the queue generic).
        const { analyzeStudy } = await import("../studies/service");
        await analyzeStudy(job.study_id, {
          job_id: jobId,
          attempt_id: attemptId,
          signal: deadline.signal,
          assertCanCommit: async () => {
            const currentRaw = await dbGet<AnalysisJob>("jobs", jobId);
            const current = currentRaw ? normalizeJob(currentRaw) : null;
            return !!current && current.status === "running" && current.active_attempt_id === attemptId && current.worker_id === workerId && !isCancelled(current);
          },
          shouldCancel,
          onProgress: updateProgress,
        });
      }
      deadline.throwIfExpired();
    }, {
      startedAt: job.claimed_at ?? job.started_at,
      timeoutMs: job.deadline_ms,
      onExpired: async () => {
        const outcomes = await terminateTrackedProcessTrees(jobId);
        await updateRunningJobMetadata(jobId, attemptId, workerId, {
          termination_requested_at: new Date().toISOString(),
          termination_outcome: outcomes.map((outcome) => outcome.outcome).join(",") || "no-active-child",
        });
      },
    }));
    const currentRaw = await dbGet<AnalysisJob>("jobs", jobId);
    const current = currentRaw ? normalizeJob(currentRaw) : null;
    if (!current || current.status !== "running" || current.active_attempt_id !== attemptId || current.worker_id !== workerId) return;
    if (isCancelled(current) || await isJobCancellationRequested(jobId)) {
      await finalizeCancelled();
      return;
    }
    maybeInjectPhase9Fault("BEFORE_JOB_COMPLETE");
    const completed = await finalizeJobSuccess(jobId, attemptId, workerId);
    if (!completed) return;
    cancelFlags.delete(jobId);
    // This seam is deliberately after the SQLite terminal transaction has
    // committed, but before post-transaction audit/lifecycle acknowledgement.
    // A restart must observe the completed row and replay no provider/effects.
    maybeInjectPhase9Fault("AFTER_JOB_COMPLETION_TRANSACTION");
    await audit({ actor: "system", action: "job.complete", studyId: job.study_id, resource: job.kind === "extraction" ? "document" : undefined, resourceId: job.document_id, outcome: "ok", detail: jobId });
  } catch (err) {
    if (err instanceof JobCancelledError || await isJobCancellationRequested(jobId)) {
      await finalizeCancelled();
      return;
    }
    const error = err instanceof JobDeadlineExceededError
      ? `JOB_DEADLINE_EXCEEDED:${err.deadlineAt}`
      : String(err instanceof Error ? err.message : err);
    if (err instanceof JobDeadlineExceededError) {
      const nowMs = Date.now();
      await updateRunningJobMetadata(jobId, attemptId, workerId, {
        deadline_outcome: "JOB_DEADLINE_EXCEEDED",
        service_time_ms: Math.max(0, nowMs - asTimestamp(job.claimed_at ?? job.started_at)),
        total_age_ms: Math.max(0, nowMs - asTimestamp(job.created_at)),
      });
    }
    const failed = await finalizeJobFailure(
      jobId,
      attemptId,
      workerId,
      error,
    );
    if (!failed) return;
    cancelFlags.delete(jobId);
    await audit({ actor: "system", action: "job.fail", studyId: job.study_id, resource: job.kind === "extraction" ? "document" : undefined, resourceId: job.document_id, outcome: "error", detail: `${jobId}: ${(failed.error ?? "").slice(0, 150)}` });
    // FAILURE HANDLING contract: no result is generated; the UI shows
    // ANALYSIS FAILED with Retry / Request New Scan.
  } finally {
    stopHeartbeat?.();
    stopResourceLeaseHeartbeat?.();
    if (hostResourceLease) {
      await releaseJobResourceLease(hostResourceLease, { leaseConfig: hostResourceLeaseConfig }).catch(() => false);
    }
    if (reservation) {
      const { getHostModelJobResourceGovernor } = await import("../runtime");
      getHostModelJobResourceGovernor().release(reservation);
    }
    try {
      await callbacks.onJobFinished?.(jobId);
    } catch {
      // Lifecycle telemetry must never replace the durable job outcome.
    }
  }
}

/**
 * One bounded external-worker poll. Candidate selection is only a hint; the
 * existing transactional `claimJob` remains the authority, so concurrent
 * workers cannot double-own a row. The initial deployment intentionally
 * processes one job per pass to keep local model subprocess memory bounded.
 */
export async function runWorkerOnce(options: {
  workerId?: string;
  maxJobs?: number;
  canClaim?: () => boolean | Promise<boolean>;
  canClaimSync?: () => boolean;
  onJobClaimed?: (job: AnalysisJob) => void | Promise<void>;
  onJobFinished?: (jobId: string) => void | Promise<void>;
} = {}): Promise<{
  polled: number;
  job_ids: string[];
  recovery: JobRecoveryResult;
}> {
  const workerId = options.workerId?.trim() || workerInstanceId;
  const maxJobs = Math.max(1, Math.min(1, Math.floor(options.maxJobs ?? 1)));
  const recovery = await recoverJobsOnStartup({ workerId, startWorkers: false });
  const candidates = await listClaimCandidates(maxJobs);
  const claimedIds: string[] = [];
  for (const job of candidates) {
    if (options.canClaim && !(await options.canClaim())) break;
    await processJob(job.job_id, workerId, {
      canClaim: options.canClaim,
      canClaimSync: options.canClaimSync,
      onJobClaimed: async (claimed) => {
        claimedIds.push(claimed.job_id);
        await options.onJobClaimed?.(claimed);
      },
      onJobFinished: options.onJobFinished,
    });
  }
  return { polled: candidates.length, job_ids: claimedIds, recovery };
}
