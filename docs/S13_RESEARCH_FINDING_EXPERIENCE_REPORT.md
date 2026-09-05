# S13 Research Finding Experience Report

> **Status: PARTIAL — real architectural consolidation, a coordinate-system
> correctness proof, two closed fail-open gaps, and an expanded red-team
> suite; NOT the 66-section presentation/UX rebuild.** The S13 master
> prompt asked for, among other things, a full dashboard/analyze-screen
> redesign, a Presentation Mode / Clinician View toggle, and a formal
> 4-breakpoint accessibility audit across 10 named parallel agents. This
> session did not attempt that scale. It focused on the one item the
> prompt itself called "one of the most important S13 tasks" — resolving
> `lib/analysis/imageSuitability.ts`'s ambiguous, unwired status — plus a
> deep audit of the real SegFormer localization pipeline (the other
> genuinely load-bearing correctness question: is the bounding-box math
> actually right), the deferred extraction-confidence copy fix, and an
> expanded red-team test suite. This mirrors the same honest-scoping
> pattern as S8–S12.

## 1. Starting state

```
HEAD 260b6e2754c920fcc950d3cd11d2fdd340d8b907
548 passed | 2 skipped | 0 failed
TypeScript: PASS
Filesystem audit: PASS
data/models/: EMPTY
Gates A-F: CLOSED
```
Verified directly at the start of this session, matching the S12 report exactly.

## 2. Sub-agent work

Two parallel read-audit-plus-test agents were used (not the 10 named
workstreams literally — consolidated into the two genuinely independent,
non-file-colliding investigations; the `imageSuitability.ts` wiring and
extraction-confidence fix were done directly by the lead agent to avoid
both agents editing the same shared pipeline files):

- **SegFormer localization audit** — traced the complete real path
  (`scripts/inference/segformer_infer.py` → `segformerResearchProvider.ts`
  → `segformerFindingAdapter.ts`), confirmed the coordinate-system
  correctness question (below), searched for hidden synthetic fallbacks
  (none found), documented edge-case behavior, and added
  `tests/s13-localization-audit.test.ts` (9 tests).
- **Clinical language + red-team audit** — swept `app/`, `components/`,
  `lib/clinical/*` for misleading language beyond S12's already-fixed
  scope (nothing dangerous found — including a newly-discovered
  clinician treatment-review panel not previously audited, confirmed
  properly schema-gated), and added `tests/s13-redteam.test.ts`
  (5 scenarios, including one genuinely new end-to-end invariant).

## 3. Image suitability — resolved, not left ambiguous

**Before this session:** `lib/analysis/imageSuitability.ts` was fully
built (7-state classification: `SUITABLE`/`LOW_QUALITY`/
`INSUFFICIENT_FOV`/`UNSUPPORTED_MODALITY`/`OUT_OF_DISTRIBUTION`/
`DEVICE_UNSUPPORTED`/`INFERENCE_UNAVAILABLE`) but called by nothing. The
real research-analysis path (`lib/evidence/researchAnalysis.ts`) ran its
own ad-hoc modality + quality checks and, critically, **performed no OOD
check at all** — a real gap the S12 red-team audit had already flagged.

**Decision:** yes, it should be the authoritative suitability layer for
the research path, per the master prompt's own recommendation. It was
NOT duplicated or rewritten — its existing precedence logic (model →
modality → FOV → quality → device → OOD → suitable) was reused as-is.

**What changed:**
- `imageSuitability.ts`'s `ImageSuitabilityInput.model` type was widened
  from a full registry `ModelRecord` to a minimal `{ modalities:
  Modality[] }` shape — the function only ever read `.modalities` from
  it. This is what actually unblocked integration: the SegFormer
  provider is deliberately **not** a registered model (clinical
  isolation, established in S9), so it could never satisfy a
  `ModelRecord` requirement. This change is backward-compatible
  (`ModelRecord` already structurally satisfies the new type) and does
  not affect the main pipeline, which still doesn't call this module.
