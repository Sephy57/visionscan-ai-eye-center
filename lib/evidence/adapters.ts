import { newId } from "../storage/files";
import type { TestResult } from "../documents/extraction/testResults";
import type { PatientSymptom } from "../clinical/symptoms";
import { SYMPTOM_MAP } from "../clinical/symptoms";
import type { Finding } from "../analysis/schema";
import type { EvidenceItem, EvidenceSourceType, EvidenceTrustLevel } from "./types";
import { lateralityFromTestResult, lateralityFromSymptomReport, lateralityFromStudyEye } from "./laterality";
import type { PatientEncounter, DataProvenance, OcularHistoryEntry, MedicationEntry, Allergy } from "../patients/encounter";
import type { StoredRecordExtraction } from "../documents/extraction/recordExtractionStore";
import type { RecordExtraction } from "../documents/extraction/clinicalExtraction";
import type { ClinicalReport } from "../reports/generator";

/**
 * Source adapters (S5.1/S5.11): each function turns one existing, already
 * safety-gated data source into EvidenceItem[]. They are pure, deterministic,
 * and never invent a value, unit, laterality, or date that was not already
 * present on the source record (S5.16).
 */

function trustFromVerification(status: TestResult["verification"]["status"]): EvidenceTrustLevel {
  switch (status) {
    case "VERIFIED":
    case "CORRECTED":
      return "HUMAN_VERIFIED";
    case "REJECTED":
      return "REJECTED";
    case "UNREVIEWED":
      return "UNVERIFIED";
    case "AUTO_EXTRACTED":
    default:
      return "AUTO_EXTRACTED";
  }
}

/**
 * A CORRECTED result's evidence value/unit/laterality reflect the human
 * correction (that is the point of a correction) - but the original
 * extraction is never touched here or anywhere else; `provenance.result_id`
 * still points at the one TestResult record that holds both.
 */
export function evidenceFromTestResults(results: TestResult[]): EvidenceItem[] {
  return results.map((r) => {
    const corrected = r.verification.status === "CORRECTED" && r.correction;
    const value = corrected ? r.correction!.value : r.value;
    const laterality = corrected && r.correction?.laterality ? r.correction.laterality : r.laterality;
    const unit = corrected ? (r.correction?.unit ?? r.unit_normalized ?? r.unit_raw) : (r.unit_normalized ?? r.unit_raw);
    return {
      id: newId("ev"),
      study_id: r.study_id,
      source_type: "TEST_RESULT",
      source_id: r.result_id,
      category: r.test_type,
      laterality: lateralityFromTestResult(laterality),
      laterality_source: "explicit",
      value,
      unit,
      presence: value === undefined ? "UNKNOWN" : "PRESENT",
      timestamp: r.timestamp,
      date_raw: r.date_raw,
      trust_level: trustFromVerification(r.verification.status),
      confidence: r.extraction_confidence !== undefined ? r.extraction_confidence / 100 : undefined,
      uncertainty: r.ambiguity_flags,
      provenance: {
        study_id: r.study_id, document_id: r.document_id, result_id: r.result_id,
        page: r.page, source_text: r.source_text, extraction_method: r.extraction_method,
      },
      conflict_ids: [],
    };
  });
}

/**
 * Patient-reported symptoms are self-report, structured but not
 * independently confirmed - trust_level UNVERIFIED (S5.2: "may be displayed
 * ... must not independently drive a clinical conclusion"). A PatientSymptom
 * record exists only when the type WAS reported; absent types are simply not
 * represented here (NOT_REPORTED, never coerced to ABSENT - S5.3).
 */
export function evidenceFromSymptoms(studyId: string, symptoms: PatientSymptom[], encounterId?: string): EvidenceItem[] {
  return symptoms.map((s, i) => ({
    id: newId("ev"),
    study_id: studyId,
    source_type: "SYMPTOM" as const,
    source_id: `${encounterId ? `encounter-symptom:${encounterId}` : `symptom:${studyId}`}:${i}:${s.type}`,
    category: s.type,
    laterality: lateralityFromSymptomReport(s.laterality),
    laterality_source: "mapped_from_symptom_report" as const,
    qualitative_finding: SYMPTOM_MAP[s.type]?.label ?? s.type,
    presence: "PRESENT" as const,
    trust_level: "UNVERIFIED" as const,
    uncertainty: s.laterality === "unknown" ? ["missing_laterality"] : undefined,
    provenance: { study_id: studyId, encounter_id: encounterId },
    conflict_ids: [],
  }));
}

