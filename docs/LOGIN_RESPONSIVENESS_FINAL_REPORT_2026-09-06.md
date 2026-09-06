# VISIONSCAN AI — LOGIN / RESPONSIVENESS FINAL REPORT

**Date:** 2026-09-06 (Asia/Manila)  
**Baseline:** `a9f2e946f410c918640bc7bafdf0b6c3601b66f4` on `main`  
**Test mode:** local production server (`npm run build`, `next start`)  
**Scope:** authentication reliability, post-login navigation, JSON persistence contention, browser responsiveness, and regression safety.

## Root cause

The reported LAN login hang had two real causes:

1. In production mode, the login route issued `Secure` cookies even when the application was reached through `http://192.168.x.x`. Browsers correctly discard Secure cookies on HTTP. The POST appeared successful, but the first protected navigation had no session cookie and middleware redirected back to `/login`, appearing to users as a hang or failed sign-in.
2. The login limiter consumed its fixed-window budget for **successful** logins as well as failures. Repeated valid local/test sign-ins therefore eventually returned HTTP 429.

A separate UX defect compounded the perception: client-side `router.replace()` could remain on the login screen with “Loading dashboard…” despite successful cookie issuance. Browser tracing confirmed that the session cookies existed while the route did not transition.

Password hashing was not the bottleneck. The retained scrypt configuration is `N=16384`, `r=8`, `p=1`, `keylen=64`; no authentication work factor was reduced.

## Changes made

### Cookie transport and redirects

- Production HTTP now returns a clear **426** instead of reporting success and issuing a cookie that a browser cannot retain.
- HTTPS remains required by default.
- `ALLOW_INSECURE_LOCAL_AUTH=true` is a deliberately explicit, private/loopback-only exception for an isolated HTTP demo. It cannot enable insecure cookies for public hosts.
- `TRUST_PROXY=true` is required before forwarded HTTPS headers are honored.
- Successful login now uses `window.location.replace()` for the first protected navigation, ensuring middleware receives the newly written session cookie.
- Login `next` targets are restricted to safe local paths and cannot loop back to login/access-denied.

### Authentication UX and abuse controls

- Immediate visible “Signing in…” feedback with a lightweight spinner.
- Screen-reader status announcement.
- Duplicate-submit guard in addition to disabling the submit button.
- A 15-second bounded client timeout with a non-sensitive recovery message.
- Non-JSON/network errors are handled without leaving an indefinite spinner.
- The rate limiter now consumes budget only after failed authentication; account lockout remains independent and unchanged.

### Storage and request contention

- Session expiry and absolute-expiry are still checked on every validation.
- Sliding-session metadata is persisted at most once every five minutes rather than rewriting the whole local JSON database on every authenticated request.
- This removes avoidable serialized whole-file writes from ordinary session/dashboard traffic while preserving the 12-hour sliding timeout and seven-day absolute limit.

### Responsive UX

- Added mobile stacking for the landing split, clinician viewer workspace, and scan preview.
- Added table overflow containment to Compare, Settings, Devices, Patients, and clinician symptom views.
- Added repeatable real-Chrome responsive QA: `npm run browser:responsive`.

## Measured results

### Before

| Measure | Observation |
| --- | --- |
| Successful login POST | Typically sub-second; first local observation was approximately 280 ms. |
| Repeated valid sign-ins | Could return HTTP 429 after the tenth request within five minutes. |
| LAN HTTP production login | POST could succeed but browser discarded Secure cookies; navigation returned to login. |
| Post-login navigation | Browser could remain on “Loading dashboard…” with cookies already stored. |
| Session validation | Rewrote the approximately 8.3 MB development JSON store on every successful validation. |

### After

Repeated local production login measurements (12 valid sign-ins):

| Metric | Result |
| --- | ---: |
| Successful responses | 12/12 (no 429) |
| Login p50 | 59 ms |
| Login p95 | 111 ms |
| Login p99 | 111 ms |
| Maximum | 111 ms |

Additional measured local warmed requests before the remediation remained healthy: studies list 42 ms, synthetic upload 42 ms, analysis 99 ms, deletion 37 ms. Normal warmed UI routes were approximately 8–18 ms. The first server-rendered request after start was slower (about 208 ms), consistent with cold-start work rather than persistent lag.

## Browser, responsiveness, and accessibility

Real Chrome QA passed at both `http://localhost:3000` and the private-LAN address with the explicit local-demo setting enabled.

- Routes: login, dashboard, patients, analyze, history, result, report, clinician, settings, admin.
- Widths: 375, 414, 768, 1024, 1280, and 1440 px.
- Result: **60/60 checks passed** per browser run.
- Each check confirmed the main landmark and no document-level horizontal overflow.
- Separate login checks at 320, 375, 414, 768, 1024, 1280, and 1440 px confirmed visible labeled fields, submit control, and no horizontal overflow.
- Login includes associated labels, alert semantics, polite status announcements, disabled state, and keyboard-safe native form behavior.

## Authentication security regression

The following remain intact:

- scrypt password hashing and password policy;
- constant-time password comparison and unknown-user timing work;
- account lockout after repeated failures;
- failed-attempt rate limiting;
- `httpOnly`, `SameSite` session-cookie handling;
- CSRF double-submit enforcement;
- session expiry and absolute-expiry enforcement;
- RBAC and patient/tenant scope checks;
- PHI-safe audit logging.

The HTTP local-demo exception is opt-in and host-restricted. Shared or deployed environments must use HTTPS, or a trusted TLS-terminating proxy configured explicitly.

## Regression and release checks

| Check | Result |
| --- | --- |
| TypeScript | Passed |
| Security test file | 41/41 passed |
| Full automated suite | 36 files passed; 758 passed, 2 skipped |
| Production build | Passed |
| Application smoke test | 16/16 passed |
| Structural visual QA | 10/10 passed |
| Real-Chrome responsive QA | 60/60 passed (localhost and private LAN) |
| Filesystem audit | Passed |
| Production dependency audit | 0 vulnerabilities |
| Diff whitespace check | Passed |

CPU-intensive research inference and serialized local-JSON test cleanup have explicit integration-test budgets. Their semantic assertions are unchanged; the budgets prevent resource-bound test cleanup from being misreported as product failures on a constrained local host.

## Remaining limitations

- The JSON store remains suitable for local development, not multi-user production. A reviewed SQLite/PostgreSQL migration, encryption, backup/restore testing, retention controls, and centralized observability remain required for production deployment.
- OCR and research-only CPU segmentation can take seconds and should remain background/non-interactive work. They do not load during login or ordinary session validation.
- This is an engineering performance report, not clinical validation. VisionScan remains not clinically validated, not a medical device, and not for autonomous diagnosis, treatment, prescribing, or dosage decisions.
