import { describe, expect, it } from "vitest";
import {
  createModelJobResourceGovernor,
  createModelJobResourceGovernorFromEnv,
  getHostModelJobResourceGovernor,
  resetHostModelJobResourceGovernorForTests,
} from "@/lib/runtime";

describe("model-job resource governor", () => {
  it("admits bounded reservations atomically and releases only matching tokens", () => {
    const governor = createModelJobResourceGovernor({ memoryBytes: 100, threads: 4 });
    const first = governor.reserve({ memoryBytes: 60, threads: 2 });
    expect(first.admitted).toBe(true);
    if (!first.admitted) return;

    expect(first.reservation.reservationId).toBe("reservation-1");
    expect(first.snapshot).toMatchObject({
      configured: true,
      reserved: { memoryBytes: 60, threads: 2 },
      available: { memoryBytes: 40, threads: 2 },
      activeReservations: 1,
    });

    const overMemory = governor.reserve({ memoryBytes: 41, threads: 1 });
    expect(overMemory).toMatchObject({ admitted: false, reason: "memory_budget_exceeded" });
    expect(governor.snapshot().reserved).toEqual({ memoryBytes: 60, threads: 2 });

    expect(governor.release({ ...first.reservation, memoryBytes: 59 })).toMatchObject({ released: false });
    expect(governor.release(first.reservation)).toMatchObject({ released: true });
    expect(governor.release(first.reservation)).toMatchObject({ released: false });
    expect(governor.snapshot().reserved).toEqual({ memoryBytes: 0, threads: 0 });
  });

  it("rejects thread overcommit with a deterministic reason and leaves state unchanged", () => {
    const governor = createModelJobResourceGovernor({ memoryBytes: 1_000, threads: 2 });
    const result = governor.reserve({ memoryBytes: 1, threads: 3 });
    expect(result).toMatchObject({ admitted: false, reason: "thread_budget_exceeded" });
    expect(governor.snapshot()).toMatchObject({
      reserved: { memoryBytes: 0, threads: 0 },
      activeReservations: 0,
    });
  });

  it("rejects malformed requests and invalid configuration instead of failing open", () => {
    const governor = createModelJobResourceGovernor({ memoryBytes: 100, threads: 2 });
    for (const request of [
      { memoryBytes: 0, threads: 1 },
      { memoryBytes: 1.5, threads: 1 },
      { memoryBytes: Number.POSITIVE_INFINITY, threads: 1 },
      { memoryBytes: 1, threads: 0 },
    ]) {
      expect(governor.reserve(request)).toMatchObject({ admitted: false, reason: "invalid_request" });
    }

    const invalid = createModelJobResourceGovernor({ memoryBytes: 0, threads: 0 });
    expect(invalid.snapshot()).toMatchObject({ configured: false, budget: null });
    expect(invalid.reserve({ memoryBytes: 1, threads: 1 })).toMatchObject({
      admitted: false,
      reason: "invalid_configuration",
    });
  });

  it("bounds retained state with a reservation limit", () => {
    const governor = createModelJobResourceGovernor({ memoryBytes: 10, threads: 10, maxActiveReservations: 2 });
    expect(governor.reserve({ memoryBytes: 1, threads: 1 }).admitted).toBe(true);
    expect(governor.reserve({ memoryBytes: 1, threads: 1 }).admitted).toBe(true);
    expect(governor.reserve({ memoryBytes: 1, threads: 1 })).toMatchObject({
      admitted: false,
      reason: "reservation_limit_reached",
    });
    expect(governor.snapshot().activeReservations).toBe(2);
  });

  it("is PHI-free at the contract boundary and does not expose reservation identifiers in snapshots", () => {
    const governor = createModelJobResourceGovernor({ memoryBytes: 100, threads: 2 });
    const result = governor.reserve({ memoryBytes: 10, threads: 1 });
    expect(result.admitted).toBe(true);
    expect(result.admitted && result.reservation.reservationId).toBe("reservation-1");
    const serializedSnapshot = JSON.stringify(governor.snapshot());
    expect(serializedSnapshot).not.toMatch(/patient|study|document|mrn|alice/i);
    expect(serializedSnapshot).not.toContain("reservation-1");
    expect(governor.snapshot()).not.toHaveProperty("reservations");
  });

  it("reads only canonical budget variables and denies missing or malformed environment configuration", () => {
    expect(createModelJobResourceGovernorFromEnv({}).reserve({ memoryBytes: 1, threads: 1 })).toMatchObject({
      admitted: false,
      reason: "invalid_configuration",
    });
    const configured = createModelJobResourceGovernorFromEnv({
      VISIONSCAN_MODEL_MEMORY_BUDGET_BYTES: "100",
      VISIONSCAN_MODEL_THREAD_BUDGET: "2",
    });
    expect(configured.reserve({ memoryBytes: 100, threads: 2 }).admitted).toBe(true);
    expect(createModelJobResourceGovernorFromEnv({
      VISIONSCAN_MODEL_MEMORY_BUDGET_BYTES: "not-a-number",
      VISIONSCAN_MODEL_THREAD_BUDGET: "2",
    }).reserve({ memoryBytes: 1, threads: 1 })).toMatchObject({
      admitted: false,
      reason: "invalid_configuration",
    });
  });

  it("provides a lazy process-wide governor without measuring or claiming actual RAM safety", () => {
    const previousMemory = process.env.VISIONSCAN_MODEL_MEMORY_BUDGET_BYTES;
    const previousThreads = process.env.VISIONSCAN_MODEL_THREAD_BUDGET;
    try {
      delete process.env.VISIONSCAN_MODEL_MEMORY_BUDGET_BYTES;
      delete process.env.VISIONSCAN_MODEL_THREAD_BUDGET;
      resetHostModelJobResourceGovernorForTests();
      const first = getHostModelJobResourceGovernor();
      const second = getHostModelJobResourceGovernor();
      expect(first).toBe(second);
      expect(first.snapshot().configured).toBe(false);
    } finally {
      if (previousMemory === undefined) delete process.env.VISIONSCAN_MODEL_MEMORY_BUDGET_BYTES;
      else process.env.VISIONSCAN_MODEL_MEMORY_BUDGET_BYTES = previousMemory;
      if (previousThreads === undefined) delete process.env.VISIONSCAN_MODEL_THREAD_BUDGET;
      else process.env.VISIONSCAN_MODEL_THREAD_BUDGET = previousThreads;
      resetHostModelJobResourceGovernorForTests();
    }
  });
});
