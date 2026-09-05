# Clinical AI Architecture (S3–S10, cumulative; historical phase record)

> Later implementation work adds the automatic record-analysis pipeline,
> specialist consensus, clinician workspace, and patient/tenant scope. See
> [`docs/FINAL_PLATFORM_AUDIT.md`](FINAL_PLATFORM_AUDIT.md) for the current
> verified capability boundary.

> **Status: describes the system AS IT ACTUALLY EXISTS after S10, not the
> 44-section master-prompt vision.** Every phase referenced here is
> IMPLEMENTED and covered by passing tests unless explicitly marked
> otherwise. **NOT A MEDICAL DEVICE. NOT CLINICALLY VALIDATED. NOT FOR
> CLINICAL USE.** Nothing in this document should be read as a claim that
> any AI output here has been diagnostically validated — see the
> phase-specific docs cross-referenced throughout for the actual evidence
> behind each claim.

This document answers one question: *"starting from an uploaded image or
document, what actually happens on the way to something a clinician sees,
and which of the master prompt's 44 requested capabilities are real today
versus not attempted?"* It is a map connecting existing phase docs, not a
replacement for them — each section below defers to its phase doc for
detail rather than re-deriving it.

## 1. The pipeline as it actually exists

```
Upload (image or PDF/document)
  │
  ├─ S1/S2 — secure ingestion + OCR/extraction
  │    lib/storage/files.ts, lib/documents/*
  │    Hashes and stores the original file; OCRs/parses documents.
  │
  ├─ S3 — structured test-result extraction
  │    lib/documents/extraction/testResults.ts
  │    Turns extracted document text into typed TestResult records
  │    (AUTO_EXTRACTED state) — see docs/TEST_RESULT_EXTRACTION.md.
  │
  ├─ S4 — human verification
  │    lib/documents/extraction/testResultService.ts
  │    A human must verify/correct/reject each TestResult before it is
  │    trusted for anything downstream — see docs/HUMAN_VERIFICATION.md.
  │    Verification NEVER reaches diagnosis, triage, or treatment code
  │    (enforced by tests).
  │
  ├─ (parallel) DEMO image-analysis pipeline
  │    lib/analysis/pipeline.ts → analyzeStudy()
  │    The pre-existing, registry-gated, SYNTHETIC/placeholder finding
  │    generator behind Gate A. Untouched by S5–S10. See
  │    docs/MODEL_REGISTRY.md / docs/MODEL_INTEGRATION.md.
  │
  ├─ S5 — multimodal evidence synthesis
  │    lib/evidence/* → GET /api/studies/{id}/evidence
  │    Reads S3/S4 test results + Phase-3 patient symptoms + the DEMO
  │    pipeline's Finding[] (if any), converts each into a common
  │    EvidenceItem shape, runs cross-source conflict detection, and runs a
  │    non-clinical, presence-based "possible condition" pattern match. See
  │    docs/EVIDENCE_SYNTHESIS.md for the full trust-level/laterality/
  │    conflict model — not duplicated here.
  │
  ├─ S9 — real model inference, standalone
  │    lib/models/segformerResearchProvider.ts
  │    A real, hash-verified, safetensors-only SegFormer checkpoint run on
  │    CPU via an isolated Python bridge. Produces a genuine
  │    RawModelOutput. NOT wired into analyzeStudy(), the model registry,
  │    or Gate A — see docs/S9_REAL_MODEL_INTEGRATION.md.
  │
  ├─ S10 — research-analysis orchestrator (this session, new)
  │    lib/evidence/researchAnalysis.ts → GET /api/studies/{id}/research-analysis
  │    Wires S9's real inference into S5's evidence layer, and ONLY there:
  │    study lookup → modality gate (must resolve FUNDUS) → real quality
  │    gate (assessQuality) → temp-file write → SegFormer inference →
  │    taxonomy-gated Finding[] conversion → merged into a COPY of the S5
  │    evidence workspace (conflict detection + condition assessment
  │    re-run on the combined evidence set). Every non-success state
  │    (NOT_A_STUDY, UNSUPPORTED_MODALITY, IMAGE_QUALITY_INSUFFICIENT,
  │    INFERENCE_UNAVAILABLE) is fail-closed, never a fabricated result.
  │    See §2 and §3 below, and docs/PHASE_NEXT_OPHTHALMIC_AI_REPORT.md.
  │
  └─ Human review
       Clinician/reviewer views S5's evidence workspace and, if present,
       S10's research-analysis panel — both explicitly labeled research/
       non-diagnostic — and makes the actual clinical judgment.
```

