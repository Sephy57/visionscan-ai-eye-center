#!/usr/bin/env node
/**
 * Phase 5 runtime-experiment contract.
 *
 * This command is deliberately conservative.  A resident model worker is not
 * silently substituted for the existing short-lived providers, and no timing
 * is synthesized when the approved resident implementation is absent.  It
 * emits a machine-readable plan/result envelope so a future, independently
 * reviewed resident worker can be compared with the exact same fields.
 *
 * The command does not download weights, read patient data, or modify model
 * packages.  Use --output only when a caller explicitly wants to persist the
 * redacted envelope.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

const MODELS = [
  {
    model_id: "fundus-dr-grading-effb0",
    role: "REGISTERED_RESEARCH_MODEL",
    artifact_sha256: "0d9a18b0cb6c90d1f30bf2e66153b368bd7ff0bcb45b6690e8d5ce14fa19f69b",
    provider_mode: "short_lived_python_subprocess",
  },
  {
    model_id: "fundus-lesions-clementp-unet-seresnext50",
    role: "REGISTERED_RESEARCH_MODEL",
    artifact_sha256: "a7a7cb45b92328f7c9a8e581eec3944fd435d37fae8cbf340b1319c5f987c6d2",
    provider_mode: "short_lived_python_subprocess",
  },
  {
    model_id: "oct-retinal-weights-fp32",
    role: "REGISTERED_RESEARCH_MODEL",
    artifact_sha256: "22b1fffb5a0ab88284d4c5817c581bedb1b54c09011d87c3f6472cb2c36b2b1f",
    provider_mode: "short_lived_python_subprocess",
  },
];

const requestedLoads = [1, 5, 10, 25];
const residentJobsPerModel = 20;

function gitHead() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8", windowsHide: true });
  return result.status === 0 ? String(result.stdout).trim() : null;
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function notMeasured(reason) {
  return {
    status: "NOT_MEASURED",
    reason,
    first_latency_ms: null,
    warm_p50_ms: null,
    warm_p95_ms: null,
    peak_memory_bytes: null,
    memory_after_20_jobs_bytes: null,
    error_count: null,
    timeouts: null,
    retries: null,
    failures: null,
  };
}

function makeEnvelope() {
  const scriptSha256 = sha256File(SCRIPT_PATH);
  return {
    format: "visionscan-phase5-runtime-experiment/v1",
    run_id: `phase5-runtime-${new Date().toISOString().replace(/[-:.TZ]/g, "")}`,
    measured_at: new Date().toISOString(),
    commit_sha: gitHead(),
    script_sha256: scriptSha256,
    data_classification: "SYNTHETIC_ONLY",
    status: "NOT_MEASURED",
    strategy_comparison: {
      one_shot_subprocess: {
        status: "AVAILABLE_SEPARATE_BENCHMARK",
        evidence_command: "npm run model:benchmark",
        notes: [
          "The existing benchmark is the source of one-shot timing evidence.",
          "Its output must remain separate from resident-worker evidence.",
        ],
      },
      resident_worker: notMeasured(
        "No approved resident model-worker implementation exists; the current providers intentionally load and unload an isolated subprocess per request."
      ),
    },
    models: MODELS.map((model) => ({
      ...model,
      dataset_hash: null,
      preprocessing_version: null,
      resident: notMeasured("Resident worker not implemented; no resident timing or memory value is inferred."),
    })),
    resident_safety: {
      request_isolation: "NOT_RUN",
      memory_growth: "NOT_RUN",
      multiple_source_hashes: "NOT_RUN",
      cancellation: "COVERED_BY_SHORT_LIVED_PROVIDER_CONTRACT_ONLY",
      crash: "COVERED_BY_QUEUE_LEASE_TESTS; RESIDENT_WORKER_NOT_RUN",
      reload: "NOT_RUN",
      artifact_update: "NOT_RUN",
      shutdown: "COVERED_BY_WORKER_SHUTDOWN_CONTRACT; RESIDENT_WORKER_NOT_RUN",
    },
    load_test: {
      worker_count: 1,
      second_worker: "NOT_RUN — only permitted after a measured governor-backed memory budget check",
      requested_concurrency: requestedLoads,
      results: requestedLoads.map((concurrency) => ({
        concurrency,
        status: "NOT_MEASURED",
        throughput_jobs_per_second: null,
        queue_p50_ms: null,
        queue_p95_ms: null,
        service_p50_ms: null,
        service_p95_ms: null,
        total_completion_p50_ms: null,
        total_completion_p95_ms: null,
        peak_memory_bytes: null,
        cpu_utilization_percent: null,
        timeouts: null,
        retries: null,
        failures: null,
      })),
    },
    notes: [
      "This envelope is an auditable absence-of-evidence result, not a performance claim.",
      "No model artifact, patient identifier, model output, or score is copied into the envelope.",
      "A future resident implementation must record artifact SHA, dataset hash, preprocessing version, and the same metric fields before adoption.",
    ],
  };
}

function parseOutputPath() {
  const index = process.argv.indexOf("--output");
  if (index < 0) return null;
  const output = process.argv[index + 1];
  if (!output || output.startsWith("--")) throw new Error("--output requires a path");
  const resolved = path.resolve(output);
  if (Buffer.byteLength(resolved, "utf8") > MAX_OUTPUT_BYTES) throw new Error("output path is too long");
  return resolved;
}

function main() {
  const envelope = makeEnvelope();
  const outputPath = parseOutputPath();
  const serialized = `${JSON.stringify(envelope, null, 2)}\n`;
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, serialized, { encoding: "utf8", mode: 0o600 });
  }
  process.stdout.write(serialized);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
