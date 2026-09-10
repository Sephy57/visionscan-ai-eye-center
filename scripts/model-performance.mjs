#!/usr/bin/env node
/**
 * Bounded engineering benchmark for the S9 SegFormer research provider.
 *
 * This script deliberately measures the existing, gitignored artifact only.
 * It does not download weights, change provider behavior, or make a clinical
 * latency/accuracy claim.  A checkout without the S9 runtime or artifact is a
 * clean skip (MODEL_UNAVAILABLE, exit 0).
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MODEL_ID = "segformer-optic-disc-cup-refuge";
const MODEL_DIR = path.join(ROOT, "scratch", "models", MODEL_ID);
const MODEL_ARTIFACT = path.join(MODEL_DIR, "model.safetensors");
const MODEL_CONFIG = path.join(MODEL_DIR, "config.json");
const PREPROCESSOR_CONFIG = path.join(MODEL_DIR, "preprocessor_config.json");
const IMAGE = path.join(ROOT, "scratch", "test_images", "example_fundus.jpg");
const PROBE = path.join(ROOT, "scripts", "inference", "segformer_infer.py");
const PROVIDER = path.join(ROOT, "lib", "models", "segformerResearchProvider.ts");
const VITE_NODE = path.join(ROOT, "node_modules", "vite-node", "dist", "cli.mjs");
const PYTHON = path.join(
  ROOT,
  ".venv-ophthalmic",
  process.platform === "win32" ? "Scripts" : "bin",
  process.platform === "win32" ? "python.exe" : "python3",
);

// This is the independently recorded S9 artifact identity in
// docs/S9_REAL_MODEL_INTEGRATION.md.  Benchmarking a different byte stream
// would make the timing evidence ambiguous, so mismatches fail closed.
const EXPECTED_ARTIFACT_SHA256 = "22e45131b64eb07a5d29a2e5388a7709d10696b13f48d2d0cdcf56cafa1f9ea5";
const DEFAULT_RUNS = 3;
const MAX_RUNS = 5;
const DEFAULT_TIMEOUT_MS = 180_000;
const MAX_CAPTURE_CHARS = 2_000_000;
const MEMORY_NOTE = "Peak child RSS is not sampled: the existing S9 probe does not expose it, and this benchmark avoids platform-specific process sampling that could perturb timings.";

function isFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function boundedInteger(name, fallback, minimum, maximum) {
  const parsed = Number.parseInt(String(process.env[name] ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function boundedTimeout() {
  const parsed = Number.parseInt(String(process.env.MODEL_PERF_TIMEOUT_MS ?? ""), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_TIMEOUT_MS;
  return Math.max(10_000, Math.min(600_000, parsed));
}

function roundMs(value) {
  return Number(Number(value).toFixed(1));
}

function finiteOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function summarize(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const percentile = (fraction) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
  return {
    samples: sorted.length,
    p50_ms: roundMs(percentile(0.5)),
    p95_ms: roundMs(percentile(0.95)),
    min_ms: roundMs(sorted[0]),
    max_ms: roundMs(sorted.at(-1)),
  };
}

function appendBounded(current, chunk) {
  if (current.length >= MAX_CAPTURE_CHARS) return current;
  return current + String(chunk).slice(0, MAX_CAPTURE_CHARS - current.length);
}

function parseJsonOutput(output) {
  const text = String(output ?? "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // Keep the benchmark tolerant of a diagnostic line emitted by a runtime,
    // while still requiring a complete JSON object from the final line.
    const lines = text.split(/\r?\n/).reverse();
    for (const line of lines) {
      try {
        return JSON.parse(line);
      } catch {
        // Continue to the next candidate line.
      }
    }
    return null;
  }
}

function errorText(result) {
  const text = String(result.stderr || result.stdout || "").trim();
  return text ? text.slice(0, 500) : (result.error || "no diagnostic output");
}

function checkPython() {
  const result = spawnSync(PYTHON, ["-I", "-s", "-c", "import sys; print(sys.version.split()[0])"], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 10_000,
    windowsHide: true,
  });
  return {
    available: result.status === 0 && !result.error,
    version: String(result.stdout || "").trim() || null,
    error: result.error?.message || String(result.stderr || "").trim() || null,
  };
}

function terminateChild(child) {
  if (!child || !child.pid) return;
  if (process.platform === "win32") {
    // `child.kill()` does not reliably terminate descendants on Windows.  The
    // PID is the exact benchmark child, so taskkill /T is bounded to this run.
    const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    killer.on("error", () => {
      try { child.kill(); } catch { /* already exited */ }
    });
  } else {
    try { child.kill("SIGTERM"); } catch { /* already exited */ }
  }
}

