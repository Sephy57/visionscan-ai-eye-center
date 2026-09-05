import { describe, it, expect, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { evidenceFromTestResults, evidenceFromSymptoms, evidenceFromFindings } from "@/lib/evidence/adapters";
import { detectConflicts } from "@/lib/evidence/conflicts";
import { assessConditions, buildEvidenceWorkspace } from "@/lib/evidence/synthesize";
import type { EvidenceItem, ConditionAssessment } from "@/lib/evidence/types";
import type { TestResult } from "@/lib/documents/extraction/testResults";
import type { PatientSymptom } from "@/lib/clinical/symptoms";
import type { Finding } from "@/lib/analysis/schema";
import { createStudy, deleteStudy, setStudySymptoms } from "@/lib/studies/service";
import { uploadDocument } from "@/lib/documents/service";
import { extractDocument } from "@/lib/documents/extraction/service";
import { generateResultsForDocument, listTestResultsForDocument, verifyTestResult } from "@/lib/documents/extraction/testResultService";
import { createSession, SESSION_COOKIE, CSRF_COOKIE } from "@/lib/auth/sessions";
import { DeviceMetadata } from "@/lib/devices/adapter";
import type { OCRProvider, OcrContext, OcrResult } from "@/lib/documents/extraction/types";

/**
 * S5 - adversarial regression tests for the evidence-synthesis module.
 * Complements tests/s5-evidence-critical.test.ts (which already covers the
 * two mandatory S5.22/S5.23 safety tests + cross-study contamination) with
 * adapter-level, conflict-engine, assessConditions, and route-RBAC coverage.
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
  const up = await uploadDocument(study.study_id, "report.pdf", "application/pdf", bytes, "s5synth");
  if (!up.ok) throw new Error(`fixture upload failed: ${up.error_code}`);
  const ext = await extractDocument(up.document!.document_id, "s5synth", { ocrProvider: mockOcr() });
  if (!ext.ok) throw new Error(`fixture extraction failed: ${ext.error_code}`);
  return { studyId: study.study_id, documentId: up.document!.document_id };
}

async function bareStudy(): Promise<string> {
  const study = await createStudy("scan.png", "image/png", await pngBytes(), META);
  createdStudyIds.push(study.study_id);
  return study.study_id;
}

afterAll(async () => {
  for (const id of createdStudyIds) await deleteStudy(id).catch(() => {});
});

/* ---------------------------------------------------------------------- */
/* Hand-built TestResult / EvidenceItem fixture helpers                    */
/* ---------------------------------------------------------------------- */

function mkTestResult(overrides: Partial<TestResult> = {}): TestResult {
  return {
    result_id: overrides.result_id ?? "res_fixture_1",
    document_id: "doc_fixture",
    study_id: "study_fixture",
    test_type: "IOP",
    value_raw: "21",
    value: 21,
    unit_raw: "mmHg",
    unit_normalized: "mmHg",
    laterality: "OD",
    page: 1,
    source_text: "IOP OD 21 mmHg documented",
    extraction_method: "text_layer",
    extraction_confidence: 90,
    ambiguity_flags: [],
    conflicts: [],
    verification: { status: "AUTO_EXTRACTED", at: new Date().toISOString() },
    verification_history: [{ at: new Date().toISOString(), action: "generate" }],
    created_at: new Date().toISOString(),
    parser_version: "test-fixture",
    ...overrides,
  } as TestResult;
}

function mkEvidence(overrides: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    id: overrides.id ?? `ev_fixture_${Math.random().toString(36).slice(2, 8)}`,
    study_id: "study_fixture",
    source_type: "TEST_RESULT",
    source_id: "res_fixture",
    category: "IOP",
    laterality: "OD",
    laterality_source: "explicit",
    presence: "PRESENT",
    trust_level: "AUTO_EXTRACTED",
    provenance: { study_id: "study_fixture" },
    conflict_ids: [],
    ...overrides,
  };
}

/* ---------------------------------------------------------------------- */
/* Adapters                                                                */
/* ---------------------------------------------------------------------- */

