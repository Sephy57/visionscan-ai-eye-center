/**
 * Append-only clinician review events.
 *
 * The report still contains a convenient current projection for existing UI
 * consumers, but this collection is the audit source for each review action.
 * An event carries the immutable AI snapshot hash, evidence references, the
 * reviewer-supplied reason, and the report version. Events are never updated.
 */

import { createHash, randomUUID } from "node:crypto";
import { dbAll, dbGet, dbPut } from "../storage/db";
import type { AnalysisRecord, ReviewInput } from "../studies/service";
import type { ClinicalReport } from "../reports/generator";

export const CLINICIAN_REVIEW_EVENT_SCHEMA_VERSION = "clinician-review-event-1.0.0";

export type ClinicianReviewReason =
  | "confirm"
  | "reject"
  | "correct"
  | "uncertain"
  | "request_new_scan"
  | "add_observation"
  | "treatment_review"
  | "adjudicate_conflict"
  | "finalize"
  | "note";

export interface ClinicianReviewEvent {
  review_event_id: string;
  schema_version: string;
  report_id: string;
  study_id: string;
  analysis_id: string;
  tenant_id?: string | null;
  reviewer_id: string;
  action: ReviewInput["action"];
  reason: ClinicianReviewReason;
  reason_note: string | null;
  finding_id: string | null;
  source_evidence_ids: string[];
  dependency_group_ids: string[];
  report_version: string;
  ai_snapshot_sha256: string;
  correction_laterality: string | null;
  clinician_payload: {
    note: string | null;
    correction: ReviewInput["correction"] | null;
    observation: ReviewInput["observation"] | null;
    assessment: ReviewInput["assessment"] | null;
    adjudication: ReviewInput["adjudication"] | null;
    condition_id: string | null;
    medication_id: string | null;
  };
  created_at: string;
  immutable: true;
  payload_sha256: string;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function reasonFor(action: ReviewInput["action"]): ClinicianReviewReason {
  if (action === "accept" || action === "confirm") return "confirm";
  if (action === "reject") return "reject";
  if (action === "correct") return "correct";
  if (action === "indeterminate") return "uncertain";
  if (action === "request_new_scan") return "request_new_scan";
  if (action === "add_observation") return "add_observation";
  if (action === "adjudicate_conflict") return "adjudicate_conflict";
  if (action.startsWith("treatment_")) return "treatment_review";
  if (action === "finalize") return "finalize";
  return "note";
}

function snapshotFor(report: ClinicalReport): Record<string, unknown> {
  return {
    report_id: report.report_id,
    report_version: report.report_version,
    version_freeze: report.version_freeze,
    analysis_mode: report.analysis_mode,
    model_execution: report.model_execution,
    model_execution_ledger: report.model_execution_ledger,
    findings: report.findings,
    uncertainty: report.uncertainty,
    provenance: report.provenance,
    safety: report.safety,
  };
}

function evidenceRefs(report: ClinicalReport, analysis: AnalysisRecord, findingId: string | undefined): string[] {
  if (findingId) return [`finding:${findingId}`];
  return [
    ...report.findings.map((finding) => `finding:${finding.id}`),
    ...(analysis.result.patient_context?.symptoms ?? []).map((symptom) => `symptom:${symptom.type}`),
    ...(report.asset_routing?.source_hash ? [`asset:${report.asset_routing.source_hash}`] : []),
  ];
}

function dependencyGroups(report: ClinicalReport, analysis: AnalysisRecord, findingId: string | undefined): string[] {
  const groups = (analysis.result.model_execution_ledger ?? [])
    .filter((row) => !findingId || analysis.result.findings.find((finding) => finding.id === findingId)?.model_id === row.model_id)
    .map((row) => row.dependency_group_id);
  return [...new Set(groups.length > 0 ? groups : findingId ? [`finding:${findingId}`] : ["report:review-context"])];
}

export function buildClinicianReviewEvent(
  report: ClinicalReport,
  analysis: AnalysisRecord,
  input: ReviewInput,
  now = new Date().toISOString(),
): ClinicianReviewEvent {
  const payload = {
    note: typeof input.note === "string" ? input.note.trim().slice(0, 4000) || null : null,
    correction: input.correction ?? null,
    observation: input.observation ?? null,
    assessment: input.assessment ?? null,
    adjudication: input.adjudication ?? null,
    condition_id: input.condition_id ?? null,
    medication_id: input.medication_id ?? null,
  };
  const reasonNote = typeof input.reason === "string"
    ? input.reason.trim().slice(0, 1000) || payload.note
    : payload.note;
  const eventWithoutHash = {
    schema_version: CLINICIAN_REVIEW_EVENT_SCHEMA_VERSION,
    report_id: report.report_id,
    study_id: report.study_id,
    analysis_id: analysis.analysis_id,
    tenant_id: ((report as unknown as { tenant_id?: string | null }).tenant_id ?? null),
    reviewer_id: input.reviewer_id,
    action: input.action,
    reason: reasonFor(input.action),
    reason_note: reasonNote,
    finding_id: input.finding_id ?? null,
    source_evidence_ids: evidenceRefs(report, analysis, input.finding_id),
    dependency_group_ids: dependencyGroups(report, analysis, input.finding_id),
    report_version: report.report_version,
    ai_snapshot_sha256: sha256(snapshotFor(report)),
    correction_laterality: typeof input.correction?.laterality === "string" ? input.correction.laterality : null,
    clinician_payload: payload,
    created_at: now,
    immutable: true as const,
  };
  return {
    review_event_id: `review_event_${randomUUID()}`,
    ...eventWithoutHash,
    payload_sha256: sha256(eventWithoutHash),
  };
}

export async function recordClinicianReviewEvent(event: ClinicianReviewEvent): Promise<void> {
  if (await dbGet<ClinicianReviewEvent>("clinician_reviews", event.review_event_id)) {
    throw new Error("IMMUTABLE_REVIEW_EVENT_EXISTS");
  }
  await dbPut("clinician_reviews", event.review_event_id, event);
}

export async function listClinicianReviewEvents(reportId: string): Promise<ClinicianReviewEvent[]> {
  const events = await dbAll<ClinicianReviewEvent>("clinician_reviews");
  return events.filter((event) => event.report_id === reportId).sort((a, b) => a.created_at.localeCompare(b.created_at));
}
