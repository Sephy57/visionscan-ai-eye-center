#!/usr/bin/env node

/** Measure active-provider and resource-wait deadlines with real worker processes. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(ROOT, "docs", "generated", "phase11-deadline-evidence.json");
const VITE_NODE = path.join(ROOT, "node_modules", "vite-node", "vite-node.mjs");
const FIXTURE = path.join(ROOT, "scripts", "phase10-worker-fixture.ts");
const SOURCE_IMAGE = path.join(ROOT, "scratch", "test_images", "example_fundus.jpg");
const ACTIVE_DEADLINE_MS = 6_000;
const WAIT_DEADLINE_MS = 1_500;
const LONG_DEADLINE_MS = 600_000;
const WORKER_TIMEOUT_MS = 12 * 60 * 1_000;

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
    VISIONSCAN_JOB_LEASE_MS: "60000",
    VISIONSCAN_JOB_HEARTBEAT_MS: "250",
    VISIONSCAN_JOB_HEARTBEAT_GRACE_MS: "500",
    VISIONSCAN_JOB_RETRY_BACKOFF_MS: "0",
    VISIONSCAN_MODEL_MEMORY_BUDGET_BYTES: String(2 * 1024 ** 3),
    VISIONSCAN_MODEL_THREAD_BUDGET: "4",
    VISIONSCAN_RESOURCE_HEADROOM_BYTES: "0",
    VISIONSCAN_RESOURCE_LEASE_MS: "60000",
    VISIONSCAN_RESOURCE_MAX_ACTIVE_LEASES: "1",
    VISIONSCAN_RESOURCE_WAIT_POLL_MS: "100",
    VISIONSCAN_MAX_QUEUE_WAIT_MS: "120000",
    VISIONSCAN_MAX_SERVICE_TIME_MS: "600000",
    VISIONSCAN_MAX_TOTAL_AGE_MS: "720000",
    ...extra,
  };
}

function parseLastJson(text) {
  for (const line of String(text ?? "").trim().split(/\r?\n/).reverse()) {
    try { return JSON.parse(line); } catch { /* diagnostic line */ }
  }
  return null;
}

function queryDescendants(pid) {
  if (process.platform !== "win32" || !pid) return Promise.resolve(null);
  const command = "$root=" + String(pid) + ";$q=New-Object 'System.Collections.Generic.Queue[int]';$q.Enqueue($root);$ids=New-Object 'System.Collections.Generic.HashSet[int]';while($q.Count -gt 0){$id=$q.Dequeue();if(-not $ids.Add($id)){continue};Get-CimInstance Win32_Process -Filter ('ParentProcessId = ' + $id) -ErrorAction SilentlyContinue|ForEach-Object{$q.Enqueue([int]$_.ProcessId)}};$children=@($ids|Where-Object{$_ -ne $root});$details=@($children|ForEach-Object{Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $_) -ErrorAction SilentlyContinue|Select-Object ProcessId,Name,CommandLine});if($details.Count -eq 0){'[]'}else{$details|ConvertTo-Json -Compress}";
  return new Promise((resolve) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += String(chunk); });
    child.on("close", () => {
      try {
        const parsed = JSON.parse(output.trim() || "[]");
        const rows = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
        resolve(rows.map((row) => ({ pid: Number(row.ProcessId), name: String(row.Name ?? ""), command_line: String(row.CommandLine ?? "") })).filter((row) => Number.isFinite(row.pid)));
      } catch { resolve(null); }
    });
    child.on("error", () => resolve(null));
  });
}

function killTree(pid) {
  if (!pid) return Promise.resolve();
  return new Promise((resolve) => {
    const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    killer.once("close", resolve);
    killer.once("error", resolve);
  });
}

