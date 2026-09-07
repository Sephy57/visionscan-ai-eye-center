# Fundus lesion failure analysis (research model)

Status: **RESEARCH** — unvalidated research detector. This document records
measured misses and false alarms so they stay visible. It is updated when new
evaluation evidence lands. Last updated: 2026-09-08.

Model: `fundus-lesions-clementp-unet-seresnext50` @ `a2cfcb594e483`
(artifact SHA-256 `a7a7cb45…987c6d2`). Decision rule: raw argmax connected
components, no operating threshold, no calibration. Every region the model
emits carries `UNFILTERED_ARGMAX_COMPONENT_NOT_VALIDATED_AS_LESION`.

## External validation: DeepDRiD (non-overlapping, patient-separated, with negatives)

Cohort: DeepDRiD regular fundus, CC-BY-SA-4.0, Shanghai sites — no overlap
with publisher-reported training sets. Publisher splits kept and
patient-disjointness verified (300 + 100 patients, zero shared IDs):
validation 400 images / 100 patients (endpoint), training 1189 images /
299 patients. Per-eye ICDR grades from dataset CSVs. Full per-image data:
`docs/evaluations/deepdr-external-20260908-raw.json`.

Image-level lesion detection rate by ground-truth eye grade (VAL endpoint):

| GT grade | detected/total | rate | patients |
| --- | --- | --- | --- |
| 0 (negatives) | 113/174 | 0.649 | 57 |
| 1 | 40/46 | 0.870 | 21 |
| 2 | 92/92 | 1.000 | 33 |
| 3 | 68/68 | 1.000 | 24 |
| 4 | 19/20 | 0.950 | 10 |

Training split (same protocol): grade 0: 326/532 (0.613, 179 patients);
grade 1: 0.892; grade 2: 0.996; grade 3: 1.000; grade 4: 0.986 — consistent
across splits.

Load-bearing conclusions:

- Lesion-present sensitivity is excellent (grade ≥1: 0.87–1.00).
- Lesion-absent specificity is poor: ~61–65% of DR grade-0 eyes still get
  ≥1 argmax region (specificity ≈ 0.35–0.39 at image level). The argmax-only
  rule fires on vessel/reflection content in healthy eyes. Any UI or report
  wording implying discriminative ability on healthy eyes is therefore
  forbidden; NO_TARGET_ABNORMALITY_DETECTED states carry the mandatory
  other-pathology disclaimer.
- Output-state distribution (VAL): MULTIPLE_ABNORMALITIES 285,
  SUSPICIOUS_ABNORMALITY 47, NO_TARGET_ABNORMALITY_DETECTED 68.

## Overlap-disclosed measurement (IDRiD)
(27 images, CC-BY-4.0; archive.org item `idrid`, `A. Segmentation.zip`, MD5
`804ca21196beecf7f3a433dc59d37256`). GT masks were warped into the 1024²
model raster with the probe's own recorded crop/resize/pad transform
(nearest-neighbor). Full per-image data:
`docs/evaluations/idrid-seg-test-20260908-raw.json`.

**Overlap disclosure (load-bearing):** IDRiD is named in the
publisher-reported training sets of this checkpoint, so these numbers are
comparability evidence, NOT independent validation. IDRiD publishes no
patient/eye IDs, so patient-separated partitioning cannot be verified;
metrics are image-level.

| Class (GT → model) | n | Dice | IoU | Precision | Recall | Image-sens |
| --- | --- | --- | --- | --- | --- | --- |
| MA → microaneurysm_like_lesion | 27 | 0.405 | 0.254 | 0.409 | 0.400 | 27/27 (1.000) |
| HE → retinal_hemorrhage | 27 | 0.665 | 0.498 | 0.684 | 0.647 | 26/27 (0.963) |
| EX → hard_exudate | 27 | 0.764 | 0.618 | 0.759 | 0.769 | 27/27 (1.000) |
| SE → cotton_wool_spot | 14 | 0.712 | 0.552 | 0.779 | 0.655 | 10/14 (0.714) |

Specificity/PPV/NPV at image level: **not measurable** on this split — every
test image carries MA/HE/EX ground truth, so no true-negative images exist.
No specificity value is claimed. AUROC/AUPRC: not applicable (argmax rule
emits no scores). ECE/Brier: not applicable (NOT_CALIBRATED by construction).

## False negatives (the product's biggest weakness — do not hide)

Image-level misses (ground-truth lesion present, zero predicted pixels):

- `IDRiD_55` SE (256 GT px), `IDRiD_71` SE (1384 px), `IDRiD_72` SE (1392 px),
  `IDRiD_74` SE (949 px): four cotton-wool-spot misses, including two large
  (>1300 px) lesions. SE image-sensitivity is 10/14.
- `IDRiD_57` HE (204 GT px): hemorrhage miss; the same image also has the
  worst MA pixel recall (0.000 at 155 GT px with 26 predicted px elsewhere).

Pixel-recall weakness (microaneurysms): MA pixel recall is ≤0.35 on
8/27 images (`IDRiD_57/79/81/61/62/75/58/60`). Tiny low-contrast lesions are
the systematic miss category — consistent with the publisher's own weak
self-reported MA figures and with argmax-only (no threshold tuning) behavior.

Miss categories observed: tiny lesions, low-contrast lesions, cotton-wool
spots (4/14 image-level). No evidence yet on: peripheral lesions, device
shift, high myopia, pigmentation, media opacity (no subgroup labels in this
cohort). A target-negative result therefore never supports a normal-fundus
claim — the pipeline phrases it exactly that way.

## False positives (measured, not hypothetical)

- Degenerate-input probes: uniform white → NO_TARGET (clean); uniform black
  → fail-closed (no fundus field); random noise → 64 spurious argmax regions
  (MULTIPLE_ABNORMALITIES); red synthetic SVG → 2 hemorrhage-like regions
  covering 764k px (the detector fires on red). Noise and non-fundus red
  content are confirmed false-alarm sources.
- Optic-disc confusion: **zero** predicted lesion pixels fell inside the
  IDRiD optic-disc masks across all 27 test images (0.0000). No evidence of
  disc-vs-lesion confusion in this split; vessel/reflection/laser-scar
  confusion is still unmeasured (no labels for those).
- Engineering image `example_fundus.jpg`: deterministic 16-px
  microaneurysm-like component (5/5 identical runs). No ground truth exists
  for this image; recorded as POSSIBLE_FALSE_POSITIVE_CANDIDATE, not a claim.

## Threshold governance

There is no operating threshold to govern: the rule is fixed argmax with no
score cut. This section stays as a placeholder until a scored operating
point is introduced; at that point thresholds must be frozen on a
calibration partition (never the test set) with dataset/objective/version/
date recorded. No threshold was tuned on the IDRiD test split.

## Calibration

NOT_CALIBRATED. Raw softmax values are ranking scores, never probabilities.
No ECE/Brier is reported because no probability is emitted. UI and reports
must keep showing INDETERMINATE / uncalibrated wording.

## What would change this document

Independent (non-overlapping) cohort metrics with patient IDs, specificity
measurement on true-negative images, device/quality subgroup analysis, and
 clinician-adjudicated FP review. TJDR (Apache-2.0, no training overlap) is
the designated independent cohort; acquisition is in progress (Drive quota
blocked at 53/1100+ files on 2026-09-08 — retry loop running).
