#!/usr/bin/env node

/**
 * Phase 10 real OS-crash/restart matrix.
 *
 * Each row creates a fresh temporary SQLite workspace, starts the actual
 * external worker, terminates that worker from the selected persistence seam,
 * waits for its lease to expire, and starts the actual worker again. The
 * parent process cleans any surviving descendants with taskkill /T /F. No
 * patient data is read; the only input is the committed synthetic/public
 * example fundus image.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(ROOT, "docs", "generated", "phase10-crash-matrix.json");
const VITE_NODE = path.join(ROOT, "node_modules", "vite-node", "vite-node.mjs");
const FIXTURE = path.join(ROOT, "scripts", "phase10-worker-fixture.ts");
const SOURCE_IMAGE = path.join(ROOT, "scratch", "test_images", "example_fundus.jpg");
const LEASE_MS = 1_000;
const RESTART_WAIT_MS = 2_500;
const WORKER_TIMEOUT_MS = 12 * 60 * 1_000;
const STAGES = [
  "BEFORE_MODEL_RESULT_WRITE",
  "AFTER_MODEL_RESULT_WRITE",
  "BEFORE_EVIDENCE_COMMIT",
  "AFTER_EVIDENCE_COMMIT",
  "BEFORE_REPORT_COMMIT",
  "AFTER_REPORT_COMMIT",
  "BEFORE_JOB_COMPLETE",
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function baseEnvironment(dataRoot, extra = {}) {
  return {
    ...process.env,
    PROJECT_ROOT: ROOT,
    DATA_ROOT: dataRoot,
    UPLOAD_ROOT: path.join(dataRoot, "uploads"),
    DOCUMENTS_ROOT: path.join(dataRoot, "documents"),
    PROCESSED_ROOT: path.join(dataRoot, "processed"),
    REPORT_ROOT: path.join(dataRoot, "reports"),
    DATABASE_ROOT: path.join(dataRoot, "database"),
    DATABASE_FILE: path.join(dataRoot, "database", "eye-ai.db"),
    LEGACY_DATABASE_FILE: path.join(dataRoot, "database", "eye-ai.json"),
    LOG_ROOT: path.join(dataRoot, "logs"),
    TMP_ROOT: path.join(dataRoot, "tmp"),
    MODEL_ROOT: path.join(ROOT, "data", "models"),
    VISIONSCAN_PERSISTENCE_BACKEND: "sqlite",
    NODE_ENV: "test",
    VISIONSCAN_TEST_ISOLATED: "1",
    DEMO_MODE: "false",
    VISIONSCAN_EXTERNAL_WORKER: "true",
    VISIONSCAN_WORKER_ONCE: "1",
    VISIONSCAN_JOB_LEASE_MS: String(LEASE_MS),
    VISIONSCAN_JOB_HEARTBEAT_MS: "250",
    VISIONSCAN_JOB_HEARTBEAT_GRACE_MS: "500",
    VISIONSCAN_JOB_RETRY_BACKOFF_MS: "0",
    VISIONSCAN_MODEL_MEMORY_BUDGET_BYTES: String(2 * 1024 ** 3),
    VISIONSCAN_MODEL_THREAD_BUDGET: "4",
    VISIONSCAN_RESOURCE_HEADROOM_BYTES: "0",
    VISIONSCAN_RESOURCE_LEASE_MS: "1000",
    VISIONSCAN_RESOURCE_MAX_ACTIVE_LEASES: "1",
    VISIONSCAN_MAX_QUEUE_WAIT_MS: "120000",
    VISIONSCAN_MAX_SERVICE_TIME_MS: "600000",
    VISIONSCAN_MAX_TOTAL_AGE_MS: "720000",
    ...extra,
  };
}

function runVite(args, env, timeoutMs = WORKER_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [VITE_NODE, ...args], {
      cwd: ROOT,
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.on("data", (chunk) => { stdout += String(chunk).slice(-800_000); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk).slice(-800_000); });
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: null, signal: null, stdout, stderr: `${stderr}\n${error.message}`, timedOut, duration_ms: Date.now() - started, pid: child.pid });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, timedOut, duration_ms: Date.now() - started, pid: child.pid });
    });
  });
}

function parseLastJson(text) {
  for (const line of String(text ?? "").trim().split(/\r?\n/).reverse()) {
    try { return JSON.parse(line); } catch { /* diagnostic line */ }
  }
  return null;
}

