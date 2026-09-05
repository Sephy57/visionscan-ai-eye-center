# Phase 5 — Longitudinal Ophthalmic Intelligence

> **Observed longitudinal change does not by itself establish disease
> progression.** This phase compares evidence across visits. It does not
> predict, diagnose, or autonomously conclude progression.

## 1. Architecture

```
Patient (via patient_ref, the only real cross-study identifier that exists)
   ↓
buildPatientTimeline(studyIds)          lib/patients/timeline.ts (new)
   ↓ (real created_at order, never caller-trusted order; refuses cross-patient mixing)
buildStructuredClinicalEvidence()       Phase 4, unmodified, reused per visit
   ↓
compareMeasurements()                   lib/evidence/measurementTrend.ts (new)
compareFindings()                       lib/evidence/findingComparison.ts (new)
compareSymptoms()                       lib/evidence/symptomTrend.ts (new)
   ↓
buildLongitudinalSummary()              lib/clinical/longitudinalComparisonEngine.ts (new)
   ↓
StructuredLongitudinalResult
```

Every comparison primitive is pure and deterministic. The engine reuses
Phase 4's `buildStructuredClinicalEvidence()` unmodified for each visit
rather than re-deriving evidence, and recomputes urgent flags completely
independently of any historical comparison (§27).

## 2. Patient timeline