function startVite(args, env, timeoutMs = WORKER_TIMEOUT_MS) {
  const child = spawn(process.execPath, [VITE_NODE, ...args], { cwd: ROOT, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const started = Date.now();
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  child.stdout.on("data", (chunk) => { stdout = (stdout + String(chunk)).slice(-800_000); });
  child.stderr.on("data", (chunk) => { stderr = (stderr + String(chunk)).slice(-800_000); });
  const done = new Promise((resolve) => {
    const timer = setTimeout(() => {
      timedOut = true;
      void killTree(child.pid);
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: null, signal: null, stdout, stderr: `${stderr}\n${error.message}`, timedOut, pid: child.pid, duration_ms: Date.now() - started });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, timedOut, pid: child.pid, duration_ms: Date.now() - started });
    });
  });
  return { child, done };
}

async function runVite(args, env, timeoutMs = WORKER_TIMEOUT_MS) {
  return (await startVite(args, env, timeoutMs)).done;
}

async function observeDescendants(control, timeoutMs = 10_000) {
  const observations = [];
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const descendants = await queryDescendants(control.child.pid);
    observations.push({ at_ms: Date.now() - started, descendants });
    if (Array.isArray(descendants) && descendants.some(isProviderProcess)) return observations;
    const finished = await Promise.race([control.done.then(() => true), sleep(150).then(() => false)]);
    if (finished) break;
  }
  return observations;
}

function inspectResult(dataRoot, studyId, env) {
  return runVite([FIXTURE, "inspect"], { ...env, PHASE10_STUDY_ID: studyId, VISIONSCAN_PHASE9_FAULT_INJECTION: "", VISIONSCAN_PHASE11_REAL_POST_TERMINAL_CRASH: "0" }, 120_000);
}

function jobOutcome(inspect) {
  return {
    job: inspect?.job ?? null,
    counts: inspect?.counts ?? null,
    effect_counts: inspect?.effect_counts ?? null,
    resource_leases: inspect?.resource_leases ?? null,
    report_sealed: inspect?.report_sealed ?? false,
    report_export_present: inspect?.report_export_present ?? false,
  };
}

function isProviderProcess(row) {
  return /python|probe\.py|\.venv-ophthalmic/i.test(`${row?.name ?? ""} ${row?.command_line ?? ""}`);
}

async function seed(env) {
  const result = await runVite([FIXTURE, "seed"], env, 120_000);
  return { process: result, payload: parseLastJson(result.stdout) };
}

