import { describe, it, expect, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { PDFDocument, PDFDict, PDFName, PDFRawStream } from "pdf-lib";
import fs from "fs/promises";
import path from "path";
import { validatePdf, DEFAULT_VALIDATION_LIMITS } from "@/lib/documents/validation";
import { sanitizeDisplayName, documentStoragePath, contentDispositionName } from "@/lib/documents/security";
import { uploadDocument, readDocumentForDelivery, deleteDocument } from "@/lib/documents/service";
import { listAllDocumentRecords } from "@/lib/documents/repository";
import { createStudy, deleteStudy, StudyRecord } from "@/lib/studies/service";
import { DeviceMetadata } from "@/lib/devices/adapter";
import { readOriginalDocument } from "@/lib/documents/storage";
import { sha256 } from "@/lib/storage/files";
import { createSession, SESSION_COOKIE } from "@/lib/auth/sessions";
import { recentAudit } from "@/lib/audit";

/* ---------- synthetic fixture builders (no committed binary fixtures; no real/PHI documents) ---------- */

async function makeValidPdf(pages = 2): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([595, 842]);
  return Buffer.from(await doc.save());
}

/** Injects a dangerous object into an otherwise valid PDF via pdf-lib's own low-level API. */
async function makePdfWithDangerousKey(key: string, value: Record<string, unknown>): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.addPage();
  const context = doc.context;
  const dangerous = context.obj(value as unknown as Parameters<typeof context.obj>[0]) as unknown as PDFDict;
  const ref = context.register(dangerous);
  const catalog = context.lookup(context.trailerInfo.Root) as PDFDict;
  catalog.set(PDFName.of(key), ref);
  return Buffer.from(await doc.save());
}

/** Embedded-file variant: a Filespec + EmbeddedFile stream registered as indirect objects. */
async function makePdfWithEmbeddedFile(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.addPage();
  const context = doc.context;
  const stream = PDFRawStream.of(context.obj({ Type: "EmbeddedFile" }), new Uint8Array([1, 2, 3, 4]));
  const streamRef = context.register(stream);
  const filespec = context.obj({ Type: "Filespec", F: "payload.bin", EF: { F: streamRef } }) as PDFDict;
  context.register(filespec);
  return Buffer.from(await doc.save());
}

/** Encrypt-flag variant: insert /Encrypt into the classic trailer of a valid PDF (offset-safe in the trailer region). */
async function makeEncryptedPdf(): Promise<Buffer> {
  const bytes = Buffer.from(await makeValidPdfRaw(1));
  const text = bytes.toString("latin1");
  if (!text.includes("trailer\n<<")) throw new Error("fixture error: classic trailer not found in generated PDF");
  return Buffer.from(text.replace("trailer\n<<", "trailer\n<< /Encrypt 1 0 R "), "latin1");
}

async function makeValidPdfRaw(pages = 2): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([595, 842]);
  return doc.save({ useObjectStreams: false }); // classic xref + trailer so the fixture can inject /Encrypt
}

function fakeNotPdf(): Buffer {
  return Buffer.from("this is definitely not a portable document format file", "utf8");
}

/* ---------- helpers ---------- */

const META: DeviceMetadata = { scanType: "unknown", eye: "unknown", providedBy: "none" };
const createdStudyIds: string[] = [];

async function newStudy(): Promise<StudyRecord> {
  const study = await createStudy("s1-test.png", "image/png", Buffer.from("fake-image-bytes"), META);
  createdStudyIds.push(study.study_id);
  return study;
}

afterAll(async () => {
  for (const id of createdStudyIds) await deleteStudy(id).catch(() => {});
});

/* ---------- validation ---------- */

