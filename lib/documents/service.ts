import { newId, sha256 } from "../storage/files";
import { dbGet } from "../storage/db";
import { audit } from "../audit";
import { DocumentRecord, DocumentSummary, DocumentErrorCode, toSummary } from "./types";
import { PARSER_VERSION, DOCUMENT_MIME } from "./constants";
import { validatePdf, DEFAULT_VALIDATION_LIMITS } from "./validation";
import { saveOriginalDocument, readOriginalDocument, deleteOriginalDocument } from "./storage";
import { putDocument, getDocument, listAllDocumentRecords } from "./repository";
import { sanitizeDisplayName } from "./security";
import type { StudyRecord } from "../studies/service";

/**
 * Document service (S1) - ingestion, validation, immutable storage, audit.
 *
 * SAFETY PRINCIPLE: an uploaded PDF is not equivalent to a verified clinical
 * result. S1 performs ingestion and structural security validation ONLY -
 * no text extraction, no OCR, no classification beyond "UNKNOWN", no
 * clinical interpretation, and no correlation with model findings.
 */

export interface UploadDocumentOutcome {
  ok: boolean;
  httpStatus: 201 | 200 | 400 | 404 | 413 | 415 | 500;
  document?: DocumentSummary;
  duplicate?: boolean;
  error_code?: DocumentErrorCode;
  error?: string;
}

function auditDocument(
  action: string,
  outcome: "ok" | "error" | "rejected",
  meta: { documentId?: string; studyId?: string; detail?: string; actor?: string }
): Promise<void> {
  // Metadata only: ids, status, versions. NEVER document content or
  // extracted text - the audit sanitizer is a second line of defense.
  return audit({
    actor: meta.actor ? `user:${meta.actor}` : "system",
    action,
    resource: "document",
    resourceId: meta.documentId,
    studyId: meta.studyId,
    outcome,
    detail: meta.detail,
  });
}

export async function uploadDocument(
  studyId: string,
  filename: string,
  declaredMime: string,
  bytes: Buffer,
  uploadedBy: string
): Promise<UploadDocumentOutcome> {
  const filenameDisplay = sanitizeDisplayName(filename);
  await auditDocument("document.upload_started", "ok", {
    studyId,
    actor: uploadedBy,
    detail: `filename_display=${filenameDisplay} size=${bytes.length}`,
  });

  const study = await dbGet<StudyRecord>("studies", studyId);
  if (!study) {
    await auditDocument("document.rejected", "rejected", { studyId, detail: "study not found" });
    return { ok: false, httpStatus: 404, error_code: "STUDY_NOT_FOUND", error: "Study not found" };
  }

  const hash = sha256(bytes); // computed from actual uploaded bytes, never metadata

  // Structural + security validation (fail closed). No type inference from
  // filename/MIME: content only.
  const validation = await validatePdf(bytes, DEFAULT_VALIDATION_LIMITS);
  if (!validation.ok) {
    const record = rejectedRecord(study, studyId, filenameDisplay, bytes.length, hash, uploadedBy, validation.error_code!, validation.detail);
    await putDocument(record); // rejected documents are recorded for audit (bytes NOT stored)
    await auditDocument("document.validation_failed", "rejected", {
      documentId: record.document_id,
      studyId,
      actor: uploadedBy,
      detail: `${validation.error_code} ${validation.detail ?? ""}`.trim().slice(0, 180),
    });
    const status =
      validation.error_code === "TOO_LARGE" ? 413 :
      validation.error_code === "TOO_MANY_PAGES" ? 413 : 415;
    return { ok: false, httpStatus: status as UploadDocumentOutcome["httpStatus"], error_code: validation.error_code, error: validation.error_code };
  }

  // Duplicate handling: identical bytes re-uploaded to the SAME study are
  // reported explicitly (ALREADY_EXISTS semantics) - never silently merged,
  // never silently duplicated. The same bytes uploaded to a DIFFERENT study
  // is a new, explicit association created by the uploader.
  const allDocs = await listAllDocumentRecords();
  const duplicate = allDocs.find(
    (d) => d.study_id === studyId && d.sha256 === hash && d.status !== "REJECTED" && d.status !== "DELETED"
  );
  if (duplicate) {
    return {
      ok: true,
      httpStatus: 200,
      duplicate: true,
      document: toSummary(duplicate),
      error: "ALREADY_EXISTS",
    };
  }

  const documentId = newId("doc");
  try {
    await saveOriginalDocument(documentId, bytes); // write-once, id-derived path
  } catch {
    await auditDocument("document.upload_started", "error", { studyId, detail: "storage error" });
    return { ok: false, httpStatus: 500, error_code: "STORAGE_ERROR", error: "Document storage failed" };
  }

  const now = new Date().toISOString();
  const record: DocumentRecord = {
    document_id: documentId,
    study_id: studyId,
    patient_ref: study.patient_ref,
    filename_display: filenameDisplay,
    mime_type: DOCUMENT_MIME,
    size_bytes: bytes.length,
    sha256: hash,
    page_count: validation.page_count,
    status: "VALID",
    document_type: "UNKNOWN", // classification is S3; S1 never guesses a type
    storage_path: `${documentId}.pdf`,
    uploaded_by: uploadedBy,
    uploaded_at: now,
    parser_version: PARSER_VERSION,
    validation: {
      outcome: "VALID",
      validated_at: now,
    },
    warnings: validation.warnings,
    created_at: now,
    updated_at: now,
  };
  await putDocument(record);

  await auditDocument("document.uploaded", "ok", {
    documentId, studyId, actor: uploadedBy,
    detail: `size=${bytes.length} pages=${validation.page_count} sha256=${hash.slice(0, 12)} parser=${PARSER_VERSION}`,
  });
  await auditDocument("document.accepted", "ok", {
    documentId, studyId, actor: uploadedBy, detail: `status=VALID type=UNKNOWN`,
  });

  return { ok: true, httpStatus: 201, document: toSummary(record) };
}

