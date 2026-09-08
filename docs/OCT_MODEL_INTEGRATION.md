# OCT retinal classifier integration record

Status: **RESEARCH / pipeline-enabled** (2026-09-08). Must never move beyond
RESEARCH without genuine external and clinical validation evidence.

## Artifact and exact architecture

| Item | Evidence |
| --- | --- |
| Source | [animeshakr/oct-retinal-weights](https://huggingface.co/animeshakr/oct-retinal-weights) (edge ONNX artifact) |
| License | MIT (checkpoint tag; repo PubMed/arXiv dissertation context) |
| Artifact | `human_eye_fp32.onnx`, SHA-256 `22b1fffb5a0ab88284d4c5817c581bedb1b54c09011d87c3f6472cb2c36b2b1f` |
| Architecture | EfficientNetV2L + 4-block MHA backbone exported to ONNX (opset 17), CPUExecutionProvider only; 4-logit argmax over [CNV, DME, DRUSEN, NORMAL] |
| Preprocessing | `oct-edge-source-pinned-224-v1`: cv2 BGR decode; BGR→RGB; INTER_LINEAR resize 224×224; /255; ImageNet mean/std; NHWC float32 batch (pinned from publisher `edge_inference/run_inference.py`) |
| Class order | [CNV, DME, DRUSEN, NORMAL] (pinned from the same publisher snippet) |
| Not executed | Keras master (2.07 GB, flagged Unsafe — never downloaded), XGBoost hybrid head (separate JSON; backbone argmax is the deployed path) |

ONNX only (HF-scanner Safe); no pickle, no `trust_remote_code`, offline
inference. The publisher snippet's raw-max-logit "confidence %" is
deliberately NOT reproduced: logits render as MODEL_SCORE, never probability.
Shipped temperature scalar (T≈1.0504) is reported, never applied.

## Training overlap

Publisher: Kermany et al. Cell 2018 OCT set. Training manifests unavailable;
patient-level train/test separation in the author's own split is debated —
recorded as PATIENT_SEPARATION_NOT_VERIFIABLE for the Kermany measurement
below. Modality-disjoint from all fundus datasets (no fundus overlap by
construction).

## External measurement (Kermany test, n=1000, overlap-disclosed)

Source: HF mirror `zacharielegault/Kermany2017-OCT` (CC-BY-4.0), test parquet
only (labels 0:CNV/1:DME/2:DRUSEN/3:NORMAL, 250 each; no patient IDs in
mirror). Per-image data: `docs/evaluations/oct-kermany-test-20260908-raw.json`.

Accuracy 0.977. Confusion (true×pred):

```
        CNV  DME  DRUSEN  NORMAL
CNV:    249    1      0       0
DME:      0  249      0       1
DRUSEN:  15    0    234       1
NORMAL:   0    1      4     245
```

Per-class sens/spec/PPV/NPV: CNV 0.996/0.980/0.943/0.999;
DME 0.996/0.997/0.992/0.999; DRUSEN 0.936/0.995/0.983/0.979;
NORMAL 0.980/0.997/0.992/0.993. Main error mode: DRUSEN→CNV (15) and
NORMAL→DRUSEN (4) — the known NORMAL/DRUSEN boundary fragility, disclosed
(not hidden by the headline accuracy).

Calibration (descriptive, no fitting → no leakage): mean
|confidence−correctness| of raw softmax 0.55, Brier 0.41; with artifact
T=1.0504: 0.56/0.43. Backbone logits are structurally overconfident;
temperature does not repair them (it was fit for the hybrid head, not this
path). Author's ECE 0.0024 claim applies to their hybrid system, never
quoted as ours. Decision: **remain NOT_CALIBRATED** (measured rationale;
see docs/CALIBRATION_AND_THRESHOLD_GOVERNANCE.md).

## Independent measurement: Duke Srinivasan (second distribution)

Cohort: Duke Srinivasan BOE 2014, Spectralis SD-OCT, Duke/Harvard/Michigan,
research-only license, 45 subjects (15 Normal / 15 dry-AMD / 15 DME), 3231
TIFF B-scans, subject folder = ID surrogate. Class mapping (disclosed
approximate): NORMAL→NORMAL, DME→DME, dry-AMD→DRUSEN proxy; no CNV in set
(CNV outputs counted as errors). Full data:
`docs/evaluations/duke-oct-external-20260908-raw.json`.

Scan-level accuracy **0.844** (vs 0.977 Kermany) — reported as DOMAIN_SHIFT:
NORMAL 1148/1407 (234→DME, 25→DRUSEN), DME 1018/1101, dry-AMD→DRUSEN-proxy
560/723 (112→CNV, 48→DME). Subject-majority vote: **42/45 (0.933)** —
NORMAL 15/15, DME 15/15, proxy 12/15. Per-scan noise averages out at subject
level, but single-scan cross-scanner outputs stay weak evidence; the NORMAL
→DME overcall direction is the operational risk (false alarm, not miss).

## Live wiring

- Package `data/models/oct-retinal-weights-fp32/` (manifest + artifact, verified every load).
- Registry RESEARCH, modalities [OCT], findings [`oct_retinal_class_estimate`], conditions [], `regulatory_status: research_only`.
- Provider `lib/models/octLocalProvider.ts` (own mutex, 120s bound, contract validation, null calibration, CPU provider pinned).
- Pipeline OCT branch for in-scope OCT input; NORMAL estimates emit NO finding (class lives in `oct_assessment` only); CNV/DME/DRUSEN emit one observation-level finding; classification-only → never localization, never overlay.
- `multi_model` reports SINGLE_RESEARCH_MODEL for OCT studies (fundus models cannot run on OCT pixels and vice versa — no cross-modality averaging by construction).
- Evidence pattern `oct_macular_class_pattern` (required: none; supportive: OCT estimate + distorted/reduced-central/blurred vision) caps at POSSIBLE.
- UI: OCT classification card on /result (explicit "no overlay" note); research limitations in reports; coverage target `oct_macular_classification` RESEARCH_PIPELINE.

## CPU benchmark (this machine)

Cold end-to-end worker run: ~2–4s per B-scan. Peak worker RSS: ~1.0 GB
(243 MB weights + onnxruntime session). Own provider mutex serializes
concurrent OCT requests; OCT runs only for OCT studies (never stacked with
fundus workers on the same image). Interactive traffic unaffected.

## Why it remains RESEARCH, not validated

Duke is one independent, subject-separated research cohort, while the Kermany
mirror remains an overlap-disclosed comparability set.  The observed Duke
domain shift, uncalibrated backbone output, and single-author MSc provenance
keep this model RESEARCH-only; no clinical validation is claimed. A NORMAL
estimate never means a healthy macula. OCTID/RETOUCH remain future work and
would require their own licensing/DSA and reproducible extraction evidence.

## Rejected alternatives (this phase)

Glaucoma: NO_DEFENSIBLE_GLAUCOMA_MODEL_FOUND (pamixsun: no metrics; Mjolnirslams:
val-only + paired-input + custom-code exec; GARDNet/GlaucomaNet: no weights;
5t4l1n: no license + pickle-only; ONNX options: no metrics or no weights).
OCT fluid/layer segmentation: test Dice 0.27 (unreviewed 500MB weights) or
pickle-only or gated — none defensible. AMD DeepSeeNet: TF1.x env cost, no
CPU-practical path. All stay NO_VALIDATED_MODEL_AVAILABLE with trails in
the phase report.
