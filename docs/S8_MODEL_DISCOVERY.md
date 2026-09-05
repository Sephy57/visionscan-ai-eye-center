# S8 — Non-Gated Real Ophthalmic Model Discovery

> **Status: S8 IMPLEMENTED — a discovery/due-diligence phase only.** No model
> was downloaded, installed, or run. `data/models/` is unchanged (empty).
> Gate A remains CLOSED. This document records the research findings behind
> the three new `CANDIDATE_ONLY` dossier entries in
> `lib/models/candidateDossiers.ts` (`monai-retinaloct-rpd-segmentation`,
> `segformer-optic-disc-cup-refuge`, `clementp-fundus-dr-grading-efficientnet`).
> **NOT A MEDICAL DEVICE. NOT CLINICALLY VALIDATED. NOT FOR CLINICAL USE.**

## Why S8 exists

S7 established that this deployment's inference environment (isolated
`.venv-ophthalmic`, CPU-only PyTorch 2.14.0+cpu) is real and working, but the
one real candidate investigated so far — RETFound — turned out to be
inaccessible: every RETFound HuggingFace checkpoint is gated behind an
access-request process this session had no credentials to complete, and even
if obtained, RETFound is a backbone-only foundation model with no
finding-producing task head. S8 searched specifically for **non-gated,
task-specific** models — ones that would actually output a defined clinical
finding, not just an embedding.

## Research method

Three parallel research agents searched by modality (fundus/diabetic
retinopathy, OCT, glaucoma/optic-disc), each fetching primary sources
directly rather than trusting search-result snippets. The three strongest
candidates then went through **three independent due-diligence audits in
parallel** — license/legal, security/supply-chain, and clinical-evidence —
each re-verifying claims at the primary source rather than trusting the
discovery agents' summaries (the "two-agent verification rule").

## A. Executive recommendation

**MONAI `retinalOCT_RPD_segmentation`** is the strongest candidate overall —
the only one of the three with a clean, explicitly-granted permissive
license (BSD 2-Clause), genuine patient-level-split multi-institution
external validation (5 independent cohorts, AUC 0.94), and honestly
disclosed limitations. Its weakness is technical, not legal or clinical: the
checkpoint is pickle-based (`.pth`) and ships as a full MONAI Bundle with
custom executable inference code, which any future integration must handle
by loading only the raw tensor weights (`weights_only=True`) into an
independently-authored model definition — never executing the bundle's own
scripts unreviewed.

## B. Ranked candidates

| Rank | Model | Modality | Task | License | Weights | Validation | External validation | CPU feasibility | Security | Recommendation |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | MONAI `retinalOCT_RPD_segmentation` | OCT | RPD/AMD biomarker segmentation | BSD-2-Clause (PASS) | `.pth` only (pickle) | Patient-level split, internal + external | **Yes** — 5 independent cohorts, AUC 0.94 | UNKNOWN (Mask-RCNN ensemble, GPU-oriented; must benchmark) | HIGH risk (pickle + bundled exec code), mitigable | Best evidence; requires disciplined safe-loading |
| 2 | SegFormer optic disc/cup (`pamixsun`) | Fundus | Disc/cup segmentation | Apache-2.0 (PASS) | safetensors + `.bin` sibling | **None published** | No | Likely easy (47M params) | MEDIUM (unverified uploader, but native code path) | Cleanest legal/security profile, but zero evidence — needs from-scratch benchmarking |
| 3 | FundusDRGrading EfficientNet-B0 (`ClementP`) | Fundus | DR severity grading | MIT tag, but training-data terms unresolved (REVIEW_REQUIRED) | safetensors + `.bin` sibling | Internal, per-dataset only | No (internal only) | Likely easy (4M params) | MEDIUM (unverified uploader) | Weakest evidence + license ambiguity |
| 4 | RETFound (all variants) | Fundus/OCT | Backbone only, no task head | CC-BY-NC-4.0 (research-only, already authorized) | Gated `.pth` | Downstream-task-dependent | N/A | Large (ViT-Large) | UNKNOWN (never obtained) | Blocked on HF gated access; secondary research option |
| 5 | DENet glaucoma screening | Fundus | Disc/cup + glaucoma screening | **Confirmed no license** | Ad-hoc OneDrive/BaiduPan hosting | UNKNOWN | UNKNOWN | UNKNOWN | Unverifiable provenance | Not recommended — worse than RETFound |
| — | APTOS 2019 community DR solutions | Fundus | DR grading | No formal license; Kaggle terms restrict redistribution | Various, unmaintained | Competition splits only | No | Varies | Highest supply-chain risk (no formal release process) | Not recommended |

