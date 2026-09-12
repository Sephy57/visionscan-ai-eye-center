/**
 * Explicit wall-clock budget for one complete worker job.
 *
 * This module is intentionally independent from queue state transitions. A
 * queue owner can create one deadline immediately after claiming an attempt
 * and pass its signal/checkpoint methods through every stage, including
 * persistence and report finalization. Expiry is a local control signal; the
 * queue owner still decides how to fence and durably record the outcome.
 */

export const DEFAULT_OVERALL_JOB_DEADLINE_MS = 15 * 60 * 1000;
export const MAX_OVERALL_JOB_DEADLINE_MS = 24 * 60 * 60 * 1000;
export const JOB_DEADLINE_ENV = "VISIONSCAN_OVERALL_JOB_DEADLINE_MS";

export type JobDeadlineClock = { now: () => number };

export class JobDeadlineExceededError extends Error {
  readonly code = "JOB_DEADLINE_EXCEEDED" as const;
  readonly deadlineAt: string;
  readonly timeoutMs: number;

  constructor(deadlineAt: string, timeoutMs: number) {
    super(`Overall job deadline exceeded at ${deadlineAt}.`);
    this.name = "JobDeadlineExceededError";
    this.deadlineAt = deadlineAt;
    this.timeoutMs = timeoutMs;
  }
}

export interface JobDeadlineOptions {
  /** Explicit overall budget. Values are bounded to one day. */
  timeoutMs?: number;
  /** Claim/start time. Defaults to the clock's current time. */
  startedAt?: Date | string | number;
  /** Injectable for deterministic tests; production uses Date.now(). */
  clock?: JobDeadlineClock;
  /** Called once when the budget expires. Cleanup errors are swallowed. */
  onExpired?: (error: JobDeadlineExceededError) => void | Promise<void>;
}

export interface JobDeadline {
  readonly startedAt: string;
  readonly deadlineAt: string;
  readonly startedAtMs: number;
  readonly deadlineAtMs: number;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
  readonly expired: boolean;
  remainingMs(nowMs?: number): number;
  throwIfExpired(nowMs?: number): void;
  dispose(): void;
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function timestamp(value: Date | string | number | undefined, fallback: number): number {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : fallback;
  const numeric = finiteNumber(value);
  if (numeric !== null && typeof value !== "string") return numeric;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

/** Resolve the configured deadline without allowing an invalid value to make
 * a worker effectively unbounded. */
export function resolveOverallJobDeadlineMs(value: unknown = process.env[JOB_DEADLINE_ENV]): number {
  const parsed = finiteNumber(value);
  if (parsed === null || parsed < 1) return DEFAULT_OVERALL_JOB_DEADLINE_MS;
  return Math.min(Math.floor(parsed), MAX_OVERALL_JOB_DEADLINE_MS);
}

export function createJobDeadline(options: JobDeadlineOptions = {}): JobDeadline {
  const clock = options.clock ?? { now: () => Date.now() };
  const startedAtMs = timestamp(options.startedAt, clock.now());
  const timeoutMs = resolveOverallJobDeadlineMs(options.timeoutMs);
  const deadlineAtMs = startedAtMs + timeoutMs;
  const startedAt = new Date(startedAtMs).toISOString();
  const deadlineAt = new Date(deadlineAtMs).toISOString();
  const controller = new AbortController();
  const deadlineError = () => new JobDeadlineExceededError(deadlineAt, timeoutMs);
  let expired = false;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const expire = () => {
    if (expired || disposed) return;
    expired = true;
    const error = deadlineError();
    controller.abort(error);
    try {
      const cleanup = options.onExpired?.(error);
      if (cleanup && typeof (cleanup as Promise<void>).catch === "function") {
        void (cleanup as Promise<void>).catch(() => undefined);
      }
    } catch {
      // Expiry must remain observable as the deadline error even if cleanup
      // itself fails. Durable failure/fencing belongs to the queue owner.
    }
  };

  const delay = Math.max(0, deadlineAtMs - clock.now());
  timer = setTimeout(expire, delay);
  timer.unref?.();

  const result: JobDeadline = {
    startedAt,
    deadlineAt,
    startedAtMs,
    deadlineAtMs,
    timeoutMs,
    signal: controller.signal,
    get expired() {
      return expired;
    },
    remainingMs(nowMs = clock.now()) {
      return Math.max(0, deadlineAtMs - nowMs);
    },
    throwIfExpired(nowMs = clock.now()) {
      if (expired || nowMs >= deadlineAtMs) {
        expire();
        throw deadlineError();
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (timer) clearTimeout(timer);
    },
  };
  return result;
}

/** Run one complete operation under a single explicit wall-clock budget.
 * The underlying operation must honor `deadline.signal` or checkpoints; a
 * Promise race alone cannot stop non-cooperative JavaScript or child work. */
export async function withOverallJobDeadline<T>(
  work: (deadline: JobDeadline) => Promise<T> | T,
  options: JobDeadlineOptions = {},
): Promise<T> {
  const deadline = createJobDeadline(options);
  const operation = Promise.resolve().then(() => work(deadline));
  const expiry = new Promise<never>((_, reject) => {
    const onAbort = () => {
      const reason = deadline.signal.reason;
      reject(reason instanceof JobDeadlineExceededError ? reason : new JobDeadlineExceededError(deadline.deadlineAt, deadline.timeoutMs));
    };
    if (deadline.signal.aborted) onAbort();
    else deadline.signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([operation, expiry]);
  } finally {
    deadline.dispose();
  }
}

/** Short alias for integrations that call this a job rather than an overall
 * deadline. */
export const withJobDeadline = withOverallJobDeadline;
