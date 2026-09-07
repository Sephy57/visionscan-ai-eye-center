import type { EvidenceSourceType } from "./types";

/**
 * S5.7 - a STRUCTURAL, non-clinical evidence taxonomy. This is deliberately
 * NOT the clinical decision logic in lib/clinical/conditions.ts (which gates
 * real condition output on a validated model + documented validation
 * evidence, per that file's own header). This taxonomy exists only to
 * demonstrate and exercise the evidence-synthesis architecture end to end.
 *
 * Every matcher below is PRESENCE-based ("does evidence of this category
 * exist for this source type"), never a clinical value threshold ("IOP >
 * 21 mmHg = elevated"). Encoding a clinical cutoff here would be inventing
 * a medical reference range in disguise (forbidden - see S4.10/S5.9). If a
 * value-based rule is ever wanted, it belongs to a future, clinically
 * validated pathway (S6+), not this structural layer.
 */

export const EVIDENCE_TAXONOMY_VERSION = "evidence-taxonomy-0.1.0-non-clinical";

export interface EvidenceMatcher {
  source_type: EvidenceSourceType;
  category: string; // TestType | symptom type | Finding type
}

export interface EvidenceConditionDef {
  condition_id: string;
  canonical_name: string;
  category: string;
  aliases: string[];
  required_evidence: EvidenceMatcher[];
  supportive_evidence: EvidenceMatcher[];
  contradictory_evidence: EvidenceMatcher[];
  laterality_behavior: "per_eye" | "whole_patient";
  differential_relationships: string[];
  /** Symptom types that, if present alongside this condition's evidence, are surfaced as RED_FLAG_CANDIDATE (S5.13) - never an emergency diagnosis. */
  red_flags: string[];
  evidence_thresholds: { min_independent_supportive_for_supported: number };
  version: string;
}

export const EVIDENCE_CONDITIONS: EvidenceConditionDef[] = [
  {
    condition_id: "iop_evidence_pattern",
    canonical_name: "Elevated intraocular pressure pattern",
    category: "pressure",
    aliases: ["ocular_hypertension_pattern"],
    required_evidence: [{ source_type: "TEST_RESULT", category: "IOP" }],
    supportive_evidence: [
      { source_type: "SYMPTOM", category: "reduced_peripheral_vision" },
      { source_type: "SYMPTOM", category: "transient_vision_changes" },
      { source_type: "AI_FINDING", category: "possible_vascular_occlusion_related_finding" },
    ],
    contradictory_evidence: [],
    laterality_behavior: "per_eye",
    differential_relationships: ["glaucoma_related_optic_nerve_findings"],
    red_flags: ["severe_eye_pain_with_visual_disturbance"],
    evidence_thresholds: { min_independent_supportive_for_supported: 2 },
    version: EVIDENCE_TAXONOMY_VERSION,
  },
  {
    condition_id: "macular_thickening_pattern",
    canonical_name: "Macular thickening / fluid evidence pattern",
    category: "macula",
    aliases: [],
    required_evidence: [{ source_type: "TEST_RESULT", category: "CENTRAL_SUBFIELD_THICKNESS" }],
    supportive_evidence: [
      { source_type: "SYMPTOM", category: "distorted_vision" },
      { source_type: "SYMPTOM", category: "reduced_central_vision" },
      { source_type: "SYMPTOM", category: "blurred_vision" },
      { source_type: "AI_FINDING", category: "retinal_thickening" },
      { source_type: "AI_FINDING", category: "intraretinal_fluid" },
    ],
    contradictory_evidence: [],
    laterality_behavior: "per_eye",
    differential_relationships: ["diabetic_macular_edema", "age_related_macular_degeneration"],
    red_flags: [],
    evidence_thresholds: { min_independent_supportive_for_supported: 2 },
    version: EVIDENCE_TAXONOMY_VERSION,
  },
  {
    condition_id: "optic_nerve_evidence_pattern",
    canonical_name: "Optic nerve cupping evidence pattern",
    category: "optic_nerve",
    aliases: [],
    required_evidence: [{ source_type: "TEST_RESULT", category: "CUP_TO_DISC_RATIO" }],
    supportive_evidence: [
      { source_type: "TEST_RESULT", category: "IOP" },
      { source_type: "SYMPTOM", category: "reduced_peripheral_vision" },
    ],
    contradictory_evidence: [],
    laterality_behavior: "per_eye",
    differential_relationships: ["glaucoma_related_optic_nerve_findings"],
    red_flags: [],
    evidence_thresholds: { min_independent_supportive_for_supported: 2 },
    version: EVIDENCE_TAXONOMY_VERSION,
  },
  {
    condition_id: "acute_vision_change_pattern",
    canonical_name: "Acute vision-change evidence pattern",
    category: "acute",
    aliases: [],
    required_evidence: [],
    supportive_evidence: [
      { source_type: "SYMPTOM", category: "sudden_vision_loss" },
      { source_type: "SYMPTOM", category: "curtain_shadow" },
      { source_type: "SYMPTOM", category: "flashes_with_field_loss" },
      { source_type: "AI_FINDING", category: "detachment_like_abnormality" },
    ],
    contradictory_evidence: [],
    laterality_behavior: "per_eye",
    differential_relationships: ["retinal_detachment", "retinal_artery_occlusion", "retinal_vein_occlusion"],
    red_flags: ["sudden_vision_loss", "curtain_shadow", "flashes_with_field_loss", "trauma_with_vision_loss"],
    evidence_thresholds: { min_independent_supportive_for_supported: 2 },
    version: EVIDENCE_TAXONOMY_VERSION,
  },
  {
    condition_id: "diabetic_retinal_disease_pattern",
    canonical_name: "Diabetic retinal disease evidence pattern",
    category: "retina",
    aliases: ["diabetic_retinopathy_pattern"],
    // No single required item: this pattern only ever assembles
    // multi-source research evidence. AI findings here are UNVERIFIED trust,
    // so the assessment can reach at most POSSIBLE without clinician
    // verification — never SUPPORTED, never a diagnosis. See
    // docs/FUNDUS_LESION_FAILURE_ANALYSIS.md for model limits.
    required_evidence: [],
    supportive_evidence: [
      { source_type: "AI_FINDING", category: "dr_grade_estimate" },
      { source_type: "AI_FINDING", category: "retinal_hemorrhage" },
      { source_type: "AI_FINDING", category: "microaneurysm_like_lesion" },
      { source_type: "AI_FINDING", category: "hard_exudate" },
      { source_type: "AI_FINDING", category: "cotton_wool_spot" },
      { source_type: "SYMPTOM", category: "blurred_vision" },
      { source_type: "SYMPTOM", category: "reduced_central_vision" },
    ],
    contradictory_evidence: [],
    laterality_behavior: "per_eye",
    differential_relationships: ["diabetic_macular_edema", "retinal_vein_occlusion", "age_related_macular_degeneration"],
    red_flags: ["sudden_vision_loss"],
    evidence_thresholds: { min_independent_supportive_for_supported: 3 },
    version: EVIDENCE_TAXONOMY_VERSION,
  },
];

export const EVIDENCE_CONDITION_MAP: Record<string, EvidenceConditionDef> = Object.fromEntries(
  EVIDENCE_CONDITIONS.map((c) => [c.condition_id, c])
);