The DEMO pipeline (`analyzeStudy()`) and the S10 research pathway are two
**entirely separate** code paths that happen to feed the same downstream S5
evidence layer as independent `AI_FINDING` sources. Neither can trigger,
skip, or influence the other. `researchAnalysis.ts` imports S5's synthesis
functions to build its own copy of the workspace; it never mutates or reads
back through `analyzeStudy()`.

## 2. The finding/localization/condition/symptom/treatment split

The master prompt asked for a full clinical concept ladder — finding,
localization, associated symptoms, patient-reported symptoms, possible
conditions, treatment information. Here is exactly what is real today for
each rung, and where it lives:

| Rung | Status | Source |
|---|---|---|
| **Objective image finding** | REAL for two finding types (`research_segmented_optic_disc_area`, `research_segmented_optic_cup_area`), from actual SegFormer output on a real fundus image; controlled-taxonomy-gated (`mayEmitFinding()`), `taxonomy_level: "observation"` (never `"diagnosis"`), `synthetic: false`. All other finding types in `lib/analysis/taxonomy.ts` are either DEMO-synthetic (behind Gate A) or schema-prepared but undetected (OCT). | `lib/models/segformerFindingAdapter.ts`, `lib/analysis/taxonomy.ts` |
| **Localization (bounding box)** | REAL for the two finding types above — a genuine bounding box derived from the model's actual predicted pixel mask, not fabricated or estimated. Rendered via `ScanViewer`'s existing `localizations` prop (pre-existing S3.2-era component, reused as-is). | `lib/models/segformerFindingAdapter.ts` (`region`), `components/ScanViewer.tsx`, `components/ResearchAnalysisPanel.tsx` |
| **Associated (commonly-associated) symptoms** | Pre-existing (built earlier in this session's Phase 5, before S10), reused unchanged. Inverts the symptom vocabulary's `related_finding_types` — knowledge-base wording only, explicitly never attributed to "this patient." | `lib/clinical/associatedSymptoms.ts` |
| **Patient-reported symptoms** | Pre-existing S3-era structured symptom intake, reused unchanged. | `lib/clinical/symptoms.ts`, `PatientSymptom` on `study.symptoms` |
| **Possible conditions** | S5's evidence-gated `assessConditions`, reused unchanged (S10 re-runs it on a merged evidence set, doesn't modify it). Five states: `POSSIBLE_CONDITION` / `SUPPORTED_CONDITION` / `INSUFFICIENT_EVIDENCE` / `CONFLICTING_EVIDENCE` / `UNABLE_TO_ASSESS`. `SUPPORTED_CONDITION` requires trust-gated evidence (`HUMAN_VERIFIED`/`CLINICIAN_ENTERED`/`VALIDATED_AI_FINDING`) — a lone `UNVERIFIED` `AI_FINDING` (which is all S10 ever produces, since this model has no validated status) can never alone reach `SUPPORTED_CONDITION`. Verified by `tests/s10-research-analysis.test.ts`. | `lib/evidence/synthesize.ts` (§3/§7 of `docs/EVIDENCE_SYNTHESIS.md`) |
| **Treatment information** | Architecture exists and is production-ready (registry, gating chain, dosage/interaction safety checks, defense-in-depth regex against fabricated dosing text) — but **intentionally, deliberately left empty this session**. See §4 below. | `lib/treatment/medications.ts`, `lib/treatment/treatmentInfo.ts` |

## 3. Hard boundaries carried through every layer

These are enforced by code and by tests, not just stated as policy:

- **No diagnosis, ever.** Every S10 finding is `taxonomy_level: "observation"`.
  Every S5 condition state is explicitly labeled "NOT A DIAGNOSIS" in the UI
  (`ResearchAnalysisPanel.tsx`) and in the docs. A segmented pixel area is
  documented as "not by itself a diagnosis, not a disease probability, and
  not evidence of glaucoma or any other condition on its own"
  (`docs/S9_REAL_MODEL_INTEGRATION.md` §20).
