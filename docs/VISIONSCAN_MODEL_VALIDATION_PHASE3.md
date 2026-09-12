# VisionScan Phase 3 — Local Model Validation Report

**Observed evidence date:** 2026-09-08 for the PHI-minimized evaluation exports; repository/release review continues on 2026-09-12.  
**Scope:** offline technical validation of installed local research artifacts and one isolated optic-disc/cup candidate.  
**Boundary:** these measurements do not establish clinical validity, safety, diagnostic accuracy, treatment authority, medical-device status, or disease absence.

## Executive decision

The three installed models have reproducible local artifacts, pinned input/output contracts, manifest hashes, and deterministic research-only result states. The evidence supports **local technical research execution**. It does not support promotion to clinical or diagnostic use.

The strongest measured evidence is task-level comparison on the supplied exports:

| Model | Evidence | Resulting interpretation |
|---|---|---|
| `fundus-dr-grading-effb0` | DeepDRiD regular-fundus validation, 400 images/100 patients | Held-out publisher-split research measurement; high referable specificity but low sensitivity; no independent DR validation |
| `fundus-lesions-clementp-unet-seresnext50` | IDRiD Task 2 test, 27 images | Overlap-disclosed pixel/detection comparison; patient separation and negative-image FP burden unavailable |
| `oct-retinal-weights-fp32` | Kermany mirror, 1,000 scans; Duke, 3,231 scans/45 subjects | Kermany overlap comparison plus approximate subject-separated domain-shift evidence; no calibrated clinical classifier |
| `segformer-optic-disc-cup-refuge` | Isolated local candidate probe | Anatomy-only research candidate; not registered and not a glaucoma model |

The generated machine-readable evidence is under [`docs/model-validation/`](model-validation/), produced by [`scripts/model-validation-report.mjs`](../scripts/model-validation-report.mjs). The generator writes hashed case keys only and reports `phi_included:false`.

## Model identity and artifacts

| Model | Runtime | Input | Version | SHA-256 | Registered state |
|---|---|---|---|---|---|
| `fundus-dr-grading-effb0` | SafeTensors/CPU | FUNDUS, `3x512x512` | `aa5741419b90` | `0d9a18b0cb6c90d1f30bf2e66153b368bd7ff0bcb45b6690e8d5ce14fa19f69b` | `RESEARCH_ONLY` |
| `fundus-lesions-clementp-unet-seresnext50` | SafeTensors/CPU | FUNDUS, `3x1024x1024` | `a2cfcb594e483` | `a7a7cb45b92328f7c9a8e581eec3944fd435d37fae8cbf340b1319c5f987c6d2` | `RESEARCH_ONLY` |
| `oct-retinal-weights-fp32` | ONNX/CPUExecutionProvider | OCT, `1x224x224x3` | `hf-main-2026` | `22b1fffb5a0ab88284d4c5817c581bedb1b54c09011d87c3f6472cb2c36b2b1f` | `RESEARCH_ONLY` |
| `segformer-optic-disc-cup-refuge` | SafeTensors/CPU probe | FUNDUS, candidate-specific | candidate | `22e45131b64eb07a5d29a2e5388a7709d10696b13f48d2d0cdcf56cafa1f9ea5` | isolated `CANDIDATE_ONLY` |

Preprocessing and output contracts are copied from the installed manifests and integration documents. No `trust_remote_code=true`, paid inference API, or hidden remote inference path is part of the local runtime.

## Dataset, license, and split inventory

