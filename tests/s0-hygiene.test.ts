import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { sanitizeDetail } from "@/lib/audit";
import { createSession, SESSION_COOKIE } from "@/lib/auth/sessions";
import { GET as selftestGET } from "@/app/api/selftest/route";

function reqWithCookies(url: string, cookies: Record<string, string>, method = "GET", extraHeaders: Record<string, string> = {}): NextRequest {
  const cookieHeader = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  return new NextRequest(new URL(url, "http://localhost:3000"), {
    method,
    headers: { cookie: cookieHeader, ...extraHeaders },
  });
}

describe("S0.4/S0.5 - audit sanitizer blocks document/OCR-era PHI", () => {
  it("redacts a labeled patient name but preserves surrounding metadata", () => {
    const out = sanitizeDetail("document.uploaded Patient Name: John Smith studyId=study_123 status=VALID");
    expect(out).toContain("studyId=study_123");
    expect(out).toContain("status=VALID");
    expect(out).not.toContain("John");
    expect(out).toMatch(/Patient Name:\s*\[redacted\]/i);
  });

  it("redacts DOB values but preserves trailing key=value metadata", () => {
    const out = sanitizeDetail("DOB: 1970-04-21 page=2");
    expect(out).not.toContain("1970-04-21");
    expect(out).toContain("page=2");
  });

  it("redacts MRN, Medical Record Number, and Accession labels", () => {
    for (const detail of ["MRN: 004321A", "Medical Record Number: 88-4410", "Accession: ACC-2026-1188"]) {
      const out = sanitizeDetail(detail);
      expect(out).not.toMatch(/\d/);
      expect(out).toContain("[redacted]");
    }
  });

  it("redacts Address, Phone, Diagnosis, Medication, and Clinical Notes values", () => {
    const out = sanitizeDetail("Address: 12 Oak Street; Phone: 555-0142; Diagnosis: glaucoma suspect; Medication: timolol; Clinical Notes: follow up in 3 months");
    expect(out).not.toContain("Oak Street");
    expect(out).not.toContain("555-0142");
    expect(out).not.toContain("timolol");
    expect(out).not.toContain("follow up in 3 months");
    expect((out ?? "").match(/\[redacted\]/g)?.length).toBeGreaterThanOrEqual(5);
  });

  it("redacts bare email addresses anywhere in the detail string", () => {
    const out = sanitizeDetail("uploader contact jane.doe@example.org processed ok");
    expect(out).not.toContain("jane.doe@example.org");
    expect(out).toContain("processed ok");
  });

  it("does not over-redact harmless metadata", () => {
    const detail = "documentId=doc_abc123 status=VALID pages=3 sha256=abcd1234 parserVersion=1.0.0";
    expect(sanitizeDetail(detail)).toBe(detail);
  });

  it("does not redact the word patient when it is not a label:value pair", () => {
    const out = sanitizeDetail("patient context attached by clinician");
    expect(out).toBe("patient context attached by clinician");
  });

  it("does not redact labels embedded inside larger words", () => {
    const out = sanitizeDetail("outpatient queue status: drained");
    expect(out).toContain("outpatient queue status: drained");
  });

  it("fully redacts base64/data-URL payloads (existing behavior preserved)", () => {
    // Note: a bare base64-LOOKING string without the literal marker was never
    // redacted before S0 either - behavior intentionally unchanged.
    expect(sanitizeDetail("payload base64,iVBORw0KGgoAAAANS")).toBe("[redacted - potential sensitive content]");
    expect(sanitizeDetail("data:image/png;base64,AAAA")).toBe("[redacted - potential sensitive content]");
    expect(sanitizeDetail("bearer abc.def.ghi")).toBe("[redacted - potential sensitive content]");
  });

  it("fully redacts raw PDF bytes and OCR/document text field names", () => {
    expect(sanitizeDetail("%PDF-1.7 %âãÏÓ 1 0 obj")).toBe("[redacted - potential sensitive content]");
    expect(sanitizeDetail("extractedText=...")).toBe("[redacted - potential sensitive content]");
    expect(sanitizeDetail("rawDocument=...")).toBe("[redacted - potential sensitive content]");
    expect(sanitizeDetail("ocrText=...")).toBe("[redacted - potential sensitive content]");
  });

  it("still truncates over-long details to 300 characters", () => {
    const long = "x".repeat(500);
    expect(sanitizeDetail(long)?.length).toBe(300);
  });
});

describe("S0.3 - /api/selftest is locked (401 / 403 / ADMIN-only)", () => {
  it("returns 401 for an unauthenticated request", async () => {
    const req = reqWithCookies("http://localhost:3000/api/selftest", {});
    const res = await selftestGET(req);
    expect(res.status).toBe(401);
  });

  it("returns 403 for an authenticated non-ADMIN role (TECHNICIAN)", async () => {
    const { token } = await createSession({ user_id: "s0tech", username: "s0tech", role: "TECHNICIAN" });
    const req = reqWithCookies("http://localhost:3000/api/selftest", { [SESSION_COOKIE]: token });
    const res = await selftestGET(req);
    expect(res.status).toBe(403);
  });

  it("returns 403 for REVIEWER and RESEARCHER as well", async () => {
    for (const role of ["REVIEWER", "RESEARCHER"] as const) {
      const { token } = await createSession({ user_id: `s0_${role}`, username: `s0_${role}`, role });
      const req = reqWithCookies("http://localhost:3000/api/selftest", { [SESSION_COOKIE]: token });
      const res = await selftestGET(req);
      expect(res.status).toBe(403);
    }
  });

  it("runs the full self-test for ADMIN and cleans up after itself", async () => {
    const { token } = await createSession({ user_id: "s0admin", username: "s0admin", role: "ADMIN" });
    const req = reqWithCookies("http://localhost:3000/api/selftest", { [SESSION_COOKIE]: token });
    const res = await selftestGET(req);
    expect(res.status).toBe(200);
    const report = (await res.json()) as { total: number; passed: number; all_passed: boolean };
    expect(report.total).toBeGreaterThan(0);
    expect(report.passed).toBe(report.total);
    expect(report.all_passed).toBe(true);
  }, 180_000);
});
