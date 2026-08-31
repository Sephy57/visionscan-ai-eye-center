/**
 * Ophthalmic condition taxonomy - a CONTROLLED vocabulary of conditions.
 *
 * CRITICAL: this taxonomy is NOT permission for the AI to diagnose anything.
 * A condition may appear as a "possible condition to consider" ONLY when:
 *   1. The installed model explicitly supports it (model.supported_conditions)
 *   2. The imaging modality is appropriate
 *   3. The model has documented validation evidence (gate + evidence reference)
 *   4. The device/input is within validated conditions
 *   5. The safety layer allows the output
 *
 * The DEMO model supports NO conditions, so none are ever displayed in this
 * deployment. Possible associations are always labeled as associations,
 * never diagnoses.
 */

export interface ConditionDef {
  id: string;
  label: string;
  modalities: string[];
  /** Finding types that would be relevant evidence for this condition. */
  relevant_finding_types: string[];
  /** Symptom types commonly associated - used ONLY for correlation wording. */
  commonly_associated_symptoms: string[];
  note: string;
}

export const CONDITIONS: ConditionDef[] = [
  { id: "diabetic_retinopathy", label: "Diabetic retinopathy", modalities: ["FUNDUS"], relevant_finding_types: ["retinal_hemorrhage", "microaneurysm_like_lesion", "ischemic_appearing_region", "neovascularization_like_finding"], commonly_associated_symptoms: ["blurred_vision", "floaters", "reduced_contrast"], note: "Microvascular retinal changes associated with diabetes." },
  { id: "diabetic_macular_edema", label: "Diabetic macular edema", modalities: ["OCT", "FUNDUS"], relevant_finding_types: ["retinal_thickening", "intraretinal_fluid", "cystic_spaces"], commonly_associated_symptoms: ["blurred_vision", "distorted_vision", "reduced_central_vision"], note: "Macular thickening/fluid in the context of diabetes." },
  { id: "age_related_macular_degeneration", label: "Age-related macular degeneration", modalities: ["FUNDUS", "OCT"], relevant_finding_types: ["drusen_like_deposit", "pigment_epithelial_abnormality", "retinal_thinning", "subretinal_fluid"], commonly_associated_symptoms: ["distorted_vision", "reduced_central_vision", "night_vision_difficulty"], note: "Macular changes associated with aging." },
  { id: "retinal_vein_occlusion", label: "Retinal vein occlusion", modalities: ["FUNDUS"], relevant_finding_types: ["retinal_hemorrhage", "possible_vascular_occlusion_related_finding", "retinal_thickening"], commonly_associated_symptoms: ["sudden_vision_loss", "blurred_vision"], note: "Occlusive retinal vascular pattern." },
  { id: "retinal_artery_occlusion", label: "Retinal artery occlusion", modalities: ["FUNDUS"], relevant_finding_types: ["ischemic_appearing_region", "possible_vascular_occlusion_related_finding"], commonly_associated_symptoms: ["sudden_vision_loss"], note: "Acute ischemic retinal pattern." },
  { id: "retinal_detachment", label: "Retinal detachment", modalities: ["FUNDUS", "OCT"], relevant_finding_types: ["detachment_like_abnormality"], commonly_associated_symptoms: ["curtain_shadow", "new_floaters", "flashes", "reduced_peripheral_vision"], note: "Elevated/detached retina pattern." },
  { id: "retinal_tear", label: "Retinal tear", modalities: ["FUNDUS"], relevant_finding_types: [], commonly_associated_symptoms: ["new_floaters", "flashes"], note: "Requires peripheral retinal examination; imaging may not demonstrate." },
  { id: "epiretinal_membrane", label: "Epiretinal membrane", modalities: ["OCT"], relevant_finding_types: ["vitreoretinal_interface_abnormality"], commonly_associated_symptoms: ["distorted_vision", "wavy_lines", "blurred_vision"], note: "Vitreoretinal interface change." },
  { id: "macular_hole", label: "Macular hole", modalities: ["OCT"], relevant_finding_types: ["macular_hole_like_abnormality"], commonly_associated_symptoms: ["distorted_vision", "reduced_central_vision"], note: "Full-thickness macular defect pattern." },
  { id: "vitreous_abnormality", label: "Vitreous abnormalities", modalities: ["OCT", "FUNDUS"], relevant_finding_types: ["vitreoretinal_interface_abnormality", "indeterminate_focal_hyperreflective_region"], commonly_associated_symptoms: ["floaters", "spots_in_vision"], note: "Vitreous opacity/interface changes." },
  { id: "glaucoma_related_optic_nerve_findings", label: "Glaucoma-related optic nerve findings", modalities: ["FUNDUS", "OCT"], relevant_finding_types: [], commonly_associated_symptoms: ["reduced_peripheral_vision"], note: "Cup-to-disc ratio alone NEVER establishes glaucoma; requires IOP, visual fields, RNFL analysis." },
  { id: "cataract_related_visual_symptoms", label: "Cataract-related visual symptoms", modalities: ["SLIT_LAMP"], relevant_finding_types: [], commonly_associated_symptoms: ["blurred_vision", "night_vision_difficulty", "reduced_contrast"], note: "Assessment requires slit-lamp imaging; fundus photos cannot assess lens opacity reliably." },
  { id: "optic_nerve_abnormality", label: "Optic nerve abnormality", modalities: ["FUNDUS", "OCT"], relevant_finding_types: [], commonly_associated_symptoms: ["reduced_peripheral_vision", "transient_vision_changes"], note: "Optic nerve appearance requires professional interpretation." },
  { id: "retinal_hemorrhagic_condition", label: "Retinal hemorrhagic condition", modalities: ["FUNDUS"], relevant_finding_types: ["retinal_hemorrhage"], commonly_associated_symptoms: ["floaters", "spots_in_vision", "sudden_vision_loss"], note: "Intraocular bleeding pattern of varied causes." },
];