describe("S1 - PDF content validation (bytes only, never filename/MIME)", () => {
  it("accepts a structurally valid multi-page PDF", async () => {
    const result = await validatePdf(await makeValidPdf(3));
    expect(result.ok).toBe(true);
    expect(result.page_count).toBe(3);
  });

  it("rejects an empty buffer", async () => {
    const result = await validatePdf(Buffer.alloc(0));
    expect(result.ok).toBe(false);
    expect(result.error_code).toBe("INVALID_DOCUMENT");
  });

  it("rejects a fake PDF that lacks the %PDF- signature regardless of extension", async () => {
    const result = await validatePdf(fakeNotPdf());
    expect(result.ok).toBe(false);
    expect(result.error_code).toBe("INVALID_DOCUMENT");
  });

  it("rejects a truncated PDF missing the %%EOF marker", async () => {
    const bytes = await makeValidPdf(2);
    const truncated = bytes.subarray(0, Math.floor(bytes.length * 0.6));
    const result = await validatePdf(Buffer.from(truncated));
    expect(result.ok).toBe(false);
    expect(result.error_code).toBe("INVALID_DOCUMENT");
  });

  it("rejects a PDF with more pages than the configured limit", async () => {
    const result = await validatePdf(await makeValidPdf(6), { maxBytes: DEFAULT_VALIDATION_LIMITS.maxBytes, maxPages: 5 });
    expect(result.ok).toBe(false);
    expect(result.error_code).toBe("TOO_MANY_PAGES");
  });

  it("rejects a file larger than the configured size limit", async () => {
    const result = await validatePdf(await makeValidPdf(1), { maxBytes: 10, maxPages: 5 });
    expect(result.ok).toBe(false);
    expect(result.error_code).toBe("TOO_LARGE");
  });

  it("rejects an encrypted PDF (fail closed)", async () => {
    const result = await validatePdf(await makeEncryptedPdf());
    expect(result.ok).toBe(false);
    expect(result.error_code).toBe("INVALID_DOCUMENT");
    expect(result.detail).toMatch(/encrypt/i);
  });

  it("rejects JavaScript via OpenAction (UNSAFE_DOCUMENT)", async () => {
    const bytes = await makePdfWithDangerousKey("OpenAction", { S: "JavaScript", JS: "(app.alert(1))" });
    const result = await validatePdf(bytes);
    expect(result.ok).toBe(false);
    expect(result.error_code).toBe("UNSAFE_DOCUMENT");
  });

  it("rejects a bare /JavaScript action object", async () => {
    const bytes = await makePdfWithDangerousKey("AA", { S: "JavaScript", JS: "(x)" });
    const result = await validatePdf(bytes);
    expect(result.ok).toBe(false);
    expect(result.error_code).toBe("UNSAFE_DOCUMENT");
  });

  it("rejects Launch actions", async () => {
    const bytes = await makePdfWithDangerousKey("OpenAction", { S: "Launch", F: "cmd.exe" });
    const result = await validatePdf(bytes);
    expect(result.ok).toBe(false);
    expect(result.error_code).toBe("UNSAFE_DOCUMENT");
  });

  it("rejects embedded files (Filespec/EmbeddedFile)", async () => {
    const result = await validatePdf(await makePdfWithEmbeddedFile());
    expect(result.ok).toBe(false);
    expect(result.error_code).toBe("UNSAFE_DOCUMENT");
  });

  it("rejects RichMedia embedded content", async () => {
    const bytes = await makePdfWithDangerousKey("RichMedia", { Type: "RichMedia", Subtype: "3D" });
    const result = await validatePdf(bytes);
    expect(result.ok).toBe(false);
    expect(result.error_code).toBe("UNSAFE_DOCUMENT");
  });
});

/* ---------- security helpers ---------- */

describe("S1 - filename sanitization and path safety", () => {
  it("strips traversal components from display filenames", () => {
    expect(sanitizeDisplayName("../../evil.pdf")).toBe("evil.pdf");
    expect(sanitizeDisplayName("..\\..\\windows\\evil.pdf")).toBe("evil.pdf");
    expect(sanitizeDisplayName("\\\\server\\share\\report.pdf")).toBe("report.pdf");
    expect(sanitizeDisplayName("C:\\Users\\pc\\secret.pdf")).toBe("secret.pdf");
    expect(sanitizeDisplayName("re\u0000port.pdf")).toBe("report.pdf");
  });

  it("rejects path-traversal document ids when deriving storage paths", () => {
    for (const id of ["../../etc/passwd", "a/b", "..\\evil", "C:\\evil.pdf", "doc_1/../evil", "doc\u0000", "" ]) {
      expect(() => documentStoragePath(id)).toThrow();
    }
  });

  it("accepts well-formed server-generated ids", () => {
    expect(() => documentStoragePath("doc_mq2xh81abc")).not.toThrow();
  });

  it("download filenames are server-derived and never user-controlled", () => {
    expect(contentDispositionName("doc_abc123")).toBe("document-doc_abc123.pdf");
    expect(contentDispositionName("doc_x/y")).toBe("document-doc_xy.pdf");
  });
});

/* ---------- service end-to-end ---------- */

