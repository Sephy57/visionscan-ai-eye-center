import { AnalysisResult } from "../analysis/schema";
import { dbGet, dbPut } from "../storage/db";
import { writeJson } from "../storage/files";
import { DEMO_LABEL, VALIDATION_STATUS_BANNER } from "../config";
import { OPHTHALMIC_COVERAGE_REGISTRY, OPHTHALMIC_COVERAGE_VERSION } from "../models/ophthalmicCoverage";
import { canonicalModality } from "../models/modalities";
import { REPORT_AI_SNAPSHOT_VERSION, REASONING_RECORD_SCHEMA_VERSION, reportAiPayload, sha256Canonical, presentReportWithLegacyStatus, type ReportVersionFreeze } from "./integrity";
import { EVIDENCE_TAXONOMY_VERSION } from "../evidence/conditionTaxonomy";
import { REASONING_ENGINE_VERSION } from "../models/reasoningEngine";
import { VALIDATION_REGISTRY_VERSION } from "../models/validationRegistry";
import { SPECIALIST_PACKAGE_VERSION } from "../clinical/specialistPackages";
import type { ImmutableReasoningRecord } from "./reasoningRecord";

export const REPORT_VERSION = "1.2.0";

/**
 * Report Generator.
 *
 * Builds a clinical report from the structured analysis result ONLY.
 * The report generator cannot add, alter, or delete findings (safety rule:
 * the explanation layer never modifies underlying structured findings).
 * No clinician names or signatures are generated.
 */

export interface ClinicalReport {
  report_id: string;
  study_id: string;
  generated_at: string;
  report_version: string;
  /** Hash/version seal over server-generated AI fields. Clinician-authored
   * review fields are additive and deliberately excluded from this seal. */
  version_freeze: ReportVersionFreeze;
  legacy_status?: "LEGACY_UNSEALED";
  legacy_warning?: string;
  /** Immutable, self-contained specialist/condition reasoning produced from
   * this exact analysis. It is attached before the report is published. */
  reasoning_snapshot?: ImmutableReasoningRecord;
  validation_banner: string;
  demo_label: string;
  patient: {
    // Only what the user chose to provide; system invents nothing.
    identifier?: string | null;
    age_band?: string | null;      // e.g. "60-69" - optional, coarse
    notes?: string | null;
  };
  study: AnalysisResult["study"];
  analysis_mode: AnalysisResult["analysis_mode"];
  asset_routing?: AnalysisResult["asset_routing"];
  document_routing?: AnalysisResult["document_routing"];
  model_execution: AnalysisResult["model_execution"];
  model_execution_ledger?: AnalysisResult["model_execution_ledger"];
  oct_region_results?: AnalysisResult["oct_region_results"];
  oct_aggregation?: AnalysisResult["oct_aggregation"];
  image_quality: AnalysisResult["quality"];
  overall_result: string;
  findings: AnalysisResult["findings"];
  possible_associations_note: string;
  uncertainty: AnalysisResult["uncertainty"];
  measurements_note: string;
  limitations: string[];
  recommended_next_step: string;
  triage_priority: string;
  coverage_snapshot: {
    registry_version: string;
    production_targets: string[];
    general_detector_state: string;
    candidate_targets_not_run: string[];
    unsupported_targets: string[];
    notice: string;
  };
  // Report structure (Phase 5, Step 20): patient-reported symptoms, possible
  // conditions, symptom/finding correlation, and treatment information are
  // distinct sections, carried straight through from the AI-generated
  // AnalysisResult - never re-derived or re-worded by the report layer.
  patient_context?: AnalysisResult["patient_context"];
  symptom_correlation?: AnalysisResult["symptom_correlation"];
  possible_conditions?: AnalysisResult["possible_conditions"];
  treatment_information?: AnalysisResult["treatment_information"];
  review: {
    status: "ai_only" | "clinician_reviewed" | "clinician_finalized";
    reviewer_id?: string;
    finalized_at?: string;
    clinician_changes?: Array<{ field: string; action: string; note?: string; at: string }>;
  };
  // AI OUTPUT, CLINICIAN INTERPRETATION and FINAL REPORT are stored separately
  // and never overwrite one another.
  clinician_interpretation?: {
    reviewer_id: string;
    overall: "confirmed_ai_findings" | "rejected_ai_findings" | "indeterminate" | "request_new_scan" | "amended" | string;
    finding_decisions?: Array<{ finding_id: string; decision: "confirm" | "reject" | "correct" | "indeterminate"; note?: string; correction?: Partial<{ severity: string; location: string; explanation: string; type: string }>; at: string }>;
    notes?: string | null;
    at: string;
  } | null;
  /** Additive clinician amendments; the original AI `findings` array above
   * remains byte-for-byte unchanged when a finding is corrected. */
  clinician_corrections?: Array<{
    finding_id: string;
    original: { type: string; location: string; severity: string; explanation: string };
    correction: Partial<{ severity: string; location: string; explanation: string; type: string }>;
    reviewer_id: string;
    note?: string;
    at: string;
  }>;
  /** Human observations are stored separately from automated findings and
   * are never fed back into the model output. */
  clinician_observations?: Array<{
    observation_id: string;
    text: string;
    laterality?: "OD" | "OS" | "OU" | "UNKNOWN";
    reviewer_id: string;
    at: string;
  }>;
  // Clinician's disposition of the AI-generated treatment information ONLY -
  // the AI-generated treatment_information above is never mutated.
  treatment_review?: {
    reviewer_id: string;
    decisions: Array<{
      condition_id: string;
      decision: "accept" | "modify" | "reject";
      added_medication_ids?: string[];
      removed_medication_ids?: string[];
      contraindication_note?: string;
      patient_restriction_note?: string;
      clinical_note?: string;
      at: string;
    }>;
  } | null;
  final_interpretation?: string | null;
  /** Structured clinician-authored assessment; never populated by AI. */
  clinician_final_assessment?: {
    diagnosis?: string | null;
    impression?: string | null;
    plan?: string | null;
    follow_up?: string | null;
    reviewer_id: string;
    at: string;
  } | null;
  // S12: carried straight through from the AI-generated AnalysisResult -
  // never re-derived or weakened by the report layer. See
  // clinicalInterpretationLabel() below for the fail-closed accessor.
  diagnosis_gate?: AnalysisResult["diagnosis_gate"];
  provenance: AnalysisResult["provenance"];
  safety: AnalysisResult["safety"];
  exports: {
    json_path?: string;
    fhir_note: string;
  };
}

