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

const MAX_MODEL_ARTIFACT_BYTES = 2 * 1024 * 1024 * 1024;

function pathWithin(parent: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function sha256File(p: string): string {
  const stat = fs.lstatSync(p);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_MODEL_ARTIFACT_BYTES) throw new Error("artifact is not a regular non-symlink file within the size limit");
  const hash = createHash("sha256");
  const fd = fs.openSync(p, "r");
  const chunk = Buffer.allocUnsafe(1024 * 1024);
  try {
    let read = 0;
    do { read = fs.readSync(fd, chunk, 0, chunk.length, null); if (read > 0) hash.update(chunk.subarray(0, read)); } while (read > 0);
  } finally { fs.closeSync(fd); }
  return hash.digest("hex");
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
  if (!pathWithin(MODEL_ROOT, abs)) {
    push("artifact_path", false, "Artifact path escapes MODEL_ROOT.");
    return { trusted: false, model, checks };
  }
  if (!fs.existsSync(abs)) {
    push("artifact_exists", false, `Model file not found: ${model.file_path}`);
    return { trusted: false, model, checks };
  }
  try {
    const realRoot = fs.realpathSync(MODEL_ROOT);
    const realArtifact = fs.realpathSync(abs);
    if (!pathWithin(realRoot, realArtifact)) {
      push("artifact_path", false, "Resolved artifact path escapes MODEL_ROOT.");
      return { trusted: false, model, checks };
    }
  } catch (err) {
    push("artifact_path", false, `Artifact path resolution failed: ${String(err instanceof Error ? err.message : err).slice(0, 180)}`);
    return { trusted: false, model, checks };
  }
  push("artifact_exists", true, "Model file located on disk.");

  let actual: string;
  try { actual = sha256File(abs); } catch (err) {
    push("checksum", false, `Artifact hash failed: ${String(err instanceof Error ? err.message : err).slice(0, 180)}`);
    return { trusted: false, model, checks };
  }
  push("checksum", actual === model.sha256, actual === model.sha256 ? "SHA-256 matches registry." : `SHA-256 MISMATCH (registry ${model.sha256?.slice(0, 12)}…, disk ${actual.slice(0, 12)}…). Model rejected.`);

  return { trusted: gate.allowed && checks.every((c) => c.passed), model, checks };
}

export { supportsModality };
