# PDF Document Pipeline (S1 ingestion + S2 extraction + S3 structured results)

> **Status: S1 IMPLEMENTED — ingestion, structural validation, immutable storage, RBAC, audit.**
> **S2 IMPLEMENTED — text-layer extraction, scanned-page OCR (tesseract.js), page-level provenance,
> artifact storage separate from originals, async job lifecycle.**
> **S3 IMPLEMENTED — deterministic rules-based structured test results (IOP, VA, CST, CDR) with
> strict ambiguity preservation ("2l" is NEVER corrected to "21"), registry-only unit conversion,
> document-sourced reference ranges, explicit laterality, conflict flags, and the server-side
> human-verification core (verify/correct/reject with additive history).**
> **S5/S7 integration note:** accepted API uploads now enqueue S2 extraction automatically;
> the browser also polls that job and exposes the resulting evidence workspace. Document-derived
> symptoms, history, medications/allergies and source-document diagnosis claims remain
> `DOCUMENT_EXTRACTED`/`UNREVIEWED`; they are never silently promoted to VisionScan diagnoses.
> Structured test results remain a separate, unreviewed source and do not enter the image model.
> Full S3 rules: docs/TEST_RESULT_EXTRACTION.md. Full S3/S2 status: see that document and
> docs/OCR_DECISION.md.

## S2 — extraction layer (what exists now)

### Data flow

```
POST /api/documents/[id]/extract   (ADMIN | CLINICIAN | TECHNICIAN) -> { job_id } (async, jobs queue)
  -> integrity re-check (on-disk bytes vs recorded SHA-256) - refuses on mismatch
  -> document status: VALID -> PROCESSING
  -> per page:
       text layer via pdfjs (pages with >= MIN_TEXT_LAYER_CHARS chars)
       otherwise -> embedded page image extracted via pdf-lib (DCTDecode via
       libjpeg; FlateDecode with PNG-predictor reconstruction; others fail
       closed as page_render_unavailable) -> OCR via tesseract.js
       (per-page timeout; engine confidence recorded)
  -> limits enforced: chars/page, chars/doc (truncation + warning), total time
  -> artifact JSON written SEPARATELY to data\documents\extracted\<id>.json
  -> document status: READY (or FAILED on fatal errors; PARTIAL recorded in artifact)
GET  /api/documents/[id]/text    (ADMIN | CLINICIAN | REVIEWER ONLY - PHI-bearing)
GET  /api/documents/[id]/status  extended with an extraction SUMMARY (never text)
POST /api/jobs/[id] {action:"cancel"}  cooperative cancellation between pages
```

### Provenance & uncertainty (S2)

Every artifact page records: `page`, `method` (text_layer | ocr | empty | ocr_failed),
`char_count`, `text`, `confidence` (OCR only, 0-100, engine-reported), `warnings`, and
`ocr` provenance (engine, engine_version, language, time_ms, render dimensions). The
artifact records `extraction_version`, limits applied, document-level scanned detection
(`text` | `scanned` | `mixed` | `empty`), and `verification.status: "UNREVIEWED"` — the
human-verification workflow is S4 and does not exist yet. Real OCR demonstrably makes
character errors (e.g. "21" -> "2" in the E2E test); this is WHY output is marked
uncertain and unreviewed.

### Safety properties (S2)

- pdf-lib remains the S1 security parser; pdfjs is used for the text layer only.
  pdfjs canvas rendering is NOT used: it hard-crashes Node with embedded JPEGs
  (native access violation) — documented in docs/OCR_DECISION.md; rasterization
  extracts embedded images directly via pdf-lib (memory-safe).
- Extracted text NEVER enters audit logs, error messages, or responses to
  unauthorized roles; the /text endpoint additionally excludes TECHNICIAN and
  RESEARCHER (mirrors the S1 file-byte policy).
- Extraction runs as an async job (never blocks a request); cooperative
  cancellation leaves the document VALID with no partial artifact.
- OCR language data is cached on D: (`data\ocr\tessdata`, env
  `OCR_TESSDATA_PATH`); warmup via `npm run ocr:warmup`; no network after warmup.

## S1 (unchanged)

## What exists now (S1)

### Data flow

```
POST /api/studies/[id]/documents  (requireRole: ADMIN | CLINICIAN | TECHNICIAN)
  -> requireRole + CSRF (enforced in requireRole)
  -> lib/documents/service.uploadDocument()
       -> audit document.upload_started
       -> study existence check (document always bound to an explicit study)
       -> SHA-256 of actual uploaded bytes (never filename/metadata)
       -> lib/documents/validation.validatePdf()   [fail-closed]
            1. raw-byte gates: %PDF- signature, %%EOF presence, size limit
            2. structural parse via pdf-lib (rejects malformed + encrypted)
            3. page-count limit
            4. dangerous-object scan over PARSED dicts (keys AND name values,
               nested, incl. stream dicts): JavaScript/JS, OpenAction, AA,
               Launch, SubmitForm, ImportData, EmbeddedFile, Filespec,
               RichMedia, Movie, Sound, GoToR, GoToE
       -> duplicate check (same SHA-256 in same study => 200 ALREADY_EXISTS,
          no silent merge, no silent duplicate)
       -> write-once immutable original to data\documents\<documentId>.pdf
          (path derived from server-generated id ONLY; safeJoin-guarded)
       -> documents collection record (atomic JSON-store write)
       -> audit document.uploaded + document.accepted
GET  /api/studies/[id]/documents   list     (ADMIN | CLINICIAN | REVIEWER | TECHNICIAN)
GET  /api/documents/[id]           metadata (same; NEVER includes content)
GET  /api/documents/[id]/status    status   (same; poll-friendly)
GET  /api/documents/[id]/file      stream   (ADMIN | CLINICIAN | REVIEWER only)
DELETE /api/documents/[id]         delete   (ADMIN | CLINICIAN; audit record retained)
```

