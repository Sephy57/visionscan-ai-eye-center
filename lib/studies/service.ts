import { NormalizedStudy, DeviceMetadata, SecureFileImportAdapter, ScanType, EyeLaterality } from "../devices/adapter";
import { newId, saveOriginalScan, readOriginalScan, StoredFile, writeJson, deleteStudyFiles } from "../storage/files";
import { dbPut, dbGet, dbAll, dbDelete, dbPage, dbTransaction, type DbPageResult, type DbPageOptions } from "../storage/db";
import { runPipeline } from "../analysis/pipeline";
import { AnalysisResult } from "../analysis/schema";
import { generateReport, ClinicalReport } from "../reports/generator";
import { runSafetyChecks } from "../clinical/safety";
import { audit, appendAnalysisAudit } from "../audit";
import { listAllDocumentRecords } from "../documents/repository";
import { deleteOriginalDocument } from "../documents/storage";
import { deleteExtractedRegions } from "../documents/extraction/pdfIntelligence";
import { deleteExtractionArtifact } from "../documents/extraction/artifacts";
import { deleteRecordExtraction } from "../documents/extraction/recordExtractionStore";
import { pickDemoScenario } from "../analysis/findings";
import { PatientSymptom, validateSymptoms, SYMPTOM_MAP } from "../clinical/symptoms";
import { ensurePatient, createEncounter } from "../patients/service";
import { getModel } from "../models/registry";
import { assetHash, routeUploadedAsset } from "../assets/assetRouter";
import { listDocumentsByStudy } from "../documents/repository";
import { readExtractionArtifact } from "../documents/extraction/artifacts";
import { readExtractedRegion } from "../documents/extraction/pdfIntelligence";
import { canonicalModality } from "../models/modalities";
import { presentReportWithLegacyStatus, verifyReportVersionFreeze, sha256Canonical } from "../reports/integrity";
import { jobCheckpoint, type JobExecutionControl } from "../jobs/control";
import { buildStructuredClinicalEvidence } from "../evidence/structuredClinicalEvidence";
import { DeterministicReasoningEngine } from "../models/reasoningEngine";
import { persistReasoningRecord } from "../reports/reasoningRecord";
import { prepareRecoveryJournal, updateRecoveryJournal } from "../storage/reconciliation";

export interface StudyRecord {
  study_id: string;
  created_at: string;
  modality: string;
  eye: string;
  source: string;
  metadata: DeviceMetadata;
  files: StoredFile[];
  status: "uploaded" | "analyzed" | "rejected";
  lifecycle?: "ACTIVE" | "ARCHIVED" | "DELETED";
  original_sha256: string;
  patient_ref?: string;               // user-supplied study identifier (e.g. "VS-2026-0001"); optional, never invented
  /** Optional patient/tenant scope metadata. Legacy synthetic fixtures omit it. */
  patient_id?: string | null;
  encounter_id?: string | null;
  tenant_id?: string | null;
  owner_user_id?: string | null;
  owner_username?: string | null;
  symptoms?: PatientSymptom[];        // structured patient-reported context (NOT findings)
  symptoms_updated_at?: string;
  /** Server-computed content routing; optional for legacy records. */
  asset_routing?: import("../assets/assetRouter").AssetRoutingResult;
  /** Mutable pointer to the newest immutable report version for this study. */
  latest_report_id?: string;
}

export interface AnalysisRecord {
  analysis_id: string;
  study_id: string;
  patient_id?: string | null;
  tenant_id?: string | null;
  lifecycle?: "ACTIVE" | "ARCHIVED" | "DELETED";
  created_at: string;
  result: AnalysisResult;
}

