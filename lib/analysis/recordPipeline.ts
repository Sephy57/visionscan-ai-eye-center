import { dbGet, dbAll } from "../storage/db";
import type { StudyRecord, AnalysisRecord } from "../studies/service";
import type { PatientRecord } from "../patients/service";
import { buildEvidenceWorkspace } from "../evidence/synthesize";
import type { EvidenceWorkspace } from "../evidence/types";
import { buildLongitudinalSummary } from "../clinical/longitudinalComparisonEngine";
import type { StructuredLongitudinalResult } from "../clinical/longitudinalComparisonEngine";
import { runTriage } from "../clinical/triage";
import type { TriageOutcome } from "../clinical/triage";
import { evaluateMedicationSafety } from "../models/medicationSafetyResult";
import type { StructuredMedicationSafetyResult, MedicationSafetyEvaluationInput } from "../models/medicationSafetyResult";
import { getRecordExtraction } from "../documents/extraction/recordExtractionStore";
import type { StoredRecordExtraction } from "../documents/extraction/recordExtractionStore";
import type { PatientSymptom } from "../clinical/symptoms";
import { SYMPTOM_MAP } from "../clinical/symptoms";
import { listDocumentsByStudy } from "../documents/repository";
import type { MedicationEntry, Allergy, SystemicHistory } from "../patients/encounter";

/**
 * RecordAnalysisPipeline (eye-center workspace).
 *
 * One orchestrating function for a STUDY's full record context:
 *   upload/ingestion (already done by the time this runs)
 *     -> automatic document extraction results (per document)
 *     -> test results (IOP/VA/...)
 *     -> image analysis (pre-existing analyses; NEVER run here - the async
 *        job queue owns model execution; this stage reports NOT_RUN honestly)
 *     -> evidence synthesis (cross-evidence correlation + possible conditions)
 *     -> medication safety (structured, fail-open to UNKNOWN semantics)
 *     -> longitudinal comparison (when prior studies exist for the patient)
 *     -> urgency / triage (independent of AI findings - red-flag symptoms
 *        escalate even when findings are empty; historical normality never
 *        suppresses current urgency)
 *     -> clinician-review package with explicit limitations
 *
 * HARD RULES:
 *  - Per-stage failure isolation: any single stage failing produces a
 *    stage status (e.g. EXTRACTION_FAILED, NO_COMPARABLE_EVIDENCE) and
 *    NEVER crashes the whole package.
 *  - Nothing here diagnoses. Possible conditions come only from the
 *    existing evidence workspace (assessConditions) with its trust rules.
 *  - Everything is read-only: this module never writes the DB.
 */

export const RECORD_PIPELINE_VERSION = "record-pipeline-1.0.0";

export type StageStatus =
  | "OK"
  | "NOT_RUN"
  | "NOT_AVAILABLE"
  | "NO_TEXT_EXTRACTED"
  | "NO_DOCUMENTS"
  | "NO_COMPARABLE_EVIDENCE"
  | "FAILED";

export interface PipelineStage<T = unknown> {
  stage:
    | "DOCUMENT_EXTRACTION"
    | "TEST_RESULTS"
    | "IMAGE_ANALYSIS"
    | "EVIDENCE_SYNTHESIS"
    | "MEDICATION_SAFETY"
    | "LONGITUDINAL"
    | "URGENCY";
  status: StageStatus;
  detail?: string;
  result?: T;
}

export interface RecordAnalysisPackage {
  study_id: string;
  patient_ref: string | null;
  generated_at: string;
  pipeline_version: string;
  stages: {
    document_extractions: PipelineStage<StoredRecordExtraction>[];
    test_results: PipelineStage<unknown>;
    image_analysis: PipelineStage<unknown>;
    evidence_synthesis: PipelineStage<EvidenceWorkspace>;
    medication_safety: PipelineStage<StructuredMedicationSafetyResult>;
    longitudinal: PipelineStage<StructuredLongitudinalResult>;
    urgency: PipelineStage<TriageOutcome>;
  };
  symptom_sources: {
    study_symptoms: PatientSymptom[];          // clinician/patient-entered via the study route
    extracted_unreviewed_count: number;        // from documents - NOT auto-promoted
    extracted_rejected_count: number;
    extracted_red_flag_candidates: string[];  // pre-review triage signal only
  };
  limitations: string[];
  requires_clinician_review: true;
}

