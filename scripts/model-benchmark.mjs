#!/usr/bin/env node
/**
 * Bounded, offline resource benchmark for the local research model probes.
 *
 * The probes are intentionally launched as fresh isolated child processes for
 * both phases. "Warm" therefore means filesystem/interpreter warm-up, not a
 * resident model cache. Resource sampling is best-effort on Windows and is
 * reported as observed:false when the child exits before a sample arrives.
 * No clinical performance claim is made by this command.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PYTHON = path.join(ROOT, ".venv-ophthalmic", process.platform === "win32" ? "Scripts" : "bin", process.platform === "win32" ? "python.exe" : "python3");
const IMAGE_DIR = path.join(ROOT, "scratch", "test_images");
const RUNS = Math.max(1, Math.min(3, Number.parseInt(process.env.MODEL_BENCHMARK_RUNS ?? "3", 10) || 3));
const TIMEOUT_MS = Math.max(20_000, Math.min(600_000, Number.parseInt(process.env.MODEL_BENCHMARK_TIMEOUT_MS ?? "240000", 10) || 240_000));
const SAMPLE_MS = Math.max(100, Math.min(2_000, Number.parseInt(process.env.MODEL_BENCHMARK_SAMPLE_MS ?? "250", 10) || 250));
const OUTPUT_INDEX = process.argv.indexOf("--output");
const OUTPUT_PATH = OUTPUT_INDEX >= 0 ? process.argv[OUTPUT_INDEX + 1] : null;

const MODELS = [
  {
    model_id: "fundus-lesions-clementp-unet-seresnext50",
    model_dir: path.join(ROOT, "scratch", "models", "fundus-lesions-clementp-a2cfcb594e48"),
    artifact: "model.safetensors",
    expected_sha256: "a7a7cb45b92328f7c9a8e581eec3944fd435d37fae8cbf340b1319c5f987c6d2",
    probe: path.join(ROOT, "scripts", "inference", "fundus_lesion_probe.py"),
    image: path.join(IMAGE_DIR, "example_fundus.jpg"),
    args: ["--threads", "4"],
  },
  {
    model_id: "fundus-dr-grading-effb0",
    model_dir: path.join(ROOT, "scratch", "models", "fundus-dr-grading-effb0-a1"),
    artifact: "model.safetensors",
    expected_sha256: "0d9a18b0cb6c90d1f30bf2e66153b368bd7ff0bcb45b6690e8d5ce14fa19f69b",
    probe: path.join(ROOT, "scripts", "inference", "dr_grade_probe.py"),
    image: path.join(IMAGE_DIR, "example_fundus.jpg"),
    args: ["--threads", "4"],
  },
  {
    model_id: "oct-retinal-weights-fp32",
    model_dir: path.join(ROOT, "scratch", "models", "oct-retinal-weights-a1"),
    artifact: "human_eye_fp32.onnx",
    expected_sha256: "22b1fffb5a0ab88284d4c5817c581bedb1b54c09011d87c3f6472cb2c36b2b1f",
    probe: path.join(ROOT, "scripts", "inference", "oct_retinal_probe.py"),
    image: path.join(IMAGE_DIR, "oct_kermany_0.png"),
    args: [],
  },
  {
    model_id: "segformer-optic-disc-cup-refuge",
    model_dir: path.join(ROOT, "scratch", "models", "segformer-optic-disc-cup-refuge"),
    artifact: "model.safetensors",
    expected_sha256: "22e45131b64eb07a5d29a2e5388a7709d10696b13f48d2d0cdcf56cafa1f9ea5",
    probe: path.join(ROOT, "scripts", "inference", "segformer_infer.py"),
    image: path.join(IMAGE_DIR, "example_fundus.jpg"),
    args: [],
  },
];

function exists(file, kind = "file") {
  try {
    const stat = fs.statSync(file);
    return kind === "directory" ? stat.isDirectory() : stat.isFile();
  } catch { return false; }
}

function sha256(file) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(file));
  return hash.digest("hex");
}

function percentile(values, p) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = p <= 0 ? 0 : Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1);
  return Number(sorted[index].toFixed(1));
}

function summarize(values) {
  return { samples: values.filter(Number.isFinite).length, p50_ms: percentile(values, 0.5), p95_ms: percentile(values, 0.95), min_ms: percentile(values, 0.0), max_ms: percentile(values, 1.0) };
}

function parseJson(text) {
  const lines = String(text ?? "").trim().split(/\r?\n/).reverse();
  for (const line of lines) { try { return JSON.parse(line); } catch { /* diagnostics */ } }
  return null;
}

