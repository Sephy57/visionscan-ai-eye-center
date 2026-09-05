import { afterAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { createSession, SESSION_COOKIE, CSRF_COOKIE } from "@/lib/auth/sessions";
import { createStudy, deleteStudy } from "@/lib/studies/service";
import { ensurePatient } from "@/lib/patients/service";
import { dbDelete } from "@/lib/storage/db";
import { grantPatientAccess, revokePatientAccess } from "@/lib/auth/scope";
import type { DeviceMetadata } from "@/lib/devices/adapter";

/**
 * Patient/tenant IDOR regression coverage.  The fixtures are synthetic and
 * owner-bound at creation; route checks are exercised with real sessions and
 * real NextRequest objects rather than mocking the authorization layer.
 */

const META: DeviceMetadata = { scanType: "unknown", eye: "unknown", providedBy: "none" };
const createdStudyIds: string[] = [];
const createdPatientIds: string[] = [];
const createdGrantIds: string[] = [];

function request(url: string, token: string, method = "GET", csrf?: string, body?: unknown): NextRequest {
  const headers: Record<string, string> = { cookie: `${SESSION_COOKIE}=${token}${csrf ? `; ${CSRF_COOKIE}=${csrf}` : ""}` };
  if (csrf) headers["x-csrf-token"] = csrf;
  if (body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(new URL(url, "http://localhost:3000"), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("patient/tenant-scoped authorization", () => {
  it("denies a same-tenant cross-patient study lookup and permits an explicit grant", async () => {
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const refA = `SCOPE-A-${suffix}`;
    const refB = `SCOPE-B-${suffix}`;
    const patientA = await ensurePatient(refA, "alice", "CLINICIAN_CREATED", null, {
      tenant_id: "tenant-shared", owner_user_id: "scope-alice", owner_username: "alice",
    });
    const patientB = await ensurePatient(refB, "bob", "CLINICIAN_CREATED", null, {
      tenant_id: "tenant-shared", owner_user_id: "scope-bob", owner_username: "bob",
    });
    createdPatientIds.push(patientA.patient_id, patientB.patient_id);

    const studyA = await createStudy("scope-a.png", "image/png", Buffer.from("scope-a"), META, refA, "alice", false, {
      tenant_id: "tenant-shared", owner_user_id: "scope-alice", owner_username: "alice",
    });
    const studyB = await createStudy("scope-b.png", "image/png", Buffer.from("scope-b"), META, refB, "bob", false, {
      tenant_id: "tenant-shared", owner_user_id: "scope-bob", owner_username: "bob",
    });
    createdStudyIds.push(studyA.study_id, studyB.study_id);

    const alice = await createSession({ user_id: "scope-alice", username: "alice", role: "CLINICIAN", tenant_id: "tenant-shared" });
    const route = (await import("@/app/api/studies/[id]/route")) as typeof import("@/app/api/studies/[id]/route");

    const own = await route.GET(request(`/api/studies/${studyA.study_id}`, alice.token), { params: { id: studyA.study_id } });
    expect(own.status).toBe(200);

    // Same tenant is not enough: patient ownership/assignment is required.
    const denied = await route.GET(request(`/api/studies/${studyB.study_id}`, alice.token), { params: { id: studyB.study_id } });
    expect(denied.status).toBe(404);

    const grant = await grantPatientAccess({
      user_id: "scope-alice", tenant_id: "tenant-shared", patient_id: patientB.patient_id, granted_by: "user:admin",
    });
    expect(grant).toBeTruthy();
    createdGrantIds.push(grant!.access_id);
    const allowedAfterGrant = await route.GET(request(`/api/studies/${studyB.study_id}`, alice.token), { params: { id: studyB.study_id } });
    expect(allowedAfterGrant.status).toBe(200);
  }, 30000);

  it("enforces tenant boundaries even when the user id matches an owner", async () => {
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const ref = `SCOPE-T-${suffix}`;
    const patient = await ensurePatient(ref, "tenant-owner", "CLINICIAN_CREATED", null, {
      tenant_id: "tenant-a", owner_user_id: "scope-tenant-owner", owner_username: "tenant-owner",
    });
    createdPatientIds.push(patient.patient_id);
    const study = await createStudy("scope-tenant.png", "image/png", Buffer.from("scope-tenant"), META, ref, "tenant-owner", false, {
      tenant_id: "tenant-a", owner_user_id: "scope-tenant-owner", owner_username: "tenant-owner",
    });
    createdStudyIds.push(study.study_id);

    const wrongTenant = await createSession({ user_id: "scope-tenant-owner", username: "tenant-owner", role: "CLINICIAN", tenant_id: "tenant-b" });
    const route = (await import("@/app/api/studies/[id]/route")) as typeof import("@/app/api/studies/[id]/route");
    const denied = await route.GET(request(`/api/studies/${study.study_id}`, wrongTenant.token), { params: { id: study.study_id } });
    expect(denied.status).toBe(404);
  }, 30000);

  it("filters the patient and study list endpoints by the caller's scope", async () => {
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const refA = `SCOPE-LA-${suffix}`;
    const refB = `SCOPE-LB-${suffix}`;
    const patientA = await ensurePatient(refA, "list-alice", "CLINICIAN_CREATED", null, {
      tenant_id: "tenant-list", owner_user_id: "scope-list-alice", owner_username: "list-alice",
    });
    const patientB = await ensurePatient(refB, "list-bob", "CLINICIAN_CREATED", null, {
      tenant_id: "tenant-list", owner_user_id: "scope-list-bob", owner_username: "list-bob",
    });
    createdPatientIds.push(patientA.patient_id, patientB.patient_id);
    const studyA = await createStudy("scope-list-a.png", "image/png", Buffer.from("list-a"), META, refA, "list-alice", false, {
      tenant_id: "tenant-list", owner_user_id: "scope-list-alice", owner_username: "list-alice",
    });
    const studyB = await createStudy("scope-list-b.png", "image/png", Buffer.from("list-b"), META, refB, "list-bob", false, {
      tenant_id: "tenant-list", owner_user_id: "scope-list-bob", owner_username: "list-bob",
    });
    createdStudyIds.push(studyA.study_id, studyB.study_id);

    const alice = await createSession({ user_id: "scope-list-alice", username: "list-alice", role: "CLINICIAN", tenant_id: "tenant-list" });
    const studiesRoute = (await import("@/app/api/studies/route")) as typeof import("@/app/api/studies/route");
    const patientsRoute = (await import("@/app/api/patients/route")) as typeof import("@/app/api/patients/route");
    const listedStudies = await studiesRoute.GET(request("/api/studies", alice.token));
    const listedPatients = await patientsRoute.GET(request("/api/patients", alice.token));
    expect((await listedStudies.json()).studies.some((row: { study_id: string }) => row.study_id === studyB.study_id)).toBe(false);
    expect((await listedPatients.json()).patients.some((row: { patient_id: string }) => row.patient_id === patientB.patient_id)).toBe(false);
  }, 30000);
});

afterAll(async () => {
  for (const accessId of createdGrantIds) await revokePatientAccess(accessId, "user:scope-test").catch(() => {});
  for (const studyId of createdStudyIds) await deleteStudy(studyId).catch(() => {});
  for (const patientId of createdPatientIds) await dbDelete("patients", patientId).catch(() => false);
});

