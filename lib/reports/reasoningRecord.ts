import type { AnalysisResult } from "../analysis/schema";
import type { StructuredClinicalEvidence } from "../evidence/structuredClinicalEvidence";
import { EVIDENCE_TAXONOMY_VERSION } from "../evidence/conditionTaxonomy";
import type { StructuredReasoningResult } from "../models/reasoningEngine";
import { REASONING_ENGINE_VERSION } from "../models/reasoningEngine";
import type { SpecialistConsensus } from "../clinical/specialistConsensus";
import type { SpecialistEvidencePackage } from "../clinical/specialistPackages";
import type { SpecialistEvidenceBundle } from "../evidence/structuredClinicalEvidence";
import { OPHTHALMIC_COVERAGE_VERSION } from "../models/ophthalmicCoverage";
import { dbGet } from "../storage/db";
import { persistOnce, recordJobEffect } from "../jobs/effects";
import { REPORT_VERSION } from "./generator";
import { REASONING_RECORD_SCHEMA_VERSION, sha256Canonical } from "./integrity";
import { SPECIALIST_PACKAGE_VERSION } from "../clinical/specialistPackages";
import { VALIDATION_REGISTRY_VERSION } from "../models/validationRegistry";

export { REASONING_RECORD_SCHEMA_VERSION } from "./integrity";

export interface ImmutableReasoningRecord {
  reasoning_record_id: string;
  report_id: string;
  study_id: string;
  analysis_id?: string;
  created_at: string;
  record_schema_version: typeof REASONING_RECORD_SCHEMA_VERSION;
  source_analysis_sha256: string;
  version_freeze: {
    report_version: string;
    pipeline_version: string;
    pipeline_ruleset_version: string;
    evidence_taxonomy_version: string;
    condition_knowledge_version: string;
    specialist_rules_version: string;
    validation_registry_version: string;
    reasoning_engine_version: string;
    coverage_registry_version: string;
  };
  /** Self-contained evidence snapshot so every persisted reasoning reference
   * remains resolvable even if a later analysis/review is generated. */
  evidence_snapshot: StructuredClinicalEvidence["evidence"];
  evidence_conflicts: StructuredClinicalEvidence["conflicts"];
  condition_assessments: StructuredClinicalEvidence["possible_conditions"];
  specialist_consensus: SpecialistConsensus | null;
  specialist_bundles: SpecialistEvidenceBundle[];
  specialist_packages: SpecialistEvidencePackage[];
  reasoning: StructuredReasoningResult;
  payload_sha256: string;
}

type UnsignedReasoningRecord = Omit<ImmutableReasoningRecord, "payload_sha256">;

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function sourceAnalysisSha256(analysis: AnalysisResult): string {
  return sha256Canonical(analysis);
}

export function reasoningRecordIdFor(studyId: string, analysis: AnalysisResult): string {
  const safeStudy = studyId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
  return `reason_${safeStudy}_${sourceAnalysisSha256(analysis).slice(0, 24)}`;
}

function sign(record: UnsignedReasoningRecord): ImmutableReasoningRecord {
  return { ...record, payload_sha256: sha256Canonical(record) };
}

/** Build a deterministic-but-distinct id for an explicit replay. The source
 * analysis hash remains part of the signed record so replay cannot spoof new
 * evidence; the nonce only separates historical report versions. */
export function replayReasoningRecordId(sourceRecordId: string, replayNonce: string): string {
  const safeNonce = replayNonce.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48);
  return `${sourceRecordId}_replay_${safeNonce}`;
}

export function verifyReasoningRecord(record: ImmutableReasoningRecord): {
  ok: boolean;
  reason?: "PAYLOAD_HASH_MISMATCH" | "VERSION_FREEZE_MISMATCH" | "STUDY_SCOPE_MISMATCH";
} {
  const { payload_sha256, ...unsigned } = record;
  if (sha256Canonical(unsigned) !== payload_sha256) return { ok: false, reason: "PAYLOAD_HASH_MISMATCH" };
  if (
    record.reasoning.study_id !== record.study_id ||
    record.evidence_snapshot.some((item) => item.study_id !== record.study_id)
  ) return { ok: false, reason: "STUDY_SCOPE_MISMATCH" };
  if (
    record.record_schema_version !== REASONING_RECORD_SCHEMA_VERSION ||
    record.reasoning.engine_version !== record.version_freeze.reasoning_engine_version ||
    record.reasoning.rule_set_version !== record.version_freeze.evidence_taxonomy_version ||
    record.version_freeze.condition_knowledge_version !== record.version_freeze.evidence_taxonomy_version ||
    record.version_freeze.specialist_rules_version !== SPECIALIST_PACKAGE_VERSION ||
    record.version_freeze.validation_registry_version !== VALIDATION_REGISTRY_VERSION
  ) return { ok: false, reason: "VERSION_FREEZE_MISMATCH" };
  return { ok: true };
}

export async function getReasoningRecord(recordId: string): Promise<ImmutableReasoningRecord | null> {
  const record = await dbGet<ImmutableReasoningRecord>("reasoning_records", recordId);
  if (!record) return null;
  const verified = verifyReasoningRecord(record);
  if (!verified.ok) throw new Error(`Reasoning record integrity check failed: ${verified.reason}`);
  return clone(record);
}

