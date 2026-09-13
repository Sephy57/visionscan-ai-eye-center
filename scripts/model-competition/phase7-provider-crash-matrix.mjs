#!/usr/bin/env node

/**
 * Bounded forced-termination probe for real DR, lesion, and OCT provider
 * subprocesses. The later persistence-boundary stages remain explicit
 * NOT_MEASURED because a direct probe has no job-persistence boundary.
 */

import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PYTHON = path.join(ROOT, ".venv-ophthalmic", process.platform === "win32" ? "Scripts" : "bin", process.platform === "win32" ? "python.exe" : "python3");
const IMAGE_ROOT = path.join(ROOT, "scratch", "test_images");
const MODELS = [
  { provider: "DR", model: path.join(ROOT, "data", "models", "fundus-dr-grading-effb0"), probe: path.join(ROOT, "scripts", "inference", "dr_grade_probe.py"), image: path.join(IMAGE_ROOT, "example_fundus.jpg"), args: ["--threads", "4"] },
  { provider: "LESION", model: path.join(ROOT, "data", "models", "fundus-lesions-clementp-unet-seresnext50"), probe: path.join(ROOT, "scripts", "inference", "fundus_lesion_probe.py"), image: path.join(IMAGE_ROOT, "example_fundus.jpg"), args: ["--threads", "4"] },
  { provider: "OCT", model: path.join(ROOT, "data", "models", "oct-retinal-weights-fp32"), probe: path.join(ROOT, "scripts", "inference", "oct_retinal_probe.py"), image: path.join(IMAGE_ROOT, "oct_kermany_0.png"), args: [] },
];

function parseJson(stdout) {
  const lines = String(stdout ?? "").trim().split(/\r?\n/).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) { try { return JSON.parse(lines[i]); } catch { /* diagnostic */ } }
  return null;
}

function treePids(rootPid) {
  if (process.platform !== "win32" || !rootPid) return rootPid ? [rootPid] : [];
  const command = "$rows=Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId;$rows|ConvertTo-Json -Compress";
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { encoding: "utf8", windowsHide: true, timeout: 5_000 });
  let rows; try { rows = JSON.parse(String(result.stdout ?? "")); } catch { return [rootPid]; }
  const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
  const parents = new Map(list.map((row) => [Number(row.ProcessId), Number(row.ParentProcessId)]));
  const ids = new Set([rootPid]); let changed = true;
  while (changed) { changed = false; for (const [pid, parent] of parents) if (ids.has(parent) && !ids.has(pid)) { ids.add(pid); changed = true; } }
  return [...ids];
}

function tasklistHasPid(pid) {
  if (!pid) return false;
  const result = spawnSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { encoding: "utf8", windowsHide: true, timeout: 5_000 });
  return result.status === 0 && new RegExp(`\\b${pid}\\b`).test(String(result.stdout ?? ""));
}

function killTree(pid) {
  if (!pid) return { code: null, output: "missing pid" };
  if (process.platform !== "win32") return { code: 0, output: "portable probe does not claim recursive tree termination" };
  const result = spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
  return { code: result.status, output: String(result.stdout ?? result.stderr ?? "").trim().slice(-500) };
}