## C. Top 3 full dossiers

Full structured dossiers for all three are in
`lib/models/candidateDossiers.ts` (`monai-retinaloct-rpd-segmentation`,
`segformer-optic-disc-cup-refuge`, `clementp-fundus-dr-grading-efficientnet`).
Summary below.

### C.1 MONAI `retinalOCT_RPD_segmentation`

- **Source:** https://huggingface.co/MONAI/retinalOCT_RPD_segmentation (mirrors `Project-MONAI/model-zoo`)
- **License:** BSD 2-Clause, copyright uw-biomedical-ml — verified by reading the LICENSE file directly at both HF and GitHub. Explicitly permits commercial use and redistribution with attribution.
- **Task:** Segments reticular pseudodrusen (RPD), an AMD biomarker, in OCT B-scans (Heidelberg Spectralis).
- **Training:** LEAD study, 9,800 B-scans / 200 eyes / 100 individuals. Single grader, supervised by two senior investigators.
- **Validation:** Internal test (250 B-scans / 125 eyes / 92 individuals, disjoint from training) — Dice 0.76 (model vs. specialists) vs. 0.68 (inter-specialist agreement), p<0.001. **External test: 5 independent cohorts** (MACUSTAR, NICOLA, University of Washington, University of Bonn, Montrachet — Germany, Northern Ireland, US, France, multi-center Europe), 1,017 eyes / 812 individuals, combined AUC 0.94 (95% CI 0.92–0.97), comparable to individual expert graders (0.95, 0.96).
- **Disclosed limitations (author-stated):** single-device only, untested on other OCT devices; cannot assess ungradable scans; excludes late-AMD eyes; single-grader training labels.
- **Security:** pickle-only `.pth` files (5-fold ensemble); ships custom executable Python (`inference.py`, `Ensembler.py`, `analysis_lib.py`) beyond a plain config-driven load. **Mandatory safe-loading procedure:** `torch.load(path, map_location="cpu", weights_only=True)` on the raw state dict only, loaded into an independently-authored, separately-reviewed model definition — never execute the bundle's own inference/ensembler scripts unreviewed. Provenance flag: 0 downloads recorded at audit time despite the "MONAI" org author field — independently reconfirm this is genuinely the official org account before fully trusting provenance (it does appear in the official `Project-MONAI/model-zoo` listing, which is a positive signal).
- **CPU feasibility:** UNKNOWN — Mask-RCNN/ResNeXt-101 ensembles are GPU-oriented; authors cite ~3GB GPU / 6GB RAM on an A100. Must be benchmarked on this deployment's CPU-only hardware before relying on it for interactive use.

### C.2 SegFormer optic disc/cup segmentation (`pamixsun`)

- **Source:** https://huggingface.co/pamixsun/segformer_for_optic_disc_cup_segmentation
- **License:** Apache-2.0 (HF tag, verified). Training data (REFUGE) is CC BY 4.0, permissive, citation-only.
- **Task:** 3-class segmentation (background/disc/cup) on fundus photos — a CDR value would need to be computed downstream from the mask, not produced directly.
- **Validation:** **None published anywhere** — no Dice/IoU, no citation, no linked paper or training repo. Independently confirmed as a genuine absence of evidence, not merely unsurfaced. Uploader identity ("Xu Sun") is not independently confirmed despite a same-named individual appearing among REFUGE 2018 co-authors.
- **Security:** both `model.safetensors` and `pytorch_model.bin` present — load only the safetensors file explicitly (`use_safetensors=True`); never the pickle-based `.bin`. Native `transformers` `SegformerForSemanticSegmentation` class — no custom code / `trust_remote_code` required, the lowest code-execution risk of any S6-S8 candidate.
- **CPU feasibility:** ~47.2M parameters — small, CPU inference very likely feasible (not yet benchmarked).
- **Verdict:** cleanest legal and security profile of the three, but functionally unvalidated — any use would require this platform to run its own from-scratch benchmark (e.g. against DRISHTI-GS or RIM-ONE) before treating output as meaningful.

