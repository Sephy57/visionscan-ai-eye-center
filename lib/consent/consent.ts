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
 * This module is currently additive/observational: it is NOT wired as a
 * hard gate in front of analysis (see docs/CONSENT_DATA_GOVERNANCE.md for
 * why - deliberately deferred so this phase does not silently change the
 * existing, already-reviewed clinical safety pipeline). A deployment that
 * needs consent to hard-block analysis should call requireGrantedConsent()
 * at its chosen policy point.
 */

export type ConsentPurpose = "screening_analysis" | "research_use" | "data_retention" | "treatment_information";
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

/** Optional hard gate a deployment can call at its chosen policy point. Not wired into the pipeline by default. */
export async function requireGrantedConsent(studyId: string, purpose: ConsentPurpose): Promise<{ ok: boolean; status: ConsentStatus | "UNKNOWN" }> {
  const status = await getConsentStatus(studyId, purpose);
  return { ok: status === "GRANTED", status };
}
