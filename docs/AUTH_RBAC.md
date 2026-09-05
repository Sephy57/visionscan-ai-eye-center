# Authentication & RBAC

Status: **IMPLEMENTED** (core mechanics) / see per-section notes for what is
deliberately deferred.

## Authentication

- **Password storage**: `lib/auth/passwords.ts`. Node's built-in `crypto.scrypt`
  (N=16384, r=8, p=1, 64-byte key), random 16-byte salt per password, format
  `scrypt$N$r$p$saltHex$hashHex` so parameters can be upgraded later without
  invalidating existing hashes. Verification uses `timingSafeEqual`. No
  external dependency, no plaintext ever stored or logged.
- **Password policy**: minimum 12 characters, requires upper/lower/digit,
  rejects a short list of common weak patterns. Enforced at account
  creation and every password change - a weak password cannot be set at all,
  not merely warned against.
- **Sessions**: `lib/auth/sessions.ts`. Opaque 32-byte random token in an
  `httpOnly`, `SameSite=Lax` cookie (`vsa_session`). The server stores only
  `sha256(token)`, never the raw token - a leak of the persisted JSON store
  does not hand out usable sessions. 12-hour sliding expiration, 7-day
  absolute cap. `secure` cookie flag is set automatically when
  `NODE_ENV=production` (see "TLS" below for why this matters).
- **Logout**: `POST /api/auth/logout` destroys the server-side session
  record and clears both cookies.
- **CSRF protection**: double-submit cookie pattern. A second, non-httpOnly
  cookie (`vsa_csrf`) carries a random token; every mutating request
  (POST/PUT/PATCH/DELETE) must echo it back as the `x-csrf-token` header.
  `lib/auth/rbac.ts requireRole()` enforces this before any role check, on
  every protected mutating route. The client helper `lib/auth/clientFetch.ts`
  attaches the header automatically; every page that performs a mutating
  fetch was updated to use it.
- **Rate limiting**: `lib/auth/rateLimit.ts`, applied to `/api/auth/login`
  (10 attempts / 5 minutes per username). In-memory, per-process - see the
  "Known limitations" section below.
- **Account lockout**: `lib/auth/users.ts`. 5 consecutive failed logins locks
  the account for 15 minutes, tracked per user record (works even if rate
  limiting is bypassed some other way, and survives a process restart since
  it is stored in the user record, not in memory).
- **Password reset**: admin-initiated (`POST /api/auth/reset-request`,
  `ADMIN`-only, issues a one-hour single-use token) plus
  `POST /api/auth/reset-confirm` (public, consumes the token, revokes every
  existing session for that user). Self-service "forgot password" via email
  is explicitly **DEFERRED / REQUIRES EXTERNAL INFRASTRUCTURE** - see below.
- **Bootstrap**: `POST /api/auth/bootstrap-admin` creates the first `ADMIN`
  account with no authentication required, but only while the user store is
  completely empty (checked fresh on every call). `npm run seed:admin`
  drives this from the command line. Once any user exists, bootstrap is
  permanently closed.
- **Audit logging**: every login attempt (success, unknown user, wrong
  password, locked, disabled), logout, session creation, password change,
  reset issuance/consumption, and RBAC denial is recorded via `lib/audit`
  (hash-chained - see `docs/PHASE5B_SECURITY.md`). Credentials themselves
  are never logged.

### Self-service password-reset email delivery — DEFERRED / REQUIRES EXTERNAL INFRASTRUCTURE

There is no email/SMS service connected in this deployment. An
unauthenticated "enter your username, we'll email you a reset link" endpoint
with no real delivery channel to verify the requester is a user-enumeration
and account-takeover risk, so it was deliberately not built. The
`ADMIN`-initiated flow above is the honest stand-in until a real delivery
provider is integrated.

## Roles

```
ADMIN       system configuration, model lifecycle, user management, audit access
CLINICIAN   patient studies, clinical review, finalization, treatment review
REVIEWER    clinical/research review per assigned permissions
RESEARCHER  de-identified research datasets, evaluation metrics (NEVER raw studies)
TECHNICIAN  device/upload/system operations
```

No `PATIENT` role exists - nothing in the current workflow calls for
patient-facing self-service access, so one was not invented (per the
handoff's own instruction not to add a role the workflow doesn't need).

## Route -> role matrix (as actually enforced in code, not aspirational)

