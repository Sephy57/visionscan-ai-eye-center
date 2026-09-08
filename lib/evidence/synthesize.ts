import { dbGet, dbAll } from "../storage/db";
import type { StudyRecord, AnalysisRecord } from "../studies/service";
import type { ClinicalReport } from "../reports/generator";
import { listTestResultsForStudy } from "../documents/extraction/testResultService";
import {
  evidenceFromTestResults,
  evidenceFromSymptoms,
  evidenceFromExtractedSymptoms,
  evidenceFromExtractedNegations,
  evidenceFromExtractedMedications,
  evidenceFromExtractedAllergies,
  evidenceFromExtractedHistory,
  evidenceFromClinicianObservations,
  evidenceFromSourceDocumentDiagnoses,
  evidenceFromFindings,
  evidenceFromOcularHistory,
  evidenceFromMedications,
  evidenceFromAllergies,
  evidenceFromSystemicHistory,
  evidenceFromFamilyHistory,
} from "./adapters";
import { listDocumentsByStudy } from "../documents/repository";
import { getRecordExtraction } from "../documents/extraction/recordExtractionStore";
import { detectConflicts, attachConflictIds } from "./conflicts";
import { EVIDENCE_CONDITIONS, EVIDENCE_TAXONOMY_VERSION, type EvidenceConditionDef, type EvidenceMatcher } from "./conditionTaxonomy";
import type { ConditionAssessment, EvidenceItem, EvidenceLaterality, EvidenceWorkspace } from "./types";
import type { StoredEncounter } from "../patients/service";

const TRUSTED_FOR_SUPPORT = new Set(["HUMAN_VERIFIED", "CLINICIAN_ENTERED", "VALIDATED_AI_FINDING"]);

const SAFETY_BANNER =
  "AI-GENERATED EVIDENCE SYNTHESIS — NOT A DIAGNOSIS. NOT CLINICALLY VALIDATED. " +
  "FOR HUMAN REVIEW ONLY. AI identified evidence that MAY be relevant to these condition patterns; " +
  "only a qualified clinician can establish a diagnosis.";

function matches(items: EvidenceItem[], m: EvidenceMatcher, laterality: EvidenceLaterality | null): EvidenceItem[] {
  return items.filter((i) => {
    if (i.source_type !== m.source_type || i.category !== m.category) return false;
    // An unparseable/unknown measurement or an explicit negation is evidence
    // about absence/uncertainty, not positive support for a condition. The
    // previous presence-only matcher treated UNKNOWN/ABSENT required items as
    // present, which could make an incomplete document appear assessable.
    if (i.presence !== "PRESENT") return false;
    if (laterality === null) return true; // whole_patient: laterality irrelevant
    // per_eye: only same-eye evidence or OU (applies-to-both) evidence may combine (S5.4/S5.22).
    return i.laterality === laterality || i.laterality === "OU";
  });
}

/**
 * Assesses one condition definition against a pool of trusted evidence,
 * optionally scoped to one eye (per_eye conditions - see S5.22's hard rule:
 * evidence for one eye must never support/contradict a condition instance
 * for the other eye). Purely presence-based; never a probability (S5.9).
 */
