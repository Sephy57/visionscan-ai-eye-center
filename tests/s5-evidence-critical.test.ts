import { describe, it, expect, afterAll } from "vitest";
import { buildEvidenceWorkspace } from "@/lib/evidence/synthesize";
import { createStudy, deleteStudy, setStudySymptoms, analyzeStudy, getStudyBundle } from "@/lib/studies/service";
import { uploadDocument } from "@/lib/documents/service";
import { extractDocument } from "@/lib/documents/extraction/service";
import { generateResultsForDocument, listTestResultsForDocument, verifyTestResult } from "@/lib/documents/extraction/testResultService";
import { DeviceMetadata } from "@/lib/devices/adapter";
import type { OCRProvider, OcrContext, OcrResult } from "@/lib/documents/extraction/types";

/**
 * S5.22/S5.23 - the two mandatory safety tests from the S5 authorization:
 *  1. an OD test result must never be associated with an OS symptom (or vice
 *     versa) in the evidence/conflict/condition layer
 *  2. an extreme documented IOP value must produce correctly-represented,
 *     correctly-provenanced, non-diagnostic evidence - never a fabricated
 *     diagnosis/treatment, and never a model invocation outside the existing
 *     authorized (DEMO) image pipeline
 */

function mockOcr(): OCRProvider {
  return {
    name: "mock-ocr",
    async recognize(_png: Buffer, ctx: OcrContext): Promise<OcrResult> {
      return { text: `MOCK OCR PAGE ${ctx.page}`, confidence: 90, engine: "mock-ocr", engine_version: "0.0.0", language: "eng", time_ms: 1 };
    },
    async release() {},
  };
}

const META: DeviceMetadata = { scanType: "unknown", eye: "unknown", providedBy: "none" };
const createdStudyIds: string[] = [];

async function pngBytes(): Promise<Buffer> {
  const { createCanvas } = await import("@napi-rs/canvas");
  const canvas = createCanvas(600, 600);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#1a1a2e";
  ctx.fillRect(0, 0, 600, 600);
  return canvas.toBuffer("image/png");
}

async function studyWithPdf(lines: string): Promise<{ studyId: string; documentId: string }> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  lines.split("\n").forEach((line, i) => page.drawText(line, { x: 40, y: 780 - i * 24, size: 11, font, color: rgb(0, 0, 0) }));
  const bytes = Buffer.from(await doc.save());
  const study = await createStudy("scan.png", "image/png", await pngBytes(), META);
  createdStudyIds.push(study.study_id);
  const up = await uploadDocument(study.study_id, "report.pdf", "application/pdf", bytes, "s5tester");
  if (!up.ok) throw new Error(`fixture upload failed: ${up.error_code}`);
  const ext = await extractDocument(up.document!.document_id, "s5tester", { ocrProvider: mockOcr() });
  if (!ext.ok) throw new Error(`fixture extraction failed: ${ext.error_code}`);
  return { studyId: study.study_id, documentId: up.document!.document_id };
}

afterAll(async () => {
  for (const id of createdStudyIds) await deleteStudy(id).catch(() => {});
});

describe("S5.22 - laterality never silently associated across sources", () => {
  it("an OD IOP result and an OS symptom never combine to support/contradict the same per-eye assessment", async () => {
    const { studyId, documentId } = await studyWithPdf("IOP OD 28 mmHg documented");
    await generateResultsForDocument(documentId, "s5tester");
    await setStudySymptoms(studyId, [
      { type: "blurred_vision", onset: "gradual", duration: "weeks", severity: "mild", laterality: "left", progression: "stable", frequency: "unknown" },
    ]);

    const ws = await buildEvidenceWorkspace(studyId);
    if ("not_found" in ws) throw new Error("study not found");

    const iopEvidence = ws.evidence.find((e) => e.source_type === "TEST_RESULT" && e.category === "IOP");
    const symptomEvidence = ws.evidence.find((e) => e.source_type === "SYMPTOM");
    expect(iopEvidence?.laterality).toBe("OD");
    expect(symptomEvidence?.laterality).toBe("OS"); // mapped from "left", never merged with "OD"

    // No conflict or condition assessment may combine these two into one bucket.
    for (const conflict of ws.conflicts) {
      const involvesIop = conflict.evidence_ids.includes(iopEvidence!.id);
      const involvesSymptom = conflict.evidence_ids.includes(symptomEvidence!.id);
      expect(involvesIop && involvesSymptom).toBe(false);
    }

    const iopConditions = ws.possible_conditions.filter((c) => c.condition_id === "iop_evidence_pattern");
    const odAssessment = iopConditions.find((c) => c.laterality === "OD");
    const osAssessment = iopConditions.find((c) => c.laterality === "OS");
    expect(odAssessment?.supporting_evidence_ids).toContain(iopEvidence!.id);
    expect(odAssessment?.supporting_evidence_ids).not.toContain(symptomEvidence!.id);
    // OS assessment for this condition requires a TEST_RESULT IOP on OS (required evidence) - none exists, so UNABLE_TO_ASSESS, and the OD IOP evidence must never leak in as OS support.
    expect(osAssessment?.state).toBe("UNABLE_TO_ASSESS");
    expect(osAssessment?.supporting_evidence_ids).not.toContain(iopEvidence!.id);
  });

  it("contradictory laterality in source text stays UNKNOWN and is surfaced as a conflict, not resolved", async () => {
    const { studyId, documentId } = await studyWithPdf("IOP OD OS 22 mmHg both documented");
    await generateResultsForDocument(documentId, "s5tester");
    const ws = await buildEvidenceWorkspace(studyId);
    if ("not_found" in ws) throw new Error("study not found");
    const item = ws.evidence.find((e) => e.source_type === "TEST_RESULT");
    expect(item?.laterality).toBe("UNKNOWN");
    const latConflict = ws.conflicts.find((c) => c.conflict_type === "LATERALITY_CONFLICT");
    expect(latConflict).toBeDefined();
    expect(latConflict?.evidence_ids).toContain(item!.id);
  });
});

