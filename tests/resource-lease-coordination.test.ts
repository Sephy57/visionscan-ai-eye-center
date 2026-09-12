import { afterEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";
import { spawn } from "child_process";
import {
  acquireResourceLease,
  heartbeatResourceLease,
  inspectResourceLeases,
  releaseResourceLease,
  reapExpiredResourceLeases,
  type ResourceLeaseConfig,
} from "@/lib/runtime/resourceLease";
import { buildThreadGovernedEnv } from "@/lib/runtime/threadGovernance";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const config: ResourceLeaseConfig = {
  memoryBytes: 100,
  threads: 4,
  headroomBytes: 0,
  leaseMs: 1_000,
  maxActiveLeases: 4,
};

const hostMemory = {
  platform: "test" as NodeJS.Platform,
  totalBytes: 10_000,
  availableBytes: 10_000,
  source: "node_os_freemem" as const,
  enforcement: "observation_only" as const,
};

function request(workerId: string, jobId = `job-${workerId}`) {
  return { workerId, jobId, modelId: "model-test", memoryBytes: 100, threads: 4 };
}

function childRun(scriptPath: string, env: NodeJS.ProcessEnv): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const runner = path.resolve(process.cwd(), "node_modules", "vite-node", "dist", "cli.mjs");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [runner, scriptPath], { cwd: process.cwd(), env, windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`resource lease child timed out: ${stderr}`));
    }, 30_000);
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", (error) => { clearTimeout(timeout); reject(error); });
    child.on("close", (code) => { clearTimeout(timeout); resolve({ code, stdout, stderr }); });
  });
}

function lastJson(stdout: string): Record<string, unknown> {
  const line = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
  if (!line) throw new Error(`No JSON output: ${stdout}`);
  return JSON.parse(line) as Record<string, unknown>;
}

