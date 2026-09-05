# S12 Production Integration Report

> **Status: PARTIAL — real, tested production wiring of the S11 safety
> primitives plus a fail-closed bug fix and a red-team audit; NOT the
> full 53-section presentation redesign.** The S12 master prompt asked
> for, among other things, a full dashboard/analyze-screen/PDF redesign,
> a Presentation Mode / Clinician Mode toggle, and 10 named parallel
> agent workstreams. This session did not attempt that scale — it wired
> the three already-tested S11 primitives
> (`lib/models/diagnosisGate.ts`, `lib/analysis/qualityPresentation.ts`,
> `lib/reports/terminology.ts`) into the live legacy DEMO pipeline (the
> one production-facing path that did not already use them —
> `components/ResearchAnalysisPanel.tsx` already used all three since
> S11), fixed one real fail-open gap found during the red-team pass, and
> ran a repository-wide misleading-language audit. Everything else the
> master prompt asked for remains exactly as it was before this session.
> This mirrors the same honest-scoping pattern as every prior phase
> (S8–S11), each of which stated up front which subset of a large master
> prompt would actually be attempted.

## 1. What was wired into production this session

### `lib/analysis/pipeline.ts` — diagnosis gate

- Added `mapModelValidationStatus()`: maps this deployment's registry
  `ModelStatus` onto the gate's independent validation vocabulary,
  failing closed to `"NOT_VALIDATED"` for any unrecognized or
  undefined status (including "no registered model").
- Computes a real `DiagnosisGateInput` every run from actual pipeline
  state — model status, modality match, real quality status, real OOD
  flag — and hardcodes `intendedUseMatches: false` and
  `calibrationAvailable: false` because no formal intended-use approval
  or calibration evidence exists anywhere in this deployment. The gate
  is closed by `modelValidation` alone today regardless (the DEMO model,
  `demo-fundus-synthetic-v0`, is never `CLINICALLY_VALIDATED`), so this
  is documented, deliberate over-caution, not a functional shortcut.
- Result attached to `analysis.diagnosis_gate` (new optional field in
  `lib/analysis/schema.ts`, non-strict validator — additive only).
  `unsupportedResult()` uses `unvalidatedGateResult()` (always closed).

### `lib/reports/generator.ts` — fail-closed accessor + runtime guard

- `diagnosis_gate` carried straight through into `ClinicalReport`.
- New `clinicalInterpretationLabel(r)`: the one sanctioned way for any
  rendering surface to ask "is this a diagnosis or does it require
  clinical correlation." Missing gate data (e.g. a pre-S12 stored
  result) resolves to `"REQUIRES_CLINICAL_CORRELATION"`, never to an
  open default.
- `buildOverallResult()` now **throws** if it ever produces
  diagnostic-sounding wording without the gate having approved it — a
  real runtime enforcement guard against a future accidental regression,
  not just documentation.

### `app/result/page.tsx` and `app/report/page.tsx`

- The previously-exposed `Ruleset {version} • Pipeline {version}` line
  on `/report` (confirmed live/exposed by the S11 audit) is now inside
  a `<details><summary>Advanced technical information</summary>`
  disclosure, matching the pattern `/result` already used correctly.
- The bare uncertainty percentage badge on both pages (`{(uncertainty
  .overall * 100).toFixed(0)}%`, sourced from a heuristic score, not a
  calibrated model — confirmed live on both pages by the S11 audit) is
  relabeled everywhere it appears: **"Heuristic uncertainty score (not
  calibrated confidence): NN%"**. It is no longer a bare `Badge` that
  could be misread as AI confidence.
- Both pages now use `presentQuality()` for the image-quality badge
  instead of a raw `pass → "GOOD"` mapping, so a "pass" status that
  still carries a real detected artifact is never shown as bare "GOOD."
- Raw enum leak check (item 3 of the original wiring task): grepped
  every `terminology.ts` `LABELS` key across `app/report`, `app/result`,
  `lib/reports/generator.ts`, `lib/clinical`, `lib/analysis/pipeline.ts`
  — zero matches. Those raw condition-state enum values only exist in
  the S9/S10 research-analysis taxonomy, which already routes through
  `friendlyLabel()`. Nothing to fix in the legacy DEMO surfaces.

