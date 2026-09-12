/**
 * Deterministic, PHI-free resource accounting for model jobs.
 *
 * This is a reservation contract, not an operating-system resource limit. It
 * accounts for callers that use the same governor instance within one Node.js
 * process. It does not measure RAM, set thread affinity, or prevent an
 * independently running process from consuming resources.
 */

export interface ModelJobResourceRequest {
  /** Maximum memory the caller promises this job may reserve, in bytes. */
  memoryBytes: number;
  /** Maximum number of host threads the caller promises this job may reserve. */
  threads: number;
}

export interface HostResourceBudget {
  memoryBytes: number;
  threads: number;
}

export interface ResourceGovernorConfig extends HostResourceBudget {
  /** Bounds retained reservation state even when callers fail to release. */
  maxActiveReservations?: number;
}

export interface ModelJobReservation extends ModelJobResourceRequest {
  /** Opaque, process-local handle. It contains no caller or job data. */
  readonly reservationId: string;
}

export interface ResourceGovernorSnapshot {
  readonly configured: boolean;
  readonly budget: HostResourceBudget | null;
  readonly reserved: ModelJobResourceRequest;
  readonly available: ModelJobResourceRequest;
  readonly activeReservations: number;
  readonly maxActiveReservations: number;
}

export type ReservationRejectionReason =
  | "invalid_configuration"
  | "invalid_request"
  | "reservation_limit_reached"
  | "memory_budget_exceeded"
  | "thread_budget_exceeded";

export type ReservationDecision =
  | {
      readonly admitted: true;
      readonly reservation: ModelJobReservation;
      readonly snapshot: ResourceGovernorSnapshot;
    }
  | {
      readonly admitted: false;
      readonly reason: ReservationRejectionReason;
      readonly snapshot: ResourceGovernorSnapshot;
    };

export interface ReservationReleaseResult {
  readonly released: boolean;
  readonly snapshot: ResourceGovernorSnapshot;
}

export interface ModelJobResourceGovernor {
  reserve(request: ModelJobResourceRequest): ReservationDecision;
  release(reservation: ModelJobReservation): ReservationReleaseResult;
  snapshot(): ResourceGovernorSnapshot;
}

const DEFAULT_MAX_ACTIVE_RESERVATIONS = 1024;
const MAX_RESERVATION_ID = 32;
const MEMORY_BUDGET_ENV = "VISIONSCAN_MODEL_MEMORY_BUDGET_BYTES";
const THREAD_BUDGET_ENV = "VISIONSCAN_MODEL_THREAD_BUDGET";

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function validReservationId(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= MAX_RESERVATION_ID
    && /^[a-z0-9-]+$/i.test(value);
}

function readPositiveIntegerEnv(environment: Readonly<Record<string, string | undefined>>, name: string): number | undefined {
  const raw = environment[name]?.trim();
  if (!raw || !/^[1-9]\d*$/.test(raw)) return undefined;
  const value = Number(raw);
  return isPositiveSafeInteger(value) ? value : undefined;
}

function normalizedConfig(config: ResourceGovernorConfig): {
  budget: HostResourceBudget | null;
  maxActiveReservations: number;
} {
  if (!config || typeof config !== "object") {
    return { budget: null, maxActiveReservations: DEFAULT_MAX_ACTIVE_RESERVATIONS };
  }
  const maxActiveReservations = config.maxActiveReservations ?? DEFAULT_MAX_ACTIVE_RESERVATIONS;
  if (!isPositiveSafeInteger(config.memoryBytes)
    || !isPositiveSafeInteger(config.threads)
    || !isPositiveSafeInteger(maxActiveReservations)) {
    return { budget: null, maxActiveReservations: DEFAULT_MAX_ACTIVE_RESERVATIONS };
  }
  return {
    budget: Object.freeze({ memoryBytes: config.memoryBytes, threads: config.threads }),
    maxActiveReservations,
  };
}

class InMemoryModelJobResourceGovernor implements ModelJobResourceGovernor {
  private readonly budget: HostResourceBudget | null;
  private readonly maxActiveReservations: number;
  private readonly reservations = new Map<string, ModelJobReservation>();
  private reservedMemoryBytes = 0;
  private reservedThreads = 0;
  private nextReservationNumber = 1;

  constructor(config: ResourceGovernorConfig) {
    const normalized = normalizedConfig(config);
    this.budget = normalized.budget;
    this.maxActiveReservations = normalized.maxActiveReservations;
  }

