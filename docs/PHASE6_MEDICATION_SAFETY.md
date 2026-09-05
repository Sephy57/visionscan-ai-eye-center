# Phase 6 — Medication Knowledge + Safety Intelligence

> **The medication layer provides structured safety intelligence and does
> not independently establish treatment appropriateness, prescribe
> medication, or authorize medication changes.**

## 1. Architecture

```
Patient/Encounter Evidence (MedicationEntry, Allergy, SystemicHistory — Phase 1)
   ↓
resolveMedication()              lib/treatment/medicationNormalization.ts (new)
   ↓ (exact match only against the intentionally-empty MEDICATIONS registry)
evaluateMedicationAllergySafety() lib/treatment/allergySafety.ts (extended)
checkInteractions()               lib/treatment/interactionCheck.ts (new)
checkContraindications()          lib/treatment/contraindicationCheck.ts (new)
   ↓
evaluateMedicationSafety()        lib/models/medicationSafetyResult.ts (new)
   ↓
StructuredMedicationSafetyResult
   ↓
Clinician review (requires_clinician_review: true, pinned)
```

Separately, at the evidence-graph level:
```
findMedicationAssociations()      lib/evidence/medicationAssociation.ts (new)
buildMedicationHistory()          lib/evidence/medicationHistory.ts (new)
```

The medication knowledge layer is fully separable from Phase 4's
`ReasoningEngine` — neither imports the other. Medication evidence flows
into the existing evidence graph as its own `MEDICATION`/`ALLERGY`
`source_type` (added in Phase 1), never auto-promoted to diagnosis
evidence.

## 2. Medication knowledge model

`lib/treatment/medications.ts`'s `MedicationRecord` (built in an earlier
phase, unmodified) already had everything §8 asked for:
`medicationId`/`genericName`/`brandNames`/`drugClass`/`route`/
`contraindications`/`drugInteractions`/`evidenceReferences`/`source`/
`version`/`jurisdiction`. **`MEDICATIONS` is intentionally empty** — no
connected drug/formulary source exists in this deployment. This phase
built the layer that operates honestly on top of an empty registry,
rather than populating it with unsourced facts.

## 3. Medication normalization

`lib/treatment/medicationNormalization.ts`'s `resolveMedication(rawName)`:
- Case/whitespace-normalized, **exact-match only** against
  `genericName`/`brandNames` — no fuzzy matching, no edit-distance (§9's
  explicit prohibition).
- Three outcomes: `KNOWN` (exactly one match), `AMBIGUOUS_MEDICATION`
  (more than one distinct record matches the same normalized name — never
  silently picks the first), `UNKNOWN_MEDICATION` (no match).
- Because `MEDICATIONS` is empty, **every real medication name resolves
  as `UNKNOWN_MEDICATION` today** — verified by test, and explicitly
  documented as the correct, safe outcome, not a bug.

## 4. Provenance

Reuses Phase 1's `DataProvenance` vocabulary unchanged
(`PATIENT_REPORTED`/`CLINICIAN_ENTERED`/`DEVICE_MEASURED`/
`LAB_IMPORTED`/`DOCUMENT_EXTRACTED`/`AI_INFERRED`/`AI_DERIVED`/
`VERIFIED_BY_CLINICIAN`) and Phase 1's `evidenceFromMedications()`/
`evidenceFromAllergies()` adapters, which already enforce that
`AI_INFERRED`/`AI_DERIVED` can never map to `HUMAN_VERIFIED` trust — no
new provenance logic was needed or added.

## 5. Medication status