function killTree(pid) {
  if (!pid) return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    killer.unref?.();
  } else {
    try { process.kill(pid, "SIGKILL"); } catch { /* already exited */ }
  }
}

function queryDescendants(pid) {
  if (process.platform !== "win32" || !pid) return Promise.resolve(null);
  const command = "$root=" + String(pid) + ";$q=New-Object 'System.Collections.Generic.Queue[int]';$q.Enqueue($root);$ids=New-Object 'System.Collections.Generic.HashSet[int]';while($q.Count -gt 0){$id=$q.Dequeue();if(-not $ids.Add($id)){continue};Get-CimInstance Win32_Process -Filter ('ParentProcessId = ' + $id) -ErrorAction SilentlyContinue|ForEach-Object{$q.Enqueue([int]$_.ProcessId)}};$children=@($ids|Where-Object{$_ -ne $root});if($children.Count -eq 0){'[]'}else{$children|ConvertTo-Json -Compress}";
  return new Promise((resolve) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += String(chunk); });
    child.on("close", () => {
      try {
        const parsed = JSON.parse(output.trim() || "[]");
        resolve(Array.isArray(parsed) ? parsed.map((value) => Number(value)).filter(Number.isFinite) : parsed ? [Number(parsed)] : []);
      } catch {
        resolve(null);
      }
    });
    child.on("error", () => resolve(null));
  });
}

function stageResult(stage, seed, crash, inspect, dataRoot, descendantsAfterKill) {
  const observed = crash.stderr.includes("phase10_real_os_crash") || crash.stdout.includes("phase10_real_os_crash");
  const job = inspect?.job ?? null;
  const effectCounts = inspect?.effect_counts ?? {};
  const duplicateFree = Object.values(effectCounts).every((count) => Number(count) <= 1);
  const completed = job?.status === "completed";
  const descendantsAbsent = Array.isArray(descendantsAfterKill) && descendantsAfterKill.length === 0;
  return {
    stage,
    evidence_classification: "REAL_OS_CRASH + REAL_WORKER",
    status: observed && completed && duplicateFree && inspect?.report_export_present && descendantsAbsent ? "PASS" : "PARTIAL",
    crash_observed: observed,
    initial_worker_exit: { code: crash.code, signal: crash.signal, timed_out: crash.timedOut, duration_ms: crash.duration_ms },
    restart: {
      status: completed ? "COMPLETED" : job?.status ?? "NOT_OBSERVED",
      attempts: job?.attempts ?? null,
      error: job?.error ?? null,
      progress: job?.progress ?? null,
      resource_reservation_state: job?.resource_reservation_state ?? null,
      resource_rejection_reason: job?.resource_rejection_reason ?? null,
      report_sealed: inspect?.report_sealed ?? false,
      report_export_present: inspect?.report_export_present ?? false,
    },
    canonical_effects: {
      counts: effectCounts,
      duplicate_free: duplicateFree,
      job_completion_count: Number(effectCounts.JOB_COMPLETION ?? 0),
    },
    physical_execution_observation: {
      worker_attempts: job?.attempts ?? null,
      model_execution_ledger_rows: inspect?.analysis_ledger_rows ?? null,
      exact_provider_invocation_count: "NOT_MEASURED",
      note: "The durable attempt count proves at-least-once worker execution; the current model ledger is immutable and does not expose a per-provider invocation counter.",
    },
    cleanup: {
      parent_taskkill_tree_requested: process.platform === "win32",
      descendants_absent_after_termination: descendantsAfterKill === null ? "NOT_MEASURED" : descendantsAbsent,
      remaining_descendant_pids: descendantsAfterKill,
      temporary_workspace: path.basename(dataRoot),
      phi_included: false,
    },
    seed: { status: seed.code === 0 ? "OK" : "FAILED", duration_ms: seed.duration_ms },
  };
}

