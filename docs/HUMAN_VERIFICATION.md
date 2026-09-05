# Human Verification Workflow (S4)

> **Status: S4 IMPLEMENTED — a human review layer over S3's auto-extracted test
> results. This is a provenance/verification workflow, not clinical decision
> support.**
> **NOT A MEDICAL DEVICE. NOT CLINICALLY VALIDATED. NOT FOR CLINICAL USE.**
> **Verifying, correcting, or rejecting a `TestResult` never reaches diagnosis,
> triage, or treatment — there is no code path connecting them (enforced by
> tests; see "Hard boundaries" below).**

S4 answers one question: *"a machine extracted this value from a document —
does a qualified human agree it's correct?"* It does not decide what the value
means clinically, and it does not feed anything that does.

## Verification lifecycle

Every `TestResult` (see `lib/documents/extraction/testResults.ts`) starts in
one state and moves only through explicit human action, recorded server-side
by `verifyTestResult()` in `lib/documents/extraction/testResultService.ts`:

| Status | Meaning | Reached by |
|---|---|---|
| `AUTO_EXTRACTED` | machine output, never seen by a human | S3 extraction (initial state) |
| `UNREVIEWED` | explicitly queued for review | returning any state to review |
| `VERIFIED` | a reviewer confirmed the extracted value as accurate | `verify` action |
| `CORRECTED` | a reviewer supplied a corrected value | `correct` action |
| `REJECTED` | a reviewer determined the extraction cannot be trusted | `reject` action |

A result is never considered clinically verified merely because extraction
succeeded — `AUTO_EXTRACTED` and `UNREVIEWED` both render as
**"NOT A VERIFIED CLINICAL RESULT"** in the UI.

### Actions

`POST /api/results/{resultId}/verify` with `{ action, note?, correction? }`,
roles ADMIN/CLINICIAN/REVIEWER only.

- **`verify`** — "the extracted result is accurate as represented." Does not
  modify the extraction. Refused (409) if the current value failed strict
  parsing (`value === undefined`, e.g. `"2l"`) — there is nothing to confirm;
  use `correct` instead. Refused (409) on a `REJECTED` result — return it to
  review first.
- **`correct`** — records a reviewer-supplied `value` (required, finite
  number, within a conservative physical-sanity bound per test type — see
  below), and optionally `unit`/`laterality`/`note`. **The original
  extraction (`value_raw`, `value`, `unit_raw`, `source_text`, ...) is never
  modified.** The correction lives in a separate `correction` field
  (`value`, `unit`, `laterality`, `note`, `by`, `at`). Refused (409) on a
  `REJECTED` result until it is returned to review — corrections are not a
  backdoor around a rejection.
- **`reject`** — "this extraction cannot be trusted." The record and its full
  history remain in the store for audit/provenance; it is simply never
  treated as trusted evidence downstream (there is no downstream consumer in
  this system regardless — see Hard boundaries).
- **`unreview`** (Return to review) — moves any state (`VERIFIED`,
  `CORRECTED`, `REJECTED`) back to `UNREVIEWED`. Nothing is erased; this is
  additive, like every other action.

Every action appends a `VerificationEntry` (`at`, `actor`, `action`, `note?`,
`changes?`) to `verification_history`. History is append-only — no action
removes or edits a prior entry.

## Correction safety (S4.8)

Corrections are conservative by design — there is no automated "smart
correction" and no LLM-based value cleanup anywhere in this workflow:

- the corrected value must be a finite JS number (`NaN`/`Infinity`/non-numeric
  strings are rejected with 400)
- physical sanity bounds reject impossible values without inventing a
  clinical reference range: IOP ∈ [0, 200] mmHg, central subfield thickness
  ∈ [0, 5000] µm, cup-to-disc ratio ∈ [0, 1]. Visual acuity has no numeric
  bound (Snellen/logMAR are not cross-convertible and are not corrected as a
  single number).
- a corrected laterality must be one of `OD`/`OS`/`OU`/`UNKNOWN` — nothing
  else is accepted, and it is never inferred
- a corrected unit must be a short, non-empty string; it is recorded exactly
  as entered, with no invented conversion beyond the S3 registry

## Conflict handling (S4.6)

When S3 finds multiple distinct values for the same `test_type` + `laterality`
in a document, every one of them is flagged in each other's `conflicts` array.
S4 never resolves this automatically:

- no "pick the newest"
- no "pick the highest/lowest"
- no averaging
- no AI-selected "best" result