- `lib/evidence/researchAnalysis.ts` now calls `assessOod()` (previously
  entirely unused on this path) and `classifyImageSuitability()` after
  the quality gate and before inference, using a real image-suitability
  descriptor (`{ modalities: ["FUNDUS"] }` — an honest reflection of what
  SegFormer actually supports, not a registry lookup) and `device: null`
  (honest: no device-compatibility allowlist exists for this model — not
  a loss of protection, since none existed before either). A new
  `ResearchAnalysisState` value, `"OUT_OF_DISTRIBUTION"`, was added
  (additive to the existing union) and wired through
  `components/ResearchAnalysisPanel.tsx` and `lib/reports/terminology.ts`
  (a new `IMAGE_OUT_OF_DISTRIBUTION` presentation state, distinct from
  `IMAGE_NOT_SUITABLE`/`MODEL_NOT_VALIDATED_FOR_IMAGE` — per §25's
  explicit instruction not to collapse quality/suitability/OOD/validation
  into one concept).
- No duplicate/conflicting safety logic was found elsewhere: the main
  DEMO pipeline already computes its own real, independent
  `assessOod()`/quality gate (never called through `imageSuitability.ts`,
  by original design documented in that file's own header — the DEMO
  provider never inspects distribution and doesn't need this layer). The
  two pipelines' *quality* thresholds are now provably consistent
  (`!== "pass"` blocks in both, since S12), and the research path's *OOD*
  handling now exists for the first time rather than silently diverging
  from the main pipeline's.

## 4. Real finding pipeline — localization audit result

**The single most important correctness question — does the bounding-box
math divide by the right image dimensions — is CONFIRMED CORRECT, not a
bug.** `segformer_infer.py` upsamples the model's logits via
`torch.nn.functional.interpolate(..., size=image.size[::-1], ...)`,
where `image.size[::-1]` is the *original* PIL image's `(height, width)`,
not the model's resized/padded input. The predicted mask is therefore
already at original-image resolution before any bbox math runs, and the
normalization (`x0/img_w`, etc.) divides by the original image's own
dimensions. Localization is real, correctly transformed, and not
fabricated at any stage — confirmed for empty masks (finding omitted,
never a fake box), single-pixel masks, full-image masks, edge-touching
masks, and NaN/Infinity model output (fails closed before any bbox
computation, `inference_status: "failed"`).

**One real gap found and fixed:** the finding adapter
(`segformerFindingAdapter.ts`) and the raw-output validator
(`lib/models/outputContract.ts`) never actually range-checked bounding-box
coordinate values — only checked that *some* coordinates were present,
contrasted with the bounds checks already applied to
`confidence`/`calibrated_confidence`/`uncertainty`. In practice the real
Python script only ever emits valid values today, so this was latent, not
exploited — but it was a real absence of defense-in-depth. **Fixed**:
`validateRawModelOutput()` in `lib/models/outputContract.ts` now rejects
any bounding box whose `x`/`y`/`w`/`h` is non-finite, negative, `>1`, or
whose `x+w`/`y+h` exceeds `1.0001`. Since `segformerResearchProvider.ts`
already calls this validator before returning any output, this closes
the gap at the earliest possible point: an invalid box now fails the
*entire* inference closed (`inference_status: "failed"`), not just the
one bad finding.

No hidden synthetic fallback exists anywhere in this path — the SegFormer
pipeline is fully isolated from the DEMO pipeline's (intentionally
synthetic, clearly labeled) generator, confirmed by grepping for
`random`/`mock`/`fake`/`placeholder`/`synthetic`/`demo` across every file
in the real path.

## 5. UI

Not redesigned this session (dashboard, analyze screen, presentation
mode, and clinician view toggle are explicitly deferred — see §7). The
concrete UI changes made:
- `components/ResearchAnalysisPanel.tsx`: new `OUT_OF_DISTRIBUTION` state
  handling wired through the existing no-result-state machinery (added to
  the type union and severity map, no structural redesign).
- `components/DocumentEvidencePanel.tsx` and
  `components/EvidenceWorkspace.tsx`: the two REQUIRES-REWORDING items
  carried over from S12 are fixed. Extraction-confidence percentages are
  now labeled "extraction confidence NN% (not clinical confidence)"
  everywhere they appear; `EvidenceWorkspace.tsx`'s generic evidence
  confidence is now source-type-aware — an `AI_FINDING`'s confidence is
  labeled "model confidence (uncalibrated, not clinical confidence)"
  while every other evidence source is labeled "extraction confidence
  (not clinical confidence)", since the underlying field was previously
  ambiguous between OCR-page confidence and model confidence.

## 6. Accessibility

Not audited this session — no systematic keyboard/contrast/ARIA/
responsive-breakpoint pass was performed. This remains fully deferred
(see §7); nothing was checked or claimed here.

