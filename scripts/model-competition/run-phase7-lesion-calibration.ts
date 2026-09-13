#!/usr/bin/env -S npx vite-node

/**
 * Patient-separated lesion escalation calibration/evaluation for Phase 7.
 *
 * All row-level joins stay in memory. The persisted artifact contains only
 * split-level aggregates, rule definitions, hashes, and a predeclared
 * selection decision. The model worker is the existing finite serial batch
 * worker; it is not a resident production service.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { PROJECT_ROOT, TMP_ROOT, MODEL_ROOT, ensureDirs } from "../../lib/config";
import { buildThreadGovernedEnv } from "../../lib/runtime";
import { terminateTrackedProcessTrees, trackChildProcess, withProcessTreeScope } from "../../lib/jobs/processControl";
import { getModel } from "../../lib/models/registry";
import { loadModelPackage } from "../../lib/models/package";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATASET_ROOT = path.join(ROOT, "scratch", "datasets", "DeepDRiD", "regular_fundus_images", "regular-fundus-validation");
const IMAGE_ROOT = path.join(DATASET_ROOT, "Images");
const SOURCE_CSV = path.join(DATASET_ROOT, "regular-fundus-validation.csv");
const RAW_EXPORT = path.join(ROOT, "docs", "evaluations", "deepdr-external-20260908-raw.json");
const FAILURE_REGISTRY = path.join(ROOT, "docs", "model-validation", "dr-failure-registry.json");
const OUTPUT = path.join(ROOT, "docs", "generated", "model-competition", "phase7-lesion-calibration-20260913", "calibration.json");
const BATCH_SCRIPT = path.join(PROJECT_ROOT, "scripts", "inference", "fundus_lesion_batch_probe.py");
const PYTHON = path.join(PROJECT_ROOT, ".venv-ophthalmic", process.platform === "win32" ? "Scripts" : "bin", process.platform === "win32" ? "python.exe" : "python3");
const MODEL_ID = "fundus-lesions-clementp-unet-seresnext50";
const THREADS = 4;
const BATCH_OUTPUT_CONTRACT = "fundus-lesion-segmentation-batch-summary/1";
const BATCH_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_STDOUT_BYTES = 64 * 1024 * 1024;

type SplitName = "calibration" | "evaluation";

interface Observation {
  split: SplitName;
  baselineFn: boolean;
  baselineNonreferablePath: boolean;
  valid: boolean;
  regionCount: number;
  classCounts: Record<string, number>;
}

interface BatchItem {
  index: number;
  inference_status: "completed" | "failed";
  output_contract?: string;
  artifact_sha256?: string;
  region_count?: number;
  class_counts?: Record<string, unknown>;
  service_ms?: number;
}

interface BatchResponse {
  batch_status: "complete";
  output_contract: string;
  model_id: string;
  artifact_sha256: string;
  serial: boolean;
  count: number;
  results: BatchItem[];
}

interface Rule {
  id: string;
  label: string;
  empirical_features: string[];
  predicate: (item: Observation) => boolean;
}

function sha256File(file: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function sha256TextFile(file: string): string {
  // Git may materialize text files as CRLF on Windows. Normalize only source
  // code hashes so the evidence remains reproducible across clean checkouts;
  // dataset/artifact hashes above remain byte hashes.
  return sha256Text(fs.readFileSync(file, "utf8").replaceAll("\r\n", "\n"));
}

function sha256Text(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function json(file: string): any {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function csvRows(file: string): Array<Record<string, string>> {
  const [header, ...lines] = fs.readFileSync(file, "utf8").trim().split(/\r?\n/);
  const fields = header.split(",");
  return lines.filter(Boolean).map((line) => {
    const values = line.split(",");
    return Object.fromEntries(fields.map((field, index) => [field, values[index] ?? ""]));
  });
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function quantile(values: number[], fraction: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))].toFixed(3));
}

function requestedLimit(): number | null {
  const index = process.argv.indexOf("--limit");
  if (index < 0) return null;
  const value = Number(process.argv[index + 1]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function rules(): Rule[] {
  const count = (key: string) => (item: Observation) => (item.classCounts[key] ?? 0) > 0;
  const atLeast = (threshold: number) => (item: Observation) => item.regionCount >= threshold;
  return [
    { id: "any_signal", label: "Any non-background region", empirical_features: ["region_count"], predicate: atLeast(1) },
    { id: "ma_or_he_or_ex", label: "MA-like or HE-like or EX-like", empirical_features: ["class_presence"], predicate: (item) => count("MA-like")(item) || count("HE-like")(item) || count("EX-like")(item) },
    { id: "he_or_ex", label: "HE-like or EX-like", empirical_features: ["class_presence"], predicate: (item) => count("HE-like")(item) || count("EX-like")(item) },
    { id: "ex_only", label: "EX-like only", empirical_features: ["class_presence"], predicate: count("EX-like") },
    { id: "ma_and_ex", label: "MA-like and EX-like", empirical_features: ["class_presence"], predicate: (item) => count("MA-like")(item) && count("EX-like")(item) },
    { id: "he_and_ex", label: "HE-like and EX-like", empirical_features: ["class_presence"], predicate: (item) => count("HE-like")(item) && count("EX-like")(item) },
    { id: "regions_ge_2", label: "At least two regions", empirical_features: ["region_count"], predicate: atLeast(2) },
    { id: "regions_ge_3", label: "At least three regions", empirical_features: ["region_count"], predicate: atLeast(3) },
    { id: "regions_ge_5", label: "At least five regions", empirical_features: ["region_count"], predicate: atLeast(5) },
    { id: "he_or_ex_and_regions_ge_2", label: "HE-like or EX-like and at least two regions", empirical_features: ["class_presence", "region_count"], predicate: (item) => (count("HE-like")(item) || count("EX-like")(item)) && item.regionCount >= 2 },
    { id: "ma_or_he_and_regions_ge_2", label: "MA-like or HE-like and at least two regions", empirical_features: ["class_presence", "region_count"], predicate: (item) => (count("MA-like")(item) || count("HE-like")(item)) && item.regionCount >= 2 },
  ];
}

function validBatchItem(item: BatchItem, artifactSha256: string): boolean {
  if (item.inference_status !== "completed" || item.output_contract !== BATCH_OUTPUT_CONTRACT || item.artifact_sha256 !== artifactSha256) return false;
  if (!Number.isSafeInteger(item.index) || !Number.isSafeInteger(item.region_count) || (item.region_count ?? -1) < 0 || !item.class_counts || typeof item.class_counts !== "object") return false;
  if (typeof item.service_ms !== "number" || !Number.isFinite(item.service_ms) || item.service_ms < 0) return false;
  const classTotal = ["MA-like", "HE-like", "EX-like", "CWS-like"].reduce((sum, key) => sum + numberValue(item.class_counts?.[key]), 0);
  return classTotal === item.region_count;
}

async function runBatchProbe(imagePaths: string[], modelDir: string): Promise<BatchResponse> {
  ensureDirs();
  const manifestPath = path.join(TMP_ROOT, `phase7_lesion_calibration_${process.pid}_${Date.now()}.json`);
  fs.writeFileSync(manifestPath, JSON.stringify(imagePaths.map((imagePath) => ({ image_path: imagePath }))));
  const scope = `phase7-lesion-calibration-${process.pid}`;
  try {
    return await withProcessTreeScope(scope, () => new Promise<BatchResponse>((resolve, reject) => {
      const child = spawn(PYTHON, ["-I", "-s", BATCH_SCRIPT, modelDir, manifestPath, "--threads", String(THREADS)], {
        env: buildThreadGovernedEnv(THREADS),
        cwd: ROOT,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      trackChildProcess(child, scope);
      let stdout = "";
      let stderr = "";
      let overflow = false;
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        void terminateTrackedProcessTrees(scope);
      }, BATCH_TIMEOUT_MS);
      child.stdout?.on("data", (chunk: Buffer | string) => {
        if (overflow) return;
        stdout += chunk.toString();
        if (Buffer.byteLength(stdout, "utf8") > MAX_STDOUT_BYTES) {
          overflow = true;
          void terminateTrackedProcessTrees(scope);
        }
      });
      child.stderr?.on("data", (chunk: Buffer | string) => {
        stderr = (stderr + chunk.toString()).slice(-2_000);
      });
      child.once("error", (error) => { clearTimeout(timer); reject(error); });
      child.once("close", (code) => {
        clearTimeout(timer);
        if (overflow) return reject(new Error("lesion calibration worker exceeded stdout limit"));
        if (timedOut) return reject(new Error("lesion calibration worker exceeded deadline"));
        if (code !== 0) return reject(new Error(`lesion calibration worker failed (${code ?? "unknown"})${stderr ? `: ${stderr}` : ""}`));
        try {
          const parsed = JSON.parse(stdout.trim()) as BatchResponse;
          if (parsed.batch_status !== "complete" || parsed.output_contract !== BATCH_OUTPUT_CONTRACT || !Array.isArray(parsed.results)) throw new Error("invalid batch envelope");
          resolve(parsed);
        } catch (error) {
          reject(new Error(`invalid lesion calibration worker output: ${String(error instanceof Error ? error.message : error)}`));
        }
      });
    }));
  } finally {
    try { fs.unlinkSync(manifestPath); } catch { /* contained scratch cleanup is best effort */ }
  }
}

