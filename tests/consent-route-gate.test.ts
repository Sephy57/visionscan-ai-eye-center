import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { createSession, SESSION_COOKIE, CSRF_COOKIE } from "@/lib/auth/sessions";
import { createStudy, deleteStudy } from "@/lib/studies/service";
import type { DeviceMetadata } from "@/lib/devices/adapter";

const ANALYZE_ROUTE = (await import("@/app/api/analyze/route")) as typeof import("@/app/api/analyze/route");
const META: DeviceMetadata = { scanType: "external_eye", eye: "unknown", providedBy: "none" };

function request(studyId: string, token: string, csrf: string): NextRequest {
  return new NextRequest(new URL("http://localhost:3000/api/analyze"), {
    method: "POST",
    headers: {
      cookie: `${SESSION_COOKIE}=${token}; ${CSRF_COOKIE}=${csrf}`,
      "x-csrf-token": csrf,
      "content-type": "application/json",
    },
    body: JSON.stringify({ study_id: studyId }),
  });
}

describe("HTTP processing consent boundary", () => {
  it("blocks image analysis before inference when purpose consent is absent", async () => {
    const study = await createStudy("consent-route.png", "image/png", Buffer.from("synthetic-route-fixture"), META);
    try {
      const session = await createSession({ user_id: "consent-route-user", username: "consent-route-user", role: "CLINICIAN" });
      const response = await ANALYZE_ROUTE.POST(request(study.study_id, session.token, session.csrf));
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        error: "CONSENT_REQUIRED",
        purpose: "IMAGE_MODEL_ANALYSIS",
        consent_status: "UNKNOWN",
      });
    } finally {
      await deleteStudy(study.study_id);
    }
  });
});
