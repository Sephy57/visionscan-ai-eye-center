# Production Readiness — Phase 5B

## Current checkout snapshot (2026-09-12)

This document is a historical phase record. For the current source of truth,
use [docs/VISIONSCAN_FULL_SYSTEM_REPORT_2026-09-12.md](VISIONSCAN_FULL_SYSTEM_REPORT_2026-09-12.md)
and [docs/DEVELOPMENT_RUNBOOK.md](DEVELOPMENT_RUNBOOK.md). The current
checkout defaults to SQLite, includes three hash-verified local RESEARCH-only
model packages, enforces purpose-specific consent at HTTP and durable-job
processing boundaries, validates safety before publication and on broad reads,
and exposes a claim/evidence ledger. Clinical deployment remains blocked.

The Phase 5B statements below are retained as historical evidence of the
earlier implementation state; where they conflict with the current checkout,
the current report and executable code take precedence.

## Overall status

**HISTORICAL PHASE 5B STATUS — SUPERSEDED BY CURRENT CHECKOUT REPORT**
**NOT CLINICALLY DEPLOYABLE**
**NOT VALIDATED — NOT A MEDICAL DEVICE — NOT FOR CLINICAL USE**

Do not read "production engineering ready" as any form of clinical,
regulatory, or accuracy claim. It means: the software engineering
foundation (auth, RBAC, persistence, audit, tested security controls) has
moved from a single-user research demo toward something a real deployment
could build on. It says nothing about whether the *clinical* content (the
DEMO placeholder model, the empty medication registry) is fit for any
patient-facing use, because it isn't - no real model or medication data
exists in this deployment.

## What this phase actually changed, in one paragraph

Added: persistent model lifecycle state (survives restart), full
username/password authentication with scrypt hashing, session cookies with
CSRF protection, five-role RBAC enforced server-side on every protected API
route, a fixed path-traversal vulnerability in the scan-image route, a
purpose-specific consent data model and HTTP/durable-job hard gate, audit-log
hash-chaining with a fixed write-race, 36 new security tests, and
authenticated end-to-end verification in both `next dev` and `next start`
(production) modes. Did not change: the clinical safety pipeline, red-flag
logic, OOD logic, symptom separation, condition/treatment gating, or the
DEMO model's restrictions - all re-verified passing, not just left alone.

## Intended use, target users, target population (unchanged from prior phases)

- **Intended use**: research/engineering exercise of a screening-architecture
  pipeline for ophthalmic imaging. Not validated for any diagnostic or
  clinical decision-making use.
- **Target users** (application roles, not regulatory "intended users"):
  ADMIN, CLINICIAN, REVIEWER, RESEARCHER, TECHNICIAN accounts, as defined in
  `docs/AUTH_RBAC.md`.
- **Target population**: none - no real patient population is served by
  this deployment. Any imaging in this system today is either synthetic
  test data or, if a real image is uploaded, is processed only by the
  labeled DEMO/synthetic detector, never a validated model.

## Supported modalities / devices / clinical claims

Unchanged from Phase 4/5A: modalities and devices are only ever those a
registered model explicitly declares support for (`lib/models/registry.ts`,
`lib/models/modalities.ts`) - the only registered model is the DEMO
placeholder, which declares `FUNDUS`/`EXTERNAL_EYE` and zero validated
devices. **No clinical claims are made anywhere in the codebase** - grepped
this phase for `100%`, `FDA`, `CE cert`, `diagnostic confidence`; zero hits
outside the regex patterns that exist specifically to *block* such
language.

## Risk classification / regulatory pathway

Not determined - this requires an actual clinical/regulatory affairs review
of a *real* model and intended use, neither of which exists yet. Marked
**REQUIRES CLINICAL VALIDATION** and **REQUIRES REGULATORY REVIEW**. Nothing
in this codebase should be read as a risk classification.

## Quality management / cybersecurity / privacy requirements

| Area | Status |
|---|---|
| Cybersecurity - auth, RBAC, session management, CSRF, rate limiting, audit | **IMPLEMENTED**, tested (see `docs/PHASE5B_SECURITY.md`) |
| Cybersecurity - encryption in transit / at rest | **REQUIRES EXTERNAL INFRASTRUCTURE** (TLS terminator, disk/volume encryption) - not implemented by this application, and should not be |
| Privacy - de-identification boundary, research/clinical separation | **IMPLEMENTED** (see `docs/CONSENT_DATA_GOVERNANCE.md`) |
| Privacy - consent architecture | **IMPLEMENTED (data layer + API + processing gate)**; direct library fixtures remain explicitly ungated and production operations still require policy |
| Quality management system (design controls, CAPA, etc.) | **NOT APPLICABLE YET** - no QMS exists because there is no product being taken to market; would be required before any real clinical deployment |

## Clinical evaluation

Not performed - no real model exists to evaluate. The *infrastructure* to
run one (patient-level leakage detection, locked test sets, multi-grader
adjudication, sensitivity/specificity/AUROC/AUPRC/calibration, false-negative
and subgroup analysis, symptom-stratified evaluation) was built in Phase 4
and remains in place, untouched this phase.

## Post-market surveillance / change management / model update policy

