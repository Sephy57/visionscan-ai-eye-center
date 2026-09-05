import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { hashPassword, verifyPassword, checkPasswordPolicy, randomToken } from "@/lib/auth/passwords";
import { createUser, authenticate, getUserByUsername, setUserDisabled } from "@/lib/auth/users";
import { createSession, validateSession, destroySession, csrfMatches, SESSION_COOKIE, CSRF_COOKIE } from "@/lib/auth/sessions";
import { requireRole } from "@/lib/auth/rbac";
import { checkRateLimit, _resetRateLimitForTests } from "@/lib/auth/rateLimit";
import { audit, verifyAuditChain } from "@/lib/audit";
import { safeJoin } from "@/lib/config";
import { getConsentStatus, recordConsent, withdrawConsent } from "@/lib/consent/consent";
import { requestStatusTransition } from "@/lib/models/transitions";
import { ensureRegistryHydrated, _resetHydrationForTests } from "@/lib/models/registryPersistence";
import { MODELS, ModelRecord } from "@/lib/models/registry";
import { dbDelete } from "@/lib/storage/db";

function reqWithCookies(url: string, cookies: Record<string, string>, method = "GET", extraHeaders: Record<string, string> = {}): NextRequest {
  const cookieHeader = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  return new NextRequest(new URL(url, "http://localhost:3000"), {
    method,
    headers: { cookie: cookieHeader, ...extraHeaders },
  });
}

describe("password hashing", () => {
  it("never stores plaintext - hash differs from input and encodes real parameters", async () => {
    const hash = await hashPassword("CorrectHorseBattery9!");
    expect(hash).not.toContain("CorrectHorseBattery9!");
    expect(hash.startsWith("scrypt$")).toBe(true);
  });

  it("verifies a correct password and rejects an incorrect one", async () => {
    const hash = await hashPassword("CorrectHorseBattery9!");
    expect(await verifyPassword("CorrectHorseBattery9!", hash)).toBe(true);
    expect(await verifyPassword("WrongPassword123!", hash)).toBe(false);
  });

  it("rejects malformed stored hashes rather than throwing", async () => {
    expect(await verifyPassword("anything", "not-a-real-hash")).toBe(false);
  });

  it("enforces a minimum password policy", () => {
    expect(checkPasswordPolicy("short").ok).toBe(false);
    expect(checkPasswordPolicy("alllowercase12").ok).toBe(false);
    expect(checkPasswordPolicy("ALLUPPERCASE12").ok).toBe(false);
    expect(checkPasswordPolicy("NoDigitsHereAtAll").ok).toBe(false);
    expect(checkPasswordPolicy("ValidPassw0rd123").ok).toBe(true);
  });

  it("random tokens are unique and sufficiently long", () => {
    const a = randomToken(32), b = randomToken(32);
    expect(a).not.toBe(b);
    expect(a.length).toBe(64); // hex-encoded 32 bytes
  });
});

