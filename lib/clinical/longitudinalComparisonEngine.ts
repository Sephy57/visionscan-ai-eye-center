/**
 * Longitudinal Comparison Engine (Phase 5, §20-25).
 *
 * StructuredClinicalEvidence (prior) + StructuredClinicalEvidence (current)
 * -> StructuredComparisonResult, and, across an entire timeline,
 * -> StructuredLongitudinalResult.
 *
 * HARD RULE: this is evidence comparison over time, NOT disease-progression
 * prediction. It reuses Phase 4's StructuredClinicalEvidence unmodified,
 * lib/evidence/measurementTrend.ts / findingComparison.ts / symptomTrend.ts
 * (new this phase, but each independently pure/deterministic), and
 * re-derives urgent flags completely independently of any historical
 * comparison (§27 - a normal prior visit must never cancel current
 * urgency). lib/models/diagnosisGate.ts is never called here.
 */

import { dbGet } from "../storage/db";
import type { StudyRecord, AnalysisRecord } from "../studies/service";
import { buildPatientTimeline, type PatientTimeline } from "../patients/timeline";
import { buildStructuredClinicalEvidence, type StructuredClinicalEvidence } from "../evidence/structuredClinicalEvidence";
import { compareMeasurements, type MeasurementComparison } from "../evidence/measurementTrend";
import { compareFindings, type FindingComparisonResult, type VisitFindingContext } from "../evidence/findingComparison";
import { compareSymptoms, type SymptomTrend } from "../evidence/symptomTrend";
import { redFlagSymptoms } from "./symptoms";
import type { EvidenceItem } from "../evidence/types";

export const LONGITUDINAL_ENGINE_VERSION = "1.0.0";

export interface StructuredComparisonResult {
  prior_study_id: string;
  current_study_id: string;
  measurement_changes: MeasurementComparison[];
  finding_changes: FindingComparisonResult[];
  non_comparable_reason: string | null; // set when finding_changes is a single NOT_COMPARABLE/MODEL_CHANGED/etc. entry
}

export interface StructuredLongitudinalResult {
  patient_ref: string | null;
  study_ids: string[]; // chronological order, as verified by buildPatientTimeline - never caller-trusted order
  timeline: PatientTimeline;
  pairwise_comparisons: StructuredComparisonResult[]; // one per consecutive visit pair
  symptom_trends: SymptomTrend[]; // across the FULL timeline (all visits vs. most recent)
  urgent_flags_current_visit: Array<{ symptom_type: string; label: string; urgency: "emergency" | "urgent" }>;
  missing_prior_evidence: boolean; // true if fewer than 2 studies were available to compare
  conflicts_across_timeline: string[]; // human-readable notes, not a duplicate conflict-detection system - see note below
  limitations: string[];
  generated_at: string;
  engine_version: string;
  requires_clinician_review: true;
}

function findingContextFrom(study: StudyRecord, analysis: AnalysisRecord | null): VisitFindingContext {
  const result = analysis?.result;
  return {
    study_id: study.study_id,
    eye: study.eye,
    findings: result?.findings ?? [],
    model_available: !!result && result.quality.acceptable,
    device: study.metadata.manufacturer || study.metadata.model ? { manufacturer: study.metadata.manufacturer, model: study.metadata.model } : null,
    quality_status: (result?.quality.status as "pass" | "borderline" | "fail" | undefined) ?? "unknown",
  };
}

/**
 * Compares exactly two visits (§21's LongitudinalComparisonEngine.compare()).
 * Deterministic: identical inputs always produce identical output.
 */