describe("evidenceFromTestResults - adapter safety", () => {
  it("a REJECTED TestResult still produces an EvidenceItem (trust_level REJECTED), but is excluded from conflicts/assessments", () => {
    const rejected = mkTestResult({ result_id: "res_rej", value: 30, verification: { status: "REJECTED", at: new Date().toISOString() } });
    const trusted = mkTestResult({ result_id: "res_trusted", value: 18, verification: { status: "VERIFIED", at: new Date().toISOString() } });
    const items = evidenceFromTestResults([rejected, trusted]);

    const rejectedItem = items.find((i) => i.source_id === "res_rej")!;
    expect(rejectedItem).toBeDefined();
    expect(rejectedItem.trust_level).toBe("REJECTED");
    expect(rejectedItem.value).toBe(30);

    const conflicts = detectConflicts(items);
    for (const c of conflicts) expect(c.evidence_ids).not.toContain(rejectedItem.id);

    const assessments = assessConditions(items);
    for (const a of assessments) {
      expect(a.supporting_evidence_ids).not.toContain(rejectedItem.id);
      expect(a.contradicting_evidence_ids).not.toContain(rejectedItem.id);
    }
  });

  it("a TestResult with value: undefined (unparseable OCR) produces presence UNKNOWN and does not crash conflict/condition logic", () => {
    const unparseable = mkTestResult({ result_id: "res_unparse", value_raw: "2l", value: undefined, ambiguity_flags: ["unparseable_value"], verification: { status: "UNREVIEWED", at: new Date().toISOString() } });
    const items = evidenceFromTestResults([unparseable]);
    expect(items[0].presence).toBe("UNKNOWN");
    expect(items[0].value).toBeUndefined();
    expect(() => detectConflicts(items)).not.toThrow();
    expect(() => assessConditions(items)).not.toThrow();
    expect(detectConflicts(items)).toEqual([]);
  });

  it("an UNKNOWN-presence required measurement cannot satisfy a condition requirement", () => {
    const unknown = mkEvidence({ id: "ev_unknown_iop", category: "IOP", laterality: "OD", value: undefined, presence: "UNKNOWN", trust_level: "AUTO_EXTRACTED" });
    const assessments = assessConditions([unknown]);
    const odIop = assessments.find((a) => a.condition_id === "iop_evidence_pattern" && a.laterality === "OD")!;
    expect(odIop.state).toBe("UNABLE_TO_ASSESS");
    expect(odIop.supporting_evidence_ids).toEqual([]);
    expect(odIop.missing_required).toContain("TEST_RESULT:IOP");
  });

  it("unit_raw present but unit_normalized undefined is represented as-is, never inventing a normalized unit", () => {
    const weirdUnit = mkTestResult({ result_id: "res_weird_unit", unit_raw: "furlongs", unit_normalized: undefined, value: 5 });
    const items = evidenceFromTestResults([weirdUnit]);
    expect(items[0].unit).toBe("furlongs");
  });
});

describe("evidenceFromSymptoms - adapter safety", () => {
  it("every reported symptom becomes PRESENT/UNVERIFIED; an unreported type produces no evidence item", () => {
    const symptoms: PatientSymptom[] = [
      { type: "blurred_vision", onset: "gradual", duration: "weeks", severity: "mild", laterality: "right", progression: "stable", frequency: "unknown" },
      { type: "floaters", onset: "sudden", duration: "days", severity: "moderate", laterality: "left", progression: "stable", frequency: "intermittent" },
    ];
    const items = evidenceFromSymptoms("study_fixture", symptoms);
    expect(items).toHaveLength(2);
    for (const it of items) {
      expect(it.presence).toBe("PRESENT");
      expect(it.trust_level).toBe("UNVERIFIED");
    }
    // "eye_pain" was never reported - must not appear anywhere, never fabricated as ABSENT.
    expect(items.some((i) => i.category === "eye_pain")).toBe(false);
  });
});

describe("evidenceFromFindings - adapter safety", () => {
  it("every finding is UNVERIFIED regardless of confidence - a high confidence score never upgrades trust level", () => {
    const findings: Finding[] = [
      {
        id: "find_1", type: "retinal_thickening", location: "macula", severity: "moderate",
        confidence: 0.98, confidence_category: "HIGH CONFIDENCE", explanation: "synthetic demo finding",
        synthetic: true, model_id: "demo-model",
      } as Finding,
    ];
    const items = evidenceFromFindings("study_fixture", "OD", findings);
    expect(items).toHaveLength(1);
    expect(items[0].confidence).toBe(0.98);
    expect(items[0].trust_level).toBe("UNVERIFIED");
  });
});

/* ---------------------------------------------------------------------- */
/* Conflict engine                                                        */
/* ---------------------------------------------------------------------- */

