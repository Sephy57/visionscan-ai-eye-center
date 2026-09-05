# PDF_LIBRARY_DECISION (S1)

Status: **DECIDED** — pdf-lib 1.17.1 installed for S1 (validation/inspection only).

## Candidates evaluated

| Criterion | pdf-lib 1.17.1 | pdfjs-dist | manual byte scan only |
|---|---|---|---|
| License | MIT | Apache-2.0 | n/a |
| Native code / build step | none (pure JS, no node-gyp) | none, but heavy; needs DOM polyfills for rendering | none |
| Server-side (Node 20 / Next 14 route handlers) | yes, synchronous parse, no worker needed | yes via legacy build, but heavier and render-oriented | yes |
| Executes embedded content (JS/actions)? | **No — parser only, never evaluates** | No (viewer CAN be configured to run embedded JS in browsers; server API does not) | n/a |
| Structural parse (real objects, not regex on raw bytes) | yes — `PDFDocument.load` + `context.enumerateIndirectObjects()` gives parsed dicts/streams | yes | no — regex on raw bytes false-positives on compressed binaries |
| Encrypted PDF behavior | throws `EncryptedPDFError` (fail-closed by default) | opens with password | no |
| Malformed PDF behavior | throws on broken xref/trailer (fail-closed) | attempts recovery (more permissive = worse for a security gate) | unreliable |
| Maintenance | stable/spec-complete; last publish 2022-05 (noticed: slow-moving) | active | n/a |
| Known CVEs | none known at decision time | none blocking | n/a |
| D:-only project policy | compatible (no runtime downloads, no C: artifacts) | compatible | compatible |

## Decision

`pdf-lib@1.17.1` is used as the **structural parser** for S1:

- Magic-byte (`%PDF-`) and `%%EOF` checks are done on raw bytes first.
- `PDFDocument.load(bytes)` (default: `ignoreEncryption: false`, `throwOnInvalidObject: true`) is the fail-closed structural gate; anything it cannot parse is rejected as `INVALID_DOCUMENT`.
- Page count comes from the parsed document.
- Dangerous-object detection walks **parsed** indirect objects (`PDFDict` keys: `OpenAction`, `AA`, `JavaScript`, `JS`, `Launch`, `EmbeddedFile`, `Filespec`, `RichMedia`, `Movie`, `Sound`, `SubmitForm`, `ImportData`, `GoToR`, `GoToE`, `URI`-actions) rather than regexing raw bytes, avoiding false positives from compressed binary streams.

## Known limitations (honest)

1. pdf-lib is parse-complete but conservative; a tiny minority of unusual-but-valid PDFs it cannot parse will be rejected (`INVALID_DOCUMENT`). Fail-closed is the intended behavior.
2. Encrypted PDFs are **rejected** in S1 (no password handling exists). Documented; may be revisited with explicit approval.
3. Object-scan detection covers parsed dictionaries; deeply obfuscated content inside unused compressed streams is not "executed" by anything in this stack, but content-level forensics (AV scanning) is external infrastructure and is NOT claimed here.
4. Rendering (for S2 OCR) will use a separate, separately-reviewed library (pdfjs-dist is the likely candidate) — that decision is deferred to S2 and is NOT made here.
5. npm audit at decision time: 7 pre-existing TRANSITIVE advisories in the dev/toolchain tree (2 moderate, 4 high, 1 critical; 0 direct dependencies). None introduced by pdf-lib. Recorded, not hidden; remediation is a separate task (Next.js/Next-toolchain upgrades must be regression-tested, not blindly forced).
