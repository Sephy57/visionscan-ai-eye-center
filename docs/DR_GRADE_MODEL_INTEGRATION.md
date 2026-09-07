# DR grade model integration record

Status: **RESEARCH / pipeline-enabled** (2026-09-08). Must never move beyond
RESEARCH without genuine external and clinical validation evidence.

## Artifact and exact architecture

| Item | Evidence |
| --- | --- |
| Source | [ClementP model card](https://huggingface.co/ClementP/FundusDRGrading-efficientnet_b0) |
| License | MIT (checkpoint tag; upstream dataset terms apply to data reuse) |
| Immutable revision | `aa5741419b902b6f4d6607e2819a0458682e3a49` |
| Artifact | `model.safetensors`, SHA-256 `0d9a18b0cb6c90d1f30bf2e66153b368bd7ff0bcb45b6690e8d5ce14fa19f69b` |
| Architecture | `timm` EfficientNet-B0, `num_classes=1` single regression logit; 360 tensors, strict load with zero missing/unexpected keys |
| Grade rule | `torch.round(logit).clamp(0,4)` → ICDR grades 0–4 (pinned from `my_lightning_module.regression_to_prediction`) |
| Referable convention | grade ≥ 2 (moderate NPDR or worse); a display convention, not a referral decision |
| Preprocessing | `clementp-dr-source-pinned-512-v1`: cv2 BGR decode; channel-0 threshold-10 autocrop (degenerate → whole image); INTER_LINEAR longest-side to 512; centered zero-pad; /255; ImageNet mean/std in channel order (pinned from `data/fundus.py`, albumentations 1.4.4) |
| Residual caveat | Publisher used opencv 4.9, runtime uses 5.0 (possible last-bit resize rounding differences; determinism within this environment verified) |

SafeTensors only; the `.bin` pickle sibling was never downloaded. No
`trust_remote_code`, no remote code, offline inference (`HF_HUB_OFFLINE`).

## CPU benchmark (2026-09-08, this machine, 4 threads)

Cold end-to-end worker run (spawn + torch import + load + infer): 3.84s.
Peak worker RSS: ~407 MB. Runs sequentially after the lesion detector in the
pipeline (never stacked in RAM); own provider mutex serializes concurrent DR
requests. Interactive traffic unaffected (login API p50 ~68ms).

## Training overlap (load-bearing)

Publisher collection reports training on EyePACS + APTOS + DDR + IDRiD.
Self-reported QWK (0.751 EyePACS / 0.751 IDRiD / 0.712 DDR) must NOT be read
as generalization evidence. All product validation below uses non-overlapping
cohorts only (DeepDRiD; TJDR pending).

Legal nuance (from the S8 license audit, preserved from the graduated
candidate dossier): the MIT tag sits on the weights page and likely covers
the wrapper/packaging, not a clearance of underlying training-data
restrictions — APTOS terms are explicitly non-commercial/academic-research
and EyePACS Kaggle terms restrict redistribution. Genuinely unresolved;
classified REVIEW_REQUIRED, not PASS. Current authorized scope is internal,
non-commercial research/evaluation only. A human legal reviewer must resolve
this before any broader use.

## External measurement (2026-09-08, DeepDRiD regular fundus)

Cohort: DeepDRiD regular fundus, CC-BY-SA-4.0, no-login GitHub, Shanghai
sites. Publisher splits kept: validation 400 images / 100 patients, training
1189 images / 299 patients; patient-ID overlap between splits verified ZERO.
Per-eye ICDR grades from dataset CSVs. Full per-image data:
`docs/evaluations/deepdr-external-20260908-raw.json`.

Validation split (endpoint): QWK **0.495**, accuracy 0.502;
referable (≥2) sensitivity **0.439** (79/180), specificity **0.991**
(218/220), PPV 0.975, NPV 0.683; any-DR (≥1) sensitivity 0.642,
specificity 0.931. Training split (same protocol): QWK 0.477; ≥2
sensitivity 0.378, specificity 0.982 — consistent, not split-overfit.

Grade-distribution shift: the model predicts grade 0 far more often than
ground truth (VAL predicted 243×0 vs 174 GT) and almost never predicts
grades 3–4 (5 predictions vs 88 GT cases). External sensitivity for
referable disease is weak; specificity is high. This matches the
independently reported threshold-transfer problem for DR graders and is
the reason the model stays RESEARCH with a NOT_CALIBRATED, non-referral
labeling.

## Live wiring

- Package `data/models/fundus-dr-grading-effb0/` (manifest + artifact, verified every load).
- Registry RESEARCH, modalities [FUNDUS], findings [`dr_grade_estimate`], conditions [], `regulatory_status: research_only`.
- Provider `lib/models/drGradeLocalProvider.ts` (own serialization mutex, 120s bound, contract validation, null calibration).
- Pipeline runs it sequentially after the lesion detector for in-scope fundus input; grade-0 estimates emit NO finding (grade lives in `dr_assessment` only); grades 1–4 emit one observation-level finding.
- Cross-model agreement in `multi_model`: CORROBORATED_RESEARCH_EVIDENCE / MODEL_DISAGREEMENT (no winner) / CONSISTENT_RESEARCH_NEGATIVE / SINGLE_RESEARCH_MODEL / NO_RESEARCH_MODEL_OUTPUT.
- Evidence pattern `diabetic_retinal_disease_pattern` (required: none; supportive: DR estimate + 4 lesion types + blurred/reduced-central vision) caps at POSSIBLE without clinician verification.
- UI: DR assessment card + multi-model agreement card on /result; research limitations in reports.

## Why it remains RESEARCH, not validated

External QWK ~0.48–0.50 with weak referable sensitivity; no calibration;
device/population subgroups unmeasured beyond the Shanghai cohort; no
clinical validation; training-data rights per upstream licenses. A grade-0
estimate never excludes disease; any grade never establishes it.

## Rejected alternatives (researched, not integrated)

AMD/DeepSeeNet (TF1.x/Keras env cost, no CPU-practical path), any glaucoma
classifier (no credible open runnable weights+metrics), OCT classifiers
(pickle-only artifacts), retinal-detachment classifiers (pickle-only,
unpublished, weak per-class evidence), vascular-occlusion classifiers (no
dedicated open model), anomaly detectors (no released weights). Recorded as
NO_VALIDATED_MODEL_AVAILABLE with search trails in the phase report — not
integrated, not claimed.