/**
 * Document-derived symptom candidates. These are intentionally represented
 * as symptom evidence (so the auditable taxonomy can explain why a pattern
 * is being considered), but their trust is kept separate from clinician or
 * patient-entered context. Rejected candidates remain visible for audit and
 * are excluded from condition support/conflict logic by the normal trust
 * filter. The original quoted text and page are retained as provenance.
 */
export function evidenceFromExtractedSymptoms(
  studyId: string,
  extraction: StoredRecordExtraction,
): EvidenceItem[] {
  const mapped: Array<EvidenceItem | null> = extraction.symptoms.map((s): EvidenceItem | null => {
    // Persisted extraction records are PHI-bearing input, not a type-safe
    // trust boundary. Never expose a malformed/unknown symptom as a new
    // evidence category that downstream rules might accidentally match.
    if (!SYMPTOM_MAP[s.type]) return null;
    const trust: EvidenceTrustLevel =
      s.verification === "REJECTED_BY_CLINICIAN" ? "REJECTED" :
      s.verification === "VERIFIED_BY_CLINICIAN" || s.verification === "CORRECTED_BY_CLINICIAN" ? "HUMAN_VERIFIED" :
      "AUTO_EXTRACTED";
    return {
      id: newId("ev"),
      study_id: studyId,
      source_type: "SYMPTOM" as const,
      source_id: `document-symptom:${extraction.document_id}:${s.item_id}`,
      category: s.type,
      laterality: lateralityFromSymptomReport(s.laterality ?? "unknown"),
      laterality_source: "mapped_from_symptom_report" as const,
      qualitative_finding: SYMPTOM_MAP[s.type]?.label ?? s.type,
      presence: "PRESENT" as const,
      trust_level: trust,
      confidence: s.extraction_confidence,
      uncertainty: [
        "document_extracted",
        ...(s.certainty === "UNCERTAIN" ? ["explicit_uncertainty"] : []),
        ...(s.verification === "UNREVIEWED" ? ["clinician_review_required"] : []),
      ],
      provenance: {
        study_id: studyId,
        document_id: extraction.document_id,
        page: s.page_index,
        source_text: s.raw_text,
        extraction_method: `clinical-extraction:${extraction.extraction_version}`,
      },
      conflict_ids: [],
    };
  });
  return mapped.filter((item): item is EvidenceItem => item !== null);
}

/**
 * Explicitly labelled diagnosis/assessment text from a source document is a
 * separate evidence type. It is useful context for a reviewer, but it is
 * never fed into the VisionScan differential as a confirmed diagnosis. The
 * quoted source text and page remain the authority; an optional clinician
 * annotation changes only the trust label, not the origin.
 */
export function evidenceFromSourceDocumentDiagnoses(
  studyId: string,
  extraction: StoredRecordExtraction,
): EvidenceItem[] {
  return (extraction.source_document_diagnoses ?? []).map((d) => {
    const trust: EvidenceTrustLevel =
      d.verification === "REJECTED_BY_CLINICIAN" ? "REJECTED" :
      d.verification === "VERIFIED_BY_CLINICIAN" || d.verification === "CORRECTED_BY_CLINICIAN" ? "HUMAN_VERIFIED" :
      "AUTO_EXTRACTED";
    return {
      id: newId("ev"),
      study_id: studyId,
      source_type: "SOURCE_DOCUMENT_DIAGNOSIS" as const,
      source_id: `document-diagnosis:${extraction.document_id}:${d.item_id}`,
      category: "source_document_diagnosis",
      laterality: "UNKNOWN" as const,
      laterality_source: "unknown" as const,
      qualitative_finding: d.diagnosis_raw,
      presence: "PRESENT" as const,
      trust_level: trust,
      date_raw: d.date_raw,
      uncertainty: [
        "source_document_claim",
        ...(d.verification === "UNREVIEWED" ? ["clinician_review_required"] : []),
      ],
      provenance: {
        study_id: studyId,
        document_id: extraction.document_id,
        page: d.page_index,
        source_text: d.raw_text,
        source_clinician_raw: d.source_clinician_raw,
        extraction_method: `clinical-extraction:${extraction.extraction_version}`,
      },
      conflict_ids: [],
    };
  });
}

