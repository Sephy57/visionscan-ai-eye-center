/**
 * Process ownership for local model workers.
 *
 * Providers remain short-lived subprocess providers, but the queue needs one
 * safe way to find the children belonging to a single job when a deadline,
 * cancellation, or shutdown occurs. AsyncLocalStorage carries the opaque job
 * scope through provider calls; no study, patient, or document value is
 * stored in this registry.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { ChildProcess } from "node:child_process";
import { terminateProcessTree, type ProcessTreeTerminationResult } from "./processTree";

const scopeStorage = new AsyncLocalStorage<string>();
const activeChildren = new Map<ChildProcess, string>();

/** Run work with a process-only ownership scope. */
export function withProcessTreeScope<T>(scope: string, work: () => Promise<T> | T): Promise<T> {
  const safeScope = typeof scope === "string" && scope.length > 0 ? scope.slice(0, 128) : "worker";
  return scopeStorage.run(safeScope, async () => work());
}

/** Register a child so cancellation/deadline cleanup can target its tree. */
export function trackChildProcess(child: ChildProcess, scope = scopeStorage.getStore() ?? "worker"): () => void {
  activeChildren.set(child, scope.slice(0, 128));
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    activeChildren.delete(child);
  };
  child.once("close", release);
  child.once("error", release);
  // Node's timeout option kills the direct child, but not necessarily its
  // descendants on Windows. The centralized tree terminator is the second
  // line of defense; a process that already exited is harmlessly reported by
  // taskkill as a failed/unknown target.
  child.once("timeout", () => { void terminateProcessTree(child); });
  return release;
}

export function activeTrackedProcessCount(scope?: string): number {
  if (scope === undefined) return activeChildren.size;
  return [...activeChildren.values()].filter((value) => value === scope).length;
}

/** Terminate only children owned by the supplied job scope. */
export async function terminateTrackedProcessTrees(scope?: string): Promise<ProcessTreeTerminationResult[]> {
  const children = [...activeChildren.entries()]
    .filter(([, childScope]) => scope === undefined || childScope === scope)
    .map(([child]) => child);
  return Promise.all(children.map((child) => terminateProcessTree(child)));
}

/** Alias used by worker shutdown paths. */
export const terminateAllTrackedProcessTrees = terminateTrackedProcessTrees;

