/**
 * DR-grade local provider (RESEARCH).
 *
 * Runs the hash-verified ClementP DR-grading checkpoint (EfficientNet-B0,
 * single regression logit, rounded to ICDR grades 0-4) as a short-lived,
 * isolated, offline Python subprocess. Same HARD RULES as
 * fundusLesionLocalProvider.ts: image bytes in, SafeTensors only,
 * package verified before every spawn, serialized execution, fail closed,
 * RESEARCH observations only, never probabilities, never diagnoses.
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
  DR_GRADE_MODEL_ID,
  DR_GRADE_MODEL_VERSION,
  DR_GRADE_ARTIFACT_SHA256,
  DR_GRADE_PREPROCESSING_VERSION,
  validateDrGradeWorkerOutput,
  type DrGradeWorkerOutput,
} from "./drGradeContract";
import { convertRawModelOutputToFindings } from "./outputConversion";
import type { RawModelOutput } from "./outputContract";
import type { Finding } from "../analysis/schema";
import { lateralityForStudy } from "./fundusLesionLocalProvider";
import { assetHash } from "../assets/assetRouter";
import { getInferenceCache, inferenceCacheKey, setInferenceCache } from "./inferenceCache";
import { trackChildProcess } from "../jobs/processControl";

const PROBE_SCRIPT = path.join(PROJECT_ROOT, "scripts", "inference", "dr_grade_probe.py");
const VENV_PYTHON = path.join(
  PROJECT_ROOT,
  ".venv-ophthalmic",
  process.platform === "win32" ? "Scripts" : "bin",
  process.platform === "win32" ? "python.exe" : "python3"
);

const INFERENCE_TIMEOUT_MS = 120_000;
const MAX_STDOUT_BYTES = 1 * 1024 * 1024;
const PROBE_THREADS = 4;

let inferenceMutex: Promise<void> = Promise.resolve();

function runWithMutex<T>(work: () => Promise<T>): Promise<T> {
  const run = inferenceMutex.then(work, work);
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
      proc = spawn(command, args, { timeout: timeoutMs });
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
      stderr = (stderr + d.toString("utf8")).slice(-4000);
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

/** Strict transport output -> RawModelOutput. The logit stays a MODEL_SCORE; no confidence is set.
 *
 * A grade-0 estimate emits NO finding: it is the model's lowest output, not
 * a detected signal (mirrors the lesion detector's NO_TARGET behavior, which
 * also yields zero findings). The grade itself always lives in
 * dr_assessment. Grades 1-4 emit exactly one observation-level finding.
 */
export function drOutputToRaw(
  output: DrGradeWorkerOutput,
  studyId: string,
  laterality: "OD" | "OS" | "both" | "unknown"
): RawModelOutput {
  const findings =
    output.predicted_grade >= 1
      ? [
          {
            finding_type: "dr_grade_estimate",
            laterality,
            location: "retina",
            severity: "indeterminate" as const,
            localization: null,
            evidence:
              `Research-model DR grade estimate ${output.predicted_grade}/4 (${output.grade_label.replaceAll("_", " ")}; ` +
              `model score ${output.raw_logit.toFixed(3)}, NOT a probability; referable-threshold (>=2): ${output.referable_dr ? "met" : "not met"}). ` +
              `UNCALIBRATED_RESEARCH_GRADE_ESTIMATE - requires ophthalmic review; not a diagnosis.`,
          },
        ]
      : [];
  return {
    study_id: studyId,
    model_id: output.model_id,
    model_version: output.model_version,
    artifact_sha256: output.artifact_sha256 || DR_GRADE_ARTIFACT_SHA256,
    preprocessing_version: output.preprocessing_version || DR_GRADE_PREPROCESSING_VERSION,
    modality: "FUNDUS",
    laterality,
    inference_status: "completed",
    ood_status: "unknown",
    quality_status: "unknown",
    findings,
    limitations: [...output.limitations],
  };
}

async function runProbeOnce(imageBytes: Buffer, studyId: string, laterality: "OD" | "OS" | "both" | "unknown"): Promise<{ raw: RawModelOutput; worker: DrGradeWorkerOutput | null }> {
  const pkg = loadModelPackage(DR_GRADE_MODEL_ID);
  if (!pkg.ok) {
    return { raw: { inference_status: "failed", inference_error: `DR package verification failed at execution time: ${pkg.reasons.join(" ").slice(0, 250)}` }, worker: null };
  }
  let tmpFile: string | null = null;
  try {
    ensureDirs();
    tmpFile = path.join(TMP_ROOT, `drgrade_${newId("img")}.bin`);
    fs.writeFileSync(tmpFile, imageBytes, { mode: 0o600 });
    const packageDir = path.join(MODEL_ROOT, DR_GRADE_MODEL_ID);
    const result = await spawnBounded(
      VENV_PYTHON,
      ["-I", "-s", PROBE_SCRIPT, packageDir, tmpFile, "--threads", String(PROBE_THREADS)],
      INFERENCE_TIMEOUT_MS
    );
    if ("spawnError" in result) {
      return { raw: { inference_status: "failed", inference_error: `Failed to spawn DR worker: ${result.spawnError.message.slice(0, 200)}` }, worker: null };
    }
    if (result.truncated) {
      return { raw: { inference_status: "failed", inference_error: "DR worker output exceeded the bounded stdout limit; output rejected." }, worker: null };
    }
    if (result.code !== 0) {
      return { raw: { inference_status: "failed", inference_error: `DR worker exited non-zero (${result.code ?? "unknown"}); output rejected.` }, worker: null };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.stdout.trim());
    } catch {
      return { raw: { inference_status: "failed", inference_error: `Unparseable DR worker output (exit ${result.code}): ${(result.stdout || result.stderr).slice(0, 250)}` }, worker: null };
    }
    if (parsed && typeof parsed === "object" && (parsed as { inference_status?: string }).inference_status === "failed") {
      const err = (parsed as { inference_error?: string }).inference_error ?? "DR worker reported failure.";
      return { raw: { inference_status: "failed", inference_error: err.slice(0, 300), limitations: (parsed as { limitations?: string[] }).limitations }, worker: null };
    }
    const contract = validateDrGradeWorkerOutput(parsed);
    if (!contract.valid) {
      return { raw: { inference_status: "failed", inference_error: `DR worker output failed the strict transport contract: ${contract.errors.map((e) => `${e.path} ${e.message}`).join("; ").slice(0, 300)}` }, worker: null };
    }
    const output = parsed as DrGradeWorkerOutput;
    if (output.model_version !== DR_GRADE_MODEL_VERSION) {
      return { raw: { inference_status: "failed", inference_error: "DR worker model version does not match the pinned revision." }, worker: null };
    }
    return { raw: drOutputToRaw(output, studyId, laterality), worker: output };
  } catch (err) {
    return { raw: { inference_status: "failed", inference_error: `DR worker execution failed closed: ${String(err instanceof Error ? err.message : err).slice(0, 200)}` }, worker: null };
  } finally {
    if (tmpFile) {
      try {
        fs.unlinkSync(tmpFile);
      } catch {
        // Best-effort cleanup; leftovers stay contained in data/tmp.
      }
    }
  }
}

