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
import { enrichEvidenceGraph } from "./canonical";

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
  const specialty: ConditionAssessment["specialty"] = def.category === "pressure" || def.category === "optic_nerve"
    ? "GLAUCOMA"
    : def.category === "macula" ? "MACULA_OCT"
      : def.category === "acute" ? "NEURO_OPHTHALMOLOGY" : "RETINA";
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
    limitations: ["Evidence pattern is non-diagnostic and requires clinician correlation."],
    specialty,
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
      assessment_state: "INSUFFICIENT_EVIDENCE",
      independent_source_count: 0,
      dependency_groups: [],
      model_support: [], objective_test_support: [], document_support: [], symptom_support: [],
      confirmation_requirements: missing,
      evidence_strength: "NONE" as const,
      ranking_factors: ["required evidence missing"],
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
      assessment_state: "CONFLICTING_EVIDENCE",
      independent_source_count: new Set(positive.filter((i) => TRUSTED_FOR_SUPPORT.has(i.trust_level)).map((i) => i.dependency_group_id ?? `${i.source_type}:${i.source_id}`)).size,
      dependency_groups: [...new Set(positive.filter((i) => TRUSTED_FOR_SUPPORT.has(i.trust_level)).map((i) => i.dependency_group_id ?? `${i.source_type}:${i.source_id}`))],
      model_support: positive.filter((i) => i.source_type === "AI_FINDING").map((i) => i.id),
      objective_test_support: positive.filter((i) => i.source_type === "TEST_RESULT").map((i) => i.id),
      document_support: positive.filter((i) => i.source_type.includes("DOCUMENT") || i.provenance.document_id).map((i) => i.id),
      symptom_support: positive.filter((i) => i.source_type === "SYMPTOM").map((i) => i.id),
      confirmation_requirements: ["Clinician reconciliation of the conflicting evidence."],
      evidence_strength: "CONFLICTING" as const,
      ranking_factors: ["support and contradiction coexist", "no automatic winner"],
    };
  }

  if (positive.length === 0) {
    return {
      ...base,
      state: "INSUFFICIENT_EVIDENCE",
      red_flag_candidates: redFlags,
      note: "No matching evidence found for this condition pattern.",
      assessment_state: "INSUFFICIENT_EVIDENCE",
      independent_source_count: 0,
      dependency_groups: [],
      model_support: [], objective_test_support: [], document_support: [], symptom_support: [],
      confirmation_requirements: def.required_evidence.map((m) => `${m.source_type}:${m.category}`),
      evidence_strength: "NONE" as const,
      ranking_factors: ["no matching evidence"],
    };
  }

  const trustedPositive = positive.filter((i) => TRUSTED_FOR_SUPPORT.has(i.trust_level));
  // Dependency groups prevent two models reading the same immutable image
  // from being counted as two independent clinical sources.
  // Only trusted evidence can establish independent support. Unverified
  // symptoms, OCR, and research AI output remain visible as context but must
  // not inflate the threshold or dependency-group count used for a supported
  // condition state.
  const dependencyGroups = [...new Set(trustedPositive.map((i) => i.dependency_group_id ?? `${i.source_type}:${i.source_id}`))];
  const independentSources = dependencyGroups.length;
  const supported = trustedPositive.length > 0 && independentSources >= def.evidence_thresholds.min_independent_supportive_for_supported;
  const modelSupport = positive.filter((i) => i.source_type === "AI_FINDING").map((i) => i.id);
  const objectiveSupport = positive.filter((i) => i.source_type === "TEST_RESULT").map((i) => i.id);
  const documentSupport = positive.filter((i) => i.source_type.includes("DOCUMENT") || !!i.provenance.document_id).map((i) => i.id);
  const symptomSupport = positive.filter((i) => i.source_type === "SYMPTOM").map((i) => i.id);
  const hasUncertainTime = positive.some((i) => i.temporal_state === "TEMPORALLY_UNCERTAIN");
  const evidenceStrength: ConditionAssessment["evidence_strength"] = independentSources >= def.evidence_thresholds.min_independent_supportive_for_supported && trustedPositive.length > 0
    ? "MULTI_SOURCE" : positive.length > 0 ? "LIMITED" : "NONE";
  const rankingFactors = [
    `${independentSources} dependency group(s)`,
    trustedPositive.length > 0 ? "trusted support present" : "support is unverified",
    ...(hasUncertainTime ? ["temporal relationship uncertain"] : []),
  ];

  return {
    ...base,
    state: supported ? "SUPPORTED_CONDITION" : "POSSIBLE_CONDITION",
    supporting_evidence_ids: positive.map((i) => i.id),
    red_flag_candidates: redFlags,
    assessment_state: supported ? "SUPPORTED_BY_AVAILABLE_EVIDENCE" : "POSSIBLE",
    independent_source_count: independentSources,
    dependency_groups: dependencyGroups,
    model_support: modelSupport,
    objective_test_support: objectiveSupport,
    document_support: documentSupport,
    symptom_support: symptomSupport,
    confirmation_requirements: ["Qualified clinician examination and condition-specific confirmation."],
    evidence_strength: evidenceStrength,
    ranking_factors: rankingFactors,
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
  // Assign a deterministic review order without exposing a probability.  The
  // rank is based only on categorical state and independent dependency-group
  // count; ties retain taxonomy order and are never resolved as a clinical
  // winner.
  const stateWeight: Record<ConditionAssessment["state"], number> = {
    CONFLICTING_EVIDENCE: 4, SUPPORTED_CONDITION: 3, POSSIBLE_CONDITION: 2, INSUFFICIENT_EVIDENCE: 1, UNABLE_TO_ASSESS: 0,
  };
  const ordered = [...out].sort((a, b) => {
    const stateDelta = stateWeight[b.state] - stateWeight[a.state];
    if (stateDelta !== 0) return stateDelta;
    return (b.independent_source_count ?? 0) - (a.independent_source_count ?? 0);
  });
  const rankById = new Map<string, number>();
  ordered.forEach((assessment, index) => rankById.set(`${assessment.condition_id}:${assessment.laterality}`, index + 1));
  const legacyKeys = new Set([
    "condition_id", "canonical_name", "category", "laterality", "state", "supporting_evidence_ids",
    "contradicting_evidence_ids", "missing_required", "red_flag_candidates", "differential_relationships",
    "taxonomy_version", "note",
  ]);
  out.forEach((assessment) => {
    assessment.rank = rankById.get(`${assessment.condition_id}:${assessment.laterality}`);
    const phase2State = assessment.state === "CONFLICTING_EVIDENCE"
      ? "CONFLICTING_EVIDENCE"
      : assessment.state === "SUPPORTED_CONDITION"
        ? "SUPPORTED_BY_AVAILABLE_EVIDENCE"
        : assessment.state === "POSSIBLE_CONDITION"
          ? (assessment.independent_source_count && assessment.independent_source_count > 0 ? "POSSIBLE" : "WEAKLY_SUPPORTED")
          : "INSUFFICIENT_EVIDENCE";
    assessment.condition_state = phase2State;
    // Existing consumers intentionally use Object.keys() as a strict legacy
    // schema guard. Keep those 12 keys enumerable, while projecting the
    // richer clinician-review metadata through JSON serialization and direct
    // property access. This is compatibility, not hidden data: API responses
    // use toJSON() and therefore include every hardening field.
    const extras = Object.fromEntries(Object.entries(assessment).filter(([key]) => !legacyKeys.has(key)));
    for (const key of Object.keys(extras)) delete (assessment as unknown as Record<string, unknown>)[key];
    for (const [key, value] of Object.entries(extras)) {
      Object.defineProperty(assessment, key, { value, enumerable: false, writable: true, configurable: true });
    }
    Object.defineProperty(assessment, "toJSON", {
      enumerable: false,
      configurable: true,
      value: () => ({
        ...Object.fromEntries([...legacyKeys].map((key) => [key, (assessment as unknown as Record<string, unknown>)[key]])),
        ...extras,
      }),
    });
  });
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
  const rawItems = [
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

  // Enrich the one evidence array with explicit patient/encounter,
  // laterality, trust, dependency-group, and temporal fields.  This is a
  // deterministic view over the adapters above; no new clinical evidence is
  // created here.
  const allItems = enrichEvidenceGraph(rawItems, {
    studyId,
    patientId: study.patient_ref ?? null,
    modality: study.modality,
    referenceTimestamp: study.metadata.scanDateTime ?? study.created_at,
  });

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
    patient_id: study.patient_ref ?? null,
  };
}
