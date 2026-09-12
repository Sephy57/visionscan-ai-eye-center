/**
 * Fundus lesion local provider (RESEARCH).
 *
 * Runs the hash-verified ClementP lesion checkpoint
 * (U-Net + SE-ResNeXt50-32x4d, 5 channels) as a short-lived, isolated,
 * offline Python subprocess and converts its REAL pixel output into
 * observation-level findings through the tested chokepoints:
 *
 *   probe stdout JSON
 *     -> validateFundusLesionSegmentationOutput() (strict transport contract)
 *     -> RawModelOutput
 *     -> convertRawModelOutputToFindings() (calibration: none, always null)
 *
 * HARD RULES:
 *  - IMAGE BYTES IN, never filenames/hashes/metadata as finding drivers.
 *  - SafeTensors only; the probe pins SHA-256 internally AND this provider
 *    verifies the installed package (loadModelPackage) before every spawn.
 *  - Offline: the probe sets HF_HUB_OFFLINE/TRANSFORMERS_OFFLINE and makes
 *    no network calls. Patient bytes never leave this machine.
 *  - Serialized execution: one worker peaks at ~1.3 GB RSS, so concurrent
 *    analyses share a module-level mutex rather than OOMing the host.
 *  - Fail closed: any spawn/timeout/parse/contract failure yields
 *    inference_status "failed" with zero findings - never a guess.
 *  - RESEARCH ONLY: findings are taxonomy_level "observation" with
 *    INDETERMINATE confidence; this provider cannot emit conditions,
 *    diagnoses, probabilities, or normality claims.
 */

import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import { PROJECT_ROOT, TMP_ROOT, MODEL_ROOT, ensureDirs } from "../config";
import { newId } from "../storage/files";
import type { NormalizedStudy } from "../devices/adapter";
import { getModel, gateModelUse, deviceCompatible, type ModelGateResult, type ModelRecord } from "./registry";
import { verifyModelIntegrity, type IntegrityResult } from "./integrity";
import { loadModelPackage } from "./package";
import type { EyeModelProvider, ModelAnalysisContext, ModelAnalysisOutput, ModelCapabilities } from "./provider";
import { gateOrThrow } from "./provider";
import { checkModalitySupported } from "./modalities";
import {
  FUNDUS_LESION_MODEL_ID,
  FUNDUS_LESION_MODEL_VERSION,
  FUNDUS_LESION_ARTIFACT_SHA256,
  FUNDUS_LESION_PREPROCESSING_VERSION,
  validateFundusLesionSegmentationOutput,
  type FundusLesionSegmentationOutput,
} from "./fundusLesionContract";
import { convertRawModelOutputToFindings } from "./outputConversion";
import type { RawModelOutput } from "./outputContract";
import type { Finding } from "../analysis/schema";
import { assetHash } from "../assets/assetRouter";
import { getInferenceCache, inferenceCacheKey, setInferenceCache } from "./inferenceCache";
import { trackChildProcess } from "../jobs/processControl";
import { buildThreadGovernedEnv } from "../runtime/threadGovernance";

const PROBE_SCRIPT = path.join(PROJECT_ROOT, "scripts", "inference", "fundus_lesion_probe.py");
const CHECK_SCRIPT = path.join(PROJECT_ROOT, "scripts", "inference", "check_environment.py");
const VENV_PYTHON = path.join(
  PROJECT_ROOT,
  ".venv-ophthalmic",
  process.platform === "win32" ? "Scripts" : "bin",
  process.platform === "win32" ? "python.exe" : "python3"
);

/** Cold start is ~7s; allow a wide bounded margin under host contention. */
const INFERENCE_TIMEOUT_MS = 180_000;
/** Torch import dominates the env probe; still bounded. */
const ENV_CHECK_TIMEOUT_MS = 90_000;
/** Hard cap on probe stdout (regions are bounded to 10k; this is 10x headroom). */
const MAX_STDOUT_BYTES = 32 * 1024 * 1024;
const PROBE_THREADS = 4;

