import { safeJoin, DOCUMENTS_ROOT } from "../config";

/**
 * Document security helpers (S1). Path safety and response-header hygiene
 * for document delivery. The uploaded filename is NEVER used as a
 * filesystem path and NEVER placed into HTTP headers unfiltered.
 */

/**
 * Sanitizes a user-supplied filename for DISPLAY/STORAGE-RECORD purposes
 * only: strips path components (including Windows and UNC forms), control
 * characters, and caps length. The result must never be used to build a
 * filesystem path - storage paths are derived from server-generated ids.
 */
export function sanitizeDisplayName(filename: string): string {
  const base = String(filename ?? "")
    // take only the final path component, whatever separator style was used
    .split(/[\\/]/)
    .pop() ?? "";
  const cleaned = base
    // strip control characters (including null bytes) and non-printable ASCII
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim();
  const capped = cleaned.length > 120 ? cleaned.slice(-120) : cleaned; // keep the extension end
  return capped.length > 0 ? capped : "unnamed.pdf";
}

/**
 * Resolves the immutable storage path for a document. Only the
 * server-generated documentId is ever used - uploaded filenames and query
 * parameters can never influence the path. safeJoin fails closed on any
 * traversal attempt.
 */
export function documentStoragePath(documentId: string): string {
  if (!/^[A-Za-z0-9_.-]+$/.test(documentId)) {
    throw new Error("Path traversal rejected");
  }
  return safeJoin(DOCUMENTS_ROOT, `${documentId}.pdf`);
}

/**
 * Server-derived download name for Content-Disposition. The user's filename
 * is intentionally NOT used in headers (header-injection / traversal safety).
 */
export function contentDispositionName(documentId: string): string {
  return `document-${documentId.replace(/[^A-Za-z0-9_.-]/g, "")}.pdf`;
}

/**
 * Secure response headers for document delivery. `Content-Security-Policy:
 * sandbox` prevents any embedded script from running in the browser viewer;
 * nosniff prevents MIME confusion; inline disposition is safe because the
 * filename is server-generated and the content is our validated PDF.
 */
export function documentResponseHeaders(documentId: string, sizeBytes: number): Record<string, string> {
  return {
    "Content-Type": "application/pdf",
    "Content-Disposition": `inline; filename="${contentDispositionName(documentId)}"`,
    "Content-Security-Policy": "sandbox",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
    "Content-Length": String(sizeBytes),
  };
}