export const POSSIBLE_ASSOCIATIONS_NOTE =
  "Where the report mentions possible clinical associations, wording is used deliberately: a finding can be " +
  "ASSOCIATED with a condition; this does not establish a diagnosis. OBSERVED FINDING, POSSIBLE ASSOCIATIONS, " +
  "and CONFIRMED DIAGNOSIS are distinct categories. Only a qualified clinician can establish a final diagnosis.";

export const MEASUREMENTS_NOTE =
  "Measurements are reported only when actually computed by an implemented, calibrated component. No component " +
  "currently produces validated quantitative measurements; any numeric values in findings are demo placeholders " +
  "and must not be used clinically.";

/**
 * S12 - fail-closed accessor for whether this result's clinical
 * interpretation is allowed to use diagnostic language. Any report/result
 * rendering surface that ever needs to choose between "diagnosis" and
 * "requires clinical correlation" wording MUST go through this (or
 * `report.diagnosis_gate` directly) rather than inventing that decision
 * itself. Missing gate data (e.g. a pre-S12 stored result) is treated as
 * closed, never as open.
 */
export function clinicalInterpretationLabel(
  r: Pick<AnalysisResult, "diagnosis_gate">
): "DIAGNOSIS" | "REQUIRES_CLINICAL_CORRELATION" {
  return r.diagnosis_gate?.clinical_interpretation ?? "REQUIRES_CLINICAL_CORRELATION";
}

