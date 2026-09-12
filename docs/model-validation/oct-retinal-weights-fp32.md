# Model card — OCT retinal classifier (EfficientNetV2L+MHA backbone, ONNX)

**Model ID:** `oct-retinal-weights-fp32`

**Version:** `hf-main-2026`

**Validation status:** **RESEARCH_ONLY**
**Observed evidence date:** 2026-09-08

## Intended research use

Offline technical research only: SD-OCT B-scan classification into CNV/DME/DRUSEN/NORMAL as decision-support observation requiring ophthalmic review. Never a diagnosis, never a normality claim, never a probability.

## Inputs and outputs

- Modalities: OCT
- Dimensions: 1x224x224x3
- Preprocessing: oct-edge-source-pinned-224-v1: cv2 BGR decode; BGR->RGB; INTER_LINEAR resize to 224x224; /255; ImageNet mean [0.485,0.456,0.406] std [0.229,0.224,0.225]; NHWC float32 batch of 1. Implemented by scripts/inference/oct_retinal_probe.py. Class order [CNV,DME,DRUSEN,NORMAL] from publisher edge snippet.
- Output contract: `oct-retinal-class-contract/1-argmax-logits`
- Anatomy: retina, macula
- Findings: oct_retinal_class_estimate

## Source, license, and artifact

- Source: https://huggingface.co/animeshakr/oct-retinal-weights (edge ONNX artifact; Keras master avoided); training code https://github.com/Animesh-Kr/Human-Eye-Disease-Prediction (MIT)
- License declaration: MIT (checkpoint tag as published)
- Artifact: `human_eye_fp32.onnx` (onnx)
- SHA-256: `22b1fffb5a0ab88284d4c5817c581bedb1b54c09011d87c3f6472cb2c36b2b1f`
- Training data: Kermany et al. Cell 2018 OCT set (per publisher; exact manifests unavailable); version as-reported-by-publisher; provenance https://huggingface.co/animeshakr/oct-retinal-weights
- Validation data in manifest: none
- Data-rights note: model/checkpoint license does not independently clear upstream dataset terms.

## Measured validation evidence

Kermany mirror: 1,000 scans, patient separation not verifiable, overlap-disclosed.

Duke Srinivasan: 3,231 scans from 45 subjects, subject-separated, Spectralis cohort, approximate DRUSEN-proxy mapping; scan and subject-majority metrics are separate and not merged.

## False positives, false negatives, and calibration

Kermany metrics are kept as overlap-disclosed comparability evidence; Duke provides a subject-separated independent distribution with an approximate dry-AMD-to-DRUSEN mapping. The NORMAL class remains a bounded research class.

## Known limitations and forbidden interpretation

- RESEARCH status; no clinical validation; single external test distribution measured (overlap-disclosed)
- Backbone argmax only; the author's XGBoost hybrid head is not executed
- No calibrated confidence exists for any class; logits are ranking scores only
- Single-scanner training distribution; cross-scanner behavior unvalidated
- Device compatibility is unvalidated for every device; domain validation is UNKNOWN for every study
- NORMAL is an internal classifier class, never a healthy-eye or disease-absent conclusion.
- No automated status transition is made from these measurements.

## Release decision

**Remain research-only.** The evidence is task-level software/research measurement, not clinical validation, not device validation, and not authorization for diagnosis or treatment.
