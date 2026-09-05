import { getDocument, putDocument } from "../repository";
import { readOriginalDocument } from "../storage";
import { sha256 } from "../../storage/files";
import { audit } from "../../audit";
import { DocumentRecord } from "../types";
import {
  MAX_EXTRACTION_CHARS_PER_DOC, MAX_EXTRACTION_CHARS_PER_PAGE, MAX_EXTRACTION_TIME_MS,
  MAX_OCR_TIME_MS, MAX_DOCUMENT_RENDER_DIMENSION_PX, EXTRACTION_VERSION, MIN_TEXT_LAYER_CHARS,
} from "../constants";
import { loadPdf } from "./textLayer";
import { readExtractionArtifact, writeExtractionArtifact, deleteExtractionArtifact } from "./artifacts";
import { createDefaultOcrProvider } from "./ocr";
import { persistTestResults, deleteTestResultsForDocument } from "./testResultService";
import { extractClinicalFromPages } from "./clinicalExtraction";
import { saveRecordExtraction } from "./recordExtractionStore";
import {
  ExtractionArtifact, PageExtraction, PageExtractionMethod, OCRProvider,
  ExtractionCancelledError, DocumentLevel,
} from "./types";

/**
 * Extraction orchestration (S2). Turns a VALID document into an extraction
 * artifact of UNCERTAIN, UNREVIEWED data:
 *
 *   VALID document
 *     -> integrity re-check (sha256 of on-disk bytes vs record)
 *     -> per page: text layer first; scanned pages routed to OCR
 *     -> limits enforced (chars/page, chars/doc, time, render dims)
 *     -> artifact stored separately from the original
 *     -> document status: VALID -> PROCESSING -> READY | FAILED
 *
 * SAFETY: extracted text never enters audit logs or error responses. Clinical
 * candidates are surfaced only through the evidence workspace as
 * AUTO_EXTRACTED/UNREVIEWED, with a separate conservative pre-review urgency
 * signal; they never enter the image model or diagnosis gate as verified data.
 * Every artifact is created verification.status = UNREVIEWED.
 */

export interface ExtractionLimits {
  maxCharsPerDoc: number;
  maxCharsPerPage: number;
  maxTimeMs: number;
  maxOcrTimeMs: number;
  maxRenderDimensionPx: number;
  minTextLayerChars: number;
}

export const DEFAULT_EXTRACTION_LIMITS: ExtractionLimits = {
  maxCharsPerDoc: MAX_EXTRACTION_CHARS_PER_DOC,
  maxCharsPerPage: MAX_EXTRACTION_CHARS_PER_PAGE,
  maxTimeMs: MAX_EXTRACTION_TIME_MS,
  maxOcrTimeMs: MAX_OCR_TIME_MS,
  maxRenderDimensionPx: MAX_DOCUMENT_RENDER_DIMENSION_PX,
  minTextLayerChars: MIN_TEXT_LAYER_CHARS,
};

export interface ExtractOptions {
  ocrProvider?: OCRProvider;      // injectable for tests; default = tesseract.js
  limits?: Partial<ExtractionLimits>;
  shouldCancel?: () => boolean;   // cooperative cancellation between pages
}

export type { DocumentLevel };

export interface ExtractionOutcome {
  ok: boolean;
  status: "READY" | "FAILED";
  artifact_status?: ExtractionArtifact["status"];
  document_level?: DocumentLevel;
  pages?: number;
  char_count?: number;
  error_code?: "NOT_FOUND" | "NOT_EXTRACTABLE" | "INTEGRITY_FAILED" | "EXTRACTION_FAILED" | "OCR_FAILED" | "CANCELLED";
  error?: string;
}

function checkCancel(opts: ExtractOptions): void {
  if (opts.shouldCancel?.()) throw new ExtractionCancelledError();
}

