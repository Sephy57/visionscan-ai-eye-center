import { NormalizedStudy, DeviceMetadata, SecureFileImportAdapter, ScanType, EyeLaterality } from "../devices/adapter";
import { newId, saveOriginalScan, readOriginalScan, StoredFile, writeJson, deleteStudyFiles } from "../storage/files";
import { dbPut, dbGet, dbAll, dbDelete } from "../storage/db";
import { runPipeline } from "../analysis/pipeline";
import { AnalysisResult } from "../analysis/schema";
import { generateReport, ClinicalReport } from "../reports/generator";
import { runSafetyChecks } from "../clinical/safety";
import { audit, appendAnalysisAudit } from "../audit";
import { pickDemoScenario } from "../analysis/findings";
import { PatientSymptom, validateSymptoms, SYMPTOM_MAP } from "../clinical/symptoms";

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
  patient_ref?: string;               // user-supplied study identifier (e.g. "VS-2026-0001"); optional, never invented
  symptoms?: PatientSymptom[];        // structured patient-reported context (NOT findings)
  symptoms_updated_at?: string;
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
  declared: DeviceMetadata,
  patientRef?: string
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
    patient_ref: patientRef?.trim() ? patientRef.trim().slice(0, 64) : undefined,
  };
  await dbPut("studies", studyId, record);
  await audit({ actor: "user", action: "upload", studyId, outcome: "ok", detail: `modality=${study.modality} eye=${study.eye}` });
  return record;
}

/** Attach structured patient symptoms to a study (validated; audited; history preserved). */
export async function setStudySymptoms(
  studyId: string,
  symptomsInput: unknown
): Promise<{ ok: boolean; errors?: unknown[]; symptoms?: PatientSymptom[] }> {
  const record = await dbGet<StudyRecord>("studies", studyId);
  if (!record) return { ok: false, errors: [{ message: "Study not found" }] };
  const v = validateSymptoms(symptomsInput);
  if (!v.valid) return { ok: false, errors: v.errors };
  record.symptoms = v.symptoms;
  record.symptoms_updated_at = new Date().toISOString();
  await dbPut("studies", studyId, record);
  await audit({
    actor: "user",
    action: "symptoms.set",
    studyId,
    outcome: "ok",
    detail: `${v.symptoms.length} symptom(s): ${v.symptoms.map((s) => s.type).join(",").slice(0, 180)}`,
  });
  return { ok: true, symptoms: v.symptoms };
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
      hashSeed: pickDemoScenario(bytes).seed,
    },
    originalBytes: bytes,
    symptoms: record.symptoms ?? [],
  });

  const analysisRecord: AnalysisRecord = {
    analysis_id: `anl_${studyId}`,
    study_id: studyId,
    created_at: new Date().toISOString(),
    result: analysis,
  };
  await dbPut("analyses", analysisRecord.analysis_id, analysisRecord);
  await writeJson("processed", analysisRecord.analysis_id, analysisRecord);

  // Append-only audit record with full provenance (Phase 2).
  await appendAnalysisAudit({
    study_id: studyId,
    image_sha256: record.original_sha256,
    model_id: "demo-fundus-synthetic-v0",
    model_version: "0.1.0",
    model_checksum: "n/a-placeholder",
    device: record.metadata.manufacturer && record.metadata.model ? `${record.metadata.manufacturer} ${record.metadata.model}` : "unspecified",
    modality: record.modality,
    quality_score: analysis.quality.score,
    findings_count: analysis.findings.length,
    uncertainty: analysis.uncertainty.overall,
    ruleset_version: analysis.provenance.ruleset_version,
    triage_priority: analysis.recommendation.priority,
    symptoms_reported: (record.symptoms?.length ?? 0) > 0,
    red_flags: analysis.patient_context?.red_flags ?? [],
  });

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
  action: "accept" | "reject" | "correct" | "note" | "finalize" | "confirm" | "indeterminate" | "request_new_scan";
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
  report.clinician_interpretation = report.clinician_interpretation ?? {
    reviewer_id: input.reviewer_id,
    overall: "amended",
    finding_decisions: [],
    notes: null,
    at: new Date().toISOString(),
  };
  const ci = report.clinician_interpretation;

  switch (input.action) {
    case "accept":
    case "confirm":
      report.review.status = "clinician_reviewed";
      report.review.reviewer_id = input.reviewer_id;
      if (input.finding_id) {
        ci.finding_decisions = [...(ci.finding_decisions ?? []).filter((d) => d.finding_id !== input.finding_id),
          { finding_id: input.finding_id, decision: "confirm", note: input.note, at: change.at }];
        ci.overall = "confirmed_ai_findings";
      }
      break;
    case "reject":
      report.review.status = "clinician_reviewed";
      report.review.reviewer_id = input.reviewer_id;
      if (input.finding_id) {
        ci.finding_decisions = [...(ci.finding_decisions ?? []).filter((d) => d.finding_id !== input.finding_id),
          { finding_id: input.finding_id, decision: "reject", note: input.note, at: change.at }];
        // AI output is never overwritten: the rejection lives in the clinician
        // interpretation record, keeping the AI result intact for audit.
        ci.overall = "rejected_ai_findings";
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
        ci.finding_decisions = [...(ci.finding_decisions ?? []).filter((d) => d.finding_id !== input.finding_id),
          { finding_id: input.finding_id, decision: "correct", note: input.note, at: change.at }];
      }
      report.review.status = "clinician_reviewed";
      report.review.reviewer_id = input.reviewer_id;
      ci.overall = "amended";
      break;
    case "indeterminate":
      report.review.status = "clinician_reviewed";
      report.review.reviewer_id = input.reviewer_id;
      ci.overall = "indeterminate";
      break;
    case "request_new_scan":
      report.review.status = "clinician_reviewed";
      report.review.reviewer_id = input.reviewer_id;
      ci.overall = "request_new_scan";
      break;
    case "note":
      report.patient.notes = (report.patient.notes ? report.patient.notes + " | " : "") + `[${input.reviewer_id}] ${input.note ?? ""}`;
      ci.notes = (ci.notes ? ci.notes + " | " : "") + `[${input.reviewer_id}] ${input.note ?? ""}`;
      break;
    case "finalize":
      report.review.status = "clinician_finalized";
      report.review.reviewer_id = input.reviewer_id;
      report.review.finalized_at = new Date().toISOString();
      // FINAL INTERPRETATION is the clinician's own statement - never AI-generated text.
      report.final_interpretation =
        `Final interpretation by clinician ${input.reviewer_id}: ${
          ci.overall === "indeterminate" ? "Indeterminate - repeat imaging or further evaluation recommended."
          : ci.overall === "request_new_scan" ? "New scan requested; current automated analysis not accepted as basis for assessment."
          : ci.overall === "rejected_ai_findings" ? "Automated findings reviewed; clinician assessment recorded."
          : ci.overall === "confirmed_ai_findings" ? "Automated findings confirmed by clinician review."
          : "Report finalized after clinician review."
        }` + (input.note ? ` Note: ${input.note}` : "");
      break;
  }

  ci.reviewer_id = input.reviewer_id;
  ci.at = change.at;

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
