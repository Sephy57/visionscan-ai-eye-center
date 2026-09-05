# Architecture

## Pipeline (safety-critical ordering)

```
IMAGE INGESTION (device adapters)
  -> FORMAT GATE (DICOM detection; unsupported = refuse, never silently analyze)
  -> QUALITY GATE (real deterministic metrics via sharp)
       fail => NO findings generated; mandatory insufficient-quality message
  -> MODEL REGISTRY GATE (status + integrity + evidence checks)
  -> OOD / OPERATING-CONDITION GATE (modality, device compatibility, metadata, image characteristics)
       detected => no normality claims; "Automated interpretation is inconclusive."
  -> ANATOMICAL SEGMENTATION (placeholder - emits nothing)
  -> SPECIALIZED DETECTORS via EyeModelProvider (DEMO/synthetic only, clearly labeled;
     taxonomy-checked: only registry-declared findings for the matching modality)
  -> ENSEMBLE / CONSISTENCY CHECK (single detector => confidence capped, no agreement claims)
  -> UNCERTAINTY ESTIMATION (raw vs calibrated confidence kept separate)
  -> SYMPTOM CORRELATION (post-hoc; rules-based; CONTEXT ONLY - never creates findings
     or diagnoses; states: correlated / not_explained / inconclusive / conflicting / urgent)
  -> POSSIBLE CONDITIONS (empty unless model is validated + registered + modality matches
     + relevant findings detected)
  -> CLINICAL RULE ENGINE / TRIAGE (deterministic, conservative; red-flag symptoms escalate
     without a model diagnosis; AI can never downgrade)
  -> SAFETY VALIDATOR (schema + claims + labeling + measurement + OOD checks)
  -> STRUCTURED RESULT (schema-validated JSON)
  -> REPORT GENERATOR (cannot modify findings; model card + validation status surfaced)
  -> CLINICIAN REVIEW (confirm/reject/correct/indeterminate/request-new-scan/finalize;
     AI output, clinician interpretation, and final report stored separately)
  -> APPEND-ONLY AUDIT (event log + per-analysis provenance record)
```

## Module map

| Path | Responsibility |
|---|---|
| `lib/config.ts` | Windows-safe paths from env; all data on D:; path traversal guard |
| `lib/storage/files.ts` | Originals (immutable, SHA-256), processed/reports JSON, temp cleanup |
| `lib/storage/db.ts` | JSON document store on D: (SQLite-swappable interface; development only) |
| `lib/audit/index.ts` | NDJSON audit logs; sanitizes potentially sensitive content |
| `lib/observability/metrics.ts` | Bounded, PHI-free process-local operational counters (not production telemetry) |
| `lib/imaging/quality.ts` | Real quality metrics: sharpness (Laplacian variance), illumination, clipping, glare, resolution, FOV |
| `lib/imaging/dicom.ts` | DICOM Part 10 detection; refused-for-analysis policy |
| `lib/devices/adapter.ts` | DeviceAdapter abstraction + registry (file import available; others placeholders) |
| `lib/models/registry.ts` | Strict model registry: statuses, gates, device compatibility, evidence rules |
| `lib/models/modalities.ts` | Canonical modality vocabulary + model/input compatibility |
| `lib/models/integrity.ts` | Artifact SHA-256 verification; refuse-on-mismatch |
| `lib/models/provider.ts` | EyeModelProvider interface + placeholder DEMO provider |
| `lib/analysis/taxonomy.ts` | Controlled finding vocabulary; OBSERVATION/ASSOCIATION/DIAGNOSIS separation |
| `lib/analysis/ood.ts` | Out-of-distribution / unsupported operating conditions |
| `lib/research/metrics.ts` | Sens/spec/PPV/NPV/AUROC/AUPRC/ECE/confusion/subgroups (research-only) |
| `lib/research/datasets.ts` | Datasets, patient-level split enforcement, locked test sets, multi-grader adjudication |
| `lib/analysis/schema.ts` | Structured result schema + strict validator |
| `lib/analysis/findings.ts` | Demo/synthetic finding generator (labeled, capped confidence, cautious vocabulary) |
| `lib/analysis/ensemble.ts` | Ensemble/consistency + uncertainty estimation |
| `lib/analysis/pipeline.ts` | Orchestrator; blocks forbidden claims; enforces schema |
| `lib/clinical/triage.ts` | Deterministic conservative triage; red flags; OOD rule; no AI downgrade |
| `lib/clinical/safety.ts` | Mechanical safety checks on every result |
| `lib/reports/generator.ts` | Report builder; cannot alter findings; no fake signatures |
| `lib/reports/modelCard.ts` | Auto-generated model cards from registry fields only |
| `lib/studies/service.ts` | Study lifecycle, review workflow, temporal comparison |
| `tests/` | vitest safety/registry/research tests + end-to-end self-test |

