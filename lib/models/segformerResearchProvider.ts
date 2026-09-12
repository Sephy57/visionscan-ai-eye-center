/**
 * S9 — the first real, working local-inference provider in this codebase.
 * Wraps `scripts/inference/segformer_infer.py`, which loads
 * `pamixsun/segformer_for_optic_disc_cup_segmentation` (Apache-2.0, native
 * `transformers` class, safetensors-only) from a local artifact and runs
 * genuine PyTorch CPU inference against a real fundus image.
 *
 * HARD RULES (same posture as lib/models/candidateProvider.ts /
 * pythonBridgeProvider.ts):
 *  - never registered in PROVIDERS (lib/models/provider.ts) or MODELS
 *    (lib/models/registry.ts) — this class is reachable only by tests and
 *    any future, explicitly-authorized integration work
 *  - never imported by lib/analysis/pipeline.ts — nothing here can reach
 *    the live triage/diagnosis pipeline
 *  - output is raw segmentation only, run through the existing
 *    `RawModelOutput` contract (lib/models/outputContract.ts); nothing
 *    here converts a segmented pixel area into a diagnosis, a disease
 *    probability, or a treatment recommendation
 *  - laterality is always "unknown" — never inferred from image pixels
 *  - the checkpoint lives under `scratch/models/` (gitignored, never
 *    `data/models/`) until an explicitly authorized future phase decides
 *    otherwise; this class fails closed (ARTIFACT_NOT_FOUND) if it isn't there
 */

import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import { createHash } from "crypto";
import { PROJECT_ROOT } from "../config";
import type { RawModelOutput } from "./outputContract";
import { validateRawModelOutput } from "./outputContract";

export const SEGFORMER_MODEL_DIR = path.join(PROJECT_ROOT, "scratch", "models", "segformer-optic-disc-cup-refuge");
export const SEGFORMER_ARTIFACT_SHA256 = "22e45131b64eb07a5d29a2e5388a7709d10696b13f48d2d0cdcf56cafa1f9ea5";
const INFER_SCRIPT = path.join(PROJECT_ROOT, "scripts", "inference", "segformer_infer.py");
const VENV_PYTHON = path.join(PROJECT_ROOT, ".venv-ophthalmic", process.platform === "win32" ? "Scripts" : "bin", process.platform === "win32" ? "python.exe" : "python3");
// Research-only CPU inference can be scheduled alongside other worker-heavy
// tests/processes on a constrained host. Keep a hard upper bound, but allow
// enough time for model import + load under contention; this provider is not
// on the live request path.
const INFERENCE_TIMEOUT_MS = 120_000;

export class ArtifactNotFoundError extends Error {
  constructor() {
    super(`No local artifact at ${SEGFORMER_MODEL_DIR} — research inference is unavailable until it is (re-)acquired. See docs/S9_REAL_MODEL_INTEGRATION.md.`);
    this.name = "ArtifactNotFoundError";
  }
}

export interface SegformerArtifactIntegrity {
  trusted: boolean;
  expected_sha256: string;
  actual_sha256: string | null;
  reason: string | null;
}

/** Hash the exact SafeTensors artifact immediately before a research spawn. */
export function verifySegformerResearchArtifact(): SegformerArtifactIntegrity {
  const artifactPath = path.join(SEGFORMER_MODEL_DIR, "model.safetensors");
  const base = { expected_sha256: SEGFORMER_ARTIFACT_SHA256 };
  if (!fs.existsSync(artifactPath)) {
    return { ...base, trusted: false, actual_sha256: null, reason: "SegFormer SafeTensors artifact is not installed." };
  }
  try {
    const stat = fs.lstatSync(artifactPath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      return { ...base, trusted: false, actual_sha256: null, reason: "SegFormer artifact must be a regular, non-symlink file." };
    }
    const hash = createHash("sha256");
    const fd = fs.openSync(artifactPath, "r");
    const chunk = Buffer.allocUnsafe(1024 * 1024);
    try {
      let read = 0;
      do {
        read = fs.readSync(fd, chunk, 0, chunk.length, null);
        if (read > 0) hash.update(chunk.subarray(0, read));
      } while (read > 0);
    } finally {
      fs.closeSync(fd);
    }
    const actual = hash.digest("hex");
    return actual === SEGFORMER_ARTIFACT_SHA256
      ? { ...base, trusted: true, actual_sha256: actual, reason: null }
      : { ...base, trusted: false, actual_sha256: actual, reason: "SegFormer artifact SHA-256 does not match the pinned research artifact." };
  } catch (error) {
    return { ...base, trusted: false, actual_sha256: null, reason: `SegFormer artifact integrity check failed: ${String(error instanceof Error ? error.message : error).slice(0, 180)}` };
  }
}

function runPython(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string } | { spawnError: Error }> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const candidates = fs.existsSync(VENV_PYTHON) ? [VENV_PYTHON] : ["python3", "python"];
    const command = candidates[0];
    const proc = spawn(command, args, { timeout: INFERENCE_TIMEOUT_MS });
    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("error", (err) => { if (!settled) { settled = true; resolve({ spawnError: err }); } });
    proc.on("close", (code) => { if (!settled) { settled = true; resolve({ code, stdout, stderr }); } });
  });
}

/**
 * Runs real research inference on one local image file. Fails closed
 * (`inference_status: "failed"`) on any error — missing artifact, missing
 * Python environment, malformed image, or a NaN/Inf model output. Never
 * throws for an ordinary inference failure; only throws ArtifactNotFoundError
 * up front when there is nothing to run at all.
 */
export async function runSegformerResearchInference(imagePath: string): Promise<RawModelOutput> {
  const integrity = verifySegformerResearchArtifact();
  if (!integrity.actual_sha256 && integrity.reason?.includes("not installed")) {
    throw new ArtifactNotFoundError();
  }
  if (!integrity.trusted) {
    return { inference_status: "failed", inference_error: integrity.reason ?? "SegFormer artifact integrity check failed." };
  }
  const result = await runPython([INFER_SCRIPT, SEGFORMER_MODEL_DIR, imagePath]);
  if ("spawnError" in result) {
    return { inference_status: "failed", inference_error: `Failed to spawn Python: ${result.spawnError.message}` };
  }
  if (result.code !== 0) {
    return { inference_status: "failed", inference_error: `SegFormer worker exited non-zero (${result.code ?? "unknown"}); output rejected.` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout.trim());
  } catch {
    return { inference_status: "failed", inference_error: `Unparseable inference output (exit ${result.code}): ${(result.stdout || result.stderr).slice(0, 300)}` };
  }
  const validated = validateRawModelOutput(parsed);
  if (!validated.valid || !validated.output) {
    return { inference_status: "failed", inference_error: `Output failed contract validation: ${validated.errors.map((e) => e.message).join("; ").slice(0, 300)}` };
  }
  return validated.output;
}

export const SEGFORMER_RESEARCH_MODEL_ID = "segformer-optic-disc-cup-refuge";

export function hasSegformerResearchArtifact(): boolean {
  return fs.existsSync(path.join(SEGFORMER_MODEL_DIR, "model.safetensors"));
}
