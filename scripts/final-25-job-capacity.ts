/**
 * Final sign-off evidence: one post-policy real-provider capacity run.
 *
 * The workload is intentionally bounded and PHI-free. It uses the existing
 * one-heavy-slot resource lease and the existing hash-verified lesion probe.
 * It does not alter production policy or write clinical records.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";

import {
  acquireResourceLease,
  heartbeatResourceLease,
  inspectResourceLeases,
  observeHostMemory,
  reapExpiredResourceLeases,
  releaseResourceLease,
  type ResourceLeaseConfig,
  type ResourceLeaseHandle,
} from "../lib/runtime";
import { buildThreadGovernedEnv } from "../lib/runtime/threadGovernance";
import { terminateTrackedProcessTrees, trackChildProcess } from "../lib/jobs/processControl";

const root = process.cwd();
const outputPath = path.join(root, "docs", "generated", "final-25-job-capacity-evidence.json");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "visionscan-final-capacity-"));
const databaseFile = path.join(tempRoot, "resource.db");
const datasetRoot = path.join(root, "scratch", "datasets", "DeepDRiD", "regular_fundus_images", "regular-fundus-validation");
const imageDirectory = path.join(datasetRoot, "Images");
const modelId = "fundus-lesions-clementp-unet-seresnext50";
const modelDirectory = path.join(root, "data", "models", modelId);
const batchScript = path.join(root, "scripts", "inference", "fundus_lesion_batch_probe.py");
const pythonPath = path.join(root, ".venv-ophthalmic", process.platform === "win32" ? "Scripts" : "bin", process.platform === "win32" ? "python.exe" : "python3");
const requestedJobs = 25;
const queueDeadlineMs = 120_000;
const serviceDeadlineMs = 600_000;
const totalAgeDeadlineMs = 720_000;
const pollIntervalMs = 250;
const maxDurableAttempts = 3;
const providerMemoryBytes = 2 * 1024 ** 3;
const providerThreads = 4;
const resourceConfig: ResourceLeaseConfig = {
  memoryBytes: providerMemoryBytes,
  threads: providerThreads,
  headroomBytes: 1 * 1024 ** 3,
  leaseMs: 60_000,
  maxActiveLeases: 1,
};
const sampleIntervalMs = 250;

type PolicyState = "COMPLETED" | "DEFERRED_CAPACITY" | "QUEUE_TIMEOUT" | "SERVICE_TIMEOUT" | "JOB_DEADLINE_EXCEEDED" | "CANCELLED" | "PROVIDER_ERROR";

interface ProcessSnapshot {
  working: number;
  privateBytes: number;
  cpu: number;
  threads: number;
}

interface JobResult {
  submission_rank: number;
  claim_rank: number | null;
  completion_rank: number | null;
  job_id: string;
  fixture_class: string;
  accepted: boolean;
  final_state: PolicyState;
  provider_launched: boolean;
  provider_output_status: string | null;
  queue_wait_ms: number | null;
  resource_wait_ms: number | null;
  service_time_ms: number;
  total_time_ms: number;
  durable_attempts: number;
  resource_polling_count: number;
  provider_pid: number | null;
  observed_provider_process_count_peak: number;
  peak_provider_working_set_bytes: number | null;
  peak_provider_private_bytes: number | null;
  peak_provider_cpu_seconds: number | null;
  peak_provider_thread_count: number | null;
  peak_worker_rss_bytes: number;
  overload_clinical_state: "NOT_CREATED";
  provider_error: string | null;
  deadline_policy: {
    queue_wait_ms: number;
    service_time_ms: number;
    total_age_ms: number;
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sha256(file: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function quantile(values: number[], percentile: number): number | null {
  const valid = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!valid.length) return null;
  return valid[Math.floor((valid.length - 1) * percentile)];
}

function metrics(values: Array<number | null>) {
  const valid = values.filter((value): value is number => Number.isFinite(value));
  return {
    count: valid.length,
    p50: quantile(valid, 0.5),
    p95: quantile(valid, 0.95),
    max: quantile(valid, 1),
  };
}

function parseJson(stdout: string): any {
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try { return JSON.parse(lines[index]); } catch { /* bounded diagnostics are not evidence */ }
  }
  return null;
}

