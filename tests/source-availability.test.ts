import { afterAll, describe, expect, it } from "vitest";
import fs from "fs/promises";
import path from "path";
import sharp from "sharp";
import { NextRequest } from "next/server";
import { createStudy, deleteStudy } from "@/lib/studies/service";
import { createSession, SESSION_COOKIE, CSRF_COOKIE } from "@/lib/auth/sessions";
import { UPLOAD_ROOT } from "@/lib/config";
import { classifySourceResponse, SOURCE_MISSING_CODE, SOURCE_STATE_COPY } from "@/lib/imaging/sourceAvailability";

const IMAGE = (await import("@/app/api/studies/[id]/image/route")) as typeof import("@/app/api/studies/[id]/image/route");

describe("source availability classification", () => {
  it("maps each image-endpoint outcome to one distinct state", () => {
    expect(classifySourceResponse(200, null, "image/png")).toEqual({ state: "SOURCE_AVAILABLE" });
    expect(classifySourceResponse(404, SOURCE_MISSING_CODE)).toEqual({ state: "SOURCE_MISSING", reason: "missing_from_storage" });
    // A generic 404 (e.g. study out of scope) is never reported as a missing file.
    expect(classifySourceResponse(404, "Not found")).toEqual({ state: "SOURCE_UNAVAILABLE", reason: "service_error" });
    expect(classifySourceResponse(401)).toEqual({ state: "SOURCE_UNAVAILABLE", reason: "access_denied" });
    expect(classifySourceResponse(403)).toEqual({ state: "SOURCE_UNAVAILABLE", reason: "access_denied" });
    expect(classifySourceResponse(500)).toEqual({ state: "SOURCE_UNAVAILABLE", reason: "service_error" });
    expect(classifySourceResponse(null)).toEqual({ state: "SOURCE_UNAVAILABLE", reason: "network_error" });
    expect(classifySourceResponse(200, null, "application/octet-stream")).toEqual({ state: "SOURCE_UNAVAILABLE", reason: "not_an_image" });
  });

  it("every failure explains that no substitute image or overlay is shown", () => {
    for (const byReason of Object.values(SOURCE_STATE_COPY)) {
      for (const copy of Object.values(byReason)) expect(copy.body).toMatch(/No substitute image or overlay is shown/);
    }
  });
});

describe("/api/studies/[id]/image source states", () => {
  const created: string[] = [];
  afterAll(async () => { for (const id of created) await deleteStudy(id).catch(() => undefined); });

  async function clinicianCookies() {
    const { token, csrf } = await createSession({ user_id: "src_user", username: "src_user", role: "CLINICIAN" });
    return `${SESSION_COOKIE}=${token}; ${CSRF_COOKIE}=${csrf}`;
  }
  const get = (studyId: string, cookie = "") =>
    IMAGE.GET(new NextRequest(new URL(`/api/studies/${studyId}/image`, "http://localhost:3000"), { headers: { cookie } }), { params: { id: studyId } });

  it("serves an available original, reports a missing one explicitly, and requires a session", async () => {
    const bytes = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 120, g: 40, b: 20 } } }).png().toBuffer();
    const study = await createStudy("synthetic-source.png", "image/png", bytes, { scanType: "fundus", eye: "OD", providedBy: "none" });
    created.push(study.study_id);
    const cookie = await clinicianCookies();

    const available = await get(study.study_id, cookie);
    expect(available.status).toBe(200);
    expect(available.headers.get("content-type")).toMatch(/^image\//);

    expect((await get(study.study_id)).status).toBe(401);

    // Simulate a stored original lost from disk (the record remains).
    const dir = path.join(UPLOAD_ROOT, study.study_id);
    for (const file of await fs.readdir(dir)) if (file.startsWith("original")) await fs.rm(path.join(dir, file));
    const missing = await get(study.study_id, cookie);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: SOURCE_MISSING_CODE });
  });
});