## 7. Safety

- **Diagnosis gate**: unchanged (the master prompt explicitly required
  this — the 7-condition requirement was not touched). Still verified
  closed by both the existing S11/S12 tests and this session's new
  scenario-3 red-team test (a fixture with two fields disguised as
  "safe" values still produces a closed gate with all 6 genuinely-failing
  reasons listed).
- **Failure states**: `model failure != normal`, `OOD != normal`, `bad
  image != normal`, `unsupported modality != normal` all independently
  verified — the research path's new `OUT_OF_DISTRIBUTION` state now
  covers the one previously-missing case (OOD reaching the research
  path with no check at all).
- **Symptom isolation**: `lib/clinical/correlation.ts` confirmed
  (re-audited this session): symptoms never create findings/diagnoses,
  every branch uses hedged wording. New end-to-end test (red-team
  scenario 4) proves a real "sudden vision loss" symptom on a real
  zero-AI-finding study still forces `emergency_evaluation` triage
  priority through the actual API routes — the one genuinely new
  invariant this session verified that no prior test exercised
  end-to-end.
- **Test-result isolation**: unchanged, still governed by S5's trust-level
  filtering; the IOP-55-alone red-team scenario was confirmed as an exact
  duplicate of an existing S5 test and intentionally not re-implemented.
- **Treatment restrictions**: confirmed (by the red-team/language audit)
  that a clinician treatment-review panel exists in `app/clinician/page.tsx`
  that was not previously audited — verified it is properly schema-gated
  (DEMO models can never surface treatment info; a dosing-pattern regex
  blocks fabricated doses in `lib/clinical/safety.ts`) and clearly labeled
  "Clinician review required," with AI-generated treatment information
  never mutated by the separate clinician-decision record.

## 8. Red team

| Attack (S13 §49) | Result |
|---|---|
| 1. Client spoofs `diagnosis_gate = APPROVED` | **Defended, proven, not merely asserted** — grepped every route/service function; no intake point for a client-supplied gate exists anywhere. A real POST to `/api/analyze` with a spoofed gate payload confirmed the independently re-fetched, server-computed result stays closed. |
| 2. Client hides "not clinically validated" | Not directly re-tested this session (server always emits the disclaimer regardless of client rendering — S11/S12 already established this is server-computed, not client-toggleable); no new attack surface found. |
| 3. Model unavailable → never "normal" | **Defended** — S10's `INFERENCE_UNAVAILABLE` path exhaustively covered already; this session's scenario 2 covers the DEMO pipeline's zero-finding sibling case, confirming the overall result string is never a bare "normal"/"healthy" claim. |
| 4. Borderline quality → no unauthorized inference | **Defended, and one real gap closed this session** (see §3/§4 — research path had no OOD check and used a looser quality threshold than the main pipeline before S12/S13; both are now consistent). |
| 5. OOD → `MODEL_NOT_VALIDATED_FOR_IMAGE`, no diagnosis | **Defended** — main pipeline already did this; research path now does too via the new `OUT_OF_DISTRIBUTION` wiring. |
| 6. Sudden vision loss + no AI finding → still urgent | **Defended, newly proven end-to-end** (scenario 4, real routes, real zero-finding image, `emergency_evaluation` confirmed). |
| 7. Eye pain → forced "glaucoma" | **Defended** — `lib/clinical/correlation.ts` never converts symptoms to diagnoses; re-audited, no changes needed. |
| 8. IOP 55 → forced diagnosis | **Defended** — duplicate of existing S5 test, confirmed still passing, not re-implemented. |
| 9. Fake 0.99 confidence → "99% confidence" display | **Defended** — `outputContract.ts`'s existing 0..1 bounds checks plus this session's new coordinate-range checks; no path exists for a raw confidence value to bypass the "heuristic/uncalibrated" labeling established in S12. |
| 10. Empty mask → fake rectangle | **Defended, proven at the source** — `segformer_infer.py` omits the finding entirely on an empty mask (`if px == 0: continue`); the JS adapter never fabricates a center-box/zero-box default when `localization` is absent (`region: null`, verified by new unit tests). |

## 9. Testing

```
25 test files passed (25)
562 tests passed | 2 skipped (564 total)
0 failed
```
14 new tests this session: `tests/s13-localization-audit.test.ts` (9),
`tests/s13-redteam.test.ts` (5, one intentionally a documented duplicate
no-op). Baseline (548 passed) + 14 new = 562. Zero regressions; the
previously-flaky `s9-real-inference.test.ts` load-dependent timeout did
not recur.