export async function extractDocument(documentId: string, actor: string, opts: ExtractOptions = {}): Promise<ExtractionOutcome> {
  const limits = { ...DEFAULT_EXTRACTION_LIMITS, ...(opts.limits ?? {}) };
  const doc = await getDocument(documentId);
  if (!doc || doc.status === "DELETED" || doc.status === "REJECTED") {
    return { ok: false, status: "FAILED", error_code: "NOT_FOUND", error: "Document not found" };
  }
  if (doc.status === "PROCESSING") {
    return { ok: false, status: "FAILED", error_code: "NOT_EXTRACTABLE", error: "Extraction already in progress" };
  }

  const bytes = await readOriginalDocument(documentId);
  if (!bytes) {
    return { ok: false, status: "FAILED", error_code: "NOT_FOUND", error: "Original document missing" };
  }
  if (sha256(bytes) !== doc.sha256) {
    await auditDocumentEvent("document.extraction_failed", doc, actor, "INTEGRITY_FAILED");
    return { ok: false, status: "FAILED", error_code: "INTEGRITY_FAILED", error: "Stored bytes do not match recorded sha256" };
  }

  // Transition to PROCESSING (persisted; pollable via /status).
  await transition(doc, "PROCESSING");
  // Previous test results belong to the previous extraction generation -
  // they are removed FIRST so stale results can never outlive their artifact.
  await deleteTestResultsForDocument(documentId);
  const started = Date.now();
  await auditDocumentEvent("document.extraction_started", doc, actor, `parser=${EXTRACTION_VERSION}`);

  const ownProvider = !opts.ocrProvider;
  const provider = opts.ocrProvider ?? createDefaultOcrProvider();
  const pages: PageExtraction[] = [];
  const docWarnings: string[] = [];
  let charsTotal = 0;
  let timeExceeded = false;

  let loaded;
  try {
    loaded = await loadPdf(bytes);
    const pageMethods: PageExtractionMethod[] = [];

    for (let p = 1; p <= loaded.numPages; p++) {
      checkCancel(opts);
      if (Date.now() - started > limits.maxTimeMs) { timeExceeded = true; docWarnings.push("time_limit"); break; }

      const tl = await loaded.pageText(p, limits.maxCharsPerPage);
      if (tl.warnings.length) docWarnings.push(...tl.warnings.map((w) => `page_${p}:${w}`));

      if (tl.char_count >= limits.minTextLayerChars) {
        // Enforce the per-document character budget on text-layer output.
        const remaining = limits.maxCharsPerDoc - charsTotal;
        let text = tl.text;
        let charCount = tl.char_count;
        const pageWarnings = [...tl.warnings.map((w) => `page_${p}:${w}`)];
        if (charCount > remaining) {
          text = text.slice(0, Math.max(0, remaining));
          charCount = text.length;
          pageWarnings.push(`page_${p}:char_limit_doc`);
          docWarnings.push("char_limit_doc");
        }
        charsTotal += charCount;
        pageMethods.push("text_layer");
        pages.push({ page: p, method: "text_layer", char_count: charCount, text, warnings: pageWarnings });
        continue;
      }

      // Scanned or empty page -> extract the embedded page image + OCR.
      let rendered: Awaited<ReturnType<typeof loaded.renderPageToPng>>;
      try {
        checkCancel(opts);
        rendered = await loaded.renderPageToPng(p, limits.maxRenderDimensionPx);
      } catch (err) {
        if (err instanceof ExtractionCancelledError) throw err;
        const reason = String(err instanceof Error ? err.message : err);
        const noImage = /no embedded image|no XObject/i.test(reason);
        if (noImage && tl.char_count > 0) {
          // Real text exists but below the scanned-detection threshold, and
          // there is no image to OCR: keep the text - never discard content.
          pageMethods.push("text_layer");
          pages.push({ page: p, method: "text_layer", char_count: tl.char_count, text: tl.text, warnings: ["short_text_layer_no_image"] });
          docWarnings.push(`page_${p}:short_text_layer_no_image`);
          charsTotal += tl.char_count;
          continue;
        }
        if (noImage && tl.char_count === 0) {
          // Nothing on the page at all: no text layer, no image -> empty.
          pageMethods.push("empty");
          pages.push({ page: p, method: "empty", char_count: 0, text: "", warnings: [] });
          continue;
        }
        pageMethods.push("ocr_failed");
        pages.push({ page: p, method: "ocr_failed", char_count: 0, text: "", warnings: ["page_render_unavailable"], ocr: { engine: provider.name, engine_version: "unknown", language: "eng", time_ms: 0 } });
        docWarnings.push(`page_${p}:page_render_unavailable`);
        continue;
      }
      let page: PageExtraction;
      try {
        checkCancel(opts);
        const ocr = await provider.recognize(rendered.png, {
          documentId, studyId: doc.study_id, page: p, timeoutMs: limits.maxOcrTimeMs,
          signal: { get aborted() { return opts.shouldCancel?.() ?? false; } },
        });
        if (ocr.text.length > 0) {
          // Any non-empty OCR result is kept and flagged when suspiciously
          // short - MIN_TEXT_LAYER_CHARS is a text-layer detection threshold,
          // NOT an OCR-output quality judgment. Confidence + warnings carry
          // the uncertainty instead of silently discarding content.
          const lowOutput = ocr.text.length < limits.minTextLayerChars;
          page = {
            page: p, method: "ocr", char_count: ocr.text.length, text: ocr.text, confidence: ocr.confidence,
            warnings: lowOutput ? ["ocr_low_output"] : [],
            ocr: { engine: ocr.engine, engine_version: ocr.engine_version, language: ocr.language, time_ms: ocr.time_ms, render_dimension: { width: rendered.width, height: rendered.height } },
          };
          pageMethods.push("ocr");
          if (lowOutput) docWarnings.push(`page_${p}:ocr_low_output`);
        } else {
          page = { page: p, method: "empty", char_count: 0, text: "", warnings: [], ocr: { engine: ocr.engine, engine_version: ocr.engine_version, language: ocr.language, time_ms: ocr.time_ms, render_dimension: { width: rendered.width, height: rendered.height } } };
          pageMethods.push("empty");
        }
        // Enforce the per-document character budget on OCR output too.
        const remaining = limits.maxCharsPerDoc - charsTotal;
        if (page.char_count > remaining) {
          page.text = page.text.slice(0, Math.max(0, remaining));
          page.char_count = page.text.length;
          page.warnings.push("char_limit_doc");
          docWarnings.push("char_limit_doc");
        }
        charsTotal += page.char_count;
      } catch (err) {
        if (err instanceof ExtractionCancelledError) throw err;
        pageMethods.push("ocr_failed");
        page = { page: p, method: "ocr_failed", char_count: 0, text: "", warnings: ["ocr_failed"], ocr: { engine: provider.name, engine_version: "unknown", language: "eng", time_ms: Date.now() - started } };
        docWarnings.push(`page_${p}:ocr_failed`);
        charsTotal += 0;
      }
      pages.push(page);

      if (charsTotal > limits.maxCharsPerDoc) {
        docWarnings.push("char_limit_doc");
        break;
      }
    }

    if (charsTotal > limits.maxCharsPerDoc) docWarnings.push("char_limit_doc");
    const documentLevel: DocumentLevel = classify(pages, pageMethods, loaded.numPages);
    const status: ExtractionArtifact["status"] =
      docWarnings.some((w) => w.endsWith("ocr_failed") || w === "time_limit" || w === "char_limit_doc") ? "PARTIAL" : "COMPLETE";

    const artifact: ExtractionArtifact = {
      document_id: documentId,
      study_id: doc.study_id,
      status,
      document_level: documentLevel,
      pages,
      totals: {
        pages: loaded.numPages,
        pages_text_layer: pageMethods.filter((m) => m === "text_layer").length,
        pages_ocr: pageMethods.filter((m) => m === "ocr").length,
        pages_empty: pageMethods.filter((m) => m === "empty").length,
        pages_failed: pageMethods.filter((m) => m === "ocr_failed").length,
        char_count: charsTotal,
      },
      limits_applied: {
        max_chars_per_doc: limits.maxCharsPerDoc,
        max_chars_per_page: limits.maxCharsPerPage,
        max_time_ms: limits.maxTimeMs,
        max_ocr_time_ms: limits.maxOcrTimeMs,
        max_render_dimension_px: limits.maxRenderDimensionPx,
      },
      verification: { status: "UNREVIEWED" },
      extraction_version: EXTRACTION_VERSION,
      created_at: new Date().toISOString(),
      warnings: [...new Set(docWarnings)],
    };
    await writeExtractionArtifact(artifact);
    await transition(doc, "READY");
    // S3: structured test-result generation from the fresh artifact.
    await persistTestResults(documentId, doc.study_id, artifact, actor);
    // Eye-center workspace: automatic clinical extraction (symptoms /
    // medications / allergies / systemic candidates) from the same pages.
    // Isolated fail-safe: a failure here never changes the document's
    // READY status or the artifact - the extraction record is simply
    // marked FAILED and can be regenerated.
    try {
      const recordExtraction = extractClinicalFromPages(
        artifact.pages.map((p) => ({ page: p.page, text: p.text ?? "" })),
        { document_id: documentId, study_id: doc.study_id, patient_ref: doc.patient_ref }
      );
      await saveRecordExtraction(recordExtraction);
    } catch {
      await auditDocumentEvent("document.clinical_extraction_failed", doc, actor, "non-fatal; document remains READY");
    }
    await auditDocumentEvent("document.extracted", doc, actor, `status=${status} level=${documentLevel} pages=${loaded.numPages} chars=${charsTotal} version=${EXTRACTION_VERSION}`);
    return { ok: true, status: "READY", artifact_status: status, document_level: documentLevel, pages: loaded.numPages, char_count: charsTotal };
  } catch (err) {
    if (err instanceof ExtractionCancelledError) {
      await transition(doc, "VALID");
      await deleteExtractionArtifact(documentId);
      await deleteTestResultsForDocument(documentId); // no results without their artifact
      await auditDocumentEvent("document.extraction_cancelled", doc, actor, "cancelled between pages; no artifact written");
      return { ok: false, status: "FAILED", error_code: "CANCELLED", error: "Extraction cancelled" };
    }
    const message = String(err instanceof Error ? err.message : err).slice(0, 160);
    await transition(doc, "FAILED");
    await auditDocumentEvent("document.extraction_failed", doc, actor, `error=${message}`);
    return { ok: false, status: "FAILED", error_code: "EXTRACTION_FAILED", error: "Extraction failed" };
  } finally {
    if (loaded) await loaded.destroy().catch(() => {});
    if (ownProvider) await provider?.release?.().catch(() => {});
  }
}

