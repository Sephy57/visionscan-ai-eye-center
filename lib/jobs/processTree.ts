/**
 * Centralized best-effort process-tree termination for worker subprocesses.
 *
 * Windows uses taskkill's documented recursive mode. Other platforms are a
 * deliberate no-op: this module must never guess at a portable tree-kill
 * command or terminate an unrelated process. The default runner is isolated
 * behind an injectable seam so command construction and dry-run behavior can
 * be tested without claiming real Windows orphan prevention.
 */

import { spawn, type ChildProcess } from "node:child_process";

export type ProcessTreeTarget = number | ChildProcess | null | undefined;
export type ProcessTreeOutcome = "dry-run" | "unsupported-platform" | "invalid-pid" | "terminated" | "failed";

export interface TaskkillResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stderr?: string;
}

export type TaskkillRunner = (args: readonly string[]) => Promise<TaskkillResult>;

export interface ProcessTreeTerminationOptions {
  /** Test seam; production defaults to process.platform. */
  platform?: NodeJS.Platform;
  /** Plan the exact Windows command without spawning taskkill. */
  dryRun?: boolean;
  /** Test seam; production invokes taskkill with hidden windows and no stdio. */
  runTaskkill?: TaskkillRunner;
}

export interface ProcessTreeTerminationResult {
  readonly pid: number | null;
  readonly platform: NodeJS.Platform;
  readonly requested: boolean;
  readonly attempted: boolean;
  readonly dryRun: boolean;
  readonly method: "taskkill" | "none";
  readonly command: readonly string[] | null;
  readonly outcome: ProcessTreeOutcome;
  readonly error?: string;
}

function pidOf(target: ProcessTreeTarget): number | null {
  const candidate = typeof target === "number" ? target : target?.pid;
  return typeof candidate === "number" && Number.isSafeInteger(candidate) && candidate > 0 ? candidate : null;
}

function defaultTaskkill(args: readonly string[]): Promise<TaskkillResult> {
  return new Promise((resolve) => {
    let stderr = "";
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn("taskkill", [...args], {
        windowsHide: true,
        stdio: ["ignore", "ignore", "pipe"],
      });
    } catch (error) {
      resolve({ code: null, signal: null, stderr: String(error instanceof Error ? error.message : error) });
      return;
    }
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-1000);
    });
    child.once("error", (error) => {
      resolve({ code: null, signal: null, stderr: String(error.message).slice(-1000) });
    });
    child.once("close", (code, signal) => {
      resolve({ code, signal, stderr });
    });
  });
}

/** Return whether the real host can use the Windows recursive taskkill path. */
export function supportsProcessTreeTermination(platform: NodeJS.Platform = process.platform): boolean {
  return platform === "win32";
}

/**
 * Request termination of a target and its descendants.
 *
 * This returns an outcome instead of throwing so cleanup remains safe in
 * deadline/cancellation paths. A successful taskkill command only proves the
 * command exited successfully; it does not constitute an orphan audit.
 */
export async function terminateProcessTree(
  target: ProcessTreeTarget,
  options: ProcessTreeTerminationOptions = {},
): Promise<ProcessTreeTerminationResult> {
  const platform = options.platform ?? process.platform;
  const pid = pidOf(target);
  const command = pid === null ? null : ["/PID", String(pid), "/T", "/F"] as const;
  const base = {
    pid,
    platform,
    requested: target !== null && target !== undefined,
    dryRun: options.dryRun === true,
  } as const;

  if (pid === null) {
    return { ...base, attempted: false, method: "none", command: null, outcome: "invalid-pid" };
  }
  if (!supportsProcessTreeTermination(platform)) {
    return {
      ...base,
      attempted: false,
      method: "none",
      command: null,
      outcome: options.dryRun ? "dry-run" : "unsupported-platform",
    };
  }
  if (options.dryRun) {
    return { ...base, attempted: false, method: "taskkill", command, outcome: "dry-run" };
  }

  const taskkillArgs = ["/PID", String(pid), "/T", "/F"] as const;
  const runner = options.runTaskkill ?? defaultTaskkill;
  try {
    const result = await runner(taskkillArgs);
    if (result.code === 0) {
      return { ...base, attempted: true, method: "taskkill", command, outcome: "terminated" };
    }
    return {
      ...base,
      attempted: true,
      method: "taskkill",
      command,
      outcome: "failed",
      error: result.stderr || `taskkill exited with code ${result.code ?? "unknown"}${result.signal ? ` (${result.signal})` : ""}.`,
    };
  } catch (error) {
    return {
      ...base,
      attempted: true,
      method: "taskkill",
      command,
      outcome: "failed",
      error: String(error instanceof Error ? error.message : error).slice(0, 1000),
    };
  }
}

export const terminateChildProcessTree = terminateProcessTree;
export const killProcessTree = terminateProcessTree;
