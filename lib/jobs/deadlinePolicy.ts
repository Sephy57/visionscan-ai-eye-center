import { resolveOverallJobDeadlineMs } from "./jobDeadline";

export const MAX_QUEUE_WAIT_ENV = "VISIONSCAN_MAX_QUEUE_WAIT_MS";
export const MAX_SERVICE_TIME_ENV = "VISIONSCAN_MAX_SERVICE_TIME_MS";
export const MAX_TOTAL_AGE_ENV = "VISIONSCAN_MAX_TOTAL_AGE_MS";
export const DEFAULT_MAX_QUEUE_WAIT_MS = 120_000;
export const DEFAULT_MAX_SERVICE_TIME_MS = 15 * 60 * 1000;
export const DEFAULT_MAX_TOTAL_AGE_MS = DEFAULT_MAX_QUEUE_WAIT_MS + DEFAULT_MAX_SERVICE_TIME_MS;
export const MAX_POLICY_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface JobDeadlinePolicy {
  max_queue_wait_ms: number;
  max_service_time_ms: number;
  max_total_age_ms: number;
  source: "environment" | "bounded_defaults";
}

function bounded(value: unknown, fallback: number): { value: number; configured: boolean } {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return { value: fallback, configured: false };
  return { value: Math.min(Math.floor(parsed), MAX_POLICY_WINDOW_MS), configured: true };
}

export function resolveJobDeadlinePolicy(env: NodeJS.ProcessEnv = process.env): JobDeadlinePolicy {
  const queue = bounded(env[MAX_QUEUE_WAIT_ENV], DEFAULT_MAX_QUEUE_WAIT_MS);
  const service = bounded(env[MAX_SERVICE_TIME_ENV], resolveOverallJobDeadlineMs(env.VISIONSCAN_OVERALL_JOB_DEADLINE_MS));
  const total = bounded(env[MAX_TOTAL_AGE_ENV], queue.value + service.value);
  return {
    max_queue_wait_ms: queue.value,
    max_service_time_ms: service.value,
    max_total_age_ms: Math.max(total.value, queue.value),
    source: queue.configured || service.configured || total.configured ? "environment" : "bounded_defaults",
  };
}

export type DeadlineOutcome = "WITHIN_BUDGET" | "QUEUE_TIMEOUT" | "JOB_DEADLINE_EXCEEDED";

export function classifyJobAge(input: {
  created_at: string;
  claimed_at?: string;
  now?: number;
  policy?: JobDeadlinePolicy;
}): { outcome: DeadlineOutcome; queue_wait_ms: number; service_time_ms: number; total_age_ms: number } {
  const policy = input.policy ?? resolveJobDeadlinePolicy();
  const now = input.now ?? Date.now();
  const created = Date.parse(input.created_at);
  const claimed = input.claimed_at ? Date.parse(input.claimed_at) : now;
  const queueWait = Number.isFinite(created) ? Math.max(0, (Number.isFinite(claimed) ? claimed : now) - created) : 0;
  const service = input.claimed_at && Number.isFinite(claimed) ? Math.max(0, now - claimed) : 0;
  const total = Number.isFinite(created) ? Math.max(0, now - created) : 0;
  const outcome: DeadlineOutcome = total > policy.max_total_age_ms || service > policy.max_service_time_ms
    ? "JOB_DEADLINE_EXCEEDED"
    : queueWait > policy.max_queue_wait_ms
      ? "QUEUE_TIMEOUT"
      : "WITHIN_BUDGET";
  return { outcome, queue_wait_ms: queueWait, service_time_ms: service, total_age_ms: total };
}