describe("S5.23 - extreme-value safety", () => {
  it("IOP OD 55 mmHg: evidence correct, provenance intact, no fabricated diagnosis/treatment, no unauthorized model, Gate D untouched", async () => {
    const { studyId, documentId } = await studyWithPdf("IOP OD 55 mmHg emergency-level value documented");
    await generateResultsForDocument(documentId, "s5tester");
    const [result] = await listTestResultsForDocument(documentId);
    expect(result.value).toBe(55);
    expect(result.laterality).toBe("OD");
    await verifyTestResult(result.result_id, { action: "verify", actor: "reviewer1" });

    const ws = await buildEvidenceWorkspace(studyId);
    if ("not_found" in ws) throw new Error("study not found");
    const evidence = ws.evidence.find((e) => e.source_type === "TEST_RESULT");
    expect(evidence?.value).toBe(55);
    expect(evidence?.laterality).toBe("OD");
    expect(evidence?.trust_level).toBe("HUMAN_VERIFIED"); // verification state respected, explicit
    expect(evidence?.provenance.document_id).toBe(documentId);
    expect(evidence?.provenance.page).toBeDefined();
    expect(evidence?.provenance.source_text).toContain("55");

    // No possible-condition state is a diagnosis or a probability - only the five allowed labels appear anywhere.
    const allowed = new Set(["POSSIBLE_CONDITION", "SUPPORTED_CONDITION", "INSUFFICIENT_EVIDENCE", "CONFLICTING_EVIDENCE", "UNABLE_TO_ASSESS"]);
    for (const c of ws.possible_conditions) expect(allowed.has(c.state)).toBe(true);
    const serializedWs = JSON.stringify(ws);
    expect(serializedWs).not.toMatch(/CONFIRMED_DIAGNOSIS/i);
    expect(serializedWs).not.toMatch(/treatment/i);
    expect(serializedWs).not.toMatch(/%\s*(confidence|probability)/i);

    // The image-analysis pipeline (the only authorized "model") remains unaffected by this PDF evidence.
    await analyzeStudy(studyId);
    const bundle = await getStudyBundle(studyId);
    const bundleSerialized = JSON.stringify(bundle);
    expect(bundleSerialized).not.toContain("test_results");
    expect(bundleSerialized).not.toContain("55 mmHg");
    expect(bundle.analysis!.recommendation.priority).not.toBe("emergency_evaluation");
  });
});

describe("S5.17 - cross-study contamination is prevented", () => {
  it("a second study's evidence workspace never contains the first study's results/symptoms", async () => {
    const { studyId: studyA, documentId: docA } = await studyWithPdf("IOP OD 19 mmHg documented");
    await generateResultsForDocument(docA, "s5tester");
    await setStudySymptoms(studyA, [{ type: "floaters", onset: "gradual", duration: "days", severity: "mild", laterality: "right", progression: "stable", frequency: "intermittent" }]);

    const studyB = await createStudy("scan2.png", "image/png", await pngBytes(), META);
    createdStudyIds.push(studyB.study_id);
    await setStudySymptoms(studyB.study_id, [{ type: "eye_pain", onset: "sudden", duration: "hours", severity: "severe", laterality: "left", progression: "worsening", frequency: "constant" }]);

    const wsA = await buildEvidenceWorkspace(studyA);
    const wsB = await buildEvidenceWorkspace(studyB.study_id);
    if ("not_found" in wsA || "not_found" in wsB) throw new Error("study not found");

    expect(wsA.evidence.every((e) => e.study_id === studyA)).toBe(true);
    expect(wsB.evidence.every((e) => e.study_id === studyB.study_id)).toBe(true);
    expect(wsB.evidence.some((e) => e.category === "floaters")).toBe(false);
    expect(wsB.evidence.some((e) => e.category === "IOP")).toBe(false);
    expect(wsA.evidence.some((e) => e.category === "eye_pain")).toBe(false);
  });
});
