# VisionScan AI Eye Center — Final System Closure Report

Date: 2026-09-26 · Branch: `ui-modernization` · Author: Claude Code (Opus 5.5)
Scope: engineering release closure after the UI/UX modernization (no redesign). Companion reports:
[`VISIONSCAN_UI_UX_MODERNIZATION_FINAL_REPORT.md`](VISIONSCAN_UI_UX_MODERNIZATION_FINAL_REPORT.md),
[`UI_UX_MODERNIZATION_AUDIT.md`](UI_UX_MODERNIZATION_AUDIT.md).

## 1. Repository state

| Item | Value |
|---|---|
| Pre-modernization baseline | `6e7f253` (main) |
| Closure starting HEAD | `9c3fc236d58d4a987c4665e25c7e77a1eb86db1c` (verified: `261f6b7` and `9c3fc23` present, baseline is an ancestor, tree clean except pre-existing untracked `deliverables/`) |
| Ending HEAD | Last verified code commit `28e8c25c1143958afc67d0decd30d4fd33cfe959`; this report is added by the following docs-only commit (branch tip) |
| Branch | `ui-modernization` (not merged into `main`; `main` history untouched) |
| Remote parity | `origin/ui-modernization` == local after every push (verified with `git fetch` + `rev-parse`); no force push; `main` untouched |
| Hosted CI | Draft PR [#1](https://github.com/Sephy57/visionscan-ai-eye-center/pull/1) (CI triggers only on `main` pushes and PRs). Run [36180485139](https://github.com/Sephy57/visionscan-ai-eye-center/actions/runs/36180485139) on `28e8c25`: **verify ✅, verify-windows ✅, verify-browser ✅** (browser gates on a production build). Earlier run [36179460754](https://github.com/Sephy57/visionscan-ai-eye-center/actions/runs/36179460754) on `e5fa082` failed `verify-browser` (see §10) |

Commits since the baseline (oldest first):

| Commit | Purpose |
|---|---|
| `261f6b7` | External worker no longer starves new jobs behind job history |
| `9c3fc23` | UI/UX modernization |
| `0dde7d6` | Analysis enqueue idempotent per study (IMMUTABLE_EFFECT_CONFLICT root cause) |
| `acd9796` | Security headers / CSP, readiness exposure, logout CSRF |
| `dff1b30` | Worker claim + enqueue hardening after independent review |
| `f75875b` | Viewer source-availability states + reproducible browser gates in repo/CI |
| `1594e62` | Fixes from release security review and code review |
| `e5fa082` | Code simplification; overlay labels no longer clipped |
| `28e8c25` | Page headings wrap long ids on narrow screens (found by hosted CI) |
| (this report) | Closure evidence |

## 2. Exit-code-127 investigation — ROOT-CAUSED (test-harness only)

- **Command/shell:** `ALLOW_INSECURE_LOCAL_AUTH=true npx next start -p 3000` as a background job in Git Bash (MSYS2 bash 5.2.37) on Windows 11; node/npx = `C:\Program Files\nodejs`.
- **Reproduction:** started the exact command, confirmed `✓ Ready in 1904ms` and `GET /login → 200`, then stopped it the way the harness had (`Stop-Process -Force`): **exit 127**. Control: a bare `node -e "setTimeout(...)"` killed the same way also exits **127**; a normal `npx next --version` exits **0**.
- **Mechanism:** `Stop-Process -Force` terminates with native exit code **-1 (0xFFFFFFFF)** (read from `Process.ExitCode`); MSYS bash reports that as 127. It is not "command not found", not a PATH/WSL difference, and the application had not failed (server log clean, gates passing before each kill).
- **Conclusion:** every "failed, exit 127" notice followed the agent's own cleanup kill. Nothing in the repository to fix; server health is judged by readiness and logs, never by the exit code after a forced kill.

## 3. IMMUTABLE_EFFECT_CONFLICT — REPRODUCED, ROOT-CAUSED, FIXED

- **Bounded reproduction:** `next dev`, default in-process job mode, UI journey instrumented to count `POST /api/analyze`: **3/3 runs failed** with `IMMUTABLE_EFFECT_CONFLICT:analyses/anl_<study>`; **every visit sent 2 POSTs (2 job ids)**.
- **Classification:** React effect problem + duplicate mutation. `reactStrictMode: true` makes React run the processing page's mount effect twice in development; each run POSTed `/api/analyze`, `enqueueAnalysis` created a job per call, both jobs ran concurrently and the second hit the immutable-analysis guard (which worked as designed). Production does not double-invoke effects — hence not reproduced there — but a double submit or second tab could do the same.
- **Fix (`0dde7d6`, hardened in `dff1b30`):** server — `enqueueAnalysis` reuses the study's active job inside one `BEGIN IMMEDIATE` transaction (indexed `study_id` lookup), never reusing terminal, cancel-pending or over-budget jobs, and always re-dispatches the reused job; client — one in-flight job request per study.
- **Evidence after fix:** same dev scenario **3/3 pass, 1 POST each, 0 conflict lines in the server log**; 3 truly concurrent HTTP POSTs → **1 job id**; regression tests prove 3 concurrent enqueues → 1 job (**3 jobs without the fix**, demonstrated by running the test against the pre-fix `queue.ts`).

## 4. Security headers

Production policy (`next.config.mjs`, verified on the running production server and by `tests/security-headers.test.ts`):
`default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; manifest-src 'self'; media-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`
plus `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`, `Permissions-Policy`,
`Cross-Origin-Opener-Policy` / `Cross-Origin-Resource-Policy: same-origin`.

- Next.js "CSP without nonces" pattern (checked with Context7, Next.js 16.2 docs): nonces would force every statically prerendered page to render per request; `'unsafe-inline'` scripts is the documented trade-off (known limitation).
- `'unsafe-eval'` and `ws:`/`wss:` only under `next dev`. No `upgrade-insecure-requests` (loopback/LAN demos use HTTP).
- **HSTS** `max-age=31536000` only when `x-forwarded-proto: https` (TLS proxy); no `includeSubDomains`. Spoofing the header over HTTP is harmless (browsers ignore STS over HTTP, RFC 6797 §8.1).
- **Regression found by security review and fixed:** in this Next.js version a config header *replaces* a route header of the same name, so the global CSP had silently removed the stored-PDF route's `Content-Security-Policy: sandbox`. Reproduced on the running server; a later route-specific rule restores exactly `sandbox` for `/api/documents/:id/file`. The real-study gate now uploads a synthetic PDF and asserts the header the server actually sends.

## 5. Readiness endpoint

Verified anonymously exposed backend, schema/migration versions, pragmas and path hints. Now: anonymous → `{status}` + 200/503 only; signed-in session → per-dependency `ok` flags and model counts; no backend, schema, pragma, path or error text in either (`tests/auth-readiness-logout-hardening.test.ts`). Schema metadata remains available to administrators via `/api/admin/operations`.

## 6. Logout CSRF

Threat model verified: session cookie `SameSite=Lax` already blocks classic cross-site POST; logout was nonetheless the only state-changing POST without the double-submit check. Now a live session requires the CSRF header **or** a verifiable same-origin request (`Sec-Fetch-Site: same-origin`, else matching `Origin`) so a user whose CSRF cookie was lost can still sign out from the app; cross-site / same-site / foreign-Origin requests → 403 with the session kept; no session → idempotent cookie clear. The shell no longer shows the sign-in screen when sign-out was refused. 9 route-level tests.

## 7. Worker regression (`261f6b7` review)

Independent review found 2 HIGH + 4 MEDIUM issues in the worker/enqueue changes, all fixed in `dff1b30`/`1594e62`:
reused orphan jobs never dispatched (HIGH); per-pass full-table JS scan that throws past 100k rows (HIGH) → candidates now selected in SQL with a bound `LIMIT`, coalescing `status ?? state` like `normalizeJob`; not-yet-due retries holding newer work → excluded, 8 candidates tried per pass; reuse of cancel-pending/over-budget jobs → refused; deferred transactions racing across processes → `BEGIN IMMEDIATE` for enqueue and claim; legacy JSON-backend transactions → serialized.
Tests: >32 and 250-row terminal histories, legacy/unknown statuses, legacy `state`-only rows, not-due retries, **4 concurrent claims → exactly 1 winner**, reuse exclusions, in-process re-dispatch of an orphaned job, cross-study isolation, audit action `job.enqueue.reused`. No tenant leakage: `/api/analyze` enforces role, study scope and consent before enqueue; reuse is keyed by that study.

## 8. Data-integrity presentation (source availability)

The image route returns `404 {error:"SOURCE_MISSING"}` when an in-scope study's stored original is gone (auth and scope checks run first, so it cannot reveal out-of-scope studies). The viewer distinguishes **SOURCE AVAILABLE** (status chip) / **SOURCE MISSING** / **SOURCE UNAVAILABLE** (access, service, network, format) with what/why/next copy, notes **DERIVATIVE AVAILABLE** when PDF-derived OCT regions exist ("not a substitute for this original"), and draws overlays **only after the original has actually loaded**. No missing file was recreated. Coverage: classifier + real route tests (present/missing/unauthenticated) and 4 browser cases (available → 1 overlay; missing, forbidden, service error → 0 overlays).

## 9. UI regression (no redesign)

frontend-design lens on dark + light screenshots (dashboard, intake, processing, results, viewer, evidence, clinician review, report) at desktop and phone widths, plus automated checks at 320/375/390/414/768/1024/1280/1440/1920. Objective defects found and fixed: dark "Not assessed" chip 3.75:1 → 4.6:1; Validation Center code accent 1.74:1 in light → token-based; viewer overlay labels clipped at the image edge → wrap and anchor inward; viewer stuck "loading" if a cached image loaded before a reset effect → state keyed by src; clinician review queue ignored pagination and showed "nothing to review" on fetch failure → follows the cursor (bounded, disclosed) and shows "unavailable".

## 10. Test and gate results (fresh local runs on `e5fa082`; `28e8c25` adds one CSS property and a stricter gate, verified by hosted CI)

| Gate | Result |
|---|---|
| TypeScript `tsc --noEmit` | PASS |
| ESLint | PASS |
| Production build | PASS (exit 0) |
| Vitest full suite, clean run (no concurrent load) | **PASS — 97 files passed, 1 skipped; 1,269 tests passed, 13 skipped** (500.8 s) |
| Phase 8–11 acceptance (`validation:phase11`) | PASS 122/122 |
| `browser:responsive` (prod) | PASS 88/88 |
| `browser:a11y` (prod, **dark + light**) | PASS 44/44 |
| `browser:keyboard` (prod) | PASS 23/23 |
| `visual-qa` (prod) | PASS |
| `smoke` (prod) | PASS 16/16 |
| `browser:ci` (prod) | PASS 7 checks |
| `browser:real-study` (prod; new) | PASS — runtime headers incl. PDF sandbox; 2 themes × 9 widths × 6 real-study routes, 0 overflow, axe at 320/768/1280/1920, long-token wrap at 320, 4 viewer source states |
| UI journey (prod, 1440 + 390) | PASS — login → dashboard → upload (consent gate enforced) → processing (1 analyze POST) → results → viewer/evidence → clinician confirm/correct dialog → finalize confirmation → report → history → delete → sign out; 0 browser console errors |
| `npm audit --omit=dev` | 0 vulnerabilities |
| `npm audit` (incl. dev) | 2 moderate, dev-only (`vitest` → `@vitest/mocker`), pre-existing |
| Secret scan | PASS, 639 tracked files, 0 findings |
| Filesystem audit | PASS |
| Model manifest audit | PASS |

An earlier full-suite run overlapped with the production server running model inference for the browser gates and had 2 failures (`fundus-lesion-research` tamper test: Windows sharing violation on `model.safetensors` held open by the server; `s9-real-inference`: 120 s timeout under CPU contention). Both files pass in isolation (33 passed, 1 skipped); the installed artifact's SHA-256 was verified to match its manifest after both runs. The recorded result above is the clean re-run.

### Hosted CI finding

The first hosted run on `e5fa082` (run 36179460754) passed `verify` and `verify-windows` but failed `verify-browser`: the new
real-study gate found the report `h1` ("Report rep_study_…", a 23-character unbreakable id) overflowing 29 px at 320 px in
both themes. Locally it passed only because Windows' Segoe UI is narrower than the Linux runner's fallback font; reproduced
locally with a wide font (37 px → 0 px after the fix). `28e8c25` adds `h1` to the wrap rule, and the gate's 320 px pass now
also runs with a deliberately wide font so this class of defect is caught on every platform.

## 11. Production server acceptance

`npm run build` + `next start` (default in-process jobs, loopback auth): every gate in §10 plus the journey at two widths. Server log: one line besides startup — pdf.js `UnknownErrorException: Ensure that the standardFontDataUrl API parameter is provided`, emitted while extracting the gate's synthetic PDF (standard Helvetica font). Source: pre-existing `lib/documents/extraction/textLayer.ts` (`lib/documents` unchanged since the baseline); pdf.js falls back to system fonts and extraction continues. Not changed here (it would alter document rasterization used by validated extraction); see limitations.

## 12. Code review / simplification

- **code-review** (skill, `6e7f253..HEAD`, high): 1 MEDIUM (review queue pagination) + 3 LOW (sign-out ignores 403, legacy `state` rows, viewer load race) — all fixed. Independent queue review: 2 HIGH + 4 MEDIUM — all fixed (§7). No BLOCKER.
- **security-guidance** review: 1 HIGH (PDF sandbox CSP overridden — fixed), 1 MEDIUM (silent sign-out failure — fixed; the suggested "clear cookies on 403" was rejected because it would re-enable forced logout), 4 LOW (QA-script bootstrap/default credentials — fixed; CI browser gates on dev CSP — now production build; HSTS `includeSubDomains` — removed; `'unsafe-inline'` — documented).
- **code-simplifier**: behaviour-preserving cleanups in ScanViewer, db.ts, clinician queue (identical SQL); risky areas deliberately left.
- **Plugins used:** frontend-design (regression review), context7 (Next.js 16 CSP/headers/useLinkStatus/allowedDevOrigins), code-review, code-simplifier, security-guidance.

## 13. Known limitations

- `script-src 'unsafe-inline'` (static prerendering); a nonce policy would require dynamic rendering.
- `tests/resource-lease-coordination.test.ts` "two independent Node workers" is intermittently flaky: 1/10 now vs **1/20 at the baseline `6e7f253`** (measured in a baseline worktree; module unchanged). In failing runs neither worker is admitted (never both) — availability, not safety.
- pdf.js `standardFontDataUrl` warning during server-side extraction (pre-existing; fix is to pass the bundled `pdfjs-dist/standard_fonts/` path, deferred because it changes rasterization).
- `fundus-lesion-research` tamper test mutates the real installed model artifact in place; safe here (restored, hash verified) but it must not run concurrently with a server using the model.
- Legacy job rows whose relational `study_id` column is NULL are invisible to per-study reuse (pre-migration rows only; no backfill).
- The legacy JSON persistence backend remains single-process only.
- Several local studies reference originals missing from `data/uploads`; shown honestly as SOURCE MISSING, not recreated.
- Two moderate dev-only advisories (vitest).

## 14. Medical / AI boundary

No model, threshold, preprocessing, medical reasoning, provenance or clinical-safety semantics were changed in this closure. No claim of clinical validation, accuracy, diagnosis, medication selection or regulatory status was added. Engineering readiness is not clinical readiness.

- **CLINICAL VALIDATION: NOT ESTABLISHED** — all models are research artifacts, uncalibrated, not clinically validated; every output requires qualified review.
- **GENERALIZATION: NOT ESTABLISHED** — no external, multi-site, prospective evaluation exists in this repository.
- **DATA RELEASE: NOT ASSESSED** — this closure did not assess any dataset for release; QA used synthetic fixtures only and committed no patient data.

## 15. Final engineering classification

**VISIONSCAN ENGINEERING RELEASE READY — RESEARCH / CLINICIAN DECISION-SUPPORT**

Basis: every repository gate passes locally on fresh runs and on hosted CI (Ubuntu, Windows, production-build browser
gates); both previously unexplained failures are root-caused (exit 127: harness kill; IMMUTABLE_EFFECT_CONFLICT:
reproduced and fixed with regression tests); all BLOCKER/HIGH review findings are fixed; the production server passed
the full clinical journey with no unexplained runtime exceptions. The branch is merge-ready as draft PR #1 and has **not**
been merged. This classification is engineering readiness for a research / clinician decision-support system only:

- CLINICAL VALIDATION: **NOT ESTABLISHED**
- GENERALIZATION: **NOT ESTABLISHED**
- DATA RELEASE: **NOT ASSESSED**
