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

export type JobStatus = "queued" | "running" | "completed" | "failed";

export interface AnalysisJob {
  job_id: string;
  study_id: string;
  status: JobStatus;
  attempts: number;
  error?: string;
  created_at: string;
  started_at?: string;
  completed_at?: string;
}

const MAX_ATTEMPTS = 3;

export async function enqueueAnalysis(studyId: string): Promise<AnalysisJob> {
  const job: AnalysisJob = {
    job_id: newId("job"),
    study_id: studyId,
    status: "queued",
    attempts: 0,
    created_at: new Date().toISOString(),
  };
  await dbPut("jobs", job.job_id, job);
  await audit({ actor: "system", action: "job.enqueue", studyId, outcome: "ok", detail: job.job_id });
  // Fire-and-forget worker execution; UI polls job status.
  void processJob(job.job_id);
  return job;
}

export async function getJob(jobId: string): Promise<AnalysisJob | null> {
  return dbGet<AnalysisJob>("jobs", jobId);
}

export async function retryJob(jobId: string, requestedBy: string): Promise<AnalysisJob | null> {
  const job = await dbGet<AnalysisJob>("jobs", jobId);
  if (!job) return null;
  if (job.status !== "failed") throw new Error("Only failed jobs can be retried.");
  if (job.attempts >= MAX_ATTEMPTS) throw new Error(`Job exceeded maximum attempts (${MAX_ATTEMPTS}).`);
  job.status = "queued";
  job.error = undefined;
  await dbPut("jobs", jobId, job);
  await audit({ actor: requestedBy, action: "job.retry", studyId: job.study_id, outcome: "ok", detail: `${jobId} attempt ${job.attempts + 1}` });
  void processJob(jobId);
  return job;
}

/** In-process worker. Replace with an external worker process for production scale. */
async function processJob(jobId: string): Promise<void> {
  const job = await dbGet<AnalysisJob>("jobs", jobId);
  if (!job || job.status !== "queued") return;
  job.status = "running";
  job.started_at = new Date().toISOString();
  job.attempts += 1;
  await dbPut("jobs", jobId, job);

  try {
    // Lazy import avoids a circular dependency (service -> queue is fine;
    // keeping the import here keeps the queue generic).
    const { analyzeStudy } = await import("../studies/service");
    await analyzeStudy(job.study_id);
    job.status = "completed";
    job.completed_at = new Date().toISOString();
    await dbPut("jobs", jobId, job);
    await audit({ actor: "system", action: "job.complete", studyId: job.study_id, outcome: "ok", detail: jobId });
  } catch (err) {
    job.status = "failed";
    job.error = String(err instanceof Error ? err.message : err).slice(0, 400);
    job.completed_at = new Date().toISOString();
    await dbPut("jobs", jobId, job);
    await audit({ actor: "system", action: "job.fail", studyId: job.study_id, outcome: "error", detail: `${jobId}: ${job.error.slice(0, 150)}` });
    // FAILURE HANDLING contract: no result is generated; the UI shows
    // ANALYSIS FAILED with Retry / Request New Scan.
  }
}
