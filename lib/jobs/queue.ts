/**
 * Analysis job queue — keeps model inference off the UI request path.
 *
 *   UPLOAD -> QUEUE STUDY -> WORKER -> MODEL INFERENCE -> VALIDATION
 *     -> STORE RESULT -> UI POLLING
 *
 * The worker currently runs in-process (adequate for this local single-user
 * research deployment). The job interface is intentionally shaped so a real
 * separate worker process (e.g. reading from a persistent queue) can replace
 * `runWorkerLoop` without touching callers or the UI.
 */

import { dbPut, dbGet, dbTransaction } from "../storage/db";
import { newId } from "../storage/files";
import { audit } from "../audit";
import { JobCancelledError, makeJobProgress, type JobProgress, type ProgressUpdate } from "./control";

export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type JobKind = "analysis" | "extraction";

export interface AnalysisJob {
  job_id: string;
  study_id: string;
  kind: JobKind;
  document_id?: string;   // extraction jobs carry the target document
  status: JobStatus;
  attempts: number;
  error?: string;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  cancellation_requested_at?: string;
  active_attempt_id?: string;
  /** Monotonic CAS version; every state transition increments it. */
  version?: number;
  claimed_at?: string;
  lease_expires_at?: string;
  worker_id?: string;
  retry_idempotency_keys?: string[];
  progress: JobProgress;
}

const MAX_ATTEMPTS = 3;

// Cooperative cancellation: extraction checks its flag between pages.
const cancelFlags = new Set<string>();
export function isJobCancelled(jobId: string): boolean {
  return cancelFlags.has(jobId);
}

export async function enqueueAnalysis(studyId: string): Promise<AnalysisJob> {
  const job: AnalysisJob = {
    job_id: newId("job"),
    study_id: studyId,
    kind: "analysis",
    status: "queued",
    attempts: 0,
    version: 0,
    created_at: new Date().toISOString(),
    progress: makeJobProgress({ stage: "queued", percent: 0, message: "Waiting for a worker" }),
  };
  await dbPut("jobs", job.job_id, job);
  await audit({ actor: "system", action: "job.enqueue", studyId, outcome: "ok", detail: job.job_id });
  // Fire-and-forget worker execution; UI polls job status.
  void processJob(job.job_id);
  return job;
}

/** Enqueue document text/OCR extraction as an async job (S2). */
export async function enqueueExtraction(documentId: string, studyId: string): Promise<AnalysisJob> {
  const job: AnalysisJob = {
    job_id: newId("job"),
    study_id: studyId,
    kind: "extraction",
    document_id: documentId,
    status: "queued",
    attempts: 0,
    version: 0,
    created_at: new Date().toISOString(),
    progress: makeJobProgress({ stage: "queued", percent: 0, message: "Waiting for a worker" }),
  };
  await dbPut("jobs", job.job_id, job);
  await audit({ actor: "system", action: "job.enqueue", studyId, resource: "document", resourceId: documentId, outcome: "ok", detail: `extraction ${job.job_id}` });
  void processJob(job.job_id);
  return job;
}

/**
 * Cancels a queued or running job. Queued jobs are marked cancelled
 * immediately; running extraction jobs observe the flag between pages.
 */
export async function cancelJob(jobId: string, requestedBy: string): Promise<AnalysisJob | null> {
  const job = await dbGet<AnalysisJob>("jobs", jobId);
  if (!job) return null;
  if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") return job;
  if (job.status === "running" && ["persisting_analysis", "generating_report", "completed"].includes(job.progress?.stage)) {
    await audit({ actor: requestedBy, action: "job.cancel", studyId: job.study_id, outcome: "rejected", detail: `${jobId} passed its safe cancellation boundary` });
    throw new Error("Cancellation is no longer safe because result publication has started.");
  }
  cancelFlags.add(jobId);
  const updated = await dbTransaction((tx) => {
    const current = tx.get<AnalysisJob>("jobs", jobId);
    if (!current) return null;
    if (["completed", "failed", "cancelled"].includes(current.status)) return current;
    const at = new Date().toISOString();
    const next: AnalysisJob = {
      ...current,
      version: (current.version ?? 0) + 1,
      cancellation_requested_at: at,
    };
    if (current.status === "queued") {
      next.status = "cancelled";
      next.completed_at = at;
      next.progress = makeJobProgress({ stage: "cancelled", percent: current.progress?.percent ?? 0, message: "Cancelled before execution" });
    } else {
      next.progress = makeJobProgress({
        stage: "cancellation_requested",
        percent: current.progress?.percent ?? 0,
        completed_units: current.progress?.completed_units,
        total_units: current.progress?.total_units,
        message: "Cancellation requested; waiting for the current bounded stage to stop",
      });
    }
    tx.put("jobs", jobId, next);
    return next;
  });
  if (!updated) return null;
  if (["completed", "failed", "cancelled"].includes(updated.status)) return updated;
  await audit({ actor: requestedBy, action: "job.cancel", studyId: job.study_id, resource: "document", resourceId: job.document_id, outcome: "ok", detail: `${jobId} cancelled by ${requestedBy}` });
  return updated;
}