  reserve(request: ModelJobResourceRequest): ReservationDecision {
    if (!this.budget) return { admitted: false, reason: "invalid_configuration", snapshot: this.snapshot() };
    if (!request || !isPositiveSafeInteger(request.memoryBytes) || !isPositiveSafeInteger(request.threads)) {
      return { admitted: false, reason: "invalid_request", snapshot: this.snapshot() };
    }
    if (this.reservations.size >= this.maxActiveReservations) {
      return { admitted: false, reason: "reservation_limit_reached", snapshot: this.snapshot() };
    }
    // Subtraction avoids an unsafe addition before the budget comparison.
    if (request.memoryBytes > this.budget.memoryBytes - this.reservedMemoryBytes) {
      return { admitted: false, reason: "memory_budget_exceeded", snapshot: this.snapshot() };
    }
    if (request.threads > this.budget.threads - this.reservedThreads) {
      return { admitted: false, reason: "thread_budget_exceeded", snapshot: this.snapshot() };
    }

    const reservationId = `reservation-${this.nextReservationNumber}`;
    this.nextReservationNumber += 1;
    const reservation = Object.freeze({
      reservationId,
      memoryBytes: request.memoryBytes,
      threads: request.threads,
    });
    this.reservations.set(reservationId, reservation);
    this.reservedMemoryBytes += request.memoryBytes;
    this.reservedThreads += request.threads;
    return { admitted: true, reservation, snapshot: this.snapshot() };
  }

  release(reservation: ModelJobReservation): ReservationReleaseResult {
    if (!reservation || !validReservationId(reservation.reservationId)) {
      return { released: false, snapshot: this.snapshot() };
    }
    const stored = this.reservations.get(reservation.reservationId);
    if (!stored
      || stored.memoryBytes !== reservation.memoryBytes
      || stored.threads !== reservation.threads) {
      return { released: false, snapshot: this.snapshot() };
    }
    this.reservations.delete(reservation.reservationId);
    this.reservedMemoryBytes -= stored.memoryBytes;
    this.reservedThreads -= stored.threads;
    return { released: true, snapshot: this.snapshot() };
  }

  snapshot(): ResourceGovernorSnapshot {
    const budget = this.budget ? Object.freeze({ ...this.budget }) : null;
    const reserved = Object.freeze({ memoryBytes: this.reservedMemoryBytes, threads: this.reservedThreads });
    const available = Object.freeze({
      memoryBytes: budget ? budget.memoryBytes - this.reservedMemoryBytes : 0,
      threads: budget ? budget.threads - this.reservedThreads : 0,
    });
    return Object.freeze({
      configured: this.budget !== null,
      budget,
      reserved,
      available,
      activeReservations: this.reservations.size,
      maxActiveReservations: this.maxActiveReservations,
    });
  }
}

/** Create an isolated governor. Use one instance for all model jobs in a process. */
export function createModelJobResourceGovernor(config: ResourceGovernorConfig): ModelJobResourceGovernor {
  return new InMemoryModelJobResourceGovernor(config);
}

/**
 * Create a governor from explicit environment values. Missing, malformed, or
 * unsafe values intentionally create a deny-all governor.
 */
export function createModelJobResourceGovernorFromEnv(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): ModelJobResourceGovernor {
  const memoryBytes = readPositiveIntegerEnv(environment, MEMORY_BUDGET_ENV);
  const threads = readPositiveIntegerEnv(environment, THREAD_BUDGET_ENV);
  return createModelJobResourceGovernor({ memoryBytes: memoryBytes ?? 0, threads: threads ?? 0 });
}

let hostGovernor: ModelJobResourceGovernor | undefined;

/** Lazily-created process-wide governor for integrators that want one host contract. */
export function getHostModelJobResourceGovernor(): ModelJobResourceGovernor {
  return hostGovernor ??= createModelJobResourceGovernorFromEnv();
}

/** Test-only reset for the lazy process-wide governor; production code should not call it. */
export function resetHostModelJobResourceGovernorForTests(): void {
  hostGovernor = undefined;
}

export const RESOURCE_GOVERNOR_ENVIRONMENT = Object.freeze({
  memoryBudgetBytes: MEMORY_BUDGET_ENV,
  threadBudget: THREAD_BUDGET_ENV,
});