`MedicationEntry` (Phase 1, extended this phase) gained an optional
`status?: MedicationStatus` field (`ACTIVE`/`INACTIVE`/`DISCONTINUED`/
`HISTORICAL`/`UNKNOWN`) and a `stopped?: string | null` date field.
Absence of `status` is treated as `UNKNOWN` everywhere it's consumed —
**never defaulted to `ACTIVE`** (§11's hard rule, verified by test).

## 6. Allergy safety

`lib/treatment/allergySafety.ts` (Phase 1 foundation, extended, not
replaced — the original `checkMedicationAgainstAllergies()` and its 3
states are unchanged and still pass their original Phase 1 tests). New
`evaluateMedicationAllergySafety(rawMedicationName, allergies)` adds the
fuller §12 state vocabulary on top:

| Status | Meaning |
|---|---|
| `NO_ALLERGIES_RECORDED` | Patient has no recorded allergies (not evidence of no risk) |
| `NO_MATCH_FOUND_NOT_CONFIRMED_SAFE` | Allergies recorded, none text-matched — explicitly not "safe" |
| `POSSIBLE_ALLERGY_MATCH` | A substring/class-level match — requires review, not a block |
| `KNOWN_ALLERGY_MATCH` | An exact ingredient/brand-name match — the strongest signal this deployment can produce |
| `UNKNOWN_ALLERGY_STATUS` | The medication itself didn't resolve — safety literally cannot be evaluated |
| `INSUFFICIENT_INFORMATION` | The medication name was ambiguous |

No status here is ever phrased as confirming safety — verified by test
that no notice string contains an unqualified "is safe" claim.

## 7. Interaction architecture

`lib/treatment/interactionCheck.ts` does **not** build a second,
parallel interaction database — it reads `MedicationRecord`'s own
existing `drugInteractions` field (a design already present in the
Phase-5-era `medications.ts`). Because the registry is empty, this
honestly returns `INTERACTION_KNOWLEDGE_UNAVAILABLE` for every real
input today. The architecture (real lookup logic, real severity
handling, real notice text) is ready to produce genuine
`KNOWN_CONCERN`/`NO_KNOWN_CONCERN` results the moment real
`drugInteractions` data is registered through the existing
`registerMedication()` fail-closed validator.

## 8. Contraindication/concern architecture

`lib/treatment/contraindicationCheck.ts` reads `MedicationRecord`'s
existing `contraindications` field against the patient's `SystemicHistory`
(Phase 1). Four states: `KNOWLEDGE_UNAVAILABLE` (unresolved medication or
no recorded contraindications), `INSUFFICIENT_INFORMATION` (no systemic
history recorded — absence is never treated as "no concern"),
`NO_KNOWN_CONCERN`, `POSSIBLE_CONCERN`. Never converts a concern into an
instruction ("patient should not take this") — every possible-concern
notice explicitly states it requires clinician review, never an automatic
block.

## 9. No fabricated drug database

Per §40's hard requirement: zero medication facts, interaction rules, or
contraindications were invented this phase. `MEDICATIONS` remains empty.
Every knowledge field this phase's logic reads (`drugInteractions`,
`contraindications`, `genericName`, `brandNames`) was already part of the
existing, honestly-empty `MedicationRecord` type from an earlier phase —
this phase added the evaluation logic, not the (still-empty) data.

## 10. Patient medication list / dosage safety

No dose, frequency, route, or start/stop date is ever computed or
suggested by this phase's code — confirmed by test that scans a real
`evaluateMedicationSafety()` output for phrases like "recommended dose."
A source-documented dose (`MedicationEntry.dose`) is preserved as-is if
present, never validated as clinically appropriate and never used to
generate a different value.

## 11. Medication-symptom / medication-finding association

`lib/evidence/medicationAssociation.ts`'s `findMedicationAssociations()`
flags same-visit co-occurrence between `MEDICATION` evidence and
`SYMPTOM`/`AI_FINDING` evidence as `POSSIBLE_ASSOCIATION` —
**never** a causal claim. `REJECTED` evidence never participates.
Cross-visit co-occurrence is deliberately not associated here (that would
conflate temporal proximity across time with same-visit correlation) —
verified by test.

## 12. Longitudinal medication history

`lib/evidence/medicationHistory.ts`'s `buildMedicationHistory()` mirrors
Phase 5's philosophy applied to medication status specifically:
`FIRST_DOCUMENTED`, `CONTINUED`, `STATUS_CHANGED`, and
`MEDICATION_HISTORY_CONFLICT` (a real oscillating-status pattern like
ACTIVE → DISCONTINUED → ACTIVE, preserved rather than silently resolved
to the latest value — verified by test). `medicationNotDocumentedAt()`
distinguishes "not mentioned at this visit" from "discontinued" — the
former is never interpreted as the latter.

