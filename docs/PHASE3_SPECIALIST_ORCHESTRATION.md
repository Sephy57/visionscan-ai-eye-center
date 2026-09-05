# Phase 3 — Multi-Specialist AI Orchestration

## Scope

This phase built the ROUTING and ORCHESTRATION infrastructure for
multi-specialist evidence handling. It does **not** create an autonomous
AI ophthalmologist, does **not** add an LLM, does **not** claim clinical
validation for anything, and does **not** produce a "giant model." It
extends Phase 1's specialist registry with per-capability metadata, a
deterministic router, structured output contracts, and an orchestrator
that ties them to the one real model this deployment has — through the
same unmodified, fail-closed research path every other consumer of that
model already uses.

## A note on "Phase 2"

The master prompt for this phase assumed "Phase 2 (multimodal evidence
ingestion)" was already complete as a discrete deliverable. That is not
literally true — no session built a module named "Phase 2." What *is*
true is that every one of Phase 2's stated requirements was already
satisfied by pre-existing infrastructure, built across S0-S13 and this
session's own Phase 1:

| Phase 2 requirement | Where it already lives |
|---|---|
| Modality registry | `lib/models/modalities.ts` |
| Quality gates | `lib/imaging/quality.ts` |
| OOD/suitability | `lib/analysis/ood.ts`, `lib/analysis/imageSuitability.ts` |
| Normalized evidence | `lib/evidence/types.ts`'s `EvidenceItem` |
| Provenance | `lib/patients/encounter.ts`'s `DataProvenance` (Phase 1) + `EvidenceProvenance` |
| Laterality | `lib/evidence/laterality.ts` |
| Measurement structures | S3/S4 `TestResult` |
| Conflict handling | `lib/evidence/conflicts.ts` |
| Secure ingestion | `lib/documents/`, `lib/storage/files.ts` (S1-S4) |

This is documented here so a future session doesn't waste effort
rebuilding something that already exists under different naming, and so
nobody mistakes the absence of a file literally named "phase2.ts" for a
missing capability.

## Architecture

```
CLINICAL EVIDENCE
   ↓
MODALITY / QUALITY GATES              (pre-existing: lib/imaging/quality.ts, lib/analysis/ood.ts)
   ↓
SPECIALIST ROUTER                     (new: lib/clinical/specialistRouter.ts)
   ↓
MODEL CAPABILITY REGISTRY             (new: lib/clinical/specialistCapabilities.ts)
   ↓
APPROPRIATE MODEL(S)                  (unchanged: lib/evidence/researchAnalysis.ts, exactly one real model)
   ↓
RAW MODEL OUTPUT                      (unchanged: lib/models/outputContract.ts)
   ↓
VALIDATION / SCHEMA CHECK             (unchanged, S13-hardened)
   ↓
OOD / COMPATIBILITY GATES             (unchanged, S13-wired)
   ↓
NORMALIZED AI FINDING                 (unchanged: Finding, lib/analysis/schema.ts)
   ↓
UNCERTAINTY                           (new field on SpecialistAnalysisResult)
   ↓
EVIDENCE GRAPH                        (unchanged: lib/evidence/synthesize.ts, extended in Phase 1)
   ↓
CLINICIAN REVIEW                      (requires_clinician_review: true, always)
```

Every existing safety gate in this pipeline is **unmodified** by Phase 3.
The orchestrator (`lib/clinical/specialistOrchestrator.ts`) calls
`runResearchAnalysis()` (`lib/evidence/researchAnalysis.ts`) exactly as it
already existed — it does not duplicate, reimplement, or weaken its
quality/OOD/fail-closed logic. `git diff --stat` against
`lib/models/diagnosisGate.ts`, `lib/analysis/qualityPresentation.ts`,
`lib/reports/terminology.ts`, and `lib/evidence/researchAnalysis.ts`
confirms zero changes this phase.

## New modules

### `lib/clinical/specialistCapabilities.ts` — Capability registry (§3-4)

Extends Phase 1's specialty-level `SPECIALTY_REGISTRY` with
per-capability metadata: supported modalities, intended use, population
scope, device scope, model id/version/status, calibration status, OOD
support, required quality level, license, source, known limitations, and
a **computed** `may_execute` boolean. Reuses `ModelStatus` from
`lib/models/registry.ts` (`DEMO | RESEARCH | INTERNAL_VALIDATION |
EXTERNALLY_VALIDATED | CLINICALLY_VALIDATED | RETIRED`) rather than
inventing a second, parallel lifecycle vocabulary — one lifecycle system,
not two competing ones.

Every specialty gets at least one capability entry (13 total across 9
specialties). Exactly **one** has `may_execute: true`:
`RETINA` / `optic_disc_cup_segmentation`, backed by the real SegFormer
research model. Its `registered_in_model_registry` is `false` — it is
not, and must not become, part of `lib/models/registry.ts`'s production
`MODELS` map (the deliberate clinical isolation established in S9).

### `lib/clinical/specialistRouter.ts` — Deterministic router (§8-11)