describe("detectConflicts - VALUE_CONFLICT boundaries", () => {
  it("same category + same laterality, different values -> exactly one VALUE_CONFLICT with both ids", () => {
    const a = mkEvidence({ id: "ev_a", category: "IOP", laterality: "OD", value: 19 });
    const b = mkEvidence({ id: "ev_b", category: "IOP", laterality: "OD", value: 24 });
    const conflicts = detectConflicts([a, b]);
    const valueConflicts = conflicts.filter((c) => c.conflict_type === "VALUE_CONFLICT");
    expect(valueConflicts).toHaveLength(1);
    expect(valueConflicts[0].evidence_ids.sort()).toEqual(["ev_a", "ev_b"]);
  });

  it("same category + same laterality, SAME value -> no conflict", () => {
    const a = mkEvidence({ id: "ev_a", category: "IOP", laterality: "OD", value: 19 });
    const b = mkEvidence({ id: "ev_b", category: "IOP", laterality: "OD", value: 19 });
    expect(detectConflicts([a, b])).toEqual([]);
  });

  it("same category, DIFFERENT laterality -> never flagged (normal two-eye data)", () => {
    const a = mkEvidence({ id: "ev_a", category: "IOP", laterality: "OD", value: 19 });
    const b = mkEvidence({ id: "ev_b", category: "IOP", laterality: "OS", value: 24 });
    expect(detectConflicts([a, b])).toEqual([]);
  });

  it("a REJECTED item with a conflicting value is excluded from all conflicts", () => {
    const trusted = mkEvidence({ id: "ev_trusted", category: "IOP", laterality: "OD", value: 19, trust_level: "AUTO_EXTRACTED" });
    const rejected = mkEvidence({ id: "ev_rejected", category: "IOP", laterality: "OD", value: 40, trust_level: "REJECTED" });
    const conflicts = detectConflicts([trusted, rejected]);
    for (const c of conflicts) expect(c.evidence_ids).not.toContain("ev_rejected");
    // No conflict at all, since only one trusted item remains for this category/laterality.
    expect(conflicts.filter((c) => c.conflict_type === "VALUE_CONFLICT")).toHaveLength(0);
  });

  it("UNKNOWN-laterality items are excluded from VALUE_CONFLICT grouping entirely", () => {
    const known = mkEvidence({ id: "ev_known", category: "IOP", laterality: "OD", value: 19 });
    const unknown = mkEvidence({ id: "ev_unknown", category: "IOP", laterality: "UNKNOWN", value: 40 });
    const conflicts = detectConflicts([known, unknown]);
    expect(conflicts.filter((c) => c.conflict_type === "VALUE_CONFLICT")).toHaveLength(0);
  });
});

/* ---------------------------------------------------------------------- */
/* assessConditions / synthesize                                          */
/* ---------------------------------------------------------------------- */

describe("assessConditions - trust thresholds", () => {
  it("a single AUTO_EXTRACTED/UNVERIFIED IOP result alone never reaches SUPPORTED_CONDITION", () => {
    const items = [mkEvidence({ id: "ev_iop_od", category: "IOP", laterality: "OD", value: 21, trust_level: "AUTO_EXTRACTED" })];
    const assessments = assessConditions(items);
    const odIop = assessments.find((a) => a.condition_id === "iop_evidence_pattern" && a.laterality === "OD")!;
    expect(odIop.state).not.toBe("SUPPORTED_CONDITION");
    expect(["POSSIBLE_CONDITION", "INSUFFICIENT_EVIDENCE", "UNABLE_TO_ASSESS"]).toContain(odIop.state);
  });

  it("a HUMAN_VERIFIED IOP result plus a same-eye supportive symptom can reach SUPPORTED_CONDITION", async () => {
    const { studyId, documentId } = await studyWithPdf("IOP OD 24 mmHg documented");
    await generateResultsForDocument(documentId, "s5synth");
    const [result] = await listTestResultsForDocument(documentId);
    await verifyTestResult(result.result_id, { action: "verify", actor: "reviewer1" });
    await setStudySymptoms(studyId, [
      { type: "reduced_peripheral_vision", onset: "gradual", duration: "weeks", severity: "moderate", laterality: "right", progression: "worsening", frequency: "unknown" },
    ]);

    const ws = await buildEvidenceWorkspace(studyId);
    if ("not_found" in ws) throw new Error("study not found");
    const odIop = ws.possible_conditions.find((c) => c.condition_id === "iop_evidence_pattern" && c.laterality === "OD")!;
    expect(odIop.state).toBe("SUPPORTED_CONDITION");
  });
});

describe("assessConditions / buildEvidenceWorkspace - empty and missing studies", () => {
  it("a study with no test results, symptoms, or findings still returns a valid empty-evidence workspace", async () => {
    const studyId = await bareStudy();
    const ws = await buildEvidenceWorkspace(studyId);
    if ("not_found" in ws) throw new Error("study not found unexpectedly");
    expect(ws.evidence).toEqual([]);
    expect(ws.conflicts).toEqual([]);
    expect(ws.possible_conditions.length).toBeGreaterThan(0);
    for (const c of ws.possible_conditions) {
      expect(["UNABLE_TO_ASSESS", "INSUFFICIENT_EVIDENCE"]).toContain(c.state);
    }
  });

  it("buildEvidenceWorkspace for a nonexistent study id returns not_found, does not throw", async () => {
    const result = await buildEvidenceWorkspace("study_does_not_exist_12345");
    expect("not_found" in result && result.not_found).toBe(true);
    expect((result as any).study_id).toBe("study_does_not_exist_12345");
  });
});

