# Multimodal Evidence Synthesis (S5)

> **Status: S5 IMPLEMENTED — a read-only layer that aggregates S3/S4 test
> results, patient symptoms, document-extracted history/diagnoses/negations,
> clinician observations, and image-analysis Findings into one comparable,
> provenance-linked view, with cross-source conflict detection and a
> non-clinical, presence-based condition-pattern assessment.**
> **NOT A MEDICAL DEVICE. NOT CLINICALLY VALIDATED. NOT FOR CLINICAL USE.**
> **This layer produces evidence ORGANIZATION and ASSOCIATIONS only — never a
> diagnosis, never a probability, never a percentage. `possible_conditions`
> entries are labeled patterns for human review, not clinical conclusions.**
> Reference: `lib/evidence/types.ts`, `laterality.ts`, `adapters.ts`,
> `conflicts.ts`, `conditionTaxonomy.ts`, `synthesize.ts` →
> `GET /api/studies/{id}/evidence`.

S5 answers one question: *"of everything already recorded about this study
across the study, document, encounter, and analysis stores, what evidence
exists, does any of it disagree, and which non-clinical evidence patterns does
it resemble?"* It does not decide what any of it means clinically. The
read-only record-analysis package consumes this workspace for clinician
review, but it never feeds evidence back into model inference or an autonomous
diagnosis.

## 1. Evidence architecture

Every source is turned into the same shape, `EvidenceItem`
(`lib/evidence/types.ts`):

| Field | Meaning |
|---|---|
| `source_type` | `TEST_RESULT` \| `SYMPTOM` \| `AI_FINDING` \| `IMAGE` \| `PDF` \| `HISTORY` \| `CLINICIAN_OBSERVATION` |
| `source_id` | opaque id of the originating record |
| `category` | source-specific vocabulary: a `TestType`, a symptom type, or a `Finding` type |
| `laterality` / `laterality_source` | canonical `OD`/`OS`/`OU`/`UNKNOWN`, plus how it got there (§5) |
| `value` / `unit` / `qualitative_finding` | numeric or non-numeric characterization, copied — never invented |
| `presence` | `PRESENT` \| `NOT_REPORTED` \| `ABSENT` \| `UNKNOWN` (§4) |
| `trust_level` | 6-state enum (§3) |
| `confidence` / `uncertainty` | carried over from the source only, never fabricated |
| `provenance` | back-pointer to the exact source record/document/page/text (§9) |
| `conflict_ids` | filled in after conflict detection |

The pure, deterministic adapters in `lib/evidence/adapters.ts` read existing
sources and never invent a value, unit, laterality, or date that wasn't
already on the source record:

- **`evidenceFromTestResults(results: TestResult[])`** — reads S3/S4
  `TestResult` records. If a result was `CORRECTED`, the evidence item
  reflects the human correction (value/unit/laterality), but the original
  extraction is untouched and `provenance.result_id` still points at the one
  record holding both.
- **`evidenceFromSymptoms(studyId, symptoms: PatientSymptom[])`** — reads
  Phase-3 structured patient-reported symptoms from `study.symptoms`.
- **`evidenceFromFindings(studyId, studyEye, findings: Finding[])`** — reads
  the image-analysis pipeline's `Finding[]` from the study's `AnalysisRecord`.
- **Document/encounter adapters** — carry document-extracted symptoms,
  negations, diagnoses, medications/allergies, ocular/family history, and
  exam text into the workspace as `AUTO_EXTRACTED`/`UNVERIFIED`; clinician
  observations are additive `CLINICIAN_ENTERED` evidence linked to the report.

**This is a strictly read-only layer.** There is no write path from S5 back
into `test_results`, `study.symptoms`, or `AnalysisRecord`. The core
`analyzeStudy()`/`runPipeline()` model path, triage, treatment, and report
generation do not consume S5 to produce a diagnosis. The separate
`analyzeRecord()` composition reads it as a clinician-review package only.

## 2. Read paths, not writes

| Adapter | Reads | Never writes to |
|---|---|---|
| `evidenceFromTestResults` | `test_results` collection (S3/S4) | `test_results`, `verification_history` |
| `evidenceFromSymptoms` | `study.symptoms` (Phase 3) | `study.symptoms` |
| `evidenceFromFindings` | `AnalysisRecord.result.findings` | `analyses` |

Verification and correction of a `TestResult` still happen exclusively
through the existing S4 endpoint (`POST /api/results/{resultId}/verify`).
S5 only reads the resulting `verification.status` — it has no verify/correct/
reject action of its own (§11).

## 3. Trust levels

`EvidenceTrustLevel` (`lib/evidence/types.ts`):