export async function getReasoningRecordForAnalysis(
  studyId: string,
  analysis: AnalysisResult,
): Promise<ImmutableReasoningRecord | null> {
  return getReasoningRecord(reasoningRecordIdFor(studyId, analysis));
}

/**
 * Insert-once persistence. A repeated request for the same analysis returns
 * the already-sealed record; it can never overwrite a historical snapshot.
 */
let reasoningWriteChain: Promise<void> = Promise.resolve();

async function persistReasoningRecordUnlocked(input: {
  report_id: string;
  analysis: AnalysisResult;
  evidence: StructuredClinicalEvidence;
  reasoning: StructuredReasoningResult;
  reasoning_record_id?: string;
  analysis_id?: string;
  job_id?: string;
  attempt_id?: string;
}): Promise<ImmutableReasoningRecord> {
  const studyId = input.analysis.study.study_id;
  if (input.evidence.study_id !== studyId || input.reasoning.study_id !== studyId) {
    throw new Error("Reasoning record study scope mismatch");
  }
  const recordId = input.reasoning_record_id ?? reasoningRecordIdFor(studyId, input.analysis);
  const existing = await getReasoningRecord(recordId);
  if (existing) {
    await recordJobEffect({
      effect_type: "REASONING_RECORD",
      idempotency_key: recordId,
      canonical_id: recordId,
      payload: { study_id: existing.study_id, source_analysis_sha256: existing.source_analysis_sha256, payload_sha256: existing.payload_sha256 },
      study_id: existing.study_id,
      job_id: input.job_id,
      attempt_id: input.attempt_id,
      note: "Sealed reasoning record reused after retry/restart.",
    });
    return existing;
  }

  const unsigned: UnsignedReasoningRecord = {
    reasoning_record_id: recordId,
    report_id: input.report_id,
    study_id: studyId,
    analysis_id: input.analysis_id ?? `anl_${studyId}`,
    created_at: new Date().toISOString(),
    record_schema_version: REASONING_RECORD_SCHEMA_VERSION,
    source_analysis_sha256: sourceAnalysisSha256(input.analysis),
    version_freeze: {
      report_version: REPORT_VERSION,
      pipeline_version: input.analysis.provenance.pipeline_version,
      pipeline_ruleset_version: input.analysis.provenance.ruleset_version,
      evidence_taxonomy_version: EVIDENCE_TAXONOMY_VERSION,
      condition_knowledge_version: EVIDENCE_TAXONOMY_VERSION,
      specialist_rules_version: SPECIALIST_PACKAGE_VERSION,
      validation_registry_version: VALIDATION_REGISTRY_VERSION,
      reasoning_engine_version: REASONING_ENGINE_VERSION,
      coverage_registry_version: OPHTHALMIC_COVERAGE_VERSION,
    },
    evidence_snapshot: clone(input.evidence.evidence),
    evidence_conflicts: clone(input.evidence.conflicts),
    condition_assessments: clone(input.evidence.possible_conditions),
    specialist_consensus: input.evidence.specialist_consensus ? clone(input.evidence.specialist_consensus) : null,
    specialist_bundles: clone(input.evidence.specialist_bundles),
    specialist_packages: clone(input.evidence.specialist_packages ?? []),
    reasoning: clone(input.reasoning),
  };
  const record = sign(unsigned);
  const verified = verifyReasoningRecord(record);
  if (!verified.ok) throw new Error(`Refusing to persist invalid reasoning record: ${verified.reason}`);
  const committed = await persistOnce(
    "reasoning_records",
    recordId,
    clone(record),
    (candidate: ImmutableReasoningRecord) => sha256Canonical({
      reasoning_record_id: candidate.reasoning_record_id,
      report_id: candidate.report_id,
      study_id: candidate.study_id,
      analysis_id: candidate.analysis_id ?? null,
      record_schema_version: candidate.record_schema_version,
      source_analysis_sha256: candidate.source_analysis_sha256,
      version_freeze: candidate.version_freeze,
      evidence_snapshot: candidate.evidence_snapshot,
      evidence_conflicts: candidate.evidence_conflicts,
      condition_assessments: candidate.condition_assessments,
      specialist_consensus: candidate.specialist_consensus,
      specialist_bundles: candidate.specialist_bundles,
      specialist_packages: candidate.specialist_packages,
      reasoning: candidate.reasoning,
      payload_sha256: candidate.payload_sha256,
    }),
  );
  await recordJobEffect({
    effect_type: "REASONING_RECORD",
    idempotency_key: recordId,
    canonical_id: recordId,
    payload: { study_id: committed.study_id, source_analysis_sha256: committed.source_analysis_sha256, payload_sha256: committed.payload_sha256 },
    study_id: committed.study_id,
    job_id: input.job_id,
    attempt_id: input.attempt_id,
    note: "Sealed reasoning record is immutable; replay reuses the same record id.",
  });
  return clone(committed);
}

export function persistReasoningRecord(input: {
  report_id: string;
  analysis: AnalysisResult;
  evidence: StructuredClinicalEvidence;
  reasoning: StructuredReasoningResult;
  reasoning_record_id?: string;
  analysis_id?: string;
  job_id?: string;
  attempt_id?: string;
}): Promise<ImmutableReasoningRecord> {
  const task = reasoningWriteChain.then(() => persistReasoningRecordUnlocked(input));
  reasoningWriteChain = task.then(() => undefined, () => undefined);
  return task;
}
