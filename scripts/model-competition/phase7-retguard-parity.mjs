#!/usr/bin/env node

/** Run the bounded RetGuard parity investigation and persist PHI-free output. */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MODEL = path.join(ROOT, "scratch", "phase6-candidates", "retguard-dr-v1.0.0", "extracted", "retguard_dr_v1.0.0.onnx");
const PROBE = path.join(ROOT, "scripts", "inference", "retguard_parity_probe.py");
const OUTPUT = path.join(ROOT, "docs", "generated", "phase7-retguard-parity-investigation.json");
const PYTHON = path.join(ROOT, ".venv-ophthalmic", process.platform === "win32" ? "Scripts" : "bin", process.platform === "win32" ? "python.exe" : "python3");

function safeJson(value) {
  try { return JSON.parse(value); } catch { return null; }
}

function main() {
  if (!fs.existsSync(MODEL) || !fs.existsSync(PROBE) || !fs.existsSync(PYTHON)) {
    const result = {
      schema_version: "visionscan-phase7-retguard-parity-investigation-v1",
      status: "NOT_MEASURED",
      candidate_id: "retguard-dr-v1.0.0",
      publisher_observation: { max_logit_difference: 0.002526, max_probability_difference: 0.000626, declared_logit_tolerance: 0.001, logit_parity: "FAILED", verification_samples: 6 },
      comparison: { publisher_framework_logits: null, onnx_logits: null, onnx_probabilities: null, absolute_differences: null },
      stop_rule_preserved: true,
      final_decision: "CANDIDATE_ONLY / RIGHTS_RESTRICTED / NOT_BENCHMARK_READY",
      phi_included: false,
      limitations: ["The local RetGuard artifact or isolated Python runtime is unavailable; no parity claim is inferred."],
    };
    fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
    fs.writeFileSync(OUTPUT, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    process.stdout.write(`${JSON.stringify({ status: result.status, output: path.relative(ROOT, OUTPUT) }, null, 2)}\n`);
    return;
  }

  const run = spawnSync(PYTHON, ["-I", "-s", PROBE, MODEL], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    timeout: 300_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  const stdout = String(run.stdout ?? "").trim();
  const parsed = safeJson(stdout) ?? safeJson(stdout.split(/\r?\n/).filter(Boolean).at(-1) ?? "");
  const result = parsed ?? {
    schema_version: "visionscan-phase7-retguard-parity-investigation-v1",
    status: "FAILED",
    error: String(run.stderr ?? run.stdout ?? "parity probe produced no JSON").trim().slice(-1000),
    stop_rule_preserved: true,
    final_decision: "CANDIDATE_ONLY / RIGHTS_RESTRICTED / NOT_BENCHMARK_READY",
    phi_included: false,
  };
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ status: result.status, output: path.relative(ROOT, OUTPUT), exit_code: run.status }, null, 2)}\n`);
  if (run.error || (run.status !== 0 && result.status === "FAILED")) process.exitCode = 1;
}

main();
