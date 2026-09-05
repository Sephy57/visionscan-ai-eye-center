# Model Validation Requirements

> **STATUS: NO MODEL IN THIS DEPLOYMENT HAS BEEN CLINICALLY VALIDATED.**
> The only registered model (`demo-fundus-synthetic-v0`) is `status: DEMO`
> and will never advance — it has no real weights, no dataset, and nothing
> to validate. This document describes the evidence bar a **real** model
> would have to clear at each lifecycle step, and demonstrates, using the
> three researched candidate dossiers, what "not ready" concretely looks
> like today.

## The lifecycle ladder

Verbatim from `lib/models/transitions.ts:25-27`:

```ts
export const STATUS_LADDER: ModelStatus[] = [
  "DEMO", "RESEARCH", "INTERNAL_VALIDATION", "EXTERNALLY_VALIDATED", "CLINICALLY_VALIDATED",
];
```

(`RETIRED` also exists as a `ModelStatus`, `lib/models/registry.ts:30`, but
is a fail-safe exit reachable from any status, not a ladder step —
`requestStatusTransition()` always approves a move to `RETIRED` or a
same-status no-op without evidence checks, `lib/models/transitions.ts:105-109`.)

Transitions are **rejected fail-closed** unless the path follows the ladder
with no skipping, every required evidence reference exists in the evidence
registry and belongs to the model being transitioned, and the registry
record itself carries the supporting fields (`transitions.ts:89-134`).

## `TRANSITION_REQUIREMENTS` per step

From `lib/models/transitions.ts:37-54`:

| Transition | Min. evidence records | Must include external study | Requires validation date | Requires calibration |
|---|---|---|---|---|
| `DEMO -> RESEARCH` | 0 | No | No | No |
| `RESEARCH -> INTERNAL_VALIDATION` | 1 | No | Yes | No |
| `INTERNAL_VALIDATION -> EXTERNALLY_VALIDATED` | 2 | Yes | Yes | Yes |
| `EXTERNALLY_VALIDATED -> CLINICALLY_VALIDATED` | 3 | Yes | Yes | Yes |

Additional checks enforced in `requestStatusTransition()` regardless of the
table above: every cited evidence id must actually resolve via
`getEvidence()` and must belong to the model being transitioned
(`transitions.ts:114-120`); `evidenceMustIncludeExternalStudy` requires at
least one evidence record of type `external_study` or `evaluation_run`
(`transitions.ts:124-125`); `requiresCalibration` requires
`model.performance.calibration` to be non-null on the registry record
itself, not merely referenced in evidence (`transitions.ts:128`).

Separately, `gateModelUse()` (`lib/models/registry.ts:325-363`) enforces
anti-fraud rules independent of the transition workflow: any non-DEMO
model must have a recorded `sha256`; any status other than `RESEARCH` must
have a `validation_date`; and a model with numeric performance metrics but
no `evidence_reference` is rejected outright. `auditRegistryConsistency()`
(`registry.ts:394-411`) is a standing self-check that flags any registry
record claiming validation-level status without a matching evidence
reference, validation dataset, or validation date.

## Required validation practice

Beyond what the transition gate mechanically checks, a real model's
evidence must actually satisfy sound validation methodology:

- **Patient-level, not image-level, train/test separation.** The registry
  record has a dedicated field for this exact concern —
  `patient_level_split: boolean | null` (`registry.ts:95`, `null` meaning
  "unknown/not documented"). A model with images from the same patient
  split across train and test inflates every downstream metric; this field
  exists so that fact can never be silently unrecorded. None of the three
  candidate dossiers below can currently set this to `true` — see below.
- **Independent / external validation**, not just a held-out split from the
  same source distribution — this is exactly the distinction the ladder
  encodes between `INTERNAL_VALIDATION` and `EXTERNALLY_VALIDATED`, and why
  that specific transition requires `evidenceMustIncludeExternalStudy`.
