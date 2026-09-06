# Fundus lesion model integration record

Status: **CANDIDATE_ONLY / DISABLED** (2026-09-07).

This phase proved that the checkpoint can be reconstructed and loaded safely
in an isolated offline probe. It did not clear the model for the live
analysis pipeline. A technically loadable checkpoint is not a validated
clinical or even independently validated research detector.

## Artifact and exact architecture

| Item | Evidence |
| --- | --- |
| Source | [ClementP model card](https://huggingface.co/ClementP/fundus-lesions-segmentation-unet_seresnext50_32x4d) |
| Immutable revision | `a2cfcb594e483d8baa17f24e1152009641cb9847` |
| Artifact | `model.safetensors`, 138,428,676 bytes |
| SHA-256 | `a7a7cb45b92328f7c9a8e581eec3944fd435d37fae8cbf340b1319c5f987c6d2` |
| SafeTensors parse | 444 tensors; no metadata/object payload; finite declarative tensors |
| Architecture | U-Net + SE-ResNeXt-50 32x4d; `torchseg.create_model(arch='unet', encoder_name='seresnext50_32x4d', encoder_weights=None, in_channels=3, classes=5)` |
| Decoder/head | five decoder blocks `[256,128,64,32,16]`; final `Conv2d(16,5,3)` |
| Class order | `0 BG`, `1 CTW`, `2 EX`, `3 HE`, `4 MA` |
| Package source | PyPI `torchseg==0.0.1a4`, wheel SHA-256 `2e10bbb8c9c079770c8cd0c34c898a699db06414e2674498f07d6473085e4463` |

The SafeTensors checkpoint has a publisher wrapper prefix (`model.`). The
offline probe removed only this single known prefix and loaded all **444/444**
keys with `strict=True`: zero missing, unexpected, or shape-mismatched keys.
No `from_pretrained`, `trust_remote_code`, pickle loader, network request, or
direct Git dependency was used.

## Reproducible runtime probe

The isolated probe used Python 3.12.10, CPU-only PyTorch 2.14.0, TorchSeg
0.0.1a4, timm 0.9.16 and einops 0.7.0. At 1024x1024 it produced finite
`(1,5,1024,1024)` output with per-pixel softmax sums of 1.0. Three warmed
single-image measurements with four CPU threads were 2.318s, 2.240s and
2.366s (p50 2.318s; observed max 2.366s). A separate one-run probe measured
3.662s. These are engineering probes, not a production SLO or clinical
performance claim.

The source preprocessing evidence is pinned to toolkit commit
`07dfd63c94eb1dcc894595af53486b51d7ce22b6` / constants commit
`76840bf2b24ce243cabdfa4bf038468d9e59eebb`:

1. Read bytes as RGB.
2. Crop the non-black fundus field using the source's 5%-of-maximum threshold.
3. Bicubic-resize the longest side to 1024 and zero-pad to a 1024 square.
4. Convert 0..255 to 0..1 and normalize with ImageNet mean
   `[0.485,0.456,0.406]` and std `[0.229,0.224,0.225]`.

The artifact itself does not store preprocessing. The original helper's
dependencies are unpinned and the OpenCV 5 API changes the cropper's return
shape, so this protocol is recorded as a candidate reproduction, not yet an
approved runtime specification.

## Local engineering-image result

The only fundus image currently present in `scratch/test_images` is the
existing non-PHI engineering image `example_fundus.jpg`; it is **not** the
user-supplied abnormal failure image. With the pinned probe, the model
produced finite output and an argmax-only 16-pixel
`microaneurysm_like_lesion` region at normalized box
`x=.546875,y=.921875,w=.0048828125,h=.00390625`. No hemorrhage, exudate, or
cotton-wool region was produced. Because argmax-only masks have no validated
threshold or calibration and the checkpoint is candidate-only, this is
recorded as an engineering observation/possible false positive—not as a
lesion claim and not as a regression answer for the missing supplied image.

## Why it remains disabled

- The model card reports training on DDR, FGADR, IDRiD, MESSIDOR and RETLES;
  none can be called independent validation without exact patient/sample
  manifests proving non-overlap.
- The training-data terms are unresolved. FGADR is non-commercial research
  data; an MIT model tag alone does not settle downstream rights.
- No legally cleared, patient-keyed, independent validation cohort is present.
  TJDR is a possible future cohort, but archive license, checksum, grouping,
  and annotation rights require confirmation first.
- No threshold protocol, calibration evidence, Dice/IoU, sensitivity,
  specificity, confidence intervals, or false-negative review is recorded.
- The supplied abnormal-image fixture is not present in this workspace, so no
  result is claimed for it and no filename/hash shortcut exists.

## Required validation before `RESEARCH`

Use a legally authorized independent cohort with patient/eye/visit grouping.
Freeze preprocessing and thresholds on a calibration partition, then lock a
patient-separated test set and an external device/population set. Report per
class Dice, IoU, precision, recall, F1, lesion-component sensitivity,
false-positives/image, image-level sensitivity/specificity/PPV/NPV where
scores justify it, clustered bootstrap intervals, device/quality subgroups,
and structured false-negative/false-positive categories. Raw softmax values
remain ranking scores, not probabilities; calibration is `NOT_CALIBRATED`.

Only after those gates, offline network isolation, adversarial mask tests,
CPU/concurrency benchmarks, and legal review pass may a human reviewer
consider moving the status to `RESEARCH`. It must never move directly to
`CLINICALLY_VALIDATED`.