/**
 * Explicitly documented negative statements (for example, "denies
 * floaters") are retained as ABSENT evidence. They are displayable and
 * auditable, but the positive condition matcher deliberately ignores them.
 */
export function evidenceFromExtractedNegations(
  studyId: string,
  extraction: StoredRecordExtraction,
): EvidenceItem[] {
  return (extraction.explicit_negations ?? []).map((n) => {
    const isSymptom = n.kind === "SYMPTOM" && !!n.type && !!SYMPTOM_MAP[n.type];
    const category = isSymptom ? n.type! : n.kind.toLowerCase();
    const sourceType: EvidenceSourceType = isSymptom ? "SYMPTOM" : n.kind === "ALLERGY" ? "ALLERGY" : "HISTORY";
    return {
      id: newId("ev"),
      study_id: studyId,
      source_type: sourceType,
      source_id: `document-negation:${extraction.document_id}:${n.item_id}`,
      category,
      laterality: "UNKNOWN" as const,
      laterality_source: "unknown" as const,
      qualitative_finding: "explicitly absent",
      presence: "ABSENT" as const,
      trust_level: "AUTO_EXTRACTED" as const,
      uncertainty: ["document_extracted", "explicit_negation", "clinician_review_required"],
      provenance: {
        study_id: studyId,
        document_id: extraction.document_id,
        page: n.page_index,
        source_text: n.raw_text,
        extraction_method: `clinical-extraction:${extraction.extraction_version}`,
      },
      conflict_ids: [],
    };
  });
}

/** Document-extracted medication candidates; identity and safety remain unresolved. */
export function evidenceFromExtractedMedications(
  studyId: string,
  extraction: StoredRecordExtraction,
): EvidenceItem[] {
  return (extraction.medications ?? []).map((m) => ({
    id: newId("ev"),
    study_id: studyId,
    source_type: "MEDICATION" as const,
    source_id: `document-medication:${extraction.document_id}:${m.item_id}`,
    category: m.form_hint === "eye_drops" ? "ocular_medication" : "medication",
    laterality: "UNKNOWN" as const,
    laterality_source: "unknown" as const,
    qualitative_finding: [m.name_raw, m.dose_raw].filter(Boolean).join(" "),
    presence: "PRESENT" as const,
    trust_level: m.verification === "REJECTED_BY_CLINICIAN" ? "REJECTED" as const :
      m.verification === "VERIFIED_BY_CLINICIAN" || m.verification === "CORRECTED_BY_CLINICIAN" ? "HUMAN_VERIFIED" as const : "AUTO_EXTRACTED" as const,
    uncertainty: ["document_extracted", "identity_unresolved", ...(m.verification === "UNREVIEWED" ? ["clinician_review_required"] : [])],
    provenance: {
      study_id: studyId,
      document_id: extraction.document_id,
      page: m.page_index,
      extraction_method: `clinical-extraction:${extraction.extraction_version}`,
    },
    conflict_ids: [],
  }));
}