### C.3 FundusDRGrading EfficientNet-B0 (`ClementP`)

- **Source:** https://huggingface.co/ClementP/FundusDRGrading-efficientnet_b0
- **License:** MIT tag on the weights page — but the S8 legal audit classified this **REVIEW_REQUIRED, not PASS**: two of the four training datasets (APTOS 2019, EyePACS) carry explicit non-commercial / no-redistribution terms in their own dataset licenses, which the MIT tag on the derived weights does not obviously clear. Safe for the currently-authorized internal, non-commercial research/evaluation scope; NOT safe to assume cleared for commercial use without a human legal review.
- **Task:** 5-class DR severity grading.
- **Validation:** Quadratic kappa only (EyePACS 0.751, IDRiD 0.751, DDR 0.712) — evaluated on each dataset's own held-out partition from the same combined training pool, i.e. **internal validation only**, not true external validation. No sensitivity/specificity/AUROC/PPV/NPV/calibration reported anywhere. Patient-level split not confirmed (image-level leakage cannot be ruled out).
- **Security:** both safetensors and `.bin` present — same safe-loading rule as above (safetensors only). Native `transformers` EfficientNet class, no custom code risk. Unverified individual uploader (moderate usage: 576 downloads, June 2024).
- **CPU feasibility:** ~4M parameters — very small, CPU inference very likely trivial.
- **Verdict:** weakest evidence and most legally ambiguous of the three; not recommended as the first integration target.

## D. Rejected candidates and why

- **RETFound** (all variants) — every checkpoint is HuggingFace-gated (HTTP 401, `"gated": "auto"`), requiring an access request this session has no credentials to complete. Even if obtained, it is a backbone-only foundation model with no task head — see S7 report. Kept as a secondary research option (license already authorized for research-only use) but not the first integration target.
- **DENet glaucoma screening** (`HzFu/DENet_GlaucomaScreen`) — confirmed (S7 re-verification) to have **no LICENSE file at all** (default all-rights-reserved) and weights hosted ad-hoc on OneDrive/BaiduPan with no cryptographic provenance chain. Worse than RETFound on every legal/security axis. Not recommended.
- **APTOS 2019 community DR solutions** (various Kaggle-competition repos) — no formal license, Kaggle's own competition terms restrict commercial redistribution of the underlying data, no single canonical maintained repository, highest supply-chain risk (unaudited individual research code with no formal release process). Not recommended.
- **HzFu/MNet_DeepCDR** — CC BY-NC-SA 4.0 (non-commercial), and the repository's own README flags the released `.h5` checkpoint as broken/incompatible with current SciPy. Rejected: license + broken artifact.
- **HzFu/AGNet** — Python 2.7 + PyTorch 0.4.0, years-stale; weights presence and license unconfirmed. Rejected: unmaintained, unverifiable.
- **seva100/optic-nerve-cnn** (Sevastopolsky U-Net) — MIT, weights present, but repository explicitly marked deprecated by its own author, needing "significant refactoring" for current TensorFlow/Keras. Rejected: framework rot / build risk.
- **5t4l1n/ai-eye-disease-detection** — no license stated at all on the model card. Rejected: license absence.
- **OpticNet-71** — code MIT-licensed, but weights hosted on Google Drive with no explicit license covering that specific artifact (ambiguous), legacy TF1.12/Keras 2.2.4 stack. Rejected: license ambiguity + stale stack.
- **Animesh-Kr `oct-fluid-segmentation`** — clean MIT license and modern format, but the author's own README discloses a large unexplained validation→test performance drop and states known implementation defects, with a corrected version "in preparation" and not yet published. Rejected for now on evidence-quality/correctness grounds; worth re-checking once the corrected version ships.
- **jdelgado2002/diabetic_retinopathy_detection**, **Kontawat/vit-diabetic-retinopathy-classification**, **YijinHuang/Lesion-based-Contrastive-Learning**, **malam8/FundusNet-DR**, **ReLayNet**, **OpticNet-71** (fundus/OCT secondary candidates) — each has at least one disqualifying or seriously weakening issue (pickle format + APTOS reliance, undocumented training data, unverified license/hosting, no released weights, stale MATLAB format, or ambiguous weight licensing respectively). Full detail in each research agent's report; not elevated to a full dossier given stronger alternatives exist per modality.
- **Google ARDA** — confirmed not open-sourced; licensed commercially to partners only, no public weights exist.
- **AIROGS / JustRAIGS challenge repos** — code-only reproducibility repos, no released pretrained weights; the underlying AIROGS dataset is CC BY-NC-ND (non-commercial, no-derivatives) which would in any case restrict redistribution of weights trained on it.
- **MONAI Model Zoo** — searched explicitly for glaucoma/optic-disc and general fundus bundles: none exist currently (only the OCT/RPD bundle above was found).

