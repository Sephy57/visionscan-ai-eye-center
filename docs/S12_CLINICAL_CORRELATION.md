# S12 — The Clinical Correlation Chain, As It Actually Exists

> **Status: this document describes infrastructure built across S3–S10.**
> Only the diagnosis gate (§5) is new this session (S11); everything else
> here is a description of pre-existing, already-shipped code, gathered into
> one place because the master prompt asked for this chain to be documented
> end to end. Nothing in this document is new behavior. **NOT A MEDICAL
> DEVICE. NOT CLINICALLY VALIDATED. NOT FOR CLINICAL USE.**

The master prompt asked for a documented chain: **Finding → Symptoms → Test
results → Conditions → Required confirmation → Urgency → Treatment
information.** Every link below already exists in this codebase, built in
the phase noted, with the module that implements it and the exact
provenance fields that let a reviewer trace any conclusion back to its
source.

## 1. Finding

**Module:** `lib/analysis/schema.ts` (`Finding` type), populated by two
separate, non-interacting pathways:

- The pre-existing DEMO pipeline (`lib/analysis/pipeline.ts` →
  `analyzeStudy()`), synthetic/placeholder, behind Gate A (closed).
- S10's real pathway (`lib/models/segformerFindingAdapter.ts` →
  `lib/evidence/researchAnalysis.ts`), producing exactly two real finding
  types (`research_segmented_optic_disc_area`,
  `research_segmented_optic_cup_area`) from actual SegFormer inference,
  `taxonomy_level: "observation"` (never `"diagnosis"`), `synthetic: false`.

**Provenance:** `Finding.id`, `Finding.model_id` — every finding carries
which model produced it. S10 findings additionally trace through
`EvidenceItem.provenance.analysis_id` / `.finding_id` once they enter the
evidence layer (§3 below).

## 2. Symptoms — two distinct, never-merged categories

**Hard rule, unchanged since S5/S10, enforced by code and tests: an image
finding can never become a patient-reported symptom, and a patient-reported
symptom can never become — or be presented as — a model-detected finding.**
Three separate vocabularies exist and are kept apart on purpose:

| Category | Meaning | Module |
|---|---|---|
| Patient-reported | What the patient told the system, structured intake | `lib/clinical/symptoms.ts` (`PatientSymptom`, `SYMPTOM_VOCABULARY`), stored on `study.symptoms` |
| Model-detected | What a model actually detected | `Finding[]` (§1) |
| Commonly associated | Knowledge-base wording only — symptoms commonly associated with a finding or condition in general, **never** attributed to this specific patient | `lib/clinical/associatedSymptoms.ts` — `associatedSymptomsForFindings(findingTypes)` inverts `SYMPTOM_VOCABULARY.related_finding_types`; `associatedSymptomsForCondition(conditionId)` reads `ConditionDef.commonly_associated_symptoms` |

`ASSOCIATED_SYMPTOMS_LABEL` in `associatedSymptoms.ts` states this
explicitly in the copy shown to a reader: *"Commonly associated symptoms —
not necessarily reported by this patient."* The AI must never say "patient
has X" for a commonly-associated symptom — it can only say "X is commonly
associated with this finding/condition in general."

## 3. Test results

**Module:** S3's structured extraction (`lib/documents/extraction/testResults.ts`)
produces `TestResult` records in state `AUTO_EXTRACTED`; S4's human
verification (`lib/documents/extraction/testResultService.ts`) moves a
result through `UNREVIEWED` → `VERIFIED`/`CORRECTED`/`REJECTED` via
`POST /api/results/{resultId}/verify` — the only place that produces the
`HUMAN_VERIFIED` trust level. See `docs/TEST_RESULT_EXTRACTION.md` and
`docs/HUMAN_VERIFICATION.md` — not duplicated here.

**Provenance:** each `TestResult` carries `document_id`, `page`,
`source_text`, `extraction_method` — the same chain
`components/DocumentEvidencePanel.tsx` already surfaces to a reviewer.

## 4. Conditions — the evidence-synthesis layer (S5)

**Module:** `lib/evidence/*` (`docs/EVIDENCE_SYNTHESIS.md`, full detail
there). This is where Findings (§1), Symptoms (§2), and Test results (§3)
converge into one common shape.