export interface FundusLesionEnvironment {
  ready: boolean;
  python_version: string | null;
  packages: Record<string, { available: boolean; version?: string; error?: string }>;
  missing: string[];
  check_error?: string;
}

/** Serializes local lesion inference: one ~1.3 GB-RSS worker at a time. */
let inferenceMutex: Promise<void> = Promise.resolve();

function runWithMutex<T>(work: () => Promise<T>): Promise<T> {
  const run = inferenceMutex.then(work, work);
  // The chain itself must never reject or every later caller would inherit it.
  inferenceMutex = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function spawnBounded(
  command: string,
  args: string[],
  timeoutMs: number
): Promise<{ code: number | null; stdout: string; stderr: string; truncated: boolean } | { spawnError: Error }> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let truncated = false;
    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn(command, args, { timeout: timeoutMs, env: buildThreadGovernedEnv(PROBE_THREADS) });
    } catch (err) {
      resolve({ spawnError: err instanceof Error ? err : new Error(String(err)) });
      return;
    }
    const releaseTrackedProcess = trackChildProcess(proc);
    if (!proc.stdout || !proc.stderr) {
      releaseTrackedProcess();
      resolve({ spawnError: new Error("Child-process stdio streams are unavailable.") });
      return;
    }
    proc.stdout.on("data", (d: Buffer) => {
      if (stdout.length < MAX_STDOUT_BYTES) {
        stdout += d.toString("utf8");
        if (stdout.length >= MAX_STDOUT_BYTES) truncated = true;
      } else {
        truncated = true;
      }
    });
    proc.stderr.on("data", (d: Buffer) => {
      // Bounded stderr tail only - never mixed into stdout parsing.
      const s = d.toString("utf8");
      stderr = (stderr + s).slice(-4000);
    });
    proc.on("error", (err) => {
      if (!settled) {
        settled = true;
        resolve({ spawnError: err });
      }
    });
    proc.on("close", (code) => {
      if (!settled) {
        settled = true;
        resolve({ code, stdout, stderr, truncated });
      }
    });
  });
}

/**
 * Live readiness of the dedicated lesion runtime. Reports the machine's
 * actual state (isolated venv interpreter, pinned packages) - never a
 * simulation. Fails closed on any spawn/timeout/parse error.
 */
export async function checkFundusLesionEnvironment(): Promise<FundusLesionEnvironment> {
  if (!fs.existsSync(VENV_PYTHON)) {
    return { ready: false, python_version: null, packages: {}, missing: [], check_error: "Dedicated ophthalmic interpreter is not installed." };
  }
  const result = await spawnBounded(VENV_PYTHON, ["-I", "-s", CHECK_SCRIPT, "--profile", "fundus-lesion"], ENV_CHECK_TIMEOUT_MS);
  if ("spawnError" in result) {
    return { ready: false, python_version: null, packages: {}, missing: [], check_error: `Environment probe failed to spawn: ${result.spawnError.message}` };
  }
  try {
    const parsed = JSON.parse(result.stdout.trim()) as {
      python_version: string;
      packages: FundusLesionEnvironment["packages"];
      missing: string[];
      ready: boolean;
    };
    return {
      ready: parsed.ready === true && (parsed.missing ?? []).length === 0,
      python_version: parsed.python_version ?? null,
      packages: parsed.packages ?? {},
      missing: parsed.missing ?? [],
    };
  } catch {
    return { ready: false, python_version: null, packages: {}, missing: [], check_error: `Environment probe returned unparseable output (exit ${result.code}).` };
  }
}

function studyLaterality(eye: string): "OD" | "OS" | "both" | "unknown" {
  const e = (eye ?? "").toUpperCase();
  if (e === "OD" || e === "RIGHT") return "OD";
  if (e === "OS" || e === "LEFT") return "OS";
  if (e === "OU" || e === "BOTH" || e === "BILATERAL") return "both";
  return "unknown";
}

/** Laterality for a study, derived from DECLARED study eye only - never pixels. */
export function lateralityForStudy(study: NormalizedStudy): "OD" | "OS" | "both" | "unknown" {
  return studyLaterality(study.eye ?? "unknown");
}

