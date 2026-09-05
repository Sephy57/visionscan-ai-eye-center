import { PDFDocument, PDFDict, PDFName, PDFArray, PDFStream } from "pdf-lib";
import { DocumentErrorCode } from "./types";
import { MAX_DOCUMENT_BYTES, MAX_DOCUMENT_PAGES } from "./constants";

/**
 * PDF validation (S1). Never trusts filename, extension, or Content-Type -
 * only actual bytes. Fail-closed: anything not parseable as a clean,
 * unencrypted, non-dangerous PDF is rejected.
 *
 * Stage 1: raw-byte checks (magic + EOF).
 * Stage 2: structural parse with pdf-lib (rejects malformed + encrypted).
 * Stage 3: dangerous-object scan over PARSED dictionaries (not raw bytes,
 *          to avoid false positives from compressed binary streams).
 */

export interface ValidationLimits {
  maxBytes: number;
  maxPages: number;
}

export const DEFAULT_VALIDATION_LIMITS: ValidationLimits = {
  maxBytes: MAX_DOCUMENT_BYTES,
  maxPages: MAX_DOCUMENT_PAGES,
};

export interface ValidationResult {
  ok: boolean;
  error_code?: DocumentErrorCode;
  detail?: string;
  page_count: number;
  /** Non-blocking notices shown to the uploader (never document content). */
  warnings: string[];
}

/**
 * Dictionary keys that indicate embedded active content or automatic
 * actions. Presence of any of these on any parsed object rejects the PDF.
 * ("/JS" and "/JavaScript" cover JS actions; "/AA" covers additional-action
 * triggers; "/Launch"/"SubmitForm"/"ImportData"/"GoToR"/"GoToE" cover
 * file/remote/network actions; "/EmbeddedFile"/"Filespec" cover attachments;
 * "/RichMedia"/"Movie"/"Sound" cover embedded media.)
 */
const DANGEROUS_DICT_KEYS = new Set([
  "JavaScript", "JS", "OpenAction", "AA", "Launch", "SubmitForm",
  "ImportData", "EmbeddedFile", "Filespec", "RichMedia", "Movie",
  "Sound", "GoToR", "GoToE",
]);

function looksLikePdfBytes(bytes: Buffer): boolean {
  return bytes.length >= 5 && bytes.subarray(0, 5).toString("latin1") === "%PDF-";
}

function hasEofMarker(bytes: Buffer): boolean {
  // Scan the last 1 KB for the EOF comment (tolerating trailing padding bytes).
  const tail = bytes.subarray(Math.max(0, bytes.length - 1024)).toString("latin1");
  return tail.includes("%%EOF");
}

function nameText(name: PDFName): string {
  const raw = name.toString(); // pdf-lib renders names with a leading "/"
  return raw.startsWith("/") ? raw.slice(1) : raw;
}

/**
 * Walks a parsed dictionary (bounded depth) looking for dangerous KEYS
 * (e.g. an /OpenAction or /AA entry on the catalog) and dangerous NAME
 * VALUES (e.g. /S /JavaScript action types, Type /Filespec attachments).
 * Walking parsed objects - not raw bytes - avoids false positives from
 * compressed binary streams.
 */
function scanDict(dict: PDFDict, depth: number, found: Set<string>): void {
  for (const [key, value] of dict.entries()) {
    const k = nameText(key);
    if (DANGEROUS_DICT_KEYS.has(k)) found.add(k);
    if (value instanceof PDFName) {
      const v = nameText(value);
      if (DANGEROUS_DICT_KEYS.has(v)) found.add(v);
    } else if (value instanceof PDFDict && depth < 6) {
      scanDict(value, depth + 1, found);
    } else if (value instanceof PDFArray && depth < 6) {
      for (const element of value.asArray()) {
        if (element instanceof PDFDict) scanDict(element, depth + 1, found);
        else if (element instanceof PDFName && DANGEROUS_DICT_KEYS.has(nameText(element))) found.add(nameText(element));
      }
    }
  }
}

function scanParsedObjects(doc: PDFDocument): { dangerous: string[] } {
  const dangerous = new Set<string>();
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFDict) {
      scanDict(obj, 0, dangerous);
    } else if (obj instanceof PDFStream) {
      scanDict(obj.dict, 0, dangerous); // stream dictionaries (e.g. EmbeddedFile streams)
    }
  }
  return { dangerous: [...dangerous] };
}

export async function validatePdf(
  bytes: Buffer,
  limits: ValidationLimits = DEFAULT_VALIDATION_LIMITS
): Promise<ValidationResult> {
  const warnings: string[] = [];

  if (bytes.length === 0) {
    return { ok: false, error_code: "INVALID_DOCUMENT", detail: "empty file", page_count: 0, warnings };
  }
  if (bytes.length > limits.maxBytes) {
    return { ok: false, error_code: "TOO_LARGE", detail: `size ${bytes.length} exceeds limit ${limits.maxBytes}`, page_count: 0, warnings };
  }
  if (!looksLikePdfBytes(bytes)) {
    return { ok: false, error_code: "INVALID_DOCUMENT", detail: "missing %PDF- signature", page_count: 0, warnings };
  }
  if (!hasEofMarker(bytes)) {
    return { ok: false, error_code: "INVALID_DOCUMENT", detail: "missing %%EOF marker (truncated?)", page_count: 0, warnings };
  }

  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, {
      ignoreEncryption: false,   // encrypted PDFs throw EncryptedPDFError -> fail closed
      throwOnInvalidObject: true,
      updateMetadata: false,     // never mutate parsed content
    });
  } catch (err) {
    const msg = String((err as Error)?.message ?? err).slice(0, 120);
    const encrypted = /encrypt/i.test(msg);
    return {
      ok: false,
      error_code: "INVALID_DOCUMENT",
      detail: encrypted ? "encrypted PDFs are not accepted" : `unparseable PDF: ${msg}`,
      page_count: 0,
      warnings,
    };
  }

  let pageCount = 0;
  try {
    pageCount = doc.getPageCount();
  } catch {
    return { ok: false, error_code: "INVALID_DOCUMENT", detail: "unreadable page tree", page_count: 0, warnings };
  }
  if (pageCount === 0) {
    return { ok: false, error_code: "INVALID_DOCUMENT", detail: "PDF contains no pages", page_count: 0, warnings };
  }
  if (pageCount > limits.maxPages) {
    return { ok: false, error_code: "TOO_MANY_PAGES", detail: `${pageCount} pages exceeds limit ${limits.maxPages}`, page_count: pageCount, warnings };
  }

  const { dangerous } = scanParsedObjects(doc);
  if (dangerous.length > 0) {
    return {
      ok: false,
      error_code: "UNSAFE_DOCUMENT",
      detail: `dangerous embedded content: ${dangerous.join(", ").slice(0, 100)}`,
      page_count: pageCount,
      warnings,
    };
  }

  return { ok: true, page_count: pageCount, warnings };
}
