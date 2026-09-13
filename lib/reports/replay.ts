import { dbGet } from "../storage/db";
import { readOriginalScan, sha256 } from "../storage/files";
import { listDocumentsByStudy } from "../documents/repository";
import { readOriginalDocument } from "../documents/storage";
import { buildStructuredClinicalEvidence } from "../evidence/structuredClinicalEvidence";
import { DeterministicReasoningEngine } from "../models/reasoningEngine";
import { generateReport, type ClinicalReport } from "./generator";
import { replayReasoningRecordId, persistReasoningRecord } from "./reasoningRecord";
import { sha256Canonical } from "./integrity";
import type { AnalysisRecord, StudyRecord } from "../studies/service";
import { currentAnalysisId } from "../studies/analysisIdentity";

export const LEGACY_REPLAY_NOT_POSSIBLE = "LEGACY_REPLAY_NOT_POSSIBLE" as const;

export class LegacyReplayError extends Error {
  readonly code = LEGACY_REPLAY_NOT_POSSIBLE;
  constructor(detail: string) {
    super(`${LEGACY_REPLAY_NOT_POSSIBLE}: ${detail}`);
    this.name = "LegacyReplayError";
  }
}

export interface LegacyReplayResult {
  original_report_id: string;
  new_report_id: string;
  reasoning_record_id: string;
  source_analysis_sha256: string;
  report: ClinicalReport;
}

function replayId(studyId: string): string {
  return `rep_${studyId}_replay_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Replay an unsealed legacy report using only the immutable stored analysis
 * and source bytes. The original row is never updated. Any missing or
 * mismatched input fails closed with LEGACY_REPLAY_NOT_POSSIBLE.
 */
export async function replayLegacyReport(reportId: string, replayedBy: string, reason = "legacy_unsealed_report_replay"): Promise<LegacyReplayResult> {
  const original = await dbGet<ClinicalReport>("reports", reportId);
  if (!original) throw new LegacyReplayError("source report not found");
  if (original.version_freeze && original.reasoning_snapshot) throw new LegacyReplayError("source report is already sealed");
  const studyId = original.study_id;
  if (!studyId) throw new LegacyReplayError("source report has no study id");

  const study = await dbGet<StudyRecord>("studies", studyId);
  const analysisRecord = study
    ? await dbGet<AnalysisRecord>("analyses", currentAnalysisId(study))
    : null;
  if (!study || !analysisRecord?.result) throw new LegacyReplayError("immutable source study or analysis is missing");
  const analysis = analysisRecord.result;
  const analysisHash = sha256Canonical(analysis);
  const frozenHash = original.version_freeze?.source_analysis_sha256;
  if (frozenHash && frozenHash !== analysisHash) throw new LegacyReplayError("source analysis hash mismatch");

  const originalBytes = await readOriginalScan(studyId);
  if (!originalBytes || (study.original_sha256 && sha256(originalBytes) !== study.original_sha256)) {
    throw new LegacyReplayError("immutable source scan is missing or hash-mismatched");
  }
  const documents = await listDocumentsByStudy(studyId);
  for (const document of documents) {
    const bytes = await readOriginalDocument(document.document_id);
    if (!bytes || sha256(bytes) !== document.sha256) throw new LegacyReplayError(`document asset missing or hash-mismatched: ${document.document_id}`);
  }

  const evidence = await buildStructuredClinicalEvidence(studyId, { includeSpecialists: true });
  if ("not_found" in evidence) throw new LegacyReplayError("evidence inputs are unavailable");
  const reasoning = new DeterministicReasoningEngine().analyze(evidence);
  const newReportId = replayId(studyId);
  const sourceReasoningId = original.reasoning_snapshot?.reasoning_record_id ?? `reason_${studyId}_${analysisHash.slice(0, 24)}`;
  const reasoningSnapshot = await persistReasoningRecord({
    report_id: newReportId,
    reasoning_record_id: replayReasoningRecordId(sourceReasoningId, newReportId.slice(-16)),
    analysis,
    analysis_id: analysisRecord.analysis_id,
    evidence,
    reasoning,
  });
  const report = await generateReport(analysis, original.patient, reasoningSnapshot, {
    report_id: newReportId,
    supersedes_report_id: reportId,
    source_legacy_report_id: reportId,
    replay_reason: reason.slice(0, 300),
    replayed_by: replayedBy.slice(0, 120),
    replayed_at: new Date().toISOString(),
    analysis_id: analysisRecord.analysis_id,
  });
  return { original_report_id: reportId, new_report_id: report.report_id, reasoning_record_id: reasoningSnapshot.reasoning_record_id, source_analysis_sha256: analysisHash, report };
}