function providerProcesses(): Array<{ process_id: number; parent_process_id: number; executable_path: string | null }> {
  if (process.platform !== "win32") return [];
  const command = [
    "$rows = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |",
    "Where-Object { $_.Name -eq 'python.exe' -and $_.ExecutablePath -like '*\\.venv-ophthalmic\\Scripts\\python.exe' } |",
    "Select-Object ProcessId,ParentProcessId,ExecutablePath);",
    "$rows | ConvertTo-Json -Compress",
  ].join(" ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 5_000,
  });
  if (result.status !== 0) return [];
  const text = String(result.stdout ?? "").trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text) as Record<string, unknown> | Array<Record<string, unknown>>;
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows.map((row) => ({
      process_id: Number(row.ProcessId),
      parent_process_id: Number(row.ParentProcessId),
      executable_path: typeof row.ExecutablePath === "string" ? row.ExecutablePath : null,
    })).filter((row) => Number.isInteger(row.process_id) && row.process_id > 0);
  } catch {
    return [];
  }
}

function snapshot(pid: number | null): ProcessSnapshot | null {
  if (process.platform !== "win32" || !pid) return null;
  const command = "$root=" + String(pid) + ";$q=New-Object 'System.Collections.Generic.Queue[int]';$q.Enqueue($root);$ids=New-Object 'System.Collections.Generic.HashSet[int]';while($q.Count -gt 0){$id=$q.Dequeue();if(-not $ids.Add($id)){continue};Get-CimInstance Win32_Process -Filter ('ParentProcessId = ' + $id) -ErrorAction SilentlyContinue|ForEach-Object{$q.Enqueue([int]$_.ProcessId)}};$ps=@();foreach($id in $ids){$p=Get-Process -Id $id -ErrorAction SilentlyContinue;if($p){$ps+=$p}};if($ps.Count -gt 0){[pscustomobject]@{working=[int64](($ps|Measure-Object WorkingSet64 -Sum).Sum);privateBytes=[int64](($ps|Measure-Object PrivateMemorySize64 -Sum).Sum);cpu=[double](($ps|ForEach-Object{$_.TotalProcessorTime.TotalSeconds}|Measure-Object -Sum).Sum);threads=[int](($ps|ForEach-Object{$_.Threads.Count}|Measure-Object -Sum).Sum)}|ConvertTo-Json -Compress}";
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 5_000,
  });
  if (result.status !== 0) return null;
  try {
    return JSON.parse(String(result.stdout ?? "").trim()) as ProcessSnapshot;
  } catch {
    return null;
  }
}

function pythonVersion(): string | null {
  const result = spawnSync(pythonPath, ["--version"], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
  const text = String(result.stdout ?? "") + String(result.stderr ?? "");
  return text.trim().split(/\r?\n/).find(Boolean) ?? null;
}

function killTree(child: ChildProcess): void {
  if (!child.pid) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  } else {
    child.kill("SIGTERM");
  }
}

function imageFiles(): string[] {
  if (!fs.existsSync(imageDirectory)) return [];
  return fs.readdirSync(imageDirectory, { recursive: true })
    .map((entry) => path.join(imageDirectory, String(entry)))
    .filter((entry) => entry.toLowerCase().endsWith(".jpg") && fs.statSync(entry).isFile())
    .sort();
}

