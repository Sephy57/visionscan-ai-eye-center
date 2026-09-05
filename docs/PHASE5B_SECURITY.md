# Phase 5B Security

Status: mixed - see per-item markers. Nothing below is claimed as
"implemented" unless it was actually built and verified this phase, not
merely documented.

## A real vulnerability found and fixed this phase

`GET /api/studies/[id]/image` joined the raw, unvalidated URL parameter
directly into a filesystem path (`path.join(UPLOAD_ROOT, params.id)`) with
**no bounds check and no authentication at all**. A crafted id
(URL-encoded `../../..` segments) could have read arbitrary files under
`UPLOAD_ROOT`'s parent directories, and *any* unauthenticated request could
pull any patient's scan image by guessing/enumerating a study id.

Fixed in two layers (defense in depth):
1. `lib/storage/files.ts` - `saveOriginalScan`, `readOriginalScan`, and
   `deleteStudyFiles` now route every path through `safeJoin()`
   (`lib/config.ts`, pre-existing but previously unused by these
   functions), which throws if the resolved path would escape the
   configured root.
2. `app/api/studies/[id]/image/route.ts` now requires an authenticated
   session with role `ADMIN`/`CLINICIAN`/`REVIEWER` before touching the
   filesystem at all.

Verified: `tests/phase5b-security.test.ts` "path traversal protection
(safeJoin)"; live production-mode check (`curl` with a URL-encoded
traversal payload against `next start`) returned `401` (blocked by
authentication before the path is even evaluated); `scripts/smoke.mjs`'s
"unauthenticated access rejected" check.

## Authentication / RBAC / CSRF / rate limiting / lockout

See `docs/AUTH_RBAC.md` for full detail. Summary: real (Node `scrypt`,
never plaintext), server-side-enforced on every protected route (not UI
hiding), double-submit-cookie CSRF on every mutating request, rate-limited
login, account lockout after repeated failures.

## Audit hardening

`lib/audit/index.ts`:
- **IMPLEMENTED**: every event now optionally carries `role`, `resource`,
  `resourceId`, `sessionId` fields (existing callers were not forced to
  populate all of them - `studyId`/`actor`/`action`/`outcome`/`detail`
  remain the baseline, unchanged for backward compatibility).