const PIPELINE_LIMITATIONS = [
  "This package is research/decision-support material, not a diagnosis.",
  "Possible conditions are evidence-based candidates requiring clinician confirmation.",
  "Document-extracted symptoms are UNREVIEWED until a clinician verifies them.",
  "Image findings come only from models that actually ran; no model is fabricated.",
  "Etiology associations never establish causation.",
];

export async function analyzeRecord(studyId: string): Promise<RecordAnalysisPackage | { not_found: true }> {
  const study = await dbGet<StudyRecord>("studies", studyId);
  if (!study) return { not_found: true };

  const patientRef = study.patient_ref ?? null;
  const limitations = [...PIPELINE_LIMITATIONS];

  // --- Stage: document extraction (per document, isolated) ---------------
  const docs = await listDocumentsByStudy(studyId);
  const documentExtractionStages: PipelineStage<StoredRecordExtraction>[] = [];
  let extractedUnreviewed = 0;
  let extractedRejected = 0;
  const extractedRedFlagCandidates = new Set<string>();
  const extractedRecords: StoredRecordExtraction[] = [];
  for (const doc of docs) {
    try {
      const rec = await getRecordExtraction(doc.document_id);
      if (!rec) {
        documentExtractionStages.push({ stage: "DOCUMENT_EXTRACTION", status: "NOT_RUN", detail: `document ${doc.document_id}` });
        continue;
      }
      if (rec.status === "FAILED") {
        documentExtractionStages.push({ stage: "DOCUMENT_EXTRACTION", status: "FAILED", detail: "EXTRACTION_FAILED", result: rec });
        continue;
      }
      extractedRecords.push(rec);
      const reviewed = rec.annotations ?? {};
      // Treat the persisted verification state as authoritative as well as
      // the annotation journal. This keeps fail-closed behavior for records
      // written by an older importer or a repaired database row that may not
      // have a matching annotation entry.
      const isRejected = (itemId: string, verification?: string) =>
        verification === "REJECTED_BY_CLINICIAN" || (reviewed[itemId] ?? []).some((a) => a.action === "REJECT");
      // Count the actual verification state. A previously verified/corrected
      // item is no longer unreviewed merely because it came from a document;
      // the old non-rejected count overstated the review queue forever.
      extractedUnreviewed += rec.symptoms.filter((s) => !isRejected(s.item_id, s.verification) && s.verification === "UNREVIEWED").length;
      extractedRejected += rec.symptoms.filter((s) => isRejected(s.item_id, s.verification)).length;
      for (const symptom of rec.symptoms) {
        // Never promote extracted facts into the study symptom list. This is
        // limited to an explicit pre-review urgency signal and rejected items
        // are excluded even from that conservative pathway.
        if (!isRejected(symptom.item_id, symptom.verification) && SYMPTOM_MAP[symptom.type]?.red_flag) {
          extractedRedFlagCandidates.add(symptom.type);
        }
      }
      documentExtractionStages.push({ stage: "DOCUMENT_EXTRACTION", status: rec.symptoms.length ? "OK" : "NO_TEXT_EXTRACTED", result: rec });
    } catch {
      documentExtractionStages.push({ stage: "DOCUMENT_EXTRACTION", status: "FAILED", detail: "EXTRACTION_FAILED" });
    }
  }
  if (docs.length === 0) {
    documentExtractionStages.push({ stage: "DOCUMENT_EXTRACTION", status: "NO_DOCUMENTS" });
  }

  // --- Stage: test results -------------------------------------------------
  let testResultsStage: PipelineStage<unknown>;
  try {
    const results = await dbAll<Record<string, unknown>>("test_results");
    const forStudy = results.filter((r) => r && r.study_id === studyId);
    testResultsStage = { stage: "TEST_RESULTS", status: forStudy.length ? "OK" : "NOT_AVAILABLE", detail: `${forStudy.length} results`, result: forStudy };
  } catch {
    testResultsStage = { stage: "TEST_RESULTS", status: "FAILED", detail: "TEST_RESULTS_UNAVAILABLE" };
  }

  // --- Stage: image analysis (existing analyses only - never executed here)
  let imageStage: PipelineStage<unknown>;
  try {
    const analyses = await dbAll<AnalysisRecord>("analyses");
    const forStudy = analyses.filter((a) => a.study_id === studyId);
    imageStage = forStudy.length
      ? { stage: "IMAGE_ANALYSIS", status: "OK", detail: `${forStudy.length} analysis record(s)`, result: forStudy }
      : { stage: "IMAGE_ANALYSIS", status: "NOT_RUN", detail: "No analysis has run for this study; use the analysis job queue." };
  } catch {
    imageStage = { stage: "IMAGE_ANALYSIS", status: "FAILED", detail: "ANALYSIS_LOOKUP_FAILED" };
  }

  // --- Stage: evidence synthesis -------------------------------------------
  let evidenceStage: PipelineStage<EvidenceWorkspace>;
  try {
    const ws = await buildEvidenceWorkspace(studyId);
    evidenceStage = "not_found" in ws
      ? { stage: "EVIDENCE_SYNTHESIS", status: "NOT_AVAILABLE" }
      : { stage: "EVIDENCE_SYNTHESIS", status: "OK", result: ws };
  } catch {
    evidenceStage = { stage: "EVIDENCE_SYNTHESIS", status: "FAILED", detail: "EVIDENCE_SYNTHESIS_FAILED" };
  }

  // --- Stage: medication safety (encounter + document candidates) ----------
  let medicationStage: PipelineStage<StructuredMedicationSafetyResult>;
  try {
    const encounters = await dbAll<EncounterLike>("encounters");
    const patients = patientRef ? await dbAll<PatientRecord>("patients") : [];
    const patient = patients.find((p) =>
      p.patient_ref.toLowerCase() === patientRef!.toLowerCase() &&
      (study.tenant_id ?? null) === (p.tenant_id ?? null)
    );
    const forPatient = patientRef
      ? encounters
          .filter((e) => patient
            ? e.patient_id === patient.patient_id
            : e.patient_ref?.toLowerCase() === patientRef.toLowerCase() && (e.tenant_id ?? null) === (study.tenant_id ?? null))
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
      : [];
    const latest = forPatient[0];
    const documentMedications = extractedRecords
      .flatMap((r) => r.medications ?? [])
      .filter((m) => !(extractedRecords.some((r) => (r.annotations?.[m.item_id] ?? []).some((a) => a.action === "REJECT"))))
      .map((m) => ({
        name: m.name_raw,
        ocular: m.form_hint === "eye_drops",
        dose: m.dose_raw ?? null,
        frequency: null,
        started: null,
        stopped: null,
        status: "UNKNOWN" as const,
      }));
    const documentAllergies = extractedRecords
      .flatMap((r) => r.allergies ?? [])
      .filter((a) => !(extractedRecords.some((r) => (r.annotations?.[a.item_id] ?? []).some((x) => x.action === "REJECT"))))
      .map((a) => ({ allergen: a.allergen_raw, reaction: a.reaction_raw ?? null, severity: "unknown" as const }));

    // Encounter facts take precedence over a same-named document candidate,
    // while still allowing a document-only upload to receive a useful,
    // explicitly unresolved safety result.
    const encounterMedications = latest?.medications?.map((m) => m.value as MedicationEntry) ?? [];
    const encounterAllergies = latest?.allergies?.map((a) => a.value as Allergy) ?? [];
    const medicationKeys = new Set(encounterMedications.map((m) => m.name.trim().toLowerCase()));
    const allergyKeys = new Set(encounterAllergies.map((a) => a.allergen.trim().toLowerCase()));
    const medications = [...encounterMedications, ...documentMedications.filter((m) => !medicationKeys.has(m.name.trim().toLowerCase()))];
    const allergies = [...encounterAllergies, ...documentAllergies.filter((a) => !allergyKeys.has(a.allergen.trim().toLowerCase()))];

    if (!latest && medications.length === 0 && allergies.length === 0) {
      medicationStage = {
        stage: "MEDICATION_SAFETY",
        status: "NOT_AVAILABLE",
        detail: "NO_ENCOUNTER_MEDICATION_LIST",
      };
    } else {
      const input: MedicationSafetyEvaluationInput = {
        patient_ref: patientRef,
        encounter_id: latest?.encounter_id ?? null,
        medications,
        allergies,
        systemic_history: (latest?.systemic_history?.value ?? null) as SystemicHistory | null,
      };
      const result = evaluateMedicationSafety(input);
      if (documentMedications.length > 0 || documentAllergies.length > 0) {
        result.limitations = [
          ...result.limitations,
          "One or more medication/allergy observations came from uploaded documents and remain UNREVIEWED until clinician verification.",
        ];
      }
      medicationStage = { stage: "MEDICATION_SAFETY", status: "OK", result };
    }
  } catch {
    medicationStage = { stage: "MEDICATION_SAFETY", status: "FAILED", detail: "MEDICATION_SAFETY_FAILED" };
  }

  // --- Stage: longitudinal comparison --------------------------------------
  let longitudinalStage: PipelineStage<StructuredLongitudinalResult>;
  try {
    const studies = await dbAll<StudyRecord>("studies");
    const samePatient = patientRef
      ? studies.filter((s) =>
          s.patient_ref?.toLowerCase() === patientRef.toLowerCase() &&
          (s.tenant_id ?? null) === (study.tenant_id ?? null)
        ).map((s) => s.study_id)
      : [];
    if (samePatient.length < 2) {
      longitudinalStage = { stage: "LONGITUDINAL", status: "NO_COMPARABLE_EVIDENCE", detail: `${samePatient.length} study(ies) for this patient_ref` };
    } else {
      const summary = await buildLongitudinalSummary(samePatient);
      longitudinalStage = { stage: "LONGITUDINAL", status: "OK", result: summary };
    }
  } catch {
    longitudinalStage = { stage: "LONGITUDINAL", status: "FAILED", detail: "LONGITUDINAL_FAILED" };
  }

  // --- Stage: urgency (independent of AI findings) --------------------------
  let urgencyStage: PipelineStage<TriageOutcome>;
  try {
    const redFlags = study.symptoms?.map((s) => s.type).filter((t) => SYMPTOM_MAP[t]?.red_flag) ?? [];
    const quality = (evidenceStage.result?.examination_context ?? null) as { study_id?: string } | null;
    void quality;
    const outcome = runTriage({
      findings: [],
      qualityAcceptable: false, // no analysis executed here; quality comes from the analysis route, not this package
      qualityScore: 0,
      uncertainty: 1,
      modality: study.modality,
      redFlagSymptoms: redFlags,
      documentExtractedRedFlagSymptoms: [...extractedRedFlagCandidates],
    });
    urgencyStage = { stage: "URGENCY", status: "OK", result: outcome };
  } catch {
    urgencyStage = { stage: "URGENCY", status: "FAILED", detail: "TRIAGE_FAILED" };
  }

  return {
    study_id: studyId,
    patient_ref: patientRef,
    generated_at: new Date().toISOString(),
    pipeline_version: RECORD_PIPELINE_VERSION,
    stages: {
      document_extractions: documentExtractionStages,
      test_results: testResultsStage,
      image_analysis: imageStage,
      evidence_synthesis: evidenceStage,
      medication_safety: medicationStage,
      longitudinal: longitudinalStage,
      urgency: urgencyStage,
    },
    symptom_sources: {
      study_symptoms: study.symptoms ?? [],
      extracted_unreviewed_count: extractedUnreviewed,
      extracted_rejected_count: extractedRejected,
      extracted_red_flag_candidates: [...extractedRedFlagCandidates],
    },
    limitations,
    requires_clinician_review: true,
  };
}

interface EncounterLike {
  encounter_id: string;
  patient_id?: string;
  patient_ref?: string | null;
  tenant_id?: string | null;
  created_at: string;
  medications?: Array<{ value: { name: string; ocular: boolean; dose?: string | null; frequency?: string | null; started?: string | null; stopped?: string | null; status?: string } }>;
  allergies?: Array<{ value: { allergen: string; reaction?: string | null; severity?: string } }>;
  systemic_history?: { value: { diabetes: "yes" | "no" | "unknown"; hypertension: "yes" | "no" | "unknown"; other_conditions: string[] } } | null;
}