export async function getJob(jobId: string): Promise<AnalysisJob | null> {
  return dbGet<AnalysisJob>("jobs", jobId);
}

export async function retryJob(jobId: string, requestedBy: string, idempotencyKey: string): Promise<AnalysisJob | null> {
  const job = await dbGet<AnalysisJob>("jobs", jobId);
  if (!job) return null;
  if (typeof idempotencyKey !== "string" || !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
    throw new Error("A valid idempotency key (8-128 safe characters) is required for retry.");
  }
  const outcome = await dbTransaction((tx) => {
    const current = tx.get<AnalysisJob>("jobs", jobId);
    if (!current) return { job: null, replayed: false };
    if (current.retry_idempotency_keys?.includes(idempotencyKey)) return { job: current, replayed: true };
    if (current.status !== "failed") throw new Error("Only failed jobs can be retried.");
    if (current.attempts >= MAX_ATTEMPTS) throw new Error(`Job exceeded maximum attempts (${MAX_ATTEMPTS}).`);
    const next: AnalysisJob = {
      ...current,
      version: (current.version ?? 0) + 1,
      status: "queued",
      error: undefined,
      started_at: undefined,
      completed_at: undefined,
      cancellation_requested_at: undefined,
      active_attempt_id: undefined,
      claimed_at: undefined,
      lease_expires_at: undefined,
      worker_id: undefined,
      progress: makeJobProgress({ stage: "queued", percent: 0, message: "Retry waiting for a worker" }),
      retry_idempotency_keys: [...(current.retry_idempotency_keys ?? []), idempotencyKey].slice(-16),
    };
    tx.put("jobs", jobId, next);
    return { job: next, replayed: false };
  });
  if (!outcome.job) return null;
  if (outcome.replayed) return outcome.job;
  const retryJobRecord = outcome.job;
  cancelFlags.delete(jobId);
  await audit({ actor: requestedBy, action: "job.retry", studyId: retryJobRecord.study_id, outcome: "ok", detail: `${jobId} attempt ${retryJobRecord.attempts + 1}` });
  void processJob(jobId);
  return retryJobRecord;
}

