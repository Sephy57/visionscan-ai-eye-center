/**
 * Machine-readable validation registry (§15).
 *
 * One authoritative record per registered model: artifact, datasets,
 * patient separation, metrics, calibration, scope, limitations, review
 * date. The /models UI reads this registry (via /api/models/validation)
 * instead of hard-coded validation text. Numbers here must match the
 * evaluation JSON under docs/evaluations/ and the integration docs; tests
 * enforce id/hash/status consistency with the model registry.
 */

export interface ValidationDatasetEntry {
  name: string;
  split: string;
  license: string;
  n_images: number | null;
  n_patients: number | null;
  patient_separation: "VERIFIED_DISJOINT" | "NOT_VERIFIABLE" | "OVERLAP_DISCLOSED";
  external_to_training: boolean;
  overlap_note: string;
  evidence_doc: string;
}

export interface ValidationModelEntry {
  model_id: string;
  model_version: string;
  artifact_sha256: string;
  status: string;
  datasets: ValidationDatasetEntry[];
  metrics_summary: string;
  calibration: "NOT_CALIBRATED" | string;
  device_scope: string;
  population_scope: string;
  limitations: string[];
  last_review_date: string;
}

export const VALIDATION_REGISTRY_VERSION = "2026-09-08.2";

export const VALIDATION_REGISTRY: readonly ValidationModelEntry[] = [
  {
    model_id: "fundus-lesions-clementp-unet-seresnext50",
    model_version: "a2cfcb594e483",
    artifact_sha256: "a7a7cb45b92328f7c9a8e581eec3944fd435d37fae8cbf340b1319c5f987c6d2",
    status: "RESEARCH",
    datasets: [
      {
        name: "DeepDRiD regular fundus",
        split: "publisher validation (400 imgs / 100 pts, endpoint) + training (1189 / 299)",
        license: "CC-BY-SA-4.0",
        n_images: 1589,
        n_patients: 399,
        patient_separation: "VERIFIED_DISJOINT",
        external_to_training: true,
        overlap_note: "No overlap with publisher-reported training sets (DDR/FGADR/IDRiD/MESSIDOR/RETLES). Image-level lesion detection by GT grade; no pixel masks.",
        evidence_doc: "docs/evaluations/deepdr-external-20260908-raw.json",
      },
      {
        name: "IDRiD Segmentation Task-2 TEST",
        split: "publisher test (27 imgs; SE n=14)",
        license: "CC-BY-4.0",
        n_images: 27,
        n_patients: null,
        patient_separation: "NOT_VERIFIABLE",
        external_to_training: false,
        overlap_note: "IDRiD is named in publisher-reported training: comparability evidence, NOT independent validation.",
        evidence_doc: "docs/evaluations/idrid-seg-test-20260908-raw.json",
      },
      {
        name: "APTOS 2019 train (capped sample)",
        split: "deterministic first-N sample: 250 grade-0 + 25/grade for 1-4 (n=350)",
        license: "CC-BY-4.0 (mirror tag)",
        n_images: 350,
        n_patients: null,
        patient_separation: "NOT_VERIFIABLE",
        external_to_training: true,
        overlap_note: "APTOS not in lesion-model reported training: independent negatives (India population). Grade-0 as weak image-level negatives.",
        evidence_doc: "docs/evaluations/aptos-capped-20260908-raw.json",
      },
    ],
    metrics_summary:
      "DeepDRiD image-level detection by GT grade (val): 0: 113/174, 1: 40/46, 2: 92/92, 3: 68/68, 4: 19/20 " +
      "(specificity on grade-0 ≈ 0.35–0.39). APTOS grade-0: 102/250 negative (specificity 0.408); grades 1–4: 100/100 detected. " +
      "IDRiD pixel Dice: MA 0.405, HE 0.665, EX 0.764, SE 0.712. " +
      "Specificity unmeasurable on IDRiD (no negatives).",
    calibration: "NOT_CALIBRATED",
    device_scope: "Unvalidated for every device; Shanghai (DeepDRiD) + India (IDRiD) acquisition only.",
    population_scope: "China (DeepDRiD, Tongji/Shanghai sites) + India (IDRiD). No other populations measured.",
    limitations: [
      "Argmax-only rule fires on vessel/reflection content in healthy eyes (FP rate ~0.65 on grade-0).",
      "Tiny low-contrast lesions systematically missed (MA pixel recall ≤0.35 on 8/27 IDRiD images).",
      "No pixel ground truth outside IDRiD; no peripheral/device/myopia/pigmentation subgroup data.",
    ],
    last_review_date: "2026-09-08",
  },
  {
    model_id: "fundus-dr-grading-effb0",
    model_version: "aa5741419b90",
    artifact_sha256: "0d9a18b0cb6c90d1f30bf2e66153b368bd7ff0bcb45b6690e8d5ce14fa19f69b",
    status: "RESEARCH",
    datasets: [
      {
        name: "DeepDRiD regular fundus",
        split: "publisher validation (400 / 100, endpoint) + training (1189 / 299)",
        license: "CC-BY-SA-4.0",
        n_images: 1589,
        n_patients: 399,
        patient_separation: "VERIFIED_DISJOINT",
        external_to_training: true,
        overlap_note: "No overlap with publisher-reported training sets (EyePACS/APTOS/DDR/IDRiD). Publisher self-reported QWK (0.75) must not be read as generalization.",
        evidence_doc: "docs/evaluations/deepdr-external-20260908-raw.json",
      },
      {
        name: "APTOS 2019 train (capped sample, comparability only)",
        split: "deterministic first-N sample: 250 grade-0 + 25/grade for 1-4 (n=350)",
        license: "CC-BY-4.0 (mirror tag)",
        n_images: 350,
        n_patients: null,
        patient_separation: "NOT_VERIFIABLE",
        external_to_training: false,
        overlap_note: "APTOS IS in DR-grader reported training pool: comparability only, not independence. Same undercalling pattern as DeepDRiD.",
        evidence_doc: "docs/evaluations/aptos-capped-20260908-raw.json",
      },
    ],
    metrics_summary:
      "DeepDRiD validation: QWK 0.495, acc 0.502; referable≥2 sens 0.439/spec 0.991/PPV 0.975; " +
      "any-DR≥1 sens 0.642/spec 0.931; raw-logit AUROC 0.885/0.820. APTOS-train capped sample (comparability only, " +
      "APTOS in reported training): QWK 0.524, acc 0.760; referable sens 0.347/spec 0.985. " +
      "Structural grade collapse: grades 3–4 almost never predicted.",
    calibration: "NOT_CALIBRATED",
    device_scope: "Unvalidated for every device.",
    population_scope: "China (DeepDRiD Shanghai sites) only.",
    limitations: [
      "MSE-trained scalar is ranking signal, not log-odds: probability calibration not meaningful.",
      "Referable sensitivity weak (0.44): misses most grade ≥2 at the fixed round rule.",
      "Training-data license nuance unresolved (APTOS non-commercial / EyePACS redistribution limits).",
    ],
    last_review_date: "2026-09-08",
  },
  {
    model_id: "oct-retinal-weights-fp32",
    model_version: "hf-main-2026",
    artifact_sha256: "22b1fffb5a0ab88284d4c5817c581bedb1b54c09011d87c3f6472cb2c36b2b1f",
    status: "RESEARCH",
    datasets: [
      {
        name: "Kermany Cell 2018 OCT test (HF mirror)",
        split: "mirror test parquet (1000 rows, 250/class)",
        license: "CC-BY-4.0",
        n_images: 1000,
        n_patients: null,
        patient_separation: "NOT_VERIFIABLE",
        external_to_training: false,
        overlap_note: "Kermany is the publisher-reported training distribution: comparability evidence, NOT independent validation. Mirror strips patient IDs.",
        evidence_doc: "docs/evaluations/oct-kermany-test-20260908-raw.json",
      },
      {
        name: "Duke Srinivasan BOE 2014",
        split: "45 subjects (15 Normal / 15 dry-AMD / 15 DME), 3231 TIFF B-scans; subject folder = ID surrogate",
        license: "Duke research/educational only, no commercialization/redistribution",
        n_images: 3231,
        n_patients: 45,
        patient_separation: "VERIFIED_DISJOINT",
        external_to_training: true,
        overlap_note: "Different device/population (Spectralis, US). Class mapping approximate: dry-AMD->DRUSEN proxy; no CNV in set (CNV outputs counted as errors).",
        evidence_doc: "docs/evaluations/duke-oct-external-20260908-raw.json",
      },
    ],
    metrics_summary:
      "Kermany test: acc 0.977; sens/spec CNV 0.996/0.980, DME 0.996/0.997, DRUSEN 0.936/0.995, NORMAL 0.980/0.997. " +
      "Duke independent: scan acc 0.844 (DOMAIN_SHIFT vs 0.977), subject-majority 42/45; NORMAL->DME overcalls (234) dominate. " +
      "Backbone argmax only (hybrid head not executed).",
    calibration: "NOT_CALIBRATED",
    device_scope: "Single-scanner training distribution; cross-scanner unvalidated.",
    population_scope: "UCSD/Shiley + China (Kermany). No other populations measured.",
    limitations: [
      "Backbone-logit softmax structurally overconfident (mean |conf−correct| 0.55); temperature does not repair it.",
      "NORMAL/DRUSEN boundary fragile (author-acknowledged).",
      "Single-author MSc provenance, unreviewed; Duke is one independent cohort, while broader cross-scanner and clinical validation remain absent.",
    ],
    last_review_date: "2026-09-08",
  },
];

export function validationEntryForModel(modelId: string): ValidationModelEntry | null {
  return VALIDATION_REGISTRY.find((e) => e.model_id === modelId) ?? null;
}
