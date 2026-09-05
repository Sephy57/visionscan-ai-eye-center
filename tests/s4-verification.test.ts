import { describe, it, expect, afterAll } from "vitest";
import { NextRequest } from "next/server";
import {
  generateResultsForDocument, listTestResultsForDocument, verifyTestResult, getTestResult,
} from "@/lib/documents/extraction/testResultService";
import { extractDocument } from "@/lib/documents/extraction/service";
import { createSession, SESSION_COOKIE, CSRF_COOKIE } from "@/lib/auth/sessions";
import { createStudy, deleteStudy } from "@/lib/studies/service";
import { uploadDocument } from "@/lib/documents/service";
import { recentAudit } from "@/lib/audit";
import { DeviceMetadata } from "@/lib/devices/adapter";
import type { OCRProvider, OcrContext, OcrResult } from "@/lib/documents/extraction/types";

/**
 * S4 — human verification workflow: adversarial + regression tests.
 * Covers auth, RBAC, IDOR, verification-state transitions, numeric/laterality
 * safety, conflict handling, provenance, and PHI-in-audit-log safety.
 */

function mockOcr(): OCRProvider {
  return {
    name: "mock-ocr",
    async recognize(_png: Buffer, ctx: OcrContext): Promise<OcrResult> {
      return { text: `MOCK OCR TEXT PAGE ${ctx.page}`, confidence: 90, engine: "mock-ocr", engine_version: "0.0.0", language: "eng", time_ms: 1 };
    },
    async release() {},
  };
}

const META: DeviceMetadata = { scanType: "unknown", eye: "unknown", providedBy: "none" };
const createdStudyIds: string[] = [];

async function studyWithTextPdf(lines: string): Promise<{ documentId: string; studyId: string }> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  lines.split("\n").forEach((line, i) => {
    page.drawText(line, { x: 40, y: 780 - i * 24, size: 11, font, color: rgb(0, 0, 0) });
  });
  const bytes = Buffer.from(await doc.save());
  const { createCanvas } = await import("@napi-rs/canvas");
  const canvas = createCanvas(600, 600);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#1a1a2e";
  ctx.fillRect(0, 0, 600, 600);
  const png = canvas.toBuffer("image/png");
  const study = await createStudy("scan.png", "image/png", Buffer.from(png), META);
  createdStudyIds.push(study.study_id);
  const up = await uploadDocument(study.study_id, "iop-report.pdf", "application/pdf", bytes, "s4tester");
  if (!up.ok) throw new Error(`fixture upload failed: ${up.error_code}`);
  const ext = await extractDocument(up.document!.document_id, "s4tester", { ocrProvider: mockOcr() });
  if (!ext.ok) throw new Error(`fixture extraction failed: ${ext.error_code}`);
  return { documentId: up.document!.document_id, studyId: study.study_id };
}

afterAll(async () => {
  for (const id of createdStudyIds) await deleteStudy(id).catch(() => {});
});

/* ---------- numeric correction safety ---------- */

describe("S4.8 - numeric correction safety", () => {
  it("rejects NaN, Infinity, empty, and malformed-decimal corrections", async () => {
    const { documentId } = await studyWithTextPdf("IOP OD 21 mmHg documented");
    await generateResultsForDocument(documentId, "s4tester");
    const [result] = await listTestResultsForDocument(documentId);

    for (const bad of [Number("abc"), Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, NaN]) {
      const out = await verifyTestResult(result.result_id, { action: "correct", actor: "reviewer1", correction: { value: bad } });
      expect(out.ok).toBe(false);
      expect(out.httpStatus).toBe(400);
    }
  });

  it("rejects negative values and extremely large values for bounded test types (IOP)", async () => {
    const { documentId } = await studyWithTextPdf("IOP OD 21 mmHg documented");
    await generateResultsForDocument(documentId, "s4tester");
    const [result] = await listTestResultsForDocument(documentId);

    const negative = await verifyTestResult(result.result_id, { action: "correct", actor: "reviewer1", correction: { value: -5 } });
    expect(negative.ok).toBe(false);

    const huge = await verifyTestResult(result.result_id, { action: "correct", actor: "reviewer1", correction: { value: 1e9 } });
    expect(huge.ok).toBe(false);

    const reasonable = await verifyTestResult(result.result_id, { action: "correct", actor: "reviewer1", correction: { value: 22 } });
    expect(reasonable.ok).toBe(true);
    expect(reasonable.result?.value).toBe(21); // original extraction untouched
    expect(reasonable.result?.value_raw).toBe("21");
  });

  it("rejects cup-to-disc-ratio corrections outside 0-1", async () => {
    const { documentId } = await studyWithTextPdf("CDR OD 0.4 documented");
    await generateResultsForDocument(documentId, "s4tester");
    const [result] = await listTestResultsForDocument(documentId);
    const bad = await verifyTestResult(result.result_id, { action: "correct", actor: "reviewer1", correction: { value: 1.5 } });
    expect(bad.ok).toBe(false);
    const ok = await verifyTestResult(result.result_id, { action: "correct", actor: "reviewer1", correction: { value: 0.5 } });
    expect(ok.ok).toBe(true);
  });

  it("rejects malformed corrected units and laterality values", async () => {
    const { documentId } = await studyWithTextPdf("IOP OD 21 mmHg documented");
    await generateResultsForDocument(documentId, "s4tester");
    const [result] = await listTestResultsForDocument(documentId);
    const badLat = await verifyTestResult(result.result_id, { action: "correct", actor: "reviewer1", correction: { value: 22, laterality: "LEFT_EYE" as any } });
    expect(badLat.ok).toBe(false);
    const badUnit = await verifyTestResult(result.result_id, { action: "correct", actor: "reviewer1", correction: { value: 22, unit: "" } });
    expect(badUnit.ok).toBe(false);
  });
});