### `lib/evidence/researchAnalysis.ts` — fail-closed bug fix (found by red-team pass, fixed directly)

The red-team audit (below) found a real, concrete fail-open gap: the
research-analysis path only blocked inference on `quality_status ===
"fail"`, while the main DEMO pipeline (`lib/analysis/pipeline.ts:71`)
blocks on anything short of `"pass"`. A `"borderline"`-quality image
could reach real SegFormer inference and produce findings on the
research path even though the stricter main pipeline would reject it.
Fixed to match the main pipeline's standard: `quality_status !==
"pass"` now blocks, matching the stricter gate everywhere else in the
system. Verified no existing test depended on the old, looser
threshold.

## 2. New tests

`tests/s12-diagnosis-gate-integration.test.ts` (8 tests, real
end-to-end, no mocks):

- A real `createStudy` + `analyzeStudy` run against the only registered
  model confirms `analysis.diagnosis_gate.allowed === false`,
  `clinical_interpretation === "REQUIRES_CLINICAL_CORRELATION"`, and
  that the disqualifying reason correctly names `NOT_VALIDATED` — not
  some unrelated field.
- `clinicalInterpretationLabel()` fail-closed default for a
  `diagnosis_gate`-less legacy result.
- Source-text assertions (following the existing lightweight
  string-check pattern already used by `scripts/visual-qa.mjs`, since
  no React Testing Library/jsdom harness exists in this repo) confirming
  the `/report` page's collapsible technical-details block and both
  pages' relabeled uncertainty text.
- The "all seven gate conditions true → `DIAGNOSIS` allowed" pure-function
  case is already exhaustively covered by
  `tests/s11-presentation-safety.test.ts` and was **not** duplicated.

## 3. Red-team audit (read-only, by a second parallel sub-agent)

### Misleading-language sweep

Searched `app/`, `components/`, and `lib/reports/` for bare confidence
percentages, unqualified "diagnosis"/"confirmed"/"detected" language,
raw enum leaks, exposed version strings, and clinical-readiness claims.
Findings, classified SAFE / REQUIRES REWORDING / SERVER-GATED /
TEST-ONLY / DANGEROUS:

- **No DANGEROUS instances found** — no bare, uncaveated diagnostic
  percentage in a primary view; no unexplained raw enum leak in the
  diagnostic path; no copy claiming regulatory approval or clinical
  readiness.
- **REQUIRES REWORDING (2, not yet fixed this session — out of the
  scope that was actually wired):**
  - `components/DocumentEvidencePanel.tsx:151,377` — bare
    `${r.extraction_confidence.toFixed(0)}%` badge for document
    extraction confidence, no inline "(extraction confidence, not
    clinical)" caveat at the number itself (a file-level banner exists
    but is visually distant).
  - `components/EvidenceWorkspace.tsx:143` — same pattern, bare
    `{(e.confidence * 100).toFixed(0)}%`.
- **SAFE (verified, not assumed):** `components/ui.tsx`'s
  `ConfidenceIndicator` (calibration-honesty gated), model/version
  strings in `/result`, `/clinician`, `/report`, `/evaluations`
  (adjacent to explicit "NOT VALIDATED" red text and pushed into a
  `<details>` collapse for the detailed fields), the research-analysis
  path's condition-state labels (already routed through
  `friendlyLabel()`), `AppShell.tsx`'s global disclaimer footer, and the
  research-analysis safety banner text.
- **TEST-ONLY:** assorted raw enum/percentage strings that appear only
  in `tests/*.test.ts` fixtures, never real UI.

### Red-team scenario matrix

| Scenario | Status |
|---|---|
| Model claims clinically-validated status without evidence | **DEFENDED** — `canDisplayDiagnosis()` AND-gates all 7 conditions; a single failure closes the whole gate. |
| Borderline quality forced through to real inference | **Was a GAP in the research-analysis path — fixed this session** (see §1). Main pipeline was already strict. |
| OOD image reaching diagnostic language | **DEFENDED** in the main pipeline (`ood.detected` raises uncertainty and appends `OOD_MESSAGE`). Noted: `lib/analysis/imageSuitability.ts`'s `OUT_OF_DISTRIBUTION` classification exists but is **not wired into any caller** — it is inert scaffolding, not active protection, and should be flagged as such rather than assumed live (documented here so a future session doesn't mistake it for active defense). |
| Fabricated confidence value not in the raw output contract | **DEFENDED** via `validateAnalysisResult()` schema validation before storage/display; noted as the sole backstop (no independent per-provider check confirmed). |
| OD/OS clinical vs. right/left/both patient-facing laterality confusion | **DEFENDED** — `lib/evidence/laterality.ts` documents this as an intentionally weaker "wording translation," never silently merged as equivalent evidence; `synthesize.ts` keeps per-eye matching strict. |
| Evidence workspace producing `SUPPORTED_CONDITION` from one `UNVERIFIED` source | **DEFENDED** — trust-level filtering in `synthesize.ts` requires `HUMAN_VERIFIED`/`CLINICIAN_ENTERED`/`VALIDATED_AI_FINDING`; raw AI findings are always tagged `UNVERIFIED` and cannot alone satisfy it. |
| Nonexistent study ID reaching analysis logic | **DEFENDED** — every study-scoped route and orchestrator function checks existence and returns 404/`NOT_A_STUDY` before further processing. |

**Open item for a future session:** `lib/analysis/imageSuitability.ts`
is fully-built, plausible-looking OOD/quality-suitability logic that is
not actually called by anything. It should either be wired into the
research-analysis path (closing a real gap parallel to the one fixed
this session) or explicitly documented as inert so nobody assumes it is
providing protection it isn't.

## 4. What was explicitly NOT attempted this session

Same category of deferral as the S11 audit, still true:

- Full dashboard redesign, drag-and-drop analyze-screen redesign, PDF
  12-section redesign, a dedicated Presentation Mode / Clinician Mode
  toggle, multi-model "Model Agreement" UI (this deployment has exactly
  one real, unvalidated model — an ensemble-agreement UI would be
  actively misleading to build).
- The two REQUIRES REWORDING items above
  (`DocumentEvidencePanel.tsx`/`EvidenceWorkspace.tsx` bare extraction/
  evidence-confidence percentages) — real, low-risk, scoped copy fixes,
  not done this session; not a diagnostic-confidence issue, but should
  get an inline caveat next time this area is touched.
- A dedicated new UI-level red-team test suite (simulated clicks, DOM
  assertions) — this session's red-team work was a code-reading audit,
  not new automated adversarial UI tests.
- All 10 named S12 agent workstreams literally — 2 realistically-scoped
  agents (production wiring; red-team/misleading-language audit) plus
  direct lead verification and one bug fix covered the load-bearing
  parts of the ask.

## 5. Test results

`npm test`, full suite, run twice this session (once by the wiring
agent, once independently by the lead agent after the additional
`researchAnalysis.ts` fix):

```
Test Files  23 passed (23)
     Tests  548 passed | 2 skipped (550)
  Duration  ~167-173s
```

Zero failures, zero regressions from the prior 539/542-passing baseline
(2 skipped, 1 previously-flaky load-dependent timeout that did not
recur either run). 8 new tests added
(`tests/s12-diagnosis-gate-integration.test.ts`). `npx tsc --noEmit -p .`
clean except the pre-existing, unrelated `tests/s1-documents.test.ts`
pdf-lib typing issue.

## 6. Safety status

- HEAD unchanged at `260b6e2754c920fcc950d3cd11d2fdd340d8b907`; nothing
  committed.
- `data/models/` confirmed empty before and after this session's work.
- Gate A and Gates B–F remain CLOSED.
- All three S11 primitives are now used by every production-facing
  presentation surface that renders AI output in this deployment
  (`/result`, `/report`, `components/ResearchAnalysisPanel.tsx`) — none
  is unwired infrastructure any longer.
- One real fail-open gap (borderline-quality bypass in the research
  path) was found and closed. One inert-but-plausible-looking module
  (`imageSuitability.ts`) was identified as not actually providing the
  protection its code implies — flagged, not fixed, since wiring it in
  is a larger decision about the research-analysis pipeline's behavior
  than this session's scope.