| Evaluation | Size | Patient/subject separation | Independence and rights boundary |
|---|---:|---|---|
| DeepDRiD regular-fundus training export | 1,189 images / 299 patients | Confirmed within export | Development/training-distribution evidence; not external validation |
| DeepDRiD regular-fundus validation export | 400 images / 100 patients | Confirmed within export; 0 overlap with training patients | Held-out publisher split; not prospective clinical validation |
| APTOS 2019 capped export | 350 images | Unverifiable | APTOS is reported in the DR publisher training pool; comparability only |
| IDRiD Task 2 lesion test | 27 images | Unverifiable; no patient/eye IDs | IDRiD is reported in the lesion publisher training pool; overlap-disclosed comparison |
| Kermany OCT test mirror | 1,000 scans; 250/class | Unverifiable in mirror | Kermany is the reported OCT training distribution; overlap-disclosed comparison |
| Duke Srinivasan | 3,231 scans / 45 subject folders | Subject-separated folders | Second distribution/device; dry AMD is only an approximate DRUSEN proxy |

The evaluation exports record CC-BY-4.0 for the IDRiD archive and Kermany mirror, a Duke research/educational-only restriction for the Duke archive, and MIT declarations for the published checkpoint/code sources. A model or code license does not automatically clear upstream dataset terms, redistribution, derived-weight rights, or commercial use.

## DR grading validation

The validation export contains five ordinal grades. The predicted integer is a rounded/clamped regression output, not a calibrated probability. Exact validation metrics from the generated summary are:

| Metric | Value |
|---|---:|
| N | 400 |
| Accuracy | 0.5025 |
| Balanced accuracy | 0.2842 |
| Macro F1 | 0.2620 |
| Quadratic weighted kappa | 0.4950 |
| Referable threshold | ground truth and prediction grade `>=2` |
| Referable sensitivity | 0.4389 (79/180; 95% Wilson CI 0.3684–0.5119) |
| Referable specificity | 0.9909 (218/220; 95% Wilson CI 0.9675–0.9975) |
| Referable PPV / NPV | 0.9753 / 0.6834 |
| Referable AUROC / AUPRC | 0.8845 / 0.8967; score-ranking evidence only |
| Any-DR sensitivity / specificity | 0.6416 / 0.9310 |
| Any-DR AUROC / AUPRC | 0.8197 / 0.8939; score-ranking evidence only |

Per-grade sensitivity/specificity:

| Grade | Support | Sensitivity | Specificity |
|---:|---:|---:|---:|
| 0 | 174 | 0.9310 | 0.6416 |
| 1 | 46 | 0.1087 | 0.7994 |
| 2 | 92 | 0.3370 | 0.8539 |
| 3 | 68 | 0.0441 | 0.9940 |
| 4 | 20 | 0.0000 | 1.0000 |

The ordinal output materially undercalls higher grades in this export. The system therefore does not translate it into a diagnosis, referral decision, normality statement, or probability.

## DR false-negative and false-positive registries

The generated [`dr-failure-registry.json`](model-validation/dr-failure-registry.json) contains 101 referable false-negative records and 2 referable false-positive records. Case, patient, and eye keys are deterministic SHA-derived keys; raw export identifiers are not emitted.

The referable false-negative registry is a triage for review, not a pathology explanation. Each entry preserves the ground-truth grade, predicted grade, raw regression score, recorded quality flag where present, and a bounded category such as `GRADE_UNDERCALL_OR_THRESHOLD_TRANSFER`. It does not assert why a particular image failed. The two referable false positives are likewise retained as overcall/threshold-transfer candidates.

## Lesion validation

The IDRiD export has 27 images and four lesion classes. It supplies aggregate pixel counts and detection counts but no usable negative-image region table or per-lesion registry. The measured class values are:

| Class | Dice | IoU | Pixel sensitivity | Pixel precision | Detection sensitivity | Aggregate FP pixels/image |
|---|---:|---:|---:|---:|---:|---:|
| MA / microaneurysm-like | 0.4046 | 0.2536 | 0.4003 | 0.4090 | 1.0000 (27/27) | 588.07 |
| HE / hemorrhage | 0.6649 | 0.4981 | 0.6469 | 0.6840 | 0.9630 (26/27) | 3,326.26 |
| EX / hard exudate | 0.7641 | 0.6182 | 0.7692 | 0.7590 | 1.0000 (27/27) | 2,741.52 |
| SE→CWT / cotton-wool-like | 0.7115 | 0.5522 | 0.6545 | 0.7794 | 0.7143 (10/14) | 341.89 |

