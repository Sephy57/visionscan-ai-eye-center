# S11 — Model Validation Status (Standing Reference)

> **Status: S11 IMPLEMENTED — a documentation and gating-infrastructure
> phase, not a new-validation phase.** This document formalizes, as a single
> standing reference, the validation status already established in S8
> (discovery/due-diligence) and S9 (real inference) for the one model wired
> into this codebase's research pathway. **No new validation work — no
> benchmarking, no external dataset evaluation, no calibration study — was
> performed this session.** This is the SAME model, in the SAME
> unvalidated state, as of S9. **NOT A MEDICAL DEVICE. NOT CLINICALLY
> VALIDATED. NOT FOR CLINICAL USE.**

This document exists because S11 introduced `canDisplayDiagnosis()`
(`lib/models/diagnosisGate.ts`), a hard server-side gate whose seven inputs
are exactly the kind of facts a validation reference document should state
in one place, rather than scattered across S8/S9. Everything below is
cross-referenced to where it was originally established — nothing here is
re-derived or re-measured.

## 1. Model, intended use, modality, task

(Source: `docs/S8_MODEL_DISCOVERY.md` §C.2, `lib/models/candidateDossiers.ts`
`segformer-optic-disc-cup-refuge`, `docs/S9_REAL_MODEL_INTEGRATION.md` §1–9.)

| Field | Value |
|---|---|
| Model | `pamixsun/segformer_for_optic_disc_cup_segmentation` |
| Architecture | SegFormer, MiT-B4-scale encoder, 47,226,307 parameters (F32) |
| Modality | Fundus (color fundus photograph) only |
| Intended task (as documented by the uploader) | 3-class semantic segmentation (background / optic disc / optic cup) on color fundus photographs. A cup-to-disc ratio (CDR) value would need to be computed downstream from the mask — it is not produced directly by this model. |
| This deployment's registry entry | `segformer-optic-disc-cup-refuge`, status `CANDIDATE_ONLY` (`lib/models/candidateDossiers.ts`) |
| License | Apache-2.0 (verified directly from the HF model-card tag, S8) |
| Checkpoint format used | `model.safetensors` only — the pickle-based `pytorch_model.bin` sibling was never downloaded (S9 §1–6) |

## 2. Datasets, validation, external validation

Directly from S8's independent clinical-evidence audit (`docs/S8_MODEL_DISCOVERY.md`
§B, §C.2) — this is the same finding S9 and S10 both cite unchanged:

- **Training dataset**: presumed REFUGE (the model name references it; REFUGE
  itself is CC BY 4.0), but no training data manifest, split, or provenance
  document was published alongside the checkpoint.
- **Internal validation**: **none published.**
- **External validation**: **none published.**
- **Uploader identity**: not independently confirmed. A same-named
  individual ("Xu Sun") appears among REFUGE 2018 challenge co-authors, but
  S8 explicitly did not treat this as confirmation of authorship or of any
  validation claim.