const CLASS_LABELS: Record<string, string> = {
  cotton_wool_spot: "cotton-wool-spot-like region",
  hard_exudate: "hard-exudate-like region",
  retinal_hemorrhage: "hemorrhage-like region",
  microaneurysm_like_lesion: "microaneurysm-like region",
};

/** Strict transport output -> RawModelOutput. No scores are invented. */
export function lesionOutputToRaw(
  output: FundusLesionSegmentationOutput,
  studyId: string,
  laterality: "OD" | "OS" | "both" | "unknown"
): RawModelOutput {
  return {
    study_id: studyId,
    model_id: output.model_id,
    model_version: output.model_version,
    artifact_sha256: output.artifact_sha256 || FUNDUS_LESION_ARTIFACT_SHA256,
    preprocessing_version: output.preprocessing_version || FUNDUS_LESION_PREPROCESSING_VERSION,
    modality: "FUNDUS",
    laterality,
    inference_status: "completed",
    ood_status: "unknown",
    quality_status: "unknown",
    findings: output.lesion_regions.map((r) => ({
      finding_type: r.class_name,
      laterality,
      location: "retina",
      severity: "indeterminate" as const,
      // No confidence: argmax components are uncalibrated by construction.
      localization: { kind: "bounding_box" as const, coordinates: { ...r.bounding_box } },
      evidence: `Research-model localization of a ${CLASS_LABELS[r.class_name] ?? r.class_name} (component area ${r.area_pixels} model-raster px). UNFILTERED_ARGMAX_COMPONENT_NOT_VALIDATED_AS_LESION - requires ophthalmic review; not a diagnosis.`,
    })),
    limitations: [...output.limitations],
  };
}

async function runProbeOnce(
  imageBytes: Buffer,
  studyId: string,
  laterality: "OD" | "OS" | "both" | "unknown"
): Promise<RawModelOutput> {
  // Re-verify the package immediately before execution (TOCTOU-aware: the
  // probe also re-hashes the artifact after loading it).
  const pkg = loadModelPackage(FUNDUS_LESION_MODEL_ID);
  if (!pkg.ok) {
    return { inference_status: "failed", inference_error: `Lesion package verification failed at execution time: ${pkg.reasons.join(" ").slice(0, 250)}` };
  }
  let tmpFile: string | null = null;
  try {
    ensureDirs();
    tmpFile = path.join(TMP_ROOT, `lesion_${newId("img")}.bin`);
    fs.writeFileSync(tmpFile, imageBytes, { mode: 0o600 });
    const packageDir = path.join(MODEL_ROOT, FUNDUS_LESION_MODEL_ID);
    const result = await spawnBounded(
      VENV_PYTHON,
      ["-I", "-s", PROBE_SCRIPT, packageDir, tmpFile, "--threads", String(PROBE_THREADS)],
      INFERENCE_TIMEOUT_MS
    );
    if ("spawnError" in result) {
      return { inference_status: "failed", inference_error: `Failed to spawn lesion worker: ${result.spawnError.message.slice(0, 200)}` };
    }
    if (result.truncated) {
      return { inference_status: "failed", inference_error: "Lesion worker output exceeded the bounded stdout limit; output rejected." };
    }
    if (result.code !== 0) {
      return { inference_status: "failed", inference_error: `Lesion worker exited non-zero (${result.code ?? "unknown"}); output rejected.` };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.stdout.trim());
    } catch {
      return { inference_status: "failed", inference_error: `Unparseable lesion worker output (exit ${result.code}): ${(result.stdout || result.stderr).slice(0, 250)}` };
    }
    if (parsed && typeof parsed === "object" && (parsed as { inference_status?: string }).inference_status === "failed") {
      const err = (parsed as { inference_error?: string }).inference_error ?? "Lesion worker reported failure.";
      return { inference_status: "failed", inference_error: err.slice(0, 300), limitations: (parsed as { limitations?: string[] }).limitations };
    }
    const contract = validateFundusLesionSegmentationOutput(parsed);
    if (!contract.valid) {
      return { inference_status: "failed", inference_error: `Lesion worker output failed the strict transport contract: ${contract.errors.map((e) => `${e.path} ${e.message}`).join("; ").slice(0, 300)}` };
    }
    const output = parsed as FundusLesionSegmentationOutput;
    if (output.model_version !== FUNDUS_LESION_MODEL_VERSION) {
      return { inference_status: "failed", inference_error: "Lesion worker model version does not match the pinned revision." };
    }
    return lesionOutputToRaw(output, studyId, laterality);
  } catch (err) {
    return { inference_status: "failed", inference_error: `Lesion worker execution failed closed: ${String(err instanceof Error ? err.message : err).slice(0, 200)}` };
  } finally {
    if (tmpFile) {
      try {
        fs.unlinkSync(tmpFile);
      } catch {
        // Best-effort cleanup; a leftover temp file is contained in data/tmp
        // and never executed or served.
      }
    }
  }
}