The reviewer UI shows a prominent conflict warning on every implicated result.
Rejecting or correcting one side of a conflict does **not** touch the other —
each result's verification status changes only through its own explicit
action, verified by `tests/s4-verification.test.ts` ("correcting one
conflicting value does not silently resolve the other").

## Laterality safety (S4.7)

Laterality (`OD`/`OS`/`OU`/`UNKNOWN`) is treated as safety-critical:

- `UNKNOWN` is never silently upgraded to `OD`/`OS`/`OU` by any system code —
  it only changes via an explicit reviewer correction, which is recorded
  separately from the original (still-`UNKNOWN`) extraction
- contradictory laterality in the source text (e.g. both `OD` and `OS` in one
  snippet) is extracted as `UNKNOWN` with a `contradictory_laterality` flag,
  and stays that way until a human resolves it
- laterality is never inferred from surrounding prose

## Unit and reference-range safety (S4.9 / S4.10)

- an unrecognized or absent unit is never assumed to be mmHg (or anything
  else); it stays absent with an `unknown_unit`/`missing_unit` flag until a
  human corrects it
- reference ranges are **document-sourced only** (`reference_range.source ===
  "document_text"`). S4 does not add, and must never add, hardcoded medical
  normal ranges, nor infer ranges from age/sex/disease/device. When no
  document-sourced range exists, the UI shows literally "Not provided by
  source document"

## Role-based access (S4.4)

| Role | View results | Verify | Correct | Reject |
|---|---:|---:|---:|---:|
| ADMIN | YES | YES | YES | YES |
| CLINICIAN | YES | YES | YES | YES |
| REVIEWER | YES | YES | YES | YES |
| TECHNICIAN | NO | NO | NO | NO |
| RESEARCHER | NO | NO | NO | NO |

Enforced server-side by `requireRole()` (`lib/auth/rbac.ts`) as the *first*
statement in every route handler — `app/api/documents/[id]/results/route.ts`
and `app/api/results/[resultId]/verify/route.ts` — before any data is
touched. The UI hiding a button is never the security boundary. Mutating
requests additionally require a matching double-submit CSRF token.
`tests/s4-verification.test.ts` exercises the full matrix (401
unauthenticated, 403 for TECHNICIAN/RESEARCHER, 200 for ADMIN/CLINICIAN/
REVIEWER, 404 for a fabricated result id, 403 for a missing/invalid CSRF
token, 400 for an invalid `action` value).

## Provenance (S4.5)

Every `TestResult` always carries, unmodified by any verification action:

- `document_id`, `study_id`
- `page` (1-based)
- `source_text` (the exact source-text window the value was matched from)
- `extraction_method` (`text_layer` | `ocr`) and `extraction_confidence`
- `value_raw` (exactly as extracted, before any parsing)

The reviewer UI (`components/DocumentEvidencePanel.tsx`) surfaces all of the
above beside every result, plus a link to the original PDF
(`/api/documents/{id}/file`, sandboxed, RBAC-gated, integrity-checked — see
S1) so a reviewer can navigate from a structured result back to the source
document and page.

### Audit trail (metadata only)

Every verification action is written to the tamper-evident audit log
(`lib/audit/index.ts`) with **only** `actor`, `action`, `test_type`, `page`,
and the resulting status — never `value_raw`, `source_text`, `unit`, or any
other document-derived content. This is enforced by
`tests/s4-verification.test.ts` ("verification actions never leak value_raw,
source_text, or extracted content into the audit log"), which plants PHI-like
strings (an MRN, a patient name) in a fixture document and asserts none of it
appears anywhere in the resulting audit events.

## Secure document viewer (S4.11)

The original PDF is streamed by `GET /api/documents/{id}/file`
(`app/api/documents/[id]/file/route.ts`), unchanged from S1:

- RBAC (`requireRole`) runs before any file I/O
- the on-disk path is derived only from the server-generated `document_id`,
  never from user-supplied path segments
- the served bytes' SHA-256 is verified against the hash recorded at upload
- response headers: sandboxed CSP (no embedded script execution),
  `X-Content-Type-Options: nosniff`, a server-generated
  `Content-Disposition` filename, `Cache-Control: no-store`
- the reviewer UI opens this link in a new tab (`rel="noopener noreferrer"`);
  it never embeds the PDF in a way that could execute page JavaScript against
  the parent app

S4 does not add PDF rendering/paging code of its own — it relies on the
browser's native (sandboxed) PDF viewer via this endpoint, and fails closed
(no viewer link shown) for roles without file access.

## Hard boundaries — clinical isolation

S4 does not, and structurally cannot, activate any clinical capability:

- no diagnostic model was installed; `data/models/` remains empty
- Gates A–F remain CLOSED
- no code path connects `test_results` / `TestResult` to
  `lib/analysis/*`, `lib/clinical/*`, `lib/treatment/*`, or
  `lib/reports/generator.ts`
- `tests/s3-test-results.test.ts` and `tests/s4-verification.test.ts` each
  contain a regression test that extracts an extreme value (`IOP OD 55
  mmHg`), verifies it as a human reviewer would, runs the real image-analysis
  pipeline (`analyzeStudy`), and asserts the resulting bundle contains
  neither the extracted value nor any trace of `test_results`, and that the
  triage `priority` is unaffected by it

## Limitations

- Extraction (S3) covers four test types with deterministic regex grammars;
  anything else in a document is simply not extracted (no hallucinated
  results).
- Corrections accept a single reviewer-entered value; there is no structured
  multi-field correction UI for reference ranges or dates in this phase.
- The system has no notion of a "review queue" beyond per-document listing —
  there is no cross-study worklist yet.
- This document, and the system it describes, make no claim of clinical
  validation, regulatory clearance, or diagnostic accuracy. Verified data
  here is verified *extraction accuracy*, not a clinical finding.
