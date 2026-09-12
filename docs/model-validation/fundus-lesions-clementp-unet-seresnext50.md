# Model card — ClementP fundus lesion segmentation U-Net SE-ResNeXt50 32x4d

**Model ID:** `fundus-lesions-clementp-unet-seresnext50`

**Version:** `a2cfcb594e483`

**Validation status:** **RESEARCH_ONLY**
**Observed evidence date:** 2026-09-08

## Intended research use

Offline technical research only: lesion-like region localization on fundus photographs as decision-support observations requiring ophthalmic review. Never a diagnosis, never a normality claim.

## Inputs and outputs

- Modalities: FUNDUS
- Dimensions: 3x1024x1024
- Preprocessing: clementp-source-pinned-1024-v1: RGB decode; non-black fundus-field crop at 5%-of-max threshold; bicubic longest-side to 1024; centered zero-pad to 1024 square; 0..1 scale; ImageNet mean [0.485,0.456,0.406] std [0.229,0.224,0.225]. Implemented by scripts/inference/fundus_lesion_probe.py crop_and_pad.
- Output contract: `fundus-lesion-segmentation-contract/2-original-image-geometry`
- Anatomy: retina
- Findings: cotton_wool_spot, hard_exudate, retinal_hemorrhage, microaneurysm_like_lesion

## Source, license, and artifact

- Source: https://huggingface.co/ClementP/fundus-lesions-segmentation-unet_seresnext50_32x4d revision a2cfcb594e483d8baa17f24e1152009641cb9847
- License declaration: MIT (model code/checkpoint tag as published; training-data terms unresolved - see candidate dossier)
- Artifact: `model.safetensors` (safetensors)
- SHA-256: `a7a7cb45b92328f7c9a8e581eec3944fd435d37fae8cbf340b1319c5f987c6d2`
- Training data: DDR + FGADR + IDRiD + MESSIDOR + RETLES (as reported on the model card); version as-reported-by-publisher; provenance https://huggingface.co/ClementP/fundus-lesions-segmentation-unet_seresnext50_32x4d
- Validation data in manifest: none
- Data-rights note: model/checkpoint license does not independently clear upstream dataset terms.

## Measured validation evidence

IDRiD segmentation Task 2 test: 27 images, image-level export, no verifiable patient split, and overlap with the publisher-reported training set. The four class rows are MA, HE, EX, and SE/CWT. Pixel metrics and aggregate FP pixels/image are retained; region FP burden and per-lesion FN registry remain blocked by missing per-image ground truth.

## False positives, false negatives, and calibration

IDRiD lesion test export: pixel Dice/IoU and class detection metrics are available in lesion-metrics.json. Region-level false-positive burden is **NOT_MEASURABLE** because the export lacks a negative-image region table; zero reported detection FP values are not interpreted as zero false positives.

## Known limitations and forbidden interpretation

- RESEARCH status; no clinical or independent validation at install time
- Connected components are unfiltered argmax regions, not validated lesions
- Argmax masks are not calibrated probabilities; raw_score is always null
- Device compatibility is unvalidated for every device (DOMAIN_VALIDATION_UNKNOWN)
- No auditable mask artifact is persisted; only regions, areas, and provenance are stored
- Not a diagnosis, validated lesion overlay, or absence-of-disease claim.
- No automated status transition is made from these measurements.

## Release decision

**Remain research-only.** The evidence is task-level software/research measurement, not clinical validation, not device validation, and not authorization for diagnosis or treatment.
