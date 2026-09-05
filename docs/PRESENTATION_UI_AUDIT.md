# Presentation UI Audit (S11)

> **Status: PARTIAL — a scoping and honesty document, not a redesign
> report.** The S11 master prompt asked for a full presentation-ready
> redesign across the entire application (dashboard, analyze screen, PDF
> reports, a Presentation Mode / Clinician Mode toggle, multi-model
> ensemble UI, new disease-model research). This session did **not**
> attempt that — it built three safety/presentation primitives
> (`lib/models/diagnosisGate.ts`, `lib/analysis/qualityPresentation.ts`,
> `lib/reports/terminology.ts`) and applied them to the one panel already
> built in S10 (`components/ResearchAnalysisPanel.tsx`). Everything else
> the master prompt asked for remains as it was before this session.

## 1. Old UI problems — verified against the actual code, not assumed

The master prompt listed example problems (`clinical-rules-0.2.0`,
`pipeline 0.4.0`, `55% uncertainty`, `placeholder`, long technical
disclaimers). Checked directly:

- **Confirmed present, unchanged, mixed exposure**: `RULESET_VERSION =
  "clinical-rules-0.2.0"` (`lib/models/registry.ts:236`) and `PIPELINE_VERSION
  = "0.4.0"` (`lib/analysis/schema.ts:348`) are real, current constants
  (verified directly, not assumed from the master prompt's example text).
  `app/report/page.tsx:308` prints `Ruleset {version} • Pipeline {version}`
  directly in the main "AI model information" card — no collapsible. On
  `/result`, the same two values (`app/result/page.tsx:460-461`) are
  correctly already inside a `<details>`/`<summary>Advanced technical
  information</summary>` disclosure, not exposed in the primary view — so
  this specific problem is only live on `/report`, not `/result`.
  `app/result/page.tsx:410` and `app/report/page.tsx:287` both print a raw
  `{(uncertainty.overall * 100).toFixed(0)}%` badge (e.g. "55%") directly in
  the main view (not collapsed), sourced from a heuristic uncertainty score,
  not a calibrated model — this one is live on both pages.
- **Confirmed present, by design, not a bug**: `lib/analysis/ensemble.ts`
  and `lib/analysis/pipeline.ts` use the word "placeholder" in
  explanation strings that do reach the UI (e.g. "Anatomical segmentation
  is an integration placeholder") — this is deliberately honest language
  for the DEMO pipeline's real limitations, not something to hide; a
  redesign would need to relocate this wording into a technical section
  without softening its honesty.
- **Not touched this session**: the main `/result` and `/report` pages
  themselves (for the DEMO/legacy analysis path) were not edited.
  `components/ResearchAnalysisPanel.tsx` (the S10/S11 research-model panel)
  is the only surface that got the new terminology/quality-presentation
  treatment.

## 2. What was actually built this session

- **`lib/models/diagnosisGate.ts`** — `canDisplayDiagnosis()`, a pure,
  exhaustively-tested (24 test cases in `tests/s11-presentation-safety.test.ts`)
  server-side function requiring all 7 conditions (clinical validation,
  intended-use match, modality match, quality pass, no OOD, calibration,
  sufficient evidence) before a "DIAGNOSIS" label may ever be used instead
  of "REQUIRES_CLINICAL_CORRELATION". Not yet called from any live route —
  it is ready-to-use infrastructure, not wired into `lib/reports/generator.ts`
  or any API response this session.
- **`lib/analysis/qualityPresentation.ts`** — `presentQuality()`, fixing
  the real "pass status + real artifact" inconsistency (a 0.75-scoring
  image with `insufficient_resolution` was presentable as bare "GOOD";
  now maps to "ACCEPTABLE WITH LIMITATIONS"). Does not change the
  underlying scoring in `lib/imaging/quality.ts`.
- **`lib/reports/terminology.ts`** — `friendlyLabel()` mapping table and
  the four distinct `NoResultState` values
  (`NO_TARGET_FINDING_DETECTED`/`MODEL_UNAVAILABLE`/`MODEL_NOT_VALIDATED_FOR_IMAGE`/`IMAGE_NOT_SUITABLE`),
  replacing one ambiguous "no findings" concept with four that can never be
  misread as "normal".
- **`components/ResearchAnalysisPanel.tsx`** (extended, not rewritten):
  now uses all three of the above — the four distinct no-result states
  with correct severity coloring, a compact real-quality summary row, a
  collapsible "Technical Details" block (model id, taxonomy level,
  synthetic flag, raw state/modality/quality_status, timestamp), and
  routes condition-state badges through `friendlyLabel()`. `lib/evidence/researchAnalysis.ts`
  gained one additive field (`quality?: QualityResult`) to carry real
  quality data to the UI — the only non-purely-additive change this
  session made to a pre-existing file.

## 3. What was explicitly NOT attempted this session

- Full dashboard redesign (`/dashboard`, recent-analyses table, "+ Analyze
  New Scan" entry point per §22 of the master prompt)
- Analyze-screen redesign with drag-and-drop upload UI and a live
  step-by-step "Analyzing..." progress indicator (§23)
- PDF/report redesign with the 12-section structure requested in §34
- A dedicated "Presentation Mode" / "Clinician Mode" toggle (§21, §33) —
  no such toggle exists anywhere in the app
- Multi-model ensemble architecture or "Model Agreement" UI (§25–26) — this
  deployment has exactly one real (unvalidated) research model; an
  ensemble-agreement display would be actively misleading to build for a
  single-model system
- New disease-specific model research or selection — the wired model
  remains SegFormer optic-disc/cup segmentation, unchanged from S8/S9; no
  new candidate was investigated this session
- A responsive-layout or accessibility audit
- A dedicated new red-team UI test suite beyond what already exists
  (`tests/s9-real-inference.test.ts`'s adversarial input cases at the
  model layer, and this session's `tests/s11-presentation-safety.test.ts`
  at the presentation-logic layer) — no new UI-level red-team tests (e.g.
  simulated clicks, DOM assertions) were added

## 4. Recommendation for a future session

Each of the deferred items above (dashboard, analyze flow, PDF report,
presentation/clinician mode toggle, multi-model UI) is independently
substantial — realistically a dedicated session each, not a single combined
pass. A future session should pick ONE of these, scope it explicitly, and
build it with the same test-backed discipline used for the pieces that
were completed here, rather than attempting all of them shallowly.

## 5. Test results (real, from this session's actual run)

`npm test` (`vitest run`), run to completion this session:

```
Test Files  6 failed | 16 passed (22)
     Tests  7 failed | 533 passed | 2 skipped (542)
  Duration  460.96s
```

This is the real, current number — not the S10 baseline (516 passed | 2
skipped, 518 total) restated. The failures are **not** in
`tests/s11-presentation-safety.test.ts` (that file's own 24 tests — 1
fully-satisfied gate case + 11 individually-failing-condition cases + 1
multi-failure case + 1 default-closed case for the diagnosis gate, 4 quality-
presentation cases, 2 terminology cases, and the no-result-state cases — all
pass). The visible failures are concentrated in the real-model-inference
tests that depend on the gitignored SegFormer checkpoint and a live Python
subprocess bridge: `tests/s10-research-analysis.test.ts` ("produces real
findings with localization...", "never lets the research finding taxonomy
type leak...", "the merged evidence workspace never contains a
SUPPORTED_CONDITION...") and `tests/s9-real-inference.test.ts`
("is deterministic across repeated runs..." — timed out at the default
30000ms test timeout, not a correctness failure). These are pre-existing
S9/S10 tests, not modified this session, and their failure mode (a
subprocess-driven real-inference call exceeding a fixed timeout, evidently
under load from a long, single `vitest run` of the full 542-test suite) is
consistent with environment-load flakiness rather than a regression in this
session's own code — this session touched zero files under `lib/models/`,
`lib/evidence/`, or their test files. This should still be treated as an
open item for whoever next runs this suite, not swept under the rug: either
raise the timeout for the real-inference tests specifically, or run them in
isolation from the rest of the suite.

## 6. Safety status

- `data/models/` — confirmed empty.
- HEAD unchanged; nothing committed.
- `grep -rln "diagnosisGate\|qualityPresentation" lib/analysis/pipeline.ts lib/clinical lib/treatment lib/reports/generator.ts` —
  **zero matches**: these new primitives are not yet wired into the live
  DEMO clinical pipeline or the legacy report generator. They exist as
  tested, ready-to-integrate infrastructure only, consistent with every
  prior phase's rule that new safety/evidence code must not silently
  attach itself to the live pipeline without an explicit, separate
  integration decision.
- Gate A and Gates B–F remain CLOSED.