/** In-process worker. Replace with an external worker process for production scale. */
async function processJob(jobId: string): Promise<void> {
  const claim = await dbTransaction((tx) => {
    const current = tx.get<AnalysisJob>("jobs", jobId);
    if (!current || current.status !== "queued") return { job: null, attemptId: null, cancelled: false };
    if (current.cancellation_requested_at || isJobCancelled(jobId)) {
      const cancelled: AnalysisJob = {
        ...current,
        version: (current.version ?? 0) + 1,
        status: "cancelled",
        completed_at: new Date().toISOString(),
        progress: makeJobProgress({ stage: "cancelled", percent: current.progress?.percent ?? 0, message: "Cancelled before execution" }),
      };
      tx.put("jobs", jobId, cancelled);
      return { job: null, attemptId: null, cancelled: true };
    }
    const attemptId = newId("attempt");
    const started = new Date().toISOString();
    const running: AnalysisJob = {
      ...current,
      version: (current.version ?? 0) + 1,
      status: "running",
      started_at: started,
      completed_at: undefined,
      attempts: current.attempts + 1,
      active_attempt_id: attemptId,
      claimed_at: started,
      lease_expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      worker_id: `${process.pid}`,
      progress: makeJobProgress({ stage: "preparing", percent: 2, message: "Worker claimed the job" }),
    };
    tx.put("jobs", jobId, running);
    return { job: running, attemptId, cancelled: false };
  });
  if (!claim.job || !claim.attemptId) return;
  const job = claim.job;
  const attemptId = claim.attemptId;

  const updateProgress = async (update: ProgressUpdate): Promise<void> => {
    await dbTransaction((tx) => {
      const current = tx.get<AnalysisJob>("jobs", jobId);
      if (!current || current.status !== "running" || current.active_attempt_id !== attemptId) return;
      const next = makeJobProgress(update);
      if (next.percent < (current.progress?.percent ?? 0)) next.percent = current.progress.percent;
      tx.put("jobs", jobId, { ...current, version: (current.version ?? 0) + 1, progress: next });
    });
  };

  const finalizeCancelled = async (): Promise<void> => {
    await dbTransaction((tx) => {
      const current = tx.get<AnalysisJob>("jobs", jobId);
      if (!current || current.active_attempt_id !== attemptId) return;
      tx.put("jobs", jobId, {
        ...current,
        version: (current.version ?? 0) + 1,
        status: "cancelled",
        completed_at: new Date().toISOString(),
        error: undefined,
        progress: makeJobProgress({
          stage: "cancelled",
          percent: current.progress?.percent ?? 0,
          completed_units: current.progress?.completed_units,
          total_units: current.progress?.total_units,
          message: "Cancelled without publishing a result",
        }),
      });
    });
    cancelFlags.delete(jobId);
  };

  try {
    if (job.kind === "extraction") {
      const { extractDocument } = await import("../documents/extraction/service");
      const outcome = await extractDocument(job.document_id!, "job_worker", {
        shouldCancel: () => isJobCancelled(jobId),
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
        shouldCancel: () => isJobCancelled(jobId),
        onProgress: updateProgress,
      });
    }
    const current = await dbGet<AnalysisJob>("jobs", jobId);
    if (!current || current.active_attempt_id !== attemptId) return;
    if (current.cancellation_requested_at || isJobCancelled(jobId)) {
      await finalizeCancelled();
      return;
    }
    const completed = await dbTransaction((tx) => {
      const latest = tx.get<AnalysisJob>("jobs", jobId);
      if (!latest || latest.status !== "running" || latest.active_attempt_id !== attemptId) return null;
      const next = {
        ...latest,
        version: (latest.version ?? 0) + 1,
        status: "completed" as const,
        completed_at: new Date().toISOString(),
        lease_expires_at: undefined,
        progress: makeJobProgress({ stage: "completed", percent: 100, completed_units: 1, total_units: 1, message: "Job completed" }),
      };
      tx.put("jobs", jobId, next);
      return next;
    });
    if (!completed) return;
    cancelFlags.delete(jobId);
    await audit({ actor: "system", action: "job.complete", studyId: job.study_id, resource: job.kind === "extraction" ? "document" : undefined, resourceId: job.document_id, outcome: "ok", detail: jobId });
  } catch (err) {
    if (err instanceof JobCancelledError || isJobCancelled(jobId)) {
      await finalizeCancelled();
      return;
    }
    const failed = await dbTransaction((tx) => {
      const latest = tx.get<AnalysisJob>("jobs", jobId);
      if (!latest || latest.active_attempt_id !== attemptId || latest.status !== "running") return null;
      const error = String(err instanceof Error ? err.message : err).slice(0, 400);
      const next = {
        ...latest,
        version: (latest.version ?? 0) + 1,
        status: "failed" as const,
        error,
        completed_at: new Date().toISOString(),
        lease_expires_at: undefined,
        progress: makeJobProgress({ stage: "failed", percent: latest.progress?.percent ?? 0, message: "Job failed; no result was published" }),
      };
      tx.put("jobs", jobId, next);
      return next;
    });
    if (!failed) return;
    cancelFlags.delete(jobId);
    await audit({ actor: "system", action: "job.fail", studyId: job.study_id, resource: job.kind === "extraction" ? "document" : undefined, resourceId: job.document_id, outcome: "error", detail: `${jobId}: ${(failed.error ?? "").slice(0, 150)}` });
    // FAILURE HANDLING contract: no result is generated; the UI shows
    // ANALYSIS FAILED with Retry / Request New Scan.
  }
}
