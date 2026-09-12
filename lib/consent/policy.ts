import type { ConsentPurpose, ConsentStatus } from "./consent";
import { requireGrantedConsent } from "./consent";

/**
 * Purpose-specific consent policy for processing boundaries.
 *
 * Uploading a study may create a reviewable draft. Any operation that reads
 * clinical content, runs inference, extracts a document, or creates research
 * output must pass the purpose that authorizes that operation. Consent is
 * checked again in durable-job enqueue paths so a withdrawn record cannot be
 * bypassed by calling a queue helper directly.
 */
export const PROCESSING_CONSENT_PURPOSES = {
  clinicalResearchAnalysis: "CLINICAL_RESEARCH_ANALYSIS",
  documentExtraction: "DOCUMENT_EXTRACTION",
  imageModelAnalysis: "IMAGE_MODEL_ANALYSIS",
  researchDatasetUse: "RESEARCH_DATASET_USE",
  export: "EXPORT",
  modelValidation: "MODEL_VALIDATION",
} as const satisfies Record<string, ConsentPurpose>;

export type ProcessingConsentPurpose = typeof PROCESSING_CONSENT_PURPOSES[keyof typeof PROCESSING_CONSENT_PURPOSES];
export type ConsentGate = {
  ok: boolean;
  status: ConsentStatus | "UNKNOWN";
  purpose: ProcessingConsentPurpose;
};

export async function checkProcessingConsent(studyId: string, purpose: ProcessingConsentPurpose): Promise<ConsentGate> {
  const result = await requireGrantedConsent(studyId, purpose);
  return { ...result, purpose };
}

export function consentRequiredPayload(gate: ConsentGate): {
  error: "CONSENT_REQUIRED";
  purpose: ProcessingConsentPurpose;
  consent_status: ConsentStatus | "UNKNOWN";
  message: string;
} {
  return {
    error: "CONSENT_REQUIRED",
    purpose: gate.purpose,
    consent_status: gate.status,
    message: "A current GRANTED consent record for this processing purpose is required before this operation can proceed.",
  };
}
