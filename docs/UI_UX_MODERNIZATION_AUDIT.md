# VisionScan AI Eye Center — UI/UX Modernization Audit

Date: 2026-09-25 · Auditor: Claude Code (Opus 5.5) · Starting HEAD: `6e7f253474a5b6f3a4a76acd3ca2c875507e4253` (branch `main`)

This audit was written from the repository itself (source of truth), before page-level redesign. The design-system
stylesheet, icon set, shared primitives and shell were drafted in parallel with it; everything described
under "Current state" below is the state at `6e7f253`.

## 0. Repository facts

| Item | Value |
|---|---|
| Remote | `github.com/Sephy57/visionscan-ai-eye-center` |
| Pre-existing working-tree changes | `app/clinician/page.tsx`, `app/compare/page.tsx`, `app/devices/page.tsx`, `docs/evaluations/idrid-seg-test-20260908-raw.json` — **CRLF line-ending churn only** (content identical to HEAD with `--ignore-cr-at-eol`); `tsconfig.json` — trailing newline only; `deliverables/` untracked (decks/videos). None of these are part of this work and none will be committed by it. |
| Next.js | 16.3.4 (App Router, `proxy.ts` replaces middleware, webpack build) |
| React | 18.3.1 |
| TypeScript | 5.5.3, `strict`, `moduleResolution: bundler`, `@/*` alias; include covers `**/*.ts(x)` except `node_modules`, `data` |
| CSS | Single global `app/globals.css` (822 lines) built from **two stacked layers** ("Phase 3.1" + "Phase 2 Team L") that redefine the same tokens; one CSS module (`ValidationCenter.module.css`); heavy inline `style={{}}` (≈190 occurrences across pages/components) |
| UI / icon / chart libraries | None. Hand-rolled 23-icon SVG set (`components/icons.tsx`). No chart library. |
| Tests | vitest (node env, 95 test files), Playwright-core browser scripts (responsive, axe a11y, keyboard, asset E2E, CI, screenshots), `scripts/visual-qa.mjs` (SSR HTML invariants), `scripts/smoke.mjs` |
| ESLint | flat config, TS parser, next + react-hooks plugins, **`rules: {}`** (parse-only) |
| CI | `.github/workflows/ci.yml`: verify (ubuntu), verify-windows, verify-browser (`browser:ci` only) |
| Runtime note | `node_modules` contains Windows native binaries (better-sqlite3, sharp, swc). Server/tests must run with Windows `node.exe` from WSL. |

## 1. Route map

| Route | Kind | Data sources | Auth (server-enforced roles) |
|---|---|---|---|
| `/` | Server | `listModels()` (registry, build-time) | session cookie via proxy |
| `/login` | Client | `POST /api/auth/login` | public |
| `/access-denied` | Client | — | public |
| `/dashboard` | Client | `GET /api/studies?with_status=1`, static specialist registry | A/C/R |
| `/patients`, `/patients/[id]` | Client | `/api/patients*`, `record-analysis`, extraction, encounters, cross-modality | A/C/R (POST A/C) |
| `/analyze` | Client | `POST /api/upload` (XHR+CSRF), consent, symptoms, documents, extract, jobs | A/C/T |
| `/processing` | Client | `POST /api/analyze`, `GET/POST /api/jobs/[id]` | A/C/T |
| `/result` | Client | `GET /api/studies/[id]` + 4 panels (document evidence, evidence workspace, specialist, research analysis) | A/C/R |
| `/clinician` | Client | `GET /api/studies/[id]`, `POST /api/review/[id]`, review events | A/C/R |
| `/report` | Client | `GET /api/studies/[id]`, `/evidence` | A/C/R |
| `/history` | Client | `GET /api/studies`, `DELETE /api/studies/[id]` | A/C/R (DELETE A/C) |
| `/compare` | Client | `/api/studies`, `POST /api/compare` | A/C/R |
| `/models` | Client | `/api/models`, `/candidates`, `/coverage`, `/validation`, `/[id]/health` | mixed; coverage/validation/candidates ADMIN |
| `/evaluations` | Client | `/api/evaluations` | A/Rs |
| `/validation` | Client | `/api/validation/dashboard`, `/errors` | A/Rs (+C for errors) |
| `/validation-center` | Server shell + client | 12 read-only endpoints | mixed |
| `/devices` | Server | adapter registry (static) | — |
| `/admin` | Client | `/api/admin`, `/models`, `/health/ready`, `/admin/metrics`, `/admin/reconciliation`, `/selftest` | ADMIN |
| `/settings` | Server | static capability table | — |

