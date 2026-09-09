/**
 * OCT retinal-class local provider (RESEARCH).
 *
 * Runs the hash-verified ONNX OCT classifier (EfficientNetV2L + MHA
 * backbone, 4 logits) via onnxruntime CPUExecutionProvider in a
 * short-lived, isolated, offline Python subprocess. Same HARD RULES as the
 * fundus providers: image bytes in, artifact verified before every spawn,
 * serialized execution, fail closed, RESEARCH observations only, never
 * probabilities, never diagnoses. Classification-only: no localization is
 * ever produced (no overlay is rendered for this model).
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
  OCT_MODEL_ID,
  OCT_MODEL_VERSION,
  OCT_PREPROCESSING_VERSION,
  validateOctWorkerOutput,
  type OctWorkerOutput,
} from "./octContract";
import { convertRawModelOutputToFindings } from "./outputConversion";
import type { RawModelOutput } from "./outputContract";
import type { Finding } from "../analysis/schema";
import { lateralityForStudy } from "./fundusLesionLocalProvider";
import { assetHash } from "../assets/assetRouter";
import { getInferenceCache, inferenceCacheKey, setInferenceCache } from "./inferenceCache";

const PROBE_SCRIPT = path.join(PROJECT_ROOT, "scripts", "inference", "oct_retinal_probe.py");
const VENV_PYTHON = path.join(
  PROJECT_ROOT,
  ".venv-ophthalmic",
  process.platform === "win32" ? "Scripts" : "bin",
  process.platform === "win32" ? "python.exe" : "python3"
);

const INFERENCE_TIMEOUT_MS = 120_000;
const MAX_STDOUT_BYTES = 1 * 1024 * 1024;

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
    if (!proc.stdout || !proc.stderr) {
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

const CLASS_LABELS: Record<string, string> = {
  CNV: "choroidal-neovascularization-like pattern",
  DME: "diabetic-macular-edema-like pattern",
  DRUSEN: "drusen-like pattern",
  NORMAL: "no-target-class pattern",
};

/** Strict transport output -> RawModelOutput. Logits stay MODEL_SCOREs; no confidence is set.
 *
 * A NORMAL estimate emits NO finding (mirrors the DR grade-0 and lesion
 * NO_TARGET rules). The class itself always lives in oct_assessment.
 */
export function octOutputToRaw(
  output: OctWorkerOutput,
  studyId: string,
  laterality: "OD" | "OS" | "both" | "unknown"
): RawModelOutput {
  const findings =
    output.predicted_class !== "NORMAL"
      ? [
          {
            finding_type: "oct_retinal_class_estimate",
            laterality,
            location: "macula",
            severity: "indeterminate" as const,
            localization: null,
            evidence:
              `Research-model OCT class estimate: ${output.predicted_class} ` +
              `(${(CLASS_LABELS[output.predicted_class] ?? output.predicted_class).replaceAll("_", " ")}; ` +
              `model scores [${output.raw_logits.map((v) => v.toFixed(2)).join(", ")}], NOT probabilities). ` +
              `UNCALIBRATED_RESEARCH_CLASS_ESTIMATE - requires ophthalmic review; not a diagnosis.`,
          },
        ]
      : [];
  return {
    study_id: studyId,
    model_id: output.model_id,
    model_version: output.model_version,
    modality: "OCT",
    laterality,
    inference_status: "completed",
    ood_status: "unknown",
    quality_status: "unknown",
    findings,
    limitations: [...output.limitations],
  };
}

