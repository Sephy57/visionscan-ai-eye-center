/**
 * Single-concurrency local SQLite worker for VISIONSCAN_EXTERNAL_WORKER mode.
 * Set the worker-process marker before importing queue/config modules so the
 * queue does not suppress its own execution path.
 */

export {};

process.env.VISIONSCAN_WORKER_PROCESS = "true";
process.env.VISIONSCAN_EXTERNAL_WORKER = "true";

const { PERSISTENCE_BACKEND } = await import("../lib/config");
if (PERSISTENCE_BACKEND !== "sqlite") {
  throw new Error("External worker requires SQLite persistence; the legacy JSON backend is single-process only.");
}

const { runWorkerOnce } = await import("../lib/jobs/queue");
const { terminateAllTrackedProcessTrees, activeTrackedProcessCount } = await import("../lib/jobs/processControl");
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
  if (lifecycle.policy === "LEASE_FOR_RECOVERY" && lifecycle.current_job_id) {
    // A lease-recovery shutdown must stop the provider process and then leave
    // the durable running row fenced for the next worker. Do not finalize the
    // job as cancelled/failed here: the lease expiry is the recovery signal.
    shutdown ??= (async () => {
      await terminateAllTrackedProcessTrees();
      const waitUntil = Date.now() + 10_000;
      while (activeTrackedProcessCount() > 0 && Date.now() < waitUntil) await delay(50);
      console.log(JSON.stringify({
        event: "worker_shutdown_complete",
        policy: lifecycle.policy,
        current_job_id: lifecycle.current_job_id,
        tracked_processes_remaining: activeTrackedProcessCount(),
        action: "PROVIDER_TREE_TERMINATED_WORKER_EXITED_FOR_LEASE_RECOVERY",
      }));
      process.exitCode = 0;
      process.exit(0);
    })();
  }
};
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

do {
  if (!lifecycle.canStartPass()) break;
  const pass = await runWorkerOnce({
    workerId,
    maxJobs: 1,
    canClaim: () => lifecycle.canClaim(),
    canClaimSync: () => lifecycle.canClaim(),
    onJobClaimed: (job) => {
      // The durable claim already won the SQLite race. The lifecycle adopts
      // that exact id so shutdown telemetry and drain policy describe the
      // job actually being executed, not merely the candidate that was read.
      lifecycle.adoptClaimedJob(job.job_id);
    },
    onJobFinished: (jobId) => lifecycle.finishJob(jobId),
  });
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