- **Required metrics**, per `PerformanceMetrics` (`registry.ts:60-69`):
  sensitivity, specificity, PPV, NPV, AUROC, AUPRC, and a calibration
  measure (the field is a free-text description, e.g. `"ECE 0.03 on
  external set v2"`), each `null` until actually measured, each backed by
  a mandatory `evidence_reference`. Confidence intervals are not a
  separate typed field in `PerformanceMetrics`, so they must be recorded
  in the linked evidence record / evaluation run — a raw point estimate
  with no interval is not adequate validation evidence for a clinical
  claim.
- **Subgroup performance** — device, demographic, laterality, image
  quality. The registry's `devices: DeviceCompatibility[]` field
  (`registry.ts:102`) already makes device-level compatibility an explicit,
  gated claim (`deviceCompatible()`, `registry.ts:372-387`): a model
  validated on one device is not automatically trusted on another. The
  same discipline — no metric may be silently generalized to a subgroup it
  wasn't measured on — applies to demographic group, laterality (OD/OS),
  and image-quality band, even though those don't yet have dedicated
  registry fields; they belong in the evidence record's own documented
  methodology.

## The validation harness

`lib/models/validationHarness.ts` implements the mechanical metrics this
document describes, as a pure, deterministic module with no I/O and no
dependency on the model registry, pipeline, or any specific model:

- `computeValidationMetrics(cases: LabeledPrediction[])` — sensitivity,
  specificity, PPV, NPV, ECE, Brier score, and a confusion matrix (tp/fp/tn/fn) from a caller-
  supplied `LabeledPrediction[]` (`case_id`, `patient_id`, `predicted`,
  `actual`, optional `predicted_score`/`subgroup`/`device`/`laterality`).
  Any metric with a zero denominator is `null`, never `NaN` or a fabricated
  number.
- `computeAUROC` / `computeAUPRC` — rank-sum (Mann-Whitney U) and
  trapezoidal precision-recall integration respectively, only computed when
  every case carries a `predicted_score`; verified in
  `tests/s6-validation-harness.test.ts` against hand-computed cases
  (perfectly separated scores → AUROC 1.0, perfectly inverted → 0.0, plus a
  non-trivial mixed example cross-checked two independent ways).
- `computeECE` / `computeBrierScore` — calibration error and binary Brier score,
  computed only when every supplied score is finite and within `[0,1]`; arbitrary
  raw logits are intentionally reported as `null`, never as probabilities.
- `checkPatientLevelSeparation(train, test)` — flags any `patient_id`
  appearing in both sets, the exact leakage failure mode called out above.
- `computeSubgroupBreakdown(cases, subgroupKey)` — one `ValidationMetrics`
  per distinct subgroup value, with an explicit `"unknown"` bucket for cases
  missing that key (never silently dropped).
- `assessReadinessForStatusTransition(metrics, opts)` — a mechanical
  checklist (`ReadinessAssessment { ready, blockers }`) that flags missing
  sample size, missing patient-level split, missing external validation, or
  a degenerate label distribution. Its own header is explicit that this is
  **not** a clinical-validation certifier.

This module is not wired into the pipeline, the registry, or any API route.
It is infrastructure a future, explicitly authorized evaluation run would
call with real predictions/labels - calling it with zero arguments today
proves nothing about the DEMO model or any candidate dossier. Whatever it
computes, the rule below still applies unconditionally.

## A validation harness is a tool, not clinical validation

Even a validation harness that correctly computes sensitivity, specificity,
PPV, NPV, AUROC, AUPRC, calibration error, confidence intervals, and
subgroup breakdowns is, at most, **a tool a human validation process would
use** to produce evidence — it is not itself clinical validation, and its
output does not become clinical validation just because the numbers look
good. Concretely, in this codebase:

- **No automated function may set a model's status to
  `CLINICALLY_VALIDATED`.** `requestStatusTransition()` requires a human
  `requested_by` actor and an audit trail (`transitions.ts:89-96,176`); it
  is invoked from admin-facing code, not from any pipeline or metrics
  computation path. A metrics function that outputs correct numbers has no
  privileged path to `MODELS[modelId].status = "CLINICALLY_VALIDATED"` —
  the only place that assignment happens is inside `finalize()`
  (`transitions.ts:161-163`), gated by `requestStatusTransition()`'s
  evidence checks and always attributed to a named requester.
  `docs/MODEL_GOVERNANCE.md` covers the human-approval process this
  implies in full.
