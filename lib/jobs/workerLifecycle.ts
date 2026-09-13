export type WorkerShutdownPolicy = "DRAIN_CURRENT" | "CANCEL_CURRENT" | "LEASE_FOR_RECOVERY";
export type WorkerLifecycleState = "RUNNING" | "STOP_REQUESTED" | "STOPPED";

export interface WorkerShutdownEvent {
  source: "SIGINT" | "SIGTERM" | "operator";
  policy: WorkerShutdownPolicy;
  state: WorkerLifecycleState;
  current_job_id: string | null;
  at: string;
}

/** Small, deterministic worker state machine. It does not own processes or
 * durable jobs; it makes the shutdown decision explicit and testable. */
export class WorkerLifecycle {
  readonly policy: WorkerShutdownPolicy;
  private currentJob: string | null = null;
  private currentState: WorkerLifecycleState = "RUNNING";
  private lastEvent: WorkerShutdownEvent | null = null;

  constructor(policy: WorkerShutdownPolicy = "LEASE_FOR_RECOVERY") {
    this.policy = policy;
  }

  get state(): WorkerLifecycleState { return this.currentState; }
  get current_job_id(): string | null { return this.currentJob; }
  get event(): WorkerShutdownEvent | null { return this.lastEvent; }
  canStartPass(): boolean { return this.currentState === "RUNNING"; }
  canClaim(): boolean { return this.currentState === "RUNNING"; }

  startJob(jobId: string): void {
    if (!this.canClaim()) throw new Error("WORKER_SHUTDOWN_IN_PROGRESS");
    if (this.currentJob) throw new Error("WORKER_ALREADY_HAS_CURRENT_JOB");
    this.currentJob = jobId;
  }

  /** Adopt a job after the queue's transactional claim has succeeded. */
  adoptClaimedJob(jobId: string): void {
    if (this.currentJob && this.currentJob !== jobId) throw new Error("WORKER_ALREADY_HAS_CURRENT_JOB");
    this.currentJob = jobId;
  }

  finishJob(jobId: string): void {
    if (this.currentJob === jobId) this.currentJob = null;
    if (this.currentState === "STOP_REQUESTED" && !this.currentJob) this.currentState = "STOPPED";
  }

  requestShutdown(source: WorkerShutdownEvent["source"] = "operator"): WorkerShutdownEvent {
    if (this.currentState === "STOPPED" && this.lastEvent) return this.lastEvent;
    this.currentState = this.currentJob ? "STOP_REQUESTED" : "STOPPED";
    this.lastEvent = {
      source,
      policy: this.policy,
      state: this.currentState,
      current_job_id: this.currentJob,
      at: new Date().toISOString(),
    };
    return this.lastEvent;
  }

  snapshot(): { state: WorkerLifecycleState; policy: WorkerShutdownPolicy; current_job_id: string | null; can_claim: boolean } {
    return { state: this.currentState, policy: this.policy, current_job_id: this.currentJob, can_claim: this.canClaim() };
  }
}

export function resolveWorkerShutdownPolicy(value = process.env.VISIONSCAN_WORKER_SHUTDOWN_POLICY): WorkerShutdownPolicy {
  const normalized = String(value ?? "LEASE_FOR_RECOVERY").trim().toUpperCase();
  return normalized === "DRAIN_CURRENT" || normalized === "CANCEL_CURRENT" || normalized === "LEASE_FOR_RECOVERY"
    ? normalized
    : "LEASE_FOR_RECOVERY";
}
