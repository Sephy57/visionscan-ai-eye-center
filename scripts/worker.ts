/**
 * Single-concurrency local SQLite worker for VISIONSCAN_EXTERNAL_WORKER mode.
 * Set the worker-process marker before importing queue/config modules so the
 * queue does not suppress its own execution path.
 */

export {};

process.env.VISIONSCAN_WORKER_PROCESS = "true";
process.env.VISIONSCAN_EXTERNAL_WORKER = "true";

const { runWorkerOnce } = await import("../lib/jobs/queue");
const { terminateAllTrackedProcessTrees } = await import("../lib/jobs/processControl");
const { WorkerLifecycle, resolveWorkerShutdownPolicy } = await import("../lib/jobs/workerLifecycle");

const workerId = process.env.VISIONSCAN_WORKER_ID?.trim() || `external-worker-${process.pid}`;
const once = /^(?:1|true|yes)$/i.test(process.env.VISIONSCAN_WORKER_ONCE ?? "");
const pollMsRaw = Number(process.env.VISIONSCAN_WORKER_POLL_MS ?? "1000");
const pollMs = Number.isFinite(pollMsRaw) ? Math.max(250, Math.min(60_000, Math.floor(pollMsRaw))) : 1000;
const lifecycle = new WorkerLifecycle(resolveWorkerShutdownPolicy());
let shutdown: Promise<unknown> | null = null;

const stop = (source: "SIGINT" | "SIGTERM") => {
  const event = lifecycle.requestShutdown(source);
  console.log(JSON.stringify({ event: "worker_shutdown_requested", ...event }));
  if (lifecycle.policy === "CANCEL_CURRENT") shutdown ??= terminateAllTrackedProcessTrees();
};
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

do {
  if (!lifecycle.canStartPass()) break;
  const pass = await runWorkerOnce({ workerId, maxJobs: 1 });
  console.log(JSON.stringify({
    event: "worker_pass",
    worker_id: workerId,
    polled: pass.polled,
    job_count: pass.job_ids.length,
    recovered: pass.recovery.stale.length + pass.recovery.retryable.length + pass.recovery.queued.length,
    shutdown_policy: lifecycle.policy,
    worker_state: lifecycle.state,
  }));
  if (once || !lifecycle.canStartPass()) break;
  await delay(pollMs);
} while (lifecycle.canStartPass());

if (shutdown) await shutdown;