describe("S1 - document service (upload, integrity, duplicates, deletion)", () => {
  it("uploads a valid PDF: sha256 from actual bytes, immutable original on disk, UNKNOWN type", async () => {
    const study = await newStudy();
    const bytes = await makeValidPdf(2);
    const outcome = await uploadDocument(study.study_id, "oct-report.pdf", "application/pdf", bytes, "s1tester");
    expect(outcome.ok).toBe(true);
    expect(outcome.httpStatus).toBe(201);
    expect(outcome.document?.sha256).toBe(sha256(bytes));
    expect(outcome.document?.status).toBe("VALID");
    expect(outcome.document?.document_type).toBe("UNKNOWN");
    expect(outcome.document?.page_count).toBe(2);
    const onDisk = await readOriginalDocument(outcome.document!.document_id);
    expect(onDisk).not.toBeNull();
    expect(sha256(onDisk!)).toBe(outcome.document!.sha256);
  });

  it("reports an explicit duplicate for identical bytes in the same study (ALREADY_EXISTS)", async () => {
    const study = await newStudy();
    const bytes = await makeValidPdf(1);
    const first = await uploadDocument(study.study_id, "a.pdf", "application/pdf", bytes, "s1tester");
    expect(first.httpStatus).toBe(201);
    const second = await uploadDocument(study.study_id, "b.pdf", "application/pdf", bytes, "s1tester");
    expect(second.httpStatus).toBe(200);
    expect(second.duplicate).toBe(true);
    expect(second.document?.document_id).toBe(first.document!.document_id);
  });

  it("rejects a non-PDF upload: no original stored, REJECTED record kept, explicit error", async () => {
    const study = await newStudy();
    const outcome = await uploadDocument(study.study_id, "fake.pdf", "application/pdf", fakeNotPdf(), "s1tester");
    expect(outcome.ok).toBe(false);
    expect(outcome.error_code).toBe("INVALID_DOCUMENT");
    const all = await listAllDocumentRecords();
    const rec = all.find((d) => d.study_id === study.study_id);
    expect(rec?.status).toBe("REJECTED");
    expect(rec?.storage_path).toBe("");
    expect(await readOriginalDocument(rec!.document_id)).toBeNull();
  });

  it("fails closed on upload to a non-existent study", async () => {
    const outcome = await uploadDocument("study_does_not_exist", "x.pdf", "application/pdf", await makeValidPdf(1), "s1tester");
    expect(outcome.ok).toBe(false);
    expect(outcome.error_code).toBe("STUDY_NOT_FOUND");
  });

  it("serves the original with secure headers and no user-controlled filename", async () => {
    const study = await newStudy();
    const bytes = await makeValidPdf(1);
    const up = await uploadDocument(study.study_id, "../../naughty.pdf", "application/pdf", bytes, "s1tester");
    const delivery = await readDocumentForDelivery(up.document!.document_id, "s1tester");
    expect(delivery.ok).toBe(true);
    const headers = delivery.headers!;
    expect(headers["Content-Type"]).toBe("application/pdf");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Content-Security-Policy"]).toContain("sandbox");
    expect(headers["Cache-Control"]).toBe("no-store");
    expect(headers["Content-Disposition"]).toMatch(/^inline; filename="document-doc_[A-Za-z0-9_.-]+\.pdf"$/);
    expect(headers["Content-Disposition"]).not.toContain("naughty");
    expect(delivery.bytes!.equals(bytes)).toBe(true);
  });

  it("detects on-disk tampering: modified original is refused (INTEGRITY_FAILED)", async () => {
    const study = await newStudy();
    const bytes = await makeValidPdf(1);
    const up = await uploadDocument(study.study_id, "report.pdf", "application/pdf", bytes, "s1tester");
    const docId = up.document!.document_id;
    const tampered = Buffer.concat([bytes, Buffer.from("TAMPERED")]);
    await fs.writeFile(documentStoragePath(docId), tampered);
    const delivery = await readDocumentForDelivery(docId, "s1tester");
    expect(delivery.ok).toBe(false);
    expect(delivery.httpStatus).toBe(409);
    expect(delivery.error).toBe("INTEGRITY_FAILED");
  });

  it("deletion removes the original bytes but retains the audit record (status DELETED)", async () => {
    const study = await newStudy();
    const up = await uploadDocument(study.study_id, "report.pdf", "application/pdf", await makeValidPdf(1), "s1tester");
    const docId = up.document!.document_id;
    const del = await deleteDocument(docId, "s1tester");
    expect(del.ok).toBe(true);
    expect(await readOriginalDocument(docId)).toBeNull();
    const all = await listAllDocumentRecords();
    expect(all.find((d) => d.document_id === docId)?.status).toBe("DELETED");
    const again = await readDocumentForDelivery(docId, "s1tester");
    expect(again.httpStatus).toBe(404);
  });

  it("deleting the study cascades to its documents", async () => {
    const study = await newStudy();
    const up = await uploadDocument(study.study_id, "report.pdf", "application/pdf", await makeValidPdf(1), "s1tester");
    await deleteStudy(study.study_id);
    createdStudyIds.pop(); // already deleted - prevent double-delete in afterAll
    const all = await listAllDocumentRecords();
    const doc = all.find((d) => d.document_id === up.document!.document_id);
    expect(doc?.status).toBe("DELETED");
    expect(await readOriginalDocument(up.document!.document_id)).toBeNull();
  });
});