/* ---------- state transitions ---------- */

describe("S4.3/S4.14 - verification state transitions fail closed appropriately", () => {
  it("verify / correct / reject on UNREVIEWED all succeed independently", async () => {
    const { documentId } = await studyWithTextPdf("IOP OD 19 mmHg\nIOP OS 20 mmHg\nCST OU 289 um");
    await generateResultsForDocument(documentId, "s4tester");
    const results = await listTestResultsForDocument(documentId);
    expect(results.length).toBeGreaterThanOrEqual(3);

    const v = await verifyTestResult(results[0].result_id, { action: "verify", actor: "reviewer1" });
    expect(v.ok).toBe(true);
    expect(v.result?.verification.status).toBe("VERIFIED");

    const c = await verifyTestResult(results[1].result_id, { action: "correct", actor: "reviewer1", correction: { value: 21 } });
    expect(c.ok).toBe(true);
    expect(c.result?.verification.status).toBe("CORRECTED");

    const r = await verifyTestResult(results[2].result_id, { action: "reject", actor: "reviewer1" });
    expect(r.ok).toBe(true);
    expect(r.result?.verification.status).toBe("REJECTED");
  });

  it("correcting a REJECTED result fails closed until returned to review", async () => {
    const { documentId } = await studyWithTextPdf("IOP OD 21 mmHg documented");
    await generateResultsForDocument(documentId, "s4tester");
    const [result] = await listTestResultsForDocument(documentId);
    await verifyTestResult(result.result_id, { action: "reject", actor: "reviewer1" });

    const correctRejected = await verifyTestResult(result.result_id, { action: "correct", actor: "reviewer1", correction: { value: 22 } });
    expect(correctRejected.ok).toBe(false);
    expect(correctRejected.httpStatus).toBe(409);

    const backToReview = await verifyTestResult(result.result_id, { action: "unreview", actor: "reviewer1" });
    expect(backToReview.ok).toBe(true);
    expect(backToReview.result?.verification.status).toBe("UNREVIEWED");

    const correctNow = await verifyTestResult(result.result_id, { action: "correct", actor: "reviewer1", correction: { value: 22 } });
    expect(correctNow.ok).toBe(true);
  });

  it("verifying a REJECTED result fails closed", async () => {
    const { documentId } = await studyWithTextPdf("IOP OD 21 mmHg documented");
    await generateResultsForDocument(documentId, "s4tester");
    const [result] = await listTestResultsForDocument(documentId);
    await verifyTestResult(result.result_id, { action: "reject", actor: "reviewer1" });
    const out = await verifyTestResult(result.result_id, { action: "verify", actor: "reviewer1" });
    expect(out.ok).toBe(false);
  });

  it("cannot verify a result whose value failed strict parsing (must correct instead)", async () => {
    const { documentId } = await studyWithTextPdf("IOP OS 2l mmHg suspect");
    await generateResultsForDocument(documentId, "s4tester");
    const [result] = await listTestResultsForDocument(documentId);
    expect(result.value).toBeUndefined();
    const out = await verifyTestResult(result.result_id, { action: "verify", actor: "reviewer1" });
    expect(out.ok).toBe(false);
  });

  it("return-to-review is additive: history keeps every prior action, original never erased", async () => {
    const { documentId } = await studyWithTextPdf("IOP OD 21 mmHg documented");
    await generateResultsForDocument(documentId, "s4tester");
    const [result] = await listTestResultsForDocument(documentId);
    await verifyTestResult(result.result_id, { action: "correct", actor: "reviewer1", correction: { value: 22 } });
    await verifyTestResult(result.result_id, { action: "unreview", actor: "reviewer2" });
    const final = await getTestResult(result.result_id);
    expect(final!.verification_history.length).toBeGreaterThanOrEqual(3); // generate, correct, unreview
    expect(final!.verification_history[0].action).toBe("generate");
    expect(final!.value_raw).toBe("21");
    expect(final!.value).toBe(21);
  });

  it("fabricated result id -> NOT_FOUND (no crash, no info leak)", async () => {
    const out = await verifyTestResult("res_does_not_exist_12345", { action: "verify", actor: "reviewer1" });
    expect(out.ok).toBe(false);
    expect(out.httpStatus).toBe(404);
  });
});

