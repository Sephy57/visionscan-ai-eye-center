# VisionScan local development runbook

This runbook describes the reproducible local workflow for the current
research-only checkout. The system remains **NOT VALIDATED - NOT A MEDICAL
DEVICE - NOT FOR CLINICAL USE**.

## Prerequisites

- Windows with Node.js 20+, npm, and a local Chromium/Chrome installation.
- Dependencies installed with `npm install`.
- Optional local ophthalmic model runtime under `.venv-ophthalmic`; missing
  models/runtime must result in an explicit unavailable or synthetic path.
- Do not put real patient data in the repository checkout or demo store.

## Start locally

```powershell
cd "D:\AI EYE ANALYSIS PLATFORM"
npm install
npm run setup
npm run db:init
npm run dev
```

Open `http://localhost:3000`. The first local account can be created through
the one-time bootstrap route; subsequent runs must use an existing account.
Protected mutating requests require the session's CSRF token.

## Isolated synthetic demo

Stop any server using the demo store, then run:

```powershell
npm run demo:reset
$env:DATA_ROOT = "D:\AI EYE ANALYSIS PLATFORM\data\demo"
$env:DEMO_MODE = "true"
npm run dev
```

`demo:reset` only removes and recreates the exact `data\demo` directory,
initializes a fresh SQLite database, and writes a PHI-free manifest. It refuses
to run when `DATA_ROOT` points at another location. It does not copy model
weights or patient data.

## Verification

Fast checks:

```powershell
npm run lint
npx tsc --noEmit --pretty false
npm run model:audit
npm run audit:fs
```

The complete local release matrix is:

```powershell
npm run release:verify
```

The command runs typecheck, lint, the serialized Vitest suite, the production
dependency audit, model/filesystem/SBOM/inventory checks, FK and reconciliation
checks, the release-data gate, and the production build. It writes a PHI-free
summary under `data\tmp`. Any failed gate is retained and produces a non-zero
exit; unresolved source artifacts are not relabeled as safe.

Browser checks require a running local server and synthetic fixtures:

```powershell
npm run browser:ci
npm run browser:responsive
npm run browser:a11y
npm run browser:keyboard
npm run browser:asset-e2e
```

The asset E2E requires `SMOKE_ADMIN_USERNAME`,
`SMOKE_ADMIN_PASSWORD`, and a Chrome executable. It grants explicit
purpose-specific consent to the synthetic study before image analysis and PDF
extraction.

## Data protection operations

Use a dry run before backup or restore operations. Prefer encrypted backups
with a separately managed key:

```powershell
npm run backup:data -- --dry-run
$env:VISIONSCAN_BACKUP_ENCRYPTION = "true"
$env:VISIONSCAN_BACKUP_KEY = "use-a-secret-from-your-secret-manager"
npm run backup:data -- --encrypt
```

Never commit `.env`, database files, uploaded assets, model weights, backup
keys, or generated PHI. Restore is an operator action and must be followed by
integrity, FK, source, and application verification.

## Current release posture

Local engineering gates can be green while the release-data gate remains
blocked by unresolved active source artifacts. Clinical deployment is blocked
until external clinical validation, calibration, intended-use validation,
privacy/security operations, and data-release adjudication are independently
completed.
