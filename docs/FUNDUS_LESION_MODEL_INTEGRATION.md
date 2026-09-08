# Fundus lesion model integration record

Status: **RESEARCH / pipeline-enabled** (2026-09-08). Promoted from
`CANDIDATE_ONLY` after the runtime, packaging, and measurement gates below
passed. It must never move beyond RESEARCH without genuine external and
clinical validation evidence (see "Why it remains RESEARCH, not validated").

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

## Runtime readiness (2026-09-08: READY)

The dedicated environment now has the reviewed runtime installed:

- `torchseg==0.0.1a4` from the locally reviewed wheel
  (`scratch/reviewed-packages/`, wheel SHA-256
  `2e10bbb8…3085e4463`; source reviewed: no network/pickle/exec/file-write
  calls), installed offline with `--no-index --no-deps`.
- `timm==1.0.22`, `einops==0.8.1` from PyPI (pinned; inference remains
  offline — the probe sets `HF_HUB_OFFLINE`/`TRANSFORMERS_OFFLINE`).
- `check_environment.py --profile fundus-lesion` reports `ready=true`
  (Python 3.12.10, torch 2.14.0+cpu, opencv 5.0.0).

With this stack the strict `444/444 strict=True` weight load passes, the
historical 16-px MA observation on `example_fundus.jpg` reproduces
byte-identically (5/5 runs), and the warmed 1024² forward reproduces the
historical timing (2.30s vs historical 2.24–2.37s, 4 threads) — confirming
the timm-version change did not alter the computation.

The earlier "temporary overlay" caveat no longer applies; the OpenCV-5
cropper concern was closed by the exact-reproduction evidence above plus
golden coordinate-transform tests.

The source preprocessing evidence is pinned to toolkit commit
`07dfd63c94eb1dcc894595af53486b51d7ce22b6` / constants commit
`76840bf2b24ce243cabdfa4bf038468d9e59eebb`:

1. Read bytes as RGB.
2. Crop the non-black fundus field using the source's 5%-of-maximum threshold.
3. Bicubic-resize the longest side to 1024 and zero-pad to a 1024 square.
4. Convert 0..255 to 0..1 and normalize with ImageNet mean
   `[0.485,0.456,0.406]` and std `[0.229,0.224,0.225]`.

The artifact itself does not store preprocessing. The live probe is a pinned
reconstruction of the helper (including `INTER_CUBIC`, ImageNet constants,
crop/resize/pad geometry, and explicit output metadata); its transport and
coordinate contracts are covered by tests. This is an engineering-compatible
research protocol, not a claim that the publisher's training environment or
clinical performance has been reproduced.

The offline probe now requires `python -I -s`, rejects user/temporary-overlay
dependencies, rejects symlinked model/image/artifact paths, pins the expected
artifact hash without a command-line override, and returns a non-zero process
status on failure. Its argmax output is explicitly
`UNFILTERED_ARGMAX_COMPONENT_NOT_VALIDATED_AS_LESION`; the worker cannot
self-promote from `CANDIDATE_ONLY` to `RESEARCH`.

## Local engineering-image result

The only fundus image currently present in `scratch/test_images` is the
existing non-PHI engineering image `example_fundus.jpg`; it is **not** the
user-supplied abnormal failure image. With the pinned probe, the model
produced finite output and an argmax-only 16-pixel
`microaneurysm_like_lesion` candidate region at model-raster normalized box
`x=.546875,y=.921875,w=.0048828125,h=.00390625`. No hemorrhage, exudate, or
cotton-wool region was produced. Because argmax-only masks have no validated
threshold or calibration and the checkpoint is candidate-only, this is
recorded as an engineering observation/possible false positive—not as a
lesion claim and not as a regression answer for the missing supplied image.

That historical box was in the cropped/padded 1024-square coordinate space
and is **not valid for display over the original image**. The hardened probe
now records the exact crop, resize, and asymmetric padding, suppresses
predictions in artificial padding, separates connected components, and maps
half-open component boxes/centroids to `ORIGINAL_IMAGE_NORMALIZED`. The new
mapping has deterministic portrait, landscape, square, crop-offset,
letterbox, edge, multiple-component, zero-area, and full-frame tests; no
patient/example overlay is claimed because this fixture is engineering data
and the output remains research-only.

## Current benchmarks (2026-09-08, this machine, 4 threads)

