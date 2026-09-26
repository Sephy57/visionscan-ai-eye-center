import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { createSession, validateSession, SESSION_COOKIE, CSRF_COOKIE } from "@/lib/auth/sessions";

const READY = (await import("@/app/api/health/ready/route")) as typeof import("@/app/api/health/ready/route");
const LOGOUT = (await import("@/app/api/auth/logout/route")) as typeof import("@/app/api/auth/logout/route");

function request(path: string, method: string, cookies: Record<string, string> = {}, csrfHeader?: string, extra: Record<string, string> = {}, base = "http://localhost:3000"): NextRequest {
  const headers: Record<string, string> = { cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; "), host: "localhost:3000", ...extra };
  if (csrfHeader !== undefined) headers["x-csrf-token"] = csrfHeader;
  return new NextRequest(new URL(path, base), { method, headers });
}

async function session(tag: string) {
  const { token, csrf } = await createSession({ user_id: `hard_${tag}`, username: `hard_${tag}`, role: "CLINICIAN" });
  return { token, csrf, cookies: { [SESSION_COOKIE]: token, [CSRF_COOKIE]: csrf } };
}

const FORBIDDEN_DETAIL = /schema|migration|pragma|backend|sqlite|journal|database_file|path|[A-Za-z]:\\|\/data\//i;

describe("/api/health/ready exposure", () => {
  it("anonymous callers receive only the overall status and HTTP code", async () => {
    const res = await READY.GET(request("/api/health/ready", "GET"));
    const body = await res.json();
    expect(Object.keys(body)).toEqual(["status"]);
    expect(["ready", "not_ready"]).toContain(body.status);
    expect(res.status).toBe(body.status === "ready" ? 200 : 503);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("signed-in callers see per-dependency ok flags but no implementation detail", async () => {
    const { cookies } = await session("ready");
    const res = await READY.GET(request("/api/health/ready", "GET", cookies));
    const body = await res.json();
    expect(Object.keys(body.checks).sort()).toEqual(["database", "model_registry", "storage_reports", "storage_uploads"]);
    for (const check of Object.values(body.checks) as Array<Record<string, unknown>>) expect(typeof check.ok).toBe("boolean");
    expect(JSON.stringify(body)).not.toMatch(FORBIDDEN_DETAIL);
  });
});

describe("/api/auth/logout CSRF", () => {
  it("rejects a logout for a live session without the CSRF header and keeps the session", async () => {
    const { token, cookies } = await session("nocsrf");
    const res = await LOGOUT.POST(request("/api/auth/logout", "POST", cookies));
    expect(res.status).toBe(403);
    expect((await validateSession(token)).valid).toBe(true);
  });

  it("rejects a wrong CSRF token", async () => {
    const { token, cookies } = await session("badcsrf");
    const res = await LOGOUT.POST(request("/api/auth/logout", "POST", cookies, "0".repeat(64)));
    expect(res.status).toBe(403);
    expect((await validateSession(token)).valid).toBe(true);
  });

  it("logs out with the matching CSRF token and clears both cookies", async () => {
    const { token, csrf, cookies } = await session("okcsrf");
    const res = await LOGOUT.POST(request("/api/auth/logout", "POST", cookies, csrf));
    expect(res.status).toBe(200);
    expect((await validateSession(token)).valid).toBe(false);
    const cleared = res.cookies.getAll().filter((c) => c.value === "" && c.maxAge === 0).map((c) => c.name).sort();
    expect(cleared).toEqual([CSRF_COOKIE, SESSION_COOKIE].sort());
  });

  it("rejects a cross-site request without the CSRF token (fetch metadata or foreign Origin)", async () => {
    const crossSite: Array<Record<string, string>> = [{ "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-site" }, { origin: "https://attacker.example" }];
    for (const extra of crossSite) {
      const { token, cookies } = await session(`xsite${Object.values(extra)[0].length}`);
      const res = await LOGOUT.POST(request("/api/auth/logout", "POST", cookies, undefined, extra));
      expect(res.status).toBe(403);
      expect((await validateSession(token)).valid).toBe(true);
    }
  });

  it("rejects an Origin with the right host but a different scheme", async () => {
    const { token, cookies } = await session("scheme-mismatch");
    const res = await LOGOUT.POST(request("/api/auth/logout", "POST", cookies, undefined, { origin: "http://localhost:3000" }, "https://localhost:3000"));
    expect(res.status).toBe(403);
    expect((await validateSession(token)).valid).toBe(true);
  });

  it("lets the app itself sign out when its CSRF cookie was lost (same-origin proof)", async () => {
    const sameOrigin: Array<Record<string, string>> = [{ "sec-fetch-site": "same-origin" }, { origin: "http://localhost:3000" }];
    for (const extra of sameOrigin) {
      const { token, cookies } = await session(`same${Object.keys(extra)[0].length}`);
      delete (cookies as Record<string, string>)[CSRF_COOKIE];
      const res = await LOGOUT.POST(request("/api/auth/logout", "POST", cookies, undefined, extra));
      expect(res.status).toBe(200);
      expect((await validateSession(token)).valid).toBe(false);
    }
  });

  it("stays idempotent without a valid session (nothing to protect)", async () => {
    const res = await LOGOUT.POST(request("/api/auth/logout", "POST", { [SESSION_COOKIE]: "not-a-session" }));
    expect(res.status).toBe(200);
  });
});