Reusable components: `AppShell`, `ScanViewer`, `DocumentEvidencePanel`, `EvidenceWorkspace`, `ResearchAnalysisPanel`,
`SpecialistConsensusPanel`, `CrossModalityPanel`, `ui.tsx` (Badge, ConfidenceIndicator, QualityPanel, EmptyState,
ErrorState, StatusCard, TriageBadge), `icons.tsx`.

Authentication: `proxy.ts` redirects page routes to `/login` when the `vsa_session` cookie is absent (UX only).
Real enforcement is `requireRole()` + `lib/auth/scope.ts` in every API route; CSRF is a double-submit
(`vsa_csrf` cookie → `x-csrf-token` header) enforced for all mutating methods by `requireRole`.

Upload/analyze workflow: `/analyze` → XHR upload → purpose-specific consent (image, clinical-research, document) →
optional symptoms → optional PDF (validated, extraction job polled) → `/processing?study=` → job created and
polled → `/result?study=`. Real server job stages: `queued → preparing → validating_source → extracting_pages →
routing_assets → running_inference → persisting_analysis → generating_report → completed` (+ `failed`,
`cancelled`, `cancellation_requested`, `stale`, `retryable`).

Review workflow: `/clinician?study=` → per-finding confirm/reject/correct/indeterminate, case decisions,
notes/observations, final assessment + finalize, conflict adjudication, treatment dispositions. AI output,
clinician interpretation and final report are separate server-side records.

## 2. Findings (UX, honesty, a11y, security)

### Honesty / data-integrity defects (highest priority)
1. **Fabricated system status.** `/admin` renders eight hard-coded `"Operational"` StatusCards (Application,
   Database, Storage, Audit logging, Auth…) regardless of real health; `/dashboard` hard-codes "System status:
   Operational". Real readiness exists at `/api/health/ready` and is ignored.
