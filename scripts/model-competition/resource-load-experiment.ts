#!/usr/bin/env -S npx vite-node

/**
 * Safe Phase 6 resource-admission load points.
 *
 * This exercises the durable SQLite admission boundary at 1/5/10/25
 * concurrent requests. It deliberately does not start model inference: the
 * installed lesion worker is approximately 1.3 GB RSS, so multiplying it by
 * these points would be an unsafe capacity experiment. The output therefore
 * describes control-plane contention only, never model throughput.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import {
  acquireResourceLease,
  observeHostMemory,
  releaseResourceLease,
  type ResourceLeaseConfig,
} from "../../lib/runtime";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const POINTS = [1, 5, 10, 25];
const config: ResourceLeaseConfig = {
  memoryBytes: 2 * 1024 ** 3,
  threads: 4,
  headroomBytes: 0,
  leaseMs: 10_000,
  maxActiveLeases: 25,
};

function quantile(values: number[], fraction: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))].toFixed(2));
}

async function runPoint(size: number, databaseFile: string) {
  const started = performance.now();
  const observations = await Promise.all(Array.from({ length: size }, async (_, index) => {
    const requestStarted = performance.now();
    const decision = await acquireResourceLease({
      request: { workerId: `load-worker-${index}`, jobId: `load-${size}-${index}`, modelId: "phase6-control-plane", memoryBytes: 1, threads: 1 },
      config,
      databaseFile,
      hostMemory: { availableBytes: Number.MAX_SAFE_INTEGER, totalBytes: Number.MAX_SAFE_INTEGER, platform: process.platform, source: "test_injected", enforcement: "observation_only" },
    });
    return { admitted: decision.admitted, wait_ms: performance.now() - requestStarted, reservation: decision.reservation, reason: decision.reason };
  }));
  for (const observation of observations) {
    if (observation.reservation) await releaseResourceLease({ reservation: observation.reservation, config, databaseFile, hostMemory: observeHostMemory() });
  }
  const waits = observations.map((item) => item.wait_ms);
  return {
    requested: size,
    admitted: observations.filter((item) => item.admitted).length,
    rejected: observations.filter((item) => !item.admitted).length,
    rejection_reasons: Object.fromEntries(observations.filter((item) => !item.admitted).reduce((counts, item) => counts.set(item.reason ?? "unknown", (counts.get(item.reason ?? "unknown") ?? 0) + 1), new Map<string, number>())),
    queue_wait_ms: { p50: quantile(waits, 0.5), p95: quantile(waits, 0.95), max: quantile(waits, 1) },
    total_ms: Number((performance.now() - started).toFixed(2)),
  };
}

async function main() {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "visionscan-phase6-resource-"));
  const databaseFile = path.join(scratch, "resource.db");
  try {
    const points = [];
    for (const size of POINTS) points.push(await runPoint(size, databaseFile));
    const output = {
      schema_version: "visionscan-phase6-resource-load-v1",
      observed_at: new Date().toISOString(),
      status: "CONTROL_PLANE_ONLY",
      concurrency_mode: "single_process_concurrent_admission_requests",
      model_inference_started: false,
      config: { memory_bytes: config.memoryBytes, threads: config.threads, headroom_bytes: config.headroomBytes, lease_ms: config.leaseMs, max_active_leases: config.maxActiveLeases },
      host_memory: observeHostMemory(),
      points,
      limitations: [
        "These points exercise SQLite lease contention only; no model process was started.",
        "They cannot establish model throughput, resident capacity, production SLOs, or multi-host behavior.",
        "The real model benchmark remains separately reported as one cold and one warm isolated subprocess per installed artifact.",
      ],
      phi_included: false,
    };
    const outputPath = path.join(ROOT, "docs", "generated", "phase6-resource-load.json");
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
    process.stdout.write(`${JSON.stringify({ status: output.status, output: path.relative(ROOT, outputPath), points: points.length }, null, 2)}\n`);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`); process.exitCode = 1; });
