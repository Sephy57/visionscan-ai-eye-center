# Model Registry

Strict registry for ophthalmic AI models. Location: `lib/models/registry.ts`.

## Registry record fields

Every model must declare:

| Field | Purpose |
|---|---|
| `model_id` / `model_name` / `version` | Identity |
| `sha256` | Artifact checksum; verified against the file on disk before every use |
| `format` | onnx / pytorch / tensorflow / remote_api / heuristic / placeholder |
| `modalities` | Explicit modality support (FUNDUS, OCT, OCTA, FAF, FA, ICG, SLIT_LAMP, EXTERNAL_EYE, DICOM_STUDY) |
| `supported_anatomy` / `supported_findings` | What the model may claim to analyze / emit |
| `intended_use` / `contraindications` / `limitations` | Scope boundaries |
| `training_dataset` / `validation_dataset` | Dataset descriptions with provenance references |
| `patient_level_split` | Split hygiene documentation |
| `performance` | Sensitivity, specificity, PPV, NPV, AUROC, AUPRC, calibration — each `null` until actually measured, with a mandatory `evidence_reference` |
| `validation_date` | ISO date of the validation run |
| `external_validation_status` / `clinical_validation_status` | none / in_progress / completed |
| `regulatory_status` | none / research_only / registered / cleared / approved |
| `status` | Lifecycle status (below) |
| `devices` | Explicit device compatibility list (manufacturer, model, firmware, protocol, resolution, FOV) |

## Statuses and what they unlock

| Status | May produce findings | Findings use | Mandatory label |
|---|---|---|---|
| `DEMO` | Yes | demo_only | "DEMO / SYNTHETIC RESULT — NOT FOR CLINICAL USE" |
| `RESEARCH` | Yes | research_only | "RESEARCH USE ONLY — NOT VALIDATED FOR CLINICAL USE" |
| `INTERNAL_VALIDATION` | Yes | research_only | "INTERNAL VALIDATION ONLY — NOT EXTERNALLY VALIDATED" |
| `EXTERNALLY_VALIDATED` | Yes | validated_research | "EXTERNALLY VALIDATED — REGULATORY REVIEW REQUIRED FOR CLINICAL USE" |
| `CLINICALLY_VALIDATED` | Yes | clinical_deployment | none |
| `RETIRED` | No | none | "MODEL RETIRED — MUST NOT BE USED" |

Anti-fraud rules enforced in code:
- A model claiming validation-level status **without** `performance.evidence_reference`, a validation dataset, or a validation date is rejected by `gateModelUse()`.
- `auditRegistryConsistency()` fails closed if any registry record claims external/clinical validation without completed external validation evidence.
- Validation status can never be inferred from a README or marketing text.

## Current registry contents

| Model | Status | Notes |
|---|---|---|
| `demo-fundus-synthetic-v0` | DEMO | Deterministic synthetic findings; no artifact on disk; no metrics measured; no devices validated |

`data\models\` is intentionally **empty**. That is the correct state until a model with real provenance and
validation evidence is introduced. Do not download arbitrary models and present them as validated.

## Integrity verification (`lib/models/integrity.ts`)

```
MODEL FILE -> SHA-256 -> REGISTRY -> MATCH?
  -> version / modality / device / status gates
  -> any failure => REFUSE EXECUTION
```

- Unknown model id → refused.
- Artifact missing or path escaping `MODEL_ROOT` → refused.
- Checksum mismatch → refused.
- Status gate rejection → refused.
- Placeholder DEMO models (no artifact, deterministic generation) are trusted only when status is DEMO.

## Model cards

`generateModelCard()` (`lib/reports/modelCard.ts`) renders a complete model card **from registry fields only** —
the card cannot claim anything the registry does not record. Cards are exposed via `GET /api/models` and the
admin UI.

## Phase 6 additions — real-model integration infrastructure (IMPLEMENTED, no real model installed yet)

Built ahead of any real model artifact, so the plumbing is ready and tested
the moment one is supplied (per the Phase 5B → Phase 6 readiness audit).

- **Device compatibility is now a real execution gate**, not just
  informational display. `gateModelUse(model, device)` takes an explicit,
  optional `device` argument: registry-listing calls omit it (context-free,
  unchanged behavior); `lib/analysis/pipeline.ts` and
  `lib/models/provider.ts`'s `analyzeStudy()` path now pass the study's
  actual declared device, and a non-DEMO model with no matching device
  entry is hard-blocked here — the DEMO model is completely unaffected
  (the check only ever applies when `model.status !== "DEMO"`).
- **Calibration registry** (`lib/models/calibrationRegistry.ts`): a
  persisted, evidence-gated store for `CalibrationRecord`s (previously
  `lib/models/calibration.ts` had the shape and pure functions but nothing
  to register or look one up). `registerCalibration()` refuses a record
  without evidence, mirroring the evidence/transitions registries.
- **Raw-output → Finding[] conversion** (`lib/models/outputConversion.ts`):
  the literal "connect the plumbing" work — `convertRawModelOutputToFindings()`
  runs a real model's raw output through `validateRawModelOutput()` (fail
  closed on contract violation), looks up a trusted calibration record, and
  only then produces pipeline-native `Finding[]`. A future real
  `EyeModelProvider` should call this rather than constructing `Finding`
  objects by hand. **Not called by `PlaceholderDemoProvider`** (which still
  builds `Finding[]` directly, unchanged) — this is infrastructure for the
  next real provider, not a change to today's DEMO behavior.
- **Model-load health check** (`lib/models/provider.ts checkModelHealth()`,
  `GET /api/models/[id]/health`): load → validate → unload, fails closed at
  every step (unknown provider, load exception, validation rejection,
  unload exception all mark the model unhealthy). Exposed in the `/models`
  UI as a "Check health" button per model.
- **Two safety-validator rules were adjusted, not weakened**, to stop
  hard-forbidding what a real (non-DEMO) model would legitimately produce:
  `synthetic_findings_labeled` and `calibration_honesty` in
  `lib/clinical/safety.ts` now scope their hard requirement to
  `model_status === "DEMO"` specifically, rather than blocking a real
  model's honest `synthetic: false` or evidence-backed calibrated
  confidence. The DEMO model's guarantees (must always be `synthetic:
  true`, must never carry calibrated confidence) are completely unchanged
  and still enforced — verified by dedicated tests in
  `tests/phase6-model-infra.test.ts` that check both directions (DEMO still
  blocked; non-DEMO now permitted).

All of the above is exercised by 46 new tests
(`tests/phase6-model-infra.test.ts`) using a disposable, non-persisted test
model — none of it touches or weakens the real `demo-fundus-synthetic-v0`
registry entry.
