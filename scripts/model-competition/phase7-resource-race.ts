#!/usr/bin/env -S npx vite-node

/**
 * Bounded real-worker admission, heartbeat, stale-recovery, and fencing
 * experiment. Two independent Node workers race for one real lesion-model
 * lease; at most the winner launches the real Python batch probe.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  acquireResourceLease,
  heartbeatResourceLease,
  inspectResourceLeases,
  observeHostMemory,
  releaseResourceLease,
  type ResourceLeaseConfig,
} from "../../lib/runtime";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATASET_ROOT = path.join(ROOT, "scratch", "datasets", "DeepDRiD", "regular_fundus_images", "regular-fundus-validation");
const SOURCE_CSV = path.join(DATASET_ROOT, "regular-fundus-validation.csv");
const IMAGE_ROOT = path.join(DATASET_ROOT, "Images");
const MODEL_DIR = path.join(ROOT, "data", "models", "fundus-lesions-clementp-unet-seresnext50");
const BATCH_SCRIPT = path.join(ROOT, "scripts", "inference", "fundus_lesion_batch_probe.py");
const WORKER_SCRIPT = path.join(ROOT, "scripts", "model-competition", "phase7-real-resource-worker.ts");
const VITE_NODE = path.join(ROOT, "node_modules", "vite-node", "dist", "cli.mjs");
const WORKER_CONFIG: ResourceLeaseConfig = { memoryBytes: 2 * 1024 ** 3, threads: 4, headroomBytes: 1 * 1024 ** 3, leaseMs: 30_000, maxActiveLeases: 1 };

function firstImage(): string | null {
  if (!fs.existsSync(SOURCE_CSV)) return null;
  const lines = fs.readFileSync(SOURCE_CSV, "utf8").trim().split(/\r?\n/).slice(1);
  const first = lines.find(Boolean)?.split(",");
  if (!first) return null;
  const headers = fs.readFileSync(SOURCE_CSV, "utf8").trim().split(/\r?\n/)[0].split(",");
  const row = Object.fromEntries(headers.map((header, index) => [header, first[index] ?? ""]));
  const image = path.join(IMAGE_ROOT, row.patient_id, `${row.image_id}.jpg`);
  return fs.existsSync(image) ? image : null;
}

function lastJson(stdout: string): any {
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try { return JSON.parse(lines[index]); } catch { /* vite diagnostics */ }
  }
  return null;
}

function runWorker(workerId: string, databaseFile: string, image: string): Promise<any> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [VITE_NODE, WORKER_SCRIPT], {
      cwd: ROOT,
      env: {
        ...process.env,
        PROJECT_ROOT: ROOT,
        VISIONSCAN_PERSISTENCE_BACKEND: "sqlite",
        PHASE7_WORKER_ID: workerId,
        PHASE7_DATABASE_FILE: databaseFile,
        DATABASE_FILE: databaseFile,
        PHASE7_IMAGE: image,
        PHASE7_MODEL_DIR: MODEL_DIR,
        PHASE7_BATCH_SCRIPT: BATCH_SCRIPT,
        TMP_ROOT: path.join(path.dirname(databaseFile), "tmp"),
      },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => { if (child.pid && process.platform === "win32") spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); else child.kill("SIGTERM"); }, 180_000);
    child.stdout?.on("data", (chunk: Buffer | string) => { stdout += chunk.toString().slice(0, 2_000_000); });
    child.stderr?.on("data", (chunk: Buffer | string) => { stderr = (stderr + chunk.toString()).slice(-2_000); });
    child.once("close", (code) => {
      clearTimeout(timeout);
      resolve({ ...(lastJson(stdout) ?? { worker_id: workerId, status: "NO_JSON" }), process_exit_code: code, stderr_present: Boolean(stderr) });
    });
    child.once("error", (error) => { clearTimeout(timeout); resolve({ worker_id: workerId, process_exit_code: null, status: "SPAWN_ERROR", error: error.message }); });
  });
}