/* ---------- conflicts ---------- */

describe("S4.6 - conflicts are surfaced, never auto-resolved", () => {
  it("keeps both conflicting values visible; rejecting one preserves its record and history", async () => {
    const { documentId } = await studyWithTextPdf("IOP OD 18 mmHg at triage IOP OD 26 mmHg later");
    await generateResultsForDocument(documentId, "s4tester");
    const results = await listTestResultsForDocument(documentId);
    const conflicting = results.filter((r) => r.conflicts.length > 0);
    expect(conflicting.length).toBe(2);
    expect(conflicting.every((r) => r.verification.status === "AUTO_EXTRACTED")).toBe(true);

    const rejected = await verifyTestResult(conflicting[0].result_id, { action: "reject", actor: "reviewer1", note: "duplicate reading" });
    expect(rejected.ok).toBe(true);
    // The other conflicting record is untouched and still retrievable (audit trail preserved).
    const other = await getTestResult(conflicting[1].result_id);
    expect(other).not.toBeNull();
    expect(other!.verification.status).toBe("AUTO_EXTRACTED");
    const rejectedRecord = await getTestResult(conflicting[0].result_id);
    expect(rejectedRecord!.verification.status).toBe("REJECTED");
    expect(rejectedRecord!.conflicts).toContain(conflicting[1].result_id); // conflict link preserved
  });

  it("does not flag identical repeated values as conflicting", async () => {
    const { documentId } = await studyWithTextPdf("IOP OD 19 mmHg repeated IOP OD 19 mmHg confirm");
    await generateResultsForDocument(documentId, "s4tester");
    const results = await listTestResultsForDocument(documentId);
    expect(results.every((r) => r.conflicts.length === 0)).toBe(true);
  });

  it("correcting one conflicting value does not silently resolve the other", async () => {
    const { documentId } = await studyWithTextPdf("IOP OD 18 mmHg at triage IOP OD 26 mmHg later");
    await generateResultsForDocument(documentId, "s4tester");
    const results = await listTestResultsForDocument(documentId);
    const conflicting = results.filter((r) => r.conflicts.length > 0);
    await verifyTestResult(conflicting[0].result_id, { action: "correct", actor: "reviewer1", correction: { value: 20 } });
    const other = await getTestResult(conflicting[1].result_id);
    expect(other!.verification.status).toBe("AUTO_EXTRACTED"); // untouched, still needs a human decision
  });
});

/* ---------- laterality ---------- */

describe("S4.7 - laterality safety", () => {
  it("UNKNOWN laterality is never silently converted by a correction leaving laterality unset", async () => {
    const { documentId } = await studyWithTextPdf("IOP 21 mmHg no eye stated");
    await generateResultsForDocument(documentId, "s4tester");
    const [result] = await listTestResultsForDocument(documentId);
    expect(result.laterality).toBe("UNKNOWN");
    const out = await verifyTestResult(result.result_id, { action: "correct", actor: "reviewer1", correction: { value: 21 } });
    expect(out.ok).toBe(true);
    // laterality carried over as UNKNOWN, not silently defaulted to OD/OS/OU
    expect(out.result?.correction?.laterality).toBe("UNKNOWN");
  });

  it("contradictory laterality in source text stays UNKNOWN until an explicit human correction", async () => {
    const { documentId } = await studyWithTextPdf("IOP OD OS 21 mmHg both documented");
    await generateResultsForDocument(documentId, "s4tester");
    const [result] = await listTestResultsForDocument(documentId);
    expect(result.laterality).toBe("UNKNOWN");
    expect(result.ambiguity_flags).toContain("contradictory_laterality");
    const out = await verifyTestResult(result.result_id, { action: "correct", actor: "reviewer1", correction: { value: 21, laterality: "OD" } });
    expect(out.ok).toBe(true);
    expect(out.result?.correction?.laterality).toBe("OD"); // explicit human choice, recorded
    expect(out.result?.laterality).toBe("UNKNOWN"); // original extraction's laterality untouched
  });
});

