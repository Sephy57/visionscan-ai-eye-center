import { NormalizedStudy, DeviceMetadata, SecureFileImportAdapter, ScanType, EyeLaterality } from "../devices/adapter";
import { newId, saveOriginalScan, readOriginalScan, StoredFile, writeJson, deleteStudyFiles } from "../storage/files";
import { dbPut, dbGet, dbAll, dbDelete } from "../storage/db";
import { runPipeline } from "../analysis/pipeline";
import { AnalysisResult } from "../analysis/schema";
import { generateReport, ClinicalReport } from "../reports/generator";
import { runSafetyChecks } from "../clinical/safety";
import { audit } from "../audit";

export interface StudyRecord {
  study_id: string;
  created_at: string;
  modality: string;
  eye: string;
  source: string;
  metadata: DeviceMetadata;
  files: StoredFile[];
  status: "uploaded" | "analyzed" | "rejected";
  original_sha256: string;
}

export interface AnalysisRecord {
  analysis_id: string;
  study_id: string;
  created_at: string;
  result: AnalysisResult;
}

export async function createStudy(
  fileName: string,
  mime: string,
  bytes: Buffer,
  declared: DeviceMetadata
): Promise<StudyRecord> {
  const studyId = newId("study");
  const adapter = new SecureFileImportAdapter(declared);
  const file: StoredFile = await saveOriginalScan(studyId, fileName, bytes, mime);
  const study: NormalizedStudy = {
    studyId,
    modality: declared.scanType ?? "unknown",
    eye: declared.eye ?? "unknown",
    source: "file_upload",
    metadata: { ...declared, providedBy: "user" },
    files: [file],
  };
  const record: StudyRecord = {
    study_id: studyId,
    created_at: new Date().toISOString(),
    modality: study.modality,
    eye: study.eye,
    source: study.source,
    metadata: study.metadata,
    files: [file],
    status: "uploaded",
    original_sha256: file.sha256,
  };
  await dbPut("studies", studyId, record);
  await audit({ actor: "user", action: "upload", studyId, outcome: "ok", detail: `modality=${study.modality} eye=${study.eye}` });
  return record;
}

export async function analyzeStudy(studyId: string): Promise<{ analysis: AnalysisResult; report: ClinicalReport }> {
  const record = await dbGet<StudyRecord>("studies", studyId);
  if (!record) throw new Error("Study not found");
  const bytes = await readOriginalScan(studyId);
  if (!bytes) throw new Error("Original scan missing");

  const { analysis } = await runPipeline({
    study: {
      studyId,
      modality: (record.modality as ScanType) ?? "unknown",
      eye: (record.eye as EyeLaterality) ?? "unknown",
      source: record.source as NormalizedStudy["source"],
      metadata: record.metadata,
      files: record.files,
    },
    originalBytes: bytes,
  });

  const analysisRecord: AnalysisRecord = {
    analysis_id: `anl_${studyId}`,
    study_id: studyId,
    created_at: new Date().toISOString(),
    result: analysis,
  };
  await dbPut("analyses", analysisRecord.analysis_id, analysisRecord);
  await writeJson("processed", analysisRecord.analysis_id, analysisRecord);

  const report = await generateReport(analysis);

  const safety = runSafetyChecks(analysis);
  if (!safety.ok) {
    await audit({ actor: "system", action: "analyze", studyId, outcome: "rejected", detail: "safety checks failed" });
    throw new Error("Safety checks failed: " + JSON.stringify(safety.checks.filter((c) => !c.passed)));
  }

  record.status = analysis.quality.acceptable ? "analyzed" : "rejected";
  await dbPut("studies", studyId, record);
  await audit({
    actor: "system",
    action: "analyze",
    studyId,
    outcome: "ok",
    detail: `quality=${analysis.quality.status} findings=${analysis.findings.length} triage=${analysis.recommendation.priority}`,
  });

  return { analysis, report };
}

export async function getStudyBundle(studyId: string): Promise<{
  study: StudyRecord | null;
  analysis: AnalysisResult | null;
  report: ClinicalReport | null;
}> {
  const study = await dbGet<StudyRecord>("studies", studyId);
  const analysisRecord = await dbGet<AnalysisRecord>("analyses", `anl_${studyId}`);
  const report = await dbGet<ClinicalReport>("reports", `rep_${studyId}`);
  // Unwrap: expose the structured AnalysisResult directly (never the storage record).
  return { study, analysis: analysisRecord?.result ?? null, report };
}

