#!/usr/bin/env node
/**
 * Real, bounded Windows process-tree probe for the worker reliability matrix.
 *
 * The synthetic parent starts a real Python descendant and remains alive.  On
 * Windows the probe issues taskkill /PID <parent> /T /F, then checks both PIDs
 * with tasklist.  This proves only the exact synthetic tree exercised here; it
 * is not a claim about every possible Python launcher or production workload.
 * Non-Windows hosts report NOT_RUN because this repository intentionally does
 * not guess at a portable tree-kill command.
 */

import { spawn, spawnSync } from "node:child_process";

const CHECK_TIMEOUT_MS = 10_000;
const POLL_MS = 200;

function tasklistHasPid(pid) {
  if (!pid) return false;
  const result = spawnSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 5_000,
  });
  if (result.error) return false;
  const output = String(result.stdout ?? "");
  return new RegExp(`\\b${pid}\\b`).test(output);
}

function taskkill(pid) {
  if (!pid) return { code: null, stderr: "missing pid" };
  const result = spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: CHECK_TIMEOUT_MS,
  });
  return {
    code: result.status,
    stderr: String(result.stderr ?? "").trim().slice(-1000),
    stdout: String(result.stdout ?? "").trim().slice(-1000),
  };
}

function processTreePids(rootPid) {
  if (!rootPid) return [];
  const command = [
    "$rows=Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId;",
    "$rows | ConvertTo-Json -Compress",
  ].join(" ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 5_000,
  });
  if (result.error || result.status !== 0) return [rootPid];
  let rows;
  try { rows = JSON.parse(String(result.stdout ?? "")); } catch { return [rootPid]; }
  const normalized = Array.isArray(rows) ? rows : rows ? [rows] : [];
  const parents = new Map(normalized.map((row) => [Number(row.ProcessId), Number(row.ParentProcessId)]));
  const ids = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [pid, parent] of parents) {
      if (ids.has(parent) && !ids.has(pid)) {
        ids.add(pid);
        changed = true;
      }
    }
  }
  return [...ids].filter((pid) => Number.isSafeInteger(pid) && pid > 0);
}

function waitForExit(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(() => resolve(), CHECK_TIMEOUT_MS);
    child.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function waitUntilAbsent(pids) {
  const started = Date.now();
  while (Date.now() - started < CHECK_TIMEOUT_MS) {
    if (pids.every((pid) => !tasklistHasPid(pid))) return true;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  return pids.every((pid) => !tasklistHasPid(pid));
}

function findPython() {
  for (const command of ["python", "py"]) {
    const result = spawnSync("where", [command], { encoding: "utf8", windowsHide: true, timeout: 5_000 });
    if (result.status === 0 && String(result.stdout ?? "").trim()) return command;
  }
  return null;
}

async function runWindowsProbe() {
  const python = findPython();
  if (!python) {
    return {
      status: "NOT_RUN",
      reason: "No Python launcher was available on PATH; no process was started.",
      platform: process.platform,
    };
  }

  const parentCode = [
    "const {spawn}=require('node:child_process');",
    `const child=spawn(${JSON.stringify(python)},['-c','import time; time.sleep(120)'],{stdio:'ignore',windowsHide:true});`,
    "console.log(String(child.pid));",
    "setInterval(()=>{},1000);",
  ].join("");
  const parent = spawn(process.execPath, ["-e", parentCode], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  parent.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
  parent.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
  let descendantPid = null;
  const readStarted = Date.now();
  while (!descendantPid && Date.now() - readStarted < CHECK_TIMEOUT_MS) {
    const candidate = Number.parseInt(stdout.trim().split(/\s+/)[0] ?? "", 10);
    if (Number.isSafeInteger(candidate) && candidate > 0) descendantPid = candidate;
    if (!descendantPid) await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }

  const parentPid = parent.pid ?? null;
  let termination = null;
  try {
    if (!parentPid || !descendantPid) {
      termination = { code: null, stderr: "parent or descendant PID was not reported" };
      return {
        status: "FAILED",
        platform: process.platform,
        python_command: python,
        parent_pid: parentPid,
        descendant_pid: descendantPid,
        termination,
        descendants_absent: false,
        stderr: stderr.slice(-1000),
      };
    }
    const treePidsBefore = processTreePids(parentPid);
    termination = taskkill(parentPid);
    await waitForExit(parent);
    const descendantsAbsent = await waitUntilAbsent([...new Set([parentPid, descendantPid, ...treePidsBefore])]);
    return {
      status: termination.code === 0 && descendantsAbsent ? "PASSED" : "FAILED",
      platform: process.platform,
      python_command: python,
      parent_pid: parentPid,
      descendant_pid: descendantPid,
      tree_pids_before: treePidsBefore,
      termination,
      descendants_absent: descendantsAbsent,
      stderr: stderr.slice(-1000) || null,
      evidence_scope: "one synthetic Node -> Python tree on this Windows host",
    };
  } finally {
    if (parentPid && tasklistHasPid(parentPid)) taskkill(parentPid);
    if (descendantPid && tasklistHasPid(descendantPid)) taskkill(descendantPid);
  }
}

async function main() {
  if (process.platform !== "win32") {
    process.stdout.write(`${JSON.stringify({ status: "NOT_RUN", platform: process.platform, reason: "The real recursive taskkill probe is Windows-only." }, null, 2)}\n`);
    return;
  }
  const result = await runWindowsProbe();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status === "FAILED") process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
