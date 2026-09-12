#!/usr/bin/env node

/**
 * Build the Phase 6 lesion safety-net decision from the existing failure
 * registry. This command deliberately does not infer a lesion signal from a
 * metadata-only export: a valid escalation requires the same source bytes,
 * same study, quality/OOD gates, a verified model execution, and a valid
 * region output. When any required input is unavailable, the result stays
 * NOT_MEASURED and no disease-recovery number is produced.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FAILURE_REGISTRY = path.join(ROOT, "docs", "model-validation", "dr-failure-registry.json");
const RAW_EXPORT = path.join(ROOT, "docs", "evaluations", "deepdr-external-20260908-raw.json");
const LESION_METRICS = path.join(ROOT, "docs", "model-validation", "lesion-metrics.json");
const SAFETY_NET = path.join(ROOT, "docs", "generated", "phase6-lesion-safety-net.json");
const OUTPUT = path.join(ROOT, "docs", "generated", "phase6-lesion-escalation.json");

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function sha256(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }

const failures = readJson(FAILURE_REGISTRY);
const raw = readJson(RAW_EXPORT);
const lesionMetrics = readJson(LESION_METRICS);
const safetyNet = fs.existsSync(SAFETY_NET) ? readJson(SAFETY_NET) : null;
const validationRows = raw.filter((row) => row.split === "regular-fundus-validation");
const baselineFns = failures.false_negatives;
const baselineFps = failures.false_positives;
const nonreferableCount = validationRows.filter((row) => row.eye_grade < 2).length;
const metadataOnlyFnSummaries = validationRows.filter((row) => row.eye_grade >= 2 && row.dr_grade < 2 && typeof row.lesion_summary === "string").length;

const result = {
  schema_version: "visionscan-phase6-lesion-escalation-v1",
  observed_at: new Date().toISOString(),
  measurement_state: safetyNet?.measurement_state ?? "NOT_MEASURED",
  study: {
    baseline_failure_registry: "docs/model-validation/dr-failure-registry.json",
    baseline_false_negative_count: baselineFns.length,
    baseline_false_positive_count: baselineFps.length,
    nonreferable_validation_case_count: nonreferableCount,
    baseline_predicted_nonreferable_case_count: safetyNet?.nonreferable?.input_cases ?? validationRows.filter((row) => row.dr_grade < 2).length,
    lesion_model_id: lesionMetrics.model.model_id,
    lesion_model_artifact_sha256: lesionMetrics.model.artifact.sha256,
  },
  required_evidence: {
    same_source_image: safetyNet ? "PASSED_FOR_SELECTED_ROWS" : "UNAVAILABLE",
    same_study: safetyNet ? "PASSED_FOR_SELECTED_ROWS" : "UNAVAILABLE",
    quality_passed: safetyNet ? "RECORDED_PER_ROW_AGGREGATE" : "UNAVAILABLE",
    ood_passed: safetyNet ? "RECORDED_PER_ROW_AGGREGATE" : "UNAVAILABLE",
    valid_model_execution: safetyNet ? "RECORDED_PER_ROW_AGGREGATE" : "UNAVAILABLE",
    valid_region_output: safetyNet ? "RECORDED_PER_ROW_AGGREGATE" : "UNAVAILABLE",
  },
  fn_escalation: {
    reviewed_baseline_fn_count: baselineFns.length,
    valid_lesion_signal_count: safetyNet?.baseline_fn?.signal_cases ?? null,
    no_valid_lesion_signal_count: safetyNet?.baseline_fn?.no_signal_cases ?? null,
    unavailable_count: safetyNet ? (safetyNet.baseline_fn.input_cases - safetyNet.baseline_fn.inference_completed) : baselineFns.length,
    review_escalation_coverage: safetyNet?.baseline_fn?.review_escalation_coverage ?? null,
    label: "REVIEW ESCALATION COVERAGE",
    forbidden_label: "DISEASE RECOVERY",
  },
  nonreferable_review_burden: {
    evaluated_nonreferable_count: nonreferableCount,
    extra_review_escalations: safetyNet?.nonreferable?.signal_cases ?? null,
    escalations_per_100_nonreferable: safetyNet?.nonreferable?.extra_review_escalations_per_100 ?? null,
    measurement_state: safetyNet?.measurement_state ?? "NOT_MEASURED",
  },
  lesion_class_breakdown: Object.fromEntries(["MA-like", "HE-like", "EX-like", "CWS-like"].map((name) => [name, { count: safetyNet?.baseline_fn?.class_signals?.[name] ?? null, measurement_state: safetyNet ? safetyNet.measurement_state : "NOT_MEASURED" }])),
  metadata_observation: {
    rows_with_unverified_lesion_summary_fields_among_baseline_fns: metadataOnlyFnSummaries,
    interpretation: "Metadata-only fields are not accepted as model execution or valid region output because source bytes, OOD state, run provenance, and study linkage are absent.",
  },
  reasons: [
    "The committed DeepDRiD failure registry contains hashed case/patient keys but no source image bytes or source-image SHA-256 values.",
    "The raw evaluation export contains metadata-only lesion summary fields but no auditable lesion-run provenance, OOD result, or valid region-output contract for the same study.",
    safetyNet ? "A separate gate-aware DeepDRiD technical-research run is available; its aggregate output is not a clinical lesion or disease-recovery result." : "The separately measured lesion evidence is an overlap-disclosed IDRiD 27-image study and is not joinable to the DeepDRiD false-negative cases.",
  ],
  source_hashes: {
    failure_registry_sha256: sha256(FAILURE_REGISTRY),
    raw_export_sha256: sha256(RAW_EXPORT),
    lesion_metrics_sha256: sha256(LESION_METRICS),
  },
  phi_included: false,
  limitations: [
    "No raw patient identifiers, source image bytes, or raw clinical documents are copied into this result.",
    "No disease, lesion, normality, or recovery claim is made.",
    "A future run needs an authorized source-image manifest, same-study linkage, quality/OOD outputs, verified model hash, and a strict region-output record before coverage can be calculated.",
  ],
};

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, `${JSON.stringify(result, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ status: result.measurement_state, output: path.relative(ROOT, OUTPUT), reviewed_fn_count: baselineFns.length, valid_signal_count: null }, null, 2)}\n`);