function sampleChild(pid) {
  if (process.platform !== "win32") return Promise.resolve(null);
  return new Promise((resolve) => {
    // The Windows venv launcher can hand off to the base interpreter. Walk the
    // process tree so RSS/CPU includes the actual probe process, not only the
    // small launcher parent.
    const command = "$root=" + String(pid) + ";$pending=New-Object 'System.Collections.Generic.Queue[int]';$pending.Enqueue($root);$ids=New-Object 'System.Collections.Generic.HashSet[int]';while($pending.Count -gt 0){$id=$pending.Dequeue();if(-not $ids.Add($id)){continue};Get-CimInstance Win32_Process -Filter ('ParentProcessId = ' + $id) -ErrorAction SilentlyContinue|ForEach-Object{$pending.Enqueue([int]$_.ProcessId)}};$ps=@();foreach($id in $ids){$p=Get-Process -Id $id -ErrorAction SilentlyContinue;if($p){$ps+=$p}};if($ps.Count -gt 0){[pscustomobject]@{working_set_bytes=[int64](($ps|Measure-Object -Property WorkingSet64 -Sum).Sum);private_bytes=[int64](($ps|Measure-Object -Property PrivateMemorySize64 -Sum).Sum);cpu_seconds=[double](($ps|ForEach-Object{$_.TotalProcessorTime.TotalSeconds}|Measure-Object -Sum).Sum);thread_count=[int](($ps|ForEach-Object{$_.Threads.Count}|Measure-Object -Sum).Sum);process_count=[int]$ps.Count}|ConvertTo-Json -Compress}";
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += String(chunk); });
    child.on("close", () => resolve(parseJson(output)));
    child.on("error", () => resolve(null));
  });
}

function killTree(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  else child.kill("SIGTERM");
}