- This is a genuine, confirmed **absence** of evidence (S8 re-verified this
  directly at the source rather than trusting a discovery agent's summary)
  — not merely evidence that wasn't surfaced by search.

## 3. Metrics

**None published. Stated explicitly, not left implicit:**

- Dice: UNKNOWN
- IoU: UNKNOWN
- Sensitivity / specificity: UNKNOWN
- AUROC / AUPRC: UNKNOWN
- Positive/negative predictive value: UNKNOWN
- Inter-grader or human-comparison agreement: UNKNOWN

No placeholder or estimated number is given for any of the above anywhere
in this codebase. Where a number would otherwise appear (e.g. a finding's
`confidence` field), the pipeline instead emits an explicit "none provided"
sentinel (`confidence: 0`, `confidence_calibrated: null` —
`lib/models/segformerFindingAdapter.ts`, confirmed in S10).

The one real accuracy signal that does exist is **negative**: S9's own real
inference run on a non-REFUGE fundus photograph produced a segmented
"optic cup" region (31,305 px) larger than the segmented "optic disc"
region (23,671 px) — anatomically implausible, since the cup is a
sub-region of the disc (`docs/S9_REAL_MODEL_INTEGRATION.md` §13). This
result was preserved and reported exactly as produced, not filtered or
reinterpreted, and stands as first-hand evidence of unreliability outside
the model's (undocumented, presumed-REFUGE) training distribution.

## 4. Localization

Real, pixel-derived bounding boxes — genuine output of the model's own
predicted segmentation mask, not fabricated, not estimated, not a static
placeholder (`lib/models/segformerFindingAdapter.ts`, S10). Rendered via the
pre-existing `ScanViewer` component's `localizations` prop.

**This localization is not clinically validated as accurate.** A real
bounding box derived from a real mask is a true statement about what pixels
the model activated on — it is not a validated statement about where a
clinically meaningful anatomical boundary actually is. The disc/cup-area
implausibility in §3 applies equally to the localization: if the segmented
regions themselves can be anatomically implausible, the boxes drawn around
them inherit that same unvalidated status.

## 5. Calibration

**None exists.** `calibrationAvailable` is a required boolean input to
`canDisplayDiagnosis()` (`lib/models/diagnosisGate.ts`) and for this model,
in this deployment, it is always `false` — there is no documented
calibration evidence for this model against any intended use. No calibrated
confidence value is fabricated anywhere in the pipeline; the UI renders this
as "NOT CALIBRATED" rather than a percentage
(`components/ResearchAnalysisPanel.tsx`).

## 6. Subgroup analysis

**Not performed.** No breakdown by age, sex, ethnicity, camera/device type,
image quality tier, or disease severity exists for this checkpoint — none
was published by the uploader (§2), and none was computed by this platform
(no benchmarking work of any kind was undertaken in S8, S9, S10, or this
session).

## 7. Limitations

Consolidated from S9 §20 and S10, unchanged this session:

- Zero published validation metrics (§3).
- A real, first-hand anatomically-implausible result on a non-REFUGE image
  (§3) — direct evidence of unreliability outside its narrow, undocumented
  training distribution.
- No calibration evidence (§5).
- No internal safety net against unsuitable input: S9's adversarial testing
  fed the model a 1×1 pixel image, an all-black image, an all-white image,
  and an extreme-aspect-ratio image — **every one "succeeded"**, producing a
  numerically valid but meaningless segmentation with no internal warning
  (`docs/S9_REAL_MODEL_INTEGRATION.md` §6). Correctness depends entirely on
  upstream gating (the S6 image-suitability/OOD gate), which exists in this
  codebase but is not wired to this provider.
- No task-specific validation (own benchmarking against a public benchmark
  such as DRISHTI-GS or RIM-ONE) has ever been performed.
- A segmented pixel area is not, by itself, a diagnosis, a disease
  probability, or evidence of glaucoma or any other condition
  (`docs/S9_REAL_MODEL_INTEGRATION.md` §20).

## 8. Security (cross-reference)

Full detail in `docs/S9_REAL_MODEL_INTEGRATION.md` §6, not reproduced here.
Summary: only the safetensors checkpoint is downloaded/loaded (no pickle
deserialization surface for this deployment's copy); native
`transformers.SegformerForSemanticSegmentation` class, no
`trust_remote_code`, no custom `modeling_*.py`; no network access at
inference time (`local_files_only=True`); fixed-argument-array
`child_process.spawn`, no `shell=True`. Independently re-verifiable via the
SHA-256 check in §9 below.

## 9. Reproducibility

- SHA-256 of `model.safetensors`:
  `22e45131b64eb07a5d29a2e5388a7709d10696b13f48d2d0cdcf56cafa1f9ea5`,
  independently computed with `sha256sum` and cross-checked against
  HuggingFace's own recorded LFS `sha256` via the HF API — **exact match**
  (`docs/S9_REAL_MODEL_INTEGRATION.md` §1–5).
- File size verified exactly: 188,982,852 bytes.
- Deterministic loading and deterministic inference: two independent
  process runs produced identical model weights and identical findings on
  the same input image (model runs in `eval()` mode, no dropout).

## 10. CPU performance (real benchmarks, S9)

Two full runs on this deployment's actual hardware (15.3GB RAM, CPU-only,
no CUDA):

| Phase | Run 1 (cold) | Run 2 (warm) |
|---|---:|---:|
| Python import | 7.37s | 4.63s |
| Model load | 1.17s | 0.40s |
| Preprocess | 0.37s | 0.02s |
| Inference | 1.89s | 1.02s |
| Postprocess | 0.20s | 0.14s |
| **Total** | **11.30s** | **6.28s** |

Steady-state single-image inference is approximately **1 second**. Import
time is a one-time process-startup cost, not a per-image cost. These are
measured numbers, not estimates.

## 11. Applying `canDisplayDiagnosis()` to this exact model

`lib/models/diagnosisGate.ts`'s `canDisplayDiagnosis()` requires all seven
of the following to hold simultaneously. Walking through each concretely
for `segformer-optic-disc-cup-refuge`, as deployed today:

| # | Condition | This model's actual value | Met? |
|---|---|---|---|
| 1 | `modelValidation === "CLINICALLY_VALIDATED"` | Registry status is `CANDIDATE_ONLY`; real validation status per §2–3 is effectively `NOT_VALIDATED` (zero published metrics of any kind) | **No** |
| 2 | `intendedUseMatches === true` | No formally documented, approved intended use exists for this model in this deployment — it is a standalone research provider, not registered for any approved clinical use | **No** |
| 3 | `modalityMatches === true` | The model itself only supports FUNDUS, and the research pathway's own modality gate does enforce FUNDUS-only — this is the one condition that could be trivially satisfied for a correctly-modality-matched study. Still evaluated as not applicable/not affirmatively established for diagnosis purposes, since conditions 1, 2, 5, 6, 7 already fail the gate closed | N/A (gate already closed) |
| 4 | `qualityStatus === "pass"` | Depends per-study on the real S6/S10 quality gate output; even when quality passes, this alone cannot open the gate given the other failures | Not sufficient alone |
| 5 | `!oodDetected` | The model has no internal OOD safety net (§7) — nothing in this deployment currently computes or supplies a trustworthy OOD signal specifically for this model | **No** (never affirmatively established) |
| 6 | `calibrationAvailable === true` | Always `false` — no calibration evidence exists (§5) | **No** |
| 7 | `evidenceSufficient === true` | S10's evidence-synthesis layer can never reach `SUPPORTED_CONDITION` from this model's output alone, because a lone `UNVERIFIED` `AI_FINDING` cannot satisfy the trust gate (`docs/EVIDENCE_SYNTHESIS.md` §3, §8) | **No** |

**Result: `allowed: false`, `clinicalInterpretation: "REQUIRES_CLINICAL_CORRELATION"`.**
At least four of the seven conditions (1, 2, 5, 6, and effectively 7) fail
independently for this model as deployed today — this is not a single
fixable gap, it is a comprehensively unvalidated model by design, and the
gate reports it that way. This matches `unvalidatedGateResult()`
(`lib/models/diagnosisGate.ts`), the convenience helper this deployment uses
as its real, current state — always closed, by construction, not by
incident.

## 12. What would have to change

Per S9 §22 and S10's own recommendation, unchanged this session: real
task-specific benchmarking against a public ground-truth dataset (DRISHTI-GS
or RIM-ONE), a documented and approved intended-use statement, a
calibration study, and formal validation status escalation through
`lib/models/registry.ts`'s lifecycle ladder — none of which this session
attempted or was authorized to attempt.

See also: `docs/S8_MODEL_DISCOVERY.md` (full due-diligence, all three
candidates ranked), `docs/S9_REAL_MODEL_INTEGRATION.md` (real inference,
security, benchmarks), `docs/MODEL_REGISTRY.md` (the general registry
lifecycle this model sits in).
