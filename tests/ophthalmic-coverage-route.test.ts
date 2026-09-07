import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { createSession, SESSION_COOKIE } from "@/lib/auth/sessions";
import { OPHTHALMIC_COVERAGE_REGISTRY } from "@/lib/models/ophthalmicCoverage";

function requestWith(token?: string) {
  return new NextRequest("http://localhost:3000/api/models/coverage", token ? { headers: { cookie: `${SESSION_COOKIE}=${token}` } } : undefined);
}

const ROUTE = (await import("@/app/api/models/coverage/route")) as typeof import("@/app/api/models/coverage/route");

describe("GET /api/models/coverage", () => {
  it("is not exposed without authentication", async () => {
    expect((await ROUTE.GET(requestWith())).status).toBe(401);
  });

  it("keeps technical model-governance inventory ADMIN-only", async () => {
    const { token } = await createSession({ user_id: "coverage_clinician", username: "coverage_clinician", role: "CLINICIAN" });
    expect((await ROUTE.GET(requestWith(token))).status).toBe(403);
  });

  it("returns explicit negative-space coverage without activating a model", async () => {
    const { token } = await createSession({ user_id: "coverage_admin", username: "coverage_admin", role: "ADMIN" });
    const response = await ROUTE.GET(requestWith(token));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.production_coverage_count).toBe(0);
    expect(body.entries).toHaveLength(OPHTHALMIC_COVERAGE_REGISTRY.length);
    expect(body.entries.every((entry: { pipeline_enabled: boolean }) => !entry.pipeline_enabled)).toBe(true);
  });
});