`lib/patients/timeline.ts`'s `buildPatientTimeline(studyIds)`:
- Re-fetches every supplied study id and re-sorts by the **real, stored**
  `created_at` — caller-supplied array order is never trusted (defends
  against §28's "reordered encounters" attack).
- **Refuses** (throws) to build a timeline spanning more than one distinct
  `patient_ref` — cross-patient evidence mixing fails closed rather than
  silently merging (§28's "cross-patient timeline access" attack).
- `findStudiesByPatientRef()` returns `[]` for an empty/whitespace ref,
  never matching every ref-less study by accident.

The eye-center workspace now persists a `PatientRecord` and
`PatientEncounter`. Studies created with a patient reference are explicitly
linked to an encounter; `patient_ref` remains the conservative cross-visit
anchor for legacy studies and is never fuzzy-matched.

## 3. Eye-specific tracking

Every comparison primitive is laterality-scoped independently:
- `compareMeasurements()` groups by `category|laterality` — an OD value is
  never compared against an OS value (verified by test: an OD-only IOP
  reading and an OS-only IOP reading at a later visit produce two
  independent `RESOLVED`/`NEW` entries, never one merged `INCREASED`).
- `compareFindings()` checks `prior.eye !== current.eye` as its **first**
  check, before any other comparison — a declared eye mismatch immediately
  short-circuits to a single `NOT_COMPARABLE` result.
- `compareSymptoms()` groups by `symptom_type|laterality` the same way.

## 4. Measurement Trend Engine

`lib/evidence/measurementTrend.ts`'s `compareMeasurements(prior, current)`:
- States: `NO_PRIOR_COMPARISON` (implicit — a key only in `current`),
  `STABLE`, `INCREASED`, `DECREASED`, `NEW`, `RESOLVED`, `CONFLICTED`,
  `INSUFFICIENT_DATA`, `UNKNOWN`.
- **Never converts units.** A unit mismatch (`mmHg` vs `kPa`) produces
  `INSUFFICIENT_DATA`, not a fabricated conversion — verified by test.
- **Never fabricates clinical significance.** Every result carries
  `clinically_significant_progression: false`, always — the field exists
  (not omitted) purely so a future, separately-validated methodology has
  an explicit place to eventually set it `true`; nothing in this engine
  can do so today (§12's hard boundary).
- `REJECTED` evidence and non-finite (`NaN`/`Infinity`) values are excluded
  entirely before any comparison runs — verified by test.
- Same-visit duplicate conflicting values (e.g. two IOP=18 and IOP=20
  readings both dated the same visit) produce `CONFLICTED`, never an
  auto-picked value — mirrors `lib/evidence/conflicts.ts`'s own
  `VALUE_CONFLICT` philosophy.

## 5. AI Finding Longitudinal Comparison

`lib/evidence/findingComparison.ts`'s `compareFindings(prior, current)`
runs three compatibility checks, in order, before any per-finding-type
diff is attempted:
1. **Eye match** — mismatch → `NOT_COMPARABLE`.
2. **Model availability** — either visit's inference didn't run (quality/
   OOD block, etc.) → `MODEL_UNAVAILABLE`. Critically, this state is
   distinct from — and never becomes — a negative finding: "the model
   didn't run" is not "nothing was found" (§14/§17's hard boundary,
   verified by test).
3. **Model identity** — a different `model_id`/`model_status` between
   visits → `MODEL_CHANGED`, no per-finding comparison attempted (§15's
   hard requirement — different model versions are never blindly
   compared).
4. **Device identity** — a different acquisition device (`manufacturer`+
   `model` from `StudyRecord.metadata`) → `DEVICE_CHANGED` (§16).

Only when all four checks pass does a real per-finding-type diff run:
`NEW_AI_FINDING`, `PERSISTENT_AI_FINDING`, or `NO_LONGER_OBSERVED` — the
last of which always carries an explicit note that it does **not**
establish resolution, only that the finding wasn't detected under
otherwise-comparable conditions (§17's hard rule, verified by test).

## 6. Symptom Trend Engine

`lib/evidence/symptomTrend.ts`'s `compareSymptoms(priorVisits, current)`
tracks `FIRST_REPORTED`, `PERSISTENT` (reported in the immediately
preceding visit and now), `RECURRENT` (reported in an earlier-but-not-
immediately-preceding visit and now), and `RESOLVED_OR_NOT_REPORTED` —
never phrased as "improved," since absence of a symptom report is not
proof of resolution. Explicitly does **not** infer disease progression
from symptom progression alone (§18).

## 7. Longitudinal conflicts

Rather than build a second, parallel conflict-detection system,
`buildLongitudinalSummary()` surfaces `CONFLICTED` measurement-trend
results (already computed above) into a flat `conflicts_across_timeline`
list. Cross-visit qualitative conflicts (e.g. a document later asserting
"IOP normal" when a verified earlier reading was elevated) are within the
scope of the existing evidence-conflict philosophy but are not separately
re-implemented this phase — `compareMeasurements()`'s per-pair conflict
detection is the real, tested mechanism.

## 8. `StructuredLongitudinalResult`

```
patient_ref, study_ids (verified chronological order), timeline,
pairwise_comparisons[] (one StructuredComparisonResult per consecutive
  visit pair — measurement_changes, finding_changes, non_comparable_reason),
symptom_trends[] (full timeline vs. most recent visit),
urgent_flags_current_visit[] (computed independently, see §9 below),
missing_prior_evidence (true when fewer than 2 studies exist),
conflicts_across_timeline[], limitations[], generated_at, engine_version,
requires_clinician_review: true (pinned at the type level)
```

## 9. Urgent symptom independence (§27, critical)

`buildLongitudinalSummary()`'s urgent-flag computation reads only the
current (most recent) visit's `StudyRecord.symptoms` through
`lib/clinical/symptoms.ts`'s `redFlagSymptoms()` — the exact same function
Phase 4's reasoning engine and the platform's actual triage system use. It
has **zero** dependency on `pairwise_comparisons`, prior-visit history, or
any trend classification. Verified end-to-end by test: a study with a
normal prior visit followed by a real `sudden_vision_loss` symptom at the
current visit still produces an `emergency` urgent flag — a calm history
never cancels current urgency.

## 10. Diagnosis gate preservation

`lib/models/diagnosisGate.ts` was not modified this phase (`git diff
--stat` confirms zero changes). The longitudinal engine never calls it and
never produces a field resembling a confirmed progression diagnosis —
verified by test that scans the full JSON output of a real longitudinal
result for `CLINICALLY_SIGNIFICANT_PROGRESSION: true` or diagnosis-
confirming language and finds none.

## 11. Security verification

Performed directly (subagents were not used this phase after repeated
org-wide API spend-limit failures on prior phases; the same scope was
completed directly rather than left undone):

- Cross-patient timeline mixing: refused with a thrown error, verified by
  test.
- Cross-eye comparison: refused (`NOT_COMPARABLE`), verified by test, at
  both the measurement and finding-comparison layers.
- Reordered/spoofed encounter ordering: the engine re-derives order from
  real stored timestamps, never trusts caller-supplied array order,
  verified by test.
- Model-version spoofing / device spoofing: both block comparison
  entirely rather than silently comparing incompatible outputs, verified
  by test.
- Malformed numeric values (`NaN`, `Infinity`): excluded before any
  comparison, verified by test.
- Malformed/future timestamps: does not crash the engine, verified by
  test.
- API authorization: the `/api/compare` and `/api/studies/{id}/record-analysis`
  routes require an authenticated ADMIN/CLINICIAN/REVIEWER plus patient/tenant
  scope before invoking the comparison engine.
- All four protected safety files (`diagnosisGate.ts`,
  `qualityPresentation.ts`, `terminology.ts`, `researchAnalysis.ts`) plus
  every Phase 3/4 module show zero diff from this phase's work.

## 12. Known limitations

- Only two visits are directly compared at a time
  (`compareVisits()`); `buildLongitudinalSummary()` chains consecutive
  pairs but does not attempt a multi-visit statistical trend line.
- No image-to-image pixel/registration comparison exists (§13) — only
  metadata-level comparability checks (eye/model/device). A genuine
  `IMAGE_COMPARISON_UNAVAILABLE` state was not separately implemented
  since no image registration capability exists to gate in the first
  place; the same effective outcome (no fabricated image progression) is
  achieved by the finding-comparison layer's own compatibility gates.
- The patient workspace and result review expose timeline/status data, while
  `compareVisits()` remains a deterministic evidence comparison rather than a
  validated progression tool.
- `conflicts_across_timeline` only surfaces measurement-level conflicts
  today, not a fully general cross-visit qualitative-evidence conflict
  detector.

## 13. Future progression-analysis boundary

`clinically_significant_progression: false` and the complete absence of
any `CLINICALLY_SIGNIFICANT_PROGRESSION` state anywhere in this codebase
are deliberate. A future, separately-validated clinical progression
methodology would need its own explicit gate (analogous to
`lib/models/diagnosisGate.ts`'s 7-condition gate) before any comparison
result could ever be presented as clinically meaningful progression
rather than a raw observed change. That gate does not exist and was not
built this phase.

## 14. Testing

`tests/phase5-longitudinal-intelligence.test.ts` — 24 tests covering
timeline ordering, cross-patient isolation, cross-eye isolation,
measurement comparison (including unit-mismatch and NaN/Infinity
adversarial cases), symptom trends, finding comparison (model-version,
device, and model-unavailable compatibility gates), missing-history
handling, urgent-symptom independence, diagnosis-gate preservation, and
an end-to-end real two-visit comparison. All 24 pass.