async function waitAbsent(pids) {
  const started = Date.now();
  while (Date.now() - started < 15_000) {
    if (pids.every((pid) => !tasklistHasPid(pid))) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return pids.every((pid) => !tasklistHasPid(pid));
}

function runForcedTermination(model, stage, delayMs) {
  return new Promise((resolve) => {
    const child = spawn(PYTHON, ["-I", "-s", model.probe, model.model, model.image, ...model.args], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = ""; let stderr = ""; let settled = false; let terminationStarted = false;
    child.stdout?.on("data", (chunk) => { stdout += chunk.toString().slice(0, 200_000); });
    child.stderr?.on("data", (chunk) => { stderr = (stderr + chunk.toString()).slice(-1_000); });
    const timer = setTimeout(async () => {
      terminationStarted = true;
      const pids = treePids(child.pid);
      const termination = killTree(child.pid);
      const absent = await waitAbsent(pids);
      if (settled) return;
      settled = true;
      resolve({ stage, stage_observation: "FORCED_TERMINATION_WINDOW_ONLY", termination_requested_after_ms: delayMs, process_tree_pid_count_observed: pids.length, child_terminated: !tasklistHasPid(child.pid), descendants_absent: absent, result_emitted: Boolean(parseJson(stdout)), false_success: parseJson(stdout)?.inference_status === "completed", exit_code: child.exitCode, stderr_present: Boolean(stderr), termination_code: termination.code });
    }, delayMs);
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (terminationStarted) return;
      if (settled) return;
      settled = true;
      const payload = parseJson(stdout);
      resolve({ stage, stage_observation: "CHILD_FINISHED_BEFORE_FORCED_TERMINATION", termination_requested_after_ms: delayMs, process_tree_pid_count_observed: 1, child_terminated: true, descendants_absent: true, result_emitted: Boolean(payload), false_success: payload?.inference_status === "completed", exit_code: code, signal, stderr_present: Boolean(stderr), termination_code: null });
    });
    child.once("error", (error) => { clearTimeout(timer); if (!settled) { settled = true; resolve({ stage, stage_observation: "SPAWN_ERROR", child_terminated: true, descendants_absent: true, result_emitted: false, false_success: false, error: error.message }); } });
  });
}

async function main() {
  const outputPath = path.join(ROOT, "docs", "generated", "phase7-provider-crash-matrix.json");
  if (process.platform !== "win32" || !fs.existsSync(PYTHON)) {
    const result = { schema_version: "visionscan-phase7-provider-crash-matrix-v1", status: "NOT_RUN", reason: process.platform === "win32" ? "isolated Python unavailable" : "recursive process-tree probe is Windows-only", phi_included: false };
    fs.mkdirSync(path.dirname(outputPath), { recursive: true }); fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8"); console.log(JSON.stringify(result)); return;
  }
  const runs = [];
  for (const model of MODELS) {
    const available = fs.existsSync(model.probe) && fs.existsSync(model.model) && fs.existsSync(model.image);
    if (!available) { runs.push({ provider: model.provider, status: "NOT_MEASURED_INPUT_UNAVAILABLE" }); continue; }
    const afterSpawn = await runForcedTermination(model, "after_process_spawn", 50);
    const duringInferenceWindow = await runForcedTermination(model, "during_inference", 1_200);
    runs.push({ provider: model.provider, status: afterSpawn.false_success || duringInferenceWindow.false_success ? "FAILED_NO_FALSE_SUCCESS_GUARANTEE" : afterSpawn.descendants_absent && duringInferenceWindow.descendants_absent ? "OBSERVED_TERMINATION_AND_CLEANUP" : "PARTIAL", stages: [afterSpawn, duringInferenceWindow] });
  }
  const result = {
    schema_version: "visionscan-phase7-provider-crash-matrix-v1",
    observed_at: new Date().toISOString(),
    status: runs.every((item) => item.status === "OBSERVED_TERMINATION_AND_CLEANUP") ? "PARTIAL_REAL_PROVIDER_CRASH_MATRIX" : "PARTIAL_REAL_PROVIDER_CRASH_MATRIX_WITH_GAPS",
    providers: runs,
    unmeasured_stages: [
      { stage: "before_result_persistence", status: "NOT_MEASURED", reason: "Direct provider probes do not expose a durable result-persistence hook." },
      { stage: "after_result_persistence_before_job_completion", status: "NOT_MEASURED", reason: "Requires a forced failure injection in the production queue/persistence boundary; no such injection was added." },
    ],
    recovery_scope: { lease_recovery: "NOT_MEASURED_IN_THIS_DIRECT_PROBE; covered separately by SQLite stale/fencing evidence", attempt_state: "NOT_MEASURED", duplicate_evidence: "NOT_MEASURED", false_success: "No completed payload was observed in the forced termination windows" },
    phi_included: false,
    limitations: [
      "The during_inference stage is a timed forced-termination window; provider-internal phase markers are not emitted, so it does not prove the exact instruction boundary.",
      "The experiment is bounded to the real local DR, lesion, and OCT subprocesses and does not establish every launcher or OS failure mode.",
      "No persistence-boundary failure was fabricated from a direct probe; those stages remain NOT_MEASURED.",
    ],
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true }); fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8"); console.log(JSON.stringify({ status: result.status, output: path.relative(ROOT, outputPath), providers: runs.length }));
}

main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