## Why the detector is "demo/synthetic"

Per project mandate: **do not fake medical capability.** No validated lesion-detection model exists in this
deployment. The detector stage is a registered DEMO model (`demo-fundus-synthetic-v0`) behind the
EyeModelProvider interface that emits explicitly-labeled synthetic findings with:
- `synthetic: true` on every finding, taxonomy level "observation"
- result-level label `DEMO / SYNTHETIC RESULT - NOT FOR CLINICAL USE`
- confidence capped below "high" (no ensemble available), no calibrated percentages
- cautious vocabulary (never "blood clot"; "indeterminate focal hyperreflective region" with
  specialist-review language)
- taxonomy enforcement: only registry-declared findings for the matching modality are emitted

This keeps the entire downstream pipeline (triage, reporting, review, audit, comparison) real and testable
while making it impossible to mistake demo output for validated clinical output.

## Adding a real model later (integration path)

1. Place the artifact under `data\models\<model_id>\` (ONNX recommended via onnxruntime-node).
2. Register a `ModelRecord` with the true SHA-256, scope, datasets, and status `RESEARCH`.
3. Implement `EyeModelProvider` (load/validate/analyze/capabilities/metadata/unload). Inside `analyzeStudy()`,
   convert the runtime's raw output through `lib/models/outputConversion.ts convertRawModelOutputToFindings()`
   (contract validation + trusted calibration lookup) rather than constructing `Finding` objects by hand — see
   `docs/MODEL_REGISTRY.md`'s "Phase 6 additions" section for what already exists and is tested.
4. Add the model to the provider registry (`getProviderForModel()` resolves it by model id); the pipeline
   gates (now including a real device-compatibility hard gate, not just modality), taxonomies, triage,
   reporting, review, and audit apply automatically. Register a `CalibrationRecord` via
   `lib/models/calibrationRegistry.ts` once real calibration evidence exists — never before.
5. Only after the full validation framework (docs/VALIDATION.md) + evidence references can the status advance.
6. Use `GET /api/models/[id]/health` to verify the provider actually loads/validates/unloads cleanly before
   ever routing real study traffic to it.

## Planned upgrades

1. Replace synthetic detector with real validated models (ONNX runtime; weights under `data\models\`) — the
   provider boundary, output-contract validation, calibration registry, and device-compatibility gate this
   requires are now implemented and tested (Phase 6 infrastructure); only the actual model artifact and
   provider implementation remain.
2. SQLite on D: (`data\database\eye-ai.db`) replacing the JSON store behind the same interface.
   Run `npm run migration:preflight` before any reviewed importer; it is a
   non-destructive dry-run that emits source hashes and collection counts.
3. DICOM parser (dcmjs or equivalent) inside a device adapter; pixel-data normalization.
4. FHIR DiagnosticReport/Observation export.
5. ~~Authentication, RBAC~~ — **implemented, Phase 5B** (see `docs/AUTH_RBAC.md`). Encryption at rest, consent
   enforcement (the data model exists, Phase 5B; not wired as a hard gate — see
   `docs/CONSENT_DATA_GOVERNANCE.md`), and retention schedules remain open.
6. In-image overlays: bounding regions, segmentation masks, "AI-highlighted region" heatmaps.