| Route | Method | Roles |
|---|---|---|
| `/api/upload` | POST | ADMIN, CLINICIAN, TECHNICIAN |
| `/api/analyze` | POST | ADMIN, CLINICIAN, TECHNICIAN |
| `/api/studies` | GET | ADMIN, CLINICIAN, REVIEWER |
| `/api/studies/[id]` | GET | ADMIN, CLINICIAN, REVIEWER |
| `/api/studies/[id]` | DELETE | ADMIN, CLINICIAN |
| `/api/studies/[id]/symptoms` | GET/POST | ADMIN, CLINICIAN, REVIEWER / ADMIN, CLINICIAN, TECHNICIAN |
| `/api/studies/[id]/image` | GET | ADMIN, CLINICIAN, REVIEWER |
| `/api/studies/[id]/consent` | GET/POST/DELETE | ADMIN, CLINICIAN, REVIEWER / ADMIN, CLINICIAN, TECHNICIAN / ADMIN, CLINICIAN |
| `/api/review/[id]` | POST | ADMIN, CLINICIAN, REVIEWER |
| `/api/compare` | POST | ADMIN, CLINICIAN, REVIEWER |
| `/api/jobs/[id]` | GET/POST | ADMIN, CLINICIAN, TECHNICIAN, REVIEWER |
| `/api/models`, `/api/models/[id]` | GET | ADMIN, CLINICIAN, REVIEWER, RESEARCHER |
| `/api/models/[id]/transitions` | POST | ADMIN |
| `/api/admin` | GET | ADMIN |
| `/api/admin/access` | GET/POST/DELETE | ADMIN |
| `/api/evaluations` | GET/POST | ADMIN, RESEARCHER |
| `/api/research/metrics` | POST | ADMIN, RESEARCHER |
| `/api/auth/users` | GET/POST | ADMIN |
| `/api/selftest` | GET | **intentionally unauthenticated** - see below |

### Why `/api/selftest` is intentionally unauthenticated

It is a self-contained diagnostic/health-check endpoint: it creates its own
synthetic (non-patient) test images, exercises the pipeline, and deletes
everything it created. It exposes no real patient data. This mirrors a
common `/healthz`-style convention. In a real production deployment this
should additionally be restricted at the infrastructure layer (internal
network only, or behind its own auth) - marked **REQUIRES EXTERNAL
INFRASTRUCTURE / operational decision**, not implemented here because it
depends on the specific deployment topology.

## Study access control

Every route above verifies the session and role **server-side**, before
touching any data - never by hiding a UI element. A `RESEARCHER` session
cannot retrieve `/api/studies/[id]` (or the raw scan image, or symptoms, or
review data) no matter what id is guessed in the URL, because the role
check runs first and unconditionally. This was verified directly:
`tests/phase5b-security.test.ts` constructs real `NextRequest` objects with
a valid session cookie for a disallowed role and asserts `requireRole()`
returns 403, and separately asserts a request with no session at all
returns 401.

This remains role-based access control at the endpoint boundary, but it is
now paired with patient/tenant scope checks in `lib/auth/scope.ts`. New
patient-bound studies and patients carry optional `tenant_id` and owner
metadata; non-admin callers must match the owner or an active
`access_grants` record. Tenant mismatches fail closed. An ADMIN can grant or
revoke assignments through `POST/DELETE /api/admin/access` (the grant is
append-only/audited). Study-linked documents, images, test results, jobs,
reports, reviews, evidence, consent, and record-analysis routes resolve back
to the owning study before returning data or mutating state. List endpoints
filter inaccessible rows, and guessed resource ids return 404 to avoid
confirming existence.

Records created before scope metadata was introduced, or synthetic local
fixtures without a patient/tenant/owner key, retain a narrow legacy
compatibility path for development. They must be migrated and assigned
before any deployment that handles real PHI; the JSON persistence layer is
still explicitly not production-ready.

## `reviewer_id` is never client-supplied

Before this phase, `POST /api/review/[id]` trusted a `reviewer_id` string
typed into a text field. That has been removed: the route now always
derives the reviewer's identity from the authenticated session
(`app/api/review/[id]/route.ts`), so one clinician can no longer attribute a
review decision to another clinician's name in the audit trail. The
clinician UI's manual "Reviewer ID" field was removed accordingly.

## Known limitations (disclosed, not hidden)

- **Rate limiting is in-memory, per-process.** Correct for this
  single-instance deployment; a horizontally-scaled deployment needs a
  shared store (Redis or equivalent) - **REQUIRES EXTERNAL INFRASTRUCTURE**.
- **TLS/HTTPS is not provided by this application** - it is a Next.js app
  listening on plain HTTP. The `secure` cookie flag is set automatically
  under `NODE_ENV=production`, which means session/CSRF cookies will
  **not** be sent back by a real browser unless the deployment actually
  terminates TLS in front of it. Running "production mode" without a TLS
  terminator would break login for real browsers - this is intentional
  (fail safe, not fail open) but must be paired with a reverse proxy /
  load balancer providing HTTPS in any real deployment - **REQUIRES
  EXTERNAL INFRASTRUCTURE**.
- **No self-service "forgot password" email flow** (see above).
- **No MFA.** Not requested in the brief; not implemented.
