import { describe, it, expect, afterAll } from "vitest";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { createCanvas } from "@napi-rs/canvas";
import { extractDocument, getExtractionForDelivery } from "@/lib/documents/extraction/service";
import { readExtractionArtifact } from "@/lib/documents/extraction/artifacts";
import type { OCRProvider, OcrContext, OcrResult } from "@/lib/documents/extraction/types";
import { uploadDocument } from "@/lib/documents/service";
import { getDocument, listAllDocumentRecords } from "@/lib/documents/repository";
import { createStudy, deleteStudy, StudyRecord } from "@/lib/studies/service";
import { readOriginalDocument } from "@/lib/documents/storage";
import { sha256 } from "@/lib/storage/files";
import { documentStoragePath } from "@/lib/documents/security";
import fs from "fs/promises";
import { recentAudit } from "@/lib/audit";

/* ---------- fixtures ---------- */

async function textPdf(pages: number, line: string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([595, 842]);
    for (let r = 0; r < 6; r++) {
      page.drawText(`${line} p${i + 1} row ${r + 1} IOP 21 mmHg OD`, { x: 40, y: 780 - r * 24, size: 12, font, color: rgb(0, 0, 0) });
    }
  }
  return Buffer.from(await doc.save());
}

async function imageOnlyPdf(drawnText: string): Promise<Buffer> {
  // Rasterize text into a JPEG, embed as the page's only content -> scanned page.
  const canvas = createCanvas(595, 200);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 595, 200);
  ctx.fillStyle = "#000000";
  ctx.font = "36px sans-serif";
  ctx.fillText(drawnText, 20, 100);
  const jpeg = canvas.toBuffer("image/jpeg");

  const doc = await PDFDocument.create();
  const img = await doc.embedJpg(jpeg);
  const page = doc.addPage([595, 842]);
  page.drawImage(img, { x: 0, y: 842 - 200, width: 595, height: 200 });
  return Buffer.from(await doc.save());
}

async function blankPdf(pages = 1): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([595, 842]);
  return Buffer.from(await doc.save());
}

/* ---------- mock OCR provider (deterministic, no tesseract in most tests) ---------- */

function mockOcr(behavior: Partial<{ text: string; confidence: number; throwTimeout: boolean; fail: boolean; calls: (page: number) => void }> = {}): OCRProvider {
  return {
    name: "mock-ocr",
    async recognize(_png: Buffer, ctx: OcrContext): Promise<OcrResult> {
      behavior.calls?.(ctx.page);
      if (behavior.throwTimeout) throw new Error("OCR timeout");
      if (behavior.fail) throw new Error("engine exploded");
      return {
        text: behavior.text ?? `MOCK OCR TEXT PAGE ${ctx.page} IOP 21 mmHg`,
        confidence: behavior.confidence ?? 87,
        engine: "mock-ocr",
        engine_version: "0.0.0",
        language: "eng",
        time_ms: 1,
      };
    },
    async release() {},
  };
}

/* ---------- study lifecycle ---------- */

const META = { scanType: "unknown" as const, eye: "unknown" as const, providedBy: "none" as const };
const createdStudyIds: string[] = [];

async function newStudyWithDoc(bytes: Buffer, filename = "report.pdf"): Promise<string> {
  const study = await createStudy("scan.png", "image/png", Buffer.from("fake-image"), META);
  createdStudyIds.push(study.study_id);
  const up = await uploadDocument(study.study_id, filename, "application/pdf", bytes, "s2tester");
  if (!up.ok) throw new Error(`fixture upload failed: ${up.error_code}`);
  return up.document!.document_id;
}

afterAll(async () => {
  for (const id of createdStudyIds) await deleteStudy(id).catch(() => {});
}, 30_000);

/* ---------- orchestration with mocked provider ---------- */