### Deliberate S1 boundaries

- `document_type` is always `UNKNOWN`. Classification is S3.
- Statuses used: `UPLOADED`/`VALIDATING` (reserved), `VALID`, `REJECTED`, `DELETED`.
  `PROCESSING`/`READY`/`FAILED` are S2 states and are never faked.
- A rejected document's original bytes are NOT stored; the rejection record + audit event are.
- Study deletion cascades to its documents (original bytes removed; audit trail retained).
- Duplicates: identical bytes re-uploaded to the same study return `duplicate: true`
  (ALREADY_EXISTS). The same bytes uploaded to a different study is a NEW, explicit
  association — never a silent merge.

### File delivery security

- `requireRole` before any file I/O; TECHNICIAN (upload/status role) cannot fetch bytes.
- SHA-256 of on-disk bytes verified against the recorded hash; mismatch → `409 INTEGRITY_FAILED`
  + audit error event.
- Headers: `Content-Type: application/pdf`, `Content-Security-Policy: sandbox` (prevents
  embedded script execution in browser viewers), `X-Content-Type-Options: nosniff`,
  `Cache-Control: no-store`, `Content-Disposition: inline; filename="document-<id>.pdf"`
  (server-derived — the user's filename is never placed in headers).
- Storage paths are derived exclusively from server-generated document ids; uploaded
  filenames are sanitized for display only. `safeJoin` + an id-charset check fail closed
  on any traversal attempt.

### Audit events

`document.upload_started`, `document.uploaded`, `document.validation_failed`,
`document.accepted`, `document.accessed`, `document.deleted` — all part of the existing
tamper-evident hash chain. Metadata only (ids, sizes, hashes, versions). The audit
sanitizer (S0.4) additionally redacts labeled PHI (Patient Name/DOB/MRN/Address/Phone/
Email/Diagnosis/Medication/Clinical Notes/Accession), bare emails, and fully redacts raw
PDF bytes or extracted-text field names.

### RBAC matrix (least privilege)

| Role | Upload | List/status/metadata | File bytes | Delete |
|---|---|---|---|---|
| ADMIN | ✅ | ✅ | ✅ | ✅ |
| CLINICIAN | ✅ | ✅ | ✅ | ✅ |
| REVIEWER | ❌ | ✅ | ✅ | ❌ |
| TECHNICIAN | ✅ | ✅ | ❌ | ❌ |
| RESEARCHER | ❌ | ❌ | ❌ | ❌ (PHI-excluded; de-identified research data only) |

## Limits (configurable via env; see `.env.example`)

| Limit | Default | Enforced since |
|---|---|---|
| `MAX_DOCUMENT_BYTES` | 25 MB | S1 |
| `MAX_DOCUMENT_PAGES` | 100 | S1 |
| `MAX_DOCUMENT_RENDER_DIMENSION_PX` | 4000 | S2 (defined, not yet enforced) |
| `MAX_DOCUMENT_EMBEDDED_RESOURCE_BYTES` | 25 MB | S2 (defined, not yet enforced) |

## Dependency decision

See `docs/PDF_LIBRARY_DECISION.md` (pdf-lib 1.17.1, MIT; parser-only, never evaluates
embedded content; fail-closed on malformed/encrypted). OCR is NOT installed; the S2 OCR
decision (tesseract.js vs native vs other) is a separate, documented decision.

## Known limitations (honest)

1. Encrypted PDFs are rejected outright (no password handling).
2. Unusual-but-valid PDFs that pdf-lib cannot parse are rejected (fail-closed by design).
3. No AV scanning of uploads — that requires external infrastructure.
4. `document.upload_started` failures on malformed multipart bodies return generic errors;
   parser internals are never leaked to clients.
5. The documents store lives in the same JSON document store (atomic writes). SQLite
   migration remains a separate human-approval gate.
6. No extraction/OCR/classification exists yet — nothing in this stage may be presented
   as clinical information.

## Test coverage

`tests/s1-documents.test.ts` — 32 tests: content validation (valid/empty/fake/truncated/
oversized/too-many-pages/encrypted/JS-via-OpenAction/JS-action/Launch/embedded-file/
RichMedia), filename+path safety (traversal ids, UNC/absolute/null-byte display names,
server-derived download names), service end-to-end (hash integrity, duplicate semantics,
rejection record, tamper detection → 409, deletion semantics, study-deletion cascade),
audit (lifecycle events present, no content in trail), and route-level authorization
(401 unauthenticated; RESEARCHER 403; TECHNICIAN file-bytes 403 but status 200).

Fixtures are synthetic PDFs generated at runtime via pdf-lib — no real or PHI documents
are committed to the repository.
