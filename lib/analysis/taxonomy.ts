/**
 * Controlled finding taxonomy.
 *
 * Three strictly separated levels:
 *   OBSERVATION          - what is visible/measurable in the image
 *   POSSIBLE_ASSOCIATION - "this finding can be associated with..." (never proof)
 *   DIAGNOSIS            - only a clinician, or a CLINICALLY_VALIDATED model
 *                          for a specific authorized intended use
 *
 * Ambiguous structures are NEVER labeled "blood clot"; vocabulary stays within
 * what the imaging modality can support, with INDETERMINATE when uncertain.
 */

export type TaxonomyLevel = "observation" | "possible_association" | "diagnosis";

export interface FindingDefinition {
  type: string;                     // canonical snake_case id
  level: TaxonomyLevel;             // taxonomy level the FINDING ITSELF lives at
  label: string;                    // human-readable
  modalities: string[];             // modalities that can support this finding
  measurement_schema?: MeasurementField[];
  associations: string[];           // possible associations (worded as associations, never diagnoses)
  high_risk: boolean;               // vision-threatening suspicion => conservative triage
}

export interface MeasurementField {
  key: string;
  unit: string | null;
  description: string;
}

export interface StructuredMeasurement {
  key: string;
  value: number;                    // never invented - must come from a real component
  unit: string | null;
  anatomical_region: string;
  source_modality: string;
  measurement_confidence: number | null; // null = unknown, never a guessed number
  model_id: string;
  model_version: string;
}

// ---------------------------------------------------------------------------
// Retinal / vascular findings (schema prepared; detection NOT implemented)
// ---------------------------------------------------------------------------

const FUNDUS = ["FUNDUS", "EXTERNAL_EYE"];

export const RETINAL_FINDINGS: FindingDefinition[] = [
  {
    type: "retinal_hemorrhage",
    level: "observation",
    label: "Retinal hemorrhage",
    modalities: FUNDUS,
    associations: ["vascular or retinal pathology (association, not diagnosis)"],
    high_risk: true,
  },
  {
    type: "microaneurysm_like_lesion",
    level: "observation",
    label: "Microaneurysm-like lesion",
    modalities: FUNDUS,
    associations: ["retinal microvascular change (association, not diagnosis)"],
    high_risk: false,
  },
  {
    type: "vascular_abnormality",
    level: "observation",
    label: "Vascular abnormality",
    modalities: FUNDUS,
    associations: ["retinal vascular disease (association, not diagnosis)"],
    high_risk: true,
  },
  {
    type: "vessel_narrowing",
    level: "observation",
    label: "Vessel narrowing",
    modalities: FUNDUS,
    associations: ["arteriolar change (association, not diagnosis)"],
    high_risk: false,
  },
  {
    type: "vessel_dilation",
    level: "observation",
    label: "Vessel dilation",
    modalities: FUNDUS,
    associations: ["venular change (association, not diagnosis)"],
    high_risk: false,
  },
  {
    type: "vessel_tortuosity",
    level: "observation",
    label: "Vessel tortuosity",
    modalities: FUNDUS,
    associations: ["vascular change (association, not diagnosis)"],
    high_risk: false,
  },
  {
    type: "possible_vascular_occlusion_related_finding",
    level: "observation",
    label: "Possible vascular occlusion-related finding",
    modalities: FUNDUS,
    associations: ["retinal vascular occlusion pattern (association, not diagnosis)"],
    high_risk: true,
  },
  {
    type: "ischemic_appearing_region",
    level: "observation",
    label: "Ischemic-appearing region",
    modalities: FUNDUS,
    associations: ["retinal ischemia pattern (association, not diagnosis)"],
    high_risk: true,
  },
  {
    type: "neovascularization_like_finding",
    level: "observation",
    label: "Neovascularization-like finding",
    modalities: FUNDUS,
    associations: ["proliferative retinopathy pattern (association, not diagnosis)"],
    high_risk: true,
  },
  {
    type: "indeterminate_focal_hyperreflective_region",
    level: "observation",
    label: "Indeterminate focal hyperreflective region",
    modalities: FUNDUS,
    associations: ["cannot be determined from this image alone; specialist review recommended"],
    high_risk: false,
  },
  // S10 - segmentation-derived optic-disc/cup area findings. Produced ONLY by
  // the isolated research pathway (lib/evidence/researchAnalysis.ts), never
  // by the DEMO pipeline. observation-level (a segmented pixel area is not
  // itself a diagnosis or even a possible-association claim on its own -
  // the S5 evidence/condition layer decides what, if anything, that area
  // pattern is associated with). NOT high_risk: an optic-disc/cup area
  // segmentation is not by itself a vision-threatening-emergency signal.
  {
    type: "research_segmented_optic_disc_area",
    level: "observation",
    label: "Segmented optic disc area (research)",
    modalities: FUNDUS,
    associations: ["optic nerve head morphology (association, not diagnosis) - requires cup-to-disc ratio context and clinical examination"],
    high_risk: false,
  },
  {
    type: "research_segmented_optic_cup_area",
    level: "observation",
    label: "Segmented optic cup area (research)",
    modalities: FUNDUS,
    associations: ["optic nerve head morphology (association, not diagnosis) - requires cup-to-disc ratio context and clinical examination"],
    high_risk: false,
  },
];