2. **Processing page shows a static, fictional stage list** ("Symptom correlation", "Output schema & safety
   validation"…) that does not correspond to the server's `progress.stage` values; the real stage is only
   shown as a raw message string.
3. **`/report` and `/result` nav entry points are dead ends.** The "Reports" nav item opens `/report` with no
   study → "Report unavailable — No study id supplied" error. `/result` without a study shows an error.
4. **Settings prints an absolute filesystem path** (`D:\AI EYE ANALYSIS PLATFORM\data\`).
5. `report/page.tsx` uses a non-existent class `alert warning` for the legacy-report warning (renders unstyled).
6. Dashboard "Nine-lane review board" title is hard-coded; the lane count must follow `SPECIALTY_REGISTRY`.

### Workflow / UX
- No coherent visual language: two stacked token layers, 190+ inline styles, headings alternating between
  `stat-label` eyebrows, raw uppercase `<h3>` strings and sentence case.
- Result page: 14 full-width cards stacked **above** the viewer (mode, AI imaging review, execution table, ledger,
  OCT ROIs, document routing, DR, OCT, multi-model) push the imaging workspace below the fold; provenance
  (observed / inferred / model / clinician) is not visually distinguished; multimodal evidence is not summarized.
- Clinician review: AI output and human authority share the same card styling; **nine clinical actions use
  `window.prompt()`** (correct finding, add/remove medication, contraindication, restriction, notes, adjudication)
  — no labels, no validation, not keyboard-trappable, and invisible to screen readers; **"Finalize Report" has no
  confirmation**; the study must be typed as a raw ID (no queue).
- Intake: two-step toggle hides the upload when symptom context is edited; consent is at the bottom with no
  sense of progression; no summary of what will be submitted.
- Report: 20+ equally weighted cards; safety content repeated; no document hierarchy or section navigation.
- Patients list uses ad-hoc inline table styles and non-existent classes (`text-muted`, `btn primary`).
- Empty/error states are generic (“Something went wrong”-style), rarely explaining why and what next.

### Accessibility (pre-change)
- Prompts/confirm dialogs not accessible (see above).
- Several status indicators rely on colour only (quality ✓/✕ OK; overlay status fine; dashboard lanes colour + text OK).
- Existing strengths to keep: skip link, drawer focus trap, viewer keyboard controls, `role="status"` loaders.

### Security / privacy (from parallel audit, verified)
- **MEDIUM** `/api/health/ready` is unauthenticated and returns `database_file` (absolute path) plus raw DB
  error text. Project convention elsewhere redacts this as `<configured-database>`.
- **MEDIUM** `GET /api/studies/[id]` returns `files[].absolutePath` to A/C/R roles (not rendered by any page).
- **MEDIUM** No global security headers (CSP, frame-ancestors / X-Frame-Options, Referrer-Policy).
- **LOW** `/api/models` returns a hard-coded Windows `model_store_status.path` (not rendered).
- **LOW** image upload trusts client MIME/extension (mitigated by fixed MIME map + `nosniff` on serve).
- Verified clean: no `dangerouslySetInnerHTML` except the constant theme script; all mutations use `authFetch`/CSRF;
  scope checks on every patient-bound route; PDF validation strong; no stack traces returned.

### Test/QA invariants the redesign must preserve
Documented in full in the QA audit; key items: skip link is first focusable with class exactly `skip-link`; one
`main#main-content[tabindex]`; exactly one `class="sidebar"`, 14 `class="nav-link…"` anchors, one `banner-strip`,
no `drawer-overlay` in SSR; drawer button/dialog names; login `h1` contains "VisionScan AI", unique Username/
Password labels, single "Sign in" button; dashboard `h1` greeting; `/analyze` heading "Upload records and scan";
zero axe AA violations at 320/1280 (dark); no horizontal overflow 320–1920; no `console.error`; source-regex
contracts in `result`, `report`, `validation`, `ValidationCenterClient`.

## 3. Route classification

| Surface | Classification | Rationale |
|---|---|---|
| Landing `/` | REFINE | Good copy and honest model fabric; restyle to new system, fix "View Demo" wording |
| Login | REDESIGN | Split brand/auth layout; keep all hydration/redirect guards and labels |
| Dashboard | REDESIGN | Real-data command center: KPIs, prioritized review queue, real system readiness, coverage, specialist lanes |
| Patients | REFINE | Adopt design system; remove inline table styles |
| Patient profile | REFINE | Adopt system classes (extraction verify/correct/reject behaviour untouched) |
| Analyze / Intake / Upload | REDESIGN | Single staged workspace 01–05 with live progress rail; all consent/PDF/symptom logic preserved |
| Processing | REDESIGN | Real server-stage pipeline visualization; honest failure panel |
| Study / Result | REDESIGN | Centerpiece: identity bar, status hero, 3-zone workspace (viewer / evidence / assessment+review), evidence lanes, provenance legend |
| Image viewer (fundus/OCT) | REFINE | Toolbar grouping, status/legend row, explicit "classification only" notice for OCT |
| Findings / Conditions | REFINE | Provenance-coded finding cards; associations clearly labelled inferred |
| Specialist board | REFINE | Lanes show modality, capability, execution status, limitation, review requirement; count from registry |
| Clinician review | REDESIGN | Split AI-output vs clinician-authority columns, accessible dialogs, finalize confirmation, review queue |
| Reports | REDESIGN | Report index when no study; document hierarchy with numbered sections and single safety boundary |
| History | REFINE | Adopt system; filter chips; keep delete confirmation |
| Compare | KEEP (restyle via tokens) | Working synchronized viewer; file has pre-existing CRLF churn |
| Models | REFINE | Status legend (RESEARCH / DEMO / UNAVAILABLE / NOT VALIDATED), consistent cards |
| Evaluations / Validation | REFINE | Keep privacy strings; per-split metrics framed as research-only |
| Validation Center | KEEP | Already a bespoke module; inherits new tokens |
| Devices | KEEP (restyle) | Honest placeholder |
| Admin / System status | REDESIGN (status section) | Replace fabricated cards with real readiness checks |
| Settings | REFINE | Remove absolute path, keep capability table |
| Empty/error/blocked states | REDESIGN | `StatePanel` (what / why / next) across routes |

Nothing is REMOVED or MERGED: every route carries real functionality.

## 4. Design direction

Dark clinical canvas (`#070c12` background, layered navy surfaces), restrained cyan/blue/teal brand, amber
reserved for review/uncertainty/research, red only for danger/urgent/blocked, provenance colours always paired
with a text label and glyph. System fonts only (offline deployment — no network font loading). Subtle 150–250 ms
motion, `prefers-reduced-motion` honoured. Scan pixels are never filtered by theme.

Evidence semantics used throughout:

| Tag | Meaning | Source in data |
|---|---|---|
| ● OBSERVED | reported/documented input | `patient_context.symptoms`, document routing/measurements |
| ◇ INFERRED | deterministic rules | `symptom_correlation`, `possible_conditions`, evidence patterns |
| ◆ MODEL OUTPUT | research model | `findings`, `fundus_abnormality`, `dr_assessment`, `oct_assessment` |
| ✓ CLINICIAN CONFIRMED | signed-in reviewer | `report.review` status / final assessment |
| ○ UNAVAILABLE | capability could not run | `*_state === MODEL_UNAVAILABLE`, `MODEL_FAILED` |
| ◌ NOT ASSESSED | no input of that kind | lane without source |
