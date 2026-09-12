import { createHash } from "crypto";
import type { AnalysisResult } from "../analysis/schema";

/** Version of the immutable AI-report payload contract, not a clinical ruleset. */
export const REPORT_AI_SNAPSHOT_VERSION = "1.0.0";
export const REASONING_RECORD_SCHEMA_VERSION = "1.0.0";

export type LegacyReportStatus = "LEGACY_UNSEALED";

/**
 * Present a report without mutating the stored record. Legacy JSON imports
 * may not have a version seal or reasoning snapshot; callers must see an
 * explicit warning while the integrity gate continues to reject finalization.
 */
export function presentReportWithLegacyStatus<T extends { version_freeze?: unknown; reasoning_snapshot?: unknown }>(
  report: T,
): T & { legacy_status?: LegacyReportStatus; legacy_warning?: string } {
  const presented = (typeof structuredClone === "function" ? structuredClone(report) : JSON.parse(JSON.stringify(report)) as T) as T & { legacy_status?: LegacyReportStatus; legacy_warning?: string };
  if (!presented.version_freeze || !presented.reasoning_snapshot) {
    presented.legacy_status = "LEGACY_UNSEALED";
    presented.legacy_warning = "Legacy report is unsealed: immutable version freeze or reasoning snapshot is missing. Clinician verification is required; no seal was fabricated.";
  }
  return presented;
}

export interface ReportVersionFreeze {
  snapshot_version: typeof REPORT_AI_SNAPSHOT_VERSION;
  report_version: string;
  pipeline_version: string;
  pipeline_ruleset_version: string;
  coverage_registry_version: string;
  evidence_taxonomy_version: string;
  condition_knowledge_version: string;
  specialist_rules_version: string;
  validation_registry_version: string;
  reasoning_engine_version: string;
  reasoning_record_schema_version: string;
  source_analysis_sha256: string;
  ai_payload_sha256: string;
  frozen_at: string;
}

/**
 * Canonical JSON used only for integrity/version records. Sorting object keys
 * prevents a harmless serialization-order change from looking like tampering.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item === undefined ? null : item)).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).filter((key) => object[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
}

export function sha256Canonical(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

/**
 * Select only server-generated AI/report fields. Clinician interpretation,
 * amendments, observations, and review state intentionally live outside this
 * payload so authorized additive review does not rewrite the frozen AI layer.
 */
export function reportAiPayload(report: {
  report_id: string;
  study_id: string;
  report_version: string;
  validation_banner: string;
  demo_label: string;
  study: AnalysisResult["study"];
  analysis_mode: AnalysisResult["analysis_mode"];
  asset_routing?: AnalysisResult["asset_routing"];
  document_routing?: AnalysisResult["document_routing"];
  model_execution: AnalysisResult["model_execution"];
  model_execution_ledger?: AnalysisResult["model_execution_ledger"];
  claim_ledger?: AnalysisResult["claim_ledger"];
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
  coverage_snapshot: unknown;
  patient_context?: AnalysisResult["patient_context"];
  symptom_correlation?: AnalysisResult["symptom_correlation"];
  possible_conditions?: AnalysisResult["possible_conditions"];
  treatment_information?: AnalysisResult["treatment_information"];
  diagnosis_gate?: AnalysisResult["diagnosis_gate"];
  provenance: AnalysisResult["provenance"];
  safety: AnalysisResult["safety"];
  reasoning_snapshot?: unknown;
}): Record<string, unknown> {
  return {
    report_id: report.report_id,
    study_id: report.study_id,
    report_version: report.report_version,
    validation_banner: report.validation_banner,
    demo_label: report.demo_label,
    study: report.study,
    analysis_mode: report.analysis_mode,
    asset_routing: report.asset_routing,
    document_routing: report.document_routing,
    model_execution: report.model_execution,
    model_execution_ledger: report.model_execution_ledger,
    claim_ledger: report.claim_ledger,
    oct_region_results: report.oct_region_results,
    oct_aggregation: report.oct_aggregation,
    image_quality: report.image_quality,
    overall_result: report.overall_result,
    findings: report.findings,
    possible_associations_note: report.possible_associations_note,
    uncertainty: report.uncertainty,
    measurements_note: report.measurements_note,
    limitations: report.limitations,
    recommended_next_step: report.recommended_next_step,
    triage_priority: report.triage_priority,
    coverage_snapshot: report.coverage_snapshot,
    patient_context: report.patient_context,
    symptom_correlation: report.symptom_correlation,
    possible_conditions: report.possible_conditions,
    treatment_information: report.treatment_information,
    diagnosis_gate: report.diagnosis_gate,
    provenance: report.provenance,
    safety: report.safety,
    reasoning_snapshot: report.reasoning_snapshot,
  };
}

export function verifyReportVersionFreeze(
  report: Parameters<typeof reportAiPayload>[0] & { version_freeze?: ReportVersionFreeze },
): { ok: true } | { ok: false; reason: "MISSING_VERSION_FREEZE" | "MISSING_REASONING_SNAPSHOT" | "AI_PAYLOAD_HASH_MISMATCH" | "VERSION_METADATA_MISMATCH" } {
  const freeze = report.version_freeze;
  if (!freeze) return { ok: false, reason: "MISSING_VERSION_FREEZE" };
  if (
    freeze.snapshot_version !== REPORT_AI_SNAPSHOT_VERSION ||
    freeze.report_version !== report.report_version ||
    freeze.pipeline_version !== report.provenance.pipeline_version ||
    freeze.pipeline_ruleset_version !== report.provenance.ruleset_version
  ) return { ok: false, reason: "VERSION_METADATA_MISMATCH" };
  const reasoning = report.reasoning_snapshot as {
    record_schema_version?: string;
    source_analysis_sha256?: string;
    version_freeze?: { evidence_taxonomy_version?: string; reasoning_engine_version?: string };
  } | undefined;
  if (!reasoning) return { ok: false, reason: "MISSING_REASONING_SNAPSHOT" };
  if (
    freeze.reasoning_record_schema_version !== reasoning.record_schema_version ||
    freeze.source_analysis_sha256 !== reasoning.source_analysis_sha256 ||
    freeze.evidence_taxonomy_version !== reasoning.version_freeze?.evidence_taxonomy_version ||
    freeze.reasoning_engine_version !== reasoning.version_freeze?.reasoning_engine_version
  ) return { ok: false, reason: "VERSION_METADATA_MISMATCH" };
  return sha256Canonical(reportAiPayload(report)) === freeze.ai_payload_sha256
    ? { ok: true }
    : { ok: false, reason: "AI_PAYLOAD_HASH_MISMATCH" };
}
