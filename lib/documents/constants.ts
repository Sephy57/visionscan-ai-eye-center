/**
 * Document ingestion limits (S1). All configurable via environment so the
 * deployment can tighten them; defaults are deliberately conservative.
 * Enforced values are documented in docs/PDF_LIBRARY_DECISION.md and
 * docs/PDF_DOCUMENT_PIPELINE.md.
 */

function num(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** Hard cap on uploaded document size. Matches the image upload cap by default (25 MB). */
export const MAX_DOCUMENT_BYTES = num("MAX_DOCUMENT_BYTES", 26_214_400); // 25 MB

/** Hard cap on PDF page count. Scanned ophthalmic reports rarely exceed ~50 pages. */
export const MAX_DOCUMENT_PAGES = num("MAX_DOCUMENT_PAGES", 100);

/**
 * Maximum pixel dimensions allowed when a page is rasterized for OCR (S2).
 * Defined now, enforced from S2 onward - S1 never renders pages.
 */
export const MAX_DOCUMENT_RENDER_DIMENSION_PX = num("MAX_DOCUMENT_RENDER_DIMENSION_PX", 4000);

/**
 * Maximum size of a single embedded resource stream considered safe to
 * process (S2 rendering/OCR). Defined now, enforced from S2 onward.
 */
export const MAX_DOCUMENT_EMBEDDED_RESOURCE_BYTES = num("MAX_DOCUMENT_EMBEDDED_RESOURCE_BYTES", 26_214_400); // 25 MB

// ---------------------------------------------------------------------------
// S2 extraction limits (all configurable; fail-safe when exceeded)
// ---------------------------------------------------------------------------

/** Total extracted characters allowed per document. Exceeding => PARTIAL artifact with warning. */
export const MAX_EXTRACTION_CHARS_PER_DOC = num("MAX_EXTRACTION_CHARS_PER_DOC", 500_000);

/** Per-page character cap; longer pages are truncated with a recorded warning. */
export const MAX_EXTRACTION_CHARS_PER_PAGE = num("MAX_EXTRACTION_CHARS_PER_PAGE", 50_000);

/** Hard wall-clock budget for OCR work per document (ms). */
export const MAX_EXTRACTION_TIME_MS = num("MAX_EXTRACTION_TIME_MS", 240_000);

/** Wall-clock budget for a single page's OCR run (ms). */
export const MAX_OCR_TIME_MS = num("MAX_OCR_TIME_MS", 90_000);

/** Pages with fewer text-layer characters than this are treated as scanned and routed to OCR. */
export const MIN_TEXT_LAYER_CHARS = num("MIN_TEXT_LAYER_CHARS", 32);

/** Version recorded on every extraction artifact for provenance. */
export const EXTRACTION_VERSION = "extraction-1.0.0";

/** Directory (under data\documents\ by default) holding extraction artifacts, env-overridable. */
export const OCR_TESSDATA_PATH = process.env.OCR_TESSDATA_PATH?.trim() || undefined;

/** Version recorded on every document record for provenance. */
export const PARSER_VERSION = "pdf-structural-1.0.0";

/** The only MIME type accepted for S1 document ingestion. */
export const DOCUMENT_MIME = "application/pdf";

/**
 * Extracted-text artifacts live SEPARATELY from the immutable originals
 * (data\documents\extracted\). Extraction artifacts contain potentially
 * PHI-bearing text and are never the document original.
 */
export const EXTRACTION_SUBDIR = "extracted";
