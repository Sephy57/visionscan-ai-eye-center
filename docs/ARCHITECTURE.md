# Architecture

## Pipeline (safety-critical ordering)

```
IMAGE INGESTION (device adapters)
  -> FORMAT GATE (DICOM detection; unsupported = refuse, never silently analyze)
  -> QUALITY GATE (real deterministic metrics via sharp)
       fail => NO findings generated; mandatory insufficient-quality message
  -> ANATOMICAL SEGMENTATION (placeholder - emits nothing)
  -> SPECIALIZED DETECTORS (demo/synthetic only, clearly labeled)
  -> ENSEMBLE / CONSISTENCY CHECK (single detector => confidence capped, no agreement claims)
  -> UNCERTAINTY ESTIMATION
  -> CLINICAL RULE ENGINE / TRIAGE (deterministic, conservative)
  -> SAFETY VALIDATOR (schema + claims + labeling checks)
  -> STRUCTURED RESULT (schema-validated JSON)
  -> REPORT GENERATOR (cannot modify findings)
  -> CLINICIAN REVIEW (accept/reject/correct/finalize; full trail stored)
```

## Module map

| Path | Responsibility |
|---|---|
| `lib/config.ts` | Windows-safe paths from env; all data on D:; path traversal guard |
| `lib/storage/files.ts` | Originals (immutable, SHA-256), processed/reports JSON, temp cleanup |
| `lib/storage/db.ts` | JSON document store on D: (SQLite-swappable interface) |
| `lib/audit/index.ts` | NDJSON audit logs; sanitizes potentially sensitive content |
| `lib/imaging/quality.ts` | Real quality metrics: sharpness (Laplacian variance), illumination, clipping, glare, resolution, FOV |
| `lib/imaging/dicom.ts` | DICOM Part 10 detection; refused-for-analysis policy |
| `lib/devices/adapter.ts` | DeviceAdapter abstraction + registry (file import available; others placeholders) |
| `lib/models/registry.ts` | Component/version/checksum registry with honest validation status |
| `lib/analysis/schema.ts` | Structured result schema + strict validator |
| `lib/analysis/findings.ts` | Demo/synthetic finding generator (labeled, capped confidence, cautious vocabulary) |
| `lib/analysis/ensemble.ts` | Ensemble/consistency + uncertainty estimation |
| `lib/analysis/pipeline.ts` | Orchestrator; blocks forbidden claims; enforces schema |
| `lib/clinical/triage.ts` | Deterministic conservative triage; red flags; no AI downgrade |
| `lib/clinical/safety.ts` | Mechanical safety checks on every result |
| `lib/reports/generator.ts` | Report builder; cannot alter findings; no fake signatures |
| `lib/studies/service.ts` | Study lifecycle, review workflow, temporal comparison |
| `tests/` | vitest safety tests + end-to-end self-test |

## Why the detector is "demo/synthetic"

Per project mandate: **do not fake medical capability.** No validated lesion-detection model exists in this
deployment, so the detector stage emits explicitly-labeled synthetic findings with:
- `synthetic: true` on every finding
- result-level label `DEMO / SYNTHETIC RESULT - NOT FOR CLINICAL USE`
- confidence capped below "high" (no ensemble available)
- cautious vocabulary (e.g. never "blood clot" for ambiguous structures; uses
  "indeterminate focal hyperreflective region" with specialist-review language)

This keeps the entire downstream pipeline (triage, reporting, review, audit, comparison) real and testable
while making it impossible to mistake demo output for validated clinical output.

## Planned upgrades

1. Replace synthetic detector with real validated models (ONNX runtime; weights under `data\models\`).
2. SQLite on D: (`data\database\eye-ai.db`) replacing the JSON store behind the same interface.
3. DICOM parser (dcmjs or equivalent) inside a device adapter; pixel-data normalization.
4. FHIR DiagnosticReport/Observation export.
5. Authentication, RBAC, encryption at rest, consent capture, retention schedules.
6. In-image overlays: bounding regions, segmentation masks, "AI-highlighted region" heatmaps.