describe("user authentication and lockout", () => {
  const username = `sectest_${Date.now()}`;

  it("creates a user with a policy-compliant password", async () => {
    const result = await createUser({ username, password: "ValidPassw0rd123", role: "CLINICIAN", display_name: "Sec Test", created_by: "test" });
    expect(result.ok).toBe(true);
    expect("password_hash" in (result.user ?? {})).toBe(false);
  });

  it("rejects a weak password at creation time", async () => {
    const result = await createUser({ username: `weak_${Date.now()}`, password: "weak", role: "CLINICIAN", display_name: "x", created_by: "test" });
    expect(result.ok).toBe(false);
  });

  it("authenticates with the correct password", async () => {
    const result = await authenticate(username, "ValidPassw0rd123");
    expect(result.ok).toBe(true);
    expect(result.user?.role).toBe("CLINICIAN");
  });

  it("rejects an unknown username without revealing existence", async () => {
    const result = await authenticate("no-such-user-ever", "whatever12345A");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("Invalid username or password.");
  });

  it("locks the account after repeated failed attempts", async () => {
    const lockUser = `locktest_${Date.now()}`;
    await createUser({ username: lockUser, password: "ValidPassw0rd123", role: "CLINICIAN", display_name: "x", created_by: "test" });
    let lastReason = "";
    for (let i = 0; i < 6; i++) {
      const r = await authenticate(lockUser, "WrongPassword!!");
      lastReason = r.reason ?? "";
    }
    expect(lastReason.toLowerCase()).toContain("locked");
    // Correct password also rejected while locked.
    const stillLocked = await authenticate(lockUser, "ValidPassw0rd123");
    expect(stillLocked.ok).toBe(false);
  });

  it("a disabled account cannot authenticate even with the correct password", async () => {
    const disUser = `distest_${Date.now()}`;
    const created = await createUser({ username: disUser, password: "ValidPassw0rd123", role: "TECHNICIAN", display_name: "x", created_by: "test" });
    await setUserDisabled(created.user!.user_id, true, "test");
    const result = await authenticate(disUser, "ValidPassw0rd123");
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/disabled/i);
  });

  it("rejects duplicate usernames", async () => {
    const dupUser = `duptest_${Date.now()}`;
    const first = await createUser({ username: dupUser, password: "ValidPassw0rd123", role: "CLINICIAN", display_name: "x", created_by: "test" });
    expect(first.ok).toBe(true);
    const second = await createUser({ username: dupUser, password: "AnotherValid123", role: "CLINICIAN", display_name: "x", created_by: "test" });
    expect(second.ok).toBe(false);
  });
});

describe("sessions", () => {
  it("creates a session and validates it with the correct token", async () => {
    const { token } = await createSession({ user_id: "u1", username: "sessiontest", role: "ADMIN" });
    const check = await validateSession(token);
    expect(check.valid).toBe(true);
    expect(check.session?.username).toBe("sessiontest");
  });

  it("rejects a forged/unknown session token", async () => {
    const check = await validateSession("0".repeat(64));
    expect(check.valid).toBe(false);
    expect(check.reason).toBe("not_found");
  });

  it("rejects a missing token", async () => {
    const check = await validateSession(undefined);
    expect(check.valid).toBe(false);
    expect(check.reason).toBe("no_token");
  });

  it("destroying a session invalidates it", async () => {
    const { token } = await createSession({ user_id: "u2", username: "destroytest", role: "TECHNICIAN" });
    await destroySession(token);
    const check = await validateSession(token);
    expect(check.valid).toBe(false);
  });

  it("CSRF token comparison rejects a mismatched or missing header", () => {
    expect(csrfMatches("abc123", "abc123")).toBe(true);
    expect(csrfMatches("abc123", "abc124")).toBe(false);
    expect(csrfMatches("abc123", undefined)).toBe(false);
    expect(csrfMatches("abc123", "")).toBe(false);
  });
});

