import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_OVERALL_JOB_DEADLINE_MS,
  JobDeadlineExceededError,
  createJobDeadline,
  resolveOverallJobDeadlineMs,
  withOverallJobDeadline,
} from "../lib/jobs/jobDeadline";
import { terminateProcessTree } from "../lib/jobs/processTree";

describe("worker phase 5 deadline contract", () => {
  it("normalizes an explicit deadline and exposes an auditable ISO boundary", () => {
    const deadline = createJobDeadline({
      startedAt: "2026-09-13T00:00:00.000Z",
      timeoutMs: 12_345.9,
      clock: { now: () => Date.parse("2026-09-13T00:00:00.000Z") },
    });

    expect(deadline.startedAt).toBe("2026-09-13T00:00:00.000Z");
    expect(deadline.deadlineAt).toBe("2026-09-13T00:00:12.345Z");
    expect(deadline.timeoutMs).toBe(12_345);
    expect(deadline.remainingMs(Date.parse("2026-09-13T00:00:05.000Z"))).toBe(7_345);
    expect(deadline.signal.aborted).toBe(false);
    deadline.dispose();
  });

  it("bounds invalid configuration instead of allowing an unbounded job", () => {
    expect(resolveOverallJobDeadlineMs(undefined)).toBe(DEFAULT_OVERALL_JOB_DEADLINE_MS);
    expect(resolveOverallJobDeadlineMs("not-a-duration")).toBe(DEFAULT_OVERALL_JOB_DEADLINE_MS);
    expect(resolveOverallJobDeadlineMs(0)).toBe(DEFAULT_OVERALL_JOB_DEADLINE_MS);
    expect(resolveOverallJobDeadlineMs(Number.POSITIVE_INFINITY)).toBe(DEFAULT_OVERALL_JOB_DEADLINE_MS);
    expect(resolveOverallJobDeadlineMs(48 * 60 * 60 * 1000)).toBe(24 * 60 * 60 * 1000);
  });

  it("rejects at the overall boundary, aborts cooperative work, and calls expiry cleanup once", async () => {
    vi.useFakeTimers();
    const onExpired = vi.fn();
    try {
      const pending = withOverallJobDeadline(
        (deadline) => new Promise<never>((_, reject) => {
          deadline.signal.addEventListener("abort", () => reject(deadline.signal.reason), { once: true });
        }),
        { timeoutMs: 50, onExpired },
      );
      const assertion = expect(pending).rejects.toBeInstanceOf(JobDeadlineExceededError);
      await vi.advanceTimersByTimeAsync(50);
      await assertion;
      expect(onExpired).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not turn a cooperative cancellation into a deadline error before expiry", async () => {
    const result = await withOverallJobDeadline(async (deadline) => {
      deadline.throwIfExpired();
      return "completed-before-deadline";
    }, { timeoutMs: 1_000 });
    expect(result).toBe("completed-before-deadline");
  });
});

describe("worker phase 5 process-tree termination contract", () => {
  it("is a strict no-op on non-Windows, including when a runner is supplied", async () => {
    const runner = vi.fn(async () => ({ code: 0, signal: null }));
    const result = await terminateProcessTree(1234, { platform: "linux", runTaskkill: runner });

    expect(result).toMatchObject({
      pid: 1234,
      requested: true,
      attempted: false,
      method: "none",
      outcome: "unsupported-platform",
    });
    expect(runner).not.toHaveBeenCalled();
  });

  it("keeps non-Windows dry-run side-effect free and does not emit a Windows command", async () => {
    const runner = vi.fn(async () => ({ code: 0, signal: null }));
    const result = await terminateProcessTree(1234, { platform: "darwin", dryRun: true, runTaskkill: runner });

    expect(result).toMatchObject({
      pid: 1234,
      attempted: false,
      method: "none",
      command: null,
      outcome: "dry-run",
    });
    expect(runner).not.toHaveBeenCalled();
  });

  it("plans the recursive Windows command without side effects in dry-run mode", async () => {
    const runner = vi.fn(async () => ({ code: 0, signal: null }));
    const result = await terminateProcessTree(4321, { platform: "win32", dryRun: true, runTaskkill: runner });

    expect(result).toMatchObject({
      pid: 4321,
      attempted: false,
      method: "taskkill",
      command: ["/PID", "4321", "/T", "/F"],
      outcome: "dry-run",
    });
    expect(runner).not.toHaveBeenCalled();
  });

  it("reports the injected Windows command result without overstating orphan prevention", async () => {
    const runner = vi.fn(async (args: readonly string[]) => {
      expect(args).toEqual(["/PID", "77", "/T", "/F"]);
      return { code: 0, signal: null };
    });
    const result = await terminateProcessTree(77, { platform: "win32", runTaskkill: runner });

    expect(result.outcome).toBe("terminated");
    expect(result.attempted).toBe(true);
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("fails closed for missing or unsuccessful termination targets", async () => {
    const missing = await terminateProcessTree(undefined, { platform: "win32" });
    expect(missing).toMatchObject({ attempted: false, method: "none", outcome: "invalid-pid" });

    const failed = await terminateProcessTree(88, {
      platform: "win32",
      runTaskkill: async () => ({ code: 128, signal: null, stderr: "not found" }),
    });
    expect(failed).toMatchObject({ attempted: true, outcome: "failed", error: "not found" });
  });
});