- Cold end-to-end per-process (spawn + torch import + load + infer):
  p50 6.82s, max 8.50s (n=5).
- Warmed forward 1024²: 2.30s; model build 0.31s; weight apply 0.04s.
- Determinism: byte-identical stdout across 5 runs.
- Peak worker RSS: ~1.29 GB → the provider serializes inference with a
  module-level mutex (one worker at a time); the live pipeline runs it in
  async jobs, never on the interactive request path.
- Degenerate inputs: black → fail-closed; white → NO_TARGET; noise → 64
  spurious argmax regions (FP evidence); corrupt/text-disguised → fail-closed;
  prompt-injection file content has no effect (bytes are never instructions).

## Overlap-disclosed measurement (2026-09-08)

IDRiD Segmentation Task-2 TEST split (27 images, CC-BY-4.0): per-class
Dice/IoU/precision/recall — MA 0.405/0.254/0.409/0.400, HE
0.665/0.498/0.684/0.647, EX 0.764/0.618/0.759/0.769, SE→CWT
0.712/0.552/0.779/0.655 (n=14); image-sensitivity 27/27, 26/27, 27/27,
10/14. Specificity not measurable (no negative images). Optic-disc
confusion 0.0000. Full data: `docs/evaluations/idrid-seg-test-20260908-raw.json`;
analysis: `docs/FUNDUS_LESION_FAILURE_ANALYSIS.md`. IDRiD is
publisher-reported training data: comparability evidence, NOT independent
validation.

## Live wiring (2026-09-08)

- Installed package: `data/models/fundus-lesions-clementp-unet-seresnext50/`
  (`manifest.json` + `model.safetensors`, SHA-256 verified on every load).
- Registry: `MODELS` entry, status RESEARCH, modalities [FUNDUS], four
  supported findings, zero supported conditions, `regulatory_status:
  research_only`. The candidate dossier graduated out of
  `candidateDossiers.ts` (recorded in its header).
- Provider: `lib/models/fundusLesionLocalProvider.ts`
  (`FundusLesionLocalProvider`, registered for the model id; DEMO remains
  the default provider). Serialized subprocess, 180s bounded timeout,
  32 MB stdout cap, temp-file cleanup, contract validation, null calibration.
- Pipeline (`runPipeline`): FUNDUS + quality-pass input attempts the
  research detector; findings flow through taxonomy gating as
  observation-level RESEARCH observations; `fundus_abnormality` comes from
  `resultFromResearchDetector`. Any failure falls back to the labeled DEMO
  path. Device metadata stays informational (IMAGE_ONLY model):
  absent/unvalidated devices yield DOMAIN_VALIDATION_UNKNOWN disclosure, and
  a dedicated lesion-domain OOD (`deviceUnknownIsDomainUnknown`) keeps
  missing-device cases out of OUT_OF_DISTRIBUTION without weakening the
  strict overall OOD used by triage and the diagnosis gate.
- No auto-diagnosis: possible conditions stay empty (registry gate),
  etiology stays hypothetical, diagnosis gate stays closed, triage still
  escalates independently, medication safety unchanged.
- Coverage registry: four lesion targets are now `RESEARCH_PIPELINE`
  (pipeline-enabled, never production); disease targets remain
  `NO_VALIDATED_MODEL_AVAILABLE`.

## Why it remains RESEARCH, not validated

- The only measured cohort (IDRiD test) overlaps publisher-reported
  training data and has no patient IDs and no negative images.
- Training-data downstream rights (incl. FGADR non-commercial terms) are
  still unresolved; the checkpoint tag is MIT but that does not settle data
  rights. No commercial/clinical use is permitted by this integration.
- No calibration exists or is claimed; specificity is unmeasured; device and
  population subgroups are unmeasured; the user-supplied abnormal image is
  still absent from the workspace.
- Independent cohort (TJDR, Apache-2.0, no training overlap) acquisition is
  in progress; Drive quota blocked bulk download on 2026-09-08 (retry loop
  running).

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
- The dedicated environment currently lacks required reviewed dependencies,
  and the scratch artifact directory is writable by ordinary authenticated
  users. Hash-before/hash-after is not a substitute for immutable packaging.

## Required evidence before any status beyond `RESEARCH`

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
consider any status beyond `RESEARCH`. It must never move directly to
`CLINICALLY_VALIDATED`.