describe("ConditionAssessment - shape/enum discipline", () => {
  it("state is always one of the 5 allowed enum values, and no numeric probability/percentage field is ever present", async () => {
    const studyId = await bareStudy();
    const ws = await buildEvidenceWorkspace(studyId);
    if ("not_found" in ws) throw new Error("study not found unexpectedly");
    const allowed = new Set(["POSSIBLE_CONDITION", "SUPPORTED_CONDITION", "INSUFFICIENT_EVIDENCE", "CONFLICTING_EVIDENCE", "UNABLE_TO_ASSESS"]);
    const expectedKeys = [
      "condition_id", "canonical_name", "category", "laterality", "state",
      "supporting_evidence_ids", "contradicting_evidence_ids", "missing_required",
      "red_flag_candidates", "differential_relationships", "taxonomy_version", "note",
    ].sort();

    expect(ws.possible_conditions.length).toBeGreaterThan(0);
    for (const c of ws.possible_conditions) {
      expect(allowed.has(c.state)).toBe(true);
      expect(Object.keys(c).sort()).toEqual(expectedKeys);
    }
    const sample: ConditionAssessment = ws.possible_conditions[0];
    expect(JSON.stringify(sample)).not.toMatch(/%|probability/i);
  });
});

/* ---------------------------------------------------------------------- */
/* Route-level RBAC                                                       */
/* ---------------------------------------------------------------------- */

function reqFor(url: string, cookies: Record<string, string> = {}, method = "GET", body?: unknown): NextRequest {
  const cookieHeader = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  const headers: Record<string, string> = { cookie: cookieHeader };
  if (cookies[CSRF_COOKIE]) headers["x-csrf-token"] = cookies[CSRF_COOKIE];
  if (body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(new URL(url, "http://localhost:3000"), {
    method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function sessionCookies(role: "ADMIN" | "CLINICIAN" | "REVIEWER" | "TECHNICIAN" | "RESEARCHER", tag: string) {
  const { token, csrf } = await createSession({ user_id: `s5synth_${tag}`, username: `s5synth_${tag}`, role });
  return { [SESSION_COOKIE]: token, [CSRF_COOKIE]: csrf };
}

const EVIDENCE_ROUTE = (await import("@/app/api/studies/[id]/evidence/route")) as typeof import("@/app/api/studies/[id]/evidence/route");

describe("GET /api/studies/[id]/evidence - RBAC", () => {
  it("unauthenticated -> 401", async () => {
    const res = await EVIDENCE_ROUTE.GET(reqFor("http://localhost:3000/api/studies/study_x/evidence"), { params: { id: "study_x" } });
    expect(res.status).toBe(401);
  });

  it("TECHNICIAN and RESEARCHER -> 403", async () => {
    const studyId = await bareStudy();
    for (const role of ["TECHNICIAN", "RESEARCHER"] as const) {
      const cookies = await sessionCookies(role, `deny_${role}`);
      const res = await EVIDENCE_ROUTE.GET(reqFor(`http://localhost:3000/api/studies/${studyId}/evidence`, cookies), { params: { id: studyId } });
      expect(res.status).toBe(403);
    }
  });

  it("REVIEWER/CLINICIAN/ADMIN -> 200 with evidence, conflicts, possible_conditions", async () => {
    const studyId = await bareStudy();
    for (const role of ["REVIEWER", "CLINICIAN", "ADMIN"] as const) {
      const cookies = await sessionCookies(role, `allow_${role}`);
      const res = await EVIDENCE_ROUTE.GET(reqFor(`http://localhost:3000/api/studies/${studyId}/evidence`, cookies), { params: { id: studyId } });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body.evidence)).toBe(true);
      expect(Array.isArray(body.conflicts)).toBe(true);
      expect(Array.isArray(body.possible_conditions)).toBe(true);
    }
  });

  it("a fabricated/nonexistent study id with a valid REVIEWER session -> 404", async () => {
    const cookies = await sessionCookies("REVIEWER", "notfound");
    const res = await EVIDENCE_ROUTE.GET(reqFor("http://localhost:3000/api/studies/study_totally_fake/evidence", cookies), { params: { id: "study_totally_fake" } });
    expect(res.status).toBe(404);
  });
});