function assessOne(def: EvidenceConditionDef, trusted: EvidenceItem[], laterality: EvidenceLaterality | null): ConditionAssessment {
  const base = {
    condition_id: def.condition_id,
    canonical_name: def.canonical_name,
    category: def.category,
    laterality: (laterality ?? "OU") as EvidenceLaterality,
    supporting_evidence_ids: [] as string[],
    contradicting_evidence_ids: [] as string[],
    missing_required: [] as string[],
    red_flag_candidates: [] as string[],
    differential_relationships: def.differential_relationships,
    taxonomy_version: def.version,
  };

  const requiredMatches = def.required_evidence.map((m) => matches(trusted, m, laterality));
  const missing = def.required_evidence
    .map((m, idx) => (requiredMatches[idx].length === 0 ? `${m.source_type}:${m.category}` : null))
    .filter((x): x is string => x !== null);

  if (def.required_evidence.length > 0 && missing.length > 0) {
    return {
      ...base,
      state: "UNABLE_TO_ASSESS",
      missing_required: missing,
      note: "Required evidence is not present in this record for this eye; no assessment can be made.",
    };
  }

  const requiredItems = requiredMatches.flat();
  const supportItems = def.supportive_evidence.flatMap((m) => matches(trusted, m, laterality));
  const contraItems = def.contradictory_evidence.flatMap((m) => matches(trusted, m, laterality));
  const positive = [...requiredItems, ...supportItems];

  const redFlags = def.red_flags.filter((rf) => trusted.some((i) => i.source_type === "SYMPTOM" && i.category === rf && (laterality === null || i.laterality === laterality || i.laterality === "OU" || i.laterality === "UNKNOWN")));

  if (contraItems.length > 0 && positive.length > 0) {
    return {
      ...base,
      state: "CONFLICTING_EVIDENCE",
      supporting_evidence_ids: positive.map((i) => i.id),
      contradicting_evidence_ids: contraItems.map((i) => i.id),
      red_flag_candidates: redFlags,
      note: "Supporting and contradicting evidence both present; the system does not resolve this automatically.",
    };
  }

  if (positive.length === 0) {
    return {
      ...base,
      state: "INSUFFICIENT_EVIDENCE",
      red_flag_candidates: redFlags,
      note: "No matching evidence found for this condition pattern.",
    };
  }

  const trustedPositive = positive.filter((i) => TRUSTED_FOR_SUPPORT.has(i.trust_level));
  const independentSources = new Set(positive.map((i) => i.source_type)).size;
  const supported = trustedPositive.length > 0 && independentSources >= def.evidence_thresholds.min_independent_supportive_for_supported;

  return {
    ...base,
    state: supported ? "SUPPORTED_CONDITION" : "POSSIBLE_CONDITION",
    supporting_evidence_ids: positive.map((i) => i.id),
    red_flag_candidates: redFlags,
    note: supported
      ? "Multiple independent, human-reviewed or validated evidence sources are compatible with this pattern."
      : "Evidence is compatible with this pattern but is unverified and/or from a single source - not sufficient to call it supported.",
  };
}

export function assessConditions(items: EvidenceItem[], defs: EvidenceConditionDef[] = EVIDENCE_CONDITIONS): ConditionAssessment[] {
  const trusted = items.filter((i) => i.trust_level !== "REJECTED");
  const out: ConditionAssessment[] = [];
  for (const def of defs) {
    if (def.laterality_behavior === "whole_patient") {
      out.push(assessOne(def, trusted, null));
    } else {
      for (const lat of ["OD", "OS"] as const) out.push(assessOne(def, trusted, lat));
    }
  }
  return out;
}

/**
 * Assembles the full evidence workspace for one study (S5.18). Every source
 * query below is scoped by studyId at the query itself; the final filter is
 * defense-in-depth against cross-study contamination (S5.17), not the only
 * safeguard.
 */
