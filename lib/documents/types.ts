/**
 * Document model (S1). A Document is an uploaded clinical document file
 * (currently PDF only), bound to exactly one study. An uploaded document is
 * NEVER trusted clinical data - it is an immutable original plus metadata.
 * Extraction/OCR/classification belong to later stages (S2/S3) and must not
 * be implied by this model.
 */

export type DocumentStatus =
  | "UPLOADED"      // bytes stored, awaiting validation
  | "VALIDATING"    // structural validation in progress
  | "VALID"         // passed S1 ingestion validation (NOT "verified clinical content")
  | "REJECTED"      // failed validation; original bytes retained for audit
  | "PROCESSING"    // S2+ (text extraction/OCR) - NOT used in S1
  | "READY"         // S2+ - NOT used in S1
  | "FAILED"        // S2+ processing failure - NOT used in S1
  | "DELETED";      // logical delete; audit trail remains

export type DocumentErrorCode =
  | "NO_FILE"
  | "TOO_LARGE"
  | "INVALID_DOCUMENT"     // not a PDF / malformed / truncated / encrypted
  | "UNSAFE_DOCUMENT"      // dangerous embedded content (JS, launch actions, embedded files...)
  | "TOO_MANY_PAGES"
  | "STUDY_NOT_FOUND"
  | "STORAGE_ERROR"
  | "NOT_FOUND"
  | "INTEGRITY_FAILED";

/** Controlled vocabulary. S1 only ever assigns UNKNOWN; classification is S3. */
export type DocumentType =
  | "UNKNOWN";

export interface DocumentRecord {
  document_id: string;
  study_id: string;
  patient_ref?: string;          // copied from the study record; optional, never invented
  filename_display: string;      // sanitized original filename (display/audit only, never a filesystem path)
  mime_type: string;             // always "application/pdf" for accepted S1 documents
  size_bytes: number;
  sha256: string;                // SHA-256 of the ORIGINAL uploaded bytes
  page_count: number;            // from parsed structure; 0 when unknown/rejected
  status: DocumentStatus;
  document_type: DocumentType;   // S1: always "UNKNOWN"
  storage_path: string;          // relative path under DOCUMENTS_ROOT, derived from document_id only
  uploaded_by: string;           // username of the uploader
  uploaded_at: string;
  parser_version: string;        // lib/documents parser version
  validation: {
    outcome: "VALID" | "REJECTED";
    error_code?: DocumentErrorCode;
    detail?: string;             // short non-sensitive reason (audited via sanitizer)
    validated_at: string;
  };
  warnings: string[];            // e.g. duplicate-upload notices; never document content
  created_at: string;
  updated_at: string;
}

/** Public-safe projection of a document record (never includes file content). */
export type DocumentSummary = Pick<
  DocumentRecord,
  | "document_id" | "study_id" | "filename_display" | "mime_type" | "size_bytes"
  | "sha256" | "page_count" | "status" | "document_type" | "uploaded_by"
  | "uploaded_at" | "parser_version" | "validation" | "warnings"
>;

export function toSummary(doc: DocumentRecord): DocumentSummary {
  return {
    document_id: doc.document_id,
    study_id: doc.study_id,
    filename_display: doc.filename_display,
    mime_type: doc.mime_type,
    size_bytes: doc.size_bytes,
    sha256: doc.sha256,
    page_count: doc.page_count,
    status: doc.status,
    document_type: doc.document_type,
    uploaded_by: doc.uploaded_by,
    uploaded_at: doc.uploaded_at,
    parser_version: doc.parser_version,
    validation: doc.validation,
    warnings: doc.warnings,
  };
}
