/**
 * Specialist domain registry (ophthalmology-center Phase 1 architecture).
 *
 * HARD RULES (mirrors lib/models/registry.ts and lib/treatment/medications.ts):
 *  - This is a DOCUMENTATION-ONLY registry of clinical specialty domains. It
 *    contains ZERO executable model logic and is NEVER wired into
 *    lib/analysis/pipeline.ts, lib/evidence/researchAnalysis.ts, or any
 *    inference path. Adding an entry here does not, and must never, imply a
 *    specialist model exists or runs.
 *  - Every specialty's `status` is "NO_VALIDATED_MODEL_AVAILABLE" today,
 *    because it is genuinely true: this deployment has exactly one real
 *    (unvalidated, research-only, isolated) model, the SegFormer optic-disc/
 *    cup segmentation model (see lib/models/segformerResearchProvider.ts),
 *    which itself is not attached to any specialty here.
 *  - `routeToSpecialties()` is an honest ROUTER STUB: given a modality, it
 *    returns which specialty domains WOULD conceptually be relevant to that
 *    modality, each explicitly marked `available: false`. It never returns a
 *    result implying a specialist actually analyzed anything.
 *  - Do not add a real model to a specialty entry without also: (a) a
 *    candidate-model dossier per docs/S8_MODEL_DISCOVERY.md's pattern,
 *    (b) real integration through the SAME safety pipeline every other real
 *    model goes through (quality/OOD/diagnosis gate), (c) tests.
 */

export type SpecialtyId =
  | "COMPREHENSIVE_OPHTHALMOLOGY"
  | "RETINA"
  | "GLAUCOMA"
  | "CORNEA_EXTERNAL_DISEASE"
  | "CATARACT_LENS"
  | "NEURO_OPHTHALMOLOGY"
  | "PEDIATRIC_OPHTHALMOLOGY"
  | "UVEITIS_INFLAMMATION"
  | "OCULAR_ONCOLOGY";

export type SpecialtyStatus = "NO_VALIDATED_MODEL_AVAILABLE";

export interface SpecialtyDef {
  specialty_id: SpecialtyId;
  label: string;
  /** Documentation only - the clinical scope this specialty conceptually covers, per the S-final master prompt's own list. Never an executable claim. */
  scope_description: string;
  condition_areas: string[];
  /** Modalities this specialty would conceptually be most relevant to, for routing purposes only - see routeToSpecialties(). */
  relevant_modalities: string[];
  status: SpecialtyStatus;
  /** True only for specialties requiring extra caution before ANY future model integration (e.g. population-specific validation gaps). */
  requires_population_specific_validation: boolean;
  notes?: string;
}