function runChild(command, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const started = performance.now();
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let timeoutHandle;
    let terminateHandle;
    let child;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      clearTimeout(terminateHandle);
      resolve({
        ...result,
        stdout,
        stderr,
        timed_out: timedOut,
        elapsed_ms: roundMs(performance.now() - started),
      });
    };

    try {
      child = spawn(command, args, {
        cwd: options.cwd ?? ROOT,
        env: options.env ?? process.env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      finish({ code: null, signal: null, error: error instanceof Error ? error.message : String(error) });
      return;
    }

    child.stdout?.on("data", (chunk) => { stdout = appendBounded(stdout, chunk); });
    child.stderr?.on("data", (chunk) => { stderr = appendBounded(stderr, chunk); });
    child.on("error", (error) => {
      finish({ code: null, signal: null, error: error instanceof Error ? error.message : String(error) });
    });
    child.on("close", (code, signal) => { finish({ code, signal, error: null }); });
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      terminateChild(child);
      // A taskkill failure should not leave this benchmark unbounded.  The
      // child is also asked to terminate directly as a final exact-PID step.
      terminateHandle = setTimeout(() => {
        try { child.kill("SIGKILL"); } catch { /* already exited */ }
      }, 5_000);
    }, timeoutMs);
  });
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function unavailable(reason, checks, extra = {}) {
  return {
    status: "MODEL_UNAVAILABLE",
    skipped: true,
    reason,
    checks,
    ...extra,
    metrics: { cold_subprocess: null, warm_provider: null },
    notes: [
      "No model files or runtime were downloaded by this command.",
      "Install/acquire the existing S9 research artifact and pinned runtime before rerunning.",
    ],
  };
}

async function runCold(index, timeoutMs) {
  const result = await runChild(PYTHON, ["-I", "-s", PROBE, MODEL_DIR, IMAGE], { timeoutMs });
  const payload = parseJsonOutput(result.stdout);
  const timings = payload?._debug?.timing_seconds ?? {};
  const completed = result.code === 0 && payload?.inference_status === "completed";
  const run = {
    run: index,
    status: completed ? "completed" : result.timed_out ? "timed_out" : payload?.inference_status === "failed" ? "inference_failed" : "process_failed",
    wall_ms: result.elapsed_ms,
    exit_code: result.code,
    python_import_ms: completed ? roundMs(Number(timings.import) * 1000) : null,
    model_load_ms: completed ? roundMs(Number(timings.model_load) * 1000) : null,
    inference_ms: completed ? roundMs(Number(timings.inference) * 1000) : null,
  };
  if (!completed) run.error = errorText(result);
  return run;
}

function makeWarmHarness(filePath, providerUrl, imagePath, count) {
  const source = `
import { performance } from "node:perf_hooks";
import { runSegformerResearchInference } from ${JSON.stringify(providerUrl)};

const imagePath = ${JSON.stringify(imagePath)};
const count = ${count};
const runs = [];
let failed = false;

for (let index = 1; index <= count; index += 1) {
  const started = performance.now();
  try {
    const output = await runSegformerResearchInference(imagePath);
    const completed = output?.inference_status === "completed";
    const run = {
      run: index,
      status: completed ? "completed" : "inference_failed",
      wall_ms: Number((performance.now() - started).toFixed(1)),
    };
    if (!completed) {
      failed = true;
      run.error = String(output?.inference_error || "provider returned a failed inference status").slice(0, 500);
    }
    runs.push(run);
  } catch (error) {
    failed = true;
    runs.push({
      run: index,
      status: "provider_error",
      wall_ms: Number((performance.now() - started).toFixed(1)),
      error: String(error?.message || error).slice(0, 500),
    });
  }
}

process.stdout.write(JSON.stringify({ runs }));
if (failed) process.exitCode = 1;
`;
  fs.writeFileSync(filePath, source, { encoding: "utf8", mode: 0o600 });
}