| Level | Meaning | Produced by |
|---|---|---|
| `UNVERIFIED` | self-reported symptom, or an unreviewed/`UNREVIEWED` extraction | symptoms adapter (always); test-result adapter for `UNREVIEWED` |
| `AUTO_EXTRACTED` | machine output, never seen by a human | test-result adapter for `AUTO_EXTRACTED` (S3 initial state) |
| `HUMAN_VERIFIED` | a clinician/reviewer confirmed or corrected the value | test-result adapter for `VERIFIED`/`CORRECTED` |
| `CLINICIAN_ENTERED` | a clinician directly entered the observation | clinician review workspace (additive observation; original AI output is preserved) |
| `VALIDATED_AI_FINDING` | an AI finding from a model with `EXTERNALLY_VALIDATED`/`CLINICALLY_VALIDATED` status | reserved — this deployment's demo model never reaches that status, so no `AI_FINDING` evidence is ever produced at this level |
| `REJECTED` | a human determined the evidence cannot be trusted | test-result adapter for `REJECTED` |

`REJECTED` evidence is **retained** in `EvidenceWorkspace.evidence` for
display/audit, but is unconditionally excluded from both conflict detection
(`detectConflicts` filters `trust_level !== "REJECTED"` before doing
anything else) and condition assessment (`assessConditions` applies the same
filter). `UNVERIFIED` and `AUTO_EXTRACTED` evidence can be *displayed* and
can contribute to a `POSSIBLE_CONDITION` state, but can never alone drive a
`SUPPORTED_CONDITION` state — see §8's trust gate
(`TRUSTED_FOR_SUPPORT = {HUMAN_VERIFIED, CLINICIAN_ENTERED,
VALIDATED_AI_FINDING}`).

## 4. Symptom model & presence semantics

`PresenceState` distinguishes three different things a source can say:

- **`NOT_REPORTED`** — the source never mentioned this at all. In practice
  this is implicit: a `PatientSymptom` record exists only for types that
  *were* reported, so an un-reported type simply has no evidence item —
  it is never coerced into an explicit `ABSENT` item.
- **`ABSENT`** — the source explicitly recorded a denial ("patient denies
  X"). Document extraction emits it for explicit negation language; it is
  retained as negative evidence and never converted into a positive symptom.
- **`UNKNOWN`** — reserved similarly (also used by the test-result adapter
  when a value is undefined).
- **`PRESENT`** — the only state the symptoms and findings adapters
  currently produce (a symptom/finding record's mere existence means it was
  reported/detected).

## 5. Laterality handling

Two source vocabularies coexist in this codebase and are **not
interchangeable** (`lib/evidence/laterality.ts`):

- `TestResult.laterality`: `"OD" | "OS" | "OU" | "UNKNOWN"` — explicit
  document tokens (S3).
- `PatientSymptom.laterality`: `"right" | "left" | "both" | "unknown"` —
  patient-facing wording.

Three explicit, named mapping functions, each reading only its own
vocabulary — never inferring from context:

```ts
lateralityFromTestResult(l)     // passthrough — already canonical
lateralityFromSymptomReport(l)  // right→OD, left→OS, both→OU, unknown→UNKNOWN
lateralityFromStudyEye(eye)     // study's declared eye (OD/OS) → canonical; else UNKNOWN
```

`laterality_source` records which mapping produced a value
(`explicit` / `mapped_from_symptom_report` / `study_level` / `unknown`), so a
reviewer can see that a symptom-derived `OD` is a *wording translation of
what the patient reported*, not an explicit clinical token — a weaker
evidentiary claim than a document's `OD`.

**Hard rule (never violated): different-eye evidence from different sources
is never combined.** The concrete example from the S5 authorization: an
`OD` `IOP` result and an `OS` symptom report must never be associated —
"IOP OD elevated" and "blurred vision OS" are two separate, unrelated
pieces of evidence, not a conflict and not corroboration of each other.

This is enforced by **per-eye assessment**, not by a runtime filter alone.
`assessConditions` (`lib/evidence/synthesize.ts`) calls `assessOne` once per
eye for every `per_eye` condition definition (`for (const lat of ["OD",
"OS"])`), and the `matches()` helper inside it only lets an evidence item
count toward a given eye's assessment when
`i.laterality === laterality || i.laterality === "OU"` — an `OU` item counts
toward both eyes' assessments (it explicitly applies to both), but an `OD`
item can never contribute to the `OS` assessment or vice versa. Conflict
detection applies the same discipline: `detectConflicts` groups by
`category|laterality`, so items with different laterality never land in the
same group and are never flagged as conflicting with each other.

## 6. Conflict handling

`detectConflicts` (`lib/evidence/conflicts.ts`) is deterministic and
presence-based. `REJECTED` evidence never participates. Three conflict
types:

| Type | Trigger |
|---|---|
| `VALUE_CONFLICT` | ≥2 trusted items share `category + laterality` (laterality must be known) but have distinct numeric `value`s |
| `LATERALITY_CONFLICT` | a single item carries S3's own `contradictory_laterality` uncertainty flag — propagated from one source's internal contradiction, never inferred across sources |
| `QUALITATIVE_CONFLICT` | ≥2 trusted items share `category + laterality`, come from ≥2 distinct `source_type`s, and report distinct `qualitative_finding` labels |

**Conflicts are never auto-resolved.** There is no "pick newest," no "pick
highest/lowest," no averaging, and no AI-selected "best" value — every
conflict is created with `resolution_state: "UNRESOLVED"` and a `note`
explicitly stating that human resolution is required. `attachConflictIds`
only stamps each implicated item's `conflict_ids`; it changes nothing about
the evidence itself.

## 7. The non-clinical condition taxonomy

`lib/evidence/conditionTaxonomy.ts` is deliberately structurally separate
from `lib/clinical/conditions.ts`. The clinical file gates any real
condition output on (1) an installed model that explicitly supports the
condition, (2) an appropriate modality, (3) documented validation evidence,
(4) validated-input scope, and (5) safety-layer approval — and in this
deployment the demo model supports none of them, so nothing from that file
is ever surfaced as a clinical association.

The evidence taxonomy exists for a different purpose: to exercise the
evidence-synthesis architecture end to end. Every matcher is
**presence-based** — "does evidence of this category exist for this source
type" — and deliberately contains **no numeric clinical threshold** (e.g.
never "IOP > 21 mmHg = elevated"). Encoding a cutoff here would be inventing
a medical reference range in disguise. It is versioned independently as
`EVIDENCE_TAXONOMY_VERSION` (currently `"evidence-taxonomy-0.1.0-non-clinical"`),
stamped onto every `ConditionAssessment.taxonomy_version` and onto
`EvidenceWorkspace.taxonomy_version`.

