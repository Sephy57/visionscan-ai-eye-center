import { NextRequest, NextResponse } from "next/server";
import { dbAll, dbGet, dbPut } from "../storage/db";
import { newId } from "../storage/files";
import { audit } from "../audit";
import { AuthedRequest, requireSession } from "./rbac";

/**
 * Patient/tenant authorization primitives.
 *
 * RBAC answers "may this role use this kind of endpoint?".  This module
 * answers the second, independent question: "may this authenticated
 * principal use this particular record?".  Resource routes call these
 * helpers after their role check and before reading bytes or clinical data.
 *
 * Existing local-development records created before scoped ownership was
 * introduced may have no patient, tenant, or owner metadata.  That legacy
 * compatibility path is restricted to isolated tests or an explicit,
 * non-production opt-in. Any patient-bound or tenant-bound record is
 * fail-closed: it requires an owner match, an active access grant, or ADMIN
 * access.
 */

export interface ScopedPrincipal extends AuthedRequest {
  tenant_id?: string | null;
}

export interface ScopedResource {
  tenant_id?: string | null;
  owner_user_id?: string | null;
  owner_username?: string | null;
  created_by_user_id?: string | null;
  created_by?: string | null;
  uploaded_by?: string | null;
  patient_id?: string | null;
  patient_ref?: string | null;
}

export interface PatientAccessGrant {
  access_id: string;
  user_id: string;
  tenant_id: string | null;
  patient_id: string | null;
  patient_ref: string | null;
  granted_by: string;
  created_at: string;
  revoked_at: string | null;
}

interface PatientScopeRecord extends ScopedResource {
  patient_id?: string | null;
  patient_ref?: string | null;
}

// Resource rows are intentionally generic at the scope boundary, but some
// child resources carry links used to resolve their owning study/document.
// Keep those links optional so callers can retain their concrete row type
// without weakening the patient/tenant checks or relying on unchecked casts.
interface LinkedPatientScopeRecord extends PatientScopeRecord {
  study_id?: string | null;
  document_id?: string | null;
}

function normalizeRef(value: string | null | undefined): string | null {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return normalized || null;
}

function normalizeTenant(value: string | null | undefined): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
}

function isActiveGrant(grant: PatientAccessGrant): boolean {
  return !grant.revoked_at;
}

function allowLegacyUnscoped(): boolean {
  if (process.env.VISIONSCAN_TEST_ISOLATED === "1") return true;
  return process.env.VISIONSCAN_ALLOW_LEGACY_UNSCOPED === "true" && process.env.NODE_ENV !== "production";
}

/**
 * Add a patient, patient-reference, or tenant grant to a user.  A grant is
 * additive and auditable; revocation never mutates the original grant.
 */
export async function grantPatientAccess(params: {
  user_id: string;
  tenant_id?: string | null;
  patient_id?: string | null;
  patient_ref?: string | null;
  granted_by: string;
}): Promise<PatientAccessGrant | null> {
  const tenantId = normalizeTenant(params.tenant_id);
  const patientId = params.patient_id?.trim() || null;
  const patientRef = normalizeRef(params.patient_ref);
  if (!tenantId && !patientId && !patientRef) return null;

  // Refuse a grant for a patient id that does not exist.  A patient_ref-only
  // grant is allowed for provisioning workflows where the identifier is
  // known before the first record is created.
  if (patientId) {
    const patient = await dbGet<PatientScopeRecord>("patients", patientId);
    if (!patient) return null;
    const patientTenant = normalizeTenant(patient.tenant_id);
    if (tenantId && patientTenant && tenantId !== patientTenant) return null;
    if (patientRef && patient.patient_ref && patientRef !== normalizeRef(patient.patient_ref)) return null;
  }

  const existing = (await dbAll<PatientAccessGrant>("access_grants"))
    .find((grant) =>
      isActiveGrant(grant) &&
      grant.user_id === params.user_id &&
      normalizeTenant(grant.tenant_id) === tenantId &&
      (grant.patient_id ?? null) === patientId &&
      normalizeRef(grant.patient_ref) === patientRef
    );
  if (existing) return existing;

  const grant: PatientAccessGrant = {
    access_id: newId("access"),
    user_id: params.user_id,
    tenant_id: tenantId,
    patient_id: patientId,
    patient_ref: patientRef,
    granted_by: params.granted_by,
    created_at: new Date().toISOString(),
    revoked_at: null,
  };
  await dbPut("access_grants", grant.access_id, grant);
  await audit({
    actor: params.granted_by,
    action: "authz.patient_access_granted",
    resource: "access_grant",
    resourceId: grant.access_id,
    outcome: "ok",
    detail: `user_id=${grant.user_id} tenant_id=${grant.tenant_id ?? ""} patient_id=${grant.patient_id ?? ""} patient_ref=${grant.patient_ref ?? ""}`,
  });
  return grant;
}