export async function buildEvidenceWorkspace(studyId: string): Promise<EvidenceWorkspace | { study_id: string; not_found: true }> {
  const study = await dbGet<StudyRecord>("studies", studyId);
  if (!study) return { study_id: studyId, not_found: true };

  const analysisRecord = await dbGet<AnalysisRecord>("analyses", `anl_${studyId}`);
  const reportRecord = await dbGet<ClinicalReport>("reports", `rep_${studyId}`);
  const testResults = (await listTestResultsForStudy(studyId)).filter((r) => r.study_id === studyId);
  const symptoms = study.symptoms ?? [];
  const findings = analysisRecord?.result.findings ?? [];

  const symptomItems = evidenceFromSymptoms(studyId, symptoms);
  const extractedSymptomItems: EvidenceItem[] = [];
  const extractedNegationItems: EvidenceItem[] = [];
  const extractedMedicationItems: EvidenceItem[] = [];
  const extractedAllergyItems: EvidenceItem[] = [];
  const extractedHistoryItems: EvidenceItem[] = [];
  const sourceDiagnosisItems: EvidenceItem[] = [];
  const clinicianObservationItems = reportRecord?.clinician_observations
    ? evidenceFromClinicianObservations(studyId, reportRecord.clinician_observations)
    : [];
  // Automatic record extraction is part of the evidence workspace as soon as
  // it exists. It remains AUTO_EXTRACTED/UNREVIEWED until a clinician acts;
  // this makes the result useful without allowing unverified data to become
  // a supported condition (assessConditions applies the trust gate).
  for (const document of await listDocumentsByStudy(studyId)) {
    const extraction = await getRecordExtraction(document.document_id);
    if (extraction?.status === "COMPLETE" || extraction?.status === "PARTIAL") {
      extractedSymptomItems.push(...evidenceFromExtractedSymptoms(studyId, extraction));
      extractedNegationItems.push(...evidenceFromExtractedNegations(studyId, extraction));
      extractedMedicationItems.push(...evidenceFromExtractedMedications(studyId, extraction));
      extractedAllergyItems.push(...evidenceFromExtractedAllergies(studyId, extraction));
      extractedHistoryItems.push(...evidenceFromExtractedHistory(studyId, extraction));
      sourceDiagnosisItems.push(...evidenceFromSourceDocumentDiagnoses(studyId, extraction));
    }
  }
  const testItems = evidenceFromTestResults(testResults);
  const findingItems = evidenceFromFindings(studyId, study.eye, findings);

  // Encounter facts are linked explicitly to a study. They are not inferred
  // merely because two records happen to share a patient_ref, which keeps a
  // partial or incorrectly-linked encounter from contaminating a visit.
  const encounterItems: EvidenceItem[] = [];
  const encounters = await dbAll<StoredEncounter>("encounters");
  for (const encounter of encounters.filter((e) => (e.linked_study_ids ?? []).includes(studyId))) {
    encounterItems.push(
      ...evidenceFromSymptoms(studyId, encounter.symptoms ?? [], encounter.encounter_id),
      ...evidenceFromOcularHistory(studyId, encounter.ocular_history ?? [], encounter.encounter_id),
      ...evidenceFromOcularHistory(studyId, encounter.ocular_surgery_history ?? [], encounter.encounter_id),
      ...evidenceFromMedications(studyId, encounter.medications ?? [], encounter.encounter_id),
      ...evidenceFromAllergies(studyId, encounter.allergies ?? [], encounter.encounter_id),
      ...evidenceFromSystemicHistory(studyId, encounter.systemic_history, encounter.encounter_id),
      ...evidenceFromFamilyHistory(studyId, encounter.family_history, encounter.encounter_id),
    );
  }

  // Defense-in-depth: never let evidence from another study leak into this workspace.
  const allItems = [
    ...symptomItems,
    ...extractedSymptomItems,
    ...extractedNegationItems,
    ...extractedMedicationItems,
    ...extractedAllergyItems,
    ...extractedHistoryItems,
    ...sourceDiagnosisItems,
    ...clinicianObservationItems,
    ...encounterItems,
    ...testItems,
    ...findingItems,
  ].filter((i) => i.study_id === studyId);

  const conflicts = detectConflicts(allItems);
  attachConflictIds(allItems, conflicts);
  const possibleConditions = assessConditions(allItems);

  return {
    study_id: studyId,
    examination_context: {
      study_id: studyId,
      created_at: study.created_at,
      modality: study.modality,
      eye: study.eye,
      patient_ref: study.patient_ref,
      source_count: {
        symptoms: symptomItems.length + extractedSymptomItems.length + encounterItems.filter((i) => i.source_type === "SYMPTOM").length,
        test_results: testItems.length,
        ai_findings: findingItems.length,
        source_document_diagnoses: sourceDiagnosisItems.length,
        history: extractedHistoryItems.length + clinicianObservationItems.length + encounterItems.filter((i) => i.source_type === "HISTORY" || i.source_type === "CLINICIAN_OBSERVATION").length,
        medications: extractedMedicationItems.length + encounterItems.filter((i) => i.source_type === "MEDICATION").length,
        allergies: extractedAllergyItems.length + encounterItems.filter((i) => i.source_type === "ALLERGY").length,
      },
    },
    evidence: allItems,
    conflicts,
    possible_conditions: possibleConditions,
    safety_banner: SAFETY_BANNER,
    taxonomy_version: EVIDENCE_TAXONOMY_VERSION,
    generated_at: new Date().toISOString(),
  };
}
