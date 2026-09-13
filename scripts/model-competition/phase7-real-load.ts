#!/usr/bin/env -S npx vite-node

/**
 * Bounded real-model queued load experiment.
 *
 * One Node worker owns a SQLite lease queue with a single heavy-resource
 * slot. The 1/5/10/25 points launch real, hash-pinned lesion probe processes
 * serially through that queue, while the other jobs wait for admission. No
 * patient or image identifiers are written to the resulting evidence.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { MODEL_ROOT, TMP_ROOT, ensureDirs } from "../../lib/config";
import {
  acquireResourceLease,
  heartbeatResourceLease,
  observeHostMemory,
  releaseResourceLease,
  type ResourceLeaseConfig,
  type ResourceLeaseHandle,
} from "../../lib/runtime";
import { buildThreadGovernedEnv } from "../../lib/runtime/threadGovernance";
import { terminateTrackedProcessTrees, trackChildProcess, withProcessTreeScope } from "../../lib/jobs/processControl";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATASET_ROOT = path.join(ROOT, "scratch", "datasets", "DeepDRiD", "regular_fundus_images", "regular-fundus-validation");
const IMAGE_ROOT = path.join(DATASET_ROOT, "Images");
const SOURCE_CSV = path.join(DATASET_ROOT, "regular-fundus-validation.csv");
const MODEL_ID = "fundus-lesions-clementp-unet-seresnext50";
const MODEL_DIR = path.join(MODEL_ROOT, MODEL_ID);
const BATCH_SCRIPT = path.join(ROOT, "scripts", "inference", "fundus_lesion_batch_probe.py");
const PYTHON = path.join(ROOT, ".venv-ophthalmic", process.platform === "win32" ? "Scripts" : "bin", process.platform === "win32" ? "python.exe" : "python3");
const POINTS = [1, 5, 10, 25];
const JOB_TIMEOUT_MS = 120_000;
const SAMPLE_MS = 250;
const config: ResourceLeaseConfig = { memoryBytes: 2 * 1024 ** 3, threads: 4, headroomBytes: 1 * 1024 ** 3, leaseMs: 60_000, maxActiveLeases: 1 };

interface JobResult {
  job_index: number;
  status: string;
  admitted: boolean;
  retries: number;
  failures: number;
  timed_out: boolean;
  queue_wait_ms: number;
  claim_to_start_ms: number;
  resource_wait_ms: number;
  service_ms: number;
  job_ms: number;
  heartbeat_count: number;
  model_started: boolean;
  model_finished: boolean;
  output_valid: boolean;
  peak_working_set_bytes: number | null;
  peak_private_bytes: number | null;
  peak_cpu_seconds: number | null;
  peak_thread_count: number | null;
  deadline: string;
  rejection_reason: string | null;
}

function sha256(file: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function csvImages(): string[] {
  if (!fs.existsSync(SOURCE_CSV)) return [];
  const [header, ...lines] = fs.readFileSync(SOURCE_CSV, "utf8").trim().split(/\r?\n/);
  const fields = header.split(",");
  return lines.filter(Boolean).map((line) => {
    const values = line.split(",");
    const row = Object.fromEntries(fields.map((field, index) => [field, values[index] ?? ""]));
    return path.join(IMAGE_ROOT, row.patient_id, `${row.image_id}.jpg`);
  }).filter((file) => fs.existsSync(file));
}

function parseJson(stdout: string): any {
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try { return JSON.parse(lines[index]); } catch { /* diagnostics */ }
  }
  return null;
}