export interface FundusLesionResearchRun {
  raw: RawModelOutput;
  findings: Finding[];
  notes: string[];
  model: ModelRecord;
  gate: ModelGateResult;
  integrity: IntegrityResult;
}

/**
 * Single serialized lesion analysis run shared by the provider interface
 * and the live pipeline, so the pipeline can use BOTH the converted
 * findings and the raw output (for the fundus-abnormality layer) from ONE
 * inference execution. Throws when the model may not run at all
 * (unregistered / gated); returns failed-raw with zero findings for any
 * runtime failure (no bytes, wrong modality, worker failure).
 */
export async function runFundusLesionResearchAnalysis(
  study: NormalizedStudy,
  ctx: ModelAnalysisContext
): Promise<FundusLesionResearchRun> {
  const { model, gate } = await gateOrThrow(FUNDUS_LESION_MODEL_ID, ctx.device);
  const modCheck = checkModalitySupported(model, study.modality);
  const integrity = verifyModelIntegrity(FUNDUS_LESION_MODEL_ID);
  if (!modCheck.ok) {
    return {
      raw: { inference_status: "failed", inference_error: modCheck.reason! },
      findings: [],
      notes: [modCheck.reason!],
      model,
      gate,
      integrity: { trusted: false, checks: [{ check: "modality", passed: false, detail: modCheck.reason! }], model },
    };
  }
  const imageBytes = ctx.imageBytes;
  if (!imageBytes || imageBytes.length === 0) {
    return {
      raw: { inference_status: "failed", inference_error: "no-image-bytes" },
      findings: [],
      notes: ["No image bytes were supplied to the lesion provider - no inference attempted (fail closed)."],
      model,
      gate,
      integrity,
    };
  }
  // Device compatibility remains explicitly UNKNOWN for this IMAGE_ONLY
  // research model because no allowlist exists. The per-study gate records
  // that policy; this disclosure is retained in the raw run notes.
  const deviceNote = deviceCompatible(model, ctx.device ?? null);
  const disclosure = `Device compatibility: ${deviceNote.note} Domain validation: DOMAIN_VALIDATION_UNKNOWN.`;
  const imageHash = assetHash(imageBytes);
  if (ctx.cacheProvenance?.roiHash && ctx.cacheProvenance.roiHash.toLowerCase() !== imageHash) {
    throw new Error("Cache ROI hash does not match immutable inference bytes");
  }
  const cacheKey = inferenceCacheKey({
    scope: study.studyId,
    contentHash: ctx.cacheProvenance?.contentHash ?? imageHash,
    roiHash: ctx.cacheProvenance?.roiHash ?? null,
    modelId: model.model_id,
    modelVersion: model.version,
    preprocessingVersion: FUNDUS_LESION_PREPROCESSING_VERSION,
    eye: lateralityForStudy(study),
  });
  const probe = await runWithMutex(async () => {
    if (integrity.trusted) {
      const hit = getInferenceCache<{ raw: RawModelOutput }>(cacheKey);
      if (hit) return { ...hit, cacheHit: true };
    }
    const raw = await runProbeOnce(imageBytes, study.studyId, lateralityForStudy(study));
    if (integrity.trusted && raw.inference_status === "completed") setInferenceCache(cacheKey, { raw });
    return { raw, cacheHit: false };
  });
  const raw = probe.raw;
  if (raw.inference_status === "failed") {
    return {
      raw,
      findings: [],
      notes: [raw.inference_error ?? "Lesion inference failed; no findings produced.", disclosure, ...(probe.cacheHit ? ["Inference cache hit (content/model/preprocessing/study scoped)."] : [])],
      model,
      gate,
      integrity,
    };
  }
  const conversion = convertRawModelOutputToFindings({ raw, study_id: study.studyId, model, calibration: null });
  if (!conversion.ok) {
    return { raw, findings: [], notes: [...conversion.notes, disclosure], model, gate, integrity };
  }
  return {
    raw,
    findings: conversion.findings,
    notes: [
      ...conversion.notes,
      ...(probe.cacheHit ? ["Inference cache hit (content/model/preprocessing/study scoped)."] : []),
      "Research output only (RESEARCH status): uncalibrated argmax regions, not validated lesions; requires ophthalmic review.",
      disclosure,
    ],
    model,
    gate,
    integrity,
  };
}