export const SPECIALTY_REGISTRY: SpecialtyDef[] = [
  {
    specialty_id: "COMPREHENSIVE_OPHTHALMOLOGY",
    label: "Comprehensive Ophthalmology",
    scope_description: "General ocular assessment, symptom correlation, anterior/posterior segment findings, differential organization, referral recommendations.",
    condition_areas: ["general_ocular_assessment", "symptom_correlation", "referral_triage"],
    relevant_modalities: ["FUNDUS", "SLIT_LAMP", "EXTERNAL_EYE"],
    status: "NO_VALIDATED_MODEL_AVAILABLE",
    requires_population_specific_validation: false,
  },
  {
    specialty_id: "RETINA",
    label: "Retina",
    scope_description: "Posterior segment / retinal and vitreoretinal disease areas.",
    condition_areas: [
      "diabetic_retinopathy", "diabetic_macular_edema", "age_related_macular_degeneration",
      "retinal_vein_occlusion", "retinal_artery_occlusion", "epiretinal_membrane", "macular_hole",
      "retinal_tears", "retinal_detachment", "retinal_hemorrhage", "retinal_edema", "drusen",
      "geographic_atrophy", "neovascular_findings",
    ],
    relevant_modalities: ["FUNDUS", "OCT", "OCTA", "FAF", "FA", "ICG"],
    status: "NO_VALIDATED_MODEL_AVAILABLE",
    requires_population_specific_validation: false,
  },
  {
    specialty_id: "GLAUCOMA",
    label: "Glaucoma",
    scope_description: "Optic nerve / glaucomatous change assessment.",
    condition_areas: [
      "optic_disc_assessment", "cup_to_disc_ratio", "rnfl_analysis", "ganglion_cell_analysis",
      "iop_context", "visual_field_interpretation", "glaucoma_progression", "asymmetry",
      "suspicious_optic_nerve_findings",
    ],
    relevant_modalities: ["FUNDUS", "OCT"],
    status: "NO_VALIDATED_MODEL_AVAILABLE",
    requires_population_specific_validation: false,
  },
  {
    specialty_id: "CORNEA_EXTERNAL_DISEASE",
    label: "Cornea / External Disease",
    scope_description: "Anterior-segment surface and corneal disease areas.",
    condition_areas: ["corneal_opacity", "ulceration", "keratitis", "corneal_edema", "epithelial_defects", "dry_eye_findings", "anterior_segment_abnormalities"],
    relevant_modalities: ["SLIT_LAMP", "EXTERNAL_EYE"],
    status: "NO_VALIDATED_MODEL_AVAILABLE",
    requires_population_specific_validation: false,
  },
  {
    specialty_id: "CATARACT_LENS",
    label: "Cataract / Lens",
    scope_description: "Lens opacity and lens-related findings.",
    condition_areas: ["cataract_grading", "lens_opacity", "postoperative_findings", "pseudophakia", "lens_related_abnormalities"],
    relevant_modalities: ["SLIT_LAMP", "EXTERNAL_EYE"],
    status: "NO_VALIDATED_MODEL_AVAILABLE",
    requires_population_specific_validation: false,
  },
  {
    specialty_id: "NEURO_OPHTHALMOLOGY",
    label: "Neuro-Ophthalmology",
    scope_description: "Optic-nerve/visual-pathway findings with a neurologic correlate.",
    condition_areas: ["optic_neuropathy_patterns", "optic_nerve_abnormalities", "pupil_related_symptoms", "visual_field_patterns", "diplopia", "neurologic_symptom_correlation"],
    relevant_modalities: ["FUNDUS", "OCT"],
    status: "NO_VALIDATED_MODEL_AVAILABLE",
    requires_population_specific_validation: false,
  },
  {
    specialty_id: "PEDIATRIC_OPHTHALMOLOGY",
    label: "Pediatric Ophthalmology",
    scope_description: "Age-dependent interpretation for pediatric patients.",
    condition_areas: ["pediatric_specific_findings", "amblyopia_related_context", "strabismus", "pediatric_retinal_findings"],
    relevant_modalities: ["FUNDUS", "EXTERNAL_EYE"],
    status: "NO_VALIDATED_MODEL_AVAILABLE",
    requires_population_specific_validation: true,
    notes: "No model in this deployment is validated for a pediatric population. A model validated only on adult data must never be presented as applicable to pediatric images, regardless of modality match - population match is a distinct, separately-required gate (see lib/models/diagnosisGate.ts's intended-use/population requirement).",
  },
  {
    specialty_id: "UVEITIS_INFLAMMATION",
    label: "Uveitis / Ocular Inflammation",
    scope_description: "Inflammatory findings, anterior chamber and posterior inflammatory patterns, systemic disease correlation.",
    condition_areas: ["anterior_chamber_findings", "posterior_inflammatory_patterns", "systemic_disease_correlation"],
    relevant_modalities: ["SLIT_LAMP", "FUNDUS"],
    status: "NO_VALIDATED_MODEL_AVAILABLE",
    requires_population_specific_validation: false,
  },
  {
    specialty_id: "OCULAR_ONCOLOGY",
    label: "Ocular Oncology",
    scope_description: "Suspicious/mass-like/pigmented lesion findings. Deliberately conservative and referral-oriented - this domain must never produce anything beyond a referral indicator unless a genuinely validated model exists.",
    condition_areas: ["suspicious_lesions", "mass_like_findings", "pigmented_lesions", "referral_indicators"],
    relevant_modalities: ["FUNDUS", "SLIT_LAMP", "EXTERNAL_EYE"],
    status: "NO_VALIDATED_MODEL_AVAILABLE",
    requires_population_specific_validation: false,
    notes: "Highest-stakes false-negative domain. Any future integration here requires more conservative gating than the default 7-condition diagnosis gate, not less.",
  },
];

export const SPECIALTY_MAP: Record<SpecialtyId, SpecialtyDef> = Object.fromEntries(
  SPECIALTY_REGISTRY.map((s) => [s.specialty_id, s])
) as Record<SpecialtyId, SpecialtyDef>;

export interface SpecialtyRoutingResult {
  specialty_id: SpecialtyId;
  label: string;
  relevant: boolean;
  available: false; // always false in this deployment - see file header
  reason: string;
}

/**
 * Honest router stub (§9). Determines which specialties a given modality
 * would conceptually route to - it NEVER runs inference, NEVER claims a
 * specialist is available, and is not called from any analysis pipeline.
 * Exists so the router concept has one real, testable, honest home instead
 * of being simulated ad hoc in a UI layer later.
 */
export function routeToSpecialties(modality: string): SpecialtyRoutingResult[] {
  return SPECIALTY_REGISTRY.map((s) => {
    const relevant = s.relevant_modalities.includes(modality);
    return {
      specialty_id: s.specialty_id,
      label: s.label,
      relevant,
      available: false,
      reason: relevant
        ? `No validated model is available for ${s.label} in this deployment. This modality would conceptually be routed here once a real, validated model exists.`
        : `${s.label} is not conceptually relevant to modality ${modality}.`,
    };
  });
}