- **No fabricated confidence or calibration.** `segformerFindingAdapter.ts`
  sets `confidence: 0` (the schema's explicit "none provided" sentinel),
  `confidence_calibrated: null` — because this model exposes neither a raw
  per-finding score nor calibration evidence. The UI renders this as "NOT
  CALIBRATED," never a fabricated percentage.
- **No LLM-authored medical facts.** `lib/treatment/medications.ts` and
  `treatmentInfo.ts` require `evidenceReferences` on every record and are
  left empty rather than populated from an LLM's memory (§4).
- **Laterality is never inferred from pixels.** S10's findings inherit the
  study's declared eye (`study.eye`) exactly as S5's `evidenceFromFindings`
  already did — the model itself always reports `laterality: "unknown"`
  (`docs/S9_REAL_MODEL_INTEGRATION.md` §15).
- **`analyzeStudy()`, the model registry, and Gate A are untouched.**
  `lib/evidence/researchAnalysis.ts` never writes to the `analyses`
  collection that `analyzeStudy()` owns, never inserts into `MODELS`, and
  is never imported by `lib/analysis/pipeline.ts`. Confirmed empty by
  `grep -rln "researchAnalysis\|segformerFindingAdapter" lib/analysis/pipeline.ts lib/clinical lib/treatment lib/reports` —
  zero matches (see `docs/PHASE_NEXT_OPHTHALMIC_AI_REPORT.md` "Safety
  status" for the exact command and result).
- **Fail-closed at every stage, never a fabricated "normal" result.** Study
  not found, wrong modality, failed quality gate, or unavailable inference
  each return an explicit non-COMPLETED state with a `reason` string — none
  of them silently produce empty-but-"successful" output.
- **Different-eye evidence is never combined** (S5 rule, unchanged, applies
  identically to S10's merged evidence — see `docs/EVIDENCE_SYNTHESIS.md`
  §5).

## 4. Treatment information: deliberately empty, not a bug

`lib/treatment/medications.ts` (`MEDICATIONS: Record<string,
MedicationRecord> = {}`) and `lib/treatment/treatmentInfo.ts`
(`CONDITION_TREATMENT_MAP: Record<string, TreatmentApproach[]> = {}`) were
both built in an earlier phase, before this session, and found this
session to already be exactly the right shape for the master prompt's
"treatment information" requirement: a `MedicationRecord` requires a
non-empty `evidenceReferences` array and a named `source` before
`registerMedication()` will even accept it, and `getTreatmentInformation()`
only produces output for conditions that already passed S5's
`assessConditions()` gate.

Both registries remain empty this session, on purpose. Populating real
medication or treatment-approach records would require citing genuine,
verifiable clinical evidence sources (the architecture's own
`evidenceReferences` requirement), and an LLM fabricating or guessing such
citations from memory would violate this project's own repeatedly-stated
rule against inventing clinical/medical facts. Every condition therefore
honestly returns `available: false` with the reason "No treatment
information is registered for this condition... treatment information will
only appear once evidence-referenced records are added" — the same
honest-empty-state pattern already used for the model registry
(`docs/MODEL_REGISTRY.md`) and now for medications.

**What it would take to populate this for real**: an actual ingestion path
from an authoritative source (e.g. an FDA label feed, RxNorm/DailyMed, or a
recognized clinical practice guideline such as an AAO Preferred Practice
Pattern), with each `MedicationRecord` traceable to a specific citation —
not an LLM writing plausible-sounding drug information from memory.

## 5. What a future phase would need to do

This is a pointer, not a duplicate list — see
`docs/PHASE_NEXT_OPHTHALMIC_AI_REPORT.md` ("What was explicitly NOT built")
for the full, grouped accounting against the master prompt's 44 sections,
including the deliberate simplifications (one consolidated endpoint instead
of six, no trained modality classifier, no temporal/longitudinal
comparison) and the genuine external blockers (MONAI RPD's Windows/
Detectron2 blocker, zero published validation for the currently-wired
model, the pre-existing Next.js build/dev-server issue).
