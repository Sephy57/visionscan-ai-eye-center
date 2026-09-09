/**
 * S5 - unified evidence representation.
 *
 * HARD RULE: this module is a READ-ONLY, non-clinical synthesis layer. It
 * reads existing safety-gated data (S3/S4 TestResults, Phase-3 symptoms,
 * document-extracted candidates, and image Findings) and re-expresses them
 * in one comparable shape for a human reviewer. It NEVER writes back into
 * lib/clinical, lib/analysis, lib/treatment, or lib/reports. Document-derived
 * candidates may raise a separate pre-review urgency signal, but evidence
 * trust still prevents unverified data from becoming a supported condition.
 * See docs/EVIDENCE_SYNTHESIS.md.
 *
 * Every "possible condition" this layer produces is an ASSOCIATION derived
 * from a structural, versioned, non-clinical taxonomy (lib/evidence/conditionTaxonomy.ts)
 * - never a diagnosis, never a probability, never clinical decision logic.
 */

export type EvidenceSourceType =
  | "IMAGE"                 // reserved for future direct per-pixel evidence; not populated in S5
  | "PDF"                   // reserved: whole-document-level evidence; not populated in S5 (see TEST_RESULT)
  | "SOURCE_DOCUMENT_DIAGNOSIS" // explicitly labelled diagnosis/assessment copied from a source document; never a VisionScan diagnosis
  | "TEST_RESULT"           // S3/S4 structured value extracted from an uploaded document
  | "SYMPTOM"                // Phase-3 structured patient-reported symptom
  | "HISTORY"                // ophthalmology-center Phase 1: lib/patients/encounter.ts's ocular/systemic/family history entries
  | "MEDICATION"             // ophthalmology-center Phase 1: lib/patients/encounter.ts's MedicationEntry records
  | "ALLERGY"                // ophthalmology-center Phase 1: lib/patients/encounter.ts's Allergy records
  | "CLINICIAN_OBSERVATION"  // additive clinician observation from the review workspace
  | "AI_FINDING";            // image-analysis pipeline Finding (DEMO-only in this deployment)

/**
 * How much this evidence item can be trusted to participate in synthesis.
 * REJECTED items are carried for audit/display but are always excluded from
 * conflict detection and condition assessment (S5.2/S5.11).
 */
export type EvidenceTrustLevel =
  | "UNVERIFIED"           // e.g. a self-reported symptom, or an unreviewed extraction
  | "AUTO_EXTRACTED"       // machine output, never seen by a human (S3 initial state)
  | "HUMAN_VERIFIED"       // a clinician/reviewer confirmed or corrected the value (S4)
  | "CLINICIAN_ENTERED"    // additive clinician observation from the review workspace
  | "VALIDATED_AI_FINDING" // an AI finding from a model with EXTERNALLY_VALIDATED/CLINICALLY_VALIDATED status
  | "REJECTED";            // a human determined the evidence cannot be trusted (S4 reject)

/** Canonical clinical laterality. See lib/evidence/laterality.ts for the explicit, non-silent mappings into this vocabulary. */
export type EvidenceLaterality = "OD" | "OS" | "OU" | "UNKNOWN";

export type EvidenceLateralitySource =
  | "explicit"                     // taken directly from an OD/OS/OU token in the source (TestResult)
  | "mapped_from_symptom_report"   // mapped from patient-facing right/left/both/unknown wording
  | "study_level"                  // inherited from the study's declared eye (image findings)
  | "unknown";

/** Canonical source vocabulary used by the clinician-review contract. */
export type CanonicalEvidenceSourceType =
  | "PATIENT_REPORTED"
  | "CLINICIAN_VERIFIED"
  | "SOURCE_DOCUMENT"
  | "DOCUMENT_EXTRACTED"
  | "DEVICE_MEASUREMENT"
  | "AI_RESEARCH_FINDING"
  | "AI_RESEARCH_CLASSIFICATION"
  | "LONGITUDINAL_COMPARISON";

export type EvidenceTemporalState =
  | "SAME_ENCOUNTER"
  | "NEARBY_ENCOUNTER"
  | "HISTORICAL"
  | "TEMPORALLY_UNCERTAIN";

export type EvidenceNegation = "PRESENT" | "ABSENT" | "NOT_REPORTED" | "UNKNOWN";
export type EvidenceCertainty = "CERTAIN" | "UNCERTAIN" | "UNKNOWN";

/**
 * Distinguishes "the source never mentioned this" from "the source explicitly
 * says this is absent" from "we don't know" (S5.3/S5.16). Document negation
 * extraction produces ABSENT items only when a denial is explicitly present;
 * absence of a match remains NOT_REPORTED/UNKNOWN and is never treated as a
 * denial.
 */
export type PresenceState = "PRESENT" | "NOT_REPORTED" | "ABSENT" | "UNKNOWN";

export interface EvidenceProvenance {
  study_id: string;
  document_id?: string;
  encounter_id?: string;
  result_id?: string;
  page?: number;
  source_text?: string;
  source_clinician_raw?: string;
  analysis_id?: string;
  finding_id?: string;
  extraction_method?: string;
  source_asset_id?: string;
  source_page_hash?: string;
  roi_id?: string;
  roi_hash?: string;
}