export function buildOverallResult(r: AnalysisResult): string {
  if (r.quality.acceptable === false) {
    return "IMAGE QUALITY INSUFFICIENT FOR RELIABLE AUTOMATED ANALYSIS";
  }
  const modality = canonicalModality(r.study.modality);
  if (r.analysis_mode === "MODEL_FAILED") return "RESEARCH MODEL ANALYSIS FAILED — NO FINDING INFERRED";
  if (r.analysis_mode === "NO_MODEL_EXECUTED") return "NO APPLICABLE RESEARCH MODEL EXECUTED — AUTOMATED INTERPRETATION UNAVAILABLE";
  if (modality === "OCT") {
    if (r.oct_assessment?.state === "CLASS_ESTIMATED") return "OCT TARGET CLASS ESTIMATED BY RESEARCH AI — CLINICIAN REVIEW REQUIRED";
    if (r.oct_assessment?.state === "OUT_OF_DISTRIBUTION") return "OCT INPUT OUT OF DISTRIBUTION — AUTOMATED INTERPRETATION INCONCLUSIVE";
    if (r.oct_assessment?.state === "MODEL_UNAVAILABLE") return "OCT RESEARCH MODEL UNAVAILABLE — CLINICAL INTERPRETATION NOT AVAILABLE";
  }
  // A missing general detector is an availability limitation, never a
  // negative screening result. This check intentionally precedes legacy demo
  // findings so a synthetic scenario cannot make a real image appear covered.
  if (modality === "FUNDUS" && (r.fundus_abnormality?.state === "MODEL_UNAVAILABLE" || r.fundus_abnormality?.state === "MODEL_NOT_VALIDATED_FOR_IMAGE")) {
    return "GENERAL FUNDUS ABNORMALITY MODEL UNAVAILABLE — CLINICAL INTERPRETATION NOT AVAILABLE";
  }
  if (modality === "FUNDUS" && r.fundus_abnormality?.state === "OUT_OF_DISTRIBUTION") {
    return "INPUT OUT OF DISTRIBUTION — AUTOMATED FUNDUS INTERPRETATION INCONCLUSIVE";
  }
  if (modality === "FUNDUS" && (r.fundus_abnormality?.state === "SUSPICIOUS_ABNORMALITY" || r.fundus_abnormality?.state === "MULTIPLE_ABNORMALITIES")) {
    return "SUSPICIOUS FUNDUS ABNORMALITY DETECTED BY RESEARCH AI — OPHTHALMIC REVIEW REQUIRED";
  }
  if (r.findings.length === 0) {
    // Keep the established overall-result wording for compatibility with
    // stored reports; the explicit analysis_mode/model_execution fields and
    // the UI badge distinguish a completed research negative from a demo or
    // no-model state. This wording never claims normality or health.
    return "NO TARGET ABNORMALITY IDENTIFIED BY THE AVAILABLE MODEL — OTHER ABNORMALITIES MAY STILL BE PRESENT";
  }
  const result = "POTENTIAL ABNORMAL FINDING DETECTED";
  // S12 safety guard: this legacy pipeline never emits diagnostic ("this is
  // X condition") wording - only correlation-required "potential finding"
  // wording. Assert that invariant against the diagnosis gate so a future
  // edit to this function cannot silently start producing diagnostic-
  // sounding text without the gate actually having allowed it.
  if (/\bDIAGNOS/i.test(result) && clinicalInterpretationLabel(r) !== "DIAGNOSIS") {
    throw new Error("Safety violation: diagnostic-sounding overall_result produced without diagnosis gate approval.");
  }
  return result;
}

export function buildLimitations(r: AnalysisResult): string[] {
  const researchPath = r.analysis_mode === "RESEARCH_MODEL_ANALYSIS" || r.analysis_mode === "MIXED_RESEARCH_AND_DEMO" || (r.model_registry?.model_status === "RESEARCH" && r.demo?.synthetic_result === false);
  const researchLabel = /oct/i.test(r.model_registry?.model_id ?? "") ? "OCT classifier" : /dr|grading/i.test(r.model_registry?.model_id ?? "") ? "DR grader" : "fundus lesion detector";
  const l: string[] = [
    VALIDATION_STATUS_BANNER,
    researchPath
      ? `The ${researchLabel} is a RESEARCH model running real local inference; it is not clinically validated and its output consists of uncalibrated observations only.`
      : r.analysis_mode === "MODEL_FAILED" ? "Applicable research model execution failed; no finding was inferred and no DEMO substitute was used."
        : r.analysis_mode === "NO_MODEL_EXECUTED" ? "No applicable research model executed for this asset; absence of findings is not evidence of normality."
          : "All detection and segmentation components in this deployment are unvalidated placeholders or heuristics.",
    researchPath
      ? `Findings are ${researchLabel} outputs from real image pixels; they are not validated clinical conclusions, carry no calibrated confidence, and require ophthalmic review.`
      : r.analysis_mode === "MODEL_FAILED" ? "Research execution failed; this report contains no synthetic replacement result."
        : r.analysis_mode === "NO_MODEL_EXECUTED" ? "No model output is present; the system does not infer normality from this state."
          : "Findings are synthetic demo outputs generated to exercise the pipeline; they do not derive from a validated medical model.",
    "No validated reference databases are installed; measurements are not compared against population references.",
    "Device-specific calibration and per-device validation have not been performed.",
    "This system is not a medical device and is not authorized for clinical use.",
  ];
  if (r.quality.acceptable === false) {
    l.push("The quality gate failed; no clinical interpretation was attempted.");
  }
  if (r.fundus_abnormality?.state === "MODEL_UNAVAILABLE") {
    l.push("No general fundus-abnormality detector was available for this image. The report does not claim a normal fundus.");
  }
  if (r.dr_assessment?.state === "GRADE_ESTIMATED") {
    l.push(
      `A research DR grader estimated grade ${r.dr_assessment.grade}/4 (${r.dr_assessment.grade_label?.replaceAll("_", " ")}; uncalibrated model score, not a probability). ` +
      "Grade estimates do not establish or exclude diabetic retinopathy and are not referral decisions."
    );
  }
  if (r.multi_model && r.multi_model.performed) {
    l.push(`Multi-model research comparison: ${r.multi_model.agreement.replaceAll("_", " ")} — ${r.multi_model.notes[0] ?? "see result detail."}`.slice(0, 500));
  }
  if (r.oct_assessment?.state === "CLASS_ESTIMATED") {
    l.push(
      `A research OCT classifier estimated class ${r.oct_assessment.predicted_class} (uncalibrated backbone argmax, not a probability). ` +
      "Class estimates do not establish or exclude macular disease and are not diagnoses."
    );
  }
  if (r.asset_routing) {
    l.push(`Asset routing: ${r.asset_routing.container_type} / ${r.asset_routing.modality_state}; device=${r.asset_routing.device_state}; domain=${r.asset_routing.domain_state}.`);
  }
  if (r.oct_region_results?.length) {
    l.push(`${r.oct_region_results.filter((x) => x.status === "EXECUTED").length} bounded OCT B-scan ROI(s) were analyzed; each ROI retains source-page and ROI hashes. Non-B-scan page content was excluded from OCT inference.`);
  }
  return l;
}