/** Revoke a grant by appending its revocation timestamp. */
export async function revokePatientAccess(accessId: string, revokedBy: string): Promise<boolean> {
  const grant = await dbGet<PatientAccessGrant>("access_grants", accessId);
  if (!grant) return false;
  if (!grant.revoked_at) {
    grant.revoked_at = new Date().toISOString();
    await dbPut("access_grants", accessId, grant);
    await audit({
      actor: revokedBy,
      action: "authz.patient_access_revoked",
      resource: "access_grant",
      resourceId: accessId,
      outcome: "ok",
      detail: `user_id=${grant.user_id}`,
    });
  }
  return true;
}

export async function listPatientAccessGrants(filters?: {
  user_id?: string;
  patient_id?: string;
  include_revoked?: boolean;
}): Promise<PatientAccessGrant[]> {
  const all = await dbAll<PatientAccessGrant>("access_grants");
  return all.filter((grant) =>
    (filters?.include_revoked || isActiveGrant(grant)) &&
    (!filters?.user_id || grant.user_id === filters.user_id) &&
    (!filters?.patient_id || grant.patient_id === filters.patient_id)
  );
}

/**
 * Returns true only when the principal may access a scoped resource.  This
 * function deliberately does not infer access from a guessed patient_ref.
 */
export async function hasPatientScope(user: ScopedPrincipal, resource: PatientScopeRecord): Promise<boolean> {
  if (user.role === "ADMIN") return true;

  const directPatient = resource.patient_id
    ? await dbGet<PatientScopeRecord>("patients", resource.patient_id)
    : null;
  const resourceRef = normalizeRef(resource.patient_ref ?? directPatient?.patient_ref);
  const patient = directPatient ?? (resourceRef
    ? (await dbAll<PatientScopeRecord>("patients")).find((candidate) => normalizeRef(candidate.patient_ref) === resourceRef) ?? null
    : null);

  // Patient metadata is authoritative when a study/document only carries a
  // copied patient_ref.  Resource metadata can still add owner provenance
  // (for example, the uploader who created a study).
  const tenantId = normalizeTenant(resource.tenant_id ?? patient?.tenant_id);
  const ownerUserId = resource.owner_user_id ?? resource.created_by_user_id ?? patient?.owner_user_id ?? patient?.created_by_user_id;
  // A document's uploader is not automatically the patient's owner (and a
  // technician may upload on behalf of a care team).  Child resources are
  // authorized through their owning study/patient metadata instead.
  const ownerUsername = resource.owner_username ?? resource.created_by ?? patient?.owner_username ?? patient?.created_by;

  // Never permit a principal from one tenant to cross into another tenant.
  // A missing principal tenant cannot satisfy a tenant-bound resource.
  if (tenantId && normalizeTenant(user.tenant_id) !== tenantId) return false;

  if (ownerUserId && ownerUserId === user.user_id) return true;
  if (ownerUsername && ownerUsername === user.username) return true;

  const grants = (await dbAll<PatientAccessGrant>("access_grants"))
    .filter((grant) => isActiveGrant(grant) && grant.user_id === user.user_id);
  for (const grant of grants) {
    const grantTenant = normalizeTenant(grant.tenant_id);
    if (grantTenant && grantTenant !== tenantId) continue;
    if (grantTenant && !tenantId) continue;
    if (grant.patient_id && patient?.patient_id !== grant.patient_id) continue;
    if (grant.patient_ref && resourceRef !== normalizeRef(grant.patient_ref)) continue;
    // Tenant-only grants authorize all resources in that tenant.  A
    // patient-specific grant must match at least one patient key.
    const patientMatches = Boolean(
      (grant.patient_id && patient?.patient_id === grant.patient_id) ||
      (grant.patient_ref && resourceRef === normalizeRef(grant.patient_ref))
    );
    if (!grant.patient_id && !grant.patient_ref && grantTenant && tenantId === grantTenant) return true;
    if (patientMatches) return true;
  }

  // Records with no patient/tenant/owner are pre-scope local development
  // records. Keep this narrow compatibility path only for isolated tests or
  // an explicit non-production opt-in; all patient-bound records above are
  // denied by default.
  const isLegacyUnscoped = !tenantId && !ownerUserId && !ownerUsername && !resourceRef && !patient?.patient_id;
  return isLegacyUnscoped && allowLegacyUnscoped();
}