- **Model update safety**: `lib/models/transitions.ts` requires a new
  model id/version to go through the same evidence-gated ladder as any
  other status change; there is no "silently replace the running model"
  code path. **Rollback**: reverting `MODELS` in `registry.ts` plus
  clearing the corresponding `model_registry_state` entry restores the
  prior state - this is a manual, code-level rollback today, not an
  automated one-click rollback. Marked **PARTIALLY IMPLEMENTED**.
- **Medication knowledge update safety**: `lib/treatment/medications.ts
  recordMedicationKnowledgeChange()` logs old/new version, source,
  reviewer, date, reason, and affected medications/conditions - built in
  Phase 5A, unchanged. There is nothing to version yet since the registry
  is empty.
- **Post-market surveillance**: **NOT APPLICABLE YET** - there is no
  deployed clinical product being surveilled.

## Human factors / usability

Not formally evaluated (no usability study performed). The UI enforces the
mandated separations (patient-reported vs. model-detected vs. commonly-
associated symptoms; findings vs. possible conditions vs. treatment
information vs. clinician-approved final assessment) structurally, in the
data model and safety validator, not merely as a visual convention - see
`docs/PHASE4_AUDIT.md` and Phase 5A's report for detail.

## Testing performed this phase (actual commands, actual results)

| Check | Result |
|---|---|
| `npm test` | **244/244 passed** (7 files; +36 new security tests over the prior 208) |
| `npm run smoke` | **16/16 passed** (14 prior checks + 2 new: unauthenticated access rejected, cross-role access handled) - run against `next dev` |
| `npm run build` | **Passed** |
| `npm run audit:fs` | **Passed** |
| `node scripts/visual-qa.mjs` | **10/10 routes passed** |
| `GET /api/selftest` | **15/15 passed** |
| **Production-mode** (`npm run build && NODE_ENV=production npm start`) | Server started cleanly. Verified: unauthenticated page request → `307` to `/login`; unauthenticated `/api/studies` → `401`; unauthenticated `/api/studies/[id]/image` → `401`; a URL-encoded path-traversal payload against the image route → `401` (blocked before any filesystem access); `/login` reachable (`200`); full authenticated flow (bootstrap → login → upload → symptom intake → analyze → review/finalize → compare → delete) via `scripts/smoke.mjs` against the running production server → **16/16 passed**; `visual-qa.mjs` re-run against production → **10/10 passed**; `/api/selftest` against production → **15/15 passed**. |

A genuine bug was found and fixed *during* this verification work, not
merely during initial implementation: `verifyAuditChain()` initially
mis-flagged legacy pre-hash-chain log lines as tampering, and a real
write-race in `audit()` (unserialized concurrent writes) was caught by the
test suite and fixed with the same write-queue pattern already used by the
JSON store. Both are documented in `docs/PHASE5B_SECURITY.md` rather than
silently fixed and left unmentioned.

## Remaining blockers to any real clinical deployment

1. No real, validated model - `data/models/` is empty by design.
2. No populated medication knowledge base - `MEDICATIONS` is empty by design.
3. TLS termination and disk encryption are infrastructure the deploying
   organization must provide - not application code.
4. Purpose-specific consent processing gates are implemented in the current
   checkout; a deployment handling real patients must retain that gate and
   canonical subject binding.
5. Retention policy, backup/restore automation, and a formal data-subject-
   rights workflow are documented as gaps, not built.
6. No QMS, no clinical evaluation, no regulatory pathway determination -
   all require a real model and a real organizational decision to pursue.
7. Rate limiting is single-process/in-memory; a scaled-out deployment needs
   a shared store.
8. `/api/selftest` should be restricted at the infrastructure layer in a
   real deployment (it is intentionally open today as a health-check
   convention for this local/demo environment).

## Addendum — Phase 6 buildable infrastructure (pre-model-artifact)

Per the Phase 5B → Phase 6 readiness audit, the following infrastructure was
built and tested ahead of any real model artifact being supplied (none has
been, and none was fabricated or downloaded):

- Device compatibility is now a real execution gate (`gateModelUse(model, device)`), not just displayed.
- Calibration registry (`lib/models/calibrationRegistry.ts`) — evidence-gated, persisted.
- Raw-output → `Finding[]` conversion chokepoint (`lib/models/outputConversion.ts`), wiring
  `outputContract.ts` + `calibration.ts` into the actual conversion path for the first time.
- Model-load health check, fail-closed (`GET /api/models/[id]/health`).
- Two safety-validator rules (`synthetic_findings_labeled`, `calibration_honesty`) scoped to
  `model_status === "DEMO"` specifically, so a future real model isn't forced to falsely claim synthetic/demo
  output — the DEMO model's own guarantees are unchanged and re-verified.
- 46 new tests (`tests/phase6-model-infra.test.ts`), full regression re-run: **290/290** tests, **16/16**
  smoke, **10/10** visual QA, build clean, live health-check endpoint verified authenticated end-to-end.

`clinical_use` remains `RESEARCH_ONLY` / effectively `DISABLED` (no conditions or treatment information can be
displayed for any model that isn't `EXTERNALLY_VALIDATED`/`CLINICALLY_VALIDATED` with evidence, which nothing
is). `data\models\` remains empty. No model artifact has been installed.

## Project path

`D:\AI EYE ANALYSIS PLATFORM\`