/* ---------- provenance ---------- */

describe("S4.5 - provenance is preserved end-to-end", () => {
  it("source document, page, source text snippet, extraction method, and raw value survive every verification action", async () => {
    const { documentId } = await studyWithTextPdf("IOP OD 21 mmHg documented");
    await generateResultsForDocument(documentId, "s4tester");
    const [result] = await listTestResultsForDocument(documentId);
    const before = { page: result.page, source_text: result.source_text, extraction_method: result.extraction_method, value_raw: result.value_raw, document_id: result.document_id };

    await verifyTestResult(result.result_id, { action: "correct", actor: "reviewer1", correction: { value: 22 } });
    await verifyTestResult(result.result_id, { action: "reject", actor: "reviewer2" });
    await verifyTestResult(result.result_id, { action: "unreview", actor: "reviewer1" });

    const after = await getTestResult(result.result_id);
    expect(after!.page).toBe(before.page);
    expect(after!.source_text).toBe(before.source_text);
    expect(after!.extraction_method).toBe(before.extraction_method);
    expect(after!.value_raw).toBe(before.value_raw);
    expect(after!.document_id).toBe(before.document_id);
  });
});

/* ---------- PHI-safety: audit logs must never carry extracted content ---------- */

describe("S4.5/PHI safety - audit records are metadata only", () => {
  it("verification actions never leak value_raw, source_text, or extracted content into the audit log", async () => {
    const { documentId } = await studyWithTextPdf("IOP OD 21 mmHg documented, MRN 998877, patient Jane Q. Public");
    await generateResultsForDocument(documentId, "s4tester");
    const [result] = await listTestResultsForDocument(documentId);
    await verifyTestResult(result.result_id, { action: "correct", actor: "reviewer1", correction: { value: 22, note: "source clearly reads 22" } });
    await verifyTestResult(result.result_id, { action: "reject", actor: "reviewer1" });

    const events = await recentAudit(500);
    const relevant = events.filter((e) => e.resourceId === result.result_id || e.resourceId === documentId);
    expect(relevant.length).toBeGreaterThan(0);
    for (const e of relevant) {
      const blob = JSON.stringify(e);
      expect(blob).not.toContain("998877");
      expect(blob).not.toContain("Jane Q. Public");
      expect(blob).not.toContain(result.source_text);
      expect(blob).not.toContain("21 mmHg");
    }
  });
});

/* ---------- route-level auth / RBAC / IDOR ---------- */

