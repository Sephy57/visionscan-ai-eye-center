#!/usr/bin/env -S npx vite-node

/** One real Phase 7 worker used by the cross-process resource-race harness. */

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

import { TMP_ROOT } from "../../lib/config";
import {
  acquireResourceLease,
  heartbeatResourceLease,
  observeHostMemory,
  releaseResourceLease,
  type ResourceLeaseConfig,
  type ResourceLeaseHandle,
} from "../../lib/runtime";
import { terminateTrackedProcessTrees, trackChildProcess, withProcessTreeScope } from "../../lib/jobs/processControl";
import { buildThreadGovernedEnv } from "../../lib/runtime/threadGovernance";

const workerId = process.env.PHASE7_WORKER_ID ?? "phase7-worker";
const databaseFile = process.env.PHASE7_DATABASE_FILE ?? process.env.DATABASE_FILE ?? path.join(TMP_ROOT, "phase7-resource.db");
const imagePath = process.env.PHASE7_IMAGE;
const modelDir = process.env.PHASE7_MODEL_DIR;
const batchScript = process.env.PHASE7_BATCH_SCRIPT;
const python = path.join(process.cwd(), ".venv-ophthalmic", process.platform === "win32" ? "Scripts" : "bin", process.platform === "win32" ? "python.exe" : "python3");
const config: ResourceLeaseConfig = {
  memoryBytes: 2 * 1024 ** 3,
  threads: 4,
  headroomBytes: 1 * 1024 ** 3,
  leaseMs: 30_000,
  maxActiveLeases: 1,
};

function lastJson(stdout: string): any {
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try { return JSON.parse(lines[index]); } catch { /* diagnostic lines are ignored */ }
  }
  return null;
}

async function runRealModel(reservation: ResourceLeaseHandle): Promise<{ started: boolean; completed: boolean; elapsedMs: number; heartbeatCount: number; workerStatus: string }> {
  if (!imagePath || !modelDir || !batchScript || !fs.existsSync(imagePath) || !fs.existsSync(modelDir) || !fs.existsSync(batchScript)) {
    return { started: false, completed: false, elapsedMs: 0, heartbeatCount: 0, workerStatus: "NOT_MEASURED_INPUT_UNAVAILABLE" };
  }
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  const manifestPath = path.join(TMP_ROOT, `phase7_resource_race_${process.pid}.json`);
  fs.writeFileSync(manifestPath, JSON.stringify([{ image_path: imagePath }]));
  const scope = `phase7-real-resource-${workerId}`;
  let heartbeatCount = 0;
  const heartbeatTimer = setInterval(() => {
    void heartbeatResourceLease({ reservation, config, databaseFile, hostMemory: observeHostMemory() }).then((result) => {
      if (result.changed) heartbeatCount += 1;
    });
  }, 500);
  const started = performance.now();
  try {
    return await withProcessTreeScope(scope, () => new Promise((resolve) => {
      const child = spawn(python, ["-I", "-s", batchScript, modelDir, manifestPath, "--threads", "4"], {
        cwd: process.cwd(),
        env: buildThreadGovernedEnv(4),
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      trackChildProcess(child, scope);
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (chunk: Buffer | string) => { stdout += chunk.toString().slice(0, 2_000_000); });
      child.stderr?.on("data", (chunk: Buffer | string) => { stderr = (stderr + chunk.toString()).slice(-2_000); });
      const timer = setTimeout(() => { void terminateTrackedProcessTrees(scope); }, 120_000);
      child.once("error", () => { clearTimeout(timer); resolve({ started: true, completed: false, elapsedMs: performance.now() - started, heartbeatCount, workerStatus: "FAILED_TO_SPAWN" }); });
      child.once("close", (code) => {
        clearTimeout(timer);
        const payload = lastJson(stdout);
        resolve({
          started: true,
          completed: code === 0 && payload?.batch_status === "complete",
          elapsedMs: Number((performance.now() - started).toFixed(3)),
          heartbeatCount,
          workerStatus: code === 0 && payload?.batch_status === "complete" ? "COMPLETED" : `FAILED_${code ?? "UNKNOWN"}${stderr ? "_WITH_DIAGNOSTIC" : ""}`,
        });
      });
    }));
  } finally {
    clearInterval(heartbeatTimer);
    try { fs.unlinkSync(manifestPath); } catch { /* contained scratch cleanup is best effort */ }
  }
}

async function main(): Promise<void> {
  const decision = await acquireResourceLease({
    request: { workerId, jobId: `phase7-real-race-${workerId}`, modelId: "fundus-lesions-clementp-unet-seresnext50", memoryBytes: config.memoryBytes, threads: config.threads },
    config,
    databaseFile,
    hostMemory: observeHostMemory(),
  });
  if (!decision.admitted || !decision.reservation) {
    process.stdout.write(`${JSON.stringify({ worker_id: workerId, admitted: false, rejection_reason: decision.reason, backend: decision.snapshot.backend, configured: decision.snapshot.configured, model_started: false, heartbeat_count: 0 })}\n`);
    return;
  }
  try {
    const result = await runRealModel(decision.reservation);
    process.stdout.write(`${JSON.stringify({ worker_id: workerId, admitted: true, model_started: result.started, model_completed: result.completed, model_elapsed_ms: result.elapsedMs, heartbeat_count: result.heartbeatCount, worker_status: result.workerStatus })}\n`);
  } finally {
    await releaseResourceLease({ reservation: decision.reservation, config, databaseFile, hostMemory: observeHostMemory() });
  }
}

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`); process.exitCode = 1; });
