# Ophthalmology Center Architecture — Phase 1 (historical design record)

> This document records the original Phase 1 boundary. The current worktree
> now includes the later document-extraction, longitudinal, authorization,
> specialist-consensus, and clinician-workspace layers described in
> [`docs/FINAL_PLATFORM_AUDIT.md`](FINAL_PLATFORM_AUDIT.md). The Phase 1
> limitations below are retained as historical context, not as a statement
> that those layers are still absent.

## Scope of this document

The full "AI Ophthalmology Center" master prompt describes an 8-phase,
multi-month product: 8+ clinical specialist domains, an LLM evidence-
synthesis reasoning layer, a medication safety engine, longitudinal
progression tracking, multi-specialist consensus, and a full clinician
workspace. **This session built Phase 1 only — architecture, not the full
vision** — per the user's own explicit choice (asked directly: "Phase 1
architecture only" and "don't build the LLM layer yet"). Every later phase
listed in the master prompt (§39, Phases 2-8) remains genuinely deferred,
not silently skipped.

## What Phase 1 actually is

Five new/extended modules, all additive, all `EXTEND` not `REWRITE` of the
existing S0-S13/final-phase architecture, all real and tested — no
placeholder logic pretending to be more than it is.

### 1. Patient Encounter model — `lib/patients/encounter.ts` (new)

The one genuine data-model gap the master prompt correctly identified:
this deployment had a `PatientSymptom[]` on each `StudyRecord` but nowhere
to record ocular/surgical/systemic/family history, current medications, or
allergies as structured data. `PatientEncounter` fills that gap:

