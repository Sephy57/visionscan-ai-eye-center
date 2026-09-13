#!/usr/bin/env node

/**
 * Freeze the Phase 8 high-grade miss review registry from the already-frozen
 * DeepDRiD export. This is an evidence projection, not a new image inference:
 * no image names, patient IDs, or raw paths are written to the artifact.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SOURCE = path.join(ROOT, "docs", "evaluations", "deepdr-external-20260908-raw.json");
const BASELINE = path.join(ROOT, "docs", "generated", "model-competition", "phase6-retguard-20260913", "baseline.json");
const LESION_ARTIFACT = path.join(ROOT, "data", "models", "fundus-lesions-clementp-unet-seresnext50", "model.safetensors");
const OUTPUT = path.join(ROOT, "docs", "generated", "phase8-high-grade-miss-registry.json");
const RULE_ID = "LESION_ESCALATION_RULE_PHASE7_V1";

function sha256File(file) {
  return fs.existsSync(file) ? crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") : null;
}

function sha256Text(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function caseKey(row) {
  return sha256Text(`${row.patient_id}|${row.image}`);
}

function patientKey(row) {
  return sha256Text(`patient|${row.patient_id}`);
}

function safeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function groupByGrade(rows) {
  const out = {};
  for (const grade of [3, 4]) {
    const subset = rows.filter((row) => row.eye_grade === grade);
    const escalated = subset.filter((row) => Number(row.lesion_regions) >= 3).length;
    out[String(grade)] = {
      exact_miss_cases: subset.length,
      escalated_cases: escalated,
      non_escalated_cases: subset.length - escalated,
      review_escalation_coverage: subset.length ? escalated / subset.length : null,
      predicted_grade_counts: Object.fromEntries([...new Set(subset.map((row) => row.dr_grade))].sort((a, b) => a - b).map((predicted) => [String(predicted), subset.filter((row) => row.dr_grade === predicted).length])),
      source_quality_flag_counts: Object.fromEntries([...new Set(subset.map((row) => String(row.quality)))].sort().map((quality) => [quality, subset.filter((row) => String(row.quality) === quality).length])),
    };
  }
  return out;
}

function main() {
  if (!fs.existsSync(SOURCE)) throw new Error("DeepDRiD source export is unavailable");
  const sourceRows = readJson(SOURCE).filter((row) => row.split === "regular-fundus-validation");
  const misses = sourceRows.filter((row) => (row.eye_grade === 3 || row.eye_grade === 4) && row.dr_grade !== row.eye_grade);
  const entries = misses.map((row) => {
    const regions = safeNumber(row.lesion_regions);
    const escalated = regions !== null && regions >= 3;
    return {
      case_id_sha256: caseKey(row),
      patient_key_sha256: patientKey(row),
      ground_truth_grade: row.eye_grade,
      baseline_output: {
        predicted_grade: row.dr_grade,
        referable: row.dr_referable === true,
        logit_recorded: safeNumber(row.dr_logit),
      },
      quality: {
        source_flag: String(row.quality),
        platform_quality_status: "NOT_RECORDED",
        interpretation: "Dataset quality flag preserved without assuming its threshold semantics or substituting a platform quality result.",
      },
      ood: { status: "NOT_RECORDED", reason: "The persisted DR export has no per-case OOD field." },
      lesion: {
        source_export_regions: regions,
        source_export_classes: Array.isArray(row.lesion_classes) ? row.lesion_classes : [],
        rule_id: RULE_ID,
        review_escalated: escalated,
        inference_provenance: "EXISTING_PHASE7_RESEARCH_EXPORT_FIELDS; FRESH_PHASE8_INFERENCE_NOT_RUN",
      },
      oct: { status: "NOT_RECORDED", reason: "No per-case OCT result is attached to the fundus export." },
      document_evidence: { status: "NOT_RECORDED", reason: "No source-document evidence is attached to the export." },
      independent_clinician_evidence: { status: "NOT_RECORDED", reason: "No clinician adjudication is attached to the export." },
      review_escalation: {
        rule_id: RULE_ID,
        escalated,
        label: "REVIEW ESCALATION COVERAGE",
        forbidden_interpretation: "DISEASE RECOVERY",
      },
    };
  });

  const baseline = fs.existsSync(BASELINE) ? readJson(BASELINE) : null;
  const output = {
    schema_version: "visionscan-phase8-high-grade-miss-registry-v1",
    observed_at: new Date().toISOString(),
    phi_included: false,
    registry_state: "FROZEN_FOR_RESEARCH_REVIEW",
    execution_source: "EXISTING_PHASE7_RESEARCH_EXPORT",
    fresh_phase8_inference: false,
    definition: "Exact high-grade miss means eye_grade is 3 or 4 and the frozen baseline dr_grade is not equal to eye_grade. Grade 3 and grade 4 are analyzed separately.",
    frozen_rule: {
      rule_id: RULE_ID,
      rule: "source_export_lesion_regions >= 3",
      selection_source: "Phase 7 calibration-only selection",
      phase7_evaluation_retuned: false,
      label: "REVIEW ESCALATION COVERAGE",
      forbidden_label: "DISEASE RECOVERY",
    },
    source_hashes: {
      source_export_sha256: sha256File(SOURCE),
      baseline_artifact_sha256: baseline?.model?.artifact_sha256 ?? null,
      lesion_model_artifact_sha256: sha256File(LESION_ARTIFACT),
      registry_script_sha256: sha256File(path.join(ROOT, "scripts", "model-competition", "phase8-high-grade-miss-registry.mjs")),
    },
    cohort: {
      source_split: "regular-fundus-validation",
      total_source_cases: sourceRows.length,
      total_source_patients: new Set(sourceRows.map(patientKey)).size,
      high_grade_cases: sourceRows.filter((row) => row.eye_grade === 3 || row.eye_grade === 4).length,
      exact_high_grade_miss_cases: entries.length,
      grade_3_exact_miss_cases: entries.filter((entry) => entry.ground_truth_grade === 3).length,
      grade_4_exact_miss_cases: entries.filter((entry) => entry.ground_truth_grade === 4).length,
      patient_separation: "INHERITED_FROM_FROZEN_PHASE7_EXPORT; NO_NEW_SPLIT",
    },
    aggregate: groupByGrade(misses),
    combined: {
      exact_miss_cases: entries.length,
      escalated_cases: entries.filter((entry) => entry.review_escalation.escalated).length,
      non_escalated_cases: entries.filter((entry) => !entry.review_escalation.escalated).length,
      review_escalation_coverage: entries.length ? entries.filter((entry) => entry.review_escalation.escalated).length / entries.length : null,
    },
    entries,
    limitations: [
      "This registry is a hashed projection of an existing Phase 7 export; it is not a fresh Phase 8 image inference.",
      "The source export contains no per-case OCT, document, independent clinician, or OOD evidence, so those fields are NOT_RECORDED rather than false.",
      "Dataset quality flags are preserved as source values only; they are not reinterpreted as platform quality-gate outcomes.",
      "Escalation coverage is review-routing evidence and does not recover disease, prove lesions, or validate a clinical safety net.",
    ],
  };
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ output: path.relative(ROOT, OUTPUT), status: output.registry_state, exact_miss_cases: entries.length, grade_3: output.aggregate["3"], grade_4: output.aggregate["4"] }, null, 2));
}

main();
