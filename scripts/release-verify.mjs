#!/usr/bin/env node
/**
 * Run the local release verification matrix and aggregate honest outcomes.
 * No command in this list rewrites application data; release-data-check and
 * the reconciliation pass write only their requested PHI-free evidence files.
 * A failing gate is retained in the summary and makes this command fail.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
const evidenceRoot = path.join(ROOT, "data", "tmp");
fs.mkdirSync(evidenceRoot, { recursive: true });

const commands = [
  ["lint", npm, ["run", "lint"]],
  ["typecheck", npx, ["tsc", "--noEmit", "--pretty", "false"]],
  ["unit_tests", npx, ["vitest", "run", "--pool=forks", "--maxWorkers=1", "--minWorkers=1"]],
  ["production_dependency_audit", npm, ["audit", "--omit=dev", "--audit-level=high", "--json"]],
  ["model_validation_report", npm, ["run", "model:validate"]],
  ["model_manifest_audit", npm, ["run", "model:audit"]],
  ["filesystem_audit", npm, ["run", "audit:fs"]],
  ["sbom", npm, ["run", "sbom", "--", "--output", `data/tmp/release-verify-${stamp}-SBOM.cdx.json`]],
  ["release_inventory", npm, ["run", "release:inventory", "--", "--output", `data/tmp/release-verify-${stamp}-inventory.json`]],
  ["foreign_key_preflight", npm, ["run", "fk:preflight"]],
  ["reconciliation_adjudication", npx, ["vite-node", "scripts/reconciliation-adjudicate.ts", "--output", `data/tmp/release-verify-${stamp}-reconciliation.json`]],
  ["release_data_check", npm, ["run", "release:data-check", "--", "--output", `data/tmp/release-verify-${stamp}-data.json`]],
  ["production_build", npm, ["run", "build"]],
];

const results = [];
for (const [name, executable, args] of commands) {
  console.log(`\n=== ${name} ===`);
  const started = Date.now();
  const result = spawnSync(executable, args, {
    cwd: ROOT,
    stdio: "inherit",
    windowsHide: true,
    // Windows exposes npm/npx as .cmd shims; spawning those shims without a
    // shell can return EINVAL before the child process starts.
    shell: process.platform === "win32",
  });
  const exitCode = typeof result.status === "number" ? result.status : 1;
  results.push({ name, exit_code: exitCode, duration_ms: Date.now() - started });
}

const summary = {
  format: "visionscan-release-verify-v1",
  generated_at: new Date().toISOString(),
  source_commit: (() => {
    const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8", windowsHide: true });
    return result.status === 0 ? result.stdout.trim() : null;
  })(),
  results,
  passed: results.filter((result) => result.exit_code === 0).length,
  failed: results.filter((result) => result.exit_code !== 0).length,
  status: results.every((result) => result.exit_code === 0) ? "PASS" : "BLOCKED",
  phi_included: false,
};
const output = path.join(evidenceRoot, `release-verify-${stamp}-summary.json`);
fs.writeFileSync(output, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(`\nRelease verification summary: ${output}`);
console.log(JSON.stringify(summary, null, 2));
process.exitCode = summary.failed === 0 ? 0 : 1;