function snapshot(pid: number | undefined): { working: number; privateBytes: number; cpu: number; threads: number } | null {
  if (process.platform !== "win32" || !pid) return null;
  const command = "$root=" + String(pid) + ";$q=New-Object 'System.Collections.Generic.Queue[int]';$q.Enqueue($root);$ids=New-Object 'System.Collections.Generic.HashSet[int]';while($q.Count -gt 0){$id=$q.Dequeue();if(-not $ids.Add($id)){continue};Get-CimInstance Win32_Process -Filter ('ParentProcessId = ' + $id) -ErrorAction SilentlyContinue|ForEach-Object{$q.Enqueue([int]$_.ProcessId)}};$ps=@();foreach($id in $ids){$p=Get-Process -Id $id -ErrorAction SilentlyContinue;if($p){$ps+=$p}};if($ps.Count -gt 0){[pscustomobject]@{working=[int64](($ps|Measure-Object WorkingSet64 -Sum).Sum);privateBytes=[int64](($ps|Measure-Object PrivateMemorySize64 -Sum).Sum);cpu=[double](($ps|ForEach-Object{$_.TotalProcessorTime.TotalSeconds}|Measure-Object -Sum).Sum);threads=[int](($ps|ForEach-Object{$_.Threads.Count}|Measure-Object -Sum).Sum)}|ConvertTo-Json -Compress}";
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { encoding: "utf8", windowsHide: true, timeout: 5_000 });
  if (result.status !== 0) return null;
  try { return JSON.parse(String(result.stdout ?? "").trim()); } catch { return null; }
}

function killTree(child: import("node:child_process").ChildProcess): void {
  if (!child.pid) return;
  if (process.platform === "win32") spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  else child.kill("SIGTERM");
}

