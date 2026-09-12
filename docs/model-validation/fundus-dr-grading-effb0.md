# Model card — ClementP fundus DR grading EfficientNet-B0 (regression head)

**Model ID:** `fundus-dr-grading-effb0`

**Version:** `aa5741419b90`

**Validation status:** **RESEARCH_ONLY**
**Observed evidence date:** 2026-09-08

## Intended research use

Offline technical research only: image-level diabetic-retinopathy grade estimation as decision-support observation requiring ophthalmic review. Never a diagnosis, never a normality claim, never a probability.

## Inputs and outputs

- Modalities: FUNDUS
- Dimensions: 3x512x512
- Preprocessing: clementp-dr-source-pinned-512-v1: cv2 BGR decode; channel-0 threshold-10 autocrop (degenerate returns whole image); INTER_LINEAR longest-side to 512; centered zero-pad to 512 square; 0..1 scale; ImageNet mean [0.485,0.456,0.406] std [0.229,0.224,0.225] in channel order. Implemented by scripts/inference/dr_grade_probe.py. Residual caveat: publisher used opencv 4.9, runtime uses 5.0 (possible last-bit resize rounding differences).
- Output contract: `fundus-dr-grade-contract/1-single-logit`
- Anatomy: retina
- Findings: dr_grade_estimate

## Source, license, and artifact

- Source: https://huggingface.co/ClementP/FundusDRGrading-efficientnet_b0 revision aa5741419b902b6f4d6607e2819a0458682e3a49; training code https://github.com/ClementPla/FundusDRGrading (MIT)
- License declaration: MIT (checkpoint tag as published; training-data terms per upstream dataset licenses apply to any data reuse)
- Artifact: `model.safetensors` (safetensors)
- SHA-256: `0d9a18b0cb6c90d1f30bf2e66153b368bd7ff0bcb45b6690e8d5ce14fa19f69b`
- Training data: EyePACS + APTOS + DDR + IDRiD (per publisher collection page; exact manifests unavailable); version as-reported-by-publisher; provenance https://huggingface.co/collections/ClementP/fundus-grading
- Validation data in manifest: none
- Data-rights note: model/checkpoint license does not independently clear upstream dataset terms.

## Measured validation evidence

DeepDRiD regular-fundus validation: 400 images / 100 patients, patient-separated within the export; held-out publisher split, not prospective clinical validation.

Referable threshold: ground-truth and predicted grade >=2. Continuous AUROC/AUPRC are reported as score-ranking measurements only. APTOS is overlap-disclosed comparability evidence and is not merged into the validation metrics.

## False positives, false negatives, and calibration

DeepDRiD validation (n=400) referable sensitivity 0.4389, specificity 0.9909, PPV 0.9753, NPV 0.6834; 101 referable false negatives and 2 referable false positives are registered in dr-failure-registry.json. QWK is 0.495; no calibrated probability was established.

## Known limitations and forbidden interpretation

- RESEARCH status; no clinical validation and no independent external validation completed at install time
- Single regression logit rounded to an integer grade; grade boundaries are uncalibrated
- No calibrated confidence exists for any grade; raw logit is a ranking score only
- Device compatibility is unvalidated for every device; domain validation is UNKNOWN for every study
- Publisher training data (EyePACS/APTOS/DDR/IDRiD per collection) overlaps common benchmarks; validate only on non-overlapping cohorts
- Not a diagnosis, referral decision, probability, or normality claim.
- No automated status transition is made from these measurements.

## Release decision

**Remain research-only.** The evidence is task-level software/research measurement, not clinical validation, not device validation, and not authorization for diagnosis or treatment.
