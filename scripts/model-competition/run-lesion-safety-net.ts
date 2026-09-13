#!/usr/bin/env -S npx vite-node

/**
 * Bounded, local lesion safety-net experiment for the frozen DeepDRiD
 * validation images. Quality and OOD gates are evaluated in Node, then one
 * hash-pinned Python batch worker processes every admitted image serially.
 * Only aggregate, PHI-free evidence is saved; individual joins remain in
 * memory and the scratch manifest is removed after the worker exits.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { PROJECT_ROOT, TMP_ROOT, MODEL_ROOT, ensureDirs } from "../../lib/config";
import { buildThreadGovernedEnv } from "../../lib/runtime";
import { terminateTrackedProcessTrees, trackChildProcess, withProcessTreeScope } from "../../lib/jobs/processControl";
import { loadModelPackage } from "../../lib/models/package";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATASET_ROOT = path.join(ROOT, "scratch", "datasets", "DeepDRiD", "regular_fundus_images", "regular-fundus-validation");
const IMAGE_ROOT = path.join(DATASET_ROOT, "Images");
const SOURCE_CSV = path.join(DATASET_ROOT, "regular-fundus-validation.csv");
const RAW_EXPORT = path.join(ROOT, "docs", "evaluations", "deepdr-external-20260908-raw.json");
const FAILURE_REGISTRY = path.join(ROOT, "docs", "model-validation", "dr-failure-registry.json");
const OUTPUT = path.join(ROOT, "docs", "generated", "phase6-lesion-safety-net.json");
const SCRIPT_PATH = path.join(ROOT, "scripts", "model-competition", "run-lesion-safety-net.ts");
const BATCH_SCRIPT = path.join(PROJECT_ROOT, "scripts", "inference", "fundus_lesion_batch_probe.py");
const VENV_PYTHON = path.join(PROJECT_ROOT, ".venv-ophthalmic", process.platform === "win32" ? "Scripts" : "bin", process.platform === "win32" ? "python.exe" : "python3");
const BATCH_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const MAX_STDOUT_BYTES = 32 * 1024 * 1024;
const BATCH_OUTPUT_CONTRACT = "fundus-lesion-segmentation-batch-summary/1";

function sha256File(file: string): string { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function sha256Text(value: string): string { return crypto.createHash("sha256").update(value, "utf8").digest("hex"); }
function json(file: string): any { return JSON.parse(fs.readFileSync(file, "utf8")); }
function csvRows(file: string): Array<Record<string, string>> {
  const [header, ...lines] = fs.readFileSync(file, "utf8").trim().split(/\r?\n/);
  const fields = header.split(",");
  return lines.filter(Boolean).map((line) => {
    const values = line.split(",");
    return Object.fromEntries(fields.map((field, index) => [field, values[index] ?? ""]));
  });
}

function requestedLimit(): number | null {
  const index = process.argv.indexOf("--limit");
  if (index < 0) return null;
  const value = Number(process.argv[index + 1]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function emptyClassCounts(): Record<string, number> {
  return { "MA-like": 0, "HE-like": 0, "EX-like": 0, "CWS-like": 0 };
}

function createSummary() {
  return {
    input_cases: 0,
    source_images_present: 0,
    source_images_missing: 0,
    quality_pass: 0,
    quality_blocked: 0,
    ood_pass: 0,
    ood_blocked: 0,
    inference_completed: 0,
    inference_failed: 0,
    valid_region_output: 0,
    signal_cases: 0,
    no_signal_cases: 0,
    class_signals: emptyClassCounts(),
    service_ms: [] as number[],
  };
}

function quantile(values: number[], fraction: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

function addClassCounts(target: Record<string, number>, counts: Record<string, unknown>): void {
  const keys = ["MA-like", "HE-like", "EX-like", "CWS-like"];
  for (const key of keys) {
    const value = counts[key];
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) target[key] += value;
  }
}

type Summary = ReturnType<typeof createSummary>;

interface PendingCase {
  imagePath: string;
  buckets: Summary[];
}

interface BatchResultItem {
  index: number;
  inference_status: "completed" | "failed";
  output_contract?: string;
  artifact_sha256?: string;
  region_count?: number;
  class_counts?: Record<string, unknown>;
  image_level_summary?: string;
  service_ms?: number;
  thread_governance?: { intra_op?: number; inter_op?: number };
}

interface BatchResponse {
  batch_status: "complete";
  output_contract: string;
  model_id: string;
  artifact_sha256: string;
  serial: boolean;
  count: number;
  thread_governance: { intra_op?: number; inter_op?: number };
  results: BatchResultItem[];
}

function validBatchResult(item: BatchResultItem, artifactSha256: string): boolean {
  if (item.inference_status !== "completed" || item.output_contract !== BATCH_OUTPUT_CONTRACT || item.artifact_sha256 !== artifactSha256) return false;
  if (!Number.isSafeInteger(item.index) || typeof item.region_count !== "number" || !Number.isSafeInteger(item.region_count) || item.region_count < 0 || typeof item.class_counts !== "object" || item.class_counts === null) return false;
  if (typeof item.service_ms !== "number" || !Number.isFinite(item.service_ms) || item.service_ms < 0) return false;
  if (item.thread_governance?.intra_op !== 4 || item.thread_governance?.inter_op !== 1) return false;
  const classKeys = ["MA-like", "HE-like", "EX-like", "CWS-like"];
  const classTotal = classKeys.reduce((sum, key) => {
    const value = item.class_counts?.[key];
    return sum + (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : Number.NaN);
  }, 0);
  return Number.isSafeInteger(classTotal) && classTotal === item.region_count;
}

async function runBatchProbe(imagePaths: string[], modelDir: string): Promise<BatchResponse> {
  ensureDirs();
  const manifestPath = path.join(TMP_ROOT, `phase6_lesion_batch_${process.pid}_${Date.now()}.json`);
  fs.writeFileSync(manifestPath, JSON.stringify(imagePaths.map((imagePath) => ({ image_path: imagePath }))), { encoding: "utf8", mode: 0o600 });
  const scope = `phase6-lesion-batch-${process.pid}`;
  try {
    return await withProcessTreeScope(scope, () => new Promise<BatchResponse>((resolve, reject) => {
      const child = spawn(VENV_PYTHON, ["-I", "-s", BATCH_SCRIPT, modelDir, manifestPath, "--threads", "4"], {
        env: buildThreadGovernedEnv(4),
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        timeout: BATCH_TIMEOUT_MS,
      });
      trackChildProcess(child, scope);
      let stdout = "";
      let stderr = "";
      let overflow = false;
      let timedOut = false;
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
      child.once("timeout", () => {
        timedOut = true;
        void terminateTrackedProcessTrees(scope);
      });
      child.once("error", (error) => reject(error));
      child.once("close", (code) => {
        if (overflow) return reject(new Error("Batch worker output exceeded the bounded stdout limit"));
        if (timedOut) return reject(new Error("Batch worker exceeded the bounded runtime deadline"));
        if (code !== 0) return reject(new Error(`Batch worker exited non-zero (${code ?? "unknown"})${stderr ? `: ${stderr}` : ""}`));
        try {
          const parsed = JSON.parse(stdout.trim()) as BatchResponse;
          if (parsed.batch_status !== "complete" || parsed.output_contract !== BATCH_OUTPUT_CONTRACT || !Array.isArray(parsed.results)) throw new Error("Batch worker response failed the envelope contract");
          resolve(parsed);
        } catch (error) {
          reject(new Error(`Batch worker output was invalid: ${String(error instanceof Error ? error.message : error)}`));
        }
      });
    }));
  } finally {
    try { fs.unlinkSync(manifestPath); } catch { /* contained scratch cleanup is best effort */ }
  }
}