`routeSpecialists({ modality, symptoms, quality? })` is a pure function:
same input always produces the same output, no randomness, no I/O. It
canonicalizes the input modality via the existing `canonicalModality()`
(a real bug — case-sensitive exact-match against raw un-canonicalized
strings — was caught by this phase's own tests and fixed before this
document was written). Modality match and symptom-pattern match are
**additive but modality-scoped for execution**: a symptom can make a
specialty *relevant* even without a modality match (e.g. `double_vision`
routes to `NEURO_OPHTHALMOLOGY` regardless of image type), but a
capability is only ever reported *executable* for an input whose
canonical modality is actually in that capability's own
`supported_modalities` — a second real bug (symptom-only relevance
incorrectly marking a FUNDUS-only capability "executable" for a
SLIT_LAMP study) was also caught by testing and fixed.

Urgent-symptom triage (`lib/clinical/triage.ts`) is completely
independent of this router — the router has no ability to read or
influence triage output, verified by a real end-to-end test
(`tests/phase3-specialist-orchestration.test.ts`'s "U" suite).

### `lib/models/specialistOutputTypes.ts` — Output contracts (§5-7, §18, §23, §24, §35)

- `SpecialistAnalysisResult` — the structured per-specialty result shape.
  `requires_clinician_review` is typed as the literal `true` — it cannot
  be `false` at the type level, not just by convention.
- `SpecialistFailureState` — 10 explicit failure states
  (`MODEL_UNAVAILABLE`, `MODEL_TIMEOUT`, `MODEL_INPUT_UNSUPPORTED`,
  `MODEL_OUTPUT_INVALID`, `MODEL_INTEGRITY_FAILURE`,
  `MODEL_NOT_VALIDATED`, `QUALITY_FAILED`, `OOD_REJECTED`,
  `DEVICE_UNSUPPORTED`, `NO_VALIDATED_MODEL_AVAILABLE`), each with a
  fixed, non-injectable copy string. A model failure is never converted
  into "no disease detected" — verified by tests that these remain
  distinct from `NO_TARGET_FINDING_DETECTED`.
- `ModelDisagreement` — explicit disagreement representation; the type
  itself requires `requires_clinician_review: true`. Not yet exercised by
  any real code path, since this deployment has exactly one executable
  model (no possibility of two models disagreeing today) — the type
  exists as ready infrastructure for when a second model is ever added.
- `ModelProvider` and `ReasoningEngine` — type-only interfaces (§5, §24).
  **Zero implementations exist anywhere in `lib/` or `app/`**, confirmed
  by a repo-wide scan for a class declaring conformance to
  `ReasoningEngine`. `ReasoningEngine.synthesize()`'s return type is
  `Promise<never>` — deliberately unimplementable, a type-level assertion
  that nothing may implement it yet. No LLM/external-AI SDK import
  appears in any Phase 3 file, confirmed by test.

### `lib/clinical/specialistOrchestrator.ts` — Orchestrator

`orchestrateSpecialistAnalysis(studyId, modality, symptoms)`: routes,
then for each relevant specialty either returns
`NO_VALIDATED_MODEL_AVAILABLE` immediately (8 of 9 specialties, always)
or — for RETINA's one executable capability only — calls the existing,
unmodified `runResearchAnalysis(studyId)` and wraps its result. Note that
`runResearchAnalysis()` takes only the `studyId` and independently
re-derives modality/quality/OOD from the actual stored study record and
image bytes — it does **not** trust the `modality` string the caller
passed to the orchestrator for anything except routing/relevance
decisions upstream of it. A caller cannot make the real inference path
believe a study is a different modality or quality than it actually is
by lying to the orchestrator's `modality` parameter.

Failure isolation (§34/§35): each specialty's execution is wrapped in its
own `try/catch` inside the loop — one specialty's exception becomes that
specialty's own `MODEL_UNAVAILABLE` result, never an unhandled throw that
would prevent the other 8 specialties from reporting.

## Specialist capability table

| SPECIALIST | CAPABILITIES | MODELS | VALIDATION | STATUS |
|---|---|---|---|---|
| COMPREHENSIVE_OPHTHALMOLOGY | 1 (general) | none | — | NO_VALIDATED_MODEL_AVAILABLE |
| RETINA | 2 (optic_disc_cup_segmentation, diabetic_retinopathy_screening) | 1 real (SegFormer, research-only) + 1 none | RESEARCH (zero published external validation) | 1 capability executable (research-only); 1 NO_VALIDATED_MODEL_AVAILABLE |
| GLAUCOMA | 1 (cup_disc_ratio_assessment) | none | — | NO_VALIDATED_MODEL_AVAILABLE (segmentation exists under RETINA but produces no calibrated cup-to-disc ratio) |
| CORNEA_EXTERNAL_DISEASE | 1 (general) | none | — | NO_VALIDATED_MODEL_AVAILABLE |
| CATARACT_LENS | 1 (general) | none | — | NO_VALIDATED_MODEL_AVAILABLE |
| NEURO_OPHTHALMOLOGY | 1 (general) | none | — | NO_VALIDATED_MODEL_AVAILABLE |
| PEDIATRIC_OPHTHALMOLOGY | 1 (general) | none | — | NO_VALIDATED_MODEL_AVAILABLE; also flagged `requires_population_specific_validation` |
| UVEITIS_INFLAMMATION | 1 (general) | none | — | NO_VALIDATED_MODEL_AVAILABLE |
| OCULAR_ONCOLOGY | 1 (general) | none | — | NO_VALIDATED_MODEL_AVAILABLE; flagged as requiring more conservative gating than default if ever integrated |

**No performance metrics (sensitivity/specificity/AUC/accuracy) are
listed anywhere in this table or the codebase for any capability**,
because none have been measured for any intended use this deployment
declares. Manufacturing one would violate this project's entire
honesty discipline.

## Security / red-team verification

Verified directly against the real code (not merely read):

1. **Client-supplied field spoofing** — a `PatientSymptom[]` array with
   smuggled `specialist_override`/`model_status`/`validation_status`
   fields passed to `orchestrateSpecialistAnalysis()` has zero effect on
   the result (test-verified).
2. **Cross-study/modality-claim mismatch** — the real inference path
   (`runResearchAnalysis`) re-derives modality/quality from the actual
   stored study, ignoring whatever the orchestrator's caller claimed.
3. **Malformed model output** (`Infinity`/`NaN`/out-of-range
   coordinates) — rejected by `validateRawModelOutput()`, confirmed by
   direct test.
4. **Unauthorized capability fabrication** — `getCapability()` returns
   `null` for any nonexistent id; `may_execute` is `true` for exactly one
   entry in the entire static array, confirmed by direct inspection and
   test (`executableCapabilities().length === 1`).
5. **Stale/inconsistent model metadata** — the one real capability's
   `model_status: "RESEARCH"` matches `docs/S9_REAL_MODEL_INTEGRATION.md`'s
   own "zero published validation evidence" claim.
6. **Diagnosis-gate bypass** — `lib/clinical/specialistOrchestrator.ts`
   never imports or calls `canDisplayDiagnosis()`; `validation_status` is
   only ever assigned `"NOT_VALIDATED"` or `"RESEARCH_ONLY"` in the real
   code, never `"CLINICALLY_VALIDATED"`/`"EXTERNALLY_VALIDATED"`,
   confirmed by grepping every assignment site.
7. **API-layer exposure** — zero routes in `app/api/` import any Phase 3
   module; this architecture is not yet reachable from any HTTP endpoint.

Two real bugs (not security vulnerabilities, but real correctness gaps
that could have caused incorrect routing) were found by this phase's own
test suite before this document was written, and fixed: (a) the router's
modality matching was case-sensitive against raw strings instead of using
the existing canonicalization function; (b) a specialty made relevant
purely by symptom match could incorrectly report an unrelated capability
as "executable" for a modality that capability doesn't actually support.

## What Phase 3 explicitly does NOT include

- **No LLM, no external AI API of any kind.** Confirmed by test (no
  SDK import in any Phase 3 file) and by `ReasoningEngine` having zero
  implementations anywhere.
- **No API route** exposing this orchestrator to the frontend or any
  HTTP caller. This is backend architecture only.
- **No multi-model ensembling logic** (§17) — the type
  (`ModelDisagreement`) exists but has no real caller, since there is
  only one executable model in this deployment.
- **No new model downloads.** `data/models/` is untouched, confirmed
  empty.
- **No promotion of the SegFormer model's status.** It remains
  `RESEARCH`, unregistered in the production registry, exactly as S9-S13
  left it.
- **No medication recommendations, prescriptions, or dosing** — Phase 1's
  allergy cross-check remains purely informational; nothing here changes
  that.

## Testing

`tests/phase3-specialist-orchestration.test.ts` — 30 tests covering
checklist items A through W (specialist registry, capability registry,
model lifecycle, deterministic/symptom/modality routing, quality/OOD
gating through the real research path, device compatibility, intended-use
matching, model integrity/output-schema rejection of malformed data,
localization bounds, model disagreement typing, multi-specialty routing,
provenance, clinician-review boundary, diagnosis-gate preservation, urgent
symptom independence, and client-side spoof resistance) plus a static
no-LLM check. All 30 pass, including several that exercise the real
SegFormer artifact end-to-end (this environment has the artifact present)
rather than being skipped.

## Deferred (not started this phase)

- Wiring the orchestrator into an actual API route / UI surface (§33's
  minimal dev/research view was not built this pass — scope was
  backend architecture only, per the master prompt's own emphasis on
  "infrastructure for routing," not a finished UI).
- Any second real specialist model/capability.
- Multi-model ensemble aggregation logic (only the disagreement type
  exists).
- Phase 4+ (evidence synthesis beyond Phase 1, longitudinal comparison,
  the LLM reasoning layer, clinician workspace, validation
  infrastructure).
