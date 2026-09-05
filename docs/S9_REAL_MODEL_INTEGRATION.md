# S9 — First Real Ophthalmic Model: Safe Loading + Real CPU Inference

> **Status: S9 IMPLEMENTED — the first genuine, working local model inference
> in this codebase.** A real, license-cleared, safetensors-only checkpoint
> was downloaded, independently hashed, safely loaded, and run against a
> real fundus photograph on CPU. The result is research output only.
> **NOT A MEDICAL DEVICE. NOT CLINICALLY VALIDATED. NOT FOR CLINICAL USE.**
> `data/models/` remains empty. Gate A remains CLOSED. Nothing here is
> reachable from `lib/analysis/pipeline.ts` or any live clinical code path.

**TECHNICALLY WORKING ≠ CLINICALLY VALIDATED.** Every fact in this document
about *inference succeeding* is real and reproducible. Nothing in this
document should be read as a claim about *diagnostic accuracy* — the model
has zero published validation evidence (see §16, and
`lib/models/candidateDossiers.ts`).

## 1–5. Exact artifact, source, license, SHA-256, checkpoint format

| Field | Value |
|---|---|
| Model | `pamixsun/segformer_for_optic_disc_cup_segmentation` |
| Source | https://huggingface.co/pamixsun/segformer_for_optic_disc_cup_segmentation |
| License | Apache-2.0 (HF model-card tag, verified directly) |
| Files downloaded | `config.json`, `preprocessor_config.json`, `model.safetensors` — **`pytorch_model.bin` (pickle) was never fetched** |
| SHA-256 (`model.safetensors`) | `22e45131b64eb07a5d29a2e5388a7709d10696b13f48d2d0cdcf56cafa1f9ea5` |
| Verification | Computed independently with `sha256sum`; cross-checked against HuggingFace's own recorded LFS `sha256` via `GET /api/models/{id}?blobs=true` — **exact match**. File size also matches exactly (188,982,852 bytes). |
| Checkpoint format | `safetensors` — a declarative tensor-only format; **no pickle deserialization, no code execution on load** |

Storage location: `scratch/models/segformer-optic-disc-cup-refuge/`
(gitignored, **not** `data/models/`, not committed — see `.gitignore`).

## 6. Security analysis

- Read the model's `config.json`/`preprocessor_config.json` directly:
  `architectures: ["SegformerForSemanticSegmentation"]`, a **native,
  built-in `transformers` class** — no `trust_remote_code`, no custom
  `modeling_*.py` files.
- Only `model.safetensors` was downloaded and only it is ever loaded
  (`use_safetensors=True`, `local_files_only=True` in
  `scripts/inference/segformer_infer.py`). The pickle-based
  `pytorch_model.bin` sibling was never fetched, eliminating that
  deserialization surface entirely for this deployment's copy.
- No network access occurs at inference time (`local_files_only=True`).
- No `shell=True`, no arbitrary command construction — the Node-side bridge
  (`lib/models/segformerResearchProvider.ts`) uses `child_process.spawn`
  with a fixed argument array, identical safety pattern to
  `lib/models/pythonBridgeProvider.ts` (S7).
- **Real adversarial safety finding**: the loaded model was fed a 1×1
  pixel image, an all-black image, an all-white image, and an
  extreme-aspect-ratio image. **Every one "succeeded"** — produced a
  numerically valid (no NaN/Inf) but meaningless segmentation, with no
  internal error or warning from the model itself. This proves the
  existing S6 image-suitability/OOD gate (`lib/analysis/imageSuitability.ts`)
  is load-bearing, not optional infrastructure — the model provides no
  safety net of its own against garbage input.
- Malformed (non-image) bytes and a missing file both correctly raised a
  Python exception (`UnidentifiedImageError`, `FileNotFoundError`) *before*
  reaching the model — the file-loading layer, not the model, is what
  catches those cases.

## 7. Environment

