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

import { dbPut, dbGet } from "../storage/db";
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
  job.cancellation_requested_at = new Date().toISOString();
  if (job.status === "queued") {
    job.status = "cancelled";
    job.completed_at = job.cancellation_requested_at;
    job.progress = makeJobProgress({ stage: "cancelled", percent: job.progress?.percent ?? 0, message: "Cancelled before execution" });
  } else {
    job.progress = makeJobProgress({
      stage: "cancellation_requested",
      percent: job.progress?.percent ?? 0,
      completed_units: job.progress?.completed_units,
      total_units: job.progress?.total_units,
      message: "Cancellation requested; waiting for the current bounded stage to stop",
    });
  }
  await dbPut("jobs", jobId, job);
  await audit({ actor: requestedBy, action: "job.cancel", studyId: job.study_id, resource: "document", resourceId: job.document_id, outcome: "ok", detail: `${jobId} cancelled by ${requestedBy}` });
  return job;
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
  if (job.retry_idempotency_keys?.includes(idempotencyKey)) {
    // Exact replay: return current state without another transition, worker,
    // attempt, or audit event.
    return job;
  }
  if (job.status !== "failed") throw new Error("Only failed jobs can be retried.");
  if (job.attempts >= MAX_ATTEMPTS) throw new Error(`Job exceeded maximum attempts (${MAX_ATTEMPTS}).`);
  job.status = "queued";
  job.error = undefined;
  job.started_at = undefined;
  job.completed_at = undefined;
  job.cancellation_requested_at = undefined;
  job.active_attempt_id = undefined;
  job.progress = makeJobProgress({ stage: "queued", percent: 0, message: "Retry waiting for a worker" });
  job.retry_idempotency_keys = [...(job.retry_idempotency_keys ?? []), idempotencyKey].slice(-16);
  cancelFlags.delete(jobId);
  await dbPut("jobs", jobId, job);
  await audit({ actor: requestedBy, action: "job.retry", studyId: job.study_id, outcome: "ok", detail: `${jobId} attempt ${job.attempts + 1}` });
  void processJob(jobId);
  return job;
}

/** In-process worker. Replace with an external worker process for production scale. */
async function processJob(jobId: string): Promise<void> {
  const job = await dbGet<AnalysisJob>("jobs", jobId);
  if (!job || job.status !== "queued") return;
  if (job.cancellation_requested_at || isJobCancelled(jobId)) {
    job.status = "cancelled";
    job.completed_at = new Date().toISOString();
    job.progress = makeJobProgress({ stage: "cancelled", percent: job.progress?.percent ?? 0, message: "Cancelled before execution" });
    await dbPut("jobs", jobId, job);
    return;
  }
  const attemptId = newId("attempt");
  job.status = "running";
  job.started_at = new Date().toISOString();
  job.completed_at = undefined;
  job.attempts += 1;
  job.active_attempt_id = attemptId;
  job.progress = makeJobProgress({ stage: "preparing", percent: 2, message: "Worker claimed the job" });
  await dbPut("jobs", jobId, job);

  const updateProgress = async (update: ProgressUpdate): Promise<void> => {
    const current = await dbGet<AnalysisJob>("jobs", jobId);
    if (!current || current.status !== "running" || current.active_attempt_id !== attemptId) return;
    const next = makeJobProgress(update);
    // Within one attempt progress is monotonic. A retry receives a fresh
    // attempt id and explicitly resets progress to zero above.
    if (next.percent < (current.progress?.percent ?? 0)) next.percent = current.progress.percent;
    current.progress = next;
    await dbPut("jobs", jobId, current);
  };

  const finalizeCancelled = async (): Promise<void> => {
    const current = await dbGet<AnalysisJob>("jobs", jobId);
    if (!current || current.active_attempt_id !== attemptId) return;
    current.status = "cancelled";
    current.completed_at = new Date().toISOString();
    current.error = undefined;
    current.progress = makeJobProgress({
      stage: "cancelled",
      percent: current.progress?.percent ?? 0,
      completed_units: current.progress?.completed_units,
      total_units: current.progress?.total_units,
      message: "Cancelled without publishing a result",
    });
    await dbPut("jobs", jobId, current);
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
    current.status = "completed";
    current.completed_at = new Date().toISOString();
    current.progress = makeJobProgress({ stage: "completed", percent: 100, completed_units: 1, total_units: 1, message: "Job completed" });
    await dbPut("jobs", jobId, current);
    cancelFlags.delete(jobId);
    await audit({ actor: "system", action: "job.complete", studyId: job.study_id, resource: job.kind === "extraction" ? "document" : undefined, resourceId: job.document_id, outcome: "ok", detail: jobId });
  } catch (err) {
    if (err instanceof JobCancelledError || isJobCancelled(jobId)) {
      await finalizeCancelled();
      return;
    }
    const current = await dbGet<AnalysisJob>("jobs", jobId);
    if (!current || current.active_attempt_id !== attemptId) return;
    current.status = "failed";
    current.error = String(err instanceof Error ? err.message : err).slice(0, 400);
    current.completed_at = new Date().toISOString();
    current.progress = makeJobProgress({ stage: "failed", percent: current.progress?.percent ?? 0, message: "Job failed; no result was published" });
    await dbPut("jobs", jobId, current);
    cancelFlags.delete(jobId);
    await audit({ actor: "system", action: "job.fail", studyId: job.study_id, resource: job.kind === "extraction" ? "document" : undefined, resourceId: job.document_id, outcome: "error", detail: `${jobId}: ${current.error.slice(0, 150)}` });
    // FAILURE HANDLING contract: no result is generated; the UI shows
    // ANALYSIS FAILED with Retry / Request New Scan.
  }
}