- **IMPLEMENTED**: hash-chain tamper evidence. Every event stores
  `prev_hash` (the previous event's hash) and its own `hash =
  sha256(prev_hash + canonical JSON of the event)`. `verifyAuditChain()`
  replays the whole chain chronologically across all daily log files and
  reports the first break. Exposed via `GET /api/admin`
  (`audit_chain_integrity`), `ADMIN`-only.
- **A real concurrency bug found and fixed while building this**: the
  initial implementation computed `prev_hash` and appended without any
  write serialization. Two `audit()` calls in flight at once (two
  concurrent requests within the same process) could both read the same
  "current last hash" before either had written, forking the chain. Fixed
  by giving `audit()` the same serialized-write-queue pattern
  `lib/storage/db.ts` already uses (`writeChain`) - this makes the chain
  correct **within one process**, which is what the real deployed app
  actually is (a single Next.js server process).
- **Documented limitation, not hidden**: this is tamper *evidence*, not
  tamper *prevention* - the OS-level process account that writes these
  files can still edit them directly. Multiple independent *processes*
  writing to the same log files (e.g. running `next dev` and a separate
  test/debug process against the same `data/logs` directory at the same
  time, which happened during this phase's own development and forked the
  chain as a pure testing artifact - not a flaw in the algorithm's intended
  single-process model) are a different writer entirely and are not
  covered by the in-process queue. Genuine write-once, tamper-*proof*
  storage requires external infrastructure (e.g. a write-once object
  store, or shipping the log to a separate append-only service) -
  **REQUIRES EXTERNAL INFRASTRUCTURE**.
- **Legacy entries**: log lines written before this feature existed have
  no `hash` field. `verifyAuditChain()` honestly reports these as
  `legacy_unchained_entries` rather than treating their absence of a hash
  as tampering.

## Encryption

- **Encryption in transit**: **REQUIRES EXTERNAL INFRASTRUCTURE.** This
  Next.js app speaks plain HTTP; it does not terminate TLS itself (no
  Next.js app should - that is a reverse proxy / load balancer's job in any
  real deployment). The `secure` cookie flag is correctly set under
  `NODE_ENV=production`, which is itself a safeguard: without a real TLS
  terminator in front, session cookies simply won't be honored by a real
  browser rather than silently traveling in the clear.
- **Encryption at rest**: **NOT IMPLEMENTED, REQUIRES EXTERNAL
  INFRASTRUCTURE.** Uploaded scans, the JSON database, and logs are stored
  as plain files on `D:\AI EYE ANALYSIS PLATFORM\data\`. This application
  does not encrypt them itself. In Windows, BitLocker (or an equivalent
  full-disk/volume encryption) applied to the `D:` volume is the correct
  mechanism for this, configured at the OS/infrastructure level, not in
  application code - claiming the *application* implements "encryption at
  rest" when it does not would be exactly the kind of overclaim this phase
  was told not to make.

## File upload / input validation (mostly pre-existing, re-verified + hardened)

| Control | Status |
|---|---|
| MIME/format allow-list (`app/api/upload/route.ts`) | **IMPLEMENTED** (pre-existing) |
| File size limit (`MAX_UPLOAD_BYTES`, 413 on exceed) | **IMPLEMENTED** (pre-existing) |
| DICOM detection, refused (not yet analyzable) | **IMPLEMENTED** (pre-existing) |
| Filename never used for path construction beyond its extension | **IMPLEMENTED** (pre-existing; re-verified this phase - `path.extname()` of the last path segment only, so a filename containing `../` cannot influence the stored path) |
| Path-traversal-safe storage (`safeJoin`) | **IMPLEMENTED this phase** (see above - this was the real gap) |
| Malware/content scanning | **NOT IMPLEMENTED, REQUIRES EXTERNAL INFRASTRUCTURE** (a real AV/content-scanning service; out of scope for an app-level change) |
| Secure temp-file handling | **IMPLEMENTED** (pre-existing, `lib/storage/files.ts cleanTmp`, unique per-write temp names in `lib/storage/db.ts`) |

## Security tests added this phase (`tests/phase5b-security.test.ts`, 36 tests)

Password hashing/policy, account lockout, disabled-account rejection,
duplicate-username rejection, session create/validate/expire/destroy, CSRF
token comparison, **RBAC enforcement via real constructed `NextRequest`
objects** (no session → 401; wrong role → 403; right role → allowed;
mutating request without CSRF header → 403; cross-role study access → 403),
rate limiting, audit hash-chain integrity + isolation from cross-file
module races, path traversal rejection (`safeJoin`), consent
defaults-to-UNKNOWN, unauthorized/ladder-skipping model transition
rejection, unknown-model-id rejection, model registry persistence surviving
re-hydration.

Live, production-mode verification (not just unit tests) also performed
this phase - see `docs/PRODUCTION_READINESS.md`'s testing section for the
actual commands and results (unauthenticated page → redirect to `/login`;
unauthenticated API → 401; path-traversal payload against the image route →
401; full authenticated upload→analyze→review→delete flow against `next
start`).

## What was explicitly NOT attempted (per the brief's own instructions)

- No real medical model installed; `data/models/` remains empty.
- No medication registry entries added; `MEDICATIONS` remains empty.
- No change to the safety validator, red-flag logic, OOD logic, symptom
  separation, finding provenance, condition gating, treatment gating, or
  DEMO model restrictions - the only edits touching that code were the
  audit-event-shape addition (additive, optional fields) and the new
  `treatment_information`/`possible_conditions` fields added in Phase 5A,
  unchanged this phase.