export async function generateReport(
  analysis: AnalysisResult,
  patient?: ClinicalReport["patient"],
  reasoningSnapshot?: ImmutableReasoningRecord,
): Promise<ClinicalReport> {
  const existing = await dbGet<ClinicalReport>("reports", `rep_${analysis.study.study_id}`);
  if (existing?.review.status === "clinician_finalized") {
    throw new Error("Finalized report is immutable; create a new study/version instead of rerunning analysis.");
  }
  if (existing && (!existing.version_freeze || !existing.reasoning_snapshot)) {
    throw new Error("Legacy report is unsealed; explicit replay/versioning is required before replacing it.");
  }
  if (reasoningSnapshot && (
    reasoningSnapshot.study_id !== analysis.study.study_id ||
    reasoningSnapshot.report_id !== `rep_${analysis.study.study_id}` ||
    reasoningSnapshot.source_analysis_sha256 !== sha256Canonical(analysis)
  )) throw new Error("Reasoning snapshot does not match this analysis/report");
  const report: ClinicalReport = {
    report_id: `rep_${analysis.study.study_id}`,
    study_id: analysis.study.study_id,
    generated_at: new Date().toISOString(),
    report_version: REPORT_VERSION,
    validation_banner: VALIDATION_STATUS_BANNER,
    demo_label: analysis.analysis_mode === "DEMO_ONLY" ? DEMO_LABEL
      : analysis.analysis_mode === "MODEL_FAILED" ? "RESEARCH MODEL ANALYSIS FAILED — NO SYNTHETIC FALLBACK"
        : analysis.analysis_mode === "NO_MODEL_EXECUTED" ? "NO MODEL EXECUTED — INTERPRETATION UNAVAILABLE"
          : (analysis.model_registry?.display_label ?? VALIDATION_STATUS_BANNER),
    patient: patient ?? { identifier: null, age_band: null, notes: null },
    study: analysis.study,
    analysis_mode: analysis.analysis_mode,
    asset_routing: analysis.asset_routing,
    document_routing: analysis.document_routing,
    model_execution: analysis.model_execution,
    model_execution_ledger: analysis.model_execution_ledger,
    oct_region_results: analysis.oct_region_results,
    oct_aggregation: analysis.oct_aggregation,
    image_quality: analysis.quality,
    overall_result: buildOverallResult(analysis),
    findings: analysis.findings,
    possible_associations_note: POSSIBLE_ASSOCIATIONS_NOTE,
    uncertainty: analysis.uncertainty,
    measurements_note: MEASUREMENTS_NOTE,
    limitations: buildLimitations(analysis),
    recommended_next_step: analysis.recommendation.action,
    triage_priority: analysis.recommendation.priority,
    coverage_snapshot: {
      registry_version: OPHTHALMIC_COVERAGE_VERSION,
      production_targets: OPHTHALMIC_COVERAGE_REGISTRY.filter((entry) => entry.production_available && entry.pipeline_enabled).map((entry) => entry.target_id),
      general_detector_state: analysis.fundus_abnormality?.state ?? "MODEL_UNAVAILABLE",
      candidate_targets_not_run: OPHTHALMIC_COVERAGE_REGISTRY.filter((entry) => entry.state === "CANDIDATE_DISABLED").map((entry) => entry.target_id),
      unsupported_targets: OPHTHALMIC_COVERAGE_REGISTRY.filter((entry) => entry.state === "NO_VALIDATED_MODEL_AVAILABLE" || entry.state === "UNSUPPORTED_IMAGE_ANALYSIS").map((entry) => entry.target_id),
      notice: "Missing, disabled, or unsupported model coverage is not evidence of normality or absence of pathology.",
    },
    patient_context: analysis.patient_context,
    symptom_correlation: analysis.symptom_correlation,
    possible_conditions: analysis.possible_conditions,
    treatment_information: analysis.treatment_information,
    reasoning_snapshot: reasoningSnapshot ? structuredClone(reasoningSnapshot) : undefined,
    diagnosis_gate: analysis.diagnosis_gate,
    review: { status: "ai_only" },
    provenance: analysis.provenance,
    safety: analysis.safety,
    exports: {
      fhir_note:
        "FHIR-compatible export is architecturally planned (Observation/DiagnosticReport resources). " +
        "Not yet implemented - no FHIR payload is produced by this version.",
    },
    // Assigned below once every AI-owned field has been constructed.
    version_freeze: undefined as unknown as ReportVersionFreeze,
  };

  report.version_freeze = {
    snapshot_version: REPORT_AI_SNAPSHOT_VERSION,
    report_version: REPORT_VERSION,
    pipeline_version: analysis.provenance.pipeline_version,
    pipeline_ruleset_version: analysis.provenance.ruleset_version,
    coverage_registry_version: OPHTHALMIC_COVERAGE_VERSION,
    evidence_taxonomy_version: EVIDENCE_TAXONOMY_VERSION,
    condition_knowledge_version: EVIDENCE_TAXONOMY_VERSION,
    specialist_rules_version: SPECIALIST_PACKAGE_VERSION,
    validation_registry_version: VALIDATION_REGISTRY_VERSION,
    reasoning_engine_version: REASONING_ENGINE_VERSION,
    reasoning_record_schema_version: REASONING_RECORD_SCHEMA_VERSION,
    source_analysis_sha256: sha256Canonical(analysis),
    ai_payload_sha256: sha256Canonical(reportAiPayload(report)),
    frozen_at: report.generated_at,
  };

  await dbPut("reports", report.report_id, report);
  report.exports.json_path = await writeJson("reports", report.report_id, report);
  return report;
}

