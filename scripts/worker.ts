/**
 * Single-concurrency local SQLite worker for VISIONSCAN_EXTERNAL_WORKER mode.
 * Set the worker-process marker before importing queue/config modules so the
 * queue does not suppress its own execution path.
 */

export {};

process.env.VISIONSCAN_WORKER_PROCESS = "true";
process.env.VISIONSCAN_EXTERNAL_WORKER = "true";

const { runWorkerOnce } = await import("../lib/jobs/queue");

const workerId = process.env.VISIONSCAN_WORKER_ID?.trim() || `external-worker-${process.pid}`;
const once = /^(?:1|true|yes)$/i.test(process.env.VISIONSCAN_WORKER_ONCE ?? "");
const pollMsRaw = Number(process.env.VISIONSCAN_WORKER_POLL_MS ?? "1000");
const pollMs = Number.isFinite(pollMsRaw) ? Math.max(250, Math.min(60_000, Math.floor(pollMsRaw))) : 1000;
let stopping = false;

const stop = () => { stopping = true; };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

do {
  const pass = await runWorkerOnce({ workerId, maxJobs: 1 });
  console.log(JSON.stringify({
    event: "worker_pass",
    worker_id: workerId,
    polled: pass.polled,
    job_count: pass.job_ids.length,
    recovered: pass.recovery.stale.length + pass.recovery.retryable.length + pass.recovery.queued.length,
  }));
  if (once || stopping) break;
  await delay(pollMs);
} while (!stopping);
