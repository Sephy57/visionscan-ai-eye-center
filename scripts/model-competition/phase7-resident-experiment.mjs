#!/usr/bin/env node

/**
 * Bounded resident-model experiment for the lesion provider. The model is
 * loaded once and exercised on 20 de-identified research images serially;
 * memory checkpoints are sampled from the real process tree.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATASET_ROOT = path.join(ROOT, "scratch", "datasets", "DeepDRiD", "regular_fundus_images", "regular-fundus-validation");
const SOURCE_CSV = path.join(DATASET_ROOT, "regular-fundus-validation.csv");
const IMAGE_ROOT = path.join(DATASET_ROOT, "Images");
const MODEL_DIR = path.join(ROOT, "data", "models", "fundus-lesions-clementp-unet-seresnext50");
const ARTIFACT = path.join(MODEL_DIR, "model.safetensors");
const PROBE = path.join(ROOT, "scripts", "inference", "fundus_lesion_resident_probe.py");
const PYTHON = path.join(ROOT, ".venv-ophthalmic", process.platform === "win32" ? "Scripts" : "bin", process.platform === "win32" ? "python.exe" : "python3");
const MAX_ITEMS = 20;
const TIMEOUT_MS = 10 * 60 * 1000;
const SAMPLE_MS = 250;

function sha256(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }

function images() {
  if (!fs.existsSync(SOURCE_CSV)) return [];
  const [header, ...lines] = fs.readFileSync(SOURCE_CSV, "utf8").trim().split(/\r?\n/);
  const fields = header.split(",");
  return lines.filter(Boolean).map((line) => {
    const values = line.split(",");
    const row = Object.fromEntries(fields.map((field, index) => [field, values[index] ?? ""]));
    return path.join(IMAGE_ROOT, row.patient_id, `${row.image_id}.jpg`);
  }).filter((file) => fs.existsSync(file)).slice(0, MAX_ITEMS);
}

function parseJsonLine(line) { try { return JSON.parse(line); } catch { return null; } }

function treeMetric(pid) {
  if (process.platform !== "win32" || !pid) return Promise.resolve(null);
  const command = "$root=" + String(pid) + ";$q=New-Object 'System.Collections.Generic.Queue[int]';$q.Enqueue($root);$ids=New-Object 'System.Collections.Generic.HashSet[int]';while($q.Count -gt 0){$id=$q.Dequeue();if(-not $ids.Add($id)){continue};Get-CimInstance Win32_Process -Filter ('ParentProcessId = ' + $id) -ErrorAction SilentlyContinue|ForEach-Object{$q.Enqueue([int]$_.ProcessId)}};$ps=@();foreach($id in $ids){$p=Get-Process -Id $id -ErrorAction SilentlyContinue;if($p){$ps+=$p}};if($ps.Count -gt 0){[pscustomobject]@{working_set_bytes=[int64](($ps|Measure-Object WorkingSet64 -Sum).Sum);private_bytes=[int64](($ps|Measure-Object PrivateMemorySize64 -Sum).Sum);cpu_seconds=[double](($ps|ForEach-Object{$_.TotalProcessorTime.TotalSeconds}|Measure-Object -Sum).Sum);thread_count=[int](($ps|ForEach-Object{$_.Threads.Count}|Measure-Object -Sum).Sum)}|ConvertTo-Json -Compress}";
  return new Promise((resolve) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += String(chunk); });
    child.on("close", () => resolve(parseJsonLine(output.trim())));
    child.on("error", () => resolve(null));
  });
}

function summarize(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return { count: 0, p50: null, p95: null, max: null };
  return { count: sorted.length, p50: sorted[Math.floor((sorted.length - 1) * 0.5)], p95: sorted[Math.floor((sorted.length - 1) * 0.95)], max: sorted[sorted.length - 1] };
}

function killTree(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  else child.kill("SIGTERM");
}

async function main() {
  const selected = images();
  const outputPath = path.join(ROOT, "docs", "generated", "phase7-resident-experiment.json");
  if (selected.length < MAX_ITEMS || !fs.existsSync(ARTIFACT) || !fs.existsSync(PROBE) || !fs.existsSync(PYTHON)) {
    const result = { schema_version: "visionscan-phase7-resident-experiment-v1", status: "NOT_MEASURED", resident_decision: "NOT_MEASURED", reason: "20 real resident-experiment inputs or runtime unavailable", phi_included: false };
    fs.mkdirSync(path.dirname(outputPath), { recursive: true }); fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8"); console.log(JSON.stringify(result)); return;
  }
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "visionscan-phase7-resident-"));
  const manifest = path.join(temp, "manifest.json");
  fs.writeFileSync(manifest, JSON.stringify(selected.map((image_path) => ({ image_path }))));
  const started = performance.now();
  const child = spawn(PYTHON, ["-I", "-s", PROBE, MODEL_DIR, manifest, "--threads", "4"], {
    cwd: ROOT,
    env: { ...process.env, OMP_NUM_THREADS: "4", MKL_NUM_THREADS: "4", OPENBLAS_NUM_THREADS: "4", NUMEXPR_NUM_THREADS: "4", VISIONSCAN_PYTORCH_INTRA_OP_THREADS: "4", VISIONSCAN_PYTORCH_INTER_OP_THREADS: "1" },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = ""; let stderr = ""; let timedOut = false;
  let peakWorking = null; let peakPrivate = null; let peakCpu = null; let peakThreads = null;
  const checkpoints = {};
  const sample = () => { void treeMetric(child.pid).then((metric) => { if (!metric) return; peakWorking = Math.max(peakWorking ?? 0, Number(metric.working_set_bytes) || 0); peakPrivate = Math.max(peakPrivate ?? 0, Number(metric.private_bytes) || 0); peakCpu = Math.max(peakCpu ?? 0, Number(metric.cpu_seconds) || 0); peakThreads = Math.max(peakThreads ?? 0, Number(metric.thread_count) || 0); }); };
  const interval = setInterval(sample, SAMPLE_MS); sample();
  const progressPromises = [];
  child.stdout.on("data", (chunk) => { stdout += String(chunk).slice(0, 4_000_000 - stdout.length); });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk).slice(-200_000);
    for (const line of String(chunk).split(/\r?\n/)) {
      const payload = parseJsonLine(line.trim());
      const completed = payload?.resident_progress?.completed;
      if (Number.isInteger(completed) && completed >= 1 && completed <= MAX_ITEMS && !checkpoints[completed]) {
        const promise = treeMetric(child.pid).then((metric) => { checkpoints[completed] = metric; });
        progressPromises.push(promise);
      }
    }
  });
  const timeout = setTimeout(() => { timedOut = true; killTree(child); }, TIMEOUT_MS);
  const closeCode = await new Promise((resolve) => { child.once("error", () => resolve(null)); child.once("close", (code) => resolve(code)); });
  clearTimeout(timeout); clearInterval(interval); sample(); await Promise.all(progressPromises);
  const payload = stdout.trim().split(/\r?\n/).map(parseJsonLine).filter(Boolean).at(-1) ?? null;
  const results = Array.isArray(payload?.results) ? payload.results : [];
  const services = results.map((item) => Number(item.service_ms)).filter(Number.isFinite);
  const completed = results.filter((item) => item?.inference_status === "completed").length;
  const first = checkpoints[1]?.working_set_bytes ?? null;
  const last = checkpoints[20]?.working_set_bytes ?? null;
  const stableMemory = first !== null && last !== null && Number(last) <= Number(first) * 1.5;
  const output = {
    schema_version: "visionscan-phase7-resident-experiment-v1",
    observed_at: new Date().toISOString(),
    status: closeCode === 0 && !timedOut && completed === MAX_ITEMS ? "MEASURED_RESIDENT_20_CASES" : "PARTIAL_RESIDENT_EXPERIMENT",
    provider: "fundus-lesion-clementp-unet-seresnext50",
    artifact_sha256: sha256(ARTIFACT),
    cases: { requested: MAX_ITEMS, completed, serial: payload?.serial === true, output_contract: payload?.output_contract ?? null },
    initial_load_ms: payload?.resident_load_ms ?? null,
    warm_inference_ms: summarize(services),
    memory_checkpoints: Object.fromEntries([1, 5, 10, 20].map((count) => [String(count), checkpoints[count] ? { working_set_bytes: checkpoints[count].working_set_bytes, private_bytes: checkpoints[count].private_bytes, cpu_seconds: checkpoints[count].cpu_seconds, thread_count: checkpoints[count].thread_count } : null])),
    peak_resources: { working_set_bytes: peakWorking, private_bytes: peakPrivate, cpu_seconds: peakCpu, thread_count: peakThreads, sampling_interval_ms: SAMPLE_MS, semantics: "Windows process-tree observation" },
    state_isolation: { status: "BOUNDED_INPUT_SCOPE_ONLY", note: "Each item is supplied as an independent manifest path; no prior study or laterality state is stored by this worker. This is not a full production isolation proof." },
    resident_decision: closeCode === 0 && !timedOut && completed === MAX_ITEMS && stableMemory ? "RESIDENT_RESEARCH_SAFE_FOR_BOUNDED_USE" : "RESIDENT_EXPERIMENT_REJECTED",
    phi_included: false,
    limitations: [
      "The experiment loads one model once and processes 20 de-identified/public research inputs serially; it is not a production worker or clinical validation.",
      "Memory samples are best-effort Windows working-set observations and do not enforce an OS limit.",
      "The bounded state-isolation note does not prove safety across every provider, cache, cancellation, or restart path.",
      ...(stderr && closeCode !== 0 ? ["The worker emitted a diagnostic during termination; the full diagnostic is not persisted."] : []),
    ],
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true }); fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8"); console.log(JSON.stringify({ status: output.status, output: path.relative(ROOT, outputPath), resident_decision: output.resident_decision, completed }));
  fs.rmSync(temp, { recursive: true, force: true });
}

main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