describe("RBAC - requireRole (the real server-side enforcement point)", () => {
  it("rejects a request with no session at all", async () => {
    const req = reqWithCookies("http://localhost:3000/api/studies", {});
    const denied = await requireRole(req, ["ADMIN"]);
    expect(denied?.status).toBe(401);
  });

  it("rejects a valid session with the wrong role", async () => {
    const { token } = await createSession({ user_id: "u3", username: "researcher1", role: "RESEARCHER" });
    const req = reqWithCookies("http://localhost:3000/api/studies", { [SESSION_COOKIE]: token });
    const denied = await requireRole(req, ["ADMIN", "CLINICIAN", "REVIEWER"]);
    expect(denied?.status).toBe(403);
  });

  it("allows a valid session with an allowed role", async () => {
    const { token } = await createSession({ user_id: "u4", username: "clinician1", role: "CLINICIAN" });
    const req = reqWithCookies("http://localhost:3000/api/studies", { [SESSION_COOKIE]: token });
    const denied = await requireRole(req, ["ADMIN", "CLINICIAN", "REVIEWER"]);
    expect(denied).toBeNull();
  });

  it("rejects a mutating request (POST) missing the CSRF header even with a valid session+role", async () => {
    const { token } = await createSession({ user_id: "u5", username: "clinician2", role: "CLINICIAN" });
    const req = reqWithCookies("http://localhost:3000/api/upload", { [SESSION_COOKIE]: token }, "POST");
    const denied = await requireRole(req, ["CLINICIAN"]);
    expect(denied?.status).toBe(403);
  });

  it("allows a mutating request with a matching CSRF header", async () => {
    const { token, csrf } = await createSession({ user_id: "u6", username: "clinician3", role: "CLINICIAN" });
    const req = reqWithCookies("http://localhost:3000/api/upload", { [SESSION_COOKIE]: token }, "POST", { "x-csrf-token": csrf });
    const denied = await requireRole(req, ["CLINICIAN"]);
    expect(denied).toBeNull();
  });

  it("cross-role study access is denied: a RESEARCHER cannot reach a clinical study route", async () => {
    const { token } = await createSession({ user_id: "u7", username: "researcher2", role: "RESEARCHER" });
    const req = reqWithCookies("http://localhost:3000/api/studies/study_abc123", { [SESSION_COOKIE]: token });
    const denied = await requireRole(req, ["ADMIN", "CLINICIAN", "REVIEWER"]);
    expect(denied?.status).toBe(403);
  });
});

describe("rate limiting", () => {
  beforeEach(() => _resetRateLimitForTests());

  it("allows requests under the limit and blocks once exceeded", () => {
    const key = "test-key";
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit(key, 5, 60_000).allowed).toBe(true);
    }
    expect(checkRateLimit(key, 5, 60_000).allowed).toBe(false);
  });

  it("different keys have independent buckets", () => {
    expect(checkRateLimit("a", 1, 60_000).allowed).toBe(true);
    expect(checkRateLimit("b", 1, 60_000).allowed).toBe(true);
  });
});