function delay(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function runModelProbe(jobIndex: number, databaseFile: string, imagePath: string, reservation: ResourceLeaseHandle, tempRoot: string): Promise<JobResult> {
  const queuedAt = performance.now();
  const result: JobResult = {
    job_index: jobIndex, status: "QUEUED", admitted: false, retries: 0, failures: 0, timed_out: false,
    queue_wait_ms: 0, claim_to_start_ms: 0, resource_wait_ms: 0, service_ms: 0, job_ms: 0, heartbeat_count: 0,
    model_started: false, model_finished: false, output_valid: false, peak_working_set_bytes: null, peak_private_bytes: null,
    peak_cpu_seconds: null, peak_thread_count: null, deadline: "NOT_RECORDED", rejection_reason: null,
  };
  const started = performance.now();
  let lease: ResourceLeaseHandle | null = null;
  let firstRejection: number | null = null;
  const request = { workerId: `phase7-load-worker-${jobIndex}`, jobId: `phase7-load-job-${jobIndex}`, modelId: MODEL_ID, memoryBytes: config.memoryBytes, threads: config.threads };
  while (!lease && performance.now() - queuedAt < JOB_TIMEOUT_MS) {
    const decision = await acquireResourceLease({ request, config, databaseFile, hostMemory: observeHostMemory() });
    if (decision.admitted && decision.reservation) {
      lease = decision.reservation;
      result.admitted = true;
      result.queue_wait_ms = Number((performance.now() - queuedAt).toFixed(3));
      result.resource_wait_ms = firstRejection === null ? 0 : Number((performance.now() - firstRejection).toFixed(3));
      break;
    }
    result.retries += 1;
    result.rejection_reason = decision.reason;
    if (firstRejection === null) firstRejection = performance.now();
    if (!["thread_budget_exceeded", "memory_budget_exceeded", "reservation_limit_reached", "host_memory_low"].includes(decision.reason ?? "")) break;
    await delay(25);
  }
  if (!lease) {
    result.status = result.rejection_reason === "host_memory_low" ? "NOT_RUN_FOR_SAFETY" : "ADMISSION_FAILED";
    result.failures = 1;
    result.job_ms = Number((performance.now() - started).toFixed(3));
    result.deadline = performance.now() - queuedAt >= JOB_TIMEOUT_MS ? "JOB_DEADLINE_EXCEEDED" : "NOT_STARTED";
    return result;
  }
  const claimAt = performance.now();
  const manifestPath = path.join(tempRoot, `job-${jobIndex}.json`);
  fs.writeFileSync(manifestPath, JSON.stringify([{ image_path: imagePath }]));
  const scope = `phase7-load-${jobIndex}-${process.pid}`;
  const heartbeatTimer = setInterval(() => {
    if (!lease) return;
    void heartbeatResourceLease({ reservation: lease, config, databaseFile, hostMemory: observeHostMemory() }).then((heartbeat) => { if (heartbeat.changed) result.heartbeat_count += 1; });
  }, 5_000);
  result.deadline = `deadline_${JOB_TIMEOUT_MS}ms_enforced_from_queue_claim`;
  try {
    await withProcessTreeScope(scope, () => new Promise<void>((resolve) => {
      const modelStartedAt = performance.now();
      result.claim_to_start_ms = Number((modelStartedAt - claimAt).toFixed(3));
      result.model_started = true;
      const child = spawn(PYTHON, ["-I", "-s", BATCH_SCRIPT, MODEL_DIR, manifestPath, "--threads", "4"], { cwd: ROOT, env: buildThreadGovernedEnv(4), stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      trackChildProcess(child, scope);
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let peakWorking: number | null = null;
      let peakPrivate: number | null = null;
      let peakCpu: number | null = null;
      let peakThreads: number | null = null;
      const sample = () => {
        const current = snapshot(child.pid);
        if (!current) return;
        peakWorking = Math.max(peakWorking ?? 0, current.working);
        peakPrivate = Math.max(peakPrivate ?? 0, current.privateBytes);
        peakCpu = Math.max(peakCpu ?? 0, current.cpu);
        peakThreads = Math.max(peakThreads ?? 0, current.threads);
      };
      const interval = setInterval(sample, SAMPLE_MS);
      sample();
      const timer = setTimeout(() => { timedOut = true; killTree(child); void terminateTrackedProcessTrees(scope); }, JOB_TIMEOUT_MS);
      child.stdout?.on("data", (chunk: Buffer | string) => { stdout += chunk.toString().slice(0, 2_000_000 - stdout.length); });
      child.stderr?.on("data", (chunk: Buffer | string) => { stderr = (stderr + chunk.toString()).slice(-2_000); });
      const finish = (code: number | null) => {
        clearTimeout(timer); clearInterval(interval); sample();
        const payload = parseJson(stdout);
        result.model_finished = code === 0;
        result.service_ms = Number((performance.now() - modelStartedAt).toFixed(3));
        result.output_valid = code === 0 && payload?.batch_status === "complete";
        result.timed_out = timedOut;
        result.failures = result.output_valid ? 0 : 1;
        result.status = result.output_valid ? "COMPLETED" : timedOut ? "JOB_DEADLINE_EXCEEDED" : `FAILED_${code ?? "UNKNOWN"}`;
        result.peak_working_set_bytes = peakWorking;
        result.peak_private_bytes = peakPrivate;
        result.peak_cpu_seconds = peakCpu;
        result.peak_thread_count = peakThreads;
        if (!result.output_valid && stderr) result.rejection_reason = stderr.trim().slice(-300);
        resolve();
      };
      child.once("error", () => finish(null));
      child.once("close", (code) => finish(code));
    }));
  } finally {
    clearInterval(heartbeatTimer);
    try { fs.unlinkSync(manifestPath); } catch { /* contained scratch cleanup is best effort */ }
    await releaseResourceLease({ reservation: lease, config, databaseFile, hostMemory: observeHostMemory() });
    result.job_ms = Number((performance.now() - started).toFixed(3));
  }
  return result;
}

function summary(values: number[]) {
  const valid = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!valid.length) return { count: 0, p50: null, p95: null, max: null };
  return { count: valid.length, p50: valid[Math.floor((valid.length - 1) * 0.5)], p95: valid[Math.floor((valid.length - 1) * 0.95)], max: valid[valid.length - 1] };
}

async function runPoint(requested: number, images: string[], root: string) {
  const pointRoot = fs.mkdtempSync(path.join(root, `point-${requested}-`));
  const databaseFile = path.join(pointRoot, "resource.db");
  const selectedImages = images.slice(0, requested);
  const started = performance.now();
  try {
    const jobs = await Promise.all(selectedImages.map((image, index) => runModelProbe(index, databaseFile, image, null as unknown as ResourceLeaseHandle, pointRoot)));
    const completed = jobs.filter((job) => job.status === "COMPLETED");
    return {
      requested,
      queued_jobs: selectedImages.length,
      completed_jobs: completed.length,
      failed_jobs: jobs.filter((job) => job.failures > 0).length,
      timed_out_jobs: jobs.filter((job) => job.timed_out).length,
      total_ms: Number((performance.now() - started).toFixed(3)),
      throughput_jobs_per_second: Number((completed.length / Math.max(0.001, (performance.now() - started) / 1000)).toFixed(4)),
      queue_wait_ms: summary(jobs.map((job) => job.queue_wait_ms)),
      claim_to_start_ms: summary(jobs.map((job) => job.claim_to_start_ms)),
      resource_wait_ms: summary(jobs.map((job) => job.resource_wait_ms)),
      service_latency_ms: summary(jobs.filter((job) => job.model_started).map((job) => job.service_ms)),
      job_completion_ms: summary(jobs.map((job) => job.job_ms)),
      peak_working_set_bytes: jobs.length ? Math.max(...jobs.map((job) => job.peak_working_set_bytes ?? 0)) : null,
      peak_private_bytes: jobs.length ? Math.max(...jobs.map((job) => job.peak_private_bytes ?? 0)) : null,
      peak_cpu_seconds: jobs.length ? Math.max(...jobs.map((job) => job.peak_cpu_seconds ?? 0)) : null,
      peak_thread_count: jobs.length ? Math.max(...jobs.map((job) => job.peak_thread_count ?? 0)) : null,
      retries: jobs.reduce((sum, job) => sum + job.retries, 0),
      deadlines: Object.fromEntries(jobs.reduce((counts, job) => counts.set(job.deadline, (counts.get(job.deadline) ?? 0) + 1), new Map<string, number>())),
      jobs: jobs.map((job) => ({ ...job, rejection_reason: job.rejection_reason && job.rejection_reason.length > 80 ? "PROVIDER_DIAGNOSTIC_REDACTED" : job.rejection_reason })),
    };
  } finally {
    fs.rmSync(pointRoot, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  ensureDirs();
  const images = csvImages();
  const outputPath = path.join(ROOT, "docs", "generated", "phase7-real-load.json");
  if (images.length < Math.max(...POINTS) || !fs.existsSync(PYTHON) || !fs.existsSync(BATCH_SCRIPT) || !fs.existsSync(path.join(MODEL_DIR, "model.safetensors"))) {
    const result = { schema_version: "visionscan-phase7-real-load-v1", status: "NOT_MEASURED", reason: "real lesion model inputs unavailable", phi_included: false };
    fs.mkdirSync(path.dirname(outputPath), { recursive: true }); fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8"); process.stdout.write(`${JSON.stringify(result)}\n`); return;
  }
  const points = [];
  for (const requested of POINTS) points.push(await runPoint(requested, images, os.tmpdir()));
  const output = {
    schema_version: "visionscan-phase7-real-load-v1",
    observed_at: new Date().toISOString(),
    status: points.every((point) => point.completed_jobs === point.queued_jobs) ? "MEASURED_BOUNDED_SINGLE_WORKER_LOAD" : "PARTIAL_BOUNDED_SINGLE_WORKER_LOAD",
    worker_mode: "ONE_NODE_WORKER_WITH_DURABLE_SQLITE_SINGLE_SLOT",
    model: { model_id: MODEL_ID, artifact_sha256: sha256(path.join(MODEL_DIR, "model.safetensors")), execution: "ONE_REAL_PYTHON_BATCH_PROBE_PER_QUEUED_JOB; SERIALIZED_BY_LEASE" },
    config: { memory_bytes: config.memoryBytes, threads: config.threads, headroom_bytes: config.headroomBytes, lease_ms: config.leaseMs, max_active_leases: config.maxActiveLeases, job_deadline_ms: JOB_TIMEOUT_MS, sampling_interval_ms: SAMPLE_MS },
    host_memory_at_report: observeHostMemory(),
    points,
    two_worker_decision: { status: "NOT_RUN_FOR_SAFETY", reason: "Single-slot policy and observed lesion working-set cost require a separate reviewed multi-worker decision; the real cross-process admission race is reported separately." },
    phi_included: false,
    limitations: [
      "Each queued job starts a fresh isolated lesion Python process; this is a real serialized load curve, not a resident-model throughput claim.",
      "Resource metrics are best-effort Windows process-tree observations and do not provide OS-level memory enforcement.",
      "The input images are de-identified/public research inputs; no image, patient, or case identifier is written to this result.",
      "The two-worker model load was not run because this workstation and policy do not establish safe duplicated heavy-model headroom.",
    ],
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true }); fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ status: output.status, output: path.relative(ROOT, outputPath), points: points.length }, null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : error}\n`); process.exitCode = 1; });
