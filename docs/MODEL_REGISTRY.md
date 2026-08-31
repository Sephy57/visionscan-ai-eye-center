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
