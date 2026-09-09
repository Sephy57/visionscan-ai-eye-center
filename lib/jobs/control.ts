export type JobStage =
  | "queued"
  | "preparing"
  | "validating_source"
  | "extracting_pages"
  | "routing_assets"
  | "running_inference"
  | "persisting_analysis"
  | "generating_report"
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
  shouldCancel?: () => boolean;
  onProgress?: (update: ProgressUpdate) => void | Promise<void>;
}

export class JobCancelledError extends Error {
  constructor() {
    super("Job cancelled");
    this.name = "JobCancelledError";
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
  if (control?.shouldCancel?.()) throw new JobCancelledError();
  await control?.onProgress?.(update);
  if (control?.shouldCancel?.()) throw new JobCancelledError();
}
