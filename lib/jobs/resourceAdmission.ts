import type { JobKind } from "./queue";
import {
  getHostModelJobResourceGovernor,
  acquireResourceLease,
  heartbeatResourceLease,
  releaseResourceLease,
  type ModelJobReservation,
  type ResourceLeaseConfig,
  type ResourceLeaseHandle,
  type ResourceLeaseRejectionReason,
  type ResourceLeaseSnapshot,
  type ResourceGovernorSnapshot,
  type ReservationRejectionReason,
} from "../runtime";

/** Conservative reservations for the observed local research workers. */
export const JOB_RESOURCE_REQUESTS: Readonly<Record<JobKind, { memoryBytes: number; threads: number }>> = Object.freeze({
  analysis: Object.freeze({ memoryBytes: 2 * 1024 ** 3, threads: 4 }),
  extraction: Object.freeze({ memoryBytes: 512 * 1024 ** 2, threads: 2 }),
});

export interface JobResourceAdmission {
  admitted: boolean;
  bypassedDemoMode: boolean;
  reservation: ModelJobReservation | null;
  reason: ReservationRejectionReason | "unconfigured_research" | null;
  snapshot: ResourceGovernorSnapshot;
}

export type HostWideJobResourceAdmission = Omit<JobResourceAdmission, "reason"> & {
  /** Durable cross-process lease, when the research job was admitted. */
  resourceLease: ResourceLeaseHandle | null;
  hostSnapshot: ResourceLeaseSnapshot | null;
  reason: JobResourceAdmission["reason"] | ResourceLeaseRejectionReason;
};

/**
 * Reserve a bounded host budget before a job enters its execution stage.
 * Missing configuration is tolerated only for the deterministic DEMO path;
 * a real research worker fails closed instead of running without a governor.
 */
export function reserveJobResources(kind: JobKind, options: {
  demoMode?: boolean;
  governor?: ReturnType<typeof getHostModelJobResourceGovernor>;
} = {}): JobResourceAdmission {
  const governor = options.governor ?? getHostModelJobResourceGovernor();
  const before = governor.snapshot();
  if (!before.configured) {
    const bypassedDemoMode = options.demoMode === true;
    return {
      admitted: bypassedDemoMode,
      bypassedDemoMode,
      reservation: null,
      reason: bypassedDemoMode ? null : "unconfigured_research",
      snapshot: before,
    };
  }
  const decision = governor.reserve(JOB_RESOURCE_REQUESTS[kind]);
  return {
    admitted: decision.admitted,
    bypassedDemoMode: false,
    reservation: decision.admitted ? decision.reservation : null,
    reason: decision.admitted ? null : decision.reason,
    snapshot: decision.snapshot,
  };
}

/**
 * Reserve both the existing process-local budget and the durable host-wide
 * lease. The local reservation is released if the SQLite lease loses a race,
 * so a failed host admission cannot strand capacity in this process.
 */
export async function reserveJobResourcesHostWide(kind: JobKind, options: {
  jobId: string;
  workerId: string;
  modelId?: string;
  demoMode?: boolean;
  governor?: ReturnType<typeof getHostModelJobResourceGovernor>;
  leaseConfig?: ResourceLeaseConfig;
  databaseFile?: string;
}): Promise<HostWideJobResourceAdmission> {
  const local = reserveJobResources(kind, options);
  const base = {
    ...local,
    resourceLease: null,
    hostSnapshot: null,
  } satisfies HostWideJobResourceAdmission;
  if (!local.admitted || local.bypassedDemoMode || !local.reservation) return base;

  const host = await acquireResourceLease({
    request: {
      workerId: options.workerId,
      jobId: options.jobId,
      modelId: options.modelId ?? `job:${kind}`,
      memoryBytes: JOB_RESOURCE_REQUESTS[kind].memoryBytes,
      threads: JOB_RESOURCE_REQUESTS[kind].threads,
    },
    config: options.leaseConfig,
    databaseFile: options.databaseFile,
  });
  if (!host.admitted) {
    options.governor?.release(local.reservation) ?? getHostModelJobResourceGovernor().release(local.reservation);
    return {
      ...base,
      admitted: false,
      reservation: null,
      reason: host.reason ?? "unconfigured_research",
      hostSnapshot: host.snapshot,
    };
  }
  return {
    ...local,
    resourceLease: host.reservation,
    hostSnapshot: host.snapshot,
  };
}

/** Start a bounded heartbeat for a cross-process lease. */
export function startResourceLeaseHeartbeat(
  reservation: ResourceLeaseHandle,
  options: { intervalMs?: number; leaseConfig?: ResourceLeaseConfig; databaseFile?: string } = {},
): () => void {
  const interval = Math.max(250, Math.min(60_000, Math.floor(options.intervalMs ?? Math.min((options.leaseConfig?.leaseMs ?? 60_000) / 3, 30_000))));
  const timer = setInterval(() => {
    void heartbeatResourceLease({ reservation, config: options.leaseConfig, databaseFile: options.databaseFile }).catch(() => undefined);
  }, interval);
  return () => clearInterval(timer);
}

export async function releaseJobResourceLease(
  reservation: ResourceLeaseHandle,
  options: { leaseConfig?: ResourceLeaseConfig; databaseFile?: string } = {},
): Promise<boolean> {
  const result = await releaseResourceLease({ reservation, config: options.leaseConfig, databaseFile: options.databaseFile });
  return result.changed;
}