export class FundusLesionLocalProvider implements EyeModelProvider {
  readonly providerId = "local-fundus-lesion";
  readonly modelId = FUNDUS_LESION_MODEL_ID;

  async loadModel(): Promise<void> {
    // Registry gate first (context-free: no per-study device yet).
    await gateOrThrow(this.modelId);
    // Installed-package verification: manifest match + artifact SHA-256.
    const pkg = loadModelPackage(this.modelId);
    if (!pkg.ok) {
      throw new Error(`Lesion model package failed verification: ${pkg.reasons.join(" ").slice(0, 300)}`);
    }
    // Live runtime readiness on THIS machine.
    const env = await checkFundusLesionEnvironment();
    if (!env.ready) {
      throw new Error(
        `Lesion inference runtime is not ready${env.missing.length ? ` - missing: ${env.missing.join(", ")}` : ""}${env.check_error ? ` (${env.check_error})` : ""}`
      );
    }
  }

  async validateModel(): Promise<IntegrityResult & { gate: ModelGateResult }> {
    const integrity = verifyModelIntegrity(this.modelId);
    const env = await checkFundusLesionEnvironment();
    const model = getModel(this.modelId);
    const gate = model ? gateModelUse(model) : { allowed: false, reasons: ["Model not registered."], label: null, findings_use: "none" };
    const checks: IntegrityResult["checks"] = [
      ...integrity.checks,
      {
        check: "python_environment",
        passed: env.ready,
        detail: env.ready
          ? `Isolated lesion runtime ready (Python ${env.python_version ?? "unknown"}).`
          : (env.check_error ?? `Missing packages: ${env.missing.join(", ")}`),
      },
    ];
    return { trusted: integrity.trusted && env.ready && gate.allowed, checks, model, gate };
  }

  async analyzeStudy(study: NormalizedStudy, ctx: ModelAnalysisContext): Promise<ModelAnalysisOutput> {
    const run = await runFundusLesionResearchAnalysis(study, ctx);
    return {
      findings: run.findings,
      per_model_metadata: {
        model_id: run.model.model_id,
        model_version: run.model.version,
        validation_status: run.model.status,
        display_label: run.gate.label,
        integrity: run.integrity,
      },
      notes: run.notes,
    };
  }

  async getCapabilities(): Promise<ModelCapabilities> {
    return {
      model_id: this.modelId,
      modalities: ["FUNDUS"],
      supported_findings: ["cotton_wool_spot", "hard_exudate", "retinal_hemorrhage", "microaneurysm_like_lesion"],
      supports_measurements: false,
      supports_localization: true,
      calibration_available: false,
    };
  }

  async getModelMetadata(): Promise<ModelRecord | null> {
    return getModel(this.modelId) ?? null;
  }

  async unloadModel(): Promise<void> {
    // Short-lived subprocess per analysis: nothing stays loaded.
  }
}