## 13. `StructuredMedicationSafetyResult`

```
patient_ref, encounter_id, medications_evaluated[], unknown_medications[],
ambiguous_medications[], allergy_findings[], interaction_findings[],
contraindication_findings[], safety_findings[] (each with a computed,
  never client-settable, severity: INFO/LOW/MODERATE/HIGH/UNKNOWN),
missing_information[], provenance, knowledge_version, engine_version,
requires_clinician_review: true (pinned at the type level),
limitations[], blocked_claims[]
```

## 14. Forbidden-claims scanning

`evaluateMedicationSafety()` runs every notice/limitation string it
assembles through a dedicated forbidden-phrase scanner (§21's explicit
list: start/stop/switch/dose-change/dosing/prescribe/treatment-
appropriateness/treatment-selection instructions) before returning —
mirroring Phase 4's reuse of `lib/analysis/pipeline.ts`'s pattern. One
real, useful discovery from writing this scanner: the engine's own
correctly-worded *denial* sentences ("does not establish... prescribe
medication", "...is safe for this patient") could naively trip a
substring scanner despite being negated, safe disclaimers. Rather than
build a fragile negation-aware regex, the fixed disclaimer text itself
was reworded (e.g. "does not issue a prescription", "medication safety
... remains unconfirmed") to state the same honest meaning without
containing the bare trigger phrase — verified by test that a realistic
real result produces zero blocked claims.

## 15. Security testing

Performed directly (subagents were not dispatched this phase after
repeated org-wide API spend-limit failures on prior phases in this
session — the same scope was completed directly):

- **Cross-patient contamination**: `evaluateMedicationSafety()` is a pure
  function of its explicit input with no shared/global state — two calls
  with different `patient_ref`s never leak each other's medications,
  verified by test.
- **Provenance spoofing**: a `MedicationEntry` with no explicit `status`
  is never treated as `ACTIVE` by `buildMedicationHistory()`, verified by
  test.
- **Severity spoofing**: `MedicationSafetyFinding.severity` is always
  computed internally from a real status enum — there is no
  caller-settable severity field anywhere in the input types.
- **NaN/Infinity**: malformed values in systemic-history-derived text
  never crash `checkContraindications()`, verified by test.
- **Prompt injection**: a medication name or allergen string containing
  instruction-like text ("ignore all previous instructions...") is
  matched as inert literal text by the real substring logic, never
  interpreted as an instruction — verified by test.
- **Dose spoofing**: no code path ever elevates a client-supplied dose
  string into a "validated" or "recommended" dose.
- **API exposure**: zero files under `app/api/` import
  `medicationSafetyResult` — verified by grep and by test. This
  architecture is not yet reachable from any HTTP endpoint.
- All four protected safety files (`diagnosisGate.ts`,
  `qualityPresentation.ts`, `terminology.ts`, `researchAnalysis.ts`) show
  zero diff from this phase's work.

## 16. Limitations / unsupported knowledge

- `MEDICATIONS` remains empty — every medication in practice resolves
  `UNKNOWN_MEDICATION`, and every allergy/interaction/contraindication
  check on it resolves to an "unavailable"-class state. This is the
  correct, honest, safe state of the architecture today, not a partial
  implementation of a populated one.
- No UI and no API route were built this phase.
- No persisted `PatientMedication` database entity — medication
  observations are read from Phase 1's in-memory `MedicationEntry`/
  evidence-graph representation, consistent with the still-unpersisted
  `PatientEncounter` model.
- `checkInteractions()`/`checkContraindications()` are one-directional
  (medication A's own record is authoritative for itself only) — no
  transitive/symmetric inference across an unresolved medication B.

## 17. Clinician review requirement

Every structured result this phase produces pins
`requires_clinician_review: true` at the type level (a TypeScript literal
`true`, not a boolean that could be set `false`). No finding, however
strong the text match, is ever presented as an automatic block or an
automatic approval.
