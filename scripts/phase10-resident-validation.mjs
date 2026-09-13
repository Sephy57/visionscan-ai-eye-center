#!/usr/bin/env node

/**
 * Phase 10 resident-runtime decision. The current production path is
 * explicitly short-lived; this artifact records the resident implementation
 * as rejected/disabled instead of reusing finite batch measurements as proof
 * of a resident service.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(root, "docs", "generated", "phase10-resident-validation.json");
const priorPath = path.join(root, "docs", "generated", "phase7-resident-experiment.json");
const prior = fs.existsSync(priorPath) ? JSON.parse(fs.readFileSync(priorPath, "utf8")) : null;
const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true });
const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

const result = {
  schema_version: "visionscan-phase10-resident-validation-v1",
  observed_at: new Date().toISOString(),
  status: "PASS_EXPLICIT_RESIDENT_DISABLED",
  decision: "RESIDENT_RUNTIME_REJECTED_DISABLED",
  production_resident_enabled: false,
  active_runtime: {
    mode: "short_lived_python_subprocess",
    provider_scope: "DR, lesion, and OCT providers are isolated per request/job",
    resident_adoption: "disabled",
  },
  resident_corpus: {
    requested: 20,
    source: "docs/generated/phase7-resident-experiment.json",
    historical_finite_probe_status: prior?.status ?? "NOT_AVAILABLE",
    historical_completed: prior?.cases?.completed ?? null,
    note: "The finite resident experiment is retained as historical evidence only; it is not promoted to production resident-worker approval.",
  },
  parity: {
    status: "NOT_APPLICABLE_WHILE_RESIDENT_DISABLED",
    tolerance: null,
    short_lived_outputs: "AVAILABLE_SEPARATE_PROVIDER_CONTRACT",
    resident_outputs: "NOT_MEASURED",
  },
  repeatability: "NOT_APPLICABLE_WHILE_RESIDENT_DISABLED",
  ordering_isolation: "NOT_APPLICABLE_WHILE_RESIDENT_DISABLED",
  cancellation: "NOT_APPLICABLE_WHILE_RESIDENT_DISABLED",
  crash_recovery: "NOT_APPLICABLE_WHILE_RESIDENT_DISABLED",
  memory_soak: "NOT_APPLICABLE_WHILE_RESIDENT_DISABLED",
  safety_boundary: "Disabling resident mode leaves the existing short-lived, process-tree-scoped provider path unchanged.",
  implementation_sha: String(head.stdout ?? "").trim() || null,
  source_artifact_sha256: fs.existsSync(priorPath) ? sha256(priorPath) : null,
  phi_included: false,
  external_professional_signoff: false,
  limitations: [
    "No approved resident production service exists in this checkout.",
    "Parity, cross-job state isolation, resident cancellation, resident crash recovery, and resident memory soak are not measured because the resident path is disabled.",
    "This decision is an engineering containment decision, not clinical validation or a model-accuracy claim.",
  ],
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ status: result.status, decision: result.decision, output: path.relative(root, outputPath) }));