export interface ScopeResult<T> {
  response: NextResponse | null;
  user: ScopedPrincipal | null;
  resource: T | null;
}

function deniedResponse(user: ScopedPrincipal, resource: string, resourceId: string): NextResponse {
  void audit({
    actor: `user:${user.username}`,
    action: "authz.scope_denied",
    resource,
    resourceId,
    outcome: "rejected",
    detail: `tenant_id=${user.tenant_id ?? ""}`,
  });
  // Return 404 to avoid confirming whether a guessed identifier exists.
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

async function sessionFor(req: NextRequest): Promise<{ response: NextResponse | null; user: ScopedPrincipal | null }> {
  const result = await requireSession(req);
  return { response: result.response, user: result.user };
}

export async function requireStudyScope<T = PatientScopeRecord>(req: NextRequest, studyId: string): Promise<ScopeResult<T>> {
  const session = await sessionFor(req);
  if (session.response || !session.user) return { ...session, resource: null };
  const study = await dbGet<T & PatientScopeRecord>("studies", studyId);
  if (!study) return { response: null, user: session.user, resource: null };
  if (!(await hasPatientScope(session.user, study))) {
    return { response: deniedResponse(session.user, "study", studyId), user: session.user, resource: null };
  }
  return { response: null, user: session.user, resource: study as T };
}

export async function requirePatientScope<T = PatientScopeRecord>(req: NextRequest, patientId: string): Promise<ScopeResult<T>> {
  const session = await sessionFor(req);
  if (session.response || !session.user) return { ...session, resource: null };
  const patient = await dbGet<T & PatientScopeRecord>("patients", patientId);
  if (!patient) return { response: null, user: session.user, resource: null };
  if (!(await hasPatientScope(session.user, patient))) {
    return { response: deniedResponse(session.user, "patient", patientId), user: session.user, resource: null };
  }
  return { response: null, user: session.user, resource: patient as T };
}

export async function requireDocumentScope<T = PatientScopeRecord>(req: NextRequest, documentId: string): Promise<ScopeResult<T>> {
  const session = await sessionFor(req);
  if (session.response || !session.user) return { ...session, resource: null };
  const document = await dbGet<T & LinkedPatientScopeRecord>("documents", documentId);
  if (!document) return { response: null, user: session.user, resource: null };
  const study = document.study_id ? await dbGet<PatientScopeRecord>("studies", document.study_id) : null;
  const scopedResource: PatientScopeRecord = {
    ...(study ?? {}),
    ...document,
    tenant_id: document.tenant_id ?? study?.tenant_id,
    owner_user_id: document.owner_user_id ?? study?.owner_user_id,
    owner_username: document.owner_username ?? study?.owner_username,
    patient_id: document.patient_id ?? study?.patient_id,
    patient_ref: document.patient_ref ?? study?.patient_ref,
  };
  if (!(await hasPatientScope(session.user, scopedResource))) {
    return { response: deniedResponse(session.user, "document", documentId), user: session.user, resource: null };
  }
  return { response: null, user: session.user, resource: document as T };
}

export async function requireResultScope<T = PatientScopeRecord>(req: NextRequest, resultId: string): Promise<ScopeResult<T>> {
  const session = await sessionFor(req);
  if (session.response || !session.user) return { ...session, resource: null };
  const result = await dbGet<T & LinkedPatientScopeRecord>("test_results", resultId);
  if (!result) return { response: null, user: session.user, resource: null };
  const document = result.document_id ? await dbGet<PatientScopeRecord>("documents", result.document_id) : null;
  const study = result.study_id ? await dbGet<PatientScopeRecord>("studies", result.study_id) : null;
  const scopedResource: PatientScopeRecord = {
    ...(study ?? {}),
    ...(document ?? {}),
    ...result,
    tenant_id: result.tenant_id ?? document?.tenant_id ?? study?.tenant_id,
    owner_user_id: result.owner_user_id ?? document?.owner_user_id ?? study?.owner_user_id,
    owner_username: result.owner_username ?? document?.owner_username ?? study?.owner_username,
    patient_id: result.patient_id ?? document?.patient_id ?? study?.patient_id,
    patient_ref: result.patient_ref ?? document?.patient_ref ?? study?.patient_ref,
  };
  if (!(await hasPatientScope(session.user, scopedResource))) {
    return { response: deniedResponse(session.user, "test_result", resultId), user: session.user, resource: null };
  }
  return { response: null, user: session.user, resource: result as T };
}

export async function requireJobScope<T = PatientScopeRecord>(req: NextRequest, jobId: string): Promise<ScopeResult<T>> {
  const session = await sessionFor(req);
  if (session.response || !session.user) return { ...session, resource: null };
  const job = await dbGet<T & LinkedPatientScopeRecord>("jobs", jobId);
  if (!job) return { response: null, user: session.user, resource: null };
  const study = job.study_id ? await dbGet<PatientScopeRecord>("studies", job.study_id) : null;
  const document = job.document_id ? await dbGet<PatientScopeRecord>("documents", job.document_id) : null;
  const scopedResource: PatientScopeRecord = {
    ...(study ?? {}),
    ...(document ?? {}),
    ...job,
    tenant_id: job.tenant_id ?? document?.tenant_id ?? study?.tenant_id,
    owner_user_id: job.owner_user_id ?? document?.owner_user_id ?? study?.owner_user_id,
    owner_username: job.owner_username ?? document?.owner_username ?? study?.owner_username,
    patient_id: job.patient_id ?? document?.patient_id ?? study?.patient_id,
    patient_ref: job.patient_ref ?? document?.patient_ref ?? study?.patient_ref,
  };
  if (!(await hasPatientScope(session.user, scopedResource))) {
    return { response: deniedResponse(session.user, "job", jobId), user: session.user, resource: null };
  }
  return { response: null, user: session.user, resource: job as T };
}

export async function requireStudyPairScope(req: NextRequest, previousStudyId: string, currentStudyId: string): Promise<{ response: NextResponse | null; user: ScopedPrincipal | null }> {
  const first = await requireStudyScope(req, previousStudyId);
  if (first.response || !first.resource || !first.user) return { response: first.response ?? NextResponse.json({ error: "Not found" }, { status: 404 }), user: first.user };
  const second = await requireStudyScope(req, currentStudyId);
  if (second.response || !second.resource) return { response: second.response ?? NextResponse.json({ error: "Not found" }, { status: 404 }), user: first.user };
  // Comparisons across two different patient identities are denied even
  // when the caller has access to both records; a timeline must never merge
  // different patients by accident.
  const firstRef = normalizeRef((first.resource as PatientScopeRecord).patient_ref);
  const secondRef = normalizeRef((second.resource as PatientScopeRecord).patient_ref);
  const firstPatient = (first.resource as PatientScopeRecord).patient_id ?? firstRef;
  const secondPatient = (second.resource as PatientScopeRecord).patient_id ?? secondRef;
  if (firstPatient && secondPatient && firstPatient !== secondPatient) {
    return { response: NextResponse.json({ error: "Studies belong to different patients." }, { status: 409 }), user: first.user };
  }
  // Tenant is an independent boundary from patient identity. Do not allow
  // even an ADMIN or broadly-granted principal to compare a tenant-bound
  // record with another tenant (or with an unscoped legacy record).
  const firstTenant = normalizeTenant((first.resource as PatientScopeRecord).tenant_id);
  const secondTenant = normalizeTenant((second.resource as PatientScopeRecord).tenant_id);
  if (firstTenant !== secondTenant) {
    return { response: NextResponse.json({ error: "Studies belong to different tenants." }, { status: 409 }), user: first.user };
  }
  return { response: null, user: first.user };
}

/** Filter a list endpoint without exposing inaccessible patient-bound rows. */
export async function filterScopedResources<T extends PatientScopeRecord>(user: ScopedPrincipal, resources: T[]): Promise<T[]> {
  const result: T[] = [];
  for (const resource of resources) {
    if (await hasPatientScope(user, resource)) result.push(resource);
  }
  return result;
}

/** Resolve a patient_ref for upload/create flows without granting access. */
export async function canAccessPatientRef(user: ScopedPrincipal, patientRef: string): Promise<boolean> {
  const ref = normalizeRef(patientRef);
  if (!ref) return true;
  const patient = (await dbAll<PatientScopeRecord>("patients")).find((candidate) => normalizeRef(candidate.patient_ref) === ref);
  // Unknown refs can be provisioned by an authorized uploader; the resulting
  // study is owner-bound by the caller before it is persisted.
  return !patient || hasPatientScope(user, patient);
}
