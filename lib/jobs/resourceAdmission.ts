import type { JobKind } from "./queue";
import {
  getHostModelJobResourceGovernor,
  type ModelJobReservation,
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

