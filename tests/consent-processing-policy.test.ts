import { describe, expect, it } from "vitest";
import {
  getConsentStatus,
  recordConsent,
  requireGrantedConsent,
  withdrawConsent,
} from "@/lib/consent/consent";
import {
  checkProcessingConsent,
  PROCESSING_CONSENT_PURPOSES,
} from "@/lib/consent/policy";
import { createStudy, deleteStudy } from "@/lib/studies/service";
import type { DeviceMetadata } from "@/lib/devices/adapter";
import { enqueueAnalysis } from "@/lib/jobs/queue";

const META: DeviceMetadata = { scanType: "unknown", eye: "unknown", providedBy: "none" };

describe("purpose-specific processing consent", () => {
  it("fails closed for missing and wrong-purpose consent", async () => {
    const studyId = `consent-missing-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    expect(await checkProcessingConsent(studyId, PROCESSING_CONSENT_PURPOSES.imageModelAnalysis)).toEqual({
      ok: false,
      status: "UNKNOWN",
      purpose: "IMAGE_MODEL_ANALYSIS",
    });

    await recordConsent({
      studyId,
      purpose: "DOCUMENT_EXTRACTION",
      consentType: "explicit",
      status: "GRANTED",
      actor: "test",
    });
    expect(await requireGrantedConsent(studyId, "IMAGE_MODEL_ANALYSIS")).toEqual({ ok: false, status: "UNKNOWN" });
    expect(await getConsentStatus(studyId, "DOCUMENT_EXTRACTION")).toBe("GRANTED");
    await expect(enqueueAnalysis(studyId)).rejects.toThrow("CONSENT_REQUIRED:IMAGE_MODEL_ANALYSIS:UNKNOWN");
  });

  it("returns WITHDRAWN and EXPIRED rather than treating either state as granted", async () => {
    const withdrawnId = `consent-withdrawn-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const withdrawn = await recordConsent({
      studyId: withdrawnId,
      purpose: "IMAGE_MODEL_ANALYSIS",
      consentType: "explicit",
      status: "GRANTED",
      actor: "test",
    });
    await withdrawConsent(withdrawn.consentId, "test", "withdrawn for policy test");
    expect(await checkProcessingConsent(withdrawnId, "IMAGE_MODEL_ANALYSIS")).toMatchObject({ ok: false, status: "WITHDRAWN" });

    const expiredId = `consent-expired-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await recordConsent({
      studyId: expiredId,
      purpose: "IMAGE_MODEL_ANALYSIS",
      consentType: "explicit",
      status: "GRANTED",
      actor: "test",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(await checkProcessingConsent(expiredId, "IMAGE_MODEL_ANALYSIS")).toMatchObject({ ok: false, status: "EXPIRED" });
  });

  it("binds the stored subject to the study and rejects a mismatched caller reference", async () => {
    const study = await createStudy("consent-subject.png", "image/png", Buffer.from("synthetic-consent-fixture"), META, "CONSENT-SUBJECT-1", "test", true);
    try {
      expect(study.patient_id).toBeTruthy();
      const consent = await recordConsent({
        studyId: study.study_id,
        subjectRef: "consent-subject-1",
        purpose: "CLINICAL_RESEARCH_ANALYSIS",
        consentType: "explicit",
        status: "GRANTED",
        actor: "test",
      });
      expect(consent.subjectRef).toBe(study.patient_id);
      await expect(recordConsent({
        studyId: study.study_id,
        subjectRef: "different-subject",
        purpose: "CLINICAL_RESEARCH_ANALYSIS",
        consentType: "explicit",
        status: "GRANTED",
        actor: "test",
      })).rejects.toThrow("CONSENT_SUBJECT_MISMATCH");
    } finally {
      await deleteStudy(study.study_id);
    }
  });
});