## E. RETFound comparison

| Dimension | RETFound | MONAI RPD (top candidate) |
|---|---|---|
| Gated access | **Yes** — HTTP 401, access-request required, unresolved | No |
| Weight license | CC-BY-NC-4.0 (research-only, already authorized) | BSD-2-Clause (permissive) |
| Checkpoint format | Pickle `.pth` (never obtained/verified) | Pickle `.pth` (verified present) |
| Task-specific | No — backbone/embeddings only | Yes — RPD/AMD biomarker segmentation |
| Disease-relevant output | No (would need a separately trained task head) | Yes (segmentation → biomarker presence) |
| External validation | N/A (no task head exists to validate) | Yes — 5 independent cohorts, AUC 0.94 |
| CPU feasibility | Large ViT-Large, likely heavy | UNKNOWN, likely heavy (Mask-RCNN ensemble) — needs benchmarking either way |
| Reproducibility | Blocked entirely by the access gate | Reproducible once safe-loading path is built |
| Security | Unknown (never obtained) | Pickle + bundled code — known, documented, mitigable risk |
| Integration complexity | High (task head required even if obtained) | Medium (needs independent safe-loading path, not a full retraining effort) |

**Recommendation:** RETFound should remain a secondary research option — its
license is already cleared for research-only use, and it may become
relevant later for genuinely novel embedding-based research — but it is not
the right first integration target given the access blocker and missing
task head. MONAI RPD segmentation is the better first-task candidate.

## F. Security report

See `lib/models/candidateDossiers.ts`'s `security_considerations` field on
each new entry for the authoritative, per-candidate list. Summary:

- **No candidate reviewed offers a fully safe (safetensors/ONNX-only)
  artifact with zero pickle exposure.** The two fundus candidates offer
  safetensors alongside a pickle `.bin` sibling (safe path exists, must be
  explicitly chosen); the MONAI OCT candidate is pickle-only.
- **The MONAI candidate carries an additional, distinct risk**: it ships
  custom executable Python as part of its bundle, not just a state dict.
  Any future integration must build an independent, separately-reviewed
  loading/inference path rather than running the bundle's own scripts.
- **No candidate requires `trust_remote_code=True`** or custom
  `transformers` modeling files — the two HuggingFace `transformers`-native
  candidates (SegFormer, EfficientNet) are the lowest-code-execution-risk
  options.
- **Mandatory rule for any future load of any pickle-based artifact**:
  `torch.load(path, map_location="cpu", weights_only=True)` — never
  `weights_only=False` on an untrusted artifact, per the S7 authorization's
  standing requirement.

## G. License report

