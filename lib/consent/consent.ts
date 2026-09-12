import { dbGet, dbPut, dbAll } from "../storage/db";
import { newId } from "../storage/files";
import { audit } from "../audit";

/**
 * Consent data architecture (Phase 5B).
 *
 * HARD RULE: absence of a record means UNKNOWN, never GRANTED. No clinical
 * workflow in this codebase may assume consent exists - getConsentStatus()
 * returns "UNKNOWN" (not "GRANTED") when nothing has been recorded, and
 * this is enforced by construction (there is no code path that defaults to
 * GRANTED).
 *
 * Processing boundaries call requireGrantedConsent() through
 * lib/consent/policy.ts. Direct library fixtures may still call deterministic
 * functions without a study-level consent record, but HTTP and durable-job
 * entry points must not process a study until their purpose is GRANTED.
 */

export type ConsentPurpose =
  | "screening_analysis" | "research_use" | "data_retention" | "treatment_information"
  | "CLINICAL_RESEARCH_ANALYSIS" | "DOCUMENT_EXTRACTION" | "IMAGE_MODEL_ANALYSIS"
  | "RESEARCH_DATASET_USE" | "EXPORT" | "MODEL_VALIDATION";
export type ConsentType = "explicit" | "implied" | "broad" | "specific";
export type ConsentStatus = "PENDING" | "GRANTED" | "WITHDRAWN" | "EXPIRED";

export interface ConsentRecord {
  consentId: string;
  studyId: string;
  subjectRef: string | null;   // patient reference, if provided - never invented
  purpose: ConsentPurpose;
  consentType: ConsentType;
  status: ConsentStatus;
  version: string;
  timestamp: string;
  actor: string;               // who recorded this (user id or "self-service")
  expiresAt: string | null;
  withdrawnAt: string | null;
  withdrawalReason: string | null;
}

const CONSENT_FORM_VERSION = "1.0.0";

export async function recordConsent(params: {
  studyId: string;
  subjectRef?: string | null;
  purpose: ConsentPurpose;
  consentType: ConsentType;
  status: "PENDING" | "GRANTED";
  actor: string;
  expiresAt?: string | null;
}): Promise<ConsentRecord> {
  const study = await dbGet<{
    study_id: string;
    patient_id?: string | null;
    patient_ref?: string | null;
  }>("studies", params.studyId);
  if (study) {
    const canonicalSubjectRefs = [study.patient_id, study.patient_ref]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map((value) => value.trim().toLowerCase());
    const suppliedSubjectRef = params.subjectRef?.trim().toLowerCase() || null;
    if (suppliedSubjectRef && (!canonicalSubjectRefs.length || !canonicalSubjectRefs.includes(suppliedSubjectRef))) {
      throw new Error("CONSENT_SUBJECT_MISMATCH");
    }
    // Never persist a caller-selected subject reference when the study has a
    // canonical patient link. Prefer the stable patient id, then patient_ref.
    params = {
      ...params,
      subjectRef: study.patient_id?.trim() || study.patient_ref?.trim() || null,
    };
  } else if (params.subjectRef?.trim()) {
    // A subject reference without a study link cannot be verified and must
    // not be accepted as if it were authoritative patient identity.
    throw new Error("CONSENT_SUBJECT_UNBOUND");
  }
  const rec: ConsentRecord = {
    consentId: newId("consent"),
    studyId: params.studyId,
    subjectRef: params.subjectRef ?? null,
    purpose: params.purpose,
    consentType: params.consentType,
    status: params.status,
    version: CONSENT_FORM_VERSION,
    timestamp: new Date().toISOString(),
    actor: params.actor,
    expiresAt: params.expiresAt ?? null,
    withdrawnAt: null,
    withdrawalReason: null,
  };
  await dbPut("consent", rec.consentId, rec);
  await audit({ actor: params.actor, action: "consent.record", studyId: params.studyId, outcome: "ok", detail: `purpose=${params.purpose} status=${params.status}` });
  return rec;
}

export async function withdrawConsent(consentId: string, actor: string, reason: string): Promise<ConsentRecord | null> {
  const rec = await dbGet<ConsentRecord>("consent", consentId);
  if (!rec) return null;
  rec.status = "WITHDRAWN";
  rec.withdrawnAt = new Date().toISOString();
  rec.withdrawalReason = reason.slice(0, 500);
  await dbPut("consent", consentId, rec);
  await audit({ actor, action: "consent.withdraw", studyId: rec.studyId, outcome: "ok", detail: `purpose=${rec.purpose}` });
  return rec;
}

/**
 * Current consent status for a study/purpose. Returns "UNKNOWN" (not a
 * ConsentStatus value, deliberately a distinct type) when no record exists
 * or the most recent record has expired - never silently treated as granted.
 */
export async function getConsentStatus(studyId: string, purpose: ConsentPurpose): Promise<ConsentStatus | "UNKNOWN"> {
  const all = await dbAll<ConsentRecord>("consent");
  const matching = all
    .filter((c) => c.studyId === studyId && c.purpose === purpose)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const latest = matching[0];
  if (!latest) return "UNKNOWN";
  if (latest.status === "WITHDRAWN") return "WITHDRAWN";
  if (latest.expiresAt && new Date(latest.expiresAt).getTime() < Date.now()) return "EXPIRED";
  return latest.status;
}

export async function listConsentForStudy(studyId: string): Promise<ConsentRecord[]> {
  const all = await dbAll<ConsentRecord>("consent");
  return all.filter((c) => c.studyId === studyId).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

/** Low-level hard gate. Processing routes and durable workers call this via
 * lib/consent/policy.ts with a purpose-specific boundary. */
export async function requireGrantedConsent(studyId: string, purpose: ConsentPurpose): Promise<{ ok: boolean; status: ConsentStatus | "UNKNOWN" }> {
  const status = await getConsentStatus(studyId, purpose);
  return { ok: status === "GRANTED", status };
}
