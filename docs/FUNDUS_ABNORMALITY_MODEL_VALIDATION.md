# Fundus abnormality detection — validation record

Status as of 2026-09-07: **no model is cleared for clinical production or diagnosis**. VisionScan now records a dedicated pre-diagnosis `fundus_abnormality` state. An unavailable, unsuitable, OOD, or target-negative model result can never be presented as a globally normal fundus.

## Candidate selected for controlled research acquisition

| Field | Record |
| --- | --- |
| Model | `ClementP/fundus-lesions-segmentation-unet_seresnext50_32x4d` |
| Publisher / task | ClementP; 1024x1024 semantic segmentation of cotton-wool spots, exudates, hemorrhages and microaneurysms |
| Artifact | `model.safetensors`, revision `a2cfcb594e483d8baa17f24e1152009641cb9847` |
| Local SHA-256 | `a7a7cb45b92328f7c9a8e581eec3944fd435d37fae8cbf340b1319c5f987c6d2` |
| License | MIT (model card and toolkit repository) |
| Format / security | SafeTensors only; no pickle; no `trust_remote_code`; artifact is outside version control under `scratch/models/` |
| Training-domain statement | DDR, FGADR, IDRiD, MESSIDOR, RETLES; exact patient partition and device/population coverage remain unverified |
| Model-card metrics | Self-reported PR-AUC: IDRiD CWS .670, exudates .786, hemorrhage .674, microaneurysm .398; FGADR CWS .445, exudates .695, hemorrhage .651, microaneurysm .290 |
| Calibration | None supplied; raw scores must never be shown as diagnostic probabilities |
| CPU | Not accepted until an isolated worker benchmark (p50/p95/max) passes; the source dependency graph presently cannot be reproduced from an approved package release (`torchseg` is not published on PyPI) |
| Current status | `CANDIDATE_ONLY` / artifact acquired, **not enabled for app inference** |

The artifact is deliberately not made executable merely because it uses SafeTensors. Its published reference path relies on an unavailable/unreviewed `torchseg` dependency and a direct Git dependency. Installing that chain would violate the project's reviewed-artifact rule. A reviewed, locally reproducible architecture and patient-separated validation set are prerequisites for enabling the provider.

## Generic abnormality detection

No vetted local, calibratable, open-set normal-vs-abnormal fundus model was found that can be responsibly enabled on this CPU deployment. FLAIR is Apache-2.0 research code/weights, but is a prompt-sensitive image-language foundation model with no locked, calibrated general-abnormal endpoint or localization. It is therefore not a detector in VisionScan. The live state is `MODEL_UNAVAILABLE`, never `NO_TARGET_ABNORMALITY_DETECTED`.

## Other specialities

| Area | Decision | Reason |
| --- | --- | --- |
| AMD/drusen/pigment | No artifact enabled | ADAM/AREDS access and data-use terms require approval; no vetted open pretrained model was found. |
| Glaucoma | Existing disc/cup SegFormer remains isolated research segmentation | It has no lesion/general pathology scope and cannot imply glaucoma. |
| Vascular occlusion | No artifact enabled | BRSET has credentialed-access, coarse labels; no localization-ready candidate cleared. |
| Retinal detachment | No fundus model enabled | PALM detachment masks are pathologic-myopia specific; not generic RD. ERDES is a separate ultrasound modality only. |
| Pigmented/choroidal lesion | No artifact enabled | Available studies use restricted/private data; no legally usable validated public model found. |

## Required validation before any activation

1. Pin an immutable artifact revision and verify SHA-256 before every load; allow only SafeTensors/ONNX and known local code.
2. Independently reproduce preprocessing and CPU worker inference with load/inference timeout and cancellation.
3. Use held-out, patient-separated development data and an external device/population dataset. Record sensitivity, specificity, PPV, NPV, AUROC, AUPRC, F1, ECE, Brier, confusion matrices; for masks record Dice/IoU, lesion sensitivity and false positives/image.
4. Select thresholds using validation data; record provenance and false-negative review. No threshold is set today.
5. Red-team malformed images, decompression bombs, bad EXIF, NaN/Infinity, tampered hashes, non-fundus/OCT/face inputs, and fake localization.

## Sources

- [ClementP model card](https://huggingface.co/ClementP/fundus-lesions-segmentation-unet_seresnext50_32x4d)
- [Fundus lesions toolkit](https://github.com/ClementPla/fundus-lesions-toolkit)
- [BRSET data record](https://physionet.org/content/brazilian-ophthalmological/1.0.0/)
- [ERDES ocular-ultrasound dataset](https://osupcvlab.github.io/ERDES/index.html)