/** Document-extracted allergy candidates; reaction/severity are never inferred. */
export function evidenceFromExtractedAllergies(
  studyId: string,
  extraction: StoredRecordExtraction,
): EvidenceItem[] {
  return (extraction.allergies ?? []).map((a) => ({
    id: newId("ev"),
    study_id: studyId,
    source_type: "ALLERGY" as const,
    source_id: `document-allergy:${extraction.document_id}:${a.item_id}`,
    category: "allergy",
    laterality: "UNKNOWN" as const,
    laterality_source: "unknown" as const,
    qualitative_finding: [a.allergen_raw, a.reaction_raw].filter(Boolean).join(" "),
    presence: "PRESENT" as const,
    trust_level: a.verification === "REJECTED_BY_CLINICIAN" ? "REJECTED" as const :
      a.verification === "VERIFIED_BY_CLINICIAN" || a.verification === "CORRECTED_BY_CLINICIAN" ? "HUMAN_VERIFIED" as const : "AUTO_EXTRACTED" as const,
    uncertainty: ["document_extracted", "identity_unresolved", ...(a.verification === "UNREVIEWED" ? ["clinician_review_required"] : [])],
    provenance: {
      study_id: studyId,
      document_id: extraction.document_id,
      page: a.page_index,
      extraction_method: `clinical-extraction:${extraction.extraction_version}`,
    },
    conflict_ids: [],
  }));
}

/** Document-extracted history and exam context. These are source claims,
 * not coded diagnoses and never participate in the condition matcher unless
 * a future, explicitly defined rule opts in. */
export function evidenceFromExtractedHistory(
  studyId: string,
  extraction: RecordExtraction,
): EvidenceItem[] {
  const trustOf = (verification: string): EvidenceTrustLevel =>
    verification === "REJECTED_BY_CLINICIAN" ? "REJECTED" :
      verification === "VERIFIED_BY_CLINICIAN" || verification === "CORRECTED_BY_CLINICIAN" ? "HUMAN_VERIFIED" : "AUTO_EXTRACTED";
  const history = [
    ...(extraction.ocular_history_candidates ?? []),
    ...(extraction.family_history_candidates ?? []),
    ...(extraction.exam_findings ?? []),
  ];
  const items: EvidenceItem[] = history.map((h) => ({
    id: newId("ev"),
    study_id: studyId,
    source_type: h.kind === "EXAM_FINDING" ? "CLINICIAN_OBSERVATION" as const : "HISTORY" as const,
    source_id: `document-history:${extraction.document_id}:${h.item_id}`,
    category: h.kind.toLowerCase(),
    laterality: lateralityFromSymptomReport(h.laterality ?? "unknown"),
    laterality_source: h.laterality ? "mapped_from_symptom_report" as const : "unknown" as const,
    qualitative_finding: h.value_raw,
    presence: "PRESENT" as const,
    trust_level: trustOf(h.verification),
    date_raw: h.date_raw,
    uncertainty: ["document_extracted", ...(h.verification === "UNREVIEWED" ? ["clinician_review_required"] : [])],
    provenance: {
      study_id: studyId,
      document_id: extraction.document_id,
      page: h.page_index,
      source_text: h.raw_text,
      extraction_method: `clinical-extraction:${extraction.extraction_version}`,
    },
    conflict_ids: [],
  }));
  if (extraction.chief_complaint) {
    const cc = extraction.chief_complaint;
    items.push({
      id: newId("ev"),
      study_id: studyId,
      source_type: "HISTORY" as const,
      source_id: `document-chief-complaint:${extraction.document_id}`,
      category: "chief_complaint",
      laterality: "UNKNOWN" as const,
      laterality_source: "unknown" as const,
      qualitative_finding: cc.value_raw,
      presence: "PRESENT" as const,
      trust_level: trustOf(cc.verification),
      uncertainty: ["document_extracted", ...(cc.verification === "UNREVIEWED" ? ["clinician_review_required"] : [])],
      provenance: {
        study_id: studyId,
        document_id: extraction.document_id,
        page: cc.page_index,
        source_text: cc.raw_text,
        extraction_method: `clinical-extraction:${extraction.extraction_version}`,
      },
      conflict_ids: [],
    });
  }
  return items;
}

/** Explicit human observation entered during clinician review. It is kept in
 * a separate source type from AI findings and source-document claims; this
 * lets the workspace show the observation without pretending it came from a
 * model or a document. */
