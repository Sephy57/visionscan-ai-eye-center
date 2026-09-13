export type JobStage =
  | "queued"
  | "preparing"
  | "validating_source"
  | "extracting_pages"
  | "routing_assets"
  | "running_inference"
  | "persisting_analysis"
  | "generating_report"
  | "stale"
  | "retryable"
  | "completed"
  | "cancellation_requested"
  | "cancelled"
  | "failed";

export interface JobProgress {
  stage: JobStage;
  percent: number;
  completed_units: number;
  total_units: number;
  message: string;
  updated_at: string;
}

export interface ProgressUpdate {
  stage: JobStage;
  percent: number;
  completed_units?: number;
  total_units?: number;
  message: string;
}

export interface JobExecutionControl {
  /** Durable worker context used only for Phase 9 effect provenance. */
  job_id?: string;
  attempt_id?: string;
  /** Absolute worker deadline propagated to every provider-facing stage. */
  signal?: AbortSignal;
  /** Durable attempt/worker fence checked immediately before every
   * publication effect. A stale worker must stop before writing a new row. */
  assertCanCommit?: () => boolean | Promise<boolean>;
  /**
   * Cancellation is allowed to consult durable state.  Existing synchronous
   * callbacks remain valid, while workers can now re-read the persisted job
   * row at every bounded checkpoint after a process restart.
   */
  shouldCancel?: () => boolean | Promise<boolean>;
  onProgress?: (update: ProgressUpdate) => void | Promise<void>;
}

export class JobCancelledError extends Error {
  constructor() {
    super("Job cancelled");
    this.name = "JobCancelledError";
  }
}

export class JobOwnershipLostError extends Error {
  constructor() {
    super("Worker attempt no longer owns the job");
    this.name = "JobOwnershipLostError";
  }
}

export function makeJobProgress(update: ProgressUpdate): JobProgress {
  const total = Number.isFinite(update.total_units) ? Math.max(0, Math.floor(update.total_units ?? 0)) : 0;
  const completed = Number.isFinite(update.completed_units)
    ? Math.min(total || Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(update.completed_units ?? 0)))
    : 0;
  return {
    stage: update.stage,
    percent: Math.min(100, Math.max(0, Math.round(update.percent))),
    completed_units: completed,
    total_units: total,
    message: update.message.slice(0, 160),
    updated_at: new Date().toISOString(),
  };
}

/** Report a bounded server-authored checkpoint, checking cancellation both
 * before and after the callback so a request cannot slip into the next stage. */
export async function jobCheckpoint(control: JobExecutionControl | undefined, update: ProgressUpdate): Promise<void> {
  if (await control?.shouldCancel?.()) throw new JobCancelledError();
  await control?.onProgress?.(update);
  if (await control?.shouldCancel?.()) throw new JobCancelledError();
}

/** Publication boundary for service code. This is separate from cancellation
 * so the queue can fence a late worker without turning a stale attempt into a
 * successful or replacement terminal result. */
export async function jobCommitCheckpoint(control: JobExecutionControl | undefined): Promise<void> {
  if (control?.assertCanCommit && !(await control.assertCanCommit())) throw new JobOwnershipLostError();
}
