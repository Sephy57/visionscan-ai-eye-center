import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { createSession, SESSION_COOKIE } from "@/lib/auth/sessions";
import { CANDIDATE_MODEL_DOSSIERS } from "@/lib/models/candidateDossiers";

/**
 * S6 - candidate dossier route RBAC. Governance/licensing information is
 * ADMIN-only (not CLINICIAN/REVIEWER, unlike PHI-bearing results routes -
 * this is a different, narrower policy on purpose: dossiers are internal
 * due-diligence records, not patient data).
 */

function reqFor(url: string, cookies: Record<string, string> = {}): NextRequest {
  const cookieHeader = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  return new NextRequest(new URL(url, "http://localhost:3000"), { headers: { cookie: cookieHeader } });
}

const ROUTE = (await import("@/app/api/models/candidates/route")) as typeof import("@/app/api/models/candidates/route");

describe("GET /api/models/candidates - RBAC", () => {
  it("unauthenticated -> 401", async () => {
    const res = await ROUTE.GET(reqFor("http://localhost:3000/api/models/candidates"));
    expect(res.status).toBe(401);
  });

  it("CLINICIAN, REVIEWER, TECHNICIAN, RESEARCHER -> 403 (ADMIN-only governance data)", async () => {
    for (const role of ["CLINICIAN", "REVIEWER", "TECHNICIAN", "RESEARCHER"] as const) {
      const { token } = await createSession({ user_id: `s6cand_${role}`, username: `s6cand_${role}`, role });
      const res = await ROUTE.GET(reqFor("http://localhost:3000/api/models/candidates", { [SESSION_COOKIE]: token }));
      expect(res.status).toBe(403);
    }
  });

  it("ADMIN -> 200 with every dossier explicitly CANDIDATE_ONLY", async () => {
    const { token } = await createSession({ user_id: "s6cand_admin", username: "s6cand_admin", role: "ADMIN" });
    const res = await ROUTE.GET(reqFor("http://localhost:3000/api/models/candidates", { [SESSION_COOKIE]: token }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.candidates)).toBe(true);
    expect(body.candidates.length).toBe(CANDIDATE_MODEL_DOSSIERS.length);
    for (const c of body.candidates) {
      expect(c.status).toBe("CANDIDATE_ONLY");
      // model_weights_integrity_hash is null for an unacquired candidate, or a
      // real sha256 string once S9 has downloaded+independently hashed an
      // artifact for it (see lib/models/candidateDossiers.ts) - CANDIDATE_ONLY
      // status is what matters here, not whether an artifact was ever fetched.
      expect(c.model_weights_integrity_hash === null || typeof c.model_weights_integrity_hash === "string").toBe(true);
    }
  });
});

describe("S6 - candidate dossiers never reach the live model registry", () => {
  it("no candidate id is a registered model", async () => {
    const { getModel } = await import("@/lib/models/registry");
    for (const d of CANDIDATE_MODEL_DOSSIERS) {
      expect(getModel(d.candidate_id)).toBeFalsy();
    }
  });

  it("no candidate id has a live provider", async () => {
    const { getProviderForModel, defaultProvider } = await import("@/lib/models/provider");
    for (const d of CANDIDATE_MODEL_DOSSIERS) {
      expect(getProviderForModel(d.candidate_id)).toBeNull();
    }
    expect(defaultProvider().modelId).toBe("demo-fundus-synthetic-v0");
  });
});