- Correct metrics computation answers "what did we measure," not "is this
  measurement sufficient, on the right population, with the right
  methodology, reviewed by the right people, to support a clinical claim."
  That second question is precisely what `TRANSITION_REQUIREMENTS`'
  evidence-count and external-study requirements exist to force a human to
  answer explicitly, evidence record by evidence record, rather than let a
  single automated score decide.

## Worked examples: the three candidate dossiers' validation gaps

All three live in `lib/models/candidateDossiers.ts`, `status:
"CANDIDATE_ONLY"`, never inserted into `MODELS`. Their `unresolved_blockers`
are concrete instances of "not ready":

**RETFound (`retfound-mae`)** — foundation/backbone model only:
- *"No finding-producing task head exists to actually evaluate for this
  platform's intended use — would require a full additional
  training/validation effort."* There is nothing to run
  sensitivity/specificity on yet; the backbone itself produces embeddings,
  not findings.
- *"No patient-level-split confirmation obtained from primary sources for
  this dossier"* — `patient_level_split_confirmed: "UNKNOWN"` in the
  dossier, meaning the registry's `patient_level_split` field could not
  honestly be set to `true` even if this were installed.
- *"Non-commercial license incompatible with this platform's stated
  deployment intent"* — a governance/licensing blocker, not a validation
  one, but it stops any validation effort from being worth starting (see
  `docs/MODEL_GOVERNANCE.md`).

**DENet (`denet-glaucoma-refuge`)** — optic-disc/cup segmentation +
glaucoma-screening score:
- *"No external/prospective validation evidence found"* —
  `external_validation_performed: "UNKNOWN"` — exactly the evidence
  `INTERNAL_VALIDATION -> EXTERNALLY_VALIDATED` requires and none exists.
- *"Provides only one of several modalities (optic disc/fundus) this
  platform's own taxonomy already says are individually insufficient for a
  glaucoma determination"* — even a well-validated version of this model
  could not, alone, support the platform's existing glaucoma condition
  logic (`lib/clinical/conditions.ts`), which already requires IOP, visual
  fields, and RNFL analysis alongside disc appearance.
- *"License not confirmed — blocks any use pending explicit
  verification"* — validation work on an unlicensed artifact would be
  wasted effort until resolved.

**APTOS 2019 community DR grading (`aptos2019-community-dr-grading`)**:
- *"Image-level vs. patient-level split practice varies by competition
  entry and was not independently confirmed for any specific repository"*
  — the single clearest instance in these three dossiers of the exact
  patient-level-split risk `patient_level_split` exists to force
  documentation of; Kaggle leaderboard scores from image-level splits are
  a textbook source of inflated, non-generalizable metrics.
- *"No single canonical, maintained repository identified — 'the model' is
  really a class of independently trained community models with
  materially different weights and unverified provenance"* — there isn't
  even one fixed artifact to compute a SHA-256 for and validate; "the
  APTOS model" is not a single well-defined thing.
- *"Kaggle/APTOS competition terms restrict commercial
  redistribution/use"* — as with RETFound, a licensing blocker that makes
  any validation investment premature.

None of these gaps are closed by writing better metrics code. Each requires
new evidence (a real external validation run, a confirmed patient-level
split, a resolved license) that does not exist yet and that only a human
validation effort — using tooling like a validation harness, but not
reducible to it — can produce.

## Cross-references

- `docs/MODEL_INTEGRATION.md` — the code-level pipeline and provider
  contract a validated model would run through.
- `docs/MODEL_GOVERNANCE.md` — the human-approval chain, including license
  and security review, that precedes any validation effort being worth
  starting at all.
- `docs/MODEL_REGISTRY.md` — full registry field reference and status
  table.
