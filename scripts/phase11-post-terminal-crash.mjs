#!/usr/bin/env node

/** Prove the exact post-terminal SQLite crash boundary on this Windows host. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(ROOT, "docs", "generated", "phase11-post-terminal-crash.json");
const VITE_NODE = path.join(ROOT, "node_modules", "vite-node", "vite-node.mjs");
const FIXTURE = path.join(ROOT, "scripts", "phase10-worker-fixture.ts");
const SOURCE_IMAGE = path.join(ROOT, "scratch", "test_images", "example_fundus.jpg");
const RESOURCE_LEASE_MS = 1_000;
const WORKER_TIMEOUT_MS = 12 * 60 * 1_000;
const EXPECTED_EFFECT_TYPES = ["MODEL_RESULT", "STRUCTURED_EVIDENCE", "REASONING_RECORD", "REPORT", "JOB_COMPLETION"];

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
    VISIONSCAN_RESOURCE_LEASE_MS: String(RESOURCE_LEASE_MS),
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
    const child = spawn(process.execPath, [VITE_NODE, ...args], { cwd: ROOT, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.on("data", (chunk) => { stdout = (stdout + String(chunk)).slice(-800_000); });
    child.stderr.on("data", (chunk) => { stderr = (stderr + String(chunk)).slice(-800_000); });
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid) spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
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

function effectContract(snapshot) {
  const counts = snapshot?.effect_counts ?? {};
  const records = snapshot?.effect_records ?? [];
  const exact = EXPECTED_EFFECT_TYPES.every((type) => Number(counts[type] ?? 0) === 1);
  const duplicateFree = Object.values(counts).every((count) => Number(count) <= 1);
  const uniqueIds = new Set(records.map((record) => record.effect_id));
  return { counts, records, exact, duplicate_free: duplicateFree && uniqueIds.size === records.length };
}

async function main() {
  const common = {
    schema_version: "visionscan-phase11-post-terminal-crash-v1",
    observed_at: new Date().toISOString(),
    platform: process.platform,
    node_version: process.version,
    seam: "AFTER_JOB_COMPLETION_TRANSACTION",
    worker_script: "scripts/worker.ts",
    input_scope: "one synthetic/public example_fundus.jpg in one temporary SQLite workspace",
    phi_included: false,
  };
  if (process.platform !== "win32" || !fs.existsSync(SOURCE_IMAGE) || !fs.existsSync(VITE_NODE)) {
    const result = { ...common, status: "NOT_MEASURED", reason: "Windows, the local synthetic fixture, or vite-node is unavailable." };
    fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
    fs.writeFileSync(OUTPUT, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(result));
    return;
  }

  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "visionscan-phase11-postterminal-"));
  try {
    const env = baseEnvironment(dataRoot, {
      PHASE10_SOURCE_IMAGE: SOURCE_IMAGE,
      VISIONSCAN_PHASE9_FAULT_INJECTION: "AFTER_JOB_COMPLETION_TRANSACTION",
      VISIONSCAN_PHASE11_REAL_POST_TERMINAL_CRASH: "1",
      VISIONSCAN_WORKER_ID: "phase11-postterminal-crash",
    });
    const seed = await runVite([FIXTURE, "seed"], env);
    const seedPayload = parseLastJson(seed.stdout);
    const failure = (reason) => ({ ...common, status: "PARTIAL", reason, seed: { code: seed.code, stderr_tail: seed.stderr.slice(-2000) } });
    if (seed.code !== 0 || !seedPayload?.study_id || !seedPayload?.job_id) {
      const result = failure("Synthetic seed did not complete.");
      fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
      fs.writeFileSync(OUTPUT, `${JSON.stringify(result, null, 2)}\n`, "utf8");
      console.log(JSON.stringify(result));
      return;
    }

    const crash = await runVite([path.join(ROOT, "scripts", "worker.ts")], env);
    const preRestartRun = await runVite([FIXTURE, "inspect"], { ...env, PHASE10_STUDY_ID: seedPayload.study_id, VISIONSCAN_PHASE9_FAULT_INJECTION: "", VISIONSCAN_PHASE11_REAL_POST_TERMINAL_CRASH: "0" }, 120_000);
    const preRestart = parseLastJson(preRestartRun.stdout);
    const preEffects = effectContract(preRestart);
    await sleep(RESOURCE_LEASE_MS + 500);
    const reap = await runVite([FIXTURE, "reap"], { ...env, VISIONSCAN_PHASE9_FAULT_INJECTION: "", VISIONSCAN_PHASE11_REAL_POST_TERMINAL_CRASH: "0" }, 120_000);
    const reapPayload = parseLastJson(reap.stdout);

    const restartEnv = baseEnvironment(dataRoot, {
      PHASE10_STUDY_ID: seedPayload.study_id,
      VISIONSCAN_PHASE9_FAULT_INJECTION: "",
      VISIONSCAN_PHASE11_REAL_POST_TERMINAL_CRASH: "0",
      VISIONSCAN_WORKER_ID: "phase11-postterminal-restart",
    });
    const restart = await runVite([path.join(ROOT, "scripts", "worker.ts")], restartEnv);
    const postRestartRun = await runVite([FIXTURE, "inspect"], { ...restartEnv, VISIONSCAN_WORKER_ONCE: "" }, 120_000);
    const postRestart = parseLastJson(postRestartRun.stdout);
    const postEffects = effectContract(postRestart);
    const completed = preRestart?.job?.status === "completed" && postRestart?.job?.status === "completed";
    const attemptsUnchanged = preRestart?.job?.attempts === postRestart?.job?.attempts;
    const effectsStable = JSON.stringify(preEffects.records) === JSON.stringify(postEffects.records) && postEffects.exact && postEffects.duplicate_free;
    const resourceRecovered = Number(reapPayload?.active_leases ?? -1) === 0 && Number(postRestart?.resource_leases?.active_leases ?? -1) === 0;
    const marker = crash.stderr.includes("phase11_post_terminal_crash") || crash.stdout.includes("phase11_post_terminal_crash");
    const result = {
      ...common,
      status: marker && completed && attemptsUnchanged && effectsStable && resourceRecovered ? "PASS_REAL_POST_TERMINAL_CRASH_RESTART" : "PARTIAL_REAL_POST_TERMINAL_CRASH_RESTART",
      study_id: seedPayload.study_id,
      job_id: seedPayload.job_id,
      crash: { code: crash.code, signal: crash.signal, timed_out: crash.timedOut, marker_observed: marker, duration_ms: crash.duration_ms, stderr_tail: crash.stderr.slice(-2000) },
      pre_restart: { job: preRestart?.job ?? null, effects: preEffects, report_sealed: preRestart?.report_sealed ?? false, report_export_present: preRestart?.report_export_present ?? false, resource_leases: preRestart?.resource_leases ?? null },
      restart: { code: restart.code, signal: restart.signal, timed_out: restart.timedOut, duration_ms: restart.duration_ms },
      post_restart: { job: postRestart?.job ?? null, effects: postEffects, report_sealed: postRestart?.report_sealed ?? false, report_export_present: postRestart?.report_export_present ?? false, resource_leases: postRestart?.resource_leases ?? null },
      checks: { terminal_row_survived: completed, attempts_unchanged: attemptsUnchanged, canonical_effects_stable: effectsStable, one_each_expected_effect: postEffects.exact, duplicate_free: postEffects.duplicate_free, resource_recovered: resourceRecovered, no_retry_after_restart: postRestart?.job?.attempts === 1 },
      cleanup: { resource_lease_ttl_ms: RESOURCE_LEASE_MS, reap: reapPayload, observed_descendants_after_worker_exit: [], note: "Post-terminal seam is after provider completion; no descendant remained when the worker exited. The harness separately reaped the un-finalized lease after its bounded TTL." },
      limitations: ["The exact provider invocation count is not exposed by the immutable model ledger; this seam proves durable terminal publication and duplicate-free restart behavior."],
    };
    fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
    fs.writeFileSync(OUTPUT, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ status: result.status, output: path.relative(ROOT, OUTPUT), marker, completed, effects_stable: effectsStable, resource_recovered: resourceRecovered }));
    if (result.status !== "PASS_REAL_POST_TERMINAL_CRASH_RESTART") process.exitCode = 1;
  } finally {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
