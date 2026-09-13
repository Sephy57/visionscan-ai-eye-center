import type { StructuredClinicalEvidence } from "./structuredClinicalEvidence";
import { persistOnce, recordJobEffect } from "../jobs/effects";
import { sha256Canonical } from "../reports/integrity";

export interface ImmutableStructuredEvidenceRecord {
  evidence_id: string;
  study_id: string;
  analysis_id: string;
  created_at: string;
  evidence: StructuredClinicalEvidence;
  payload_sha256: string;
}

function evidencePayload(evidence: StructuredClinicalEvidence): unknown {
  const { generated_at: _generatedAt, ...stable } = evidence;
  return stable;
}

export function evidencePayloadSha256(evidence: StructuredClinicalEvidence): string {
  return sha256Canonical(evidencePayload(evidence));
}

export function evidenceRecordIdFor(studyId: string, evidence: StructuredClinicalEvidence): string {
  const safeStudy = studyId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
  return `evidence_${safeStudy}_${evidencePayloadSha256(evidence).slice(0, 24)}`;
}

export async function persistStructuredEvidence(input: {
  study_id: string;
  analysis_id: string;
  evidence: StructuredClinicalEvidence;
  job_id?: string;
  attempt_id?: string;
}): Promise<ImmutableStructuredEvidenceRecord> {
  if (input.evidence.study_id !== input.study_id) throw new Error("Structured evidence study scope mismatch");
  const payloadHash = evidencePayloadSha256(input.evidence);
  const record: ImmutableStructuredEvidenceRecord = {
    evidence_id: evidenceRecordIdFor(input.study_id, input.evidence),
    study_id: input.study_id,
    analysis_id: input.analysis_id,
    created_at: new Date().toISOString(),
    evidence: structuredClone(input.evidence),
    payload_sha256: payloadHash,
  };
  const committed = await persistOnce(
    "evidence",
    record.evidence_id,
    record,
    (candidate: ImmutableStructuredEvidenceRecord) => sha256Canonical({
      study_id: candidate.study_id,
      analysis_id: candidate.analysis_id,
      evidence: evidencePayload(candidate.evidence),
      payload_sha256: candidate.payload_sha256,
    }),
  );
  await recordJobEffect({
    effect_type: "STRUCTURED_EVIDENCE",
    idempotency_key: record.evidence_id,
    canonical_id: record.evidence_id,
    payload: { study_id: record.study_id, analysis_id: record.analysis_id, payload_sha256: record.payload_sha256 },
    study_id: record.study_id,
    job_id: input.job_id,
    attempt_id: input.attempt_id,
    note: "Structured evidence snapshot is append-only; a retry reuses the same evidence id.",
  });
  return committed;
}