function measure(items: Observation[], split: SplitName, rule: Rule) {
  const rows = items.filter((item) => item.split === split);
  const fns = rows.filter((item) => item.baselineFn);
  const pathRows = rows.filter((item) => item.baselineNonreferablePath);
  const fnAvailable = fns.filter((item) => item.valid);
  const pathAvailable = pathRows.filter((item) => item.valid);
  const fnSignal = fnAvailable.filter(rule.predicate).length;
  const pathSignal = pathAvailable.filter(rule.predicate).length;
  return {
    rule_id: rule.id,
    rule_label: rule.label,
    fn_input_cases: fns.length,
    fn_available_cases: fnAvailable.length,
    fn_unavailable_cases: fns.length - fnAvailable.length,
    fn_signal_cases: fnSignal,
    fn_review_escalation_coverage: fns.length ? fnSignal / fns.length : null,
    baseline_nonreferable_path_cases: pathRows.length,
    path_available_cases: pathAvailable.length,
    path_unavailable_cases: pathRows.length - pathAvailable.length,
    path_signal_cases: pathSignal,
    review_escalations_per_100_path_cases: pathRows.length ? (pathSignal / pathRows.length) * 100 : null,
    rule_features: rule.empirical_features,
  };
}

function pareto(results: Array<{ rule_id: string; fn_review_escalation_coverage: number | null; review_escalations_per_100_path_cases: number | null }>) {
  return results.filter((candidate) => {
    const candidateCoverage = candidate.fn_review_escalation_coverage;
    const candidateBurden = candidate.review_escalations_per_100_path_cases;
    if (candidateCoverage === null || candidateBurden === null) return false;
    return !results.some((other) => other.rule_id !== candidate.rule_id &&
      other.fn_review_escalation_coverage !== null && other.review_escalations_per_100_path_cases !== null &&
      other.fn_review_escalation_coverage >= candidateCoverage &&
      other.review_escalations_per_100_path_cases <= candidateBurden &&
      (other.fn_review_escalation_coverage > candidateCoverage || other.review_escalations_per_100_path_cases < candidateBurden));
  }).map((item) => ({ rule_id: item.rule_id, fn_review_escalation_coverage: item.fn_review_escalation_coverage, review_escalations_per_100_path_cases: item.review_escalations_per_100_path_cases }));
}