function incrementFailure(target: Summary): void { target.inference_failed += 1; }
function incrementAllFailure(all: Summary, buckets: Summary[]): void { incrementFailure(all); for (const bucket of buckets) incrementFailure(bucket); }

function recordBatchResult(all: Summary, item: BatchResultItem, buckets: Summary[], artifactSha256: string, unavailableReasons: Record<string, number>): void {
  if (typeof item.service_ms === "number" && Number.isFinite(item.service_ms) && item.service_ms >= 0) {
    all.service_ms.push(item.service_ms);
    for (const bucket of buckets) bucket.service_ms.push(item.service_ms);
  }
  if (!validBatchResult(item, artifactSha256)) {
    incrementAllFailure(all, buckets);
    unavailableReasons.batch_output_invalid = (unavailableReasons.batch_output_invalid ?? 0) + 1;
    return;
  }
  all.inference_completed += 1; for (const bucket of buckets) bucket.inference_completed += 1;
  all.valid_region_output += 1; for (const bucket of buckets) bucket.valid_region_output += 1;
  const hasSignal = item.region_count! > 0;
  if (hasSignal) {
    all.signal_cases += 1; for (const bucket of buckets) bucket.signal_cases += 1;
    addClassCounts(all.class_signals, item.class_counts!); for (const bucket of buckets) addClassCounts(bucket.class_signals, item.class_counts!);
  } else {
    all.no_signal_cases += 1; for (const bucket of buckets) bucket.no_signal_cases += 1;
  }
}