async function runProbe(model, phase, index) {
  const started = performance.now();
  const args = ["-I", "-s", model.probe, model.model_dir, model.image, ...model.args];
  return new Promise((resolve) => {
    const child = spawn(PYTHON, args, { cwd: ROOT, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = ""; let timedOut = false; let settled = false;
    let peakWorking = null; let peakPrivate = null; let peakThreads = null; let cpuSeconds = null;
    const sample = () => { void sampleChild(child.pid).then((metric) => {
      if (!metric) return;
      peakWorking = Math.max(peakWorking ?? 0, Number(metric.working_set_bytes) || 0);
      peakPrivate = Math.max(peakPrivate ?? 0, Number(metric.private_bytes) || 0);
      peakThreads = Math.max(peakThreads ?? 0, Number(metric.thread_count) || 0);
      cpuSeconds = Math.max(cpuSeconds ?? 0, Number(metric.cpu_seconds) || 0);
    }); };
    const interval = setInterval(sample, SAMPLE_MS); sample();
    const timeout = setTimeout(() => { timedOut = true; killTree(child); }, TIMEOUT_MS);
    const finish = (code, signal, error = null) => {
      if (settled) return; settled = true; clearInterval(interval); clearTimeout(timeout);
      const payload = parseJson(stdout);
      const observed = peakWorking !== null;
      resolve({
        phase, run: index, status: code === 0 && payload?.inference_status === "completed" ? "completed" : timedOut ? "timed_out" : "failed",
        exit_code: code, signal, elapsed_ms: Number((performance.now() - started).toFixed(1)),
        output_model_id: payload?.model_id ?? null,
        error: error ?? (payload?.inference_error ?? (code === 0 ? null : stderr.trim() || null)),
        resources: {
          observed, rss_semantics: "windows_working_set", peak_rss_bytes: observed ? peakWorking : null,
          peak_private_bytes: observed ? peakPrivate : null, cpu_time_seconds: observed ? Number((cpuSeconds ?? 0).toFixed(3)) : null,
          peak_thread_count: observed ? peakThreads : null, configured_threads: model.args.includes("--threads") ? Number(model.args[model.args.indexOf("--threads") + 1]) : null,
          sampling_interval_ms: SAMPLE_MS, sampling_scope: "probe_process_tree",
        },
      });
    };
    child.stdout.on("data", (chunk) => { stdout += String(chunk).slice(0, 2_000_000 - stdout.length); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk).slice(0, 200_000 - stderr.length); });
    child.on("error", (error) => finish(null, null, error.message));
    child.on("close", (code, signal) => finish(code, signal));
  });
}

async function runModel(model) {
  const artifactPath = path.join(model.model_dir, model.artifact);
  const missing = [[PYTHON, "file"], [model.model_dir, "directory"], [artifactPath, "file"], [model.probe, "file"], [model.image, "file"]]
    .filter(([file, kind]) => !exists(file, kind))
    .map(([file]) => file);
  if (missing.length) return { model_id: model.model_id, status: "MODEL_UNAVAILABLE", missing };
  const actualHash = sha256(artifactPath);
  if (actualHash !== model.expected_sha256) return { model_id: model.model_id, status: "INTEGRITY_FAILURE", expected_sha256: model.expected_sha256, actual_sha256: actualHash };
  const cold = []; const warm = [];
  for (let i = 1; i <= RUNS; i += 1) cold.push(await runProbe(model, "cold_subprocess", i));
  for (let i = 1; i <= RUNS; i += 1) warm.push(await runProbe(model, "warm_subprocess", i));
  const all = [...cold, ...warm];
  const completed = all.filter((r) => r.status === "completed");
  return {
    model_id: model.model_id, status: completed.length === all.length ? "MEASURED" : "PARTIAL",
    artifact_path: path.relative(ROOT, artifactPath), artifact_sha256: actualHash, runs_per_phase: RUNS,
    cold: { wall_time: summarize(cold.map((r) => r.elapsed_ms)), resources: summarizeResources(cold) },
    warm: { wall_time: summarize(warm.map((r) => r.elapsed_ms)), resources: summarizeResources(warm) },
    runs: all,
    notes: ["Fresh isolated probe process for every sample.", "Warm means process/filesystem warm-up, not a resident model.", "Resource metrics are observational for the probe process tree; no GPU or unrelated-process total is claimed."],
  };
}

function summarizeResources(runs) {
  const observed = runs.filter((r) => r.resources.observed);
  return {
    observed: observed.length > 0,
    peak_rss_bytes: observed.length ? Math.max(...observed.map((r) => r.resources.peak_rss_bytes ?? 0)) : null,
    peak_private_bytes: observed.length ? Math.max(...observed.map((r) => r.resources.peak_private_bytes ?? 0)) : null,
    peak_thread_count: observed.length ? Math.max(...observed.map((r) => r.resources.peak_thread_count ?? 0)) : null,
    cpu_time_seconds_max: observed.length ? Math.max(...observed.map((r) => r.resources.cpu_time_seconds ?? 0)) : null,
    sampling_interval_ms: SAMPLE_MS,
    rss_semantics: "windows_working_set",
  };
}

const output = {
  generated_at: new Date().toISOString(),
  status: "RESEARCH_BENCHMARK_ONLY",
  platform: { os: process.platform, arch: process.arch, logical_cpus: Number(process.env.NUMBER_OF_PROCESSORS ?? 0) || null },
  runs_per_phase: RUNS, timeout_ms: TIMEOUT_MS, sampling_interval_ms: SAMPLE_MS,
  models: [],
};

for (const model of MODELS) output.models.push(await runModel(model));
const serialized = `${JSON.stringify(output, null, 2)}\n`;
if (OUTPUT_PATH) {
  const resolved = path.resolve(ROOT, OUTPUT_PATH);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, serialized, "utf8");
  console.log(JSON.stringify({ status: "MODEL_BENCHMARK_WRITTEN", output: path.relative(ROOT, resolved), models: output.models.length }, null, 2));
} else {
  console.log(serialized);
}
