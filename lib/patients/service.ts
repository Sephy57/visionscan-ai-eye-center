import { dbGet, dbPut, dbAll, dbDelete, dbPage, type DbPageOptions, type DbPageResult } from "../storage/db";
import { newId } from "../storage/files";
import { audit } from "../audit";
import {
  DataProvenance,
  PatientEncounter,
  validateEncounterInput,
  OcularHistoryEntry,
  MedicationEntry,
  Allergy,
  SystemicHistory,
} from "./encounter";
import { PatientSymptom, validateSymptoms } from "../clinical/symptoms";
import type { StudyRecord } from "../studies/service";

/**
 * Patient & encounter persistence (eye-center workspace).
 *
 * HARD RULES (unchanged from lib/patients/encounter.ts):
 *  - patient_ref is USER-SUPPLIED and never invented here. A PatientRecord
 *    exists only for a real identifier a clinician/user provided (or one
 *    auto-provisioned from a study's existing patient_ref - still
 *    user-supplied data, just copied from the study).
 *  - This service stores structured facts and links only. It computes
 *    NOTHING clinical: no diagnosis, no risk, no treatment decision.
 *  - Every provenanced field keeps the provenance it was created with.
 *    AI-derived data can never silently become VERIFIED_BY_CLINICIAN.
 *  - Corrections append annotations; original evidence is never mutated
 *    (same rule as documents/extraction).
 *  - Nothing here is exposed without role checks at the API layer.
 */