export function evidenceFromClinicianObservations(
  studyId: string,
  observations: NonNullable<ClinicalReport["clinician_observations"]>,
): EvidenceItem[] {
  return observations.map((o) => ({
    id: newId("ev"),
    study_id: studyId,
    source_type: "CLINICIAN_OBSERVATION" as const,
    source_id: `clinician-observation:${o.observation_id}`,
    category: "clinician_observation",
    laterality: o.laterality === "OD" || o.laterality === "OS" || o.laterality === "OU" ? o.laterality : "UNKNOWN",
    laterality_source: o.laterality ? "explicit" as const : "unknown" as const,
    qualitative_finding: o.text,
    presence: "PRESENT" as const,
    trust_level: "CLINICIAN_ENTERED" as const,
    timestamp: o.at,
    provenance: { study_id: studyId, source_clinician_raw: o.reviewer_id },
    conflict_ids: [],
  }));
}

/**
 * Image-analysis Findings. `synthetic: true` on the source Finding means
 * DEMO-generated (never real clinical output); this deployment has no
 * externally/clinically validated model (Gate A is CLOSED), so every image
 * finding is UNVERIFIED here regardless of its numeric confidence - a
 * confidence score is not clinical calibration (S5.9).
 */
export function evidenceFromFindings(studyId: string, studyEye: string, findings: Finding[]): EvidenceItem[] {
  return findings.map((f) => ({
    id: newId("ev"),
    study_id: studyId,
    source_type: "AI_FINDING" as const,
    source_id: f.id,
    category: f.type,
    laterality: lateralityFromStudyEye(studyEye),
    laterality_source: "study_level" as const,
    qualitative_finding: f.severity,
    presence: "PRESENT" as const,
    trust_level: "UNVERIFIED" as const,
    confidence: f.confidence,
    provenance: { study_id: studyId, analysis_id: `anl_${studyId}`, finding_id: f.id },
    conflict_ids: [],
    synthetic: f.synthetic,
  }));
}

/**
 * Ophthalmology-center Phase 1 - maps a PatientEncounter's provenance
 * vocabulary onto the evidence layer's trust vocabulary. AI_INFERRED/
 * AI_DERIVED history can NEVER map to HUMAN_VERIFIED - only an explicit
 * VERIFIED_BY_CLINICIAN or a direct CLINICIAN_ENTERED origin does. This
 * mirrors evidenceFromTestResults()'s trustFromVerification(): both are the
 * single place their respective source's provenance becomes a trust level.
 */
function trustFromEncounterProvenance(p: DataProvenance): EvidenceTrustLevel {
  switch (p) {
    case "CLINICIAN_ENTERED":
    case "VERIFIED_BY_CLINICIAN":
      return "HUMAN_VERIFIED";
    case "AI_INFERRED":
    case "AI_DERIVED":
    case "PATIENT_REPORTED":
      return "UNVERIFIED";
    case "DEVICE_MEASURED":
    case "LAB_IMPORTED":
    case "DOCUMENT_EXTRACTED":
    default:
      return "AUTO_EXTRACTED";
  }
}

/**
 * Ocular/surgical history entries -> HISTORY evidence. Free-text
 * `condition`/`note` fields are carried as qualitative_finding verbatim -
 * never parsed into a coded diagnosis this deployment doesn't validate.
 */
export function evidenceFromOcularHistory(studyId: string, entries: PatientEncounter["ocular_history"], encounterId: string): EvidenceItem[] {
  return entries.map((e, i) => {
    const entry: OcularHistoryEntry = e.value;
    return {
      id: newId("ev"),
      study_id: studyId,
      source_type: "HISTORY" as const,
      source_id: `history:${encounterId}:${i}`,
      category: "ocular_history",
      laterality: entry.laterality === "right" ? "OD" : entry.laterality === "left" ? "OS" : entry.laterality === "both" ? "OU" : "UNKNOWN",
      laterality_source: "mapped_from_symptom_report" as const,
      qualitative_finding: entry.note ? `${entry.condition} (${entry.note})` : entry.condition,
      presence: "PRESENT" as const,
      trust_level: trustFromEncounterProvenance(e.provenance),
      timestamp: e.recorded_at,
      date_raw: entry.year ?? undefined,
      provenance: { study_id: studyId, encounter_id: encounterId },
      conflict_ids: [],
    };
  });
}