async function runWarm(count, timeoutMs) {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "visionscan-s9-performance-"));
  const harness = path.join(temporaryDirectory, "provider-performance.ts");
  try {
    makeWarmHarness(harness, pathToFileURL(PROVIDER).href, IMAGE, count);
    const processTimeoutMs = Math.min(600_000, Math.max(timeoutMs, timeoutMs * count));
    const result = await runChild(process.execPath, [VITE_NODE, harness], {
      timeoutMs: processTimeoutMs,
      env: { ...process.env, PROJECT_ROOT: ROOT },
    });
    const payload = parseJsonOutput(result.stdout);
    if (!payload || !Array.isArray(payload.runs)) {
      return {
        process: {
          status: result.timed_out ? "timed_out" : "process_failed",
          exit_code: result.code,
          wall_ms: result.elapsed_ms,
          error: errorText(result),
        },
        runs: [],
      };
    }
    return {
      process: {
        status: result.code === 0 ? "completed" : "provider_failed",
        exit_code: result.code,
        wall_ms: result.elapsed_ms,
        ...(result.code === 0 ? {} : { error: errorText(result) }),
      },
      runs: payload.runs,
    };
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

async function main() {
  const coldRuns = boundedInteger("MODEL_PERF_COLD_RUNS", DEFAULT_RUNS, 1, MAX_RUNS);
  const warmRuns = boundedInteger("MODEL_PERF_WARM_RUNS", DEFAULT_RUNS, 1, MAX_RUNS);
  const timeoutMs = boundedTimeout();
  const checks = {
    python_executable: isFile(PYTHON),
    probe: isFile(PROBE),
    model_artifact: isFile(MODEL_ARTIFACT),
    model_config: isFile(MODEL_CONFIG),
    preprocessor_config: isFile(PREPROCESSOR_CONFIG),
    image: isFile(IMAGE),
    vite_node: isFile(VITE_NODE),
  };

  const missing = Object.entries(checks).filter(([, present]) => !present).map(([name]) => name);
  if (missing.length > 0) {
    console.log(JSON.stringify(unavailable(`S9 runtime/artifact prerequisites missing: ${missing.join(", ")}`, checks), null, 2));
    return 0;
  }

  const python = checkPython();
  if (!python.available) {
    console.log(JSON.stringify(unavailable(`S9 Python runtime could not start${python.error ? `: ${python.error}` : ""}`, { ...checks, python_runtime: false }), null, 2));
    return 0;
  }

  const artifactSha256 = await hashFile(MODEL_ARTIFACT);
  const artifactBytes = fs.statSync(MODEL_ARTIFACT).size;
  if (artifactSha256 !== EXPECTED_ARTIFACT_SHA256) {
    console.log(JSON.stringify({
      status: "MODEL_INVALID",
      skipped: false,
      reason: "S9 model.safetensors SHA-256 does not match the recorded artifact identity",
      checks,
      model: { id: MODEL_ID, artifact_sha256: artifactSha256, expected_sha256: EXPECTED_ARTIFACT_SHA256, artifact_bytes: artifactBytes },
      metrics: { cold_subprocess: null, warm_provider: null },
    }, null, 2));
    return 1;
  }

  const cold = [];
  for (let index = 1; index <= coldRuns; index += 1) cold.push(await runCold(index, timeoutMs));

  const warmResult = await runWarm(warmRuns, timeoutMs);
  const warm = warmResult.runs;
  const coldCompleted = cold.filter((run) => run.status === "completed");
  const warmCompleted = warm.filter((run) => run.status === "completed");
  const allCompleted = coldCompleted.length === coldRuns && warmCompleted.length === warmRuns && warmResult.process.status === "completed";

  console.log(JSON.stringify({
    status: allCompleted ? "MEASURED" : "MEASUREMENT_FAILED",
    skipped: false,
    measured_at: new Date().toISOString(),
    model: {
      id: MODEL_ID,
      artifact_sha256: artifactSha256,
      artifact_bytes: artifactBytes,
      python_version: python.version,
    },
    configuration: {
      cold_runs: coldRuns,
      warm_runs: warmRuns,
      timeout_ms: timeoutMs,
      warm_process_timeout_ms: Math.min(600_000, Math.max(timeoutMs, timeoutMs * warmRuns)),
      warm_mode: "provider_calls_one_shot_subprocess",
    },
    metrics: {
      cold_subprocess: {
        summary: summarize(coldCompleted.map((run) => run.wall_ms)),
        peak_rss_bytes: null,
        peak_rss_observed: false,
        runs: cold,
      },
      warm_provider: {
        summary: summarize(warmCompleted.map((run) => run.wall_ms)),
        peak_rss_bytes: null,
        peak_rss_observed: false,
        process: warmResult.process,
        runs: warm,
        note: "Current provider creates a fresh isolated Python subprocess per call; warm means subsequent calls after OS filesystem cache/module startup, not persistent model residency.",
      },
    },
    notes: [
      "Engineering timing only; not a clinical latency SLO, diagnostic performance result, or deployment-readiness claim.",
      "The S9 SegFormer provider is research-only and not clinically validated; no model files are added by this script.",
      MEMORY_NOTE,
    ],
  }, null, 2));
  return allCompleted ? 0 : 1;
}

main().then((code) => { process.exitCode = code; }).catch((error) => {
  console.log(JSON.stringify({
    status: "MEASUREMENT_FAILED",
    skipped: false,
    reason: error instanceof Error ? error.message : String(error),
    metrics: { cold_subprocess: null, warm_provider: null },
  }, null, 2));
  process.exitCode = 1;
});