Region-level false-positive burden is explicitly `NOT_MEASURABLE`; zero exported detection FP values are not interpreted as zero false positives. The per-lesion false-negative analysis is also blocked because aggregate exports do not identify individual lesions. The attached engineering failure analysis remains `NOT_RUN` and records missing independent cohort, missing runtime dependencies, absent pre-registered component rule, unresolved data rights, and unavailable reported failure image.

## OCT validation and external shift

On the Kermany mirror, the 1,000 cases are evenly distributed across CNV, DME, DRUSEN, and NORMAL. Patient separation is not verifiable and the checkpoint training distribution overlaps the evaluation distribution. The comparison metrics are accuracy `0.9770`, balanced accuracy `0.9770`, and macro F1 `0.9770`. Per-class sensitivity is CNV `0.9960`, DME `0.9960`, DRUSEN `0.9360`, and NORMAL `0.9800`.

The Kermany error registry contains 23 hashed misclassification records. Image quality and device are not recorded in the mirror export.

The Duke export contains 3,231 scans from 45 subject folders on Spectralis SD-OCT. The subject-majority result is recorded as 42/45 (`0.933`). Scan-level accuracy is `0.8437` (recorded source value `0.844`). The external mapping treats Duke dry AMD as a `DRUSEN-proxy`; it has no CNV reference class, so the 112 dry-AMD→CNV predictions remain visible as out-of-label errors. The approximate mapped class sensitivities are NORMAL `0.8159`, DME `0.9246`, and DRUSEN-proxy `0.7746`.

This is domain-shift evidence, not clinical validation. The OCT runtime executes the backbone argmax only; the publisher's hybrid XGBoost head is not executed. `NORMAL` is a classifier class and never means a healthy eye, disease absent, or no need for professional review.

## Calibration and operating points

No installed model has an accepted clinical calibration record. DR raw logits are score rankings only. OCT descriptive Kermany calibration reported mean absolute confidence error `0.55` and Brier `0.41` raw, with the artifact temperature trial reporting `0.56/0.43`; temperature was not adopted. Lesion argmax masks are not probabilities.

The only governed research operating-point record currently present is the DR fixed ordinal rule (`dr-fixed-round-rule-v1`) used to reproduce the displayed grade. It is not a clinical referral threshold. No device-specific, prevalence-specific, prospective, subgroup, or reader-comparison operating point has been accepted.

## Specialist expansion decision

The nine specialty lanes are represented in the application, but evidence-backed models are not available for all of them. The isolated SegFormer artifact may produce optic-disc/cup anatomy research output only. It does not produce cup-to-disc risk, glaucoma probability, or glaucoma diagnosis, and the generic fundus behavior included anatomically implausible behavior that remains disclosed as a candidate limitation.

Cornea/external-eye, cataract/lens, neuro-ophthalmology, pediatric, uveitis/inflammation, and ocular oncology have no artifact-backed, validated local model package accepted for execution. Their deterministic lanes preserve missing evidence and escalate to professional review; they do not infer normality from model absence.

## Release gate

**Model classification:** `MODEL INTELLIGENCE PARTIAL`.

The local model fabric is suitable for controlled technical research and software demonstration. It is not suitable for clinical deployment, autonomous diagnosis, treatment recommendation, or any claim that an output proves disease presence or absence.

Generated artifacts:

- [`validation-summary.json`](model-validation/validation-summary.json)
- [`dr-failure-registry.json`](model-validation/dr-failure-registry.json)
- [`oct-error-registry.json`](model-validation/oct-error-registry.json)
- [`lesion-metrics.json`](model-validation/lesion-metrics.json)
- model cards in [`docs/model-validation/`](model-validation/)
