/**
 * Model integrity verification.
 *
 * MODEL FILE -> SHA-256 -> REGISTRY -> MATCH? -> version/modality/device/status checks
 * Any failure => model MUST NOT run. Never silently run an unknown model.
 */

import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { MODEL_ROOT } from "../config";
import { ModelRecord, getModel, gateModelUse, supportsModality } from "./registry";

export interface IntegrityResult {
  trusted: boolean;
  checks: Array<{ check: string; passed: boolean; detail: string }>;
  model: ModelRecord | null;
}

function sha256File(p: string): string {
  const buf = fs.readFileSync(p);
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Verify a model artifact against its registry record.
 * A model with no artifact on disk is "trusted" only if its registry entry
 * declares format "placeholder" (deterministic synthetic generation, no file)
 * AND status DEMO.
 */
export function verifyModelIntegrity(modelId: string): IntegrityResult {
  const checks: IntegrityResult["checks"] = [];
  const model = getModel(modelId);
  const push = (check: string, passed: boolean, detail: string) => checks.push({ check, passed, detail });

  if (!model) {
    return { trusted: false, model: null, checks: [{ check: "registry", passed: false, detail: `Unknown model id: ${modelId}` }] };
  }
  push("registry", true, "Model id found in registry.");

  const gate = gateModelUse(model);
  push("status_gate", gate.allowed, gate.allowed ? `Status ${model.status} permits use.` : gate.reasons.join(" "));

  if (model.format === "placeholder" && model.status === "DEMO" && model.file_path === null) {
    push("artifact", true, "Placeholder DEMO model: deterministic synthetic generation, no artifact required.");
    return { trusted: gate.allowed, model, checks };
  }

  if (!model.file_path) {
    push("artifact", false, "No artifact path recorded; cannot verify integrity.");
    return { trusted: false, model, checks };
  }

  const abs = path.resolve(MODEL_ROOT, model.file_path);
  if (!abs.startsWith(path.resolve(MODEL_ROOT))) {
    push("artifact_path", false, "Artifact path escapes MODEL_ROOT.");
    return { trusted: false, model, checks };
  }
  if (!fs.existsSync(abs)) {
    push("artifact_exists", false, `Model file not found: ${model.file_path}`);
    return { trusted: false, model, checks };
  }
  push("artifact_exists", true, "Model file located on disk.");

  const actual = sha256File(abs);
  push("checksum", actual === model.sha256, actual === model.sha256 ? "SHA-256 matches registry." : `SHA-256 MISMATCH (registry ${model.sha256?.slice(0, 12)}…, disk ${actual.slice(0, 12)}…). Model rejected.`);

  return { trusted: gate.allowed && checks.every((c) => c.passed), model, checks };
}

export { supportsModality };