/* ---------- audit ---------- */

describe("S1 - document audit events (metadata only, never content)", () => {
  it("logs upload/accept/access lifecycle events with ids and hashes only", async () => {
    const study = await newStudy();
    const up = await uploadDocument(study.study_id, "report.pdf", "application/pdf", await makeValidPdf(1), "s1tester");
    await readDocumentForDelivery(up.document!.document_id, "s1tester");
    const events = await recentAudit(50);
    const actions = events.filter((e) => e.action?.startsWith("document."));
    const actionNames = actions.map((e) => e.action);
    expect(actionNames).toContain("document.upload_started");
    expect(actionNames).toContain("document.uploaded");
    expect(actionNames).toContain("document.accepted");
    expect(actionNames).toContain("document.accessed");
    const upEvent = actions.find((e) => e.action === "document.uploaded")!;
    expect(upEvent.resourceId).toBe(up.document!.document_id);
  });

  it("logs validation failures for rejected documents", async () => {
    const study = await newStudy();
    await uploadDocument(study.study_id, "fake.pdf", "application/pdf", fakeNotPdf(), "s1tester");
    const events = await recentAudit(50);
    expect(events.some((e) => e.action === "document.validation_failed" && e.outcome === "rejected")).toBe(true);
  });

  it("never places raw PDF bytes or content into the audit trail", async () => {
    const study = await newStudy();
    const pdfBytes = await makeValidPdf(1);
    await uploadDocument(study.study_id, "report.pdf", "application/pdf", pdfBytes, "s1tester");
    await readDocumentForDelivery((await listAllDocumentRecords()).find((d) => d.study_id === study.study_id)!.document_id, "s1tester");
    const events = await recentAudit(100);
    for (const e of events.filter((e) => e.action?.startsWith("document."))) {
      const serialized = JSON.stringify(e);
      expect(serialized).not.toContain("%PDF-");
      expect(serialized).not.toContain("extractedText");
      expect(serialized).not.toContain("rawDocument");
    }
  });
});

/* ---------- route-level authorization (requireRole is the boundary) ---------- */

function reqFor(url: string, cookies: Record<string, string> = {}, method = "GET"): NextRequest {
  const cookieHeader = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  return new NextRequest(new URL(url, "http://localhost:3000"), { method, headers: { cookie: cookieHeader } });
}
const DOCS_UPLOAD = (await import("@/app/api/studies/[id]/documents/route")) as typeof import("@/app/api/studies/[id]/documents/route");
const DOC_FILE = (await import("@/app/api/documents/[id]/file/route")) as typeof import("@/app/api/documents/[id]/file/route");

describe("S1 - route authorization (401 / 403 / least privilege)", () => {
  it("POST documents: unauthenticated request returns 401", async () => {
    const res = await DOCS_UPLOAD.POST(reqFor("http://localhost:3000/api/studies/study_x/documents", {}, "POST"), { params: { id: "study_x" } });
    expect(res.status).toBe(401);
  });

  it("POST documents: RESEARCHER (PHI-excluded role) returns 403", async () => {
    const { token } = await createSession({ user_id: "s1res", username: "s1res", role: "RESEARCHER" });
    const res = await DOCS_UPLOAD.POST(reqFor("http://localhost:3000/api/studies/study_x/documents", { [SESSION_COOKIE]: token }, "POST"), { params: { id: "study_x" } });
    expect(res.status).toBe(403);
  });

  it("GET document file: unauthenticated returns 401", async () => {
    const res = await DOC_FILE.GET(reqFor("http://localhost:3000/api/documents/doc_x/file"), { params: { id: "doc_x" } });
    expect(res.status).toBe(401);
  });

  it("GET document file: TECHNICIAN can upload but is denied file bytes (least privilege)", async () => {
    const { token } = await createSession({ user_id: "s1tech", username: "s1tech", role: "TECHNICIAN" });
    const res = await DOC_FILE.GET(reqFor("http://localhost:3000/api/documents/doc_x/file", { [SESSION_COOKIE]: token }), { params: { id: "doc_x" } });
    expect(res.status).toBe(403);
  });

  it("GET document list: TECHNICIAN may view status (empty list is a 200)", async () => {
    const { token } = await createSession({ user_id: "s1tech2", username: "s1tech2", role: "TECHNICIAN" });
    const res = await DOCS_UPLOAD.GET(reqFor("http://localhost:3000/api/studies/study_none/documents", { [SESSION_COOKIE]: token }), { params: { id: "study_none" } });
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.documents).toEqual([]);
  });
});