Each `EvidenceConditionDef` declares: `required_evidence` /
`supportive_evidence` / `contradictory_evidence` (each a list of
`{source_type, category}` matchers), `laterality_behavior`
(`per_eye`/`whole_patient`), `differential_relationships`, `red_flags`
(symptom types that, if present, are surfaced as red-flag *candidates* —
never an emergency diagnosis), and
`evidence_thresholds.min_independent_supportive_for_supported`.

## 8. Condition assessment states

`assessOne` (`lib/evidence/synthesize.ts`) produces exactly one of five
states per `ConditionAssessment`:

| State | Meaning |
|---|---|
| `UNABLE_TO_ASSESS` | the definition's `required_evidence` isn't present for this eye — no assessment possible |
| `INSUFFICIENT_EVIDENCE` | required evidence present (or none required) but no supportive/required matches at all |
| `CONFLICTING_EVIDENCE` | both positive (required+supportive) and `contradictory_evidence` matches are present — never resolved automatically |
| `POSSIBLE_CONDITION` | positive matches exist but fail the trust/independence gate below |
| `SUPPORTED_CONDITION` | positive matches exist, at least one is `TRUSTED_FOR_SUPPORT` (`HUMAN_VERIFIED`/`CLINICIAN_ENTERED`/`VALIDATED_AI_FINDING`), **and** the number of distinct `source_type`s among positive matches meets `min_independent_supportive_for_supported` |

There are **no disease probabilities or percentages anywhere** in this
output — every field is a discrete state, an evidence-id list, or free text.
`CONFIRMED_DIAGNOSIS` is not a value in `ConditionAssessmentState` and is
never a possible output of this layer under any input.

For `per_eye` conditions, `assessConditions` calls `assessOne` once for
`"OD"` and once for `"OS"`, producing two independent `ConditionAssessment`
records; `whole_patient` conditions produce a single record with laterality
`"OU"`.

## 9. Provenance & explainability

Every `EvidenceItem.provenance` (`EvidenceProvenance`) carries whichever of
these fields its source can supply: `study_id`, `document_id`, `result_id`,
`page`, `source_text`, `analysis_id`, `finding_id`, `extraction_method`.
Test-result evidence carries the full S3 chain (`document_id`, `page`,
`source_text`, `extraction_method`) inherited unchanged from the
`TestResult` record; symptom evidence carries only `study_id` (there is no
document behind a patient-reported symptom); finding evidence carries
`analysis_id` and `finding_id`.

