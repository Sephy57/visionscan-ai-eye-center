/**
 * Phase 9 fault-injection controls.
 *
 * These hooks are deliberately inert outside an isolated test process.  The
 * value is read at call time so a test can select one crash window without
 * exposing a request or production configuration surface.
 */

export type Phase9FaultHook =
  | "BEFORE_MODEL_RESULT_WRITE"
  | "AFTER_MODEL_RESULT_WRITE"
  | "BEFORE_EVIDENCE_COMMIT"
  | "AFTER_EVIDENCE_COMMIT"
  | "BEFORE_REPORT_COMMIT"
  | "AFTER_REPORT_COMMIT"
  | "BEFORE_JOB_COMPLETE"
  | "AFTER_JOB_COMPLETION_TRANSACTION";

export class Phase9InjectedFaultError extends Error {
  readonly code = "PHASE9_INJECTED_FAULT" as const;
  readonly hook: Phase9FaultHook;

  constructor(hook: Phase9FaultHook) {
    super(`Phase 9 test fault injected at ${hook}.`);
    this.name = "Phase9InjectedFaultError";
    this.hook = hook;
  }
}

function testOnlyProcess(): boolean {
  return process.env.NODE_ENV === "test" && process.env.VISIONSCAN_TEST_ISOLATED === "1";
}

function configuredHooks(): Set<string> {
  return new Set(
    String(process.env.VISIONSCAN_PHASE9_FAULT_INJECTION ?? "")
      .split(",")
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean),
  );
}

const consumed = new Set<string>();

/** Throw once at a selected test seam. Production and non-isolated runs are
 * always no-ops, even when an environment value is accidentally present. */
export function maybeInjectPhase9Fault(hook: Phase9FaultHook): void {
  if (!testOnlyProcess()) return;
  if (!configuredHooks().has(hook) || consumed.has(hook)) return;
  consumed.add(hook);
  if (process.env.VISIONSCAN_PHASE10_REAL_OS_CRASH === "1" || process.env.VISIONSCAN_PHASE11_REAL_POST_TERMINAL_CRASH === "1") {
    // This switch is intentionally separate from the exception seam. It is
    // accepted only in an isolated test process and terminates the process at
    // the selected durable-publication boundary. The parent harness owns
    // descendant cleanup and restart verification.
    const event = process.env.VISIONSCAN_PHASE11_REAL_POST_TERMINAL_CRASH === "1"
      ? "phase11_post_terminal_crash"
      : "phase10_real_os_crash";
    process.stderr.write(`${JSON.stringify({ event, hook, pid: process.pid })}\n`);
    try {
      process.kill(process.pid, "SIGKILL");
    } catch {
      // SIGKILL is implemented as process termination on supported Windows
      // Node builds. Keep a hard-stop fallback for unusual runtimes.
      process.exit(137);
    }
    return;
  }
  throw new Phase9InjectedFaultError(hook);
}

/** Test-only reset for a matrix that exercises more than one window in one
 * process. It intentionally does nothing outside the isolated test guard. */
export function resetPhase9FaultInjectionForTests(): void {
  if (testOnlyProcess()) consumed.clear();
}

export function phase9FaultInjectionStatus(): {
  enabled: boolean;
  configured_hooks: Phase9FaultHook[];
  consumed_hooks: Phase9FaultHook[];
} {
  const configured = [...configuredHooks()].filter((hook): hook is Phase9FaultHook =>
    [
      "BEFORE_MODEL_RESULT_WRITE",
      "AFTER_MODEL_RESULT_WRITE",
      "BEFORE_EVIDENCE_COMMIT",
      "AFTER_EVIDENCE_COMMIT",
      "BEFORE_REPORT_COMMIT",
      "AFTER_REPORT_COMMIT",
      "BEFORE_JOB_COMPLETE",
      "AFTER_JOB_COMPLETION_TRANSACTION",
    ].includes(hook),
  );
  return {
    enabled: testOnlyProcess() && configured.length > 0,
    configured_hooks: configured,
    consumed_hooks: configured.filter((hook) => consumed.has(hook)),
  };
}
