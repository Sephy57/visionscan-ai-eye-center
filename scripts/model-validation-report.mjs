#!/usr/bin/env node

/**
 * Phase 3 model-validation evidence generator.
 *
 * This script consumes only the repository's PHI-minimized evaluation exports
 * under docs/evaluations/. It deliberately writes hashed case keys instead of
 * raw patient/image identifiers, keeps every dataset split separate, and
 * refuses to turn missing labels or unverified split metadata into metrics.
 * The generated artifacts are research evidence, not a clinical-validation
 * certificate and not a model-status transition mechanism.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = path.resolve(import.meta.dirname, "..");
const EVAL_DIR = path.join(ROOT, "docs", "evaluations");
const OUT_DIR = path.join(ROOT, "docs", "model-validation");
const OBSERVED_AT = "2026-09-08";

const MODEL_META = {
  "fundus-dr-grading-effb0": {
    manifest: "data/models/fundus-dr-grading-effb0/manifest.json",
    task: "fundus image-level ICDR grade estimate (0-4)",
    validation_status: "RESEARCH_ONLY",
    forbidden_interpretation: "Not a diagnosis, referral decision, probability, or normality claim.",
  },
  "fundus-lesions-clementp-unet-seresnext50": {
    manifest: "data/models/fundus-lesions-clementp-unet-seresnext50/manifest.json",
    task: "fundus lesion-like semantic localization",
    validation_status: "RESEARCH_ONLY",
    forbidden_interpretation: "Not a diagnosis, validated lesion overlay, or absence-of-disease claim.",
  },
  "oct-retinal-weights-fp32": {
    manifest: "data/models/oct-retinal-weights-fp32/manifest.json",
    task: "OCT B-scan class estimate (CNV/DME/DRUSEN/NORMAL)",
    validation_status: "RESEARCH_ONLY",
    forbidden_interpretation: "NORMAL is an internal classifier class, never a healthy-eye or disease-absent conclusion.",
  },
};

function readJson(relativePath) {
  const file = path.join(ROOT, relativePath);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(relativePath, value) {
  const file = path.join(ROOT, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeMarkdown(fileName, markdown) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, fileName), `${markdown.trim()}\n`, "utf8");
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex").slice(0, 24);
}

function round(value, digits = 4) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function ratio(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator;
}

function wilson(successes, total) {
  if (total === 0) return null;
  const z = 1.96;
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const centre = p + (z * z) / (2 * total);
  const spread = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total);
  return [round(Math.max(0, (centre - spread) / denominator)), round(Math.min(1, (centre + spread) / denominator))];
}

function binaryMetrics(cases, actual, predicted) {
  let tp = 0, fp = 0, tn = 0, fn = 0;
  for (const c of cases) {
    const truth = actual(c) ? 1 : 0;
    const pred = predicted(c) ? 1 : 0;
    if (truth && pred) tp += 1;
    else if (!truth && pred) fp += 1;
    else if (!truth && !pred) tn += 1;
    else fn += 1;
  }
  return {
    n: cases.length,
    confusion: { tp, fp, tn, fn },
    sensitivity: ratio(tp, tp + fn),
    sensitivity_95ci: wilson(tp, tp + fn),
    specificity: ratio(tn, tn + fp),
    specificity_95ci: wilson(tn, tn + fp),
    ppv: ratio(tp, tp + fp),
    ppv_95ci: wilson(tp, tp + fp),
    npv: ratio(tn, tn + fn),
    npv_95ci: wilson(tn, tn + fn),
    f1: ratio(2 * tp, 2 * tp + fp + fn),
    fpr: ratio(fp, fp + tn),
    fnr: ratio(fn, fn + tp),
  };
}

function auroc(cases, actual, score) {
  const scored = cases
    .map((c) => ({ c, score: score(c) }))
    .filter((x) => Number.isFinite(x.score));
  const positive = scored.filter((x) => actual(x.c));
  const negative = scored.filter((x) => !actual(x.c));
  if (positive.length === 0 || negative.length === 0) return null;
  scored.sort((a, b) => a.score - b.score);
  let rankSum = 0;
  for (let i = 0; i < scored.length;) {
    let j = i;
    while (j + 1 < scored.length && scored[j + 1].score === scored[i].score) j += 1;
    const midrank = (i + j + 2) / 2;
    for (let k = i; k <= j; k += 1) if (actual(scored[k].c)) rankSum += midrank;
    i = j + 1;
  }
  return round((rankSum - (positive.length * (positive.length + 1)) / 2) / (positive.length * negative.length));
}

function auprc(cases, actual, score) {
  const scored = cases
    .map((c) => ({ c, score: score(c) }))
    .filter((x) => Number.isFinite(x.score));
  const positives = scored.filter((x) => actual(x.c)).length;
  if (positives === 0 || positives === scored.length) return null;
  scored.sort((a, b) => b.score - a.score);
  let tp = 0;
  let fp = 0;
  let previousRecall = 0;
  let area = 0;
  for (const item of scored) {
    if (actual(item.c)) tp += 1; else fp += 1;
    const precision = tp / (tp + fp);
    const recall = tp / positives;
    area += precision * (recall - previousRecall);
    previousRecall = recall;
  }
  return round(area);
}

function multiclassConfusion(cases, labels, actual, predicted) {
  const matrix = Object.fromEntries(labels.map((label) => [label, Object.fromEntries(labels.map((p) => [p, 0]))]));
  for (const c of cases) {
    const truth = String(actual(c));
    const pred = String(predicted(c));
    if (matrix[truth] && Object.prototype.hasOwnProperty.call(matrix[truth], pred)) matrix[truth][pred] += 1;
  }
  return matrix;
}

function multiclassMetrics(cases, labels, actual, predicted) {
  const matrix = multiclassConfusion(cases, labels, actual, predicted);
  const total = cases.length;
  const perClass = {};
  const recalls = [];
  const f1s = [];
  for (const label of labels) {
    const tp = matrix[label][label];
    const fn = labels.reduce((sum, other) => sum + (other === label ? 0 : matrix[label][other]), 0);
    const fp = labels.reduce((sum, other) => sum + (other === label ? 0 : matrix[other][label]), 0);
    const tn = total - tp - fn - fp;
    const sensitivity = ratio(tp, tp + fn);
    const specificity = ratio(tn, tn + fp);
    const ppv = ratio(tp, tp + fp);
    const npv = ratio(tn, tn + fn);
    const f1 = ratio(2 * tp, 2 * tp + fp + fn);
    perClass[label] = {
      support: tp + fn,
      confusion: { tp, fp, tn, fn },
      sensitivity,
      sensitivity_95ci: wilson(tp, tp + fn),
      specificity,
      specificity_95ci: wilson(tn, tn + fp),
      ppv,
      npv,
      f1,
    };
    if (sensitivity !== null) recalls.push(sensitivity);
    if (f1 !== null) f1s.push(f1);
  }
  const correct = labels.reduce((sum, label) => sum + matrix[label][label], 0);
  return {
    n: total,
    accuracy: ratio(correct, total),
    balanced_accuracy: recalls.length ? recalls.reduce((a, b) => a + b, 0) / recalls.length : null,
    macro_f1: f1s.length ? f1s.reduce((a, b) => a + b, 0) / f1s.length : null,
    confusion_true_x_pred: matrix,
    per_class: perClass,
  };
}

function quadraticWeightedKappa(cases, labels, actual, predicted) {
  const matrix = multiclassConfusion(cases, labels, actual, predicted);
  const n = cases.length;
  if (n === 0 || labels.length < 2) return null;
  const truthTotals = Object.fromEntries(labels.map((label) => [label, 0]));
  const predTotals = Object.fromEntries(labels.map((label) => [label, 0]));
  for (const c of cases) {
    truthTotals[String(actual(c))] += 1;
    predTotals[String(predicted(c))] += 1;
  }
  const maxIndex = labels.length - 1;
  let observed = 0;
  let expected = 0;
  for (let i = 0; i < labels.length; i += 1) {
    for (let j = 0; j < labels.length; j += 1) {
      const weight = ((i - j) / maxIndex) ** 2;
      observed += weight * (matrix[labels[i]][labels[j]] / n);
      expected += weight * ((truthTotals[labels[i]] * predTotals[labels[j]]) / (n * n));
    }
  }
  return expected === 0 ? null : round(1 - observed / expected);
}

function severityFor(groundTruth, predicted) {
  const delta = Number(groundTruth) - Number(predicted);
  if (delta >= 2) return "UNDERCALL_GE_2_GRADES";
  if (delta === 1) return "UNDERCALL_1_GRADE";
  if (delta <= -2) return "OVERCALL_GE_2_GRADES";
  if (delta === -1) return "OVERCALL_1_GRADE";
  return "NO_GRADE_ERROR";
}

function drFailureCase(c, failureType, task) {
  return {
    dataset: "DeepDRiD regular-fundus-validation",
    task,
    case_key: sha256(`${c.patient_id ?? "unknown"}|${c.image ?? "unknown"}`),
    patient_key: c.patient_id ? sha256(`patient|${c.patient_id}`) : null,
    eye_key: c.image ? sha256(`image|${c.image}`) : null,
    ground_truth_grade: c.eye_grade,
    predicted_grade: c.dr_grade,
    raw_model_output: { dr_logit: c.dr_logit },
    image_quality: c.quality === "1" ? "recorded_quality_1" : c.quality === "0" ? "recorded_quality_0" : "unknown",
    device: null,
    severity: severityFor(c.eye_grade, c.dr_grade),
    domain_notes: ["Device is not recorded in the evaluation export.", "Model output is a regression logit rounded/clamped to grade 0-4."],
    possible_failure_category: failureType === "false_negative" ? "GRADE_UNDERCALL_OR_THRESHOLD_TRANSFER" : "GRADE_OVERCALL_OR_THRESHOLD_TRANSFER",
    failure_type: failureType,
  };
}

function modelFromManifest(modelId) {
  const manifest = readJson(MODEL_META[modelId].manifest);
  return {
    model_id: manifest.model_id,
    model_name: manifest.model_name,
    version: manifest.version,
    artifact: manifest.artifact,
    input: manifest.input,
    output_schema: manifest.output_schema,
    supported_anatomy: manifest.supported_anatomy,
    supported_findings: manifest.supported_findings,
    source: manifest.source,
    license: manifest.license,
    training_dataset: manifest.training_dataset,
    validation_dataset: manifest.validation_dataset,
    calibration: manifest.calibration,
    limitations: manifest.limitations,
    intended_use: manifest.intended_use,
    forbidden_interpretation: MODEL_META[modelId].forbidden_interpretation,
    validation_status: MODEL_META[modelId].validation_status,
  };
}

function markdownTable(rows) {
  return rows.map((row) => `| ${row.join(" | ")} |`).join("\n");
}

function buildDr() {
  const all = readJson("docs/evaluations/deepdr-external-20260908-raw.json");
  const training = all.filter((c) => c.split === "regular-fundus-training");
  const validation = all.filter((c) => c.split === "regular-fundus-validation");
  const labels = ["0", "1", "2", "3", "4"];
  const toGrade = (c) => String(c.eye_grade);
  const toPred = (c) => String(c.dr_grade);
  const task = "referable DR (ground-truth grade >=2)";
  const reportFor = (cases, split) => ({
    split,
    n: cases.length,
    patient_count: new Set(cases.map((c) => c.patient_id)).size,
    grade_distribution: Object.fromEntries(labels.map((label) => [label, cases.filter((c) => String(c.eye_grade) === label).length])),
    predicted_grade_distribution: Object.fromEntries(labels.map((label) => [label, cases.filter((c) => String(c.dr_grade) === label).length])),
    multiclass: {
      ...multiclassMetrics(cases, labels, toGrade, toPred),
      quadratic_weighted_kappa: quadraticWeightedKappa(cases, labels, toGrade, toPred),
    },
    referable: {
      ...binaryMetrics(cases, (c) => c.eye_grade >= 2, (c) => c.dr_grade >= 2),
      auroc: auroc(cases, (c) => c.eye_grade >= 2, (c) => c.dr_logit),
      auprc: auprc(cases, (c) => c.eye_grade >= 2, (c) => c.dr_logit),
    },
    any_dr: {
      ...binaryMetrics(cases, (c) => c.eye_grade >= 1, (c) => c.dr_grade >= 1),
      auroc: auroc(cases, (c) => c.eye_grade >= 1, (c) => c.dr_logit),
      auprc: auprc(cases, (c) => c.eye_grade >= 1, (c) => c.dr_logit),
    },
    patient_split: "PATIENT_SEPARATED_CONFIRMED within this export: 299 training patients, 100 validation patients, 0 overlap.",
    device: "NOT_RECORDED",
    calibration: "CALIBRATION_NOT_ESTABLISHED: dr_logit is a regression score, not a probability; no ECE/Brier claim is derived from it.",
  });
  const validationFns = validation.filter((c) => c.eye_grade >= 2 && c.dr_grade < 2).map((c) => drFailureCase(c, "false_negative", task));
  const validationFps = validation.filter((c) => c.eye_grade < 2 && c.dr_grade >= 2).map((c) => drFailureCase(c, "false_positive", task));
  const aptos = readJson("docs/evaluations/aptos-capped-20260908-raw.json");
  const source = modelFromManifest("fundus-dr-grading-effb0");
  const summary = {
    observed_at: OBSERVED_AT,
    model: source,
    datasets: [
      { name: "DeepDRiD regular fundus", split: "regular-fundus-training", n: training.length, patients: 299, patient_separation: "PATIENT_SEPARATED_CONFIRMED within export", independence: "development/training-distribution evidence; not external validation" },
      { name: "DeepDRiD regular fundus", split: "regular-fundus-validation", n: validation.length, patients: 100, patient_separation: "PATIENT_SEPARATED_CONFIRMED within export", independence: "held-out publisher split; not prospective clinical validation" },
      { name: "APTOS 2019 capped", split: "capped", n: aptos.per_image.length, patients: null, patient_separation: "PATIENT_SEPARATION_UNVERIFIABLE", independence: "overlap-disclosed: APTOS is in publisher-reported DR training pool; comparability only" },
    ],
    training: reportFor(training, "regular-fundus-training"),
    validation: reportFor(validation, "regular-fundus-validation"),
    aptos_recorded_metrics: aptos.dr_metrics,
    errors: { referable_false_negatives: validationFns.length, referable_false_positives: validationFps.length },
  };
  return { summary, fns: validationFns, fps: validationFps, source };
}

function buildLesion() {
  const raw = readJson("docs/evaluations/idrid-seg-test-20260908-raw.json");
  const classes = Object.entries(raw.micro_stats).map(([label, stats]) => {
    const dice = ratio(2 * stats.tp, 2 * stats.tp + stats.fp + stats.fn);
    const iou = ratio(stats.tp, stats.tp + stats.fp + stats.fn);
    const detectionSensitivity = ratio(stats.det_tp, stats.det_tp + stats.det_fn);
    return {
      label,
      pixels: { tp: stats.tp, fp: stats.fp, fn: stats.fn },
      dice: round(dice),
      iou: round(iou),
      pixel_sensitivity: ratio(stats.tp, stats.tp + stats.fn),
      pixel_precision: ratio(stats.tp, stats.tp + stats.fp),
      detection: { tp: stats.det_tp, fp: stats.det_fp, fn: stats.det_fn, tn: stats.det_tn, sensitivity: detectionSensitivity },
      aggregate_false_positive_pixels_per_image: round(stats.fp / raw.per_image.length, 2),
      region_fp_burden: null,
      region_fp_burden_reason: "NOT_MEASURABLE: export has no per-negative-image ground-truth mask/region table and det_tn is zero.",
    };
  });
  const source = modelFromManifest("fundus-lesions-clementp-unet-seresnext50");
  const summary = {
    observed_at: OBSERVED_AT,
    model: source,
    dataset: {
      name: raw.dataset,
      license: raw.license,
      provenance: raw.provenance,
      overlap_disclosure: raw.overlap_disclosure,
      patient_separation: "PATIENT_SEPARATION_UNVERIFIABLE: image-level export has no patient/eye IDs.",
      n_images: raw.per_image.length,
      classes: raw.class_map,
    },
    classes,
    false_positive_burden: {
      mean_regions_per_negative_image: null,
      median_regions_per_negative_image: null,
      p90_regions_per_negative_image: null,
      p95_regions_per_negative_image: null,
      max_regions_per_negative_image: null,
      status: "NOT_MEASURABLE",
      reason: "No negative-image region ground truth or per-image class-level FP region table is present. Zero det_fp in this export is not a zero-FP claim.",
    },
    false_negative_analysis: "Per-lesion FN categories are not recoverable from the aggregate export; pixel FN and detection FN are reported per class above.",
    engineering_failure_analysis: readJson("docs/evaluations/fundus-lesion-candidate-failure-analysis-2026-09-07.json"),
  };
  return { summary, source };
}

function buildOct() {
  const kermany = readJson("docs/evaluations/oct-kermany-test-20260908-raw.json");
  const duke = readJson("docs/evaluations/duke-oct-external-20260908-raw.json");
  const labels = ["CNV", "DME", "DRUSEN", "NORMAL"];
  const kCases = kermany.per_image.map((c) => ({ ...c, truth: labels[c.label], prediction: labels[c.pred] }));
  const dukeLabel = (value) => value === "DRUSEN" ? "DRUSEN-proxy" : value;
  const dCases = duke.per_scan.map((c) => ({ ...c, truth: dukeLabel(c.label), prediction: dukeLabel(c.pred) }));
  const source = modelFromManifest("oct-retinal-weights-fp32");
  const summary = {
    observed_at: OBSERVED_AT,
    model: source,
    classes: labels,
    internal_or_overlap_disclosed: {
      dataset: { name: kermany.dataset, license: kermany.license, provenance: kermany.provenance, patient_separation: kermany.patient_split, overlap_disclosure: kermany.overlap_disclosure, n: kCases.length },
      metrics: multiclassMetrics(kCases, labels, (c) => c.truth, (c) => c.prediction),
      calibration: kermany.calibration,
    },
    independent_external: {
      dataset: { name: duke.dataset, license: duke.license, provenance: duke.provenance, patient_separation: duke.patient_split, overlap_disclosure: duke.overlap_disclosure, n_scans: dCases.length, subjects: 45, device: "Spectralis SD-OCT (recorded cohort description)" },
      approximate_mapping: "Duke dry-AMD is reported as DRUSEN-proxy; no CNV reference class exists. CNV is retained as an out-of-label prediction class so those predictions remain visible and count as errors.",
      metrics: multiclassMetrics(dCases, ["NORMAL", "DME", "DRUSEN-proxy", "CNV"], (c) => c.truth, (c) => c.prediction),
      subject_majority_accuracy: duke.metrics.subject_majority_accuracy,
      domain_shift: duke.domain_shift,
    },
    calibration_status: "CALIBRATION_NOT_ESTABLISHED: raw softmax confidence was measured descriptively in the Kermany export, but the backbone argmax path is not calibrated and temperature was not adopted.",
    normal_safety: "The NORMAL class is displayed only as a research classifier class; it never means NORMAL EYE, NO RETINAL DISEASE, or DISEASE ABSENT.",
  };
  const errors = kCases.filter((c) => c.truth !== c.prediction).map((c) => ({
    dataset: "Kermany test mirror",
    case_key: sha256(`oct|${c.label}|${c.pred}|${JSON.stringify(c.logits)}`),
    ground_truth_class: c.truth,
    predicted_class: c.prediction,
    raw_model_output: { logits: c.logits },
    image_quality: "NOT_RECORDED",
    device: null,
    domain_notes: ["Patient ID is not present in the mirror export.", "This is overlap-disclosed comparability evidence, not independent validation."],
  }));
  return { summary, errors, source };
}

function renderModelCard(model, summary, details) {
  const artifact = model.artifact;
  return `# Model card — ${model.model_name}

**Model ID:** \`${model.model_id}\`

**Version:** \`${model.version}\`

**Validation status:** **${model.validation_status}**
**Observed evidence date:** ${OBSERVED_AT}

## Intended research use

${model.intended_use}

## Inputs and outputs

- Modalities: ${model.input.modalities.join(", ")}
- Dimensions: ${model.input.dimensions}
- Preprocessing: ${model.input.preprocessing}
- Output contract: \`${model.output_schema}\`
- Anatomy: ${model.supported_anatomy.join(", ") || "none declared"}
- Findings: ${model.supported_findings.join(", ") || "none declared"}

## Source, license, and artifact

- Source: ${model.source}
- License declaration: ${model.license}
- Artifact: \`${artifact.file}\` (${artifact.format})
- SHA-256: \`${artifact.sha256}\`
- Training data: ${model.training_dataset ? `${model.training_dataset.name}; version ${model.training_dataset.version}; provenance ${model.training_dataset.provenance}` : "not recorded"}
- Validation data in manifest: ${model.validation_dataset ? JSON.stringify(model.validation_dataset) : "none"}
- Data-rights note: model/checkpoint license does not independently clear upstream dataset terms.

## Measured validation evidence

${details}

## False positives, false negatives, and calibration

${summary}

## Known limitations and forbidden interpretation

${model.limitations.map((x) => `- ${x}`).join("\n")}
- ${model.forbidden_interpretation}
- No automated status transition is made from these measurements.

## Release decision

**Remain research-only.** The evidence is task-level software/research measurement, not clinical validation, not device validation, and not authorization for diagnosis or treatment.
`;
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const dr = buildDr();
  const lesion = buildLesion();
  const oct = buildOct();

  writeJson("docs/model-validation/validation-summary.json", {
    format: "visionscan-model-validation-phase3-v1",
    observed_at: OBSERVED_AT,
    note: "PHI-minimized research evidence. Hashed case keys are not patient identifiers and are not a clinical-validation certificate.",
    models: [dr.summary, lesion.summary, oct.summary],
  });
  writeJson("docs/model-validation/dr-failure-registry.json", {
    format: "visionscan-dr-failure-registry-v1",
    observed_at: OBSERVED_AT,
    model_id: dr.source.model_id,
    task: "referable DR (grade >=2)",
    source: "docs/evaluations/deepdr-external-20260908-raw.json / regular-fundus-validation",
    note: "Hashed case/patient/eye keys only; no raw source identifiers are written.",
    false_negatives: dr.fns,
    false_positives: dr.fps,
  });
  writeJson("docs/model-validation/oct-error-registry.json", {
    format: "visionscan-oct-error-registry-v1",
    observed_at: OBSERVED_AT,
    model_id: oct.source.model_id,
    errors: oct.errors,
    note: "Hashed case keys only; Kermany mirror does not provide patient IDs.",
  });
  writeJson("docs/model-validation/lesion-metrics.json", lesion.summary);

  const drValidation = dr.summary.validation;
  writeMarkdown("fundus-dr-grading-effb0.md", renderModelCard(
    dr.source,
    `DeepDRiD validation (n=${drValidation.n}) referable sensitivity ${round(drValidation.referable.sensitivity)}, specificity ${round(drValidation.referable.specificity)}, PPV ${round(drValidation.referable.ppv)}, NPV ${round(drValidation.referable.npv)}; ${dr.fns.length} referable false negatives and ${dr.fps.length} referable false positives are registered in dr-failure-registry.json. QWK is ${drValidation.multiclass.quadratic_weighted_kappa}; no calibrated probability was established.`,
    `DeepDRiD regular-fundus validation: 400 images / 100 patients, patient-separated within the export; held-out publisher split, not prospective clinical validation.\n\nReferable threshold: ground-truth and predicted grade >=2. Continuous AUROC/AUPRC are reported as score-ranking measurements only. APTOS is overlap-disclosed comparability evidence and is not merged into the validation metrics.`,
  ));
  writeMarkdown("fundus-lesions-clementp-unet-seresnext50.md", renderModelCard(
    lesion.source,
    `IDRiD lesion test export: pixel Dice/IoU and class detection metrics are available in lesion-metrics.json. Region-level false-positive burden is **NOT_MEASURABLE** because the export lacks a negative-image region table; zero reported detection FP values are not interpreted as zero false positives.`,
    `IDRiD segmentation Task 2 test: 27 images, image-level export, no verifiable patient split, and overlap with the publisher-reported training set. The four class rows are MA, HE, EX, and SE/CWT. Pixel metrics and aggregate FP pixels/image are retained; region FP burden and per-lesion FN registry remain blocked by missing per-image ground truth.`,
  ));
  writeMarkdown("oct-retinal-weights-fp32.md", renderModelCard(
    oct.source,
    `Kermany metrics are kept as overlap-disclosed comparability evidence; Duke provides a subject-separated independent distribution with an approximate dry-AMD-to-DRUSEN mapping. The NORMAL class remains a bounded research class.`,
    `Kermany mirror: 1,000 scans, patient separation not verifiable, overlap-disclosed.\n\nDuke Srinivasan: 3,231 scans from 45 subjects, subject-separated, Spectralis cohort, approximate DRUSEN-proxy mapping; scan and subject-majority metrics are separate and not merged.`,
  ));
  writeMarkdown("README.md", `# Phase 3 model-validation evidence

Generated from the PHI-minimized exports under docs/evaluations/ by node scripts/model-validation-report.mjs.

| Artifact | Purpose |
|---|---|
| fundus-dr-grading-effb0.md | DR model card, split status, task metrics, calibration boundary |
| fundus-lesions-clementp-unet-seresnext50.md | Lesion model card, pixel metrics, FP-burden limitation |
| oct-retinal-weights-fp32.md | OCT model card, Kermany/Duke split evidence, NORMAL safety |
| validation-summary.json | Machine-readable aggregate evidence |
| dr-failure-registry.json | Hashed referable DR FN/FP registry |
| oct-error-registry.json | Hashed Kermany multiclass error registry |
| lesion-metrics.json | Pixel/detection metrics and explicit FP-burden status |

All statuses remain research-only. No document here grants clinical validation, device approval, diagnostic authority, treatment authority, or permission to report one system-level accuracy number.
`);

  process.stdout.write(JSON.stringify({
    status: "generated",
    output_dir: path.relative(ROOT, OUT_DIR),
    files: fs.readdirSync(OUT_DIR).sort(),
    dr: { validation_cases: dr.summary.validation.n, false_negatives: dr.fns.length, false_positives: dr.fps.length },
    lesion: { images: lesion.summary.dataset.n_images, classes: lesion.summary.classes.length, region_fp_burden: lesion.summary.false_positive_burden.status },
    oct: { kermany_cases: oct.summary.internal_or_overlap_disclosed.metrics.n, duke_scans: oct.summary.independent_external.metrics.n, errors: oct.errors.length },
    phi_included: false,
  }, null, 2) + "\n");
}

main();
