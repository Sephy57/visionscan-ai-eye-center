#!/usr/bin/env node

/**
 * Freeze the current DR baseline from already-recorded repository evidence.
 *
 * This is an evidence-packaging command only. It never downloads a model,
 * starts inference, changes registry state, or promotes a candidate.
 *
 * Usage:
 *   node scripts/model-competition/freeze-dr-baseline.mjs
 *   node scripts/model-competition/freeze-dr-baseline.mjs --output-dir <dir>
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MODEL_MANIFEST = "data/models/fundus-dr-grading-effb0/manifest.json";
const VALIDATION_SUMMARY = "docs/model-validation/validation-summary.json";
const DATASET_EXPORT = "docs/evaluations/deepdr-external-20260908-raw.json";
const PREPROCESSING_IMPLEMENTATION = "scripts/inference/dr_grade_probe.py";
const MODEL_ID = "fundus-dr-grading-effb0";
const MODEL_VERSION = "aa5741419b90";
const MODEL_SHA256 = "0d9a18b0cb6c90d1f30bf2e66153b368bd7ff0bcb45b6690e8d5ce14fa19f69b";
const PREPROCESSING_VERSION = "clementp-dr-source-pinned-512-v1";

function read(relativePath) {
  const absolute = path.join(ROOT, relativePath);
  if (!fs.existsSync(absolute)) throw new Error(`Required evidence file is missing: ${relativePath}`);
  return { relativePath, absolute, bytes: fs.readFileSync(absolute) };
}

function parse(relativePath) {
  return JSON.parse(read(relativePath).bytes.toString("utf8"));
}

function hash(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function canonical(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") { if (!Number.isFinite(value)) throw new Error("Non-finite number cannot be hashed"); return value; }
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  throw new Error("Unsupported value in canonical JSON");
}

function canonicalHash(value) {
  return hash(Buffer.from(JSON.stringify(canonical(value)), "utf8"));
}

function wilson(successes, trials) {
  if (!Number.isInteger(successes) || !Number.isInteger(trials) || trials <= 0 || successes < 0 || successes > trials) return null;
  const z = 1.959963984540054;
  const p = successes / trials;
  const z2 = z * z;
  const denominator = 1 + z2 / trials;
  const center = (p + z2 / (2 * trials)) / denominator;
  const margin = (z / denominator) * Math.sqrt((p * (1 - p) / trials) + (z2 / (4 * trials * trials)));
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

function evidence(id, relativePath, role) {
  return { id, path: relativePath, sha256: hash(read(relativePath).bytes), role };
}

function requireEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`);
}

function freezeManifest(input) {
  const manifest = { ...input };
  manifest.semantics_fingerprint = canonicalHash({ task: manifest.task, dataset: manifest.dataset, preprocessing: manifest.preprocessing, protocol: manifest.protocol });
  manifest.manifest_sha256 = canonicalHash(manifest);
  return manifest;
}

function baselineFromEvidence() {
  const model = parse(MODEL_MANIFEST);
  const summary = parse(VALIDATION_SUMMARY);
  const rows = parse(DATASET_EXPORT);
  const modelSummary = summary.models?.find((entry) => entry.model?.model_id === MODEL_ID);
  const validation = modelSummary?.validation;
  if (!modelSummary || !validation) throw new Error("Existing validation summary has no DR baseline entry");
  const validationRows = rows.filter((row) => row.split === "regular-fundus-validation");
  requireEqual(validationRows.length, 400, "DeepDRiD validation row count");
  requireEqual(new Set(validationRows.map((row) => row.patient_id)).size, 100, "DeepDRiD validation patient count");
  requireEqual(model.model_id, MODEL_ID, "model id");
  requireEqual(model.version, MODEL_VERSION, "model version");
  requireEqual(model.artifact.sha256, MODEL_SHA256, "model artifact SHA-256");
  requireEqual(model.input.preprocessing.startsWith(`${PREPROCESSING_VERSION}:`), true, "preprocessing version");
  requireEqual(validation.n, validationRows.length, "summary/export validation count");
  requireEqual(validation.referable.confusion.fn, 101, "recorded referable false negatives");

  const task = {
    target: "ICDR_DR_GRADE",
    modality: "FUNDUS",
    label_space: ["0", "1", "2", "3", "4"],
    referable_threshold_grade: 2,
    grade_rule: "ROUND_CLAMP_0_4",
    score_semantics: "MODEL_SCORE_NOT_CALIBRATED",
    calibration: "NOT_MEASURED",
  };
  const dataset = {
    name: "DeepDRiD regular fundus",
    version: "repository-evidence-20260908",
    split: "regular-fundus-validation",
    case_count: validationRows.length,
    patient_count: 100,
    patient_separation: "PATIENT_SEPARATED_CONFIRMED",
    case_id_source_fields: ["patient_id", "image"],
    result_case_id_policy: "SOURCE_KEYS_MUST_BE_HASHED_OR_STABLE_NON_PHI_IDS",
  };
  const preprocessing = {
    version: PREPROCESSING_VERSION,
    implementation_path: PREPROCESSING_IMPLEMENTATION,
    input_shape: "3x512x512",
    decode: "CV2_IMREAD_COLOR_BGR",
    crop: "CHANNEL_0_THRESHOLD_10_AUTOCROP_DEGENERATE_WHOLE_IMAGE",
    resize: "LONGEST_SIDE_512_INTER_LINEAR",
    pad: "CENTERED_ZERO_PAD_TO_512_SQUARE",
    scale: "DIVIDE_BY_255",
    normalization: "IMAGENET_MEAN_STD_IN_SAME_CHANNEL_ORDER",
    tensor_layout: "HWC_TO_CHW_FLOAT32",
    caveats: ["Publisher used OpenCV 4.9 while the reviewed runtime reports OpenCV 5.0; last-bit resize differences remain possible."],
  };
  const protocol = {
    ground_truth_field: "eye_grade",
    prediction_field: "dr_grade",
    score_field: "dr_logit",
    referable_truth_rule: "GROUND_TRUTH_GRADE_GE_2",
    referable_prediction_rule: "PREDICTED_GRADE_GE_2",
    row_policy: "ALL_ROWS_IN_DECLARED_SPLIT_NO_ADDITIONAL_FILTER",
    score_metrics_policy: "REQUIRE_FINITE_SCORE_ON_EVERY_ROW_OR_REPORT_UNMEASURED",
  };
  const modelRef = {
    role: "BASELINE",
    model_id: MODEL_ID,
    model_version: MODEL_VERSION,
    artifact_path: MODEL_MANIFEST.replace(/\\/g, "/").replace(/\/manifest\.json$/, "/model.safetensors"),
    artifact_sha256: MODEL_SHA256,
    artifact_format: model.artifact.format,
  };
  const refs = [
    evidence("dr-model-manifest", MODEL_MANIFEST, "model_manifest"),
    evidence("dr-validation-summary", VALIDATION_SUMMARY, "validation_summary"),
    evidence("dr-deepdrid-validation-export", DATASET_EXPORT, "dataset_export"),
    evidence("dr-preprocessing-implementation", PREPROCESSING_IMPLEMENTATION, "preprocessing_implementation"),
  ];
  const limitations = [
    ...model.limitations,
    "Frozen from existing repository evidence; no new inference was executed by this command.",
    "The DeepDRiD validation split is a held-out publisher split, not prospective clinical validation or independent external validation.",
    "Device metadata is not recorded in the source export, so device-specific generalization is not measured.",
    "The raw DR logit is a ranking score, not a calibrated probability; calibration metrics are intentionally absent.",
    "APTOS overlap-disclosed comparability evidence is not part of this frozen baseline.",
  ];
  const manifest = freezeManifest({
    format: "visionscan-dr-competition-run-manifest/v1",
    manifest_id: "dr-baseline-deepdrid-regular-validation-20260908",
    state: "FROZEN",
    frozen_at: `${summary.observed_at}T00:00:00.000Z`,
    task, dataset, preprocessing, protocol, model: modelRef, evidence: refs, limitations,
  });
  const metrics = {
    sample_count: validation.n,
    multiclass: {
      accuracy: validation.multiclass.accuracy,
      balanced_accuracy: validation.multiclass.balanced_accuracy,
      macro_f1: validation.multiclass.macro_f1,
      quadratic_weighted_kappa: validation.multiclass.quadratic_weighted_kappa,
      confusion_true_x_pred: validation.multiclass.confusion_true_x_pred,
    },
    referable: {
      confusion: validation.referable.confusion,
      sensitivity: validation.referable.sensitivity,
      specificity: validation.referable.specificity,
      ppv: validation.referable.ppv,
      npv: validation.referable.npv,
      fpr: validation.referable.fpr,
      fnr: validation.referable.fnr,
      auroc: validation.referable.auroc,
      auprc: validation.referable.auprc,
    },
    confidence_intervals: {
      method: "WILSON_95_PERCENT",
      referable: {
        sensitivity: wilson(validation.referable.confusion.tp, validation.referable.confusion.tp + validation.referable.confusion.fn),
        specificity: wilson(validation.referable.confusion.tn, validation.referable.confusion.tn + validation.referable.confusion.fp),
        ppv: wilson(validation.referable.confusion.tp, validation.referable.confusion.tp + validation.referable.confusion.fp),
        npv: wilson(validation.referable.confusion.tn, validation.referable.confusion.tn + validation.referable.confusion.fn),
      },
    },
  };
  const resultWithoutHash = {
    format: "visionscan-dr-competition-run-result/v1",
    result_id: "dr-baseline-result-deepdrid-regular-validation-20260908",
    manifest_id: manifest.manifest_id,
    manifest_sha256: manifest.manifest_sha256,
    semantics_fingerprint: manifest.semantics_fingerprint,
    measurement_state: "MEASURED",
    calculation_method: "COPIED_FROM_EXISTING_EVIDENCE_SUMMARY",
    model: modelRef,
    metrics,
    evidence: refs,
    limitations: ["Metrics are copied from docs/model-validation/validation-summary.json and are not new measurements.", ...limitations],
  };
  return { manifest, result: { ...resultWithoutHash, result_sha256: canonicalHash(resultWithoutHash) } };
}

function main() {
  const args = process.argv.slice(2);
  const outputIndex = args.indexOf("--output-dir");
  const outputDir = outputIndex >= 0 ? args[outputIndex + 1] : null;
  if (outputIndex >= 0 && (!outputDir || outputDir.startsWith("--"))) throw new Error("--output-dir requires a directory");
  const bundle = baselineFromEvidence();
  if (outputDir) {
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, "dr-baseline-run-manifest.json"), `${JSON.stringify(bundle.manifest, null, 2)}\n`);
    fs.writeFileSync(path.join(outputDir, "dr-baseline-run-result.json"), `${JSON.stringify(bundle.result, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify({ status: "FROZEN_BASELINE", ...bundle }, null, 2)}\n`);
}

try { main(); } catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