Three read-only adapters (`lib/evidence/adapters.ts`) turn each source into
an `EvidenceItem` (`lib/evidence/types.ts`) — never inventing a value, unit,
laterality, or date not already present on the source record. Each item
carries `provenance` (`EvidenceProvenance`: `study_id`, `document_id`,
`result_id`, `page`, `source_text`, `analysis_id`, `finding_id`,
`extraction_method` — whichever the source type can supply) and a
`trust_level` (`UNVERIFIED` / `AUTO_EXTRACTED` / `HUMAN_VERIFIED` /
`CLINICIAN_ENTERED` / `VALIDATED_AI_FINDING` / `REJECTED`).

`assessConditions()` (`lib/evidence/synthesize.ts`) produces a
`ConditionAssessment` per condition (per eye, for `per_eye` conditions) in
exactly one of five states — quoted verbatim from `lib/evidence/types.ts`
(`ConditionAssessmentState`) and `docs/EVIDENCE_SYNTHESIS.md` §8:

| State | Meaning |
|---|---|
| `UNABLE_TO_ASSESS` | the definition's `required_evidence` isn't present for this eye — no assessment possible |
| `INSUFFICIENT_EVIDENCE` | required evidence present (or none required) but no supportive/required matches at all |
| `CONFLICTING_EVIDENCE` | both positive (required+supportive) and `contradictory_evidence` matches are present — never resolved automatically |
| `POSSIBLE_CONDITION` | positive matches exist but fail the trust/independence gate below |
| `SUPPORTED_CONDITION` | positive matches exist, at least one is `TRUSTED_FOR_SUPPORT` (`HUMAN_VERIFIED`/`CLINICIAN_ENTERED`/`VALIDATED_AI_FINDING`), **and** the number of distinct `source_type`s among positive matches meets `min_independent_supportive_for_supported` |

There is no `CONFIRMED_DIAGNOSIS` value anywhere in this type, and no path
in this codebase produces one from this layer under any input.

**Provenance for a condition:** `ConditionAssessment.supporting_evidence_ids`
and `.contradicting_evidence_ids` are lists of `EvidenceItem.id`s — a
reviewer can trace any assessment back to the specific evidence items that
produced it, and from each item's `provenance` back to the originating
document/page/finding. `ConditionAssessment.missing_required` names exactly
what evidence is absent when the state is `UNABLE_TO_ASSESS` or
`INSUFFICIENT_EVIDENCE`.

## 5. Required confirmation — the diagnosis gate (new this session, S11)

**Module:** `lib/models/diagnosisGate.ts`, `canDisplayDiagnosis()`. This is
the final checkpoint before any label could ever legitimately say
"diagnosis" instead of "requires clinical correlation." It is a pure,
server-side-only function — never reachable from client-side UI code — that
requires all seven of the following simultaneously:

1. `modelValidation === "CLINICALLY_VALIDATED"`
2. `intendedUseMatches`
3. `modalityMatches`
4. `qualityStatus === "pass"`
5. `!oodDetected`
6. `calibrationAvailable`
7. `evidenceSufficient`

A single failing condition fails the entire gate closed
(`DiagnosisGateResult.allowed = false`), and every unmet requirement is
returned as a human-readable reason in `reasons[]` — never silently
dropped. When `allowed` is `false`, callers must use
`clinicalInterpretation: "REQUIRES_CLINICAL_CORRELATION"`, never construct a
"diagnosis" label themselves. See `docs/S11_MODEL_VALIDATION.md` §11 for
this gate applied concretely to the one model wired into this codebase
today (`allowed: false`, by construction, for at least four independent
reasons).

This gate did not exist before S11. It formalizes, as one auditable
all-or-nothing decision point, a rule that was previously only enforced
piecemeal (taxonomy-level `"observation"`, trust-gating in `assessConditions`,
"NOT A DIAGNOSIS" copy in the UI). It does not change any of those
pre-existing enforcement points — it adds a single new one that any future
"diagnosis" feature would have to pass.

## 6. Urgency — the triage engine (pre-existing, unchanged this session)

**Module:** `lib/clinical/triage.ts`, `runTriage()`. Real rules, quoted from
the file's own header comment:

> AI output can NEVER lower a triage level set by these deterministic
> rules.

Concretely, in priority order:

1. **Red-flag symptoms always dominate** (`RED_FLAG_MAP`) — e.g.
   `sudden_vision_loss`, `curtain_shadow`, `trauma_with_vision_loss`, and
   `severe_eye_pain_with_visual_disturbance` all map directly to
   `emergency_evaluation`, overriding anything imaging-derived. This
   escalation "does NOT name or imply any specific condition" (the code's
   own rationale string).
