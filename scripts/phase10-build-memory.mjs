#!/usr/bin/env node

/**
 * Capture a bounded Windows Next build memory observation for Phase 10.
 * The baseline is retained as an explicit historical observation from the
 * pre-remediation run; the current run is measured from the live process tree.
 */

import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(root, "docs", "generated", "phase10-build-memory.json");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function gitHead() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true });
  return String(result.stdout ?? "").trim() || null;
}

function workingTreeDirty() {
  const result = spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8", windowsHide: true });
  return String(result.stdout ?? "").trim().length > 0;
}

function processTree(rootPid) {
  if (process.platform !== "win32" || !rootPid) return null;
  const script = "$root=" + String(rootPid) + ";$rows=Get-CimInstance Win32_Process -ErrorAction SilentlyContinue|Select-Object ProcessId,ParentProcessId;" +
    "$parents=@{};$rows|ForEach-Object{$parents[[int]$_.ProcessId]=[int]$_.ParentProcessId};$ids=@($root);$changed=$true;while($changed){$changed=$false;foreach($row in $rows){$processId=[int]$row.ProcessId;if($ids -contains [int]$row.ParentProcessId -and $ids -notcontains $processId){$ids+=$processId;$changed=$true}}};" +
    "$ids|ConvertTo-Json -Compress";
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { cwd: root, encoding: "utf8", windowsHide: true, timeout: 5000 });
  if (result.status !== 0) return null;
  try {
    const parsed = JSON.parse(String(result.stdout ?? "").trim() || "[]");
    return (Array.isArray(parsed) ? parsed : [parsed]).map(Number).filter(Number.isFinite);
  } catch {
    return null;
  }
}

function sample(ids) {
  if (!ids?.length) return null;
  const command = `Get-Process -Id ${ids.join(",")} -ErrorAction SilentlyContinue | Select-Object Id,WorkingSet64,PrivateMemorySize64,CPU,Threads | ConvertTo-Json -Compress`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { cwd: root, encoding: "utf8", windowsHide: true, timeout: 5000 });
  if (result.status !== 0) return null;
  try {
    const parsed = JSON.parse(String(result.stdout ?? "").trim() || "[]");
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    const numeric = rows.filter((row) => row && Number.isFinite(Number(row.WorkingSet64)));
    if (!numeric.length) return null;
    return {
      process_count: numeric.length,
      working_set_bytes: numeric.reduce((sum, row) => sum + Number(row.WorkingSet64 ?? 0), 0),
      private_bytes: numeric.reduce((sum, row) => sum + Number(row.PrivateMemorySize64 ?? 0), 0),
      cpu_seconds: numeric.reduce((sum, row) => sum + Number(row.CPU ?? 0), 0),
      thread_count: numeric.reduce((sum, row) => sum + Number(row.Threads?.Count ?? row.Threads ?? 0), 0),
    };
  } catch {
    return null;
  }
}

function runBuild() {
  return new Promise((resolve) => {
    const started = Date.now();
    const command = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "npm";
    const args = process.platform === "win32" ? ["/d", "/s", "/c", "npm run build"] : ["run", "build"];
    const child = spawn(command, args, { cwd: root, env: process.env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let peak = { process_count: 0, working_set_bytes: 0, private_bytes: 0, cpu_seconds: 0, thread_count: 0 };
    const collect = (chunk, target) => {
      const value = String(chunk);
      if (target === "stdout") stdout = (stdout + value).slice(-100_000);
      else stderr = (stderr + value).slice(-100_000);
    };
    child.stdout.on("data", (chunk) => collect(chunk, "stdout"));
    child.stderr.on("data", (chunk) => collect(chunk, "stderr"));
    const monitor = setInterval(() => {
      const ids = processTree(child.pid);
      const current = sample(ids);
      if (current) {
        peak = {
          process_count: Math.max(peak.process_count, current.process_count),
          working_set_bytes: Math.max(peak.working_set_bytes, current.working_set_bytes),
          private_bytes: Math.max(peak.private_bytes, current.private_bytes),
          cpu_seconds: Math.max(peak.cpu_seconds, current.cpu_seconds),
          thread_count: Math.max(peak.thread_count, current.thread_count),
        };
      }
    }, 1000);
    child.on("error", (error) => {
      clearInterval(monitor);
      resolve({ exit_code: null, signal: null, duration_ms: Date.now() - started, peak, stdout, stderr: `${stderr}\n${error.message}` });
    });
    child.on("close", (code, signal) => {
      clearInterval(monitor);
      resolve({ exit_code: code, signal, duration_ms: Date.now() - started, peak, stdout, stderr });
    });
  });
}

async function main() {
  const observed = await runBuild();
  const output = {
    schema_version: "visionscan-phase10-build-memory-v1",
    observed_at: new Date().toISOString(),
    platform: process.platform,
    node_version: process.version,
    implementation_head_at_capture: gitHead(),
    working_tree_dirty_at_capture: workingTreeDirty(),
    build_command: "npm run build",
    next_config: {
      webpackMemoryOptimizations: true,
      serverSourceMaps: false,
      serverExternalPackages: ["sharp", "pdfjs-dist", "pdf-lib", "tesseract.js", "@napi-rs/canvas", "better-sqlite3"],
    },
    baseline_pre_remediation: {
      evidence_classification: "REAL_SUBPROCESS",
      status: "FAIL",
      exit_code: 134,
      duration_ms_approx: 312000,
      peak_process_count: 4,
      peak_working_set_bytes_approx: 8190000000,
      peak_private_bytes_approx: 8650000000,
      failure: "FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory",
      source_note: "Measured in the bounded Phase 10 baseline run before webpackMemoryOptimizations was enabled.",
    },
    remediated_current_run: {
      evidence_classification: "REAL_SUBPROCESS",
      status: observed.exit_code === 0 ? "PASS" : "FAIL",
      exit_code: observed.exit_code,
      signal: observed.signal,
      duration_ms: observed.duration_ms,
      peak: observed.peak,
      output_tail: { stdout: observed.stdout.slice(-4000), stderr: observed.stderr.slice(-4000) },
    },
    conclusion: observed.exit_code === 0
      ? "The documented webpack memory optimization prevents the previously observed local Windows build OOM in this run; it does not establish a universal memory guarantee for other hosts or graph changes."
      : "The local Windows build remains unproven after the documented memory optimization.",
    phi_included: false,
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ status: output.remediated_current_run.status, output: path.relative(root, outputPath), duration_ms: observed.duration_ms, peak_private_bytes: observed.peak.private_bytes }));
  if (observed.exit_code !== 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