async function runProbeOnce(imageBytes: Buffer, studyId: string, laterality: "OD" | "OS" | "both" | "unknown"): Promise<{ raw: RawModelOutput; worker: OctWorkerOutput | null }> {
  const pkg = loadModelPackage(OCT_MODEL_ID);
  if (!pkg.ok) {
    return { raw: { inference_status: "failed", inference_error: `OCT package verification failed at execution time: ${pkg.reasons.join(" ").slice(0, 250)}` }, worker: null };
  }
  let tmpFile: string | null = null;
  try {
    ensureDirs();
    tmpFile = path.join(TMP_ROOT, `oct_${newId("img")}.bin`);
    fs.writeFileSync(tmpFile, imageBytes, { mode: 0o600 });
    const packageDir = path.join(MODEL_ROOT, OCT_MODEL_ID);
    const result = await spawnBounded(VENV_PYTHON, ["-I", "-s", PROBE_SCRIPT, packageDir, tmpFile], INFERENCE_TIMEOUT_MS);
    if ("spawnError" in result) {
      return { raw: { inference_status: "failed", inference_error: `Failed to spawn OCT worker: ${result.spawnError.message.slice(0, 200)}` }, worker: null };
    }
    if (result.truncated) {
      return { raw: { inference_status: "failed", inference_error: "OCT worker output exceeded the bounded stdout limit; output rejected." }, worker: null };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.stdout.trim());
    } catch {
      return { raw: { inference_status: "failed", inference_error: `Unparseable OCT worker output (exit ${result.code}): ${(result.stdout || result.stderr).slice(0, 250)}` }, worker: null };
    }
    if (parsed && typeof parsed === "object" && (parsed as { inference_status?: string }).inference_status === "failed") {
      const err = (parsed as { inference_error?: string }).inference_error ?? "OCT worker reported failure.";
      return { raw: { inference_status: "failed", inference_error: err.slice(0, 300), limitations: (parsed as { limitations?: string[] }).limitations }, worker: null };
    }
    const contract = validateOctWorkerOutput(parsed);
    if (!contract.valid) {
      return { raw: { inference_status: "failed", inference_error: `OCT worker output failed the strict transport contract: ${contract.errors.map((e) => `${e.path} ${e.message}`).join("; ").slice(0, 300)}` }, worker: null };
    }
    const output = parsed as OctWorkerOutput;
    if (output.model_version !== OCT_MODEL_VERSION) {
      return { raw: { inference_status: "failed", inference_error: "OCT worker model version does not match the pinned revision." }, worker: null };
    }
    return { raw: octOutputToRaw(output, studyId, laterality), worker: output };
  } catch (err) {
    return { raw: { inference_status: "failed", inference_error: `OCT worker execution failed closed: ${String(err instanceof Error ? err.message : err).slice(0, 200)}` }, worker: null };
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

export interface OctResearchRun {
  raw: RawModelOutput;
  oct: OctWorkerOutput | null;
  findings: Finding[];
  notes: string[];
  model: ModelRecord;
  gate: ModelGateResult;
  integrity: IntegrityResult;
}

export async function runOctResearchAnalysis(
  study: NormalizedStudy,
  ctx: ModelAnalysisContext
): Promise<OctResearchRun> {
  const { model, gate } = await gateOrThrow(OCT_MODEL_ID);
  const modCheck = checkModalitySupported(model, study.modality);
  const integrity = verifyModelIntegrity(OCT_MODEL_ID);
  if (!modCheck.ok) {
    return {
      raw: { inference_status: "failed", inference_error: modCheck.reason! },
      oct: null,
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
      oct: null,
      findings: [],
      notes: ["No image bytes were supplied to the OCT provider - no inference attempted (fail closed)."],
      model,
      gate,
      integrity,
    };
  }
  const deviceNote = deviceCompatible(model, ctx.device ?? null);
  const disclosure = `Device compatibility: ${deviceNote.note} Domain validation: DOMAIN_VALIDATION_UNKNOWN.`;
  const cacheKey = inferenceCacheKey({
    scope: study.studyId,
    sourceHash: assetHash(imageBytes),
    modelId: model.model_id,
    modelVersion: model.version,
    preprocessingVersion: OCT_PREPROCESSING_VERSION,
    eye: lateralityForStudy(study),
  });
  const probe = await runWithMutex(async () => {
    if (integrity.trusted) {
      const hit = getInferenceCache<{ raw: RawModelOutput; worker: OctWorkerOutput | null }>(cacheKey);
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
      oct: null,
      findings: [],
      notes: [raw.inference_error ?? "OCT inference failed; no findings produced.", disclosure, ...(probe.cacheHit ? ["Inference cache hit (content/model/preprocessing/study scoped)."] : [])],
      model,
      gate,
      integrity,
    };
  }
  const conversion = convertRawModelOutputToFindings({ raw, study_id: study.studyId, model, calibration: null });
  if (!conversion.ok) {
    return { raw, oct: null, findings: [], notes: [...conversion.notes, disclosure], model, gate, integrity };
  }
  return {
    raw,
    oct: worker,
    findings: conversion.findings,
    notes: [
      ...conversion.notes,
      ...(probe.cacheHit ? ["Inference cache hit (content/model/preprocessing/study scoped)."] : []),
      "Research output only (RESEARCH status): uncalibrated class estimate, not a diagnosis; requires ophthalmic review.",
      disclosure,
    ],
    model,
    gate,
    integrity,
  };
}

export class OctLocalProvider implements EyeModelProvider {
  readonly providerId = "local-oct-retinal";
  readonly modelId = OCT_MODEL_ID;

  async loadModel(): Promise<void> {
    await gateOrThrow(this.modelId);
    const pkg = loadModelPackage(this.modelId);
    if (!pkg.ok) {
      throw new Error(`OCT model package failed verification: ${pkg.reasons.join(" ").slice(0, 300)}`);
    }
  }

  async validateModel(): Promise<IntegrityResult & { gate: ModelGateResult }> {
    const integrity = verifyModelIntegrity(this.modelId);
    const model = getModel(this.modelId);
    const gate = model ? gateModelUse(model) : { allowed: false, reasons: ["Model not registered."], label: null, findings_use: "none" };
    return { trusted: integrity.trusted && gate.allowed, checks: integrity.checks, model, gate };
  }

  async analyzeStudy(study: NormalizedStudy, ctx: ModelAnalysisContext): Promise<ModelAnalysisOutput> {
    const run = await runOctResearchAnalysis(study, ctx);
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
      modalities: ["OCT"],
      supported_findings: ["oct_retinal_class_estimate"],
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