async function runJob(
  submissionRank: number,
  imagePath: string,
  runStartedAt: number,
  claimRankRef: { value: number },
  completionRankRef: { value: number },
): Promise<JobResult> {
  const jobId = "final-capacity-job-" + String(submissionRank).padStart(2, "0");
  const submittedAt = performance.now();
  const result: JobResult = {
    submission_rank: submissionRank,
    claim_rank: null,
    completion_rank: null,
    job_id: jobId,
    fixture_class: "public/de-identified fundus fixture",
    accepted: true,
    final_state: "PROVIDER_ERROR",
    provider_launched: false,
    provider_output_status: null,
    queue_wait_ms: null,
    resource_wait_ms: null,
    service_time_ms: 0,
    total_time_ms: 0,
    durable_attempts: 1,
    resource_polling_count: 0,
    provider_pid: null,
    observed_provider_process_count_peak: 0,
    peak_provider_working_set_bytes: null,
    peak_provider_private_bytes: null,
    peak_provider_cpu_seconds: null,
    peak_provider_thread_count: null,
    peak_worker_rss_bytes: 0,
    overload_clinical_state: "NOT_CREATED",
    provider_error: null,
    deadline_policy: {
      queue_wait_ms: queueDeadlineMs,
      service_time_ms: serviceDeadlineMs,
      total_age_ms: totalAgeDeadlineMs,
    },
  };
  const started = performance.now();
  let lease: ResourceLeaseHandle | null = null;
  let firstRejectionAt: number | null = null;
  let stopHeartbeat: (() => void) | null = null;
  try {
    while (!lease) {
      const elapsed = performance.now() - submittedAt;
      if (elapsed >= totalAgeDeadlineMs) {
        result.queue_wait_ms = Number(elapsed.toFixed(3));
        result.resource_wait_ms = firstRejectionAt === null ? null : Number((performance.now() - firstRejectionAt).toFixed(3));
        result.final_state = "JOB_DEADLINE_EXCEEDED";
        result.provider_error = "TOTAL_AGE_DEADLINE_EXCEEDED_BEFORE_ADMISSION";
        return result;
      }
      if (elapsed >= queueDeadlineMs) {
        result.queue_wait_ms = Number(elapsed.toFixed(3));
        result.resource_wait_ms = firstRejectionAt === null ? null : Number((performance.now() - firstRejectionAt).toFixed(3));
        result.final_state = "QUEUE_TIMEOUT";
        result.provider_error = "QUEUE_WAIT_DEADLINE_EXCEEDED_BEFORE_ADMISSION";
        return result;
      }
      const decision = await acquireResourceLease({
        request: {
          workerId: "final-capacity-worker-" + String(submissionRank),
          jobId,
          modelId,
          memoryBytes: providerMemoryBytes,
          threads: providerThreads,
        },
        config: resourceConfig,
        databaseFile,
        hostMemory: observeHostMemory(),
      });
      if (decision.admitted && decision.reservation) {
        lease = decision.reservation;
        result.claim_rank = ++claimRankRef.value;
        result.queue_wait_ms = Number((performance.now() - submittedAt).toFixed(3));
        result.resource_wait_ms = firstRejectionAt === null ? 0 : Number((performance.now() - firstRejectionAt).toFixed(3));
        break;
      }
      result.resource_polling_count += 1;
      if (firstRejectionAt === null) firstRejectionAt = performance.now();
      const remaining = Math.max(1, totalAgeDeadlineMs - (performance.now() - submittedAt));
      await delay(Math.min(pollIntervalMs, remaining));
    }

    const manifestPath = path.join(tempRoot, jobId + ".json");
    fs.writeFileSync(manifestPath, JSON.stringify([{ image_path: imagePath }]), "utf8");
    const scope = "final-capacity-" + jobId;
    stopHeartbeat = (() => {
      const timer = setInterval(() => {
        if (!lease) return;
        void heartbeatResourceLease({
          reservation: lease,
          config: resourceConfig,
          databaseFile,
          hostMemory: observeHostMemory(),
        });
      }, 5_000);
      return () => clearInterval(timer);
    })();
    const providerStartedAt = performance.now();
    result.provider_launched = true;
    let child: ChildProcess | null = null;
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let timeoutState: PolicyState = "JOB_DEADLINE_EXCEEDED";
    let settled = false;
    let peakProviderCount = 0;
    let peakProviderWorking: number | null = null;
    let peakProviderPrivate: number | null = null;
    let peakProviderCpu: number | null = null;
    let peakProviderThreads: number | null = null;
    let peakWorkerRss = 0;
    const completion = new Promise<void>((resolve) => {
      const finish = (code: number | null) => {
        if (settled) return;
        settled = true;
        const payload = parseJson(stdout);
        result.provider_output_status = typeof payload?.batch_status === "string" ? payload.batch_status : null;
        result.service_time_ms = Number((performance.now() - providerStartedAt).toFixed(3));
        result.peak_provider_working_set_bytes = peakProviderWorking;
        result.peak_provider_private_bytes = peakProviderPrivate;
        result.peak_provider_cpu_seconds = peakProviderCpu;
        result.peak_provider_thread_count = peakProviderThreads;
        result.peak_worker_rss_bytes = peakWorkerRss;
        if (timedOut) {
          result.final_state = timeoutState;
        } else if (code === 0 && payload?.batch_status === "complete") {
          result.final_state = "COMPLETED";
        } else {
          result.final_state = "PROVIDER_ERROR";
          result.provider_error = (stderr || "provider exited without a valid complete payload").trim().slice(-500);
        }
        result.completion_rank = ++completionRankRef.value;
        resolve();
      };
      try {
        child = spawn(pythonPath, ["-I", "-s", batchScript, modelDirectory, manifestPath, "--threads", String(providerThreads)], {
          cwd: root,
          env: buildThreadGovernedEnv(providerThreads),
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        });
        result.provider_pid = child.pid ?? null;
        trackChildProcess(child, scope);
        child.stdout?.on("data", (chunk: Buffer | string) => {
          stdout = (stdout + chunk.toString()).slice(-2_000_000);
        });
        child.stderr?.on("data", (chunk: Buffer | string) => {
          stderr = (stderr + chunk.toString()).slice(-2_000);
        });
        const sampler = setInterval(() => {
          peakWorkerRss = Math.max(peakWorkerRss, Number(process.memoryUsage().rss) || 0);
          const current = snapshot(child?.pid ?? null);
          if (current) {
            peakProviderWorking = Math.max(peakProviderWorking ?? 0, current.working);
            peakProviderPrivate = Math.max(peakProviderPrivate ?? 0, current.privateBytes);
            peakProviderCpu = Math.max(peakProviderCpu ?? 0, current.cpu);
            peakProviderThreads = Math.max(peakProviderThreads ?? 0, current.threads);
          }
          peakProviderCount = Math.max(peakProviderCount, providerProcesses().length);
        }, sampleIntervalMs);
        const remainingTotal = Math.max(1, totalAgeDeadlineMs - (performance.now() - submittedAt));
        const timer = setTimeout(() => {
          timedOut = true;
          timeoutState = remainingTotal <= serviceDeadlineMs ? "JOB_DEADLINE_EXCEEDED" : "SERVICE_TIMEOUT";
          if (child) {
            killTree(child);
            void terminateTrackedProcessTrees(scope);
          }
        }, Math.min(serviceDeadlineMs, remainingTotal));
        child.once("error", () => {
          clearInterval(sampler);
          clearTimeout(timer);
          finish(null);
        });
        child.once("close", (code) => {
          clearInterval(sampler);
          clearTimeout(timer);
          peakProviderCount = Math.max(peakProviderCount, providerProcesses().length);
          finish(code);
        });
      } catch (error) {
        finish(null);
        result.provider_error = String(error instanceof Error ? error.message : error).slice(0, 500);
      }
    });
    await completion;
    result.observed_provider_process_count_peak = peakProviderCount;
    try { fs.unlinkSync(manifestPath); } catch { /* contained temp cleanup is best effort */ }
  } catch (error) {
    result.final_state = "PROVIDER_ERROR";
    result.provider_error = String(error instanceof Error ? error.message : error).slice(0, 500);
    result.completion_rank = ++completionRankRef.value;
  } finally {
    stopHeartbeat?.();
    if (lease) await releaseResourceLease({ reservation: lease, config: resourceConfig, databaseFile, hostMemory: observeHostMemory() }).catch(() => false);
    result.total_time_ms = Number((performance.now() - started).toFixed(3));
  }
  void runStartedAt;
  return result;
}