- Every field is optional (§5's own rule — never force irrelevant data).
- Every history/medication/allergy entry is wrapped in
  `ProvenancedValue<T>`, carrying an explicit `DataProvenance` (§27's
  8-value vocabulary: `PATIENT_REPORTED` / `CLINICIAN_ENTERED` /
  `DEVICE_MEASURED` / `LAB_IMPORTED` / `DOCUMENT_EXTRACTED` / `AI_INFERRED`
  / `AI_DERIVED` / `VERIFIED_BY_CLINICIAN`) — there is no default, and
  `validateEncounterInput()` rejects a missing or invalid provenance value
  the same way the existing symptom validator rejects an unknown symptom
  type.
- `encounter_id` + `linked_study_ids` give one real place to link multiple
  studies/visits to the same patient over time — the data foundation
  Phase 5 (longitudinal analysis) will need, but Phase 1 does **not**
  implement any comparison/trend logic itself.
- Deliberately does **not** duplicate `PatientSymptom` — an encounter's
  `symptoms` field reuses the existing, already-validated
  `lib/clinical/symptoms.ts` vocabulary directly.

Not yet built: any API route, UI form, or database persistence for
`PatientEncounter` — this phase is the typed, validated, tested data model
only. Wiring it into `lib/studies/service.ts`'s storage layer and building
an intake UI are real, separate follow-on work.

### 2. Evidence graph extension — `lib/evidence/types.ts` + `lib/evidence/adapters.ts` (extended)

`EvidenceSourceType` already had `HISTORY` and had it marked "reserved: no
structured clinical-history store exists yet" — Phase 1 makes that literally
true by adding the store, then adds two new source types
(`MEDICATION`, `ALLERGY`) and three new adapter functions
(`evidenceFromOcularHistory`, `evidenceFromMedications`,
`evidenceFromAllergies`), following the *exact* pattern
`evidenceFromTestResults`/`evidenceFromSymptoms` already established: pure,
deterministic, never inventing a laterality/value/date the source didn't
have. `trustFromEncounterProvenance()` is the one place a `DataProvenance`
becomes an `EvidenceTrustLevel` — `AI_INFERRED`/`AI_DERIVED` history can
never map to `HUMAN_VERIFIED`, only `CLINICIAN_ENTERED`/
`VERIFIED_BY_CLINICIAN` can, tested explicitly.

`PDF` (whole-document evidence) and `CLINICIAN_OBSERVATION` remain
reserved/unpopulated — genuinely out of scope this phase, no clinician-
direct-observation UI exists.

### 3. Specialist registry — `lib/clinical/specialistRegistry.ts` (new, documentation-only)

The master prompt's §3 lists 8 specialist domains plus Comprehensive
Ophthalmology. This registry declares all 9, each with a real
`scope_description` and `condition_areas` list taken directly from the
master prompt's own text — but **every single entry's `status` is
`"NO_VALIDATED_MODEL_AVAILABLE"`**, because that is genuinely true: this
deployment has exactly one real model (the SegFormer optic-disc/cup
segmentation research model), and it is not attached to any specialty
here. `routeToSpecialties(modality)` implements §9's router concept
honestly — it tells you which specialties a modality *would* route to,
always with `available: false`. This module contains **zero** executable
model logic and is not imported by `lib/analysis/pipeline.ts` or
`lib/evidence/researchAnalysis.ts` — adding an entry here can never be
mistaken for adding a working model. Pediatric Ophthalmology is explicitly
flagged `requires_population_specific_validation: true`, per the master
prompt's own instruction not to imply pediatric applicability without
validated pediatric-population evidence.

### 4. Etiology Hypothesis Engine — `lib/evidence/etiology.ts` (new, pure reframing)

§12 asked for an engine that outputs "possible causes / why considered /
evidence for / evidence against / missing information" rather than
asserting causation. Investigating the existing S5 evidence architecture
found that `lib/evidence/synthesize.ts`'s `assessConditions()` **already
computes** almost exactly this shape (`ConditionAssessment` already has
`supporting_evidence_ids`, `contradicting_evidence_ids`, `missing_required`,
`differential_relationships`). `summarizeEtiology()` is therefore a **thin,
pure reframing** of already-computed, already-gated data into §12's exact
vocabulary — it introduces no new clinical decision logic. `POSSIBLE_
CONDITION`/`SUPPORTED_CONDITION`/`CONFLICTING_EVIDENCE` assessments become
hypotheses; `INSUFFICIENT_EVIDENCE`/`UNABLE_TO_ASSESS` are correctly
*omitted* (they are the absence of a hypothesis, not one). Every hypothesis
carries `etiology_established: false` — the field exists (not omitted) so
a future, genuinely validated pathway has a real, separately-gated place
to eventually set it `true`, but nothing in this deployment can do that
today. `etiologyCannotBeEstablished()` returns `true` for essentially
every real study this deployment can produce, which is the *correct*
default per §12's own worked example.

### 5. Medication-allergy cross-check — `lib/treatment/allergySafety.ts` (new, extends the existing empty-by-design medication registry)

`lib/treatment/medications.ts`'s `MedicationRecord`/`MEDICATIONS` registry
already existed (built in an earlier phase) with exactly the honesty
discipline §13-15 asks for: intentionally empty, evidence-required,
jurisdiction-aware. The one real gap was §14's allergy check — there was
nowhere to record what a patient is allergic to, and no function to check
a medication against it. `checkMedicationAgainstAllergies()` performs the
one honest check this deployment actually can (case-insensitive text
match against `genericName`/`brandNames`/`drugClass`) and explicitly
**never claims safety** — its three states are `NO_ALLERGIES_RECORDED`,
`POSSIBLE_MATCH` (requires clinician review), and
`NO_MATCH_FOUND_NOT_CONFIRMED_SAFE` — deliberately not "safe", because
this deployment has no cross-reactivity database and a text-match miss is
not evidence of safety.

### Two new red-flag symptoms

`lib/clinical/symptoms.ts` gained `chemical_exposure` and
`severe_pain_with_nausea` (both `red_flag: true, urgency: "emergency"`) —
the two urgent patterns from §6 (chemical injury; severe pain + nausea,
the classic angle-closure-glaucoma presentation) that weren't already
covered by the existing vocabulary (sudden vision loss, curtain/shadow,
flashes+field loss, trauma+vision-loss were already present). Wired into
`app/analyze/page.tsx`'s symptom-chip UI so the feature is genuinely
usable, not half-wired.

## What Phase 1 explicitly does NOT include

- **No LLM/external-AI-API integration of any kind.** The user explicitly
  chose not to build this yet. §10's "LLM Reasoning Layer" remains
  unimplemented; §32's PHI-to-external-provider concern is therefore moot
  for this phase — nothing sends any data anywhere new.
- **No real specialist models.** Zero weights downloaded, `data/models/`
  untouched (still empty), no candidate-model dossier work done this
  phase (§41's dossier format is documented above for future use, but no
  dossiers were written).
- **No patient-intake UI, no API routes, no database wiring** for
  `PatientEncounter` — types and validation only.
- **No longitudinal comparison logic** (Phase 5) — only the
  `linked_study_ids` field exists as a future foundation.
- **No multi-specialist consensus UI** (Phase 3/17) — the specialist
  registry is data, not a workspace.
- **No conflict engine, no calibrated-probability display** (Phase 4/18) —
  unchanged from the existing, already-correct S5 evidence-conflict
  detection.
- **No new imaging modalities** (`VISUAL_FIELD`, `IOP`, `PACHYMETRY`, etc.
  from §7's list) were added to `lib/models/modalities.ts`. Investigation
  found these are, correctly, **not image modalities** in this
  architecture — `IOP`/visual acuity/etc. are already structured
  `TEST_RESULT` types (S3/S4), and forcing them into the image-modality
  vocabulary would conflate two deliberately-separate domains. This is a
  documented architectural decision, not an oversight.

## Existing safety gates — verified untouched

`lib/models/diagnosisGate.ts`, `lib/analysis/qualityPresentation.ts`,
`lib/reports/terminology.ts`, `lib/evidence/researchAnalysis.ts` — none
were modified this phase (confirmed by `git diff` scope: only the five new
files plus two extended files listed above, plus two symptom-vocabulary
additions and one stale-comment fix). The 7-condition diagnosis gate is
unchanged. No new code path reaches `runPipeline()` or
`researchAnalysis.ts`.

## Testing

`tests/ophthalmology-center-phase1.test.ts` — 22 real tests, including
explicit red-team coverage: AI-derived history can never become
`HUMAN_VERIFIED` trust; the specialist registry can never report
`available: true`; no specialty entry contains a model id, weights path,
or inference function; the etiology engine never sets
`etiology_established: true` even for a `SUPPORTED_CONDITION` input;
medication-allergy checking never returns a bare "safe" status; the two
new red-flag symptoms correctly force `emergency` urgency. All existing
tests (`tests/symptoms.test.ts`, `tests/s5-evidence-critical.test.ts`,
`tests/s5-evidence-synthesis.test.ts`) re-run clean with zero regressions.

## Candidate model report format (§41, for future phases — not used this phase)

For any future model integration, a candidate report must specify:
`MODEL`, `TASK`, `MODALITY`, `DATASET`, `LICENSE`, `VALIDATION`,
`POPULATION`, `DEVICE`, `KNOWN LIMITATIONS`, `INFERENCE REQUIREMENTS`,
`CLINICAL STATUS`, `RESEARCH STATUS` — matching the existing
`CandidateModelDossier` shape in `lib/models/candidateDossiers.ts` (built
in an earlier phase, S8). No new dossiers were researched or written this
phase; this section only confirms the format is already real and ready.

## Deferred phases (§39), explicitly not started

- **Phase 2** — Multi-modal ingestion (fundus/OCT/reports/measurements/
  symptoms end-to-end intake flow using the new encounter model).
- **Phase 3** — Specialist orchestration (an actual router calling real
  models — impossible until real, validated specialist models exist).
- **Phase 4** — Evidence synthesis beyond what S5 already does (conflict
  engine enhancements, calibrated-probability display once a calibrated
  model exists).
- **Phase 5** — Longitudinal comparison (stable/improving/worsening
  logic across visits).
- **Phase 6** — The LLM reasoning layer (explicitly deferred by user
  choice this session).
- **Phase 7** — Clinician workspace UI built around the new encounter
  model.
- **Phase 8** — Validation infrastructure for any future specialist
  model.

Each is independently substantial. Per this session's established
discipline, a future session should pick one, scope it explicitly, and
build it with the same test-backed rigor as Phase 1 — not attempt several
shallowly.
