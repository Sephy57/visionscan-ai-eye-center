import { describe, it, expect, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { buildTestResults, materializeResults } from "@/lib/documents/extraction/testResultParser";
import type { ExtractionArtifact } from "@/lib/documents/extraction/types";
import { generateResultsForDocument, listTestResultsForDocument, verifyTestResult, getTestResult } from "@/lib/documents/extraction/testResultService";
import { extractDocument } from "@/lib/documents/extraction/service";
import { createSession, SESSION_COOKIE } from "@/lib/auth/sessions";
import { createStudy, deleteStudy, analyzeStudy, getStudyBundle, StudyRecord } from "@/lib/studies/service";
import { uploadDocument } from "@/lib/documents/service";
import { audit } from "@/lib/audit";
import { DeviceMetadata } from "@/lib/devices/adapter";
import type { OCRProvider, OcrContext, OcrResult } from "@/lib/documents/extraction/types";

/** Minimal OCR stub - never called for text-layer pages in these fixtures. */
function mockOcr(): OCRProvider {
  return {
    name: "mock-ocr",
    async recognize(_png: Buffer, ctx: OcrContext): Promise<OcrResult> {
      return { text: `MOCK OCR TEXT PAGE ${ctx.page}`, confidence: 90, engine: "mock-ocr", engine_version: "0.0.0", language: "eng", time_ms: 1 };
    },
    async release() {},
  };
}

/* ---------- artifact fixtures (S2 output shape) ---------- */

function artifactWithPages(pages: Array<{ text: string; method: "text_layer" | "ocr"; confidence?: number }>, documentId = "doc_test"): ExtractionArtifact {
  return {
    document_id: documentId,
    study_id: "study_test",
    status: "COMPLETE",
    document_level: "text",
    pages: pages.map((p, i) => ({ page: i + 1, method: p.method, char_count: p.text.length, text: p.text, warnings: [], confidence: p.confidence })),
    totals: { pages: pages.length, pages_text_layer: pages.length, pages_ocr: 0, pages_empty: 0, pages_failed: 0, char_count: pages.reduce((a, p) => a + p.text.length, 0) },
    limits_applied: { max_chars_per_doc: 1, max_chars_per_page: 1, max_time_ms: 1, max_ocr_time_ms: 1, max_render_dimension_px: 1 },
    verification: { status: "UNREVIEWED" },
    extraction_version: "extraction-1.0.0",
    created_at: new Date().toISOString(),
    warnings: [],
  };
}

/* ---------- parser: THE ambiguity rule ---------- */

describe("S3 - THE ambiguity rule: OCR noise is preserved, never corrected", () => {
  it("does NOT interpret 'IOP OS 2l mmHg' as 21 mmHg - flags it for verification", () => {
    const drafts = buildTestResults(artifactWithPages([{ text: "IOP OS 2l mmHg", method: "ocr", confidence: 70 }]));
    expect(drafts).toHaveLength(1);
    const d = drafts[0];
    expect(d.test_type).toBe("IOP");
    expect(d.value_raw).toBe("2l");
    expect(d.value).toBeUndefined(); // THE critical assertion - no "helpful" cleanup
    expect(d.ambiguity_flags).toContain("unparseable_value");
    expect(d.laterality).toBe("OS");
    expect(d.source_text).toContain("2l");
  });

  it("does not interpret comma decimals ('0,4') without flagging", () => {
    const drafts = buildTestResults(artifactWithPages([{ text: "CDR OU 0,4", method: "text_layer" }]));
    expect(drafts[0].value_raw).toBe("0,4");
    expect(drafts[0].value).toBeUndefined();
    expect(drafts[0].ambiguity_flags).toContain("ambiguous_value");
  });

  it("accepts strict decimal values ('0.4', '21')", () => {
    const cdr = buildTestResults(artifactWithPages([{ text: "CDR OD 0.4", method: "text_layer" }]));
    expect(cdr[0].value).toBe(0.4);
    const iop = buildTestResults(artifactWithPages([{ text: "IOP OD 21 mmHg", method: "text_layer" }]));
    expect(iop[0].value).toBe(21);
  });
});

/* ---------- units ---------- */

describe("S3 - units: never guessed, deterministic conversion only", () => {
  it("converts kPa to mmHg deterministically and preserves the original", () => {
    const drafts = buildTestResults(artifactWithPages([{ text: "IOP OU 2.7 kPa", method: "text_layer" }]));
    expect(drafts[0].value).toBe(2.7);
    expect(drafts[0].unit_raw).toBe("kPa");
    expect(drafts[0].unit_normalized).toBe("mmHg");
    expect(drafts[0].value_normalized).toBeCloseTo(20.2517, 3);
    expect(drafts[0].conversion?.method).toMatch(/7.5006/);
    expect(drafts[0].value_raw).toBe("2.7"); // original preserved
  });

  it("converts mm to um for thickness values", () => {
    const drafts = buildTestResults(artifactWithPages([{ text: "CST OS 0.29 mm", method: "text_layer" }]));
    expect(drafts[0].unit_normalized).toBe("um");
    expect(drafts[0].value_normalized).toBeCloseTo(290, 6);
  });

  it("never converts unknown units and flags them", () => {
    const drafts = buildTestResults(artifactWithPages([{ text: "IOP OD 21 torr", method: "text_layer" }]));
    // 'torr' is not in the registry: value stays raw-only, flagged, no mmHg assumption
    expect(drafts[0].ambiguity_flags).toContain("unknown_unit");
    expect(drafts[0].value_normalized).toBeUndefined();
    expect(drafts[0].unit_normalized).toBeUndefined();
  });

  it("flags a missing unit instead of assuming mmHg", () => {
    const drafts = buildTestResults(artifactWithPages([{ text: "IOP OD measured 21 today", method: "text_layer" }]));
    // No unit token: nothing convertible follows - the number must not be silently unit-tagged
    expect(drafts[0].unit_raw).toBeUndefined();
    expect(drafts[0].unit_normalized).toBeUndefined();
    expect(drafts[0].value_normalized).toBeUndefined();
  });

  it("never converts Snellen or logMAR across scales", () => {
    const snellen = buildTestResults(artifactWithPages([{ text: "BCVA OD 20/40", method: "text_layer" }]));
    expect(snellen[0].test_type).toBe("VISUAL_ACUITY");
    expect(snellen[0].unit_normalized).toBe("snellen");
    expect(snellen[0].value).toBeUndefined(); // fractions are not parsed into a single number
    expect(snellen[0].value_raw).toBe("20/40");
    expect(snellen[0].ambiguity_flags).toContain("unconvertible_scale");
    const logmar = buildTestResults(artifactWithPages([{ text: "VA OS 0.30 logMAR", method: "text_layer" }]));
    expect(logmar[0].unit_normalized).toBe("logMAR");
    expect(logmar[0].ambiguity_flags).toContain("unconvertible_scale");
  });
});

/* ---------- laterality ---------- */

describe("S3 - laterality: explicit tokens only, OU never merged", () => {
  it("keeps OD and OS as separate results from one line", () => {
    const drafts = buildTestResults(artifactWithPages([{ text: "IOP OD 19 mmHg and IOP OS 24 mmHg", method: "text_layer" }]));
    const od = drafts.filter((d) => d.laterality === "OD");
    const os = drafts.filter((d) => d.laterality === "OS");
    expect(od).toHaveLength(1);
    expect(os).toHaveLength(1);
    expect(od[0].value).toBe(19);
    expect(os[0].value).toBe(24);
  });

  it("marks OU explicitly and never maps it to a single eye", () => {
    const drafts = buildTestResults(artifactWithPages([{ text: "CST OU 289 um", method: "text_layer" }]));
    expect(drafts[0].laterality).toBe("OU");
  });

  it("flags missing laterality as UNKNOWN", () => {
    const drafts = buildTestResults(artifactWithPages([{ text: "IOP 21 mmHg", method: "text_layer" }]));
    expect(drafts[0].laterality).toBe("UNKNOWN");
    expect(drafts[0].ambiguity_flags).toContain("missing_laterality");
  });

  it("flags contradictory laterality instead of choosing one", () => {
    const drafts = buildTestResults(artifactWithPages([{ text: "IOP OD OS 21 mmHg both documented", method: "text_layer" }]));
    expect(drafts[0].laterality).toBe("UNKNOWN");
    expect(drafts[0].ambiguity_flags).toContain("contradictory_laterality");
  });

  it("does not accept lowercase or embedded laterality tokens", () => {
    const drafts = buildTestResults(artifactWithPages([{ text: "IOP od 21 mmHg production", method: "text_layer" }]));
    expect(drafts[0].laterality).toBe("UNKNOWN"); // 'od' lowercase is not an explicit token
  });
});

/* ---------- reference ranges, dates ---------- */

describe("S3 - reference ranges and dates: from the document only", () => {
  it("attaches a reference range only when present in the source text", () => {
    const withRef = buildTestResults(artifactWithPages([{ text: "IOP OD 21 mmHg normal 10-21 mmHg recorded", method: "text_layer" }]));
    expect(withRef[0].reference_range).toBeDefined();
    expect(withRef[0].reference_range!.source).toBe("document_text");
    expect(withRef[0].reference_range!.low).toBe(10);
    expect(withRef[0].reference_range!.high).toBe(21);

    const withoutRef = buildTestResults(artifactWithPages([{ text: "IOP OD 31 mmHg at follow-up", method: "text_layer" }]));
    expect(withoutRef[0].reference_range).toBeUndefined(); // never invented
  });

  it("accepts ISO dates and flags ambiguous formats without resolving them", () => {
    const iso = buildTestResults(artifactWithPages([{ text: "IOP OD 21 mmHg measured 2026-03-04 by clinician", method: "text_layer" }]));
    expect(iso[0].timestamp).toBe("2026-03-04");
    const loose = buildTestResults(artifactWithPages([{ text: "IOP OD 21 mmHg measured 4.3.2026 clinic", method: "text_layer" }]));
    expect(loose[0].timestamp).toBeUndefined();
    expect(loose[0].date_raw).toBe("4.3.2026");
    expect(loose[0].ambiguity_flags).toContain("ambiguous_date");
  });
});

/* ---------- conflicts ---------- */

describe("S3 - conflicts: surfaced, never chosen", () => {
  it("cross-references conflicting same-eye values without picking a winner", () => {
    const artifact = artifactWithPages([{ text: "IOP OD 19 mmHg at triage IOP OD 24 mmHg later", method: "text_layer" }]);
    const results = materializeResults("doc_c", "study_c", buildTestResults(artifact));
    const conflicting = results.filter((r) => r.conflicts.length > 0);
    expect(conflicting).toHaveLength(2);
    expect(new Set(conflicting.map((r) => r.value))).toEqual(new Set([19, 24]));
    expect(conflicting.every((r) => r.verification.status === "AUTO_EXTRACTED")).toBe(true);
  });

  it("does not flag identical duplicate measurements as conflicts", () => {
    const artifact = artifactWithPages([{ text: "IOP OD 19 mmHg repeated IOP OD 19 mmHg confirm", method: "text_layer" }]);
    const results = materializeResults("doc_d", "study_d", buildTestResults(artifact));
    expect(results.every((r) => r.conflicts.length === 0)).toBe(true);
  });
});

/* ---------- service lifecycle + verification ---------- */

describe("S3 - persistence, verification workflow, and hard boundaries", () => {
  const META: DeviceMetadata = { scanType: "unknown", eye: "unknown", providedBy: "none" };
  const createdStudyIds: string[] = [];

  async function studyWithTextPdf(lines: string): Promise<string> {
    const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([595, 842]);
    lines.split("\n").forEach((line, i) => {
      page.drawText(line, { x: 40, y: 780 - i * 24, size: 11, font, color: rgb(0, 0, 0) });
    });
    const bytes = Buffer.from(await doc.save());
    // Real 600x600 PNG so the study's quality gate can read the image.
    const { createCanvas } = await import("@napi-rs/canvas");
    const canvas = createCanvas(600, 600);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(0, 0, 600, 600);
    const png = canvas.toBuffer("image/png");
    const study = await createStudy("scan.png", "image/png", Buffer.from(png), META);
    createdStudyIds.push(study.study_id);
    const up = await uploadDocument(study.study_id, "iop-report.pdf", "application/pdf", bytes, "s3tester");
    if (!up.ok) throw new Error(`fixture upload failed: ${up.error_code}`);
    // Real S2 extraction (text-layer pages only; the OCR provider is never called).
    const ext = await extractDocument(up.document!.document_id, "s3tester", { ocrProvider: mockOcr() });
    if (!ext.ok) throw new Error(`fixture extraction failed: ${ext.error_code}`);
    return up.document!.document_id;
  }

  afterAll(async () => {
    for (const id of createdStudyIds) await deleteStudy(id).catch(() => {});
  });

  it("generates results end-to-end from extraction; every result starts AUTO_EXTRACTED", async () => {
    const docId = await studyWithTextPdf("IOP OD 19 mmHg normal 10-21 mmHg\nIOP OS 24 mmHg\nCST OU 289 um\nIOP OS 2l mmHg suspect");
    const gen = await generateResultsForDocument(docId, "s3tester");
    expect(gen.ok).toBe(true);
    const results = await listTestResultsForDocument(docId);
    expect(results.length).toBeGreaterThanOrEqual(3);
    expect(results.every((r) => r.verification.status === "AUTO_EXTRACTED")).toBe(true);
    const noisy = results.find((r) => r.value_raw === "2l");
    expect(noisy).toBeDefined();
    expect(noisy!.value).toBeUndefined();
    expect(noisy!.ambiguity_flags).toContain("unparseable_value");
  });

  it("verification: verify / correct / reject / unreview with additive history; original never overwritten", async () => {
    const docId = await studyWithTextPdf("IOP OD 21 mmHg documented");
    await generateResultsForDocument(docId, "s3tester");
    const [result] = await listTestResultsForDocument(docId);

    // correct (clinician fixes an extracted value; original preserved)
    const corrected = await verifyTestResult(result.result_id, {
      action: "correct", actor: "dr_reviewer",
      correction: { value: 22, unit: "mmHg", note: "source shows 22, OCR fine here but recording correction workflow" },
    });
    expect(corrected.ok).toBe(true);
    expect(corrected.result?.verification.status).toBe("CORRECTED");
    expect(corrected.result?.correction?.value).toBe(22);
    expect(corrected.result?.correction?.by).toBe("dr_reviewer");
    expect(corrected.result?.value).toBe(21); // ORIGINAL extraction untouched
    expect(corrected.result?.value_raw).toBe("21");

    // verify after correction is refused (correction already recorded) - but reject path works
    const rejected = await verifyTestResult(result.result_id, { action: "reject", actor: "dr_reviewer", note: "wrong eye assignment" });
    expect(rejected.ok).toBe(true);
    expect(rejected.result?.verification.status).toBe("REJECTED");

    // verifying a REJECTED result fails closed
    const reverify = await verifyTestResult(result.result_id, { action: "verify", actor: "dr_reviewer" });
    expect(reverify.ok).toBe(false);

    // unreview returns it to the queue additively
    const unreviewed = await verifyTestResult(result.result_id, { action: "unreview", actor: "dr_reviewer" });
    expect(unreviewed.ok).toBe(true);
    expect(unreviewed.result?.verification.status).toBe("UNREVIEWED");
    expect(unreviewed.result?.verification_history.length).toBeGreaterThanOrEqual(4);

    // corrections cannot smuggle non-numeric values
    const bad = await verifyTestResult(result.result_id, { action: "correct", actor: "x", correction: { value: Number("abc") } });
    expect(bad.ok).toBe(false);

    await audit({ actor: "test", action: "noop", outcome: "ok" }); // flush ordering guard
    const unknown = await getTestResult("res_missing");
    expect(unknown).toBeNull();
  });

  it("re-extraction supersedes previous results (no stale results outlive their artifact)", async () => {
    const docId = await studyWithTextPdf("IOP OD 19 mmHg documented");
    await generateResultsForDocument(docId, "s3tester");
    const first = await listTestResultsForDocument(docId);
    expect(first.length).toBeGreaterThan(0);
    await generateResultsForDocument(docId, "s3tester");
    const second = await listTestResultsForDocument(docId);
    expect(second.length).toBeGreaterThan(0);
    expect(second.every((r) => !first.some((f) => f.result_id === r.result_id))).toBe(true);
  });

  it("HARD BOUNDARY: extracted test results never appear in analysis output or triage", async () => {
    const docId = await studyWithTextPdf("IOP OD 55 mmHg emergency-level value normal 10-21 mmHg");
    await generateResultsForDocument(docId, "s3tester");
    const studyId = (await listTestResultsForDocument(docId))[0].study_id;
    await analyzeStudy(studyId);
    const bundle = await getStudyBundle(studyId);
    const serialized = JSON.stringify(bundle);
    expect(serialized).not.toContain("test_results");
    expect(serialized).not.toContain("55 mmHg");
    expect(serialized).not.toContain("AUTO_EXTRACTED");
    expect(bundle.analysis!.recommendation.priority).not.toBe("emergency_evaluation"); // triage is image+symptom-only
  });

  it("study deletion cascades to test results", async () => {
    const docId = await studyWithTextPdf("IOP OD 19 mmHg recorded");
    await generateResultsForDocument(docId, "s3tester");
    const results = await listTestResultsForDocument(docId);
    expect(results.length).toBeGreaterThan(0);
    const studyId = results[0].study_id;
    createdStudyIds.splice(createdStudyIds.indexOf(studyId), 1); // manual cleanup below
    await deleteStudy(studyId);
    expect((await listTestResultsForDocument(docId))).toHaveLength(0);
  });
});

/* ---------- route authorization ---------- */

function reqFor(url: string, cookies: Record<string, string> = {}, method = "GET"): NextRequest {
  const cookieHeader = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  return new NextRequest(new URL(url, "http://localhost:3000"), { method, headers: { cookie: cookieHeader } });
}
const RESULTS_ROUTE = (await import("@/app/api/documents/[id]/results/route")) as typeof import("@/app/api/documents/[id]/results/route");
const VERIFY_ROUTE = (await import("@/app/api/results/[resultId]/verify/route")) as typeof import("@/app/api/results/[resultId]/verify/route");

describe("S3 - route authorization (results are PHI)", () => {
  it("GET results: unauthenticated -> 401", async () => {
    const res = await RESULTS_ROUTE.GET(reqFor("http://localhost:3000/api/documents/doc_x/results"), { params: { id: "doc_x" } });
    expect(res.status).toBe(401);
  });

  it("GET results: TECHNICIAN and RESEARCHER -> 403 (PHI-bearing)", async () => {
    for (const role of ["TECHNICIAN", "RESEARCHER"] as const) {
      const { token } = await createSession({ user_id: `s3_${role}`, username: `s3_${role}`, role });
      const res = await RESULTS_ROUTE.GET(reqFor("http://localhost:3000/api/documents/doc_x/results", { [SESSION_COOKIE]: token }), { params: { id: "doc_x" } });
      expect(res.status).toBe(403);
    }
  });

  it("POST verify: unauthenticated -> 401; TECHNICIAN -> 403", async () => {
    const res = await VERIFY_ROUTE.POST(reqFor("http://localhost:3000/api/results/res_x/verify", {}, "POST"), { params: { resultId: "res_x" } });
    expect(res.status).toBe(401);
    const { token } = await createSession({ user_id: "s3tech", username: "s3tech", role: "TECHNICIAN" });
    const res2 = await VERIFY_ROUTE.POST(reqFor("http://localhost:3000/api/results/res_x/verify", { [SESSION_COOKIE]: token }, "POST"), { params: { resultId: "res_x" } });
    expect(res2.status).toBe(403);
  });
});
