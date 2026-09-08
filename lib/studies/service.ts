import { NormalizedStudy, DeviceMetadata, SecureFileImportAdapter, ScanType, EyeLaterality } from "../devices/adapter";
import { newId, saveOriginalScan, readOriginalScan, StoredFile, writeJson, deleteStudyFiles } from "../storage/files";
import { dbPut, dbGet, dbAll, dbDelete } from "../storage/db";
import { runPipeline } from "../analysis/pipeline";
import { AnalysisResult } from "../analysis/schema";
import { generateReport, ClinicalReport } from "../reports/generator";
import { runSafetyChecks } from "../clinical/safety";
import { audit, appendAnalysisAudit } from "../audit";
import { deleteDocument } from "../documents/service";
import { listAllDocumentRecords } from "../documents/repository";
import { deleteTestResultsForDocument } from "../documents/extraction/testResultService";
import { pickDemoScenario } from "../analysis/findings";
import { PatientSymptom, validateSymptoms, SYMPTOM_MAP } from "../clinical/symptoms";
import { ensurePatient, createEncounter } from "../patients/service";
import { getModel } from "../models/registry";

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
  /** Optional patient/tenant scope metadata. Legacy synthetic fixtures omit it. */
  tenant_id?: string | null;
  owner_user_id?: string | null;
  owner_username?: string | null;
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
  patientRef?: string,
  createdBy = "system",
  autoLinkPatient = false,
  scope?: { tenant_id?: string | null; owner_user_id?: string | null; owner_username?: string | null }
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
      await createEncounter({
        patient_id: patient.patient_id,
        linked_study_ids: [studyId],
        created_by: createdBy,
      });
    } catch {
      // The study remains usable if workspace provisioning is temporarily
      // unavailable; the failed link is visible in audit and can be retried.
      await audit({ actor: createdBy, action: "study.patient_link_failed", studyId, outcome: "error", detail: "patient workspace provisioning failed" });
    }
  }
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
    model_checksum: auditModelRecord?.sha256 ?? "n/a-placeholder",
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
    if (s.status === "rejected") {
      dashboard_status = "IMAGE_NOT_SUITABLE";
    } else if (s.status === "analyzed") {
      const analysisRecord = await dbGet<AnalysisRecord>("analyses", `anl_${s.study_id}`);
      const report = await dbGet<ClinicalReport>("reports", `rep_${s.study_id}`);
      triage_priority = analysisRecord?.result.recommendation.priority;
      const urgent = triage_priority === "emergency_evaluation" || triage_priority === "urgent_eye_care_review";
      const gate = analysisRecord?.result.diagnosis_gate;
      const hasClinicalContent =
        (analysisRecord?.result.findings.length ?? 0) > 0 ||
        (analysisRecord?.result.possible_conditions?.conditions.length ?? 0) > 0;
      if (urgent) {
        dashboard_status = "URGENT_REVIEW";
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

export async function deleteStudy(studyId: string): Promise<boolean> {
  const record = await dbGet<StudyRecord>("studies", studyId);
  if (!record) return false;
  await deleteStudyFiles(studyId);
  // Cascade: documents bound to this study are deleted with it (S1).
  const docs = await listAllDocumentRecords();
  for (const doc of docs) {
    if (doc.study_id === studyId && doc.status !== "DELETED") {
      await deleteTestResultsForDocument(doc.document_id);
      await deleteDocument(doc.document_id, "study_deletion_cascade");
    }
  }
  await dbDelete("studies", studyId);
  await dbDelete("analyses", `anl_${studyId}`);
  await dbDelete("reports", `rep_${studyId}`);
  await audit({ actor: "user", action: "delete", studyId, outcome: "ok", detail: "study and derived artifacts deleted" });
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
