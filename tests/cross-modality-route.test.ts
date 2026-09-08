import { afterAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { createSession, SESSION_COOKIE } from "@/lib/auth/sessions";
import { ensurePatient, createEncounter } from "@/lib/patients/service";
import { createStudy, deleteStudy } from "@/lib/studies/service";
import { dbDelete, dbPut } from "@/lib/storage/db";
import type { DeviceMetadata } from "@/lib/devices/adapter";
import type { StoredEncounter } from "@/lib/patients/service";

const route = (await import("@/app/api/encounters/[id]/cross-modality/route")) as typeof import("@/app/api/encounters/[id]/cross-modality/route");
const META: DeviceMetadata = { scanType: "unknown", eye: "unknown", providedBy: "none" };
const cleanupStudies: string[] = [];
const cleanupPatients: string[] = [];
const cleanupEncounters: string[] = [];

function req(url: string, token?: string) {
  return new NextRequest(new URL(url, "http://localhost:3000"), token ? { headers: { cookie: `${SESSION_COOKIE}=${token}` } } : undefined);
}

describe("GET /api/encounters/:id/cross-modality", () => {
  it("requires authentication and a review role", async () => {
    const missing = await route.GET(req("/api/encounters/enc_missing/cross-modality"), { params: { id: "enc_missing" } });
    expect(missing.status).toBe(401);
    const { token } = await createSession({ user_id: "xmod-route-tech", username: "xmod-route-tech", role: "TECHNICIAN" });
    const denied = await route.GET(req("/api/encounters/enc_missing/cross-modality", token), { params: { id: "enc_missing" } });
    expect(denied.status).toBe(403);
  });

  it("returns a read-only, explicit empty assessment for an authorized encounter", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const patient = await ensurePatient(`XMOD-ROUTE-${suffix}`, "xmod-route", "CLINICIAN_CREATED", null, {
      tenant_id: "tenant-xmod-route", owner_user_id: "xmod-route-user", owner_username: "xmod-route",
    });
    cleanupPatients.push(patient.patient_id);
    const encounter = await createEncounter({ patient_id: patient.patient_id, created_by: "xmod-route", linked_study_ids: [] });
    expect(encounter.ok).toBe(true);
    const encounterId = (encounter.encounter as StoredEncounter).encounter_id;
    cleanupEncounters.push(encounterId);
    const { token } = await createSession({ user_id: "xmod-route-user", username: "xmod-route", role: "CLINICIAN", tenant_id: "tenant-xmod-route" });
    const response = await route.GET(req(`/api/encounters/${encounterId}/cross-modality`, token), { params: { id: encounterId } });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.schema_version).toBe("1");
    expect(body.pairs).toEqual([]);
    expect(body.notes.join(" ")).toMatch(/no same-eye/i);
    expect(body.notice).toMatch(/no score fusion/i);
  });

  it("refuses a legacy encounter whose linked study belongs to another patient", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const patientA = await ensurePatient(`XMOD-A-${suffix}`, "xmod-a", "CLINICIAN_CREATED", null, {
      tenant_id: "tenant-xmod-route-idor", owner_user_id: "xmod-a-user", owner_username: "xmod-a",
    });
    const patientB = await ensurePatient(`XMOD-B-${suffix}`, "xmod-b", "CLINICIAN_CREATED", null, {
      tenant_id: "tenant-xmod-route-idor", owner_user_id: "xmod-b-user", owner_username: "xmod-b",
    });
    cleanupPatients.push(patientA.patient_id, patientB.patient_id);
    const studyB = await createStudy("xmod-route-b.png", "image/png", Buffer.from("not-medical"), META, patientB.patient_ref, "xmod-b", false, {
      tenant_id: "tenant-xmod-route-idor", owner_user_id: "xmod-b-user", owner_username: "xmod-b",
    });
    cleanupStudies.push(studyB.study_id);
    const encounterId = `enc_xmod_legacy_${suffix}`;
    const now = new Date().toISOString();
    const legacy: StoredEncounter = {
      encounter_id: encounterId,
      patient_id: patientA.patient_id,
      patient_ref: patientA.patient_ref,
      created_at: now,
      updated_at: now,
      symptoms: [], ocular_history: [], ocular_surgery_history: [], systemic_history: null,
      family_history: null, medications: [], allergies: [], contact_lens_use: null,
      smoking_status: null, linked_study_ids: [studyB.study_id], created_by: "xmod-a",
    };
    await dbPut("encounters", encounterId, legacy);
    cleanupEncounters.push(encounterId);
    const { token } = await createSession({ user_id: "xmod-a-user", username: "xmod-a", role: "CLINICIAN", tenant_id: "tenant-xmod-route-idor" });
    const response = await route.GET(req(`/api/encounters/${encounterId}/cross-modality`, token), { params: { id: encounterId } });
    expect(response.status).toBe(404);
  });
});

afterAll(async () => {
  for (const id of cleanupEncounters) await dbDelete("encounters", id).catch(() => false);
  for (const id of cleanupStudies) await deleteStudy(id).catch(() => {});
  for (const id of cleanupPatients) await dbDelete("patients", id).catch(() => false);
});