export const CONDITION_MAP: Record<string, ConditionDef> = Object.fromEntries(
  CONDITIONS.map((c) => [c.id, c])
);

export interface PossibleConditionInput {
  /** Model registry record: what conditions does it support? */
  supported_conditions: string[];
  modality: string;
  modelStatus: string;
  hasValidationEvidence: boolean;
  findings: Array<{ type: string }>;
}

export interface PossibleCondition {
  id: string;
  label: string;
  matched_findings: string[];
  note: string;
}

/**
 * Possible conditions to consider - ASSOCIATIONS ONLY.
 * Empty for DEMO/unvalidated models: an unvalidated model can never surface
 * a condition, even when findings match, because condition inference requires
 * documented validation evidence for that specific intended use.
 */
export function possibleConditions(input: PossibleConditionInput): {
  conditions: PossibleCondition[];
  note: string;
} {
  const NOTE =
    "These are potential clinical associations derived from a controlled knowledge base, NOT an automated " +
    "diagnosis. Only a qualified clinician can establish a diagnosis.";

  if (input.modelStatus !== "EXTERNALLY_VALIDATED" && input.modelStatus !== "CLINICALLY_VALIDATED") {
    return {
      conditions: [],
      note:
        "No conditions are displayed: the current model is not validated, and condition inference requires " +
        "documented validation evidence for the specific intended use. " + NOTE,
    };
  }
  if (!input.hasValidationEvidence) {
    return { conditions: [], note: "No conditions displayed: missing validation evidence reference. " + NOTE };
  }

  const out: PossibleCondition[] = [];
  for (const id of input.supported_conditions) {
    const def = CONDITION_MAP[id];
    if (!def) continue; // unknown condition id in registry -> blocked
    if (!def.modalities.includes(input.modality.toUpperCase())) continue;
    const matched = input.findings.filter((f) => def.relevant_finding_types.includes(f.type)).map((f) => f.type);
    if (matched.length === 0) continue; // no relevant imaging evidence -> do not display
    out.push({ id: def.id, label: def.label, matched_findings: matched, note: def.note });
  }
  return { conditions: out, note: out.length ? NOTE : "No condition associations met the evidence requirements for display. " + NOTE };
}