async function runStage(stage) {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "visionscan-phase10-crash-"));
  const env = baseEnvironment(dataRoot, {
    PHASE10_SOURCE_IMAGE: SOURCE_IMAGE,
    VISIONSCAN_PHASE9_FAULT_INJECTION: stage,
    VISIONSCAN_PHASE10_REAL_OS_CRASH: "1",
    VISIONSCAN_WORKER_ID: `phase10-crash-${stage.toLowerCase()}`,
  });
  const seed = await runVite([FIXTURE, "seed"], env);
  const seedPayload = parseLastJson(seed.stdout);
  if (seed.code !== 0 || !seedPayload?.study_id || !seedPayload?.job_id) {
    return stageResult(stage, seed, { code: null, signal: null, stdout: "", stderr: "seed failed", timedOut: false, duration_ms: 0 }, null, dataRoot, []);
  }
  const crash = await runVite([path.join(ROOT, "scripts", "worker.ts")], env);
  // Windows does not automatically kill an orphaned child when the parent
  // receives SIGKILL. The explicit tree request makes descendant absence an
  // observed post-condition of every matrix row.
  killTree(crash.pid);
  await sleep(750);
  const descendantsAfterKill = await queryDescendants(crash.pid);
  await sleep(Math.max(0, RESTART_WAIT_MS - 750));
  const restartEnv = baseEnvironment(dataRoot, {
    PHASE10_STUDY_ID: seedPayload.study_id,
    VISIONSCAN_PHASE9_FAULT_INJECTION: "",
    VISIONSCAN_PHASE10_REAL_OS_CRASH: "0",
    VISIONSCAN_WORKER_ID: `phase10-restart-${stage.toLowerCase()}`,
    VISIONSCAN_WORKER_ONCE: "1",
  });
  const restart = await runVite([path.join(ROOT, "scripts", "worker.ts")], restartEnv);
  killTree(restart.pid);
  const inspectResult = await runVite([FIXTURE, "inspect"], { ...restartEnv, VISIONSCAN_WORKER_ONCE: "" }, 120_000);
  const inspect = parseLastJson(inspectResult.stdout);
  const result = stageResult(stage, seed, crash, inspect, dataRoot, descendantsAfterKill);
  result.restart.worker_exit = { code: restart.code, signal: restart.signal, timed_out: restart.timedOut, duration_ms: restart.duration_ms };
  result.inspect_exit = inspectResult.code;
  result.diagnostics = {
    crash_stderr_marker: crash.stderr.includes("phase10_real_os_crash"),
    restart_stderr_tail: String(restart.stderr).slice(-2_000),
    inspect_stderr_tail: String(inspectResult.stderr).slice(-2_000),
  };
  fs.rmSync(dataRoot, { recursive: true, force: true });
  return result;
}

async function main() {
  const onlyIndex = process.argv.indexOf("--stage");
  const requestedStage = onlyIndex >= 0 ? process.argv[onlyIndex + 1] : null;
  const stagesToRun = requestedStage ? STAGES.filter((stage) => stage === requestedStage) : STAGES;
  if (requestedStage && stagesToRun.length === 0) throw new Error(`Unknown Phase 10 crash stage: ${requestedStage}`);
  const common = {
    schema_version: "visionscan-phase10-crash-matrix-v1",
    observed_at: new Date().toISOString(),
    platform: process.platform,
    node_version: process.version,
    worker_script: "scripts/worker.ts",
    fault_seams: stagesToRun,
    input_scope: "one synthetic/public example_fundus.jpg per isolated temporary SQLite workspace",
    lease_policy: { lease_ms: LEASE_MS, heartbeat_ms: 250, heartbeat_grace_ms: 500, retry_backoff_ms: 0 },
    phi_included: false,
  };
  if (process.platform !== "win32" || !fs.existsSync(SOURCE_IMAGE) || !fs.existsSync(VITE_NODE)) {
    const result = { ...common, status: "NOT_MEASURED", reason: "Windows, the local public/synthetic fixture, or vite-node is unavailable.", stages: [] };
    fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
    fs.writeFileSync(OUTPUT, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(result));
    return;
  }
  const stages = [];
  for (const stage of stagesToRun) {
    console.log(JSON.stringify({ event: "phase10_crash_stage_start", stage }));
    stages.push(await runStage(stage));
  }
  const result = {
    ...common,
    status: stages.every((stage) => stage.status === "PASS") ? "PASS_REAL_OS_CRASH_RESTART_MATRIX" : "PARTIAL_REAL_OS_CRASH_RESTART_MATRIX",
    stages,
    limitations: [
      "The harness proves the selected application publication seams and SQLite restart path on this Windows host; it is not a proof of every OS or launcher failure mode.",
      "A durable worker-attempt count is available, but the current immutable model ledger does not expose an exact provider invocation counter.",
      "The test input is a public/synthetic example image and no patient identifiers are persisted in the evidence envelope.",
    ],
  };
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ status: result.status, output: path.relative(ROOT, OUTPUT), stages: stages.length }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