2. A failed quality gate blocks routine triage outright
   (`prompt_professional_review`).
3. High-risk finding *types* (a fixed set: `possible_retinal_hemorrhage`,
   `retinal_hemorrhage`, `preretinal_hemorrhage`,
   `possible_retinal_detachment`, `disc_edema_like`,
   `neovascularization_like`, `possible_occlusive_change`) escalate
   regardless of confidence — "Escalation is conservative and is not
   reduced by imperfect confidence" (code comment).
4. Out-of-distribution input can never yield a normality claim — it forces
   `prompt_professional_review` with the explicit rationale "Normality must
   not be claimed."
5. High uncertainty (`uncertainty >= 0.5`, or any `INDETERMINATE` finding)
   forces professional review.
6. Any finding at all forces a professional-review recommendation
   (screening posture).
7. Only with none of the above does the system fall through to
   `routine_follow_up` — and even then, the action text explicitly says
   "This does not guarantee that no eye disease is present," citing the
   system's own unvalidated status (`unvalidated_system_routine` rule).

`assertNotDowngraded()` is the guard used elsewhere to enforce the header
rule mechanically: red-flag symptoms and high-risk finding types drive
urgency; model confidence is never what raises or lowers it. Triage is
**not** connected to S10's research-analysis output this session — this
remains true as of S11 as well; `runTriage()` is unchanged and untouched.

## 7. Treatment information (pre-existing, still intentionally empty)

**Module:** `lib/treatment/medications.ts` (`MEDICATIONS: Record<string,
MedicationRecord> = {}`) and `lib/treatment/treatmentInfo.ts`
(`CONDITION_TREATMENT_MAP: Record<string, TreatmentApproach[]> = {}`).
Confirmed unchanged this session.

The architecture is real and production-ready: `validateMedicationRecord()`
fails closed on any record missing a non-empty `evidenceReferences` array
or a named `source` — a medication record cannot be registered without
citing an authoritative source. `getTreatmentInformation()` only ever
produces output for conditions that already passed §4's `assessConditions()`
gate.

**Why it stays empty:** this deployment has no connected licensed
drug/formulary data source (no openFDA/RxNorm/DailyMed integration, no
clinical guideline feed). Populating either registry from an LLM's memory
would violate this project's own repeatedly-stated rule against inventing
clinical/medical facts — the `evidenceReferences` requirement exists
specifically to make that impossible to do accidentally. Every condition
today honestly returns `available: false` with a reason explaining why,
rather than fabricated-but-plausible-looking treatment text. See
`docs/CLINICAL_AI_ARCHITECTURE.md` §4 for the full rationale and what a
real ingestion path would require.

## 8. The chain, end to end

```
Finding (§1)                     lib/analysis/schema.ts / segformerFindingAdapter.ts
   │  Finding.id, Finding.model_id
   ▼
Symptoms (§2)               ┌──── patient-reported: lib/clinical/symptoms.ts
   (kept separate)          └──── commonly-associated: lib/clinical/associatedSymptoms.ts
   │
   ▼
Test results (§3)                lib/documents/extraction/testResults.ts (+ S4 verification)
   │  document_id, page, source_text, extraction_method
   ▼
EvidenceItem (§4)                lib/evidence/adapters.ts → EvidenceItem[]
   │  provenance, trust_level
   ▼
ConditionAssessment (§4)         lib/evidence/synthesize.ts → assessConditions()
   │  supporting_evidence_ids / missing_required
   ▼
Diagnosis gate (§5, NEW S11)     lib/models/diagnosisGate.ts → canDisplayDiagnosis()
   │  allowed: false today → REQUIRES_CLINICAL_CORRELATION
   ▼
Urgency (§6)                     lib/clinical/triage.ts → runTriage()
   │  never downgraded by AI output
   ▼
Treatment information (§7)       lib/treatment/* — empty by design, evidence-gated
```

Every arrow above is a real, already-wired code path except the final
"→ Treatment information" step, which is architecturally ready but has no
data to serve (§7). See `docs/CLINICAL_AI_ARCHITECTURE.md` §1 for the fuller
system-wide pipeline diagram this chain sits inside (ingestion, OCR, the
DEMO pipeline, S9/S10) — not reproduced here to avoid duplication.