export interface DrGradeResearchRun {
  raw: RawModelOutput;
  grade: DrGradeWorkerOutput | null;
  findings: Finding[];
  notes: string[];
  model: ModelRecord;
  gate: ModelGateResult;
  integrity: IntegrityResult;
}

export async function runDrGradeResearchAnalysis(
  study: NormalizedStudy,
  ctx: ModelAnalysisContext
): Promise<DrGradeResearchRun> {
  const { model, gate } = await gateOrThrow(DR_GRADE_MODEL_ID, ctx.device);
  const modCheck = checkModalitySupported(model, study.modality);
  const integrity = verifyModelIntegrity(DR_GRADE_MODEL_ID);
  if (!modCheck.ok) {
    return {
      raw: { inference_status: "failed", inference_error: modCheck.reason! },
      grade: null,
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
      grade: null,
      findings: [],
      notes: ["No image bytes were supplied to the DR provider - no inference attempted (fail closed)."],
      model,
      gate,
      integrity,
    };
  }
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
    preprocessingVersion: DR_GRADE_PREPROCESSING_VERSION,
    eye: lateralityForStudy(study),
  });
  const probe = await runWithMutex(async () => {
    if (integrity.trusted) {
      const hit = getInferenceCache<{ raw: RawModelOutput; worker: DrGradeWorkerOutput | null }>(cacheKey);
      if (hit) return { ...hit, cacheHit: true };
    }
    const result = await runProbeOnce(imageBytes, study.studyId, lateralityForStudy(study));
    if (integrity.trusted && result.raw.inference_status === "completed") setInferenceCache(cacheKey, result);
    return { ...result, cacheHit: false };
  });
  const { raw, worker } = probe;
  if (raw.inference_status === "failed") {
    return {
      raw,
      grade: null,
      findings: [],
      notes: [raw.inference_error ?? "DR inference failed; no findings produced.", disclosure, ...(probe.cacheHit ? ["Inference cache hit (content/model/preprocessing/study scoped)."] : [])],
      model,
      gate,
      integrity,
    };
  }
  const conversion = convertRawModelOutputToFindings({ raw, study_id: study.studyId, model, calibration: null });
  if (!conversion.ok) {
    return { raw, grade: null, findings: [], notes: [...conversion.notes, disclosure], model, gate, integrity };
  }
  return {
    raw,
    grade: worker,
    findings: conversion.findings,
    notes: [
      ...conversion.notes,
      ...(probe.cacheHit ? ["Inference cache hit (content/model/preprocessing/study scoped)."] : []),
      "Research output only (RESEARCH status): uncalibrated grade estimate, not a diagnosis; requires ophthalmic review.",
      disclosure,
    ],
    model,
    gate,
    integrity,
  };
}

export class DrGradeLocalProvider implements EyeModelProvider {
  readonly providerId = "local-dr-grade";
  readonly modelId = DR_GRADE_MODEL_ID;

  async loadModel(): Promise<void> {
    await gateOrThrow(this.modelId);
    const pkg = loadModelPackage(this.modelId);
    if (!pkg.ok) {
      throw new Error(`DR model package failed verification: ${pkg.reasons.join(" ").slice(0, 300)}`);
    }
  }

  async validateModel(): Promise<IntegrityResult & { gate: ModelGateResult }> {
    const integrity = verifyModelIntegrity(this.modelId);
    const model = getModel(this.modelId);
    const gate = model ? gateModelUse(model) : { allowed: false, reasons: ["Model not registered."], label: null, findings_use: "none" };
    return { trusted: integrity.trusted && gate.allowed, checks: integrity.checks, model, gate };
  }

  async analyzeStudy(study: NormalizedStudy, ctx: ModelAnalysisContext): Promise<ModelAnalysisOutput> {
    const run = await runDrGradeResearchAnalysis(study, ctx);
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
      supported_findings: ["dr_grade_estimate"],
      supports_measurements: false,
      supports_localization: false,
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