function rejectedRecord(
  study: StudyRecord,
  studyId: string,
  filenameDisplay: string,
  sizeBytes: number,
  hash: string,
  uploadedBy: string,
  errorCode: DocumentErrorCode,
  detail?: string
): DocumentRecord {
  const now = new Date().toISOString();
  return {
    document_id: newId("doc"),
    study_id: studyId,
    patient_ref: study.patient_ref,
    filename_display: filenameDisplay,
    mime_type: DOCUMENT_MIME,
    size_bytes: sizeBytes,
    sha256: hash,
    page_count: 0,
    status: "REJECTED",
    document_type: "UNKNOWN",
    storage_path: "", // rejected originals are not persisted
    uploaded_by: uploadedBy,
    uploaded_at: now,
    parser_version: PARSER_VERSION,
    validation: { outcome: "REJECTED", error_code: errorCode, detail, validated_at: now },
    warnings: [],
    created_at: now,
    updated_at: now,
  };
}

export async function getDocumentStatus(documentId: string): Promise<{ status?: string; validation?: DocumentRecord["validation"]; found: boolean; document?: DocumentSummary }> {
  const doc = await getDocument(documentId);
  if (!doc) return { found: false };
  return { found: true, status: doc.status, validation: doc.validation, document: toSummary(doc) };
}

export interface ReadDocumentResult {
  ok: boolean;
  httpStatus: 200 | 404 | 409;
  bytes?: Buffer;
  documentId?: string;
  headers?: Record<string, string>;
  error?: string;
}

/**
 * Reads the immutable original for delivery. Verifies the on-disk bytes
 * still match the recorded SHA-256 (integrity check) before responding.
 */
export async function readDocumentForDelivery(documentId: string, actor: string): Promise<ReadDocumentResult> {
  const doc = await getDocument(documentId);
  if (!doc || doc.status === "DELETED" || doc.status === "REJECTED") {
    return { ok: false, httpStatus: 404, error: "Not found" };
  }
  const { documentResponseHeaders } = await import("./security");
  const bytes = await readOriginalDocument(documentId);
  if (!bytes) {
    return { ok: false, httpStatus: 404, error: "Not found" };
  }
  if (sha256(bytes) !== doc.sha256) {
    await auditDocument("document.accessed", "error", {
      documentId, studyId: doc.study_id, actor,
      detail: "INTEGRITY_FAILED stored bytes do not match recorded sha256",
    });
    return { ok: false, httpStatus: 409, error: "INTEGRITY_FAILED" };
  }
  await auditDocument("document.accessed", "ok", {
    documentId, studyId: doc.study_id, actor, detail: `size=${bytes.length} sha256=${doc.sha256.slice(0, 12)}`,
  });
  return {
    ok: true,
    httpStatus: 200,
    bytes,
    documentId,
    headers: documentResponseHeaders(documentId, bytes.length),
  };
}

export async function deleteDocument(documentId: string, actor: string): Promise<{ ok: boolean; error?: string }> {
  const doc = await getDocument(documentId);
  if (!doc || doc.status === "DELETED") return { ok: false, error: "Not found" };
  doc.status = "DELETED";
  doc.updated_at = new Date().toISOString();
  await putDocument(doc);
  await deleteOriginalDocument(documentId);
  await audit({
    actor: `user:${actor}`,
    action: "document.deleted",
    resource: "document",
    resourceId: documentId,
    studyId: doc.study_id,
    outcome: "ok",
    detail: `original bytes removed; audit record retained`,
  });
  return { ok: true };
}