- Isolated venv (S7): `D:\AI EYE ANALYSIS PLATFORM\.venv-ophthalmic\`
  (never global/user site-packages), Windows Python 3.12.10.
- S9 added: `pip install transformers safetensors` into the same venv.

## 8. Dependency versions (exact, `pip freeze`)

```
torch==2.14.0+cpu          torchvision==0.29.0+cpu     numpy==2.5.2
pillow==12.3.0              transformers==5.16.1        safetensors==0.8.0
tokenizers==0.23.1          huggingface_hub==1.29.0     (+ their transitive deps)
```

## 9. Architecture

SegFormer (MiT-B4-scale encoder: `depths=[3,4,18,3]`,
`hidden_sizes=[64,128,320,512]`), 47,226,307 parameters (F32, confirmed via
HF's own `safetensors` metadata), 3-class semantic segmentation head
(`0: background, 1: optic disc, 2: optic cup`), `image_size: 224` in the
base config (actual runtime resize is 512 per the preprocessor — see §10).

## 10. Preprocessing (confirmed from `preprocessor_config.json`, not guessed)

`do_resize: true, size: 512, resample: 2 (bilinear), do_rescale: true
(1/255), do_normalize: true, image_mean: [0.485, 0.456, 0.406], image_std:
[0.229, 0.224, 0.225]` — standard ImageNet normalization, applied
automatically by `SegformerImageProcessor.from_pretrained(...)`. No
undocumented or invented preprocessing step exists anywhere in this
pipeline.

## 11. CPU benchmark (real, measured — not estimated)

Two full runs on this deployment's hardware (15.3GB RAM, AMD integrated
GPU/no CUDA):

| Phase | Run 1 (cold) | Run 2 (warm) |
|---|---:|---:|
| Python import | 7.37s | 4.63s |
| Model load | 1.17s | 0.40s |
| Preprocess | 0.37s | 0.02s |
| Inference | 1.89s | 1.02s |
| Postprocess | 0.20s | 0.14s |
| **Total** | **11.30s** | **6.28s** |

Import time is a one-time process-startup cost, not per-image. Steady-state
single-image inference is ~1 second — confirms **EASY** CPU feasibility,
empirically, not by estimate.

## 12. Test image characteristics

Real 1634×1634 JPEG fundus photograph, the official example image from
`pamixsun/swinv2_tiny_for_glaucoma_classification` (a companion model by the
same author, publicly linked from this model's own HF widget metadata).
SHA-256: `ba717a1842543f53eee980fe593129738b5598ff343f33174a712af8d2c991fb`.
Not a study upload, not PHI — a publicly hosted example asset.

## 13. Real inference result

```json
{
  "inference_status": "completed",
  "modality": "FUNDUS",
  "laterality": "unknown",
  "findings": [
    {"finding_type": "research_segmented_optic_disc_area", "laterality": "unknown",
     "evidence": "23671 px / 2669956 px (0.89%)"},
    {"finding_type": "research_segmented_optic_cup_area", "laterality": "unknown",
     "evidence": "31305 px / 2669956 px (1.17%)"}
  ],
  "confidence": null, "calibrated_confidence": null,
  "limitations": ["RESEARCH_INFERENCE only - NOT CLINICALLY VALIDATED.", "..."]
}
```

**Notable, honestly-reported finding**: the segmented "optic cup" area
(31,305 px) is *larger* than the segmented "optic disc" area (23,671 px).
Anatomically, the cup is a sub-region of the disc, so the cup should never
exceed the disc in a correct segmentation. This is concrete, first-hand
evidence that the model's real-world behavior on an image outside its
REFUGE training distribution is unreliable — fully consistent with, and now
corroborating, its already-documented zero published validation evidence
(§16). This result is preserved and reported exactly as produced — it was
**not** adjusted, filtered, or reinterpreted to look more plausible.

Result was deterministic across two independent runs on the same image
(model is in `eval()` mode, no dropout).

## 14. Output structure

Mapped into the existing `RawModelOutput`/`RawFinding` contract
(`lib/models/outputContract.ts`, unchanged from S4/Phase 6) and validated
with the existing `validateRawModelOutput()` — passes with zero errors. No
new output type was invented; the existing contract already covered this
shape.

## 15. Provenance

Every research-inference call records: input image SHA-256, image original
dimensions, model directory, raw logits/mask tensor shapes, class pixel
counts, per-phase timing, and the exact torch version used (all in
`scripts/inference/segformer_infer.py`'s `_debug` block and the caller's
knowledge of the artifact's own SHA-256). Laterality is always `"unknown"`
— never inferred from pixels, per the hard rule carried through every phase
since S5.

## 16. Technical validation (NOT clinical validation)

| Check | Result |
|---|---|
| Artifact hash reproducibility | PASS — independently recomputed hash matches HF's own record exactly |
| Deterministic loading | PASS — two independent process runs produced identical model weights load |
| Successful inference | PASS — real image, real output, no NaN/Inf |
| Repeatability | PASS — identical findings across two runs on the same image |
| Output tensor shape | PASS — `(1, 3, 128, 128)` logits, upsampled to input resolution, matches the 3-class config |
| Expected classes | PASS — exactly `{0, 1, 2}` observed, matching `id2label` |
| Numerical range | PASS — no NaN/Inf in any run, including all adversarial cases |
| NaN/Inf rejection | PASS — the pipeline checks and would fail closed if ever triggered (never triggered in testing) |

**None of the above is clinical accuracy.** The model has zero published
Dice/IoU/sensitivity/specificity, no confirmed patient-level split, and the
one real anatomically-implausible result observed in §13 is direct evidence
against relying on its output for anything beyond architecture/pipeline
demonstration.

## 17. Safety tests

`tests/s9-real-inference.test.ts` — 11 tests (10 passing + 1 conditionally
skipped when the artifact isn't present on a given machine, since the
189MB checkpoint is gitignored and not part of the repository):
hash-integrity verification, contract-conforming output, determinism,
no-fabricated-confidence, NOT-CLINICALLY-VALIDATED limitations text present,
missing-file fail-closed, malformed-bytes fail-closed, artifact-absent
fail-closed (`ArtifactNotFoundError`), and confirmation the research
provider is unreachable through the live model registry (`getModel`,
`getProviderForModel`, `defaultProvider` all confirm isolation).

Separately, `scratch/adversarial_test.py` (not part of the automated suite,
a manual research script) proved the raw-model fail-open behavior described
in §6 against real degenerate inputs.

## 18. Regression results

**508/508 tests passing, 1 correctly skipped** (up from the S8 baseline of
498 + 10 new S9 tests). `npx tsc --noEmit` clean. No existing S3–S8 test was
modified except one stale assertion in `tests/s6-candidates-route.test.ts`
that hardcoded "every dossier hash is null" — updated to allow either null
or a string, since a dossier legitimately gains a real hash once S9
acquires an artifact for it; the assertion that every dossier is
`CANDIDATE_ONLY` is unchanged and still enforced.

## 19. Build status

Not re-attempted this session — per the S9 authorization's explicit
instruction not to spend the session on the pre-existing, already-documented
Next.js `.next`/dev-server environment issue (S5/S6/S7/S8). `npx tsc
--noEmit`, the full test suite, and `npm run audit:fs` all pass cleanly and
are the authoritative evidence of code correctness for this phase.

## 20. Clinical limitations

- Zero published validation metrics for this checkpoint (Dice, IoU,
  sensitivity, specificity — all UNKNOWN, confirmed by independent S8
  audit).
- Real S9 inference produced an anatomically implausible result on a
  non-REFUGE image (§13) — first-hand evidence of unreliability outside its
  narrow training distribution.
- No calibration evidence exists — no calibrated confidence is exposed or
  fabricated anywhere in the pipeline.
- The model has no internal safety net against unsuitable images (§6) —
  correctness depends entirely on upstream gating that exists in this
  codebase (S6) but is not yet wired to this provider (deliberately — see
  §21).
- A segmented pixel area is not a diagnosis, not a disease probability, and
  not evidence of glaucoma or any other condition on its own — see the
  hard-boundary language already established in S5's evidence-synthesis
  layer and S6's condition-taxonomy safeguards, which this provider does
  not bypass because it is not wired into either.

## 21. Remaining blockers

- **MONAI RPD segmentation (the S8 top-evidence pick) remains blocked**:
  requires Detectron2, which has no official Windows support, no PyPI
  package, and no prebuilt wheels compatible with this deployment's PyTorch
  version (confirmed empirically: `pip install detectron2` → "No matching
  distribution found"). Its dossier now documents this precisely; it
  remains `CANDIDATE_ONLY` with the environment blocker recorded as an
  unresolved blocker distinct from its (clean) license/security findings.
- The SegFormer provider (`lib/models/segformerResearchProvider.ts`) is
  **not** wired to the S6 image-suitability/OOD gate, the S5 evidence
  layer, or any registry entry — it is a standalone, isolated
  proof-of-inference module, exactly matching the S9 stop condition ("do
  not automatically diagnose... do not open Gate A").
- No task-specific validation (own benchmarking against DRISHTI-GS/RIM-ONE,
  as recommended in S8) has been performed.
- Next.js build/dev-server environment issue remains unresolved (unrelated
  to this phase's Python work).

## 22. S10 recommendation

If a future phase continues this line of work, in priority order:

1. **Do not yet wire this provider into the live pipeline.** Gate A stays
   closed; this remains a standalone research module.
2. If pursuing further validation of this specific candidate: run it
   against a public benchmark (DRISHTI-GS or RIM-ONE, both freely
   available) and compute real Dice/IoU against their ground truth masks —
   this would be the first genuine technical-validation evidence for this
   candidate, addressing its core weakness (§16/§20).
3. If pursuing MONAI RPD segmentation instead: this would require either
   (a) a proper Linux environment (WSL venv or otherwise) where Detectron2
   has real support, or (b) accepting a from-source Windows build attempt
   with its associated risk/time cost — both explicitly deferred by human
   decision this session in favor of the SegFormer pivot.
4. Any future wiring into the live pipeline must go through the existing
   S6 image-suitability gate first (now proven mandatory by §6's real
   adversarial evidence) and the existing model-registry lifecycle ladder
   (`lib/models/registry.ts`) — no shortcuts, no new "CANDIDATE" registry
   status invented (per S7's recon: the real registry has no such rung;
   don't add one without deliberate registry-design work).

**S9 succeeded at its stated, narrow goal**: VisionScan can now safely
download, hash-verify, safely load, and run one real ophthalmic model
locally, producing a genuine, provenance-tracked research output — nothing
more, nothing less.