async function main(): Promise<void> {
  const image = firstImage();
  if (!image || !fs.existsSync(MODEL_DIR) || !fs.existsSync(BATCH_SCRIPT) || !fs.existsSync(VITE_NODE)) {
    const result = { schema_version: "visionscan-phase7-resource-race-v1", status: "NOT_MEASURED", reason: "real worker inputs unavailable", phi_included: false };
    const output = path.join(ROOT, "docs", "generated", "phase7-resource-race.json");
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "visionscan-phase7-resource-race-"));
  const raceDb = path.join(temp, "race.db");
  const fencingDb = path.join(temp, "fencing.db");
  try {
    // Create the isolated lease schema before concurrent processes open the
    // file. The actual admission/configuration decision still occurs inside
    // the two independent workers below.
    await inspectResourceLeases({ config: WORKER_CONFIG, databaseFile: raceDb, hostMemory: observeHostMemory() });
    const workers = await Promise.all([runWorker("real-worker-a", raceDb, image), runWorker("real-worker-b", raceDb, image)]);
    const admitted = workers.filter((worker) => worker.admitted === true);
    const modelLaunches = workers.filter((worker) => worker.model_started === true).length;
    const raceSnapshot = await inspectResourceLeases({ config: WORKER_CONFIG, databaseFile: raceDb, hostMemory: observeHostMemory() });

    const fencingConfig: ResourceLeaseConfig = { memoryBytes: 100, threads: 1, headroomBytes: 0, leaseMs: 1_000, maxActiveLeases: 1 };
    const injectedMemory = { platform: "test" as NodeJS.Platform, totalBytes: 10_000, availableBytes: 10_000, source: "test_injected" as const, enforcement: "observation_only" as const };
    const old = await acquireResourceLease({ request: { workerId: "old-worker", jobId: "old-job", modelId: "real-test-resource", memoryBytes: 100, threads: 1 }, config: fencingConfig, databaseFile: fencingDb, nowMs: 1_000, hostMemory: injectedMemory });
    const heartbeat = old.reservation ? await heartbeatResourceLease({ reservation: old.reservation, config: fencingConfig, databaseFile: fencingDb, nowMs: 1_100, hostMemory: injectedMemory }) : { changed: false };
    const newer = await acquireResourceLease({ request: { workerId: "new-worker", jobId: "new-job", modelId: "real-test-resource", memoryBytes: 100, threads: 1 }, config: fencingConfig, databaseFile: fencingDb, nowMs: 2_101, hostMemory: injectedMemory });
    const staleRelease = old.reservation ? await releaseResourceLease({ reservation: old.reservation, config: fencingConfig, databaseFile: fencingDb, nowMs: 2_101, hostMemory: injectedMemory }) : { changed: false };
    const newRelease = newer.reservation ? await releaseResourceLease({ reservation: newer.reservation, config: fencingConfig, databaseFile: fencingDb, nowMs: 2_102, hostMemory: injectedMemory }) : { changed: false };
    const fencingSnapshot = await inspectResourceLeases({ config: fencingConfig, databaseFile: fencingDb, hostMemory: injectedMemory });

    const result = {
      schema_version: "visionscan-phase7-resource-race-v1",
      observed_at: new Date().toISOString(),
      status: admitted.length === 1 && modelLaunches <= 1 && workers.every((worker) => worker.process_exit_code === 0) ? "MEASURED_REAL_WORKER_RACE" : "PARTIAL_REAL_WORKER_RACE",
      worker_processes_started: workers.length,
      workers: workers.map((worker) => ({ worker_id: worker.worker_id, admitted: worker.admitted ?? false, rejection_reason: worker.rejection_reason ?? null, model_started: worker.model_started ?? false, model_completed: worker.model_completed ?? false, heartbeat_count: worker.heartbeat_count ?? 0, worker_status: worker.worker_status ?? null, process_exit_code: worker.process_exit_code })),
      admission: { capacity: 1, admitted_count: admitted.length, model_launch_count: modelLaunches, no_double_launch: modelLaunches <= 1, active_leases_after_race: raceSnapshot.activeLeases, process_scope: "two independent Node workers; admitted winner launched one real Python lesion batch probe" },
      heartbeat: { real_worker_heartbeat_observed: workers.some((worker) => Number(worker.heartbeat_count) > 0), fencing_probe_changed: heartbeat.changed },
      stale_recovery: { old_admitted: old.admitted, newer_admitted: newer.admitted, reclaimed: newer.reclaimed, active_after: fencingSnapshot.activeLeases },
      ownership_fencing: { stale_release_changed: staleRelease.changed, newer_release_changed: newRelease.changed, old_release_blocked: staleRelease.changed === false, newer_release_succeeded: newRelease.changed === true },
      host_memory: observeHostMemory(),
      config: { memory_bytes: WORKER_CONFIG.memoryBytes, threads: WORKER_CONFIG.threads, headroom_bytes: WORKER_CONFIG.headroomBytes, lease_ms: WORKER_CONFIG.leaseMs, max_active_leases: WORKER_CONFIG.maxActiveLeases },
      phi_included: false,
      limitations: [
        "The cross-process race is bounded to two local worker processes and one real lesion probe input.",
        "The stale/fencing clock probe uses injected test time and a separate isolated SQLite file.",
        "This does not establish universal OS-level memory enforcement, multi-host locking, or production capacity.",
      ],
    };
    const output = path.join(ROOT, "docs", "generated", "phase7-resource-race.json");
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    process.stdout.write(`${JSON.stringify({ status: result.status, output: path.relative(ROOT, output), admitted_count: admitted.length, model_launch_count: modelLaunches }, null, 2)}\n`);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : error}\n`); process.exitCode = 1; });