// ---------------------------------------------------------------------------
// OCT findings (schema prepared; detection NOT implemented)
// ---------------------------------------------------------------------------

const OCT = ["OCT", "OCTA"];

export const OCT_FINDINGS: FindingDefinition[] = [
  { type: "retinal_thickening", level: "observation", label: "Retinal thickening", modalities: OCT, measurement_schema: [{ key: "central_subfield_thickness", unit: "µm", description: "Central subfield retinal thickness" }], associations: ["macular edema pattern (association, not diagnosis)"], high_risk: false },
  { type: "retinal_thinning", level: "observation", label: "Retinal thinning", modalities: OCT, measurement_schema: [{ key: "central_subfield_thickness", unit: "µm", description: "Central subfield retinal thickness" }], associations: ["atrophy pattern (association, not diagnosis)"], high_risk: false },
  { type: "intraretinal_fluid", level: "observation", label: "Intraretinal fluid", modalities: OCT, associations: ["exudative change (association, not diagnosis)"], high_risk: false },
  { type: "subretinal_fluid", level: "observation", label: "Subretinal fluid", modalities: OCT, associations: ["serous change (association, not diagnosis)"], high_risk: false },
  { type: "cystic_spaces", level: "observation", label: "Cystic spaces", modalities: OCT, associations: ["cystoid change (association, not diagnosis)"], high_risk: false },
  { type: "retinal_layer_abnormality", level: "observation", label: "Retinal layer abnormality", modalities: OCT, associations: ["layer disruption (association, not diagnosis)"], high_risk: false },
  { type: "drusen_like_deposit", level: "observation", label: "Drusen-like deposit", modalities: OCT, associations: ["age-related change pattern (association, not diagnosis)"], high_risk: false },
  { type: "pigment_epithelial_abnormality", level: "observation", label: "Pigment epithelial abnormality", modalities: OCT, associations: ["RPE change (association, not diagnosis)"], high_risk: false },
  { type: "vitreoretinal_interface_abnormality", level: "observation", label: "Vitreoretinal interface abnormality", modalities: OCT, associations: ["traction pattern (association, not diagnosis)"], high_risk: false },
  { type: "macular_hole_like_abnormality", level: "observation", label: "Macular hole-like abnormality", modalities: OCT, associations: ["full-thickness defect pattern (association, not diagnosis)"], high_risk: true },
  { type: "detachment_like_abnormality", level: "observation", label: "Detachment-like abnormality", modalities: OCT, associations: ["elevated retina pattern (association, not diagnosis)"], high_risk: true },
];

export const FINDING_TAXONOMY: Record<string, FindingDefinition> = Object.fromEntries(
  [...RETINAL_FINDINGS, ...OCT_FINDINGS].map((f) => [f.type, f])
);

export const BLOCKED_TERMS = ["blood clot", "clot"]; // ambiguous vocabulary is forbidden

export function findingDefinition(type: string): FindingDefinition | null {
  return FINDING_TAXONOMY[type] ?? null;
}

/** Can this finding type be emitted for this modality by a model with this status? */
export function mayEmitFinding(type: string, modality: string, modelStatus: string): { ok: boolean; reason?: string } {
  const def = FINDING_TAXONOMY[type];
  if (!def) return { ok: false, reason: `Finding type "${type}" is not in the controlled taxonomy.` };
  const m = modality.toUpperCase();
  if (!def.modalities.includes(m)) {
    return { ok: false, reason: `Finding "${type}" is not supported by modality ${m}.` };
  }
  if (def.level === "diagnosis" && modelStatus !== "CLINICALLY_VALIDATED") {
    return { ok: false, reason: "Diagnosis-level findings require CLINICALLY_VALIDATED status." };
  }
  return { ok: true };
}

/** Possible-association wording helper - association language, never diagnostic. */
export function associationText(type: string): string | null {
  const def = FINDING_TAXONOMY[type];
  if (!def || def.associations.length === 0) return null;
  return `This finding can be associated with: ${def.associations.join("; ")}. Association is not diagnosis.`;
}
