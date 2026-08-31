# AI Eye Scan Analysis & Clinical Decision-Support Platform

A medical-grade **architecture** for AI-assisted analysis of ophthalmic images — engineered as a screening and
clinical decision-support system with mandatory human oversight, not as a diagnostic product.

> **Honest status: NOT VALIDATED — NOT A MEDICAL DEVICE — NOT FOR CLINICAL USE.**
> Every detection/segmentation component in this deployment is an unvalidated placeholder or heuristic.
> The demo analysis engine generates **synthetic findings** so the full safety-critical pipeline can be exercised.
> No fabricated capability is presented as real.

## Project location

All project code, data, models, logs, and the Git repository live on drive D:

```
D:\AI EYE ANALYSIS PLATFORM\
```

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
| `/analyze` | Upload / scan |
| `/processing` | Analysis progress |
| `/result` | Analysis result |
| `/history` | Previous scans (with deletion) |
| `/compare` | Historical comparison |
| `/report` | Detailed report (PDF via print, JSON export) |
| `/clinician` | Clinician review interface (accept/reject/correct/finalize) |
| `/settings` | Account / privacy / data control |
| `/devices` | Connected devices & adapter registry |
| `/admin` | System administration, self-test, audit trail |

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