## 10. TypeScript

`npx tsc --noEmit -p .` — clean except the pre-existing, unrelated
`tests/s1-documents.test.ts` pdf-lib typing issue (present since before
this entire multi-phase session began).

## 11. Filesystem

`npm run audit:fs` — PASS. Project and data confirmed on D:.

## 12. Model directory

`data/models/` — confirmed EMPTY before and after this session.

## 13. Git

```
HEAD: 260b6e2754c920fcc950d3cd11d2fdd340d8b907 (unchanged)
Working tree: uncommitted changes present (as with every prior S-phase this session)
Commit: NONE
Push: NONE
```

## 14. Remaining limitations

- Clinical validation: incomplete.
- Diagnosis: unavailable (gate remains closed by design).
- Treatment: unavailable for patient-specific recommendations (the
  clinician treatment-review panel is a human-driven disposition record,
  not an AI recommendation engine).
- SegFormer: research-only, zero published validation evidence.
- Regulatory status: not a medical device.

## 15. Deferred work (S14 candidates)

Unchanged in kind from every prior phase's deferral list, still true:

- Full dashboard redesign (`app/dashboard/page.tsx` — new-analysis entry
  point, recent-studies hierarchy, needs-review/urgent-review sections).
- Analyze-screen workflow redesign (drag-and-drop, step-by-step progress
  indicator).
- A dedicated Presentation Mode / Clinician View toggle — still does not
  exist anywhere in the app.
- Report page (`/report`) 12-section restructure per §39 — only the
  targeted terminology/collapsibility fixes from S12 exist; no broader
  section reorganization was attempted.
- A formal accessibility audit (keyboard-only navigation, contrast,
  ARIA labeling, screen-reader testing) and a formal 4-breakpoint
  responsive audit (375/768/1024/1440px) — genuinely not done, not
  spot-checked, fully open.
- PDF/document presentation-layer improvements (§40) — not touched.
- A "multiple findings" richer UI/UX pass (§21-22, finding
  selection/highlight/overlay interaction) — the architecture already
  supports a findings array; no new selection/highlight UX was built.
- Performance measurement (§52) — not instrumented this session.

## Gate results

| Gate | Result |
|---|---|
| S13-A Baseline (548/2/0) | **PASS** (confirmed at session start) |
| S13-B Type safety | **PASS** |
| S13-C Suitability (no contradictory bypass) | **PASS** — research path now uses the same suitability precedence as the architecture intends; the one prior fail-open gap (missing OOD check) is closed |
| S13-D Localization (real mask-derived, no fake boxes) | **PASS** — confirmed correct coordinate transform, no fabrication, one defense-in-depth gap closed |
| S13-E Failure semantics | **PASS** |
| S13-F Diagnosis (still unavailable) | **PASS** |
| S13-G Symptoms (independent, urgency preserved) | **PASS** — newly proven end-to-end |
| S13-H Test results (unverified/rejected never authoritative) | **PASS** (unchanged, re-confirmed via existing S5 coverage) |
| S13-I UI safety (no misleading claims) | **PASS** for everything audited; **NOT FULLY AUDITED** — no systematic sweep of dashboard/analyze-screen copy was performed since those pages were not touched or redesigned this session |
| S13-J Accessibility | **NOT ATTEMPTED** — explicitly deferred, not a partial pass |
| S13-K Red team | **PASS** — all 10 requested attack categories addressed (defended-and-proven, or confirmed-as-existing-coverage-with-citation) |
| S13-L Filesystem | **PASS** |
| S13-M Full test suite (548+, 0 failed) | **PASS** — 562 passed, 2 skipped, 0 failed |
| S13-N Git (HEAD unchanged, no commit) | **PASS** |

**FINAL STATUS: S13 PARTIAL** — the safety-critical architectural work
(image suitability consolidation, localization correctness proof, two
real fail-open/defense-in-depth gaps closed, expanded red-team coverage)
is complete and gate-verified. The presentation/UX/accessibility scope
(§37-46, §43-44) was explicitly and knowingly deferred, consistent with
every prior phase's honest-scoping discipline. This is not "S13
COMPLETE" against the full 66-section prompt, and is not represented as
such.