/** Current medications -> MEDICATION evidence. Never cross-referenced against lib/treatment/medications.ts automatically here - see lib/treatment/allergySafety.ts for the explicit, separate allergy-cross-check function. */
export function evidenceFromMedications(studyId: string, entries: PatientEncounter["medications"], encounterId: string): EvidenceItem[] {
  return entries.map((e, i) => {
    const med: MedicationEntry = e.value;
    return {
      id: newId("ev"),
      study_id: studyId,
      source_type: "MEDICATION" as const,
      source_id: `medication:${encounterId}:${i}`,
      category: med.ocular ? "ocular_medication" : "systemic_medication",
      laterality: "UNKNOWN" as const,
      laterality_source: "unknown" as const,
      qualitative_finding: [med.name, med.dose, med.frequency].filter(Boolean).join(" "),
      presence: "PRESENT" as const,
      trust_level: trustFromEncounterProvenance(e.provenance),
      timestamp: e.recorded_at,
      provenance: { study_id: studyId, encounter_id: encounterId },
      conflict_ids: [],
    };
  });
}

/** Allergies -> ALLERGY evidence. */
export function evidenceFromAllergies(studyId: string, entries: PatientEncounter["allergies"], encounterId: string): EvidenceItem[] {
  return entries.map((e, i) => {
    const a: Allergy = e.value;
    return {
      id: newId("ev"),
      study_id: studyId,
      source_type: "ALLERGY" as const,
      source_id: `allergy:${encounterId}:${i}`,
      category: "allergy",
      laterality: "UNKNOWN" as const,
      laterality_source: "unknown" as const,
      qualitative_finding: a.reaction ? `${a.allergen} (${a.reaction})` : a.allergen,
      presence: "PRESENT" as const,
      trust_level: trustFromEncounterProvenance(e.provenance),
      timestamp: e.recorded_at,
      provenance: { study_id: studyId, encounter_id: encounterId },
      conflict_ids: [],
    };
  });
}

/** Systemic-history facts are contextual history only; no ophthalmic
 * diagnosis or causal claim is inferred from them. */
export function evidenceFromSystemicHistory(
  studyId: string,
  entry: PatientEncounter["systemic_history"],
  encounterId: string,
): EvidenceItem[] {
  if (!entry) return [];
  const value = entry.value;
  const values = [
    ["diabetes", value.diabetes],
    ["hypertension", value.hypertension],
  ].filter(([, v]) => v !== undefined && v !== "unknown") as Array<[string, string]>;
  return values.map(([key, state]) => ({
    id: newId("ev"),
    study_id: studyId,
    source_type: "HISTORY" as const,
    source_id: `systemic-history:${encounterId}:${key}`,
    category: `systemic_${key}`,
    laterality: "OU" as const,
    laterality_source: "unknown" as const,
    qualitative_finding: state,
    presence: state === "yes" ? "PRESENT" as const : "ABSENT" as const,
    trust_level: trustFromEncounterProvenance(entry.provenance),
    timestamp: entry.recorded_at,
    provenance: { study_id: studyId, encounter_id: encounterId },
    conflict_ids: [],
  }));
}

/** Family history is shown as source context only; no disease is inferred
 * from free-text family-history phrases. */
export function evidenceFromFamilyHistory(
  studyId: string,
  entry: PatientEncounter["family_history"],
  encounterId: string,
): EvidenceItem[] {
  if (!entry) return [];
  const values = [
    ...entry.value.ocular_family_history.map((value) => ({ category: "ocular_family_history", value })),
    ...entry.value.systemic_family_history.map((value) => ({ category: "systemic_family_history", value })),
  ];
  return values.map((item, i) => ({
    id: newId("ev"),
    study_id: studyId,
    source_type: "HISTORY" as const,
    source_id: `family-history:${encounterId}:${i}`,
    category: item.category,
    laterality: "OU" as const,
    laterality_source: "unknown" as const,
    qualitative_finding: item.value,
    presence: "PRESENT" as const,
    trust_level: trustFromEncounterProvenance(entry.provenance),
    timestamp: entry.recorded_at,
    provenance: { study_id: studyId, encounter_id: encounterId },
    conflict_ids: [],
  }));
}
