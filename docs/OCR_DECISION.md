# OCR_DECISION (S2)

Status: **DECIDED** — tesseract.js 7.0.0 as the OCR provider behind the
`OCRProvider` abstraction, with pdfjs-dist 4.10.38 (text layer + page
rasterization) and @napi-rs/canvas 1.0.8 (server-side canvas).

## Candidates evaluated

| Criterion | tesseract.js (WASM) | native Tesseract (C++ binary) | cloud OCR APIs |
|---|---|---|---|
| License | Apache-2.0 | Apache-2.0 | proprietary |
| Windows / Node 20 install | pure WASM + JS; no compilers, no node-gyp | requires external binary install per machine; version drift | n/a |
| D:-only project policy | compatible — language data cached under `data\ocr\` | binary + data paths usually land on C: | n/a |
| Isolation | runs in a worker; cannot touch the filesystem beyond its cache | child process | network PHI exposure |
| PHI / privacy | fully local; no network beyond first-run language-data fetch (documented) | local | **PHI leaves the machine — disqualifying** |
| Accuracy (printed clinical reports, eng) | good with `tessdata_fast`/`tessdata_best`; no layout magic | same engine | better, but disqualified |
| Maintainability of the abstraction | provider is swappable (`OCRProvider` interface) | same | same |

## Decision

- **tesseract.js@7.0.0** (Apache-2.0): local, WASM, worker-isolated, Windows-safe,
  no native build step. Language data (`eng.traineddata`) is fetched ONCE on
  first use and cached at `data\ocr\tessdata\` (env `OCR_TESSDATA_PATH`,
  overridable). Warmup: `npm run ocr:warmup`. First-run network fetch is a
  documented, one-time event of a PUBLIC, versionless-model artifact — no PHI
  is involved. Fully offline after warmup.
- **pdfjs-dist@4.10.38** (Apache-2.0): text-layer extraction and page
  rasterization. `pdf-lib` remains the structural/security parser from S1 —
  unchanged fail-closed behavior. pdfjs is used ONLY after a document has
  already passed S1 validation and integrity re-verification.
- **@napi-rs/canvas@1.0.8** (MIT): prebuilt NAPI binary (no compilation),
  used only to rasterize pages for OCR, dimensions capped by
  `MAX_DOCUMENT_RENDER_DIMENSION_PX`.

## Known limitations (honest)

1. OCR output is **uncertain extracted data, not ground truth** — every OCR
   page carries engine confidence and every artifact is marked
   `verification: UNREVIEWED`. No extracted value may enter triage,
   diagnosis, or the analysis pipeline (nothing connects them).
2. Handwriting, poor scans, and complex multi-column layouts degrade
   accuracy; page-level warnings are recorded rather than hidden.
3. First OCR use without warmup performs a network fetch of the language
   data (CDN). Air-gapped deployments must pre-warm via the script.
4. OCR is CPU-bound; per-document time/char limits are enforced
   (`MAX_OCR_TIME_MS`, `MAX_EXTRACTION_CHARS_PER_DOC/_PAGE`).
5. Scanned-page detection is heuristic (per-page text-layer character
   count) and is reported as a method per page — never silently chosen.