A reviewer can trace any `ConditionAssessment.supporting_evidence_ids` /
`contradicting_evidence_ids` to specific `EvidenceItem`s in
`EvidenceWorkspace.evidence` by id, and from each item's `provenance` back to
the originating document/page/source-text snippet (test results — the same
provenance chain S4's `DocumentEvidencePanel.tsx` already surfaces), or to
the symptom/finding origin it came from. `EvidenceConflict.evidence_ids`
provides the same trace for a conflict.

## 10. Patient/study isolation

Cross-study contamination is prevented in two layers:

1. **Query scoping** — `buildEvidenceWorkspace(studyId)` only fetches data
   already scoped to `studyId`: `listTestResultsForStudy(studyId)` (further
   filtered `r.study_id === studyId`), `study.symptoms` (from the one
   `StudyRecord` fetched by that id), and `analysisRecord.result.findings`
   (from the one `AnalysisRecord` keyed `anl_${studyId}`).
2. **Defense-in-depth final filter** — after building all three adapter
   outputs, `buildEvidenceWorkspace` filters the combined array again:
   `[...symptomItems, ...testItems, ...findingItems].filter((i) =>
   i.study_id === studyId)`, explicitly so no evidence from another study
   can leak into the workspace even if an upstream query were ever scoped
   incorrectly.

## 11. API

**`GET /api/studies/{id}/evidence`** (`app/api/studies/[id]/evidence/route.ts`)

- Roles: `ADMIN`, `CLINICIAN`, `REVIEWER` only — enforced by `requireRole()`
  as the first statement, the same PHI-bearing-results policy as
  `/api/documents/{id}/results` and `/api/results/{id}/verify`.
- Returns the full `EvidenceWorkspace` for the study, or `404` if the study
  doesn't exist.
- **Read-only**: there is no request body and no mutation of any kind. This
  route cannot verify, correct, or reject a test result, cannot record a
  symptom, and cannot alter a finding — verification/correction of
  underlying data continues exclusively via the existing S4 endpoint
  (`POST /api/results/{resultId}/verify`), which remains the only place that
  produces the `HUMAN_VERIFIED` trust level this workspace reads back.

## 12. Model independence

S5 consumes only structured evidence already produced by other layers
(`TestResult`, `PatientSymptom`, `Finding`) — it is not wired to any
specific LLM or vendor, has no model call of its own, and has no dependency
on which image-analysis model is installed. A future `ModelFinding` from a
model that reaches `EXTERNALLY_VALIDATED`/`CLINICALLY_VALIDATED` status
would enter this layer the same way today's demo findings do: through the
existing `AI_FINDING` adapter pattern (`evidenceFromFindings`), producing
`VALIDATED_AI_FINDING`-trust evidence rather than a new adapter or a new
evidence shape.

## 13. Hard boundaries

1. No diagnosis is ever produced — `ConditionAssessmentState` has no
   `CONFIRMED_DIAGNOSIS` value, and every workspace carries the fixed
   `safety_banner` string stating "NOT A DIAGNOSIS. NOT CLINICALLY
   VALIDATED. FOR HUMAN REVIEW ONLY."
2. No treatment recommendation of any kind exists anywhere in this layer.
3. No fabricated probabilities/percentages — every assessment field is a
   discrete state, an id list, or text carried from a source; nothing is
   computed as a numeric likelihood.
4. Gates A–F are unaffected — S5 has no interaction with the model-gating
   system in `lib/models/*`.
5. `data/models/` is untouched — this layer performs no model inference.
6. No path lets S5 output alter model inference, triage, treatment, or report
   generation. The read-only `analyzeRecord()` package may display it for
   clinician review (§1).
7. No hallucinated symptoms, values, dates, or laterality — every adapter
   only copies fields already present on its source record; nothing is
   inferred, guessed, or defaulted to a non-`UNKNOWN` value.
8. Every evidence value/laterality/date not explicitly and unambiguously
   present on the source stays `undefined`/`UNKNOWN`/`date_raw`-only — the
   same discipline S3 already enforces, simply re-expressed in this layer's
   shape rather than re-derived.

## 14. Limitations

- The condition taxonomy is intentionally **not exhaustive**: it currently
  defines four example patterns (`iop_evidence_pattern`,
  `macular_thickening_pattern`, `optic_nerve_evidence_pattern`,
  `acute_vision_change_pattern`) solely to demonstrate the architecture end
  to end, not as clinical coverage of ophthalmic conditions.
- `CLINICIAN_OBSERVATION` is additive report evidence from the clinician
  review workspace; it is not an AI finding and never overwrites the source
  report.
- `HISTORY` is populated from encounter records and document-extracted
  history candidates, all with explicit provenance and verification state.
- `IMAGE` and `PDF` are reserved source types for future direct
  per-pixel/whole-document evidence — not populated in S5 (image findings
  already flow through `AI_FINDING`; document-level text flows through
  `TEST_RESULT`).
- Longitudinal comparison is exposed through the record-analysis and compare
  routes; it remains an evidence-comparison view rather than a progression
  claim.
- `ABSENT` is currently produced only for explicit document negation; an
  unmentioned symptom remains `NOT_REPORTED` rather than an inferred denial.
- This document, and the system it describes, make no claim of clinical or
  regulatory validation. Clinical/regulatory validation of the taxonomy, the
  assessment algorithm, or any future use of this evidence workspace remains
  entirely future work.