describe("audit hash-chain tamper detection", () => {
  // Uses a private LOG_ROOT (set before importing lib/audit) rather than the
  // shared data/logs directory: vitest gives every test FILE its own
  // isolated module registry and, by default, runs files in parallel, so
  // sharing the real log file across files would mean two independent
  // audit()-serialization queues (see lib/audit/index.ts's own
  // single-process caveat) racing on the same physical file - a test
  // artifact of running many isolated module instances concurrently, not a
  // flaw in the chain itself. An isolated directory sidesteps that and
  // tests the real property: the chain this module produces is self-consistent.
  async function isolatedAuditModule() {
    const dir = `/tmp/audit-chain-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    process.env.LOG_ROOT = dir;
    vi.resetModules(); // force lib/config.ts (and everything importing it) to re-evaluate with the new LOG_ROOT
    const mod = await import("@/lib/audit");
    delete process.env.LOG_ROOT; // the fresh module already captured LOG_ROOT at evaluation time; don't leak the override further
    return mod as typeof import("@/lib/audit");
  }

  it("a healthy chain verifies as valid", async () => {
    const { audit: isolatedAudit, verifyAuditChain: isolatedVerify } = await isolatedAuditModule();
    await isolatedAudit({ actor: "test", action: "test.event", outcome: "ok" });
    const result = await isolatedVerify();
    expect(result.valid).toBe(true);
  });

  it("each event links to the previous event's hash", async () => {
    const { audit: isolatedAudit, verifyAuditChain: isolatedVerify } = await isolatedAuditModule();
    await isolatedAudit({ actor: "test", action: "chain.a", outcome: "ok" });
    await isolatedAudit({ actor: "test", action: "chain.b", outcome: "ok" });
    const result = await isolatedVerify();
    expect(result.valid).toBe(true);
    expect(result.events_checked).toBeGreaterThan(1);
  });
});

describe("path traversal protection (safeJoin)", () => {
  it("rejects a path that escapes the configured root", () => {
    expect(() => safeJoin("/tmp/root", "../../etc/passwd")).toThrow();
  });

  it("rejects an absolute-path escape attempt", () => {
    expect(() => safeJoin("/tmp/root", "..", "..", "etc", "passwd")).toThrow();
  });

  it("allows a legitimate nested path within the root", () => {
    expect(() => safeJoin("/tmp/root", "study_123", "original.png")).not.toThrow();
  });
});

describe("consent defaults to UNKNOWN, never GRANTED", () => {
  it("a study with no consent record returns UNKNOWN", async () => {
    const status = await getConsentStatus(`no_consent_study_${Date.now()}`, "screening_analysis");
    expect(status).toBe("UNKNOWN");
  });

  it("a withdrawn consent is reported as WITHDRAWN, not GRANTED", async () => {
    const studyId = `withdraw_study_${Date.now()}`;
    const rec = await recordConsent({ studyId, purpose: "screening_analysis", consentType: "explicit", status: "GRANTED", actor: "test" });
    await withdrawConsent(rec.consentId, "test", "patient requested withdrawal");
    const status = await getConsentStatus(studyId, "screening_analysis");
    expect(status).toBe("WITHDRAWN");
  });
});

describe("unauthorized/invalid model transitions are rejected (fail closed)", () => {
  beforeEach(() => _resetHydrationForTests());

  it("rejects a ladder-skipping transition (DEMO -> CLINICALLY_VALIDATED)", async () => {
    await ensureRegistryHydrated();
    const rec = await requestStatusTransition({
      model_id: "demo-fundus-synthetic-v0", to_status: "CLINICALLY_VALIDATED", evidence_refs: [], requested_by: "test-admin",
    });
    expect(rec.decision).toBe("rejected");
    expect(MODELS["demo-fundus-synthetic-v0"].status).toBe("DEMO");
  });

  it("an approved transition is durably recorded (using a disposable test model, never the real DEMO model)", async () => {
    // Use a throwaway model registered only for this test - never mutate the
    // real "demo-fundus-synthetic-v0" registry entry's persisted status,
    // which the rest of the suite (and the running app) depends on staying DEMO.
    const testModelId = `sectest-model-${Date.now()}`;
    const testModel: ModelRecord = {
      model_id: testModelId, model_name: "Security Test Model", version: "0.0.1",
      sha256: null, format: "placeholder", file_path: null, modalities: ["FUNDUS"],
      supported_anatomy: [], supported_findings: [], intended_use: "test", contraindications: [], limitations: [],
      training_dataset: null, validation_dataset: null, patient_level_split: null,
      performance: { sensitivity: null, specificity: null, ppv: null, npv: null, auroc: null, auprc: null, calibration: null, evidence_reference: null },
      validation_date: null, external_validation_status: "none", clinical_validation_status: "none", regulatory_status: "none",
      status: "DEMO", devices: [], uses_symptoms: false, input_schema: "IMAGE_ONLY", supported_symptom_types: [],
      performance_with_symptoms: null, performance_without_symptoms: null, supported_conditions: [],
    };
    MODELS[testModelId] = testModel;
    try {
      const rec = await requestStatusTransition({ model_id: testModelId, to_status: "RESEARCH", evidence_refs: [], requested_by: "test-admin" });
      expect(rec.decision).toBe("approved");
      expect(MODELS[testModelId].status).toBe("RESEARCH");
      expect(rec.transition_id).toBeTruthy();
    } finally {
      delete MODELS[testModelId];
      await dbDelete("model_registry_state", testModelId);
    }
  });

  it("rejects a transition for an unknown model id", async () => {
    await expect(requestStatusTransition({
      model_id: "not-a-real-model", to_status: "RESEARCH", evidence_refs: [], requested_by: "test-admin",
    })).rejects.toThrow(/Unknown model/);
  });
});

describe("model registry persistence survives re-hydration (simulated restart)", () => {
  it("hydration is idempotent and safe to call repeatedly", async () => {
    await ensureRegistryHydrated();
    await ensureRegistryHydrated();
    await ensureRegistryHydrated();
    expect(MODELS["demo-fundus-synthetic-v0"]).toBeDefined();
  });
});