async function main(): Promise<void> {
  if (!fs.existsSync(SOURCE_CSV) || !fs.existsSync(RAW_EXPORT) || !fs.existsSync(FAILURE_REGISTRY)) throw new Error("Required DeepDRiD evidence is unavailable");
  const { assessQuality } = await import("../../lib/imaging/quality");
  const { assessOod } = await import("../../lib/analysis/ood");
  const { getModel } = await import("../../lib/models/registry");
  const csv = csvRows(SOURCE_CSV);
  const rawRows = json(RAW_EXPORT).filter((row: any) => row.split === "regular-fundus-validation");
  const rawByKey = new Map<string, any>(rawRows.map((row: any) => [`${row.patient_id}|${row.image}`, row]));
  const failures = json(FAILURE_REGISTRY);
  const fnKeys = new Set(failures.false_negatives.map((row: any) => row.case_key));
  const limit = requestedLimit();
  const selected = csv.slice(0, limit ?? csv.length);
  const model = getModel("fundus-lesions-clementp-unet-seresnext50");
  if (!model) throw new Error("Registered lesion model is unavailable");
  const all = createSummary();
  const fn = createSummary();
  const nonreferable = createSummary();
  const unavailableReasons: Record<string, number> = {};
  const pending: PendingCase[] = [];

  for (const row of selected) {
    const imageName = `${row.image_id}.jpg`;
    const imagePath = path.join(IMAGE_ROOT, row.patient_id, imageName);
    const raw = rawByKey.get(`${row.patient_id}|${imageName}`);
    const caseKey = sha256Text(`${row.patient_id}|${imageName}`).slice(0, 24);
    const isFn = fnKeys.has(caseKey);
    // Review escalation is applied to the cases the baseline would send down
    // the nonreferable path (319 rows), not only to ground-truth negatives.
    const isBaselineNonreferable = Number(raw?.dr_grade ?? -1) < 2;
    const buckets = [
      ...(isFn ? [fn] : []),
      ...(isBaselineNonreferable ? [nonreferable] : []),
    ];
    all.input_cases += 1;
    for (const bucket of buckets) bucket.input_cases += 1;
    if (!fs.existsSync(imagePath)) {
      all.source_images_missing += 1; for (const bucket of buckets) bucket.source_images_missing += 1;
      unavailableReasons.source_image_missing = (unavailableReasons.source_image_missing ?? 0) + 1;
      continue;
    }
    all.source_images_present += 1; for (const bucket of buckets) bucket.source_images_present += 1;
    let imageBytes: Buffer;
    try { imageBytes = fs.readFileSync(imagePath); } catch {
      all.source_images_missing += 1; for (const bucket of buckets) bucket.source_images_missing += 1;
      unavailableReasons.source_image_read_error = (unavailableReasons.source_image_read_error ?? 0) + 1;
      continue;
    }
    let quality;
    try { quality = await assessQuality(imageBytes); } catch {
      all.quality_blocked += 1; for (const bucket of buckets) bucket.quality_blocked += 1;
      unavailableReasons.quality_gate_error = (unavailableReasons.quality_gate_error ?? 0) + 1;
      continue;
    }
    if (quality.quality_status !== "pass") {
      all.quality_blocked += 1; for (const bucket of buckets) bucket.quality_blocked += 1;
      unavailableReasons.quality_not_pass = (unavailableReasons.quality_not_pass ?? 0) + 1;
      continue;
    }
    all.quality_pass += 1; for (const bucket of buckets) bucket.quality_pass += 1;
    const ood = assessOod({ modality: "fundus", quality, model, device: null, metadataProvided: false, deviceUnknownIsDomainUnknown: true });
    if (ood.detected) {
      all.ood_blocked += 1; for (const bucket of buckets) bucket.ood_blocked += 1;
      unavailableReasons.ood_blocked = (unavailableReasons.ood_blocked ?? 0) + 1;
      continue;
    }
    all.ood_pass += 1; for (const bucket of buckets) bucket.ood_pass += 1;
    pending.push({ imagePath, buckets });
  }

  const pkg = loadModelPackage(model.model_id);
  if (!pkg.ok) {
    for (const item of pending) incrementAllFailure(all, item.buckets);
    unavailableReasons.model_package_invalid = pending.length;
  } else if (pending.length) {
    try {
      const worker = await runBatchProbe(pending.map((item) => item.imagePath), path.join(MODEL_ROOT, model.model_id));
      if (worker.count !== pending.length || worker.serial !== true || worker.artifact_sha256 !== model.sha256 || worker.thread_governance.intra_op !== 4 || worker.thread_governance.inter_op !== 1) throw new Error("Batch worker envelope did not match the pinned model/runtime contract");
      const byIndex = new Map(worker.results.map((item) => [item.index, item]));
      for (const [index, pendingCase] of pending.entries()) {
        const item = byIndex.get(index);
        if (!item) {
          incrementAllFailure(all, pendingCase.buckets);
          unavailableReasons.batch_result_missing = (unavailableReasons.batch_result_missing ?? 0) + 1;
        } else {
          recordBatchResult(all, item, pendingCase.buckets, model.sha256, unavailableReasons);
        }
      }
    } catch {
      for (const item of pending) incrementAllFailure(all, item.buckets);
      unavailableReasons.batch_worker_failed = (unavailableReasons.batch_worker_failed ?? 0) + 1;
    }
  }

  const result = {
    schema_version: "visionscan-phase6-lesion-safety-net-v3",
    observed_at: new Date().toISOString(),
    measurement_state: selected.length === csv.length ? "MEASURED_TECHNICAL_RESEARCH" : "PARTIAL_TECHNICAL_RESEARCH",
    scope: { selected_cases: selected.length, frozen_validation_cases: csv.length, admitted_cases: pending.length, baseline_fn_cases_selected: fn.input_cases, baseline_fn_cases_expected: failures.false_negatives.length, all_cases_processed_serially: selected.length === csv.length },
    model: { model_id: model.model_id, model_version: model.version, artifact_sha256: model.sha256, preprocessing_version: "clementp-source-pinned-1024-v1", output_contract: BATCH_OUTPUT_CONTRACT, threshold_version: "argmax-components-no-threshold-no-calibration" },
    gate_definition: { source_image: "regular-fundus-validation/Images/<patient>/<image>.jpg", quality: "assessQuality quality_status=pass", ood: "assessOod fundus with missing device treated as DOMAIN_VALIDATION_UNKNOWN", model_execution: "one finite fundus_lesion_batch_probe.py worker, entries processed serially", region_output: `${BATCH_OUTPUT_CONTRACT} validated; geometry mapped to original-image coordinates before summary` },
    aggregate: { ...all, service_ms: { count: all.service_ms.length, p50: quantile(all.service_ms, 0.5), p95: quantile(all.service_ms, 0.95), max: quantile(all.service_ms, 1) }, class_signals: all.class_signals },
    baseline_fn: { ...fn, service_ms: { count: fn.service_ms.length, p50: quantile(fn.service_ms, 0.5), p95: quantile(fn.service_ms, 0.95), max: quantile(fn.service_ms, 1) }, class_signals: fn.class_signals, review_escalation_coverage: fn.input_cases ? fn.signal_cases / fn.input_cases : null, label: "REVIEW ESCALATION COVERAGE", forbidden_label: "DISEASE RECOVERY" },
    nonreferable: { ...nonreferable, service_ms: { count: nonreferable.service_ms.length, p50: quantile(nonreferable.service_ms, 0.5), p95: quantile(nonreferable.service_ms, 0.95), max: quantile(nonreferable.service_ms, 1) }, class_signals: nonreferable.class_signals, extra_review_escalations_per_100: nonreferable.input_cases ? (nonreferable.signal_cases / nonreferable.input_cases) * 100 : null },
    unavailable_reasons: unavailableReasons,
    source_hashes: { source_csv_sha256: sha256File(SOURCE_CSV), raw_export_sha256: sha256File(RAW_EXPORT), failure_registry_sha256: sha256File(FAILURE_REGISTRY), script_sha256: sha256File(SCRIPT_PATH), batch_probe_sha256: sha256File(BATCH_SCRIPT) },
    phi_included: false,
    limitations: ["Counts are aggregate and contain no case, patient, image, or source-path identifiers.", "The source quality labels are not used as a substitute for the platform quality gate.", "Missing device metadata is disclosed as DOMAIN_VALIDATION_UNKNOWN; it is not a device compatibility pass.", "Lesion-like regions are uncalibrated research observations, not clinically confirmed lesions.", "The batch worker is one finite serialized study process, not evidence for a resident production worker.", "The study does not establish DR disease recovery, clinical sensitivity, or safe referral utility."],
  };
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ status: result.measurement_state, output: path.relative(ROOT, OUTPUT), selected_cases: selected.length, admitted_cases: pending.length, fn_cases: fn.input_cases, fn_signal_count: fn.signal_cases, fn_coverage: result.baseline_fn.review_escalation_coverage }, null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`); process.exitCode = 1; });
