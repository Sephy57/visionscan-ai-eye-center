/**
 * Extraction model (S2/S3). Text/OCR extraction turns a VALID document into
 * UNCERTAIN EXTRACTED DATA - never ground truth, never verified clinical
 * data, never clinical results. Page/ROI routing may expose bounded OCT
 * image sidecars to the modality-specific research pipeline, while extracted
 * text and measurements remain evidence-only and never enter triage or
 * diagnosis as verified data.
 */

export type PageExtractionMethod =
  | "text_layer"   // characters came from the PDF's own text layer
  | "ocr"          // page was rasterized and processed by the OCR engine
  | "empty"        // no content on the page
  | "ocr_failed";  // OCR was required but did not produce usable output

export type ExtractionStatus =
  | "COMPLETE"   // every page processed within limits
  | "PARTIAL"    // processed with recorded warnings (limits, failed pages)
  | "FAILED";    // fatal failure; no usable artifact content
  // Verification is a separate, later workflow (S4). Artifacts are always
  // created as UNREVIEWED.

/** Document-level scanned/text detection (S2). Reported, never silently chosen. */
export type DocumentLevel =
  | "text"      // every page had a usable text layer
  | "scanned"   // every page required OCR
  | "mixed"     // some pages text, some OCR
  | "empty";    // no usable content found

export interface PageExtraction {
  page: number;                 // 1-based page number
  method: PageExtractionMethod;
  char_count: number;
  text: string;                 // extracted text (PHI-bearing; NEVER logged)
  confidence?: number;          // OCR engine confidence 0..100 where available
  warnings: string[];           // e.g. "char_limit_page", "ocr_timeout"
  ocr?: {
    engine: string;             // e.g. "tesseract.js"
    engine_version: string;
    language: string;
    time_ms: number;
    render_dimension?: { width: number; height: number };
  };
}

export interface ExtractionArtifact {
  document_id: string;
  study_id: string;
  status: ExtractionStatus;
  document_level: "text" | "scanned" | "mixed" | "empty";  // scanned-PDF detection result
  pages: PageExtraction[];
  totals: { pages: number; pages_text_layer: number; pages_ocr: number; pages_empty: number; pages_failed: number; char_count: number };
  limits_applied: {
    max_chars_per_doc: number;
    max_chars_per_page: number;
    max_time_ms: number;
    max_ocr_time_ms: number;
    max_render_dimension_px: number;
  };
  verification: { status: "UNREVIEWED" };  // S4 adds the review workflow
  extraction_version: string;
  created_at: string;
  warnings: string[];
  /** Server-computed page/region routing; optional for legacy artifacts. */
  asset_routing?: import("./pdfIntelligence").PdfAssetRouting;
}

/** OCR provider abstraction (swappable: tesseract.js today, others later). */
export interface OcrResult {
  text: string;
  confidence: number;           // 0..100
  engine: string;
  engine_version: string;
  language: string;
  time_ms: number;
}

export interface OcrContext {
  documentId: string;
  studyId: string;
  page: number;
  timeoutMs: number;
  signal?: { aborted: boolean };
}

export interface OCRProvider {
  readonly name: string;
  /** Recognizes text in a PNG-encoded page image. Implementations must be cancellable/timeout-safe. */
  recognize(png: Buffer, ctx: OcrContext): Promise<OcrResult>;
  release(): Promise<void>;
}

export class ExtractionCancelledError extends Error {
  constructor() {
    super("Extraction cancelled");
    this.name = "ExtractionCancelledError";
  }
}

export class ExtractionTimeoutError extends Error {
  constructor() {
    super("OCR timeout");
    this.name = "ExtractionTimeoutError";
  }
}