export async function createStudy(
  fileName: string,
  mime: string,
  bytes: Buffer,
  declared: DeviceMetadata,
  patientRef?: string,
  createdBy = "system",
  autoLinkPatient = false,
  scope?: { tenant_id?: string | null; owner_user_id?: string | null; owner_username?: string | null }
): Promise<StudyRecord> {
  const studyId = newId("study");
  const adapter = new SecureFileImportAdapter(declared);
  const routing = await routeUploadedAsset(bytes, {
    mime,
    declaredModality: declared.scanType,
    device: { manufacturer: declared.manufacturer, model: declared.model },
  });
  // An omitted/unknown declaration is completed only by a server-computed
  // content route. Explicit declarations remain visible, while a strong
  // content result prevents the historical UNKNOWN fall-through.
  const declaredModality = declared.scanType ?? "unknown";
  const contentModality = routing.modality === "FUNDUS_PHOTO" ? "fundus" : routing.modality === "OCT" ? "oct" : null;
  const declaredCanonical = canonicalModality(declaredModality);
  const declaredIsUnknown = !declaredModality || declaredModality.toLowerCase() === "unknown";
  const contentCanonical = contentModality ? canonicalModality(contentModality) : null;
  const researchModalityConflict = !!contentCanonical &&
    (declaredCanonical === "FUNDUS" || declaredCanonical === "OCT") &&
    (contentCanonical === "FUNDUS" || contentCanonical === "OCT") && declaredCanonical !== contentCanonical;
  const effectiveModality = contentModality && routing.method === "CONTENT_HEURISTICS" &&
    (declaredIsUnknown || declaredCanonical === contentCanonical)
    ? contentModality
    : researchModalityConflict ? "unknown" : declaredModality;
  const file: StoredFile = await saveOriginalScan(studyId, fileName, bytes, mime);
  const study: NormalizedStudy = {
    studyId,
    modality: effectiveModality,
    eye: declared.eye ?? "unknown",
    source: "file_upload",
    metadata: { ...declared, providedBy: declared.providedBy === "none" ? "none" : "user" },
    files: [file],
    asset_routing: routing,
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
    asset_routing: routing,
    patient_ref: patientRef?.trim() ? patientRef.trim().slice(0, 64) : undefined,
    tenant_id: scope?.tenant_id ?? null,
    owner_user_id: scope?.owner_user_id ?? null,
    owner_username: scope?.owner_username ?? null,
  };
  await dbPut("studies", studyId, record);
  // A supplied pseudonymous patient reference is enough to provision the
  // local workspace link. This creates no inferred identity: the reference
  // remains exactly the user-provided value, and the encounter contains no
  // clinical facts until a record is uploaded/reviewed.
  if (autoLinkPatient && record.patient_ref) {
    try {
      const patient = await ensurePatient(record.patient_ref, createdBy, "PROVISIONED_FROM_STUDY", null, scope);
      const encounterResult = await createEncounter({
        patient_id: patient.patient_id,
        linked_study_ids: [studyId],
        created_by: createdBy,
      });
      record.patient_id = patient.patient_id;
      if (encounterResult.ok && encounterResult.encounter) record.encounter_id = encounterResult.encounter.encounter_id;
      await dbPut("studies", studyId, record);
    } catch {
      // The study remains usable if workspace provisioning is temporarily
      // unavailable; the failed link is visible in audit and can be retried.
      await audit({ actor: createdBy, action: "study.patient_link_failed", studyId, outcome: "error", detail: "patient workspace provisioning failed" });
    }
  }
  await audit({ actor: "user", action: "upload", studyId, outcome: "ok", detail: `modality=${study.modality} route=${routing.modality_state} eye=${study.eye}` });
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

export async function analyzeStudy(
  studyId: string,
  control?: JobExecutionControl,
): Promise<{ analysis: AnalysisResult; report: ClinicalReport }> {
  await jobCheckpoint(control, { stage: "preparing", percent: 4, message: "Loading study metadata" });
  const record = await dbGet<StudyRecord>("studies", studyId);
  if (!record) throw new Error("Study not found");
  const canonicalReportId = `rep_${studyId}`;
  const existingReportId = record.latest_report_id ?? canonicalReportId;
  const existingReport = await dbGet<ClinicalReport>("reports", existingReportId);
  if (existingReport?.review.status === "clinician_finalized") {
    throw new Error("Finalized report is immutable; create a new study/version instead of rerunning analysis.");
  }
  // Source availability is a precondition for every analysis/replay path,
  // including reuse of an already sealed report.  Checking it before the
  // idempotent-replay shortcut prevents a deleted or detached original from
  // being presented as if it were still replayable.  The recorded hash is
  // verified from the bytes again whenever it is a canonical SHA-256 value.
  const bytes = await readOriginalScan(studyId);
  if (!bytes) throw new Error("Original scan missing; SOURCE_PERMANENTLY_UNAVAILABLE");
  if (/^[a-f0-9]{64}$/i.test(record.original_sha256) && assetHash(bytes) !== record.original_sha256) {
    throw new Error("Original scan integrity check failed; SOURCE_PERMANENTLY_UNAVAILABLE");
  }
  const existingAnalysis = await dbGet<AnalysisRecord>("analyses", `anl_${studyId}`);
  // A sealed analysis/report pair is reusable only when the complete immutable
  // input envelope is unchanged. Linked documents are added asynchronously by
  // the extraction worker, so comparing the study-image hash alone would
  // incorrectly skip a required re-analysis after a PDF/OCT becomes READY.
  const linkedDocuments = await listDocumentsByStudy(studyId);
  const currentDocumentInputs = linkedDocuments
    .filter((doc) => doc.status === "READY")
    .map((doc) => ({ document_id: doc.document_id, sha256: doc.sha256 }))
    .sort((a, b) => a.document_id.localeCompare(b.document_id));
  const existingDocumentInputs = (existingAnalysis?.result.document_routing ?? [])
    .map((routing) => ({ document_id: routing.document_id, sha256: routing.source_document_hash ?? null }))
    .sort((a, b) => a.document_id.localeCompare(b.document_id));
  const documentInputsMatch = sha256Canonical(currentDocumentInputs) === sha256Canonical(existingDocumentInputs);
  const currentSymptoms = (record.symptoms ?? []).map((symptom) => ({
    type: symptom.type,
    label: SYMPTOM_MAP[symptom.type]?.label,
    onset: symptom.onset,
    duration: symptom.duration,
    severity: symptom.severity,
    laterality: symptom.laterality,
    progression: symptom.progression,
    frequency: symptom.frequency,
    free_text: symptom.free_text ?? null,
  }));
  const existingSymptoms = existingAnalysis?.result.patient_context?.symptoms ?? [];
  const symptomsMatch = sha256Canonical(currentSymptoms) === sha256Canonical(existingSymptoms);
  const inputEnvelopeMatch = documentInputsMatch && symptomsMatch;
  const reportId = existingReport?.version_freeze && !inputEnvelopeMatch
    ? `${canonicalReportId}_v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
    : existingReportId;
  const supersedesReportId = reportId === existingReportId ? undefined : existingReport?.report_id;
  if (existingReport?.version_freeze && existingReport.reasoning_snapshot && existingAnalysis?.result &&
      existingReport.version_freeze.source_analysis_sha256 === sha256Canonical(existingAnalysis.result) &&
      inputEnvelopeMatch) {
    // A worker may be replayed after a crash that occurred after publication.
    // Reuse the sealed pair instead of running inference or rewriting history.
    return { analysis: existingAnalysis.result, report: existingReport };
  }
  await jobCheckpoint(control, { stage: "validating_source", percent: 12, message: "Immutable source loaded" });

  const documentAssets: Array<{
    asset_id: string; document_id: string; page: number; bbox: { x: number; y: number; w: number; h: number };
    source_page_hash: string; roi_hash: string; content_type: "OCT_BSCAN"; modality: "OCT"; eye: "OD" | "OS" | "unknown"; bytes: Buffer;
  }> = [];
  const documentRouting: import("../documents/extraction/pdfIntelligence").PdfAssetRouting[] = [];
  // Only server-created OCT_BSCAN derivatives are eligible for OCT inference.
  // Text, tables, whole pages, and non-OCT records never enter this list.
  for (const [documentIndex, doc] of linkedDocuments.entries()) {
    await jobCheckpoint(control, {
      stage: "routing_assets",
      percent: 15 + Math.round((documentIndex / Math.max(1, linkedDocuments.length)) * 15),
      completed_units: documentIndex,
      total_units: linkedDocuments.length,
      message: `Validating linked document ${documentIndex + 1} of ${linkedDocuments.length}`,
    });
    const artifact = await readExtractionArtifact(doc.document_id);
    const routing = artifact?.asset_routing;
    // A sidecar is eligible only when it is tied to this study/document and
    // the extraction was generated from the current immutable PDF bytes.
    // Legacy artifacts without a document hash remain displayable but cannot
    // contribute image assets to model inference.
    const artifactTrusted = !!artifact && (artifact.study_id === studyId) &&
      (!!routing && routing.document_id === doc.document_id && routing.study_id === studyId) &&
      (!!routing.source_document_hash && routing.source_document_hash === doc.sha256) &&
      (doc.status === "READY");
    if (routing && artifactTrusted) documentRouting.push(routing);
    if (!artifactTrusted) continue;
    for (const region of artifact?.asset_routing?.image_regions ?? []) {
      if (region.content_type !== "OCT_BSCAN" || region.document_id !== doc.document_id) continue;
      const page = artifact.asset_routing?.pages.find((p) => p.page === region.page);
      const bbox = region.bbox;
      const bboxValid = [bbox.x, bbox.y, bbox.w, bbox.h].every((v) => Number.isFinite(v)) &&
        bbox.x >= 0 && bbox.y >= 0 && bbox.w > 0 && bbox.h > 0 && bbox.x + bbox.w <= 1 && bbox.y + bbox.h <= 1;
      if (!page || !bboxValid || !page.source_page_hash || page.source_page_hash !== region.source_page_hash) continue;
      const regionBytes = await readExtractedRegion(doc.document_id, region.region_id);
      if (!regionBytes) continue;
      // Never trust a JSON-declared ROI hash: recompute it from the sidecar
      // bytes before admission. This blocks stale/tampered derivative files.
      if (assetHash(regionBytes) !== region.roi_hash) continue;
      documentAssets.push({
        asset_id: region.region_id, document_id: doc.document_id, page: region.page, bbox: region.bbox,
        source_page_hash: region.source_page_hash, roi_hash: region.roi_hash, content_type: "OCT_BSCAN", modality: "OCT",
        eye: region.laterality === "OD" || region.laterality === "OS" ? region.laterality : "unknown", bytes: regionBytes,
      });
    }
  }
  await jobCheckpoint(control, {
    stage: "running_inference",
    percent: 35,
    completed_units: linkedDocuments.length,
    total_units: linkedDocuments.length,
    message: "Running eligible research inference and safety gates",
  });
  const { analysis } = await runPipeline({
    study: {
      studyId,
      modality: (record.modality as ScanType) ?? "unknown",
      eye: (record.eye as EyeLaterality) ?? "unknown",
      source: record.source as NormalizedStudy["source"],
      metadata: record.metadata,
      files: record.files,
      hashSeed: pickDemoScenario(bytes).seed,
      asset_routing: record.asset_routing,
    },
    originalBytes: bytes,
    symptoms: record.symptoms ?? [],
    document_assets: documentAssets,
    document_routing: documentRouting,
  });

  // Safety validation is the publication precondition. Run it before the
  // analysis record, processed JSON, reasoning snapshot, or report can be
  // written so a failed result cannot leave a partially published clinical
  // artifact behind.
  const safety = runSafetyChecks(analysis);
  if (!safety.ok) {
    await audit({ actor: "system", action: "analyze", studyId, outcome: "rejected", detail: "safety checks failed before publication" });
    throw new Error("Safety checks failed: " + JSON.stringify(safety.checks.filter((c) => !c.passed)));
  }

  // This is the publication boundary: cancellation is checked after the
  // longest stage and before any analysis/report record is written.
  await jobCheckpoint(control, { stage: "persisting_analysis", percent: 78, message: "Persisting validated analysis" });

  const analysisRecord: AnalysisRecord = {
    analysis_id: `anl_${studyId}`,
    study_id: studyId,
    patient_id: record.patient_id ?? null,
    tenant_id: record.tenant_id ?? null,
    created_at: new Date().toISOString(),
    result: analysis,
  };
  await dbPut("analyses", analysisRecord.analysis_id, analysisRecord);
  await writeJson("processed", analysisRecord.analysis_id, analysisRecord);

  // Append-only audit record with full provenance (Phase 2).
  // The primary model is taken from the validated pipeline provenance rather
  // than a legacy DEMO constant.  Multi-model runs still retain their full
  // per-component provenance in `analysis.multi_model`; the audit schema has
  // one primary model slot, so use the model registry entry selected by the
  // pipeline and resolve its exact artifact checksum here.
  const auditModel = analysis.model_registry;
  const auditModelRecord = auditModel ? getModel(auditModel.model_id) : null;
  await appendAnalysisAudit({
    study_id: studyId,
    image_sha256: record.original_sha256,
    model_id: auditModel?.model_id ?? "unknown-model",
    model_version: auditModel?.model_version ?? "unknown-version",
    model_checksum: auditModelRecord?.sha256 ?? "none",
    device: record.metadata.manufacturer && record.metadata.model ? `${record.metadata.manufacturer} ${record.metadata.model}` : "unspecified",
    modality: record.modality,
    quality_score: analysis.quality.score,
    findings_count: analysis.findings.length,
    uncertainty: analysis.uncertainty.overall,
    ruleset_version: analysis.provenance.ruleset_version,
    triage_priority: analysis.recommendation.priority,
    symptoms_reported: (record.symptoms?.length ?? 0) > 0,
    red_flags: analysis.patient_context?.red_flags ?? [],
    analysis_mode: analysis.analysis_mode,
    models_attempted: analysis.model_execution?.models_attempted ?? [],
    models_executed: analysis.model_execution?.models_executed ?? [],
    models_failed: analysis.model_execution?.models_failed ?? [],
    asset_routing: analysis.asset_routing ? {
      container_type: analysis.asset_routing.container_type,
      modality: analysis.asset_routing.modality,
      modality_state: analysis.asset_routing.modality_state,
      device_state: analysis.asset_routing.device_state,
      domain_state: analysis.asset_routing.domain_state,
      source_hash: analysis.asset_routing.source_hash,
    } : undefined,
  });

  await control?.onProgress?.({ stage: "generating_report", percent: 86, message: "Persisting specialist and condition reasoning" });
  const structuredEvidence = await buildStructuredClinicalEvidence(studyId, { includeSpecialists: true });
  if ("not_found" in structuredEvidence) throw new Error("Study disappeared before reasoning persistence");
  const reasoning = new DeterministicReasoningEngine().analyze(structuredEvidence);
  const reasoningSnapshot = await persistReasoningRecord({
    report_id: reportId,
    analysis,
    evidence: structuredEvidence,
    reasoning,
  });
  await control?.onProgress?.({ stage: "generating_report", percent: 92, message: "Generating version-frozen report" });
  const report = await generateReport(analysis, undefined, reasoningSnapshot, {
    report_id: reportId,
    supersedes_report_id: supersedesReportId,
  });

  record.status = analysis.quality.acceptable ? "analyzed" : "rejected";
  record.latest_report_id = report.report_id;
  await dbPut("studies", studyId, record);
  await audit({
    actor: "system",
    action: "analyze",
    studyId,
    outcome: "ok",
    detail: `quality=${analysis.quality.status} findings=${analysis.findings.length} triage=${analysis.recommendation.priority}`,
  });

  await control?.onProgress?.({ stage: "generating_report", percent: 98, completed_units: 1, total_units: 1, message: "Analysis and report published" });

  return { analysis, report };
}

export async function getStudyBundle(studyId: string): Promise<{
  study: StudyRecord | null;
  analysis: AnalysisResult | null;
  report: ClinicalReport | null;
}> {
  const study = await dbGet<StudyRecord>("studies", studyId);
  const analysisRecord = await dbGet<AnalysisRecord>("analyses", `anl_${studyId}`);
  const reportId = study?.latest_report_id ?? `rep_${studyId}`;
  const report = await dbGet<ClinicalReport>("reports", reportId);
  if (analysisRecord?.result) {
    const safety = runSafetyChecks(analysisRecord.result);
    if (!safety.ok) {
      await audit({ actor: "system", action: "study.present", studyId, outcome: "rejected", detail: "stored analysis failed safety validation on read" });
      return { study, analysis: null, report: null };
    }
  }
  if (report?.version_freeze) {
    const integrity = verifyReportVersionFreeze(report);
    if (!integrity.ok) {
      await audit({ actor: "system", action: "study.present", studyId, outcome: "rejected", detail: `report integrity failed on read: ${integrity.reason}` });
      return { study, analysis: null, report: null };
    }
  }
  // Unwrap: expose the structured AnalysisResult directly (never the storage
  // record). The immutable reasoning snapshot is retained in the report store
  // and is available to the specialist/evidence review paths, but is omitted
  // from this broad presentation bundle: it contains source-document snippets
  // that should only be rendered by the scoped evidence workspace. This also
  // keeps the general result/triage payload from becoming a raw-document
  // transport while preserving the sealed snapshot for audit and replay.
  let presentationReport: ClinicalReport | null = null;
  if (report) {
    const presented = presentReportWithLegacyStatus(report);
    const { reasoning_snapshot: _reasoningSnapshot, ...safeReport } = presented;
    presentationReport = safeReport;
  }
  return { study, analysis: analysisRecord?.result ?? null, report: presentationReport };
}

export async function listStudies(): Promise<StudyRecord[]> {
  const all = await dbAll<StudyRecord>("studies");
  return all.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/**
 * Bounded history query. The legacy listStudies() array API remains for
 * internal comparison/test callers; HTTP list endpoints should use this
 * keyset page so a large workspace is never serialized in one response.
 */
export async function listStudiesPage(
  options: Pick<DbPageOptions<StudyRecord>, "limit" | "cursor" | "direction"> = {},
): Promise<DbPageResult<StudyRecord>> {
  return dbPage<StudyRecord>("studies", { ...options, direction: options.direction ?? "desc" });
}

/**
 * Final phase - dashboard status buckets. Every value here is derived
 * directly from real, already-computed, server-stored state (triage
 * priority, diagnosis gate, review status, study status) - nothing is
 * invented or inferred client-side. Precedence (most urgent first):
 * an urgent/emergency triage priority always wins, regardless of
 * whether an AI finding exists (never let "no AI finding" hide urgency).
 */
export type DashboardStatus =
  | "URGENT_REVIEW"                    // emergency_evaluation / urgent_eye_care_review triage priority
  | "CLINICAL_CORRELATION_REQUIRED"    // analysis exists, diagnosis gate closed, findings/possible-conditions present
  | "REVIEW_REQUIRED"                  // analyzed, not yet reviewed by a clinician/reviewer
  | "REVIEWED"                         // analyzed and clinician-reviewed/finalized
  | "IMAGE_NOT_SUITABLE"               // study.status === "rejected" (quality gate failure)
  | "MODEL_FAILED"                      // research provider failed; no finding inferred
  | "UNSUPPORTED_MODALITY"              // asset/model modality gate rejected the input
  | "OUT_OF_DISTRIBUTION"               // image outside documented model domain
  | "UPLOADED";                        // no analysis run yet

export interface DashboardStudyRow {
  study_id: string; created_at: string; modality: string; eye: string; status: string;
  patient_ref?: string | null;
  tenant_id?: string | null; owner_user_id?: string | null; owner_username?: string | null;
  dashboard_status: DashboardStatus;
  triage_priority?: string;
}

export async function listStudiesWithStatus(): Promise<DashboardStudyRow[]> {
  const studies = await listStudies();
  const rows: DashboardStudyRow[] = [];
  for (const s of studies) {
    let dashboard_status: DashboardStatus = "UPLOADED";
    let triage_priority: string | undefined;
    // An analysis record is persisted before the study status is updated. Read
    // it for both analyzed and rejected studies so an unsupported/corrupt
    // asset is not presented as a generic quality failure.
    const analysisRecord = s.status === "analyzed" || s.status === "rejected"
      ? await dbGet<AnalysisRecord>("analyses", `anl_${s.study_id}`)
      : null;
    if (s.status === "rejected") {
      const ledger = analysisRecord?.result.model_execution_ledger ?? [];
      dashboard_status = ledger.length > 0 && ledger.every((row) => row.execution_status === "UNSUPPORTED_MODALITY")
        ? "UNSUPPORTED_MODALITY"
        : "IMAGE_NOT_SUITABLE";
    } else if (s.status === "analyzed") {
      const report = await dbGet<ClinicalReport>("reports", s.latest_report_id ?? `rep_${s.study_id}`);
      triage_priority = analysisRecord?.result.recommendation.priority;
      const urgent = triage_priority === "emergency_evaluation" || triage_priority === "urgent_eye_care_review";
      const gate = analysisRecord?.result.diagnosis_gate;
      const hasClinicalContent =
        (analysisRecord?.result.findings.length ?? 0) > 0 ||
        (analysisRecord?.result.possible_conditions?.conditions.length ?? 0) > 0;
      if (urgent) {
        dashboard_status = "URGENT_REVIEW";
      } else if (analysisRecord?.result.analysis_mode === "MODEL_FAILED" ||
        (analysisRecord?.result.model_execution?.models_failed.length ?? 0) > 0) {
        dashboard_status = "MODEL_FAILED";
      } else if (analysisRecord?.result.analysis_mode === "NO_MODEL_EXECUTED" &&
        (analysisRecord?.result.model_execution_ledger?.length ?? 0) > 0 &&
        analysisRecord?.result.model_execution_ledger?.every((row) => row.execution_status === "UNSUPPORTED_MODALITY")) {
        dashboard_status = "UNSUPPORTED_MODALITY";
      } else if (analysisRecord?.result.model_execution_ledger?.some((row) => row.execution_status === "BLOCKED_OOD")) {
        dashboard_status = "OUT_OF_DISTRIBUTION";
      } else if (analysisRecord?.result.model_execution_ledger?.some((row) => row.execution_status === "BLOCKED_QUALITY")) {
        dashboard_status = "IMAGE_NOT_SUITABLE";
      } else if (report?.review.status === "clinician_reviewed" || report?.review.status === "clinician_finalized") {
        dashboard_status = "REVIEWED";
      } else if (gate && !gate.allowed && hasClinicalContent) {
        dashboard_status = "CLINICAL_CORRELATION_REQUIRED";
      } else {
        dashboard_status = "REVIEW_REQUIRED";
      }
    }
    rows.push({
      study_id: s.study_id, created_at: s.created_at, modality: s.modality, eye: s.eye,
      status: s.status, patient_ref: s.patient_ref ?? null,
      tenant_id: s.tenant_id ?? null, owner_user_id: s.owner_user_id ?? null, owner_username: s.owner_username ?? null,
      dashboard_status, triage_priority,
    });
  }
  return rows;
}

/** Server-derived dashboard rows with the same bounded keyset contract. */
export async function listStudiesWithStatusPage(
  options: Pick<DbPageOptions<StudyRecord>, "limit" | "cursor" | "direction"> = {},
): Promise<DbPageResult<DashboardStudyRow>> {
  const page = await listStudiesPage(options);
  const rows: DashboardStudyRow[] = [];
  for (const s of page.items) {
    let dashboard_status: DashboardStatus = "UPLOADED";
    let triage_priority: string | undefined;
    const analysisRecord = s.status === "analyzed" || s.status === "rejected"
      ? await dbGet<AnalysisRecord>("analyses", `anl_${s.study_id}`)
      : null;
    if (s.status === "rejected") {
      const ledger = analysisRecord?.result.model_execution_ledger ?? [];
      dashboard_status = ledger.length > 0 && ledger.every((row) => row.execution_status === "UNSUPPORTED_MODALITY")
        ? "UNSUPPORTED_MODALITY"
        : "IMAGE_NOT_SUITABLE";
    } else if (s.status === "analyzed") {
      const report = await dbGet<ClinicalReport>("reports", s.latest_report_id ?? `rep_${s.study_id}`);
      triage_priority = analysisRecord?.result.recommendation.priority;
      const urgent = triage_priority === "emergency_evaluation" || triage_priority === "urgent_eye_care_review";
      const gate = analysisRecord?.result.diagnosis_gate;
      const hasClinicalContent = (analysisRecord?.result.findings.length ?? 0) > 0 || (analysisRecord?.result.possible_conditions?.conditions.length ?? 0) > 0;
      if (urgent) dashboard_status = "URGENT_REVIEW";
      else if (analysisRecord?.result.analysis_mode === "MODEL_FAILED" || (analysisRecord?.result.model_execution?.models_failed.length ?? 0) > 0) dashboard_status = "MODEL_FAILED";
      else if (analysisRecord?.result.analysis_mode === "NO_MODEL_EXECUTED" && (analysisRecord?.result.model_execution_ledger?.length ?? 0) > 0 && analysisRecord?.result.model_execution_ledger?.every((row) => row.execution_status === "UNSUPPORTED_MODALITY")) dashboard_status = "UNSUPPORTED_MODALITY";
      else if (analysisRecord?.result.model_execution_ledger?.some((row) => row.execution_status === "BLOCKED_OOD")) dashboard_status = "OUT_OF_DISTRIBUTION";
      else if (analysisRecord?.result.model_execution_ledger?.some((row) => row.execution_status === "BLOCKED_QUALITY")) dashboard_status = "IMAGE_NOT_SUITABLE";
      else if (report?.review.status === "clinician_reviewed" || report?.review.status === "clinician_finalized") dashboard_status = "REVIEWED";
      else if (gate && !gate.allowed && hasClinicalContent) dashboard_status = "CLINICAL_CORRELATION_REQUIRED";
      else dashboard_status = "REVIEW_REQUIRED";
    }
    rows.push({
      study_id: s.study_id, created_at: s.created_at, modality: s.modality, eye: s.eye,
      status: s.status, patient_ref: s.patient_ref ?? null,
      tenant_id: s.tenant_id ?? null, owner_user_id: s.owner_user_id ?? null, owner_username: s.owner_username ?? null,
      dashboard_status, triage_priority,
    });
  }
  return { ...page, items: rows };
}

export async function deleteStudy(studyId: string): Promise<boolean> {
  const record = await dbGet<StudyRecord>("studies", studyId);
  if (!record) return false;
  // Cascade all database records in one transaction. File deletion is kept
  // outside this transaction because SQLite cannot atomically commit with the
  // filesystem; the follow-up cleanup is idempotent and audited below.
  const docs = (await listAllDocumentRecords()).filter((doc) => doc.study_id === studyId && doc.status !== "DELETED");
  const documentIds = docs.map((doc) => doc.document_id);
  const testResults = await dbAll<{ result_id: string; document_id: string }>("test_results");
  const resultIds = testResults.filter((result) => documentIds.includes(result.document_id)).map((result) => result.result_id);
  const studyReports = (await dbAll<ClinicalReport>("reports")).filter((report) => report.study_id === studyId);
  const reportIds = studyReports.map((report) => report.report_id);
  const preserveFinalizedReport = studyReports.some((report) => report.review.status === "clinician_finalized");
  const journal = await prepareRecoveryJournal({
    operation: "study_delete",
    resources: [
      { kind: "study", id: studyId },
      { kind: "analysis", id: `anl_${studyId}` },
      ...reportIds.map((id) => ({ kind: "report", id })),
      ...documentIds.map((id) => ({ kind: "document", id })),
    ],
  });
  try {
    await dbTransaction((tx) => {
      for (const doc of docs) {
        const current = tx.get<typeof doc>("documents", doc.document_id) ?? doc;
        tx.put("documents", doc.document_id, { ...current, status: "DELETED", updated_at: new Date().toISOString() });
      }
      tx.deleteMany("test_results", resultIds);
      tx.deleteMany("record_extractions", documentIds);
      // Clinical history is retained as a lifecycle transition. Finalized
      // reports and clinician amendments are never destroyed; non-finalized
      // reports/analyses remain available to audit and replay as DELETED rows.
      tx.put("studies", studyId, { ...record, lifecycle: "DELETED" });
      const analysis = tx.get<AnalysisRecord>("analyses", `anl_${studyId}`);
      if (analysis) tx.put("analyses", `anl_${studyId}`, { ...analysis, lifecycle: "DELETED" });
      const report = tx.get<ClinicalReport>("reports", `rep_${studyId}`);
      if (report) tx.put("reports", `rep_${studyId}`, { ...report, lifecycle: "DELETED" });
      for (const reportId of reportIds) {
        const version = tx.get<ClinicalReport>("reports", reportId);
        if (version) tx.put("reports", reportId, { ...version, lifecycle: "DELETED" });
      }
    });
    await updateRecoveryJournal(journal.journal_id, "DB_COMMITTED");
    await deleteStudyFiles(studyId, { preserveReportExport: preserveFinalizedReport });
    for (const doc of docs) {
      await deleteOriginalDocument(doc.document_id);
      await deleteExtractedRegions(doc.document_id);
      await deleteExtractionArtifact(doc.document_id);
      await deleteRecordExtraction(doc.document_id);
      await audit({
        actor: "user:study_deletion_cascade",
        action: "document.deleted",
        resource: "document",
        resourceId: doc.document_id,
        studyId,
        outcome: "ok",
        detail: "study cascade removed database derivatives and immutable file references",
      });
    }
    await updateRecoveryJournal(journal.journal_id, "FILES_COMMITTED");
    await updateRecoveryJournal(journal.journal_id, "COMPLETE");
  } catch (error) {
    await updateRecoveryJournal(journal.journal_id, "FAILED_RECONCILIATION", String(error)).catch(() => undefined);
    throw error;
  }
  await audit({ actor: "user", action: "delete", studyId, outcome: "ok", detail: "study lifecycle marked DELETED; source bytes removed by explicit operator workflow" });
  return true;
}

/** Reversible lifecycle transition used by retention/operations workflows.
 * Archiving never removes source bytes or derived evidence. */
export async function archiveStudy(studyId: string, actor = "system"): Promise<boolean> {
  const record = await dbGet<StudyRecord>("studies", studyId);
  if (!record) return false;
  if (record.lifecycle === "DELETED") throw new Error("Deleted study cannot be archived without an explicit restore review");
  await dbPut("studies", studyId, { ...record, lifecycle: "ARCHIVED" });
  await audit({ actor, action: "study.archive", resource: "study", resourceId: studyId, studyId, outcome: "ok", detail: "lifecycle=ARCHIVED; bytes retained" });
  return true;
}

export type TreatmentReviewAction =
  | "treatment_accept" | "treatment_modify" | "treatment_reject"
  | "treatment_add_medication" | "treatment_remove_medication"
  | "treatment_mark_contraindication" | "treatment_mark_restriction" | "treatment_note";

export interface ReviewInput {
  reviewer_id: string;
  action: "accept" | "reject" | "correct" | "note" | "add_observation" | "finalize" | "confirm" | "indeterminate" | "request_new_scan" | TreatmentReviewAction;
  finding_id?: string;
  note?: string;
  correction?: Partial<{ severity: string; location: string; explanation: string; type: string }>;
  observation?: { text: string; laterality?: "OD" | "OS" | "OU" | "UNKNOWN" };
  /** Explicit clinician-authored fields for final assessment; never AI-generated. */
  assessment?: { diagnosis?: string; impression?: string; plan?: string; follow_up?: string };
  // Treatment-review-only fields.
  condition_id?: string;
  medication_id?: string;
}

/** Validate clinician-authored finding amendments before storing them. This
 * is not a model-output validator (the AI finding is not changed); it simply
 * prevents prototype/payload surprises and keeps the additive review record
 * bounded and auditable. */
function sanitizeFindingCorrection(
  input: ReviewInput["correction"],
): Partial<{ severity: string; location: string; explanation: string; type: string }> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const out: Partial<{ severity: string; location: string; explanation: string; type: string }> = {};
  const allowed = ["severity", "location", "explanation", "type"] as const;
  for (const key of allowed) {
    if (!(key in input)) continue;
    const value = input[key];
    if (typeof value !== "string" || value.trim().length === 0 || value.length > 2000) return null;
    if (key === "severity" && !["none", "mild", "moderate", "severe", "indeterminate"].includes(value)) return null;
    out[key] = value.trim();
  }
  return Object.keys(out).length > 0 ? out : null;
}

function sanitizeAssessment(input: ReviewInput["assessment"]): NonNullable<ClinicalReport["clinician_final_assessment"]> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const clean = (v: unknown) => typeof v === "string" ? v.trim().slice(0, 4000) : "";
  const out = { diagnosis: clean(input.diagnosis), impression: clean(input.impression), plan: clean(input.plan), follow_up: clean(input.follow_up) };
  if (!Object.values(out).some(Boolean)) return null;
  return { ...out, reviewer_id: "", at: "" };
}

export async function submitReview(studyId: string, input: ReviewInput): Promise<ClinicalReport | null> {
  const report = await dbGet<ClinicalReport>("reports", `rep_${studyId}`);
  const analysis = await dbGet<AnalysisRecord>("analyses", `anl_${studyId}`);
  if (!report || !analysis) throw new Error("Analyzed study not found");
  const integrity = verifyReportVersionFreeze(report);
  if (!integrity.ok) {
    await audit({
      actor: `clinician:${input.reviewer_id}`,
      action: "review.integrity_rejected",
      studyId,
      outcome: "rejected",
      detail: integrity.reason,
    });
    throw new Error(`Immutable AI report integrity check failed: ${integrity.reason}`);
  }

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
        if (!f) throw new Error("Finding not found");
        const correction = sanitizeFindingCorrection(input.correction);
        if (!correction) throw new Error("Invalid finding correction");
        // Keep the model-produced finding immutable. The clinician's amended
        // fields are stored in a separate, additive record with the original
        // snapshot and reviewer provenance; downstream consumers can choose
        // which layer to display without losing the source output.
        report.clinician_corrections = [
          ...(report.clinician_corrections ?? []),
          {
            finding_id: f.id,
            original: { type: f.type, location: f.location, severity: f.severity, explanation: f.explanation },
            correction,
            reviewer_id: input.reviewer_id,
            note: input.note,
            at: change.at,
          },
        ];
        ci.finding_decisions = [...(ci.finding_decisions ?? []).filter((d) => d.finding_id !== input.finding_id),
          { finding_id: input.finding_id, decision: "correct", note: input.note, correction, at: change.at }];
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
    case "add_observation": {
      const text = typeof input.observation?.text === "string" && input.observation.text.trim().length > 0
        ? input.observation.text.trim().slice(0, 2000)
        : typeof input.note === "string" && input.note.trim().length > 0
          ? input.note.trim().slice(0, 2000)
          : "";
      if (!text) throw new Error("Clinician observation text is required");
      const laterality = input.observation?.laterality;
      if (laterality !== undefined && !["OD", "OS", "OU", "UNKNOWN"].includes(laterality)) {
        throw new Error("Invalid observation laterality");
      }
      report.clinician_observations = [
        ...(report.clinician_observations ?? []),
        { observation_id: newId("obs"), text, laterality, reviewer_id: input.reviewer_id, at: change.at },
      ];
      report.review.status = "clinician_reviewed";
      report.review.reviewer_id = input.reviewer_id;
      ci.overall = "amended";
      break;
    }
    case "treatment_accept":
    case "treatment_modify":
    case "treatment_reject":
    case "treatment_add_medication":
    case "treatment_remove_medication":
    case "treatment_mark_contraindication":
    case "treatment_mark_restriction":
    case "treatment_note": {
      // The AI-generated report.treatment_information is NEVER mutated here.
      // Clinician disposition is recorded as a separate, additive record.
      if (!input.condition_id) throw new Error("condition_id is required for treatment review actions");
      report.treatment_review = report.treatment_review ?? { reviewer_id: input.reviewer_id, decisions: [] };
      const decision: "accept" | "modify" | "reject" =
        input.action === "treatment_accept" ? "accept" :
        input.action === "treatment_reject" ? "reject" : "modify";
      report.treatment_review.decisions = [
        ...report.treatment_review.decisions.filter((d) => d.condition_id !== input.condition_id || input.action === "treatment_note"),
        {
          condition_id: input.condition_id,
          decision,
          added_medication_ids: input.action === "treatment_add_medication" && input.medication_id ? [input.medication_id] : undefined,
          removed_medication_ids: input.action === "treatment_remove_medication" && input.medication_id ? [input.medication_id] : undefined,
          contraindication_note: input.action === "treatment_mark_contraindication" ? (input.note ?? "") : undefined,
          patient_restriction_note: input.action === "treatment_mark_restriction" ? (input.note ?? "") : undefined,
          clinical_note: input.action === "treatment_note" ? (input.note ?? "") : undefined,
          at: change.at,
        },
      ];
      report.review.status = "clinician_reviewed";
      report.review.reviewer_id = input.reviewer_id;
      break;
    }
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
      const assessment = sanitizeAssessment(input.assessment);
      if (assessment) {
        report.clinician_final_assessment = { ...assessment, reviewer_id: input.reviewer_id, at: change.at };
      }
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
  /** Same-eye AI comparison (additive; legacy fields above are unchanged). */
  prior_current?: import("../evidence/priorCurrentComparison").PriorCurrentComparison;
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

  // Additive same-eye AI comparison (never breaks the legacy fields above:
  // any failure here leaves prior_current undefined and is audited).
  try {
    const { comparePriorCurrent } = await import("../evidence/priorCurrentComparison");
    const prevStudy = await dbGet<StudyRecord>("studies", previousStudyId);
    const curStudy = await dbGet<StudyRecord>("studies", currentStudyId);
    if (prevStudy && curStudy) {
      outcome.prior_current = comparePriorCurrent({
        prior_study_id: previousStudyId,
        current_study_id: currentStudyId,
        prior_eye: prevStudy.eye,
        current_eye: curStudy.eye,
        prior_analysis: prev.result,
        current_analysis: cur.result,
        prior_device: prevStudy.metadata.manufacturer || prevStudy.metadata.model
          ? { manufacturer: prevStudy.metadata.manufacturer, model: prevStudy.metadata.model }
          : null,
        current_device: curStudy.metadata.manufacturer || curStudy.metadata.model
          ? { manufacturer: curStudy.metadata.manufacturer, model: curStudy.metadata.model }
          : null,
      });
    }
  } catch (err) {
    await audit({ actor: "user", action: "compare", outcome: "error", detail: `prior_current unavailable: ${String(err instanceof Error ? err.message : err).slice(0, 150)}` });
  }

  await dbPut("comparisons", `${previousStudyId}__${currentStudyId}`, outcome);
  await audit({ actor: "user", action: "compare", outcome: "ok", detail: `${previousStudyId} vs ${currentStudyId}` });
  return outcome;
}