export async function compareVisits(priorStudyId: string, currentStudyId: string): Promise<StructuredComparisonResult> {
  const priorSCE = await buildStructuredClinicalEvidence(priorStudyId, { includeSpecialists: false });
  const currentSCE = await buildStructuredClinicalEvidence(currentStudyId, { includeSpecialists: false });
  if ("not_found" in priorSCE || "not_found" in currentSCE) {
    throw new Error("compareVisits: one or both studies not found.");
  }

  const priorStudy = await dbGet<StudyRecord>("studies", priorStudyId);
  const currentStudy = await dbGet<StudyRecord>("studies", currentStudyId);
  const priorAnalysis = await dbGet<AnalysisRecord>("analyses", `anl_${priorStudyId}`);
  const currentAnalysis = await dbGet<AnalysisRecord>("analyses", `anl_${currentStudyId}`);
  if (!priorStudy || !currentStudy) throw new Error("compareVisits: study record missing.");

  // Direct library callers do not pass through the HTTP scope guard, so the
  // comparison engine repeats the same patient and tenant isolation checks
  // before combining evidence from two visits. Legacy records with no scope
  // metadata remain comparable to each other for local development only.
  const normalizeRef = (value: string | null | undefined): string | null => {
    const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
    return normalized || null;
  };
  const normalizeTenant = (value: string | null | undefined): string | null => {
    const normalized = typeof value === "string" ? value.trim() : "";
    return normalized || null;
  };
  const priorPatient = normalizeRef(priorStudy.patient_ref);
  const currentPatient = normalizeRef(currentStudy.patient_ref);
  if (priorPatient && currentPatient && priorPatient !== currentPatient) {
    throw new Error("compareVisits: studies belong to different patients.");
  }
  if (normalizeTenant(priorStudy.tenant_id) !== normalizeTenant(currentStudy.tenant_id)) {
    throw new Error("compareVisits: studies belong to different tenants.");
  }

  const measurementChanges = compareMeasurements(priorSCE.evidence, currentSCE.evidence);
  const findingChanges = compareFindings(
    findingContextFrom(priorStudy, priorAnalysis),
    findingContextFrom(currentStudy, currentAnalysis),
  );
  const nonComparable = findingChanges.length === 1 && findingChanges[0].finding_type === "*" ? findingChanges[0].note : null;

  return {
    prior_study_id: priorStudyId,
    current_study_id: currentStudyId,
    measurement_changes: measurementChanges,
    finding_changes: findingChanges,
    non_comparable_reason: nonComparable,
  };
}

/**
 * Builds the full longitudinal summary (§20) for an explicit list of study
 * ids. Cross-patient isolation is enforced by buildPatientTimeline() itself
 * (throws if the ids span more than one patient_ref) - not re-implemented
 * here.
 */
export async function buildLongitudinalSummary(studyIds: string[]): Promise<StructuredLongitudinalResult> {
  const timeline = await buildPatientTimeline(studyIds);
  const orderedIds = timeline.study_ids;

  const pairwise: StructuredComparisonResult[] = [];
  for (let i = 1; i < orderedIds.length; i++) {
    pairwise.push(await compareVisits(orderedIds[i - 1], orderedIds[i]));
  }

  // Symptom trend across the WHOLE timeline vs. the most recent visit.
  const visitEvidence: EvidenceItem[][] = [];
  for (const id of orderedIds) {
    const sce = await buildStructuredClinicalEvidence(id, { includeSpecialists: false });
    visitEvidence.push("not_found" in sce ? [] : sce.evidence);
  }
  const currentEvidence = visitEvidence[visitEvidence.length - 1] ?? [];
  const priorVisitsEvidence = visitEvidence.slice(0, -1);
  const symptomTrends = orderedIds.length > 0 ? compareSymptoms(priorVisitsEvidence, currentEvidence) : [];

  // Urgent flags for the CURRENT visit only, computed completely
  // independently of every comparison above (§27's hard rule).
  const currentStudyId = orderedIds[orderedIds.length - 1];
  const currentStudy = currentStudyId ? await dbGet<StudyRecord>("studies", currentStudyId) : null;
  const currentSymptoms = currentStudy?.symptoms ?? [];
  const urgentFlags = redFlagSymptoms(currentSymptoms).map((d) => ({ symptom_type: d.type, label: d.label, urgency: d.urgency as "emergency" | "urgent" }));

  const conflictsAcrossTimeline: string[] = [];
  for (const cmp of pairwise) {
    for (const m of cmp.measurement_changes) {
      if (m.state === "CONFLICTED") conflictsAcrossTimeline.push(`${m.category} (${m.laterality}) between ${cmp.prior_study_id} and ${cmp.current_study_id}: ${m.note}`);
    }
  }

  return {
    patient_ref: timeline.patient_ref,
    study_ids: orderedIds,
    timeline,
    pairwise_comparisons: pairwise,
    symptom_trends: symptomTrends,
    urgent_flags_current_visit: urgentFlags,
    missing_prior_evidence: orderedIds.length < 2,
    conflicts_across_timeline: conflictsAcrossTimeline,
    limitations: [
      "Observed longitudinal change does not by itself establish disease progression.",
      "This is evidence comparison over time, not autonomous progression prediction.",
      "Findings not re-observed at a later visit are not thereby established as resolved.",
    ],
    generated_at: new Date().toISOString(),
    engine_version: LONGITUDINAL_ENGINE_VERSION,
    requires_clinician_review: true,
  };
}
