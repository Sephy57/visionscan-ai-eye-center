import { dbPut, dbGet, dbAll, dbDelete } from "../storage/db";
import { DocumentRecord, DocumentSummary, toSummary } from "./types";

/**
 * Document repository (S1). Uses the existing JSON document-store
 * abstraction (atomic writes) - a NEW "documents" collection; no second
 * persistence mechanism is introduced.
 */

export async function putDocument(doc: DocumentRecord): Promise<void> {
  await dbPut("documents", doc.document_id, doc);
}

export async function getDocument(documentId: string): Promise<DocumentRecord | null> {
  // ids are opaque server-generated strings; lookup is by map key, so a
  // traversal-style id can never resolve to a record (and never to a path).
  return dbGet<DocumentRecord>("documents", documentId);
}

export async function listDocumentsByStudy(studyId: string): Promise<DocumentSummary[]> {
  const all = await dbAll<DocumentRecord>("documents");
  return all
    .filter((d) => d.study_id === studyId && d.status !== "DELETED")
    .sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at))
    .map(toSummary);
}

export async function listAllDocumentRecords(): Promise<DocumentRecord[]> {
  return dbAll<DocumentRecord>("documents");
}

export async function deleteDocumentRecord(documentId: string): Promise<boolean> {
  return dbDelete("documents", documentId);
}

/** Case-insensitive layering kept minimal: summaries never contain content. */
export function toPublicSummary(doc: DocumentRecord): DocumentSummary {
  return toSummary(doc);
}