describe("host-wide durable resource leases", () => {
  it("admits, fences ownership, heartbeats, releases, and exposes only active reservations", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "visionscan-resource-lease-"));
    roots.push(root);
    const databaseFile = path.join(root, "resource.db");
    const first = await acquireResourceLease({ request: request("worker-a"), config, databaseFile, nowMs: 1_000, hostMemory });
    expect(first.admitted).toBe(true);
    expect(first.reservation?.reservationId).toMatch(/^lease-/);
    expect(first.snapshot.activeLeases).toBe(1);

    const wrong = await heartbeatResourceLease({ reservation: { ...first.reservation!, workerId: "worker-b" }, config, databaseFile, nowMs: 1_200, hostMemory });
    expect(wrong.changed).toBe(false);
    const live = await heartbeatResourceLease({ reservation: first.reservation!, config, databaseFile, nowMs: 1_200, hostMemory });
    expect(live.changed).toBe(true);
    const wrongRelease = await releaseResourceLease({ reservation: { ...first.reservation!, workerId: "worker-b" }, config, databaseFile, nowMs: 1_300, hostMemory });
    expect(wrongRelease.changed).toBe(false);
    const released = await releaseResourceLease({ reservation: first.reservation!, config, databaseFile, nowMs: 1_400, hostMemory });
    expect(released.changed).toBe(true);
    expect((await inspectResourceLeases({ config, databaseFile, hostMemory })).activeLeases).toBe(0);
  });

  it("reclaims an expired reservation transactionally before admitting the next worker", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "visionscan-resource-expiry-"));
    roots.push(root);
    const databaseFile = path.join(root, "resource.db");
    const first = await acquireResourceLease({ request: request("worker-dead"), config, databaseFile, nowMs: 1_000, hostMemory });
    expect(first.admitted).toBe(true);
    const second = await acquireResourceLease({ request: request("worker-new"), config, databaseFile, nowMs: 2_001, hostMemory });
    expect(second.admitted).toBe(true);
    expect(second.reclaimed).toBe(1);
    expect(second.snapshot.activeLeases).toBe(1);
    expect((await reapExpiredResourceLeases({ config, databaseFile, nowMs: 2_002, hostMemory })).expired).toBe(0);
  });

  it("defers on observed low host memory and fails closed on a budget mismatch", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "visionscan-resource-guards-"));
    roots.push(root);
    const databaseFile = path.join(root, "resource.db");
    const low = await acquireResourceLease({ request: request("worker-low"), config: { ...config, headroomBytes: 10 }, databaseFile, nowMs: 1_000, hostMemory: { ...hostMemory, availableBytes: 109 } });
    expect(low.admitted).toBe(false);
    expect(low.reason).toBe("host_memory_low");

    const first = await acquireResourceLease({ request: request("worker-a"), config, databaseFile: path.join(root, "other.db"), nowMs: 1_000, hostMemory });
    expect(first.admitted).toBe(true);
    const mismatch = await acquireResourceLease({ request: request("worker-b"), config: { ...config, memoryBytes: 200 }, databaseFile: path.join(root, "other.db"), nowMs: 1_100, hostMemory });
    expect(mismatch.admitted).toBe(false);
    expect(mismatch.reason).toBe("configuration_mismatch");
  });

  it("serializes two independent Node workers so only one wins the last slot", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "visionscan-resource-race-"));
    roots.push(root);
    const databaseFile = path.join(root, "resource.db");
    const scriptPath = path.join(root, "lease-worker.ts");
    const modulePath = pathToFileURL(path.resolve(process.cwd(), "lib", "runtime", "resourceLease.ts")).href;
    fs.writeFileSync(scriptPath, `
const { acquireResourceLease } = await import(${JSON.stringify(modulePath)});
const config = { memoryBytes: 100, threads: 4, headroomBytes: 0, leaseMs: 1000, maxActiveLeases: 4 };
const hostMemory = { platform: "test", totalBytes: 10000, availableBytes: 10000, source: "node_os_freemem", enforcement: "observation_only" };
const result = await acquireResourceLease({ request: { workerId: process.env.LEASE_WORKER, jobId: "race-job-" + process.env.LEASE_WORKER, modelId: "model-test", memoryBytes: 100, threads: 4 }, config, databaseFile: process.env.LEASE_DB, hostMemory });
console.log(JSON.stringify({ admitted: result.admitted, reason: result.reason, activeLeases: result.snapshot.activeLeases }));
`, "utf8");
    const env = {
      ...process.env,
      PROJECT_ROOT: path.resolve(process.cwd()),
      DATABASE_FILE: path.join(root, "unused-default.db"),
      VISIONSCAN_PERSISTENCE_BACKEND: "sqlite",
      LEASE_DB: databaseFile,
    };
    const [a, b] = await Promise.all([
      childRun(scriptPath, { ...env, LEASE_WORKER: "a" }),
      childRun(scriptPath, { ...env, LEASE_WORKER: "b" }),
    ]);
    expect(a.code).toBe(0);
    expect(b.code).toBe(0);
    const results = [lastJson(a.stdout), lastJson(b.stdout)];
    expect(results.filter((result) => result.admitted === true)).toHaveLength(1);
    expect(results.filter((result) => result.reason === "memory_budget_exceeded")).toHaveLength(1);
    expect((await inspectResourceLeases({ config, databaseFile, hostMemory })).activeLeases).toBe(1);
  }, 45_000);

  it("rejects the JSON backend instead of pretending it is cross-process safe", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "visionscan-resource-json-"));
    roots.push(root);
    const scriptPath = path.join(root, "json-worker.ts");
    const modulePath = pathToFileURL(path.resolve(process.cwd(), "lib", "runtime", "resourceLease.ts")).href;
    fs.writeFileSync(scriptPath, `
const { acquireResourceLease } = await import(${JSON.stringify(modulePath)});
const result = await acquireResourceLease({ request: { workerId: "json-worker", jobId: "json-job", modelId: "model-test", memoryBytes: 100, threads: 1 }, config: { memoryBytes: 100, threads: 1, headroomBytes: 0, leaseMs: 1000, maxActiveLeases: 1 }, databaseFile: process.env.LEASE_DB });
console.log(JSON.stringify({ admitted: result.admitted, reason: result.reason }));
`, "utf8");
    const result = await childRun(scriptPath, {
      ...process.env,
      PROJECT_ROOT: path.resolve(process.cwd()),
      DATABASE_FILE: path.join(root, "eye-ai.json"),
      VISIONSCAN_PERSISTENCE_BACKEND: "json",
      LEASE_DB: path.join(root, "resource.db"),
    });
    expect(result.code).toBe(0);
    expect(lastJson(result.stdout)).toEqual({ admitted: false, reason: "persistence_backend_unsupported" });
  }, 45_000);
});

describe("thread governance", () => {
  it("sets native-library, PyTorch, and ONNX cooperative budgets without dropping inherited variables", () => {
    const governed = buildThreadGovernedEnv(4, { interOpThreads: 2, environment: { ...process.env, KEEP_ME: "yes" } });
    expect(governed).toMatchObject({
      KEEP_ME: "yes",
      OMP_NUM_THREADS: "4",
      MKL_NUM_THREADS: "4",
      OPENBLAS_NUM_THREADS: "4",
      NUMEXPR_NUM_THREADS: "4",
      VISIONSCAN_PYTORCH_INTRA_OP_THREADS: "4",
      VISIONSCAN_PYTORCH_INTER_OP_THREADS: "2",
      VISIONSCAN_ONNX_INTRA_OP_THREADS: "4",
      VISIONSCAN_ONNX_INTER_OP_THREADS: "2",
    });
  });
});