async function main(): Promise<void> {
  for (const file of [SOURCE_CSV, RAW_EXPORT, FAILURE_REGISTRY, BATCH_SCRIPT, PYTHON]) if (!fs.existsSync(file)) throw new Error(`required Phase 7 calibration input unavailable: ${path.basename(file)}`);
  const model = getModel(MODEL_ID);
  if (!model) throw new Error("registered lesion model unavailable");
  const pkg = loadModelPackage(MODEL_ID);
  if (!pkg.ok) throw new Error(`lesion model package failed verification: ${pkg.reasons.join(" ")}`);

  const csv = csvRows(SOURCE_CSV);
  const rawRows = json(RAW_EXPORT).filter((row: any) => row.split === "regular-fundus-validation");
  const rawByKey = new Map<string, any>(rawRows.map((row: any) => [`${row.patient_id}|${row.image}`, row]));
  const failures = json(FAILURE_REGISTRY);
  const fnKeys = new Set<string>(failures.false_negatives.map((row: any) => row.case_key));
  const limit = requestedLimit();
  const selected = csv.slice(0, limit ?? csv.length);
  const patientHashes = [...new Set(selected.map((row) => row.patient_id))].map((patient) => ({ patient, hash: sha256Text(patient) })).sort((a, b) => a.hash.localeCompare(b.hash));
  const calibrationPatients = new Set(patientHashes.slice(0, Math.ceil(patientHashes.length * 0.8)).map((item) => item.patient));
  const splitFor = (patient: string): SplitName => calibrationPatients.has(patient) ? "calibration" : "evaluation";
  const splitAssignment = patientHashes.map((item) => `${item.hash}:${calibrationPatients.has(item.patient) ? "calibration" : "evaluation"}`).join("\n");
  const splitAssignmentSha256 = sha256Text(splitAssignment);
  const observations: Observation[] = [];
  const pending: Array<{ observationIndex: number; imagePath: string }> = [];
  const unavailableReasons: Record<string, number> = {};
  const quality = await import("../../lib/imaging/quality");
  const oodModule = await import("../../lib/analysis/ood");

  for (const row of selected) {
    const imageName = `${row.image_id}.jpg`;
    const raw = rawByKey.get(`${row.patient_id}|${imageName}`);
    const observation: Observation = {
      split: splitFor(row.patient_id),
      baselineFn: fnKeys.has(sha256Text(`${row.patient_id}|${imageName}`).slice(0, 24)),
      baselineNonreferablePath: Number(raw?.dr_grade ?? -1) < 2,
      valid: false,
      regionCount: 0,
      classCounts: { "MA-like": 0, "HE-like": 0, "EX-like": 0, "CWS-like": 0 },
    };
    const observationIndex = observations.push(observation) - 1;
    const imagePath = path.join(IMAGE_ROOT, row.patient_id, imageName);
    if (!fs.existsSync(imagePath)) {
      unavailableReasons.source_image_missing = (unavailableReasons.source_image_missing ?? 0) + 1;
      continue;
    }
    let bytes: Buffer;
    try { bytes = fs.readFileSync(imagePath); } catch {
      unavailableReasons.source_image_read_error = (unavailableReasons.source_image_read_error ?? 0) + 1;
      continue;
    }
    let qualityResult: any;
    try { qualityResult = await quality.assessQuality(bytes); } catch {
      unavailableReasons.quality_gate_error = (unavailableReasons.quality_gate_error ?? 0) + 1;
      continue;
    }
    if (qualityResult.quality_status !== "pass") {
      unavailableReasons.quality_not_pass = (unavailableReasons.quality_not_pass ?? 0) + 1;
      continue;
    }
    const ood = oodModule.assessOod({ modality: "fundus", quality: qualityResult, model, device: null, metadataProvided: false, deviceUnknownIsDomainUnknown: true });
    if (ood.detected) {
      unavailableReasons.ood_blocked = (unavailableReasons.ood_blocked ?? 0) + 1;
      continue;
    }
    pending.push({ observationIndex, imagePath });
  }

  const modelDir = path.join(MODEL_ROOT, MODEL_ID);
  let worker: BatchResponse | null = null;
  try {
    if (pending.length) worker = await runBatchProbe(pending.map((item) => item.imagePath), modelDir);
  } catch (error) {
    unavailableReasons.batch_worker_failed = pending.length;
    worker = null;
    process.stderr.write(`Phase 7 lesion calibration worker failed: ${String(error instanceof Error ? error.message : error)}\n`);
  }
  if (worker) {
    if (worker.count !== pending.length || worker.serial !== true || worker.artifact_sha256 !== model.sha256) throw new Error("calibration worker envelope did not match the pinned contract");
    const resultByIndex = new Map(worker.results.map((item) => [item.index, item]));
    for (const [index, pendingItem] of pending.entries()) {
      const item = resultByIndex.get(index);
      if (!item || !validBatchItem(item, model.sha256)) {
        unavailableReasons.batch_output_invalid = (unavailableReasons.batch_output_invalid ?? 0) + 1;
        continue;
      }
      const observation = observations[pendingItem.observationIndex];
      observation.valid = true;
      observation.regionCount = item.region_count ?? 0;
      observation.classCounts = {
        "MA-like": numberValue(item.class_counts?.["MA-like"]),
        "HE-like": numberValue(item.class_counts?.["HE-like"]),
        "EX-like": numberValue(item.class_counts?.["EX-like"]),
        "CWS-like": numberValue(item.class_counts?.["CWS-like"]),
      };
    }
  } else if (pending.length) unavailableReasons.batch_worker_unavailable = pending.length;

  const allRules = rules();
  const calibrationResults = allRules.map((rule) => measure(observations, "calibration", rule));
  const evaluationResults = allRules.map((rule) => measure(observations, "evaluation", rule));
  const baselineCalibration = calibrationResults.find((item) => item.rule_id === "any_signal");
  if (!baselineCalibration) throw new Error("baseline lesion calibration rule was not produced");
  const baselineCalibrationBurden = baselineCalibration.review_escalations_per_100_path_cases;
  if (baselineCalibrationBurden === null) throw new Error("baseline lesion calibration burden is unavailable");
  const eligible = calibrationResults.filter((item) => item.rule_id !== "any_signal" &&
    item.fn_review_escalation_coverage !== null && item.fn_review_escalation_coverage >= 0.90 &&
    item.review_escalations_per_100_path_cases !== null &&
    item.review_escalations_per_100_path_cases < baselineCalibrationBurden);
  eligible.sort((a, b) => (a.review_escalations_per_100_path_cases ?? Number.POSITIVE_INFINITY) - (b.review_escalations_per_100_path_cases ?? Number.POSITIVE_INFINITY) || (b.fn_review_escalation_coverage ?? -1) - (a.fn_review_escalation_coverage ?? -1) || a.rule_id.localeCompare(b.rule_id));
  const selectedRule = eligible[0] ?? null;
  const heldOut = selectedRule ? evaluationResults.find((item) => item.rule_id === selectedRule.rule_id) ?? null : null;
  const measurementState = selected.length === csv.length && worker ? "MEASURED_HELD_OUT_RESEARCH" : "PARTIAL_RESEARCH";
  const output = {
    schema_version: "visionscan-phase7-lesion-calibration-v1",
    observed_at: new Date().toISOString(),
    measurement_state: measurementState,
    study_id: "phase7-lesion-calibration-20260913",
    dataset: {
      source: "DeepDRiD regular-fundus-validation",
      selected_cases: selected.length,
      frozen_cases: csv.length,
      patient_count: patientHashes.length,
      calibration_patient_count: calibrationPatients.size,
      evaluation_patient_count: patientHashes.length - calibrationPatients.size,
      patient_separation: "PATIENT_SEPARATED_BY_STABLE_PATIENT_HASH",
      split_assignment_sha256: splitAssignmentSha256,
      split_freeze: "CREATED_BEFORE_RULE_EVALUATION",
    },
    model: {
      model_id: model.model_id,
      model_version: model.version,
      artifact_sha256: model.sha256,
      output_contract: BATCH_OUTPUT_CONTRACT,
      execution: "ONE_FINITE_SERIAL_BATCH_WORKER",
    },
    gates: {
      quality_and_ood_applied_before_execution: true,
      pending_execution_cases: pending.length,
      valid_outputs: observations.filter((item) => item.valid).length,
      unavailable_reasons: unavailableReasons,
    },
    rule_definitions: allRules.map((rule) => ({ id: rule.id, label: rule.label, empirical_features: rule.empirical_features })),
    selection: {
      predeclared_logic: "Select the lowest-burden non-baseline rule on calibration patients with FN review escalation coverage >= 0.90 and lower path burden than any_signal; tie-break by higher coverage then rule ID. Do not inspect evaluation results during selection.",
      minimum_fn_coverage: 0.90,
      baseline_rule_id: "any_signal",
      selected_rule_id: selectedRule?.rule_id ?? null,
      selection_state: selectedRule ? "SELECTED_ON_CALIBRATION_ONLY" : "NO_RULE_MET_PREDECLARED_CALIBRATION_CRITERION",
      calibration_selected_measurement: selectedRule,
      held_out_evaluation_measurement: heldOut,
    },
    calibration_results: calibrationResults,
    held_out_evaluation_results: evaluationResults,
    pareto_frontier: {
      calibration: pareto(calibrationResults),
      evaluation: pareto(evaluationResults),
      interpretation: "Nondominated research rules are shown for transparency; evaluation results did not select the rule.",
    },
    question_two_answer: selectedRule && heldOut ? {
      answer: heldOut.fn_review_escalation_coverage !== null && heldOut.review_escalations_per_100_path_cases !== null && heldOut.review_escalations_per_100_path_cases < (evaluationResults.find((item) => item.rule_id === "any_signal")?.review_escalations_per_100_path_cases ?? Number.POSITIVE_INFINITY) ? "POTENTIALLY_MORE_SELECTIVE_ON_HELD_OUT_RESEARCH_DATA" : "NO_SELECTIVE_HELD_OUT_BENEFIT_ESTABLISHED",
      selected_rule_id: selectedRule.rule_id,
      held_out: heldOut,
      label: "REVIEW ESCALATION COVERAGE",
      forbidden_label: "DISEASE RECOVERY",
    } : { answer: "NO_CALIBRATED_RULE_SELECTED", label: "REVIEW ESCALATION COVERAGE", forbidden_label: "DISEASE RECOVERY" },
    source_hashes: {
      source_csv_sha256: sha256File(SOURCE_CSV),
      raw_export_sha256: sha256File(RAW_EXPORT),
      failure_registry_sha256: sha256File(FAILURE_REGISTRY),
      calibration_script_sha256: sha256TextFile(path.join(ROOT, "scripts", "model-competition", "run-phase7-lesion-calibration.ts")),
      batch_probe_sha256: sha256TextFile(BATCH_SCRIPT),
    },
    phi_included: false,
    limitations: [
      "The calibration and evaluation splits are patient-separated by stable patient hash; raw patient identifiers and row-level features are not persisted.",
      "Rules use only reproducible aggregate connected-component count/class-presence features emitted by the pinned research worker.",
      "The study measures REVIEW ESCALATION COVERAGE and review burden, not lesion confirmation, DR disease recovery, clinical sensitivity, or referral utility.",
      "The finite serial worker keeps the model loaded for this run but does not establish resident production-worker safety or sustained capacity.",
    ],
  };
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ status: output.measurement_state, output: path.relative(ROOT, OUTPUT), selected_rule_id: selectedRule?.rule_id ?? null, fn_cases: selected.filter((row) => fnKeys.has(sha256Text(`${row.patient_id}|${row.image_id}.jpg`).slice(0, 24))).length, valid_outputs: output.gates.valid_outputs }, null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`); process.exitCode = 1; });