export interface EvidenceItem {
  id: string;
  study_id: string;
  source_type: EvidenceSourceType;
  /** Opaque id of the originating record (result_id, a synthetic symptom key, a finding id, ...). */
  source_id: string;
  /** What this evidence is about: a TestType, a symptom type, or a finding type - source-specific vocab. */
  category: string;
  /** Optional metric discriminator for tests that produce multiple values under one category (for example VF MD vs PSD, or OCT RNFL vs GCC). */
  metric_subtype?: string;
  laterality: EvidenceLaterality;
  laterality_source: EvidenceLateralitySource;
  value?: number;
  unit?: string;
  /** Non-numeric characterization (a symptom label, a finding severity, a qualitative image note). */
  qualitative_finding?: string;
  presence: PresenceState;
  timestamp?: string;   // ISO, only when unambiguously known
  date_raw?: string;     // preserved raw date text when timestamp could not be resolved
  trust_level: EvidenceTrustLevel;
  /** 0..1 where the source provides one (e.g. OCR page confidence, model confidence). Never invented. */
  confidence?: number;
  /** Ambiguity/uncertainty flags carried over from the source (e.g. S3 ambiguity_flags). */
  uncertainty?: string[];
  provenance: EvidenceProvenance;
  /** EvidenceConflict ids this item participates in - populated after conflict detection. */
  conflict_ids: string[];
  /** True for any demo/synthetic-origin evidence (never real clinical data). */
  synthetic?: boolean;
  /** Canonical evidence graph fields (additive to the stable S5 shape). */
  evidence_id?: string;
  patient_id?: string | null;
  encounter_id?: string | null;
  modality?: string;
  concept?: string;
  raw_value?: string | number | null;
  normalized_value?: string | number | null;
  negation?: EvidenceNegation;
  certainty?: EvidenceCertainty;
  verification_status?: string;
  canonical_source_type?: CanonicalEvidenceSourceType;
  model_id?: string | null;
  model_version?: string | null;
  document_page?: number | null;
  roi_id?: string | null;
  dependency_group_id?: string;
  temporal_state?: EvidenceTemporalState;
}

export type ConflictType = "VALUE_CONFLICT" | "LATERALITY_CONFLICT" | "QUALITATIVE_CONFLICT" | "SOURCE_DIAGNOSIS_CONFLICT";

export interface EvidenceConflict {
  id: string;
  conflict_type: ConflictType;
  category: string;
  laterality: EvidenceLaterality[];
  evidence_ids: string[];
  severity: "low" | "medium" | "high";
  resolution_state: "UNRESOLVED" | "ACKNOWLEDGED";
  note: string;
}

export type ConditionAssessmentState =
  | "POSSIBLE_CONDITION"
  | "SUPPORTED_CONDITION"
  | "INSUFFICIENT_EVIDENCE"
  | "CONFLICTING_EVIDENCE"
  | "UNABLE_TO_ASSESS";

export interface ConditionAssessment {
  condition_id: string;
  canonical_name: string;
  category: string;
  /**
   * The eye this assessment applies to. For a "per_eye" condition, OD and OS
   * are assessed independently and never share evidence (S5.4/S5.22) - an OU
   * evidence item counts toward both. "whole_patient" conditions produce a
   * single assessment with laterality "OU".
   */
  laterality: EvidenceLaterality;
  state: ConditionAssessmentState;
  supporting_evidence_ids: string[];
  contradicting_evidence_ids: string[];
  missing_required: string[];
  red_flag_candidates: string[];
  differential_relationships: string[];
  taxonomy_version: string;
  note: string;
  /** Structured differential fields; optional for legacy persisted workspaces. */
  assessment_state?: string;
  independent_source_count?: number;
  dependency_groups?: string[];
  model_support?: string[];
  objective_test_support?: string[];
  document_support?: string[];
  symptom_support?: string[];
  limitations?: string[];
  confirmation_requirements?: string[];
  /** Categorical, non-probabilistic ranking metadata for review ordering. */
  evidence_strength?: "NONE" | "LIMITED" | "MULTI_SOURCE" | "CONFLICTING";
  ranking_factors?: string[];
  rank?: number;
  specialty?: "RETINA" | "MACULA_OCT" | "GLAUCOMA" | "NEURO_OPHTHALMOLOGY" | "COMPREHENSIVE";
}

export interface EvidenceWorkspace {
  study_id: string;
  examination_context: {
    study_id: string;
    created_at: string;
    modality: string;
    eye: string;
    patient_ref?: string;
    source_count: {
      symptoms: number;
      test_results: number;
      ai_findings: number;
      source_document_diagnoses: number;
      history: number;
      medications: number;
      allergies: number;
    };
  };
  evidence: EvidenceItem[];
  conflicts: EvidenceConflict[];
  possible_conditions: ConditionAssessment[];
  safety_banner: string;
  taxonomy_version: string;
  generated_at: string;
  patient_id?: string | null;
}