See section D above and the `license`/`license_compatible_for_commercial_clinical_use`
fields on each dossier entry. Key distinction maintained throughout: **source-code
license ≠ weights license ≠ dataset license.** The MONAI candidate is the only
one where all three are clean and mutually consistent (a single rights-holder,
uw-biomedical-ml, directly grants BSD-2-Clause over the trained artifact,
trained on proprietary institutional data with no public-dataset license to
conflict with it). The two fundus candidates each have a clear stated weights
license, but the DR-grading one has an unresolved tension between its MIT tag
and its APTOS/EyePACS training-data terms.

## H. Clinical evidence report

See section B/C above. Ranked by evidence quality (not raw benchmark
numbers), strongest to weakest: **MONAI RPD > FundusDRGrading EfficientNet-B0
> SegFormer optic disc/cup**. Only the MONAI candidate meets a strict
definition of "externally validated" (independent institutions/cohorts, not
merely a different partition of the same training pool). None of the three
meets any bar that would support a clinical-validation claim — MONAI RPD's
own authors themselves state it needs further multi-device, prospective
confirmation.

## I. Hardware report

This deployment (established in S7): Windows, Python 3.12.10, isolated
`.venv-ophthalmic` with CPU-only PyTorch 2.14.0+cpu / torchvision
0.29.0+cpu already installed and health-checked; AMD Radeon integrated GPU
(no CUDA); 15.3 GB RAM; 261+ GB free on D:.

- **SegFormer (47M params) and EfficientNet-B0 (4M params)**: very likely
  **EASY** — small, CPU-native `transformers` models, no GPU-specific code
  paths expected.
- **MONAI RPD (Mask-RCNN/ResNeXt-101-32x8d-FPN, 5-fold ensemble)**: **UNKNOWN,
  likely HEAVY** — Mask-RCNN ensembles are GPU-oriented; author-cited
  resource figures (3GB GPU / 6GB RAM) were measured on an A100, not
  representative of CPU-only inference time. Must be benchmarked before any
  interactive-use assumption; batch/single-fold-only inference or ONNX
  conversion may be necessary to make it practical on this hardware.

None of this hardware analysis was empirically measured this session (no
weights were downloaded) — it is a reasoned estimate from architecture and
parameter-count information only, and must be verified with the real
artifact before S9 commits to an approach.

## J. S9 installation plan (proposed, not executed)

1. Obtain human sign-off on which candidate to pursue first (this document
   recommends MONAI RPD segmentation, with SegFormer optic disc/cup as a
   lower-risk, lower-evidence fallback for a first "does the pipeline even
   work" exercise).
2. Download the chosen candidate's actual artifact(s) into a scratch
   location (NOT `data/models/` until fully verified), compute SHA-256,
   record in the candidate dossier's `checkpoint_status` (matching the
   pattern already used for RETFound in S7).
3. For MONAI RPD specifically: write an independently-authored inference
   script that loads only the raw `.pth` state dict via
   `torch.load(..., weights_only=True)` into a from-scratch model
   definition — do not execute the bundle's own `inference.py`/`Ensembler.py`.
   For SegFormer: use `AutoModel.from_pretrained(..., use_safetensors=True)`,
   never the `.bin` sibling.
4. Benchmark real CPU inference time/memory on this hardware with a sample
   image before any further integration effort.
5. Build the raw-output → `RawModelOutput` contract (`lib/models/outputContract.ts`)
   mapping — this is new code, since no provider has ever produced real
   output before.
6. Only after a successful, benchmarked, safely-loaded inference: consider
   registering a new `CANDIDATE`-status (or equivalent) `ModelRecord`
   pointing at it — still not `DEMO`/production status, and still gated by
   the existing `lib/models/registry.ts` lifecycle ladder.
7. Gate A remains closed throughout; nothing here authorizes clinical use.

## K. Safety status confirmation

- Gate A: **CLOSED**
- Gates B–F: **CLOSED**
- `data/models/`: **unchanged (empty)**
- No clinical claims added; no diagnosis capability claimed
- No new coupling into `lib/analysis/pipeline.ts`, `lib/clinical/*`, `lib/treatment/*`, or `lib/reports/*` (verified by grep)
- No commits made