async function main() {
  const common = {
    schema_version: "visionscan-phase11-deadline-evidence-v1",
    observed_at: new Date().toISOString(),
    platform: process.platform,
    node_version: process.version,
    worker_script: "scripts/worker.ts",
    input_scope: "synthetic/public example_fundus.jpg in isolated temporary SQLite workspaces",
    phi_included: false,
  };
  if (process.platform !== "win32" || !fs.existsSync(SOURCE_IMAGE) || !fs.existsSync(VITE_NODE)) {
    const result = { ...common, status: "NOT_MEASURED", reason: "Windows, the local synthetic fixture, or vite-node is unavailable." };
    fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
    fs.writeFileSync(OUTPUT, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(result));
    return;
  }

  const activeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "visionscan-phase11-active-deadline-"));
  const waitRoot = fs.mkdtempSync(path.join(os.tmpdir(), "visionscan-phase11-resource-wait-"));
  try {
    const activeEnv = baseEnvironment(activeRoot, {
      PHASE10_SOURCE_IMAGE: SOURCE_IMAGE,
      VISIONSCAN_OVERALL_JOB_DEADLINE_MS: String(ACTIVE_DEADLINE_MS),
      VISIONSCAN_WORKER_ID: "phase11-active-deadline",
    });
    const activeSeed = await seed(activeEnv);
    const activeWorker = activeSeed.payload?.study_id
      ? startVite([path.join(ROOT, "scripts", "worker.ts")], activeEnv)
      : null;
    const activeDescendants = activeWorker ? await observeDescendants(activeWorker, 10_000) : [];
    const activeProcess = activeWorker ? await activeWorker.done : { code: null, signal: null, stdout: "", stderr: "worker not started", timedOut: false, pid: null, duration_ms: 0 };
    if (activeWorker) await killTree(activeProcess.pid);
    await sleep(750);
    const activeInspectProcess = activeSeed.payload?.study_id ? await inspectResult(activeRoot, activeSeed.payload.study_id, activeEnv) : null;
    const activeInspect = parseLastJson(activeInspectProcess?.stdout);
    const activeDescendantsAfter = activeWorker ? await queryDescendants(activeProcess.pid) : null;
    const activeOutcome = jobOutcome(activeInspect);
    const activeProviderObserved = activeDescendants.some((sample) => Array.isArray(sample.descendants) && sample.descendants.some(isProviderProcess));
    const activeDeadlineRecorded = String(activeOutcome.job?.error ?? "").includes("JOB_DEADLINE_EXCEEDED") && activeOutcome.job?.status === "failed";
    const activeNoClinicalResult = Number(activeOutcome.counts?.analyses ?? -1) === 0 && Number(activeOutcome.counts?.reports ?? -1) === 0;
    const activeChildrenGone = Array.isArray(activeDescendantsAfter) && activeDescendantsAfter.length === 0;
    const activeResourceReleased = Number(activeOutcome.resource_leases?.active_leases ?? -1) === 0;

    const waitEnv = baseEnvironment(waitRoot, {
      PHASE10_SOURCE_IMAGE: SOURCE_IMAGE,
      VISIONSCAN_OVERALL_JOB_DEADLINE_MS: String(LONG_DEADLINE_MS),
      VISIONSCAN_WORKER_ID: "phase11-resource-wait-a",
    });
    const first = await seed(waitEnv);
    const second = await seed({ ...waitEnv, VISIONSCAN_WORKER_ID: "phase11-resource-wait-b", VISIONSCAN_OVERALL_JOB_DEADLINE_MS: String(WAIT_DEADLINE_MS) });
    const firstWorker = first.payload?.study_id ? startVite([path.join(ROOT, "scripts", "worker.ts")], waitEnv) : null;
    const firstDescendants = firstWorker ? await observeDescendants(firstWorker, 15_000) : [];
    const secondEnv = { ...waitEnv, PHASE10_STUDY_ID: second.payload?.study_id, VISIONSCAN_WORKER_ID: "phase11-resource-wait-b", VISIONSCAN_OVERALL_JOB_DEADLINE_MS: String(WAIT_DEADLINE_MS) };
    const secondWorker = second.payload?.study_id ? startVite([path.join(ROOT, "scripts", "worker.ts")], secondEnv) : null;
    const secondDescendants = secondWorker ? await observeDescendants(secondWorker, 10_000) : [];
    const secondProcess = secondWorker ? await secondWorker.done : { code: null, signal: null, stdout: "", stderr: "worker not started", timedOut: false, pid: null, duration_ms: 0 };
    if (secondWorker) await killTree(secondProcess.pid);
    const secondInspectProcess = second.payload?.study_id ? await inspectResult(waitRoot, second.payload.study_id, secondEnv) : null;
    const secondInspect = parseLastJson(secondInspectProcess?.stdout);
    const firstProcess = firstWorker ? await firstWorker.done : { code: null, signal: null, stdout: "", stderr: "worker not started", timedOut: false, pid: null, duration_ms: 0 };
    if (firstWorker) await killTree(firstProcess.pid);
    const firstInspectProcess = first.payload?.study_id ? await inspectResult(waitRoot, first.payload.study_id, waitEnv) : null;
    const firstInspect = parseLastJson(firstInspectProcess?.stdout);
    const secondAfterHolderProcess = second.payload?.study_id ? await inspectResult(waitRoot, second.payload.study_id, secondEnv) : null;
    const secondAfterHolderInspect = parseLastJson(secondAfterHolderProcess?.stdout);
    const secondOutcome = jobOutcome(secondInspect);
    const firstOutcome = jobOutcome(firstInspect);
    const secondAfterHolderOutcome = jobOutcome(secondAfterHolderInspect);
    const secondNoProviderLaunch = secondDescendants.every((sample) => Array.isArray(sample.descendants) && sample.descendants.every((row) => !isProviderProcess(row)));
    const secondWaitTimedOut = secondOutcome.job?.status === "failed" && String(secondOutcome.job?.error ?? "").includes("JOB_DEADLINE_EXCEEDED") && secondOutcome.job?.resource_rejection_reason === "RESOURCE_WAIT_DEADLINE_EXCEEDED";
    const secondNoClinicalResult = Number(secondOutcome.counts?.analyses ?? -1) === 0 && Number(secondOutcome.counts?.reports ?? -1) === 0;
    const secondResourceReleased = Number(secondAfterHolderOutcome.resource_leases?.active_leases ?? -1) === 0;
    const firstCompleted = firstOutcome.job?.status === "completed";

    const result = {
      ...common,
      status: activeProviderObserved && activeDeadlineRecorded && activeChildrenGone && activeResourceReleased && secondWaitTimedOut && secondNoProviderLaunch && secondNoClinicalResult && secondResourceReleased && firstCompleted
        ? "PASS_REAL_DEADLINE_AND_RESOURCE_WAIT"
        : "PARTIAL_REAL_DEADLINE_AND_RESOURCE_WAIT",
      active_provider_deadline: {
        configured_deadline_ms: ACTIVE_DEADLINE_MS,
        process: { code: activeProcess.code, signal: activeProcess.signal, timed_out: activeProcess.timedOut, duration_ms: activeProcess.duration_ms },
        provider_descendant_observed: activeProviderObserved,
        descendant_observations: activeDescendants,
        descendants_after_deadline: activeDescendantsAfter,
        outcome: activeOutcome,
        checks: { deadline_recorded: activeDeadlineRecorded, children_gone: activeChildrenGone, no_clinical_result: activeNoClinicalResult, resource_released: activeResourceReleased },
      },
      resource_wait_deadline: {
        configured_deadline_ms: WAIT_DEADLINE_MS,
        holder_process: { code: firstProcess.code, signal: firstProcess.signal, timed_out: firstProcess.timedOut, duration_ms: firstProcess.duration_ms },
        holder_descendant_observations: firstDescendants,
        holder_outcome: firstOutcome,
        waiter_process: { code: secondProcess.code, signal: secondProcess.signal, timed_out: secondProcess.timedOut, duration_ms: secondProcess.duration_ms },
        waiter_descendant_observations: secondDescendants,
        waiter_outcome: secondOutcome,
        waiter_outcome_after_holder_completion: secondAfterHolderOutcome,
        checks: { holder_completed: firstCompleted, waiter_deadline_recorded: secondWaitTimedOut, waiter_provider_not_launched: secondNoProviderLaunch, waiter_no_clinical_result: secondNoClinicalResult, waiter_resource_released: secondResourceReleased },
      },
      mutex_wait_behavior: { status: "MEASURED_BY_CODE_PATH", mutexes: ["fundusLesionLocalProvider", "drGradeLocalProvider", "octLocalProvider"], behavior: "aborted mutex wait rejects before provider launch" },
      limitations: ["A descendant PID proves an owned child process existed, not its exact model class; provider-specific invocation counts remain unavailable in the immutable ledger."],
    };
    fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
    fs.writeFileSync(OUTPUT, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ status: result.status, output: path.relative(ROOT, OUTPUT), active_provider_observed: activeProviderObserved, resource_wait_timed_out: secondWaitTimedOut, first_completed: firstCompleted }));
    if (result.status !== "PASS_REAL_DEADLINE_AND_RESOURCE_WAIT") process.exitCode = 1;
  } finally {
    fs.rmSync(activeRoot, { recursive: true, force: true });
    fs.rmSync(waitRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