export async function getReport(reportId: string): Promise<ClinicalReport | null> {
  const report = await dbGet<ClinicalReport>("reports", reportId);
  return report ? presentReportWithLegacyStatus(report) : null;
}

/** Attach exactly one immutable reasoning snapshot and reseal the complete
 * AI report before any clinician review can be accepted. */
export async function attachReasoningSnapshot(
  report: ClinicalReport,
  snapshot: ImmutableReasoningRecord,
): Promise<ClinicalReport> {
  if (report.review.status !== "ai_only") throw new Error("Cannot change the AI reasoning snapshot after clinician review has started");
  if (snapshot.study_id !== report.study_id || snapshot.report_id !== report.report_id) throw new Error("Reasoning snapshot report scope mismatch");
  if (report.reasoning_snapshot && report.reasoning_snapshot.payload_sha256 !== snapshot.payload_sha256) {
    throw new Error("Immutable reasoning snapshot already exists for this report");
  }
  report.report_version = REPORT_VERSION;
  report.reasoning_snapshot = structuredClone(snapshot);
  report.version_freeze = {
    snapshot_version: REPORT_AI_SNAPSHOT_VERSION,
    report_version: report.report_version,
    pipeline_version: report.provenance.pipeline_version,
    pipeline_ruleset_version: report.provenance.ruleset_version,
    coverage_registry_version: report.coverage_snapshot.registry_version,
    evidence_taxonomy_version: snapshot.version_freeze.evidence_taxonomy_version,
    condition_knowledge_version: snapshot.version_freeze.condition_knowledge_version,
    specialist_rules_version: snapshot.version_freeze.specialist_rules_version,
    validation_registry_version: snapshot.version_freeze.validation_registry_version,
    reasoning_engine_version: snapshot.version_freeze.reasoning_engine_version,
    reasoning_record_schema_version: snapshot.record_schema_version,
    source_analysis_sha256: snapshot.source_analysis_sha256,
    ai_payload_sha256: "",
    frozen_at: new Date().toISOString(),
  };
  report.version_freeze.ai_payload_sha256 = sha256Canonical(reportAiPayload(report));
  await dbPut("reports", report.report_id, report);
  report.exports.json_path = await writeJson("reports", report.report_id, report);
  return report;
}