function classify(pages: PageExtraction[], methods: PageExtractionMethod[], totalPages: number): DocumentLevel {
  if (pages.length === 0) return "empty";
  const ocr = methods.filter((m) => m === "ocr").length;
  const text = methods.filter((m) => m === "text_layer").length;
  const failed = methods.filter((m) => m === "ocr_failed").length;
  const accounted = ocr + text + failed;
  if (accounted < totalPages && text === 0 && ocr === 0) return "empty";
  if (ocr === 0 && text > 0) return "text";
  if (text === 0 && ocr > 0) return "scanned";
  return "mixed";
}

async function transition(doc: DocumentRecord, status: DocumentRecord["status"]): Promise<void> {
  doc.status = status;
  doc.updated_at = new Date().toISOString();
  await putDocument(doc);
}

async function auditDocumentEvent(action: string, doc: DocumentRecord, actor: string, detail?: string): Promise<void> {
  await audit({
    actor: `user:${actor}`,
    action,
    resource: "document",
    resourceId: doc.document_id,
    studyId: doc.study_id,
    outcome: action.endsWith("failed") ? "error" : "ok",
    detail,
  });
}

/** Public read path: artifact only for authorized callers (route enforces roles). */
export async function getExtractionForDelivery(documentId: string): Promise<ExtractionArtifact | null> {
  const doc = await getDocument(documentId);
  if (!doc || doc.status === "DELETED" || doc.status === "REJECTED") return null;
  return readExtractionArtifact(documentId);
}