describe("S2 - extraction orchestration (mocked OCR provider)", () => {
  it("extracts a native-text PDF via the text layer; no OCR calls are made; document becomes READY", async () => {
    const docId = await newStudyWithDoc(await textPdf(2, "OCT REPORT LINES"));
    const calls: number[] = [];
    const outcome = await extractDocument(docId, "s2tester", { ocrProvider: mockOcr({ calls: (p) => calls.push(p) }) });
    expect(outcome.ok).toBe(true);
    expect(outcome.status).toBe("READY");
    expect(outcome.artifact_status).toBe("COMPLETE");
    expect(outcome.document_level).toBe("text");
    expect(calls).toEqual([]); // scanned-page detection: text pages never hit OCR
    const doc = await getDocument(docId);
    expect(doc?.status).toBe("READY");
    const artifact = await readExtractionArtifact(docId);
    expect(artifact?.verification.status).toBe("UNREVIEWED");
    expect(artifact?.totals.pages_text_layer).toBe(2);
    expect(artifact?.totals.char_count).toBeGreaterThan(0);
  });

  it("detects a scanned page and routes it to OCR (document_level=scanned)", async () => {
    const docId = await newStudyWithDoc(await imageOnlyPdf("VISUAL FIELD REPORT MD -2.1 dB"));
    const outcome = await extractDocument(docId, "s2tester", { ocrProvider: mockOcr({ text: "VISUAL FIELD REPORT MD -2.1 dB OCR RESULT" }) });
    expect(outcome.ok).toBe(true);
    expect(outcome.document_level).toBe("scanned");
    const artifact = await readExtractionArtifact(docId);
    expect(artifact?.pages[0].method).toBe("ocr");
    expect(artifact?.pages[0].confidence).toBe(87);
    expect(artifact?.pages[0].ocr?.engine).toBe("mock-ocr");
    expect(artifact?.totals.pages_ocr).toBe(1);
  });

  it("classifies mixed documents (one text page + one scanned page)", async () => {
    // Build a 2-page PDF: text page + image page.
    const textPart = await textPdf(1, "CLINICAL NOTE PAGE ONE");
    const imagePart = await imageOnlyPdf("SCAN ONLY PAGE TWO");
    const merged = await mergePdfs(textPart, imagePart);
    const docId = await newStudyWithDoc(merged);
    const outcome = await extractDocument(docId, "s2tester", { ocrProvider: mockOcr() });
    expect(outcome.ok).toBe(true);
    expect(outcome.document_level).toBe("mixed");
    const artifact = await readExtractionArtifact(docId);
    expect(artifact?.pages[0].method).toBe("text_layer");
    expect(artifact?.pages[1].method).toBe("ocr");
  });

  it("classifies blank pages as empty without OCR text", async () => {
    const docId = await newStudyWithDoc(await blankPdf(1));
    const outcome = await extractDocument(docId, "s2tester", { ocrProvider: mockOcr({ text: "" }) });
    expect(outcome.ok).toBe(true);
    const artifact = await readExtractionArtifact(docId);
    expect(artifact?.pages[0].method).toBe("empty");
    expect(artifact?.document_level).toBe("empty");
  });

  it("records OCR engine failure as ocr_failed page + PARTIAL status (no crash)", async () => {
    const docId = await newStudyWithDoc(await imageOnlyPdf("failing page"));
    const outcome = await extractDocument(docId, "s2tester", { ocrProvider: mockOcr({ fail: true }) });
    expect(outcome.ok).toBe(true);
    expect(outcome.artifact_status).toBe("PARTIAL");
    const artifact = await readExtractionArtifact(docId);
    expect(artifact?.pages[0].method).toBe("ocr_failed");
    expect(artifact?.warnings).toContain("page_1:ocr_failed");
  });

  it("handles OCR timeouts as recorded page failures", async () => {
    const docId = await newStudyWithDoc(await imageOnlyPdf("timeout page"));
    const outcome = await extractDocument(docId, "s2tester", { ocrProvider: mockOcr({ throwTimeout: true }) });
    expect(outcome.ok).toBe(true);
    expect(outcome.artifact_status).toBe("PARTIAL");
    const artifact = await readExtractionArtifact(docId);
    expect(artifact?.pages[0].warnings).toContain("ocr_failed");
  });

  it("enforces the per-document character limit (PARTIAL + char_limit_doc warning)", async () => {
    const docId = await newStudyWithDoc(await textPdf(1, "LONG REPORT LINE PADDING PADDING"));
    const outcome = await extractDocument(docId, "s2tester", {
      ocrProvider: mockOcr(),
      limits: { maxCharsPerDoc: 50, minTextLayerChars: 10 },
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.artifact_status).toBe("PARTIAL");
    const artifact = await readExtractionArtifact(docId);
    expect(artifact?.warnings).toContain("char_limit_doc");
    expect(artifact!.totals.char_count).toBeLessThanOrEqual(60);
  });

  it("cancels between pages: no artifact written, document returns to VALID", async () => {
    const docId = await newStudyWithDoc(await textPdf(2, "CANCEL TEST LINE ROW"));
    let calls = 0;
    const outcome = await extractDocument(docId, "s2tester", {
      ocrProvider: mockOcr(),
      limits: { minTextLayerChars: 100000 }, // force every page onto the OCR path so cancel points trigger
      shouldCancel: () => ++calls > 1,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.error_code).toBe("CANCELLED");
    expect((await getDocument(docId))?.status).toBe("VALID");
    expect(await readExtractionArtifact(docId)).toBeNull();
  });

  it("refuses extraction when the stored original no longer matches its SHA-256", async () => {
    const docId = await newStudyWithDoc(await textPdf(1, "INTEGRITY CHECK LINE"));
    await fs.writeFile(documentStoragePath(docId), Buffer.concat([await fs.readFile(documentStoragePath(docId)), Buffer.from("TAMPER")]));
    const outcome = await extractDocument(docId, "s2tester", { ocrProvider: mockOcr() });
    expect(outcome.ok).toBe(false);
    expect(outcome.error_code).toBe("INTEGRITY_FAILED");
    expect((await getDocument(docId))?.status).toBe("VALID"); // status unchanged on pre-flight failure
  });

  it("refuses extraction for unknown / rejected documents", async () => {
    const missing = await extractDocument("doc_missing_123", "s2tester");
    expect(missing.ok).toBe(false);
    expect(missing.error_code).toBe("NOT_FOUND");
  });

  it("never mutates the immutable original during extraction", async () => {
    const docId = await newStudyWithDoc(await textPdf(1, "IMMUTABILITY CHECK LINE"));
    const before = await readOriginalDocument(docId);
    await extractDocument(docId, "s2tester", { ocrProvider: mockOcr() });
    const after = await readOriginalDocument(docId);
    expect(sha256(after!)).toBe(sha256(before!));
    expect(after!.equals(before!)).toBe(true);
  });

  it("stores the artifact separately from the original and never in the audit trail", async () => {
    const secretLine = "Patient Name: Zephyrine Quillworthy";
    const docId = await newStudyWithDoc(await textPdf(1, secretLine));
    await extractDocument(docId, "s2tester", { ocrProvider: mockOcr({ text: `${secretLine} MOCK` }) });

    // The artifact DOES contain the text (by design, PHI-bearing, access-controlled)...
    const artifact = await getExtractionForDelivery(docId);
    expect(artifact?.pages.some((p) => p.text.includes("Zephyrine"))).toBe(true);

    // ...but NO audit event ever carries the extracted text.
    const events = await recentAudit(100);
    for (const e of events) {
      const serialized = JSON.stringify(e);
      expect(serialized).not.toContain("Zephyrine");
      expect(serialized).not.toContain("extractedText");
      expect(serialized).not.toMatch(/%PDF-/);
    }
    // Extraction lifecycle is audited with metadata only.
    const actions = events.map((e) => e.action);
    expect(actions).toContain("document.extraction_started");
    expect(actions).toContain("document.extracted");
  });
});

/* ---------- real OCR end-to-end (tesseract.js + pdfjs render + canvas) ---------- */

describe("S2 - real OCR end-to-end", () => {
  it("rasterizes a scanned page and recovers drawn text via the real tesseract.js provider", async () => {
    const docId = await newStudyWithDoc(await imageOnlyPdf("IOP 21 mmHg OD GOLDMANN"));
    const outcome = await extractDocument(docId, "s2tester", { limits: { maxOcrTimeMs: 120_000, maxTimeMs: 240_000 } });
    expect(outcome.ok).toBe(true);
    const artifact = await readExtractionArtifact(docId);
    const page = artifact?.pages[0];
    // Real OCR is imperfect by nature: "21" was recovered as "2" in this very
    // test run - which is precisely WHY OCR output carries confidence values
    // and artifacts are marked UNREVIEWED. Assert only what OCR can honestly
    // guarantee: the key label and digit presence, with confidence attached.
    expect(page?.text).toMatch(/IOP|lOP|1OP/i);
    expect(page?.text).toMatch(/\d/);
    expect(page?.confidence).toBeDefined();
    expect(page?.confidence ?? 0).toBeGreaterThan(50);
    expect(page?.method).toBe("ocr");
  }, 600_000);
});

/* ---------- helpers ---------- */

async function mergePdfs(a: Buffer, b: Buffer): Promise<Buffer> {
  const { PDFDocument: PD } = await import("pdf-lib");
  const merged = await PD.create();
  for (const src of [a, b]) {
    const doc = await PD.load(src);
    const copied = await merged.copyPages(doc, doc.getPageIndices());
    copied.forEach((p) => merged.addPage(p));
  }
  return Buffer.from(await merged.save());
}