function reqFor(url: string, cookies: Record<string, string> = {}, method = "GET", body?: unknown): NextRequest {
  const cookieHeader = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  const headers: Record<string, string> = { cookie: cookieHeader };
  if (cookies[CSRF_COOKIE]) headers["x-csrf-token"] = cookies[CSRF_COOKIE];
  if (body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(new URL(url, "http://localhost:3000"), {
    method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

const RESULTS_ROUTE = (await import("@/app/api/documents/[id]/results/route")) as typeof import("@/app/api/documents/[id]/results/route");
const VERIFY_ROUTE = (await import("@/app/api/results/[resultId]/verify/route")) as typeof import("@/app/api/results/[resultId]/verify/route");

async function sessionCookies(role: "ADMIN" | "CLINICIAN" | "REVIEWER" | "TECHNICIAN" | "RESEARCHER", tag: string) {
  const { token, csrf } = await createSession({ user_id: `s4_${tag}`, username: `s4_${tag}`, role });
  return { [SESSION_COOKIE]: token, [CSRF_COOKIE]: csrf };
}

describe("S4.4/S4.14 - RBAC matrix on verification routes", () => {
  it("ADMIN, CLINICIAN, REVIEWER can call verify; TECHNICIAN and RESEARCHER get 403", async () => {
    const { documentId } = await studyWithTextPdf("IOP OD 21 mmHg documented");
    await generateResultsForDocument(documentId, "s4tester");
    const [result] = await listTestResultsForDocument(documentId);

    for (const role of ["ADMIN", "CLINICIAN", "REVIEWER"] as const) {
      const cookies = await sessionCookies(role, `allow_${role}`);
      const res = await VERIFY_ROUTE.POST(
        reqFor(`http://localhost:3000/api/results/${result.result_id}/verify`, cookies, "POST", { action: "unreview" }),
        { params: { resultId: result.result_id } },
      );
      expect(res.status).toBe(200);
    }

    for (const role of ["TECHNICIAN", "RESEARCHER"] as const) {
      const cookies = await sessionCookies(role, `deny_${role}`);
      const res = await VERIFY_ROUTE.POST(
        reqFor(`http://localhost:3000/api/results/${result.result_id}/verify`, cookies, "POST", { action: "verify" }),
        { params: { resultId: result.result_id } },
      );
      expect(res.status).toBe(403);
    }
  });

  it("GET results for a document: TECHNICIAN/RESEARCHER denied, REVIEWER allowed", async () => {
    const { documentId } = await studyWithTextPdf("IOP OD 21 mmHg documented");
    await generateResultsForDocument(documentId, "s4tester");

    const reviewerCookies = await sessionCookies("REVIEWER", "list_ok");
    const ok = await RESULTS_ROUTE.GET(reqFor(`http://localhost:3000/api/documents/${documentId}/results`, reviewerCookies), { params: { id: documentId } });
    expect(ok.status).toBe(200);
    const okBody = await ok.json();
    expect(Array.isArray(okBody.results)).toBe(true);

    for (const role of ["TECHNICIAN", "RESEARCHER"] as const) {
      const cookies = await sessionCookies(role, `list_deny_${role}`);
      const res = await RESULTS_ROUTE.GET(reqFor(`http://localhost:3000/api/documents/${documentId}/results`, cookies), { params: { id: documentId } });
      expect(res.status).toBe(403);
    }
  });

  it("unauthenticated verify and unauthenticated result listing both -> 401", async () => {
    const verifyRes = await VERIFY_ROUTE.POST(reqFor("http://localhost:3000/api/results/res_x/verify", {}, "POST", { action: "verify" }), { params: { resultId: "res_x" } });
    expect(verifyRes.status).toBe(401);
    const listRes = await RESULTS_ROUTE.GET(reqFor("http://localhost:3000/api/documents/doc_x/results"), { params: { id: "doc_x" } });
    expect(listRes.status).toBe(401);
  });

  it("IDOR: verifying a fabricated/nonexistent result id returns 404, not another document's result", async () => {
    const cookies = await sessionCookies("REVIEWER", "idor");
    const res = await VERIFY_ROUTE.POST(
      reqFor("http://localhost:3000/api/results/res_totally_fake_id/verify", cookies, "POST", { action: "verify" }),
      { params: { resultId: "res_totally_fake_id" } },
    );
    expect(res.status).toBe(404);
  });

  it("rejects an invalid action value with 400 before touching data", async () => {
    const cookies = await sessionCookies("REVIEWER", "badaction");
    const res = await VERIFY_ROUTE.POST(
      reqFor("http://localhost:3000/api/results/res_x/verify", cookies, "POST", { action: "delete_everything" }),
      { params: { resultId: "res_x" } },
    );
    expect(res.status).toBe(400);
  });

  it("CSRF: mutating verify request without a matching token is denied even with a valid session", async () => {
    const { token } = await createSession({ user_id: "s4_csrf", username: "s4_csrf", role: "REVIEWER" });
    const res = await VERIFY_ROUTE.POST(
      reqFor("http://localhost:3000/api/results/res_x/verify", { [SESSION_COOKIE]: token }, "POST", { action: "verify" }),
      { params: { resultId: "res_x" } },
    );
    expect(res.status).toBe(403);
  });
});

/* ---------- hard clinical-isolation boundary (regression) ---------- */

describe("S4.17 - no clinical activation via the verification pathway", () => {
  it("a corrected, verified extreme IOP value is still never connected to triage/diagnosis output", async () => {
    const { documentId, studyId } = await studyWithTextPdf("IOP OD 55 mmHg emergency-level value documented");
    await generateResultsForDocument(documentId, "s4tester");
    const [result] = await listTestResultsForDocument(documentId);
    await verifyTestResult(result.result_id, { action: "verify", actor: "reviewer1" });

    const { analyzeStudy, getStudyBundle } = await import("@/lib/studies/service");
    await analyzeStudy(studyId);
    const bundle = await getStudyBundle(studyId);
    const serialized = JSON.stringify(bundle);
    expect(serialized).not.toContain("test_results");
    expect(serialized).not.toContain("55 mmHg");
    expect(bundle.analysis!.recommendation.priority).not.toBe("emergency_evaluation");
  });
});
