# VisionScan AI — AI Eye Scan Analysis & Clinical Decision-Support Platform

A medical-grade **architecture** for AI-assisted analysis of ophthalmic images — engineered as a screening and
clinical decision-support system with mandatory human oversight, not as a diagnostic product.

> **Honest status: NOT VALIDATED — NOT A MEDICAL DEVICE — NOT FOR CLINICAL USE.**
> Every detection/segmentation component in this deployment is an unvalidated placeholder or heuristic.
> The demo analysis engine generates **synthetic findings** so the full safety-critical pipeline can be exercised.
> No fabricated capability is presented as real. `data\models\` is intentionally empty.

## Phase 2 additions (clinical validation readiness)

- **Strict model registry** (`lib/models/registry.ts`): checksums, modality/anatomy/finding/device scope,
  intended use, limitations, dataset descriptions, performance metrics (null until measured, with evidence
  references), validation/regulatory status, lifecycle gates (DEMO → RESEARCH → INTERNAL_VALIDATION →
  EXTERNALLY_VALIDATED → CLINICALLY_VALIDATED / RETIRED).
- **Model integrity verification**: artifact → SHA-256 → registry → gates; mismatches refuse execution.
- **EyeModelProvider interface**: ONNX / PyTorch / TensorFlow / local / remote providers plug in without
  changing the clinical workflow (`lib/models/provider.ts`).
- **Finding taxonomy** (`lib/analysis/taxonomy.ts`): OBSERVATION / POSSIBLE ASSOCIATION / DIAGNOSIS strictly
  separated; retinal vascular + OCT finding schemas prepared; "blood clot" vocabulary forbidden.
- **OOD layer** (`lib/analysis/ood.ts`): unsupported modality/device, missing metadata, atypical inputs →
  "Input is outside the validated operating conditions of this model." Normality is never claimed.
- **Research layer** (`lib/research/`): dataset management with patient-level split enforcement, read-only
  locked test sets, multi-grader annotation + adjudication, and evaluation tooling (sensitivity, specificity,
  PPV, NPV, AUROC, AUPRC, ECE calibration, confusion matrix, subgroup breakdowns — never accuracy alone).
- **Strengthened review workflow**: AI output, clinician interpretation, and final report stored separately;
  new actions: Confirm, Mark Indeterminate, Request New Scan; every change audited.
- **UI redesign**: premium medical-tech design system (light/dark), imaging viewer (zoom/pan/fit/fullscreen/
  overlay), dashboard, timeline history, side-by-side compare, printable reports.

- **Symptom intake & correlation (Phase 3)**: structured patient symptoms (type/onset/duration/severity/
  laterality/progression/frequency), red-flag safety escalation independent of model output, transparent
  rules-based symptom/imaging correlation (CORRELATED / NOT EXPLAINED / INCONCLUSIVE / CONFLICTING / URGENT),
  condition taxonomy gated to validated models only — symptoms never create findings or diagnoses
  (`docs/SYMPTOM_CORRELATION.md`).

## Quick start

```powershell
cd "D:\AI EYE ANALYSIS PLATFORM"
npm install        # first time only
npm run setup      # (re)create data directories on D:
npm run dev        # start dev server at http://localhost:3000
```

Production-style run:

```powershell
npm run build
npm start
```

Stop: press `Ctrl+C` in the terminal running the server (or stop the Node process).

## Test suite

```powershell
npm test           # vitest: schema, triage, ensemble, safety, wording, DICOM, path-safety tests
```

End-to-end self-test (synthetic images, cleans up after itself):

```powershell
# via the Admin page (/admin -> Run self-test) or:
curl http://localhost:3000/api/selftest
```

Filesystem audit (verifies data is on D:):

```powershell
npm run audit:fs
```

## Pages

| Route | Purpose |
|---|---|
| `/` | Landing page |
| `/dashboard` | Workspace dashboard (recent studies, quick actions, system status) |
| `/analyze` | Upload / scan |
| `/processing` | Analysis progress |
| `/result` | Analysis result with imaging viewer |
| `/history` | Previous scans (timeline, with deletion) |
| `/compare` | Historical comparison (side-by-side viewer) |
| `/report` | Detailed report (PDF via print, JSON export) |
| `/clinician` | Clinician review interface (confirm/reject/correct/indeterminate/request-scan/finalize) |
| `/settings` | Privacy, data control, capability matrix |
| `/devices` | Device manager & adapter registry |
| `/admin` | System status, model registry, self-test, audit trail |

API: `/api/upload`, `/api/analyze`, `/api/studies[/:id][/image]`, `/api/compare`, `/api/review/:id`,
`/api/models`, `/api/research/metrics`, `/api/selftest`, `/api/admin`.

## Storage layout (all on D:)

```
data\uploads\    original scans (never modified, SHA-256 recorded)
data\processed\  structured analysis results
data\reports\    generated reports
data\database\   JSON document store (SQLite file path reserved: data\database\eye-ai.db)
data\models\     model storage (no models installed yet)
data\logs\       audit NDJSON logs (metadata only, never images)
data\tmp\        temp files, auto-cleaned
```

Configuration is via `.env` (see `.env.example`). Never commit `.env`.

## Architecture

See `docs/ARCHITECTURE.md`. Pipeline:
ingestion → quality gate → segmentation (placeholder) → specialized detectors (demo/synthetic) →
ensemble/consistency → uncertainty → clinical rule engine → report generator → safety validator.

## Safety rules implemented mechanically

- Quality gate failure blocks all clinical findings.
- Structured output must validate against the schema or the result is rejected.
- Safety validator blocks diagnostic absolutes; demo findings must be labeled synthetic.
- Triage is deterministic and conservative; AI output can never lower a triage level.
- Red-flag symptoms escalate to urgent/emergency triage.
- DICOM/unsupported formats are detected and refused, never silently analyzed.
- Negative results carry the mandatory caveat: "does not guarantee that no eye disease is present."
- Originals preserved; model versions, ruleset, and audit events recorded for every analysis.

## Validation pathway

See `docs/VALIDATION.md` for the validation framework (sensitivity/specificity/AUROC/calibration, dataset
protection, per-device validation, locked test sets) that must be completed before any clinical claim.

## Known C: dependencies

Node.js, npm, and the global npm cache live on C: (system installations). npm's cache can be redirected to D:
(`npm config set cache "D:\npm-cache"`). Everything this application creates is on D: — see
`npm run audit:fs`.
