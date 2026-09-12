#!/usr/bin/env -S npx vite-node

/**
 * Bounded, local lesion safety-net experiment for the frozen DeepDRiD
 * validation images. It uses the existing quality/OOD gates and the existing
 * hash-verified lesion provider. Only aggregate, PHI-free evidence is saved;
 * individual case joins remain in memory and are never written to Git.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATASET_ROOT = path.join(ROOT, "scratch", "datasets", "DeepDRiD", "regular_fundus_images", "regular-fundus-validation");
const IMAGE_ROOT = path.join(DATASET_ROOT, "Images");
const SOURCE_CSV = path.join(DATASET_ROOT, "regular-fundus-validation.csv");
const RAW_EXPORT = path.join(ROOT, "docs", "evaluations", "deepdr-external-20260908-raw.json");
const FAILURE_REGISTRY = path.join(ROOT, "docs", "model-validation", "dr-failure-registry.json");
const OUTPUT = path.join(ROOT, "docs", "generated", "phase6-lesion-safety-net.json");
const SCRIPT_PATH = path.join(ROOT, "scripts", "model-competition", "run-lesion-safety-net.ts");

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

function addClasses(target: Record<string, number>, findings: Array<{ finding_type?: string; type?: string }>): void {
  for (const finding of findings) {
    const type = finding.finding_type ?? finding.type ?? "";
    const key = type === "microaneurysm_like_lesion" ? "MA-like" : type === "retinal_hemorrhage" ? "HE-like" : type === "hard_exudate" ? "EX-like" : type === "cotton_wool_spot" ? "CWS-like" : null;
    if (key) target[key] += 1;
  }
}

function quantile(values: number[], fraction: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

async function main(): Promise<void> {
  if (!fs.existsSync(SOURCE_CSV) || !fs.existsSync(RAW_EXPORT) || !fs.existsSync(FAILURE_REGISTRY)) throw new Error("Required DeepDRiD evidence is unavailable");
  const { assessQuality } = await import("../../lib/imaging/quality");
  const { assessOod } = await import("../../lib/analysis/ood");
  const { getModel } = await import("../../lib/models/registry");
  const { runFundusLesionResearchAnalysis } = await import("../../lib/models/fundusLesionLocalProvider");
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

  for (const row of selected) {
    const imageName = `${row.image_id}.jpg`;
    const imagePath = path.join(IMAGE_ROOT, row.patient_id, imageName);
    const raw = rawByKey.get(`${row.patient_id}|${imageName}`);
    const caseKey = sha256Text(`${row.patient_id}|${imageName}`).slice(0, 24);
    const isFn = fnKeys.has(caseKey);
    // Review escalation is applied to the cases the baseline would send down
    // the nonreferable path (319 rows), not only to ground-truth negatives.
    // This keeps the added-review denominator available without using labels
    // to choose which production-facing cases would be escalated.
    const bucket = isFn ? fn : Number(raw?.dr_grade ?? -1) < 2 ? nonreferable : null;
    all.input_cases += 1;
    if (bucket) bucket.input_cases += 1;
    if (!fs.existsSync(imagePath)) {
      all.source_images_missing += 1; if (bucket) bucket.source_images_missing += 1;
      unavailableReasons.source_image_missing = (unavailableReasons.source_image_missing ?? 0) + 1;
      continue;
    }
    all.source_images_present += 1; if (bucket) bucket.source_images_present += 1;
    const imageBytes = fs.readFileSync(imagePath);
    const started = Date.now();
    let quality;
    try { quality = await assessQuality(imageBytes); } catch {
      all.quality_blocked += 1; if (bucket) bucket.quality_blocked += 1;
      unavailableReasons.quality_gate_error = (unavailableReasons.quality_gate_error ?? 0) + 1;
      continue;
    }
    if (quality.quality_status !== "pass") {
      all.quality_blocked += 1; if (bucket) bucket.quality_blocked += 1;
      unavailableReasons.quality_not_pass = (unavailableReasons.quality_not_pass ?? 0) + 1;
      continue;
    }
    all.quality_pass += 1; if (bucket) bucket.quality_pass += 1;
    const ood = assessOod({ modality: "fundus", quality, model, device: null, metadataProvided: false, deviceUnknownIsDomainUnknown: true });
    if (ood.detected) {
      all.ood_blocked += 1; if (bucket) bucket.ood_blocked += 1;
      unavailableReasons.ood_blocked = (unavailableReasons.ood_blocked ?? 0) + 1;
      continue;
    }
    all.ood_pass += 1; if (bucket) bucket.ood_pass += 1;
    try {
      const result = await runFundusLesionResearchAnalysis(
        { studyId: `phase6-${caseKey}`, modality: "fundus", eye: row.image_id.includes("_l") ? "OS" : row.image_id.includes("_r") ? "OD" : "unknown", source: "file_upload", metadata: { providedBy: "none" }, files: [] },
        { qualityScore: quality.quality_score, eye: "unknown", device: null, imageBytes },
      );
      const elapsed = Date.now() - started;
      all.service_ms.push(elapsed); if (bucket) bucket.service_ms.push(elapsed);
      if (result.raw.inference_status !== "completed") {
        all.inference_failed += 1; if (bucket) bucket.inference_failed += 1;
        unavailableReasons.model_failed = (unavailableReasons.model_failed ?? 0) + 1;
        continue;
      }
      all.inference_completed += 1; if (bucket) bucket.inference_completed += 1;
      // runFundusLesionResearchAnalysis validates the worker's strict output
      // contract before returning; a completed result is therefore a valid
      // region-output observation, even when it contains zero regions.
      all.valid_region_output += 1; if (bucket) bucket.valid_region_output += 1;
      const hasSignal = result.findings.length > 0;
      if (hasSignal) { all.signal_cases += 1; if (bucket) bucket.signal_cases += 1; addClasses(all.class_signals, result.findings); if (bucket) addClasses(bucket.class_signals, result.findings); }
      else { all.no_signal_cases += 1; if (bucket) bucket.no_signal_cases += 1; }
    } catch {
      all.inference_failed += 1; if (bucket) bucket.inference_failed += 1;
      unavailableReasons.provider_exception = (unavailableReasons.provider_exception ?? 0) + 1;
    }
  }

  const result = {
    schema_version: "visionscan-phase6-lesion-safety-net-v2",
    observed_at: new Date().toISOString(),
    measurement_state: selected.length === csv.length ? "MEASURED_TECHNICAL_RESEARCH" : "PARTIAL_TECHNICAL_RESEARCH",
    scope: { selected_cases: selected.length, frozen_validation_cases: csv.length, baseline_fn_cases_selected: fn.input_cases, baseline_fn_cases_expected: failures.false_negatives.length, all_cases_processed_serially: selected.length === csv.length },
    model: { model_id: model.model_id, model_version: model.version, artifact_sha256: model.sha256, preprocessing_version: "clementp-source-pinned-1024-v1", output_contract: "fundus-lesion-segmentation-contract/2-original-image-geometry", threshold_version: "argmax-components-no-threshold-no-calibration" },
    gate_definition: { source_image: "regular-fundus-validation/Images/<patient>/<image>.jpg", quality: "assessQuality quality_status=pass", ood: "assessOod fundus with missing device treated as DOMAIN_VALIDATION_UNKNOWN", model_execution: "runFundusLesionResearchAnalysis completed", region_output: "provider strict transport contract accepted" },
    aggregate: { ...all, service_ms: { count: all.service_ms.length, p50: quantile(all.service_ms, 0.5), p95: quantile(all.service_ms, 0.95), max: quantile(all.service_ms, 1) }, class_signals: all.class_signals },
    baseline_fn: { ...fn, service_ms: { count: fn.service_ms.length, p50: quantile(fn.service_ms, 0.5), p95: quantile(fn.service_ms, 0.95), max: quantile(fn.service_ms, 1) }, class_signals: fn.class_signals, review_escalation_coverage: fn.input_cases ? fn.signal_cases / fn.input_cases : null, label: "REVIEW ESCALATION COVERAGE", forbidden_label: "DISEASE RECOVERY" },
    nonreferable: { ...nonreferable, service_ms: { count: nonreferable.service_ms.length, p50: quantile(nonreferable.service_ms, 0.5), p95: quantile(nonreferable.service_ms, 0.95), max: quantile(nonreferable.service_ms, 1) }, class_signals: nonreferable.class_signals, extra_review_escalations_per_100: nonreferable.input_cases ? (nonreferable.signal_cases / nonreferable.input_cases) * 100 : null },
    unavailable_reasons: unavailableReasons,
    source_hashes: { source_csv_sha256: sha256File(SOURCE_CSV), raw_export_sha256: sha256File(RAW_EXPORT), failure_registry_sha256: sha256File(FAILURE_REGISTRY), script_sha256: sha256File(SCRIPT_PATH) },
    phi_included: false,
    limitations: ["Counts are aggregate and contain no case, patient, image, or source-path identifiers.", "The source quality labels are not used as a substitute for the platform quality gate.", "Missing device metadata is disclosed as DOMAIN_VALIDATION_UNKNOWN; it is not a device compatibility pass.", "Lesion-like regions are uncalibrated research observations, not clinically confirmed lesions.", "The study does not establish DR disease recovery, clinical sensitivity, or safe referral utility."],
  };
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ status: result.measurement_state, output: path.relative(ROOT, OUTPUT), selected_cases: selected.length, fn_cases: fn.input_cases, fn_signal_count: fn.signal_cases, fn_coverage: result.baseline_fn.review_escalation_coverage }, null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`); process.exitCode = 1; });
