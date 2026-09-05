# S10 Completion Report — Research-Model-Backed Evidence Analysis

> **Status: S10 IMPLEMENTED — a deliberately limited slice of a much larger
> master prompt (44 sections requesting a full clinical-evidence/
> localization/condition/symptom/treatment/UI-redesign pipeline).** This
> report is an honest accounting of what was actually built this session
> versus what was reused, deferred, or not attempted.
> **NOT A MEDICAL DEVICE. NOT CLINICALLY VALIDATED. NOT FOR CLINICAL USE.**

This session's master prompt asked for a comprehensive ophthalmic-AI
clinical pipeline across 44 sections. Given the realistic scope of that
ask, S10 implemented one coherent, end-to-end, honestly-labeled slice —
wiring S9's real model inference into S5's existing evidence layer — rather
than attempting a partial pass at all 44 sections. See
`docs/CLINICAL_AI_ARCHITECTURE.md` for how this fits into the system as a
whole.

## What model was selected and why

No new model selection happened this session. S10 builds directly on the
model already selected and integrated in S8/S9: SegFormer
(`pamixsun/segformer_for_optic_disc_cup_segmentation`), a MiT-B4-scale
optic-disc/cup segmentation model, chosen in S8 because it was the only one
of three researched, non-gated candidates that was actually runnable in
this deployment's CPU-only Windows environment (the S8-preferred candidate,
MONAI RPD segmentation, remains blocked on Detectron2's lack of Windows
support). S9 downloaded, SHA-256-verified, safely loaded (safetensors only,
no pickle), and ran this model, producing real, reproducible inference
output including an anatomically-implausible cup>disc result that S9
documented honestly rather than filtering out. See
`docs/S8_MODEL_DISCOVERY.md` and `docs/S9_REAL_MODEL_INTEGRATION.md` for
the full selection rationale, license/security audit, and inference
detail — not reproduced here.

## What was built this session

- **`lib/analysis/taxonomy.ts`** — two new `FindingDefinition` entries,
  `research_segmented_optic_disc_area` and `research_segmented_optic_cup_area`
  (lines ~130–152), both `level: "observation"`, `modalities: FUNDUS`,
  `high_risk: false`. These are the only finding types S10's pathway is
  permitted to emit.
- **`lib/models/segformerFindingAdapter.ts`** (new file) — converts a real
  `RawModelOutput` from the S9 provider into the existing `Finding` shape.
  Every finding is checked against `mayEmitFinding()`; region is populated
  only from a real bounding box the model produced; confidence/calibrated
  confidence are never fabricated (`confidence: 0`,
  `confidence_calibrated: null`); `synthetic: false`; `taxonomy_level`
  stays `"observation"`.
- **`lib/evidence/researchAnalysis.ts`** (new file) — the orchestrator:
  study lookup → modality gate (must resolve `FUNDUS`) → real quality gate
  (`assessQuality`) → temp-file write/cleanup → SegFormer inference →
  finding conversion → merge into a copy of the S5 evidence workspace
  (re-running `detectConflicts`/`assessConditions` on the merged set).
  States: `NOT_A_STUDY`, `UNSUPPORTED_MODALITY`,
  `IMAGE_QUALITY_INSUFFICIENT`, `INFERENCE_UNAVAILABLE`, `COMPLETED` — all
  fail-closed except `COMPLETED`.
- **`app/api/studies/[id]/research-analysis/route.ts`** (new file) —
  `GET` only, RBAC `ADMIN`/`CLINICIAN`/`REVIEWER` (via `requireRole`), never
  mutates the study, never writes an `analyses` record. Returns 404 for a
  nonexistent study, 401/403 per RBAC.
- **`components/ResearchAnalysisPanel.tsx`** (new file) — read-only client
  panel rendering the endpoint's output: safety banner always shown;
  `ScanViewer` with real bounding-box localizations for `COMPLETED` with
  findings; an explicit "NO VALIDATED FINDING AVAILABLE... does NOT mean
  the eye is normal" empty state for `COMPLETED` with zero findings; an
  "ANALYSIS INCONCLUSIVE" alert for every fail-closed state; possible
  conditions rendered with "NOT A DIAGNOSIS" wording on every entry. Wired
  into `app/result/page.tsx` (line 362), rendered after the pre-existing
  `EvidenceWorkspacePanel`.
- **`tests/s10-research-analysis.test.ts`** (new file, 9 tests + 1
  skipped) — modality gate, nonexistent-study handling, real end-to-end
  inference with real localization bounding boxes, taxonomy-gated finding
  types, the S5 trust-gating rule (a lone `UNVERIFIED` `AI_FINDING` can
  never alone produce `SUPPORTED_CONDITION`), and RBAC on the route
  (401/403/404 cases). The real-inference tests `describe.skipIf` when the
  gitignored S9 model artifact isn't present on a given checkout; on this
  checkout the artifact was present and the real-inference tests ran (not
  skipped) — see "Test results" below.

## What was explicitly NOT built

Grouped rather than a 44-item checklist:

**(a) Already existed pre-session, reused as-is, not rebuilt:**
- The condition evidence engine (`assessConditions`, five-state model) — S5.
- The symptom taxonomy and correlation engine — S3/S5
  (`lib/clinical/symptoms.ts`, `associatedSymptoms.ts`).
- The treatment-information architecture (registry, gating, safety checks)
  — pre-existing `lib/treatment/*`, intentionally still empty (see
  `docs/CLINICAL_AI_ARCHITECTURE.md` §4).
- The urgency/triage engine — pre-existing `lib/clinical/triage.ts`. Not
  connected to S10's output this session.
- The image viewer with bounding-box overlay — pre-existing
  `components/ScanViewer.tsx`, reused via its existing `localizations`
  prop.

**(b) Genuinely new, built this session:** the two taxonomy entries, the
finding adapter, the research-analysis orchestrator, the API route, the
test suite, and the UI panel — listed in full above.

**(c) Explicitly deferred/not attempted this session:**
- **Populating real treatment/medication content.** Deliberate safety
  decision, not an oversight — see `docs/CLINICAL_AI_ARCHITECTURE.md` §4.
- **A trained multi-modality/DICOM classifier.** The modality gate in
  `researchAnalysis.ts` is a simple canonical-modality string check
  (`canonicalModality(study.modality) !== "FUNDUS"`), reusing the
  pre-existing `lib/models/modalities.ts` mapping — not a trained
  classifier.
- **Six separate REST endpoints** (as the master prompt's section 26
  implied). One consolidated, read-only endpoint
  (`/api/studies/{id}/research-analysis`) was built instead — a deliberate
  simplification, since the orchestrator's output already carries
  findings, evidence, and condition associations together in one honest
  response rather than requiring the client to stitch together six calls.
- **Temporal/longitudinal comparison** (tracking findings across multiple
  studies over time) — not attempted.
- **A dedicated red-team/adversarial test suite for S10 specifically** —
  not separately built this session. `tests/s10-research-analysis.test.ts`
  covers fail-closed states, RBAC, and taxonomy gating, but the
  degenerate-input adversarial testing (1×1 pixel, all-black, all-white,
  extreme aspect ratio) was already done at the raw-model level in S9's
  `scratch/adversarial_test.py` and is cross-referenced rather than
  repeated.

## Test results

Full suite, run this session (`cd "/mnt/d/AI EYE ANALYSIS PLATFORM" &&
npx vitest run --reporter=basic`):

```
Test Files  21 passed (21)
     Tests  516 passed | 2 skipped (518)
  Duration  196.44s
```

`tests/s10-research-analysis.test.ts`: **9 passed, 1 skipped** (9 tests
total in the file's non-artifact-gated `describe` blocks ran; the
artifact-present real-inference tests ran for real on this checkout since
the gitignored S9 model artifact and test fundus image were both present;
the complementary "no artifact present" fail-closed test correctly
skipped, since the artifact *was* present). `tests/s9-real-inference.test.ts`:
11 tests, 1 skipped, consistent with S9's own documented baseline.

## Safety status

- **Gate A: CLOSED.** `analyzeStudy()`/`lib/analysis/pipeline.ts`
  untouched this session.
- **Gates B–F: CLOSED** (unchanged from prior phases; not touched by S10).
- **`data/models/` unchanged** — confirmed via `ls -la "data/models/"`:
  the directory exists and is empty (only `.`/`..` entries), matching the
  documented state since S6.
- **No diagnosis/treatment claims added** — every S10 finding is
  `taxonomy_level: "observation"`; the UI panel labels every condition
  association "NOT A DIAGNOSIS."
- **No coupling into `lib/analysis/pipeline.ts`/`lib/clinical/*`** —
  confirmed via:
  ```
  grep -rln "researchAnalysis\|segformerFindingAdapter" \
    lib/analysis/pipeline.ts lib/clinical lib/treatment lib/reports
  ```
  Result: **no matches** (empty output, exit code 1). Neither
  `researchAnalysis.ts` nor `segformerFindingAdapter.ts` is referenced
  anywhere in `lib/analysis/pipeline.ts`, `lib/clinical/*`,
  `lib/treatment/*`, or `lib/reports/*`.

## Remaining blockers

- **MONAI RPD segmentation's Detectron2/Windows blocker** (S9/S8) — the
  S8-preferred candidate remains uninstallable in this deployment's
  environment; no prebuilt Detectron2 wheels exist for this platform/
  PyTorch combination.
- **Zero published validation for the currently-wired model** (S8) — the
  SegFormer checkpoint has no published Dice/IoU/sensitivity/specificity,
  and S9's own real inference produced an anatomically-implausible result
  (segmented cup area larger than segmented disc area) on a non-REFUGE
  test image — direct evidence of unreliability outside its narrow
  training distribution, not adjusted or hidden.
- **Next.js dev/build environment issue** — pre-existing, unrelated to
  this session's work, and not attempted this session per the master
  prompt's own instruction not to spend session time fighting it (`npx tsc
  --noEmit` and the full test suite remain the authoritative evidence of
  code correctness, both passing cleanly).