export interface PatientRecord {
  patient_id: string;          // internal id (pat_...)
  patient_ref: string;         // user-supplied identifier, unique, 1-64 chars
  display_label?: string | null; // optional short label; never required, never inferred
  created_by: string;          // username that created the record
  /** Optional scope metadata. Missing values are retained for legacy fixtures. */
  tenant_id?: string | null;
  owner_user_id?: string | null;
  owner_username?: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * A persisted encounter. PatientEncounter (the validated model) is extended
 * with the internal patient link + creator; everything else is untouched.
 */
export interface StoredEncounter extends PatientEncounter {
  patient_id: string;
  tenant_id?: string | null;
  created_by: string;
}

export interface EncounterCreateInput {
  patient_id: string;
  chief_complaint?: string | null;
  symptoms?: PatientSymptom[];
  ocular_history?: Array<{ value: OcularHistoryEntry; provenance: string }>;
  ocular_surgery_history?: Array<{ value: OcularHistoryEntry; provenance: string }>;
  medications?: Array<{ value: MedicationEntry; provenance: string }>;
  allergies?: Array<{ value: Allergy; provenance: string }>;
  systemic_history?: { value: Partial<SystemicHistory>; provenance: string } | null;
  linked_study_ids?: string[];
  created_by: string;
}

export interface EncounterOperationResult {
  ok: boolean;
  status: number;
  encounter?: PatientEncounter;
  errors?: Array<{ field: string; message: string }>;
  error?: string;
}

const PATIENT_REF_MAX = 64;

export interface PatientScopeMetadata {
  tenant_id?: string | null;
  owner_user_id?: string | null;
  owner_username?: string | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Idempotent: returns the existing patient record for patient_ref when one
 * exists (never creates a duplicate). Provisioned records are marked as
 * PROVISIONED origin so the workspace can show where the identifier came
 * from; a clinician-created record is CLINICIAN_CREATED.
 */
export async function ensurePatient(
  patientRef: string,
  createdBy: string,
  origin: "PROVISIONED_FROM_STUDY" | "CLINICIAN_CREATED",
  displayLabel?: string | null,
  scope?: PatientScopeMetadata
): Promise<PatientRecord> {
  const ref = patientRef.trim().slice(0, PATIENT_REF_MAX);
  // Patient references are scoped to a tenant when one is supplied. Without
  // this boundary, the same user-supplied reference in two organizations
  // could accidentally return the first organization's patient record.
  const existing = await findPatientByRef(ref, scope);
  if (existing) return existing;

  const record: PatientRecord = {
    patient_id: newId("pat"),
    patient_ref: ref,
    display_label: displayLabel?.trim() ? displayLabel.trim().slice(0, 120) : null,
    created_by: createdBy,
    tenant_id: scope?.tenant_id ?? null,
    owner_user_id: scope?.owner_user_id ?? null,
    owner_username: scope?.owner_username ?? createdBy,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  await dbPut("patients", record.patient_id, record);
  await audit({
    actor: createdBy,
    action: "patient.created",
    resource: "patient",
    resourceId: record.patient_id,
    outcome: "ok",
    detail: `origin=${origin}`,
  });
  return record;
}

export async function findPatientByRef(patientRef: string, scope?: Pick<PatientScopeMetadata, "tenant_id">): Promise<PatientRecord | null> {
  const ref = patientRef.trim().toLowerCase();
  if (!ref) return null;
  const all = await dbAll<PatientRecord>("patients");
  const requestedTenant = scope === undefined ? undefined : (scope.tenant_id?.trim() || null);
  return all.find((p) => {
    if (p.patient_ref.toLowerCase() !== ref) return false;
    if (requestedTenant === undefined) return true;
    return (p.tenant_id?.trim() || null) === requestedTenant;
  }) ?? null;
}

export async function getPatient(patientId: string): Promise<PatientRecord | null> {
  return dbGet<PatientRecord>("patients", patientId);
}

export interface PatientSummary {
  patient_id: string;
  patient_ref: string;
  display_label?: string | null;
  tenant_id?: string | null;
  owner_user_id?: string | null;
  owner_username?: string | null;
  created_at: string;
  encounter_count: number;
  study_count: number;
}

export interface PatientListPageOptions {
  query?: string;
  limit?: number;
  cursor?: string;
}

/**
 * Bounded patient registry page. Search is applied in the persistence layer's
 * keyset scanner, so a sparse query does not silently return only the first
 * storage page. Encounter counts are still derived from authoritative rows;
 * no patient data is copied into the page cursor.
 */
export async function listPatientsPage(options: PatientListPageOptions = {}): Promise<DbPageResult<PatientSummary>> {
  const q = options.query?.trim().toLowerCase();
  const page = await dbPage<PatientRecord>("patients", {
    limit: options.limit,
    cursor: options.cursor,
    direction: "desc",
    predicate: q
      ? (patient) => String(patient.patient_ref ?? "").toLowerCase().includes(q) || String(patient.display_label ?? "").toLowerCase().includes(q)
      : undefined,
  });
  const encounters = await dbAll<StoredEncounter>("encounters");
  const summaries = page.items.map((p) => {
    const pEncounters = encounters.filter((e) => e.patient_id === p.patient_id);
    const studyIds = new Set<string>();
    pEncounters.forEach((e) => (e.linked_study_ids ?? []).forEach((s) => studyIds.add(s)));
    return {
      patient_id: p.patient_id,
      patient_ref: p.patient_ref,
      display_label: p.display_label,
      tenant_id: p.tenant_id ?? null,
      owner_user_id: p.owner_user_id ?? null,
      owner_username: p.owner_username ?? null,
      created_at: p.created_at,
      encounter_count: pEncounters.length,
      study_count: studyIds.size,
    } satisfies PatientSummary;
  });
  return { ...page, items: summaries };
}

export async function listPatients(query?: string): Promise<PatientSummary[]> {
  const patients = await dbAll<PatientRecord>("patients");
  const encounters = await dbAll<StoredEncounter>("encounters");
  const q = query?.trim().toLowerCase();

  const summaries = await Promise.all(
    patients.map(async (p) => {
      const pEncounters = encounters.filter((e) => e.patient_id === p.patient_id);
      const studyIds = new Set<string>();
      pEncounters.forEach((e) => (e.linked_study_ids ?? []).forEach((s) => studyIds.add(s)));
      return {
        patient_id: p.patient_id,
        patient_ref: p.patient_ref,
        display_label: p.display_label,
        tenant_id: p.tenant_id ?? null,
        owner_user_id: p.owner_user_id ?? null,
        owner_username: p.owner_username ?? null,
        created_at: p.created_at,
        encounter_count: pEncounters.length,
        study_count: studyIds.size,
      };
    })
  );

  const filtered = q
    ? summaries.filter(
        (s) =>
          s.patient_ref.toLowerCase().includes(q) ||
          (s.display_label ?? "").toLowerCase().includes(q)
      )
    : summaries;
  return filtered.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/**
 * Validates + persists a new encounter. Fail-closed: invalid input is
 * rejected with per-field errors; nothing is partially written.
 */
export async function createEncounter(input: EncounterCreateInput): Promise<EncounterOperationResult> {
  const patient = await getPatient(input.patient_id);
  if (!patient) {
    return { ok: false, status: 404, error: "PATIENT_NOT_FOUND" };
  }

  if (input.symptoms !== undefined) {
    const symptomCheck = validateSymptoms(input.symptoms ?? []);
    if (!symptomCheck.valid) {
      return {
        ok: false,
        status: 400,
        errors: symptomCheck.errors.map((e) => ({ field: `symptoms[${e.index}].${e.field}`, message: e.message })),
      };
    }
  }

  const encounterInput = {
    chief_complaint: input.chief_complaint,
    ocular_history: input.ocular_history,
    ocular_surgery_history: input.ocular_surgery_history,
    medications: input.medications,
    allergies: input.allergies,
    systemic_history: input.systemic_history,
  };
  const validation = validateEncounterInput(encounterInput);
  if (!validation.valid) {
    return { ok: false, status: 400, errors: validation.errors };
  }

  // Linked studies must exist and must carry the same patient_ref (or no
  // patient_ref at all). A study with a DIFFERENT patient_ref is refused -
  // cross-patient linking is never silently allowed.
  const linkedIds = [...new Set((input.linked_study_ids ?? []).filter(Boolean))];
  for (const sid of linkedIds) {
    const study = await dbGet<StudyRecord>("studies", sid);
    if (!study) return { ok: false, status: 400, error: `LINKED_STUDY_NOT_FOUND:${sid}` };
    if (patient.tenant_id && study.tenant_id && patient.tenant_id !== study.tenant_id) {
      return { ok: false, status: 409, error: `LINKED_STUDY_TENANT_MISMATCH:${sid}` };
    }
    if (study.patient_ref && study.patient_ref.toLowerCase() !== patient.patient_ref.toLowerCase()) {
      return { ok: false, status: 409, error: `LINKED_STUDY_PATIENT_MISMATCH:${sid}` };
    }
  }

  const ts = nowIso();
  const encounter: StoredEncounter = {
    patient_id: patient.patient_id,
    tenant_id: patient.tenant_id ?? null,
    created_by: input.created_by,
    encounter_id: newId("enc"),
    patient_ref: patient.patient_ref,
    created_at: ts,
    updated_at: ts,
    chief_complaint: input.chief_complaint ?? null,
    symptoms: input.symptoms ?? [],
    ocular_history: (input.ocular_history ?? []).map((e) => ({
      value: e.value,
      provenance: e.provenance as DataProvenance,
      recorded_at: ts,
      recorded_by: input.created_by,
    })),
    ocular_surgery_history: (input.ocular_surgery_history ?? []).map((e) => ({
      value: e.value,
      provenance: e.provenance as DataProvenance,
      recorded_at: ts,
      recorded_by: input.created_by,
    })),
    systemic_history: input.systemic_history
      ? { value: input.systemic_history.value as SystemicHistory, provenance: input.systemic_history.provenance as DataProvenance, recorded_at: ts, recorded_by: input.created_by }
      : null,
    medications: (input.medications ?? []).map((e) => ({
      value: e.value,
      provenance: e.provenance as DataProvenance,
      recorded_at: ts,
      recorded_by: input.created_by,
    })),
    allergies: (input.allergies ?? []).map((e) => ({
      value: e.value,
      provenance: e.provenance as DataProvenance,
      recorded_at: ts,
      recorded_by: input.created_by,
    })),
    family_history: null,
    contact_lens_use: null,
    smoking_status: null,
    linked_study_ids: linkedIds,
  };

  await dbPut("encounters", encounter.encounter_id, encounter);
  await audit({
    actor: input.created_by,
    action: "encounter.created",
    resource: "encounter",
    resourceId: encounter.encounter_id,
    outcome: "ok",
    detail: `patient_id=${patient.patient_id} linked_studies=${linkedIds.length}`,
  });
  return { ok: true, status: 201, encounter };
}

export async function getEncounter(encounterId: string): Promise<PatientEncounter | null> {
  return dbGet<PatientEncounter>("encounters", encounterId);
}

export async function listEncountersForPatient(patientId: string): Promise<StoredEncounter[]> {
  const all = await dbAll<StoredEncounter>("encounters");
  return all
    .filter((e) => e.patient_id === patientId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export interface PatientProfile {
  patient: PatientRecord;
  encounters: StoredEncounter[];
}

export async function getPatientProfile(patientId: string): Promise<PatientProfile | null> {
  const patient = await getPatient(patientId);
  if (!patient) return null;
  const encounters = await listEncountersForPatient(patientId);
  return { patient, encounters };
}

export async function deletePatientRecord(patientId: string, actor: string): Promise<boolean> {
  const patient = await getPatient(patientId);
  if (!patient) return false;
  // Hard-deletes are not offered for clinical data; only a logical marker.
  const updated: PatientRecord = { ...patient, display_label: patient.display_label, updated_at: nowIso() };
  await dbPut("patients", patientId, { ...updated, deleted: true } as PatientRecord & { deleted: boolean });
  await audit({ actor, action: "patient.delete_marked", resource: "patient", resourceId: patientId, outcome: "ok" });
  return true;
}

export async function deleteEncounter(encounterId: string, actor: string): Promise<boolean> {
  return dbDelete("encounters", encounterId).then(async (ok) => {
    if (ok)
      await audit({ actor, action: "encounter.deleted", resource: "encounter", resourceId: encounterId, outcome: "ok" });
    return ok;
  });
}
