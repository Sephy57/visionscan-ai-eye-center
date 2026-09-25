import { describe, expect, it } from "vitest";
import configFactory from "../next.config.mjs";

type HeaderRule = { source: string; has?: Array<{ type: string; key: string; value?: string }>; headers: Array<{ key: string; value: string }> };

async function rules(phase: string): Promise<HeaderRule[]> {
  const config = (configFactory as unknown as (phase: string) => { headers: () => Promise<HeaderRule[]> })(phase);
  return config.headers();
}

function directives(csp: string): Map<string, string[]> {
  return new Map(csp.split(";").map((d) => d.trim()).filter(Boolean).map((d) => {
    const [name, ...values] = d.split(/\s+/);
    return [name, values];
  }));
}

describe("global security headers", () => {
  it("production CSP locks every fetch directive to this origin", async () => {
    const [global] = await rules("phase-production-server");
    const csp = global.headers.find((h) => h.key === "Content-Security-Policy")!.value;
    const d = directives(csp);
    expect(d.get("default-src")).toEqual(["'self'"]);
    expect(d.get("script-src")).toEqual(["'self'", "'unsafe-inline'"]);
    expect(d.get("script-src")).not.toContain("'unsafe-eval'");
    expect(d.get("connect-src")).toEqual(["'self'"]);
    expect(d.get("img-src")).toEqual(["'self'", "blob:", "data:"]);
    expect(d.get("object-src")).toEqual(["'none'"]);
    expect(d.get("frame-ancestors")).toEqual(["'none'"]);
    expect(d.get("base-uri")).toEqual(["'self'"]);
    expect(d.get("form-action")).toEqual(["'self'"]);
    // Plain-HTTP loopback/LAN demo deployments must keep working.
    expect(d.has("upgrade-insecure-requests")).toBe(false);
    // No third-party origin anywhere in the policy.
    expect(csp).not.toMatch(/https?:\/\//);
  });

  it("only the development server allows eval and HMR websockets", async () => {
    const [dev] = await rules("phase-development-server");
    const d = directives(dev.headers.find((h) => h.key === "Content-Security-Policy")!.value);
    expect(d.get("script-src")).toContain("'unsafe-eval'");
    expect(d.get("connect-src")).toEqual(["'self'", "ws:", "wss:"]);
  });

  it("sends the companion hardening headers on every route", async () => {
    const [global] = await rules("phase-production-server");
    const byKey = Object.fromEntries(global.headers.map((h) => [h.key, h.value]));
    expect(global.source).toBe("/:path*");
    expect(byKey["X-Content-Type-Options"]).toBe("nosniff");
    expect(byKey["X-Frame-Options"]).toBe("DENY");
    expect(byKey["Referrer-Policy"]).toBe("same-origin");
    expect(byKey["Permissions-Policy"]).toContain("camera=()");
    expect(byKey["Cross-Origin-Opener-Policy"]).toBe("same-origin");
    expect(global.headers.some((h) => h.key === "Strict-Transport-Security")).toBe(false);
  });

  it("keeps the stored-PDF sandbox: a later, route-specific rule replaces the app CSP", async () => {
    const all = await rules("phase-production-server");
    const pdf = all.findIndex((r) => r.source === "/api/documents/:id/file");
    expect(pdf).toBeGreaterThan(0);
    expect(pdf).toBe(all.length - 1);
    expect(all[pdf].headers).toEqual([{ key: "Content-Security-Policy", value: "sandbox" }]);
    const { documentResponseHeaders } = await import("@/lib/documents/security");
    expect(documentResponseHeaders("doc_x", 1)["Content-Security-Policy"]).toBe(all[pdf].headers[0].value);
  });

  it("sends HSTS only for requests that arrived over HTTPS", async () => {
    const hsts = (await rules("phase-production-server")).filter((r) => r.headers.some((h) => h.key === "Strict-Transport-Security"));
    expect(hsts).toHaveLength(1);
    expect(hsts[0].has).toEqual([{ type: "header", key: "x-forwarded-proto", value: "https" }]);
    expect(hsts[0].headers[0].value).toBe("max-age=31536000");
  });
});