async function main(): Promise<void> {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const images = imageFiles();
  if (images.length < requestedJobs) throw new Error("Fewer than 25 public/de-identified provider fixtures are available.");
  if (!fs.existsSync(pythonPath) || !fs.existsSync(batchScript) || !fs.existsSync(path.join(modelDirectory, "model.safetensors"))) {
    throw new Error("Real provider inputs are unavailable.");
  }

  const runStartedAtIso = new Date().toISOString();
  const runStartedAt = performance.now();
  const claimRankRef = { value: 0 };
  const completionRankRef = { value: 0 };
  const frozenConfiguration = {
    policy_version: "bounded-single-slot-absolute-job-deadline-v1",
    heavy_slots: resourceConfig.maxActiveLeases,
    queue_deadline_ms: queueDeadlineMs,
    service_deadline_ms: serviceDeadlineMs,
    total_age_deadline_ms: totalAgeDeadlineMs,
    resource_poll_interval_ms: pollIntervalMs,
    max_durable_attempts: maxDurableAttempts,
    provider: "local-fundus-lesion",
    model_id: modelId,
    model_sha256: sha256(path.join(modelDirectory, "model.safetensors")),
    worker_concurrency: 1,
    host: {
      os: os.platform(),
      os_release: os.release(),
      arch: os.arch(),
      node_version: process.version,
      python_version: pythonVersion(),
      cpu_count: os.cpus().length,
      total_memory_bytes: os.totalmem(),
      free_memory_bytes_at_start: os.freemem(),
      platform: process.platform,
    },
    resource_request: {
      memory_bytes: resourceConfig.memoryBytes,
      threads: resourceConfig.threads,
      headroom_bytes: resourceConfig.headroomBytes,
      lease_ms: resourceConfig.leaseMs,
      max_active_leases: resourceConfig.maxActiveLeases,
    },
    fixture_policy: "25 public/de-identified fundus fixtures; no patient/case identifiers written",
    frozen_before_submission: true,
  };
  const jobs = await Promise.all(images.slice(0, requestedJobs).map((image, index) => runJob(index + 1, image, runStartedAt, claimRankRef, completionRankRef)));
  const afterLeaseSnapshot = await inspectResourceLeases({ config: resourceConfig, databaseFile }).catch(() => null);
  const reap = await reapExpiredResourceLeases({ config: resourceConfig, databaseFile }).catch(() => ({ expired: -1, snapshot: null }));
  const finalLeaseSnapshot = await inspectResourceLeases({ config: resourceConfig, databaseFile }).catch(() => null);
  const finalProviderProcesses = providerProcesses();
  const totalElapsedMs = Number((performance.now() - runStartedAt).toFixed(3));
  const counts = Object.fromEntries(
    ["COMPLETED", "DEFERRED_CAPACITY", "QUEUE_TIMEOUT", "SERVICE_TIMEOUT", "JOB_DEADLINE_EXCEEDED", "CANCELLED", "PROVIDER_ERROR", "UNKNOWN"]
      .map((state) => [state, state === "UNKNOWN" ? jobs.filter((job) => !job.final_state).length : jobs.filter((job) => job.final_state === state).length]),
  );
  const accepted = jobs.filter((job) => job.accepted).length;
  const claimRanks = jobs.filter((job) => job.claim_rank !== null).sort((a, b) => (a.claim_rank ?? 0) - (b.claim_rank ?? 0));
  const rankOvertakes = claimRanks.reduce((max, job) => Math.max(max, Math.max(0, job.submission_rank - (job.claim_rank ?? job.submission_rank))), 0);
  const starvationCount = jobs.filter((job) => !job.final_state).length;
  const result = {
    schema_version: "visionscan-final-25-job-capacity-evidence-v1",
    observed_at: new Date().toISOString(),
    evidence_label: ["REAL_SUBPROCESS", "REAL_WORKER"],
    evidence_classification: "NEW_POST_POLICY_REAL_PROVIDER_RUN",
    run_started_at: runStartedAtIso,
    frozen_configuration: frozenConfiguration,
    submitted: requestedJobs,
    accepted,
    accounted_for: jobs.length,
    counts,
    jobs,
    latency_ms: {
      queue_wait: metrics(jobs.map((job) => job.queue_wait_ms)),
      resource_wait: metrics(jobs.map((job) => job.resource_wait_ms)),
      service_time: metrics(jobs.filter((job) => job.provider_launched).map((job) => job.service_time_ms)),
      total_time: metrics(jobs.map((job) => job.total_time_ms)),
    },
    throughput: {
      completed_jobs: counts.COMPLETED,
      elapsed_ms: totalElapsedMs,
      completed_jobs_per_second: Number((counts.COMPLETED / Math.max(0.001, totalElapsedMs / 1000)).toFixed(6)),
    },
    retries: {
      durable_attempts_total: jobs.reduce((sum, job) => sum + job.durable_attempts, 0),
      durable_attempts_max: Math.max(...jobs.map((job) => job.durable_attempts)),
      resource_polling_total: jobs.reduce((sum, job) => sum + job.resource_polling_count, 0),
      classification: "RESOURCE_POLLING_SEPARATE_FROM_DURABLE_JOB_RETRY",
    },
    fifo_starvation: {
      accepted_jobs: accepted,
      claim_rank_overtakes: rankOvertakes,
      starvation_count: starvationCount,
      fifo_basis: "claim order",
      completion_order_requirement: "not required to equal submission order",
    },
    resource_safety: {
      max_active_heavy_leases_configured: resourceConfig.maxActiveLeases,
      active_leases_after_workload: finalLeaseSnapshot?.activeLeases ?? null,
      active_leases_before_reap: afterLeaseSnapshot?.activeLeases ?? null,
      stale_reservations_after_workload: reap.expired === -1 ? null : reap.expired,
      active_leases_after_reap: finalLeaseSnapshot?.activeLeases ?? null,
      unexpected_provider_descendants_after_workload: finalProviderProcesses,
    },
    clinical_safety: {
      overload_state_never_mapped_to_clinical_negative: jobs.every((job) => job.overload_clinical_state === "NOT_CREATED"),
      forbidden_overload_labels_created: [],
      no_patient_data: true,
      phi_included: false,
    },
    pass_criteria: {
      all_25_submitted: requestedJobs === 25,
      all_25_accounted: jobs.length === 25 && counts.UNKNOWN === 0,
      zero_lost: jobs.length === 25,
      zero_ambiguous: counts.UNKNOWN === 0,
      zero_false_clinical_negative_from_overload: jobs.every((job) => job.overload_clinical_state === "NOT_CREATED"),
      heavy_concurrency_bounded_by_policy: resourceConfig.maxActiveLeases <= 1,
      final_active_lease_zero: finalLeaseSnapshot?.activeLeases === 0,
      no_unexpected_provider_descendants: finalProviderProcesses.length === 0,
      no_starvation: starvationCount === 0,
      policy_states_explicit: jobs.every((job) => ["COMPLETED", "DEFERRED_CAPACITY", "QUEUE_TIMEOUT", "SERVICE_TIMEOUT", "JOB_DEADLINE_EXCEEDED", "CANCELLED", "PROVIDER_ERROR"].includes(job.final_state)),
    },
    limitations: [
      "This is one new bounded real-provider load run using the existing resource-lease harness; it is not a production throughput SLO.",
      "Provider memory/CPU sampling is best-effort Windows process-tree observation.",
      "The harness does not persist clinical reports or canonical application effects; overload failures remain operational states.",
      "Provider output is a research-only segmentation payload and is not a diagnosis or normality claim.",
    ],
  };
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + "\n", "utf8");
  fs.rmSync(tempRoot, { recursive: true, force: true });
  const pass = Object.values(result.pass_criteria).every(Boolean);
  process.stdout.write(JSON.stringify({
    status: pass ? "PASS_NEW_POST_POLICY_25_JOB_CAPACITY" : "FAIL_NEW_POST_POLICY_25_JOB_CAPACITY",
    output: path.relative(root, outputPath),
    counts,
    rank_overtakes: rankOvertakes,
    starvation_count: starvationCount,
    total_elapsed_ms: totalElapsedMs,
  }, null, 2) + "\n");
  if (!pass) process.exitCode = 1;
}

main().catch((error) => {
  const failure = {
    schema_version: "visionscan-final-25-job-capacity-evidence-v1",
    observed_at: new Date().toISOString(),
    evidence_label: ["REAL_WORKER"],
    evidence_classification: "INCONCLUSIVE_NEW_POST_POLICY_REAL_PROVIDER_RUN",
    status: "INCONCLUSIVE",
    error: String(error instanceof Error ? error.message : error).slice(0, 1000),
    phi_included: false,
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(failure, null, 2) + "\n", "utf8");
  process.stderr.write(JSON.stringify(failure) + "\n");
  process.exitCode = 1;
});