export async function listStudies(): Promise<StudyRecord[]> {
  const all = await dbAll<StudyRecord>("studies");
  return all.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function deleteStudy(studyId: string): Promise<boolean> {
  const record = await dbGet<StudyRecord>("studies", studyId);
  if (!record) return false;
  await deleteStudyFiles(studyId);
  await dbDelete("studies", studyId);
  await dbDelete("analyses", `anl_${studyId}`);
  await dbDelete("reports", `rep_${studyId}`);
  await audit({ actor: "user", action: "delete", studyId, outcome: "ok", detail: "study and derived artifacts deleted" });
  return true;
}

export interface ReviewInput {
  reviewer_id: string;
  action: "accept" | "reject" | "correct" | "note" | "finalize";
  finding_id?: string;
  note?: string;
  correction?: Partial<{ severity: string; location: string; explanation: string; type: string }>;
}

export async function submitReview(studyId: string, input: ReviewInput): Promise<ClinicalReport | null> {
  const report = await dbGet<ClinicalReport>("reports", `rep_${studyId}`);
  const analysis = await dbGet<AnalysisRecord>("analyses", `anl_${studyId}`);
  if (!report || !analysis) throw new Error("Analyzed study not found");

  const change = { field: input.finding_id ?? "report", action: input.action, note: input.note, at: new Date().toISOString() };
  report.review = report.review ?? { status: "ai_only" };

  switch (input.action) {
    case "accept":
      report.review.status = "clinician_reviewed";
      report.review.reviewer_id = input.reviewer_id;
      break;
    case "reject":
      report.review.status = "clinician_reviewed";
      report.review.reviewer_id = input.reviewer_id;
      if (input.finding_id) {
        report.findings = report.findings.filter((f) => f.id !== input.finding_id);
      }
      break;
    case "correct":
      if (input.finding_id && input.correction) {
        const f = report.findings.find((x) => x.id === input.finding_id);
        if (f) {
          // Clinician modifications are attributed to the clinician, never to a model.
          Object.assign(f, input.correction);
          f.model_id = "clinician_manual";
          f.synthetic = false;
        }
      }
      report.review.status = "clinician_reviewed";
      report.review.reviewer_id = input.reviewer_id;
      break;
    case "note":
      report.patient.notes = (report.patient.notes ? report.patient.notes + " | " : "") + `[${input.reviewer_id}] ${input.note ?? ""}`;
      break;
    case "finalize":
      report.review.status = "clinician_finalized";
      report.review.reviewer_id = input.reviewer_id;
      report.review.finalized_at = new Date().toISOString();
      break;
  }

  report.review.clinician_changes = [...(report.review.clinician_changes ?? []), change];
  await dbPut("reports", report.report_id, report);
  await writeJson("reports", report.report_id, report);
  await audit({
    actor: `clinician:${input.reviewer_id}`,
    action: `review.${input.action}`,
    studyId,
    outcome: "ok",
    detail: input.finding_id ? `finding=${input.finding_id}` : undefined,
  });
  return report;
}

export interface CompareOutcome {
  performed: boolean;
  previous_study_id: string;
  current_study_id: string;
  note: string;
  finding_type_changes: Array<{ type: string; previous: number; current: number; direction: string }>;
  quantitative_comparison: string;
}

/**
 * Temporal comparison. HONEST LIMIT: no validated quantitative features
 * exist yet (thickness, area, volume), so we can only compare the PRESENCE
 * AND TYPE COUNTS of detected findings - and clearly say that quantitative
 * comparison requires validated measurements.
 */
export async function compareStudies(previousStudyId: string, currentStudyId: string): Promise<CompareOutcome> {
  const prev = await dbGet<AnalysisRecord>("analyses", `anl_${previousStudyId}`);
  const cur = await dbGet<AnalysisRecord>("analyses", `anl_${currentStudyId}`);
  if (!prev || !cur) throw new Error("Both studies must be analyzed before comparison");

  const countByType = (r: AnalysisRecord) => {
    const m: Record<string, number> = {};
    for (const f of r.result.findings) m[f.type] = (m[f.type] ?? 0) + 1;
    return m;
  };
  const p = countByType(prev);
  const c = countByType(cur);
  const types = [...new Set([...Object.keys(p), ...Object.keys(c)])];
  const changes = types.map((t) => {
    const pv = p[t] ?? 0;
    const cv = c[t] ?? 0;
    return { type: t, previous: pv, current: cv, direction: cv > pv ? "increased" : cv < pv ? "decreased" : "unchanged" };
  });

  const outcome: CompareOutcome = {
    performed: true,
    previous_study_id: previousStudyId,
    current_study_id: currentStudyId,
    note:
      "Comparison is limited to the presence and count of detected finding types. Quantitative change " +
      "(thickness, lesion size, fluid area/volume) requires validated measurement components, which are not " +
      "installed. Changes reported here do NOT establish disease progression.",
    finding_type_changes: changes,
    quantitative_comparison:
      "Not available - no validated quantitative measurement components are implemented. " +
      "Any numeric progression claims would be fabrication and are disabled by design.",
  };

  await dbPut("comparisons", `${previousStudyId}__${currentStudyId}`, outcome);
  await audit({ actor: "user", action: "compare", outcome: "ok", detail: `${previousStudyId} vs ${currentStudyId}` });
  return outcome;
}
