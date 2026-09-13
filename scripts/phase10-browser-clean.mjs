#!/usr/bin/env node

/**
 * Run the hosted browser smoke against an isolated, empty, no-model database.
 * The temporary server is killed by process tree and its data root is removed
 * after the check; no credentials or study data are written to the report.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const viteNode = path.join(root, "node_modules", "vite-node", "vite-node.mjs");
const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "visionscan-phase10-browser-"));
const baseUrl = "http://127.0.0.1:3101";

const env = {
  ...process.env,
  PROJECT_ROOT: root,
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
  MODEL_ROOT: path.join(dataRoot, "models"),
  VISIONSCAN_PERSISTENCE_BACKEND: "sqlite",
  NODE_ENV: "production",
  DEMO_MODE: "false",
  ALLOW_INSECURE_LOCAL_AUTH: "true",
  BASE_URL: baseUrl,
  BROWSER_CI_USERNAME: `phase10-browser-${Date.now()}`,
  BROWSER_CI_PASSWORD: "Phase10#BrowserLocal1234",
};

function runSync(command, args) {
  const result = spawnSync(command, args, { cwd: root, env, encoding: "utf8", windowsHide: true, timeout: 120_000 });
  return { status: result.status, stdout: String(result.stdout ?? ""), stderr: String(result.stderr ?? "") };
}

function killTree(pid) {
  if (!pid) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  else {
    try { process.kill(pid, "SIGKILL"); } catch { /* already exited */ }
  }
}

function waitForClose(child) {
  return new Promise((resolve) => child.once("close", resolve));
}

async function waitForReady() {
  const started = Date.now();
  while (Date.now() - started < 60_000) {
    try {
      const response = await fetch(`${baseUrl}/api/health/live`);
      if (response.ok) return { ready: true, wait_ms: Date.now() - started };
    } catch { /* server still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return { ready: false, wait_ms: Date.now() - started };
}

async function main() {
  let server = null;
  let serverStdout = "";
  let serverStderr = "";
  try {
    const setup = runSync(process.execPath, [path.join(root, "scripts", "setup-dirs.mjs")]);
    const init = runSync(process.execPath, [viteNode, path.join(root, "scripts", "init-db.ts")]);
    if (setup.status !== 0 || init.status !== 0) throw new Error(`isolated setup failed: setup=${setup.status}, init=${init.status}`);
    server = spawn(process.execPath, [nextBin, "start", "-p", "3101"], { cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    server.stdout.on("data", (chunk) => { serverStdout = (serverStdout + String(chunk)).slice(-10_000); });
    server.stderr.on("data", (chunk) => { serverStderr = (serverStderr + String(chunk)).slice(-10_000); });
    const ready = await waitForReady();
    if (!ready.ready) throw new Error("isolated Next server did not become ready within 60 seconds");
    const browser = runSync(process.execPath, [path.join(root, "scripts", "browser-ci.mjs")]);
    const passed = browser.status === 0 && /HOSTED BROWSER SMOKE: PASSED/.test(browser.stdout);
    console.log(JSON.stringify({
      status: passed ? "PASS_REAL_BROWSER" : "FAIL_REAL_BROWSER",
      evidence_classification: "REAL_BROWSER",
      base_url: baseUrl,
      isolated_empty_database: true,
      model_assets_included: false,
      server_ready_wait_ms: ready.wait_ms,
      browser_exit_code: browser.status,
      browser_output_tail: browser.stdout.slice(-2000),
      browser_error_tail: browser.stderr.slice(-2000),
      server_output_tail: serverStdout.slice(-1000),
      server_error_tail: serverStderr.slice(-1000),
      phi_included: false,
    }));
    if (!passed) process.exitCode = 1;
  } finally {
    if (server?.pid) {
      killTree(server.pid);
      await Promise.race([waitForClose(server), new Promise((resolve) => setTimeout(resolve, 5000))]);
    }
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  fs.rmSync(dataRoot, { recursive: true, force: true });
  process.exitCode = 1;
});
