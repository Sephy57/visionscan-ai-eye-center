/**
 * Structured patient symptom vocabulary + validation.
 *
 * HARD RULE: symptoms provide CONTEXT only. They never create imaging
 * findings and never produce diagnoses. See lib/clinical/correlation.ts.
 *
 * Symptoms are stored as structured records (never just a text blob):
 *   { type, onset, duration, severity, laterality, progression, frequency, free_text }
 */

export type SymptomCategory = "visual" | "retinal_vitreous" | "discomfort" | "other";

export interface SymptomTypeDef {
  type: string;
  label: string;
  category: SymptomCategory;
  /** Red-flag symptom: triggers safety escalation regardless of model output. */
  red_flag: boolean;
  /** Red-flag rank: emergency > urgent > none. */
  urgency: "emergency" | "urgent" | "none";
  /** Finding types (taxonomy) that could relate to this symptom - used ONLY
   *  for correlation wording, never to invent findings. */
  related_finding_types: string[];
}

export const SYMPTOM_VOCABULARY: SymptomTypeDef[] = [
  // ---- Visual symptoms ----
  { type: "blurred_vision", label: "Blurred vision", category: "visual", red_flag: false, urgency: "none", related_finding_types: ["retinal_thickening", "intraretinal_fluid", "drusen_like_deposit", "macular_hole_like_abnormality", "vitreoretinal_interface_abnormality", "cystic_spaces"] },
  { type: "sudden_vision_loss", label: "Sudden vision loss", category: "visual", red_flag: true, urgency: "emergency", related_finding_types: ["retinal_hemorrhage", "possible_vascular_occlusion_related_finding", "ischemic_appearing_region", "detachment_like_abnormality"] },
  { type: "gradual_vision_loss", label: "Gradual vision loss", category: "visual", red_flag: false, urgency: "none", related_finding_types: ["drusen_like_deposit", "retinal_thinning", "pigment_epithelial_abnormality"] },
  { type: "reduced_central_vision", label: "Reduced central vision", category: "visual", red_flag: false, urgency: "none", related_finding_types: ["retinal_thickening", "intraretinal_fluid", "drusen_like_deposit", "macular_hole_like_abnormality"] },
  { type: "reduced_peripheral_vision", label: "Reduced peripheral vision", category: "visual", red_flag: false, urgency: "none", related_finding_types: ["detachment_like_abnormality", "ischemic_appearing_region"] },
  { type: "distorted_vision", label: "Distorted vision", category: "visual", red_flag: false, urgency: "none", related_finding_types: ["vitreoretinal_interface_abnormality", "macular_hole_like_abnormality", "retinal_thickening"] },
  { type: "double_vision", label: "Double vision", category: "visual", red_flag: false, urgency: "none", related_finding_types: [] },
  { type: "night_vision_difficulty", label: "Difficulty seeing at night", category: "visual", red_flag: false, urgency: "none", related_finding_types: ["drusen_like_deposit", "pigment_epithelial_abnormality"] },
  { type: "reduced_contrast", label: "Reduced contrast sensitivity", category: "visual", red_flag: false, urgency: "none", related_finding_types: ["drusen_like_deposit", "cystic_spaces"] },
  { type: "transient_vision_changes", label: "Transient vision changes", category: "visual", red_flag: false, urgency: "none", related_finding_types: [] },

  // ---- Retinal / vitreous-related ----
  { type: "floaters", label: "Floaters", category: "retinal_vitreous", red_flag: false, urgency: "none", related_finding_types: ["retinal_hemorrhage", "vitreoretinal_interface_abnormality"] },
  { type: "new_floaters", label: "New floaters", category: "retinal_vitreous", red_flag: true, urgency: "urgent", related_finding_types: ["retinal_hemorrhage", "vitreoretinal_interface_abnormality"] },
  { type: "flashes", label: "Flashes of light", category: "retinal_vitreous", red_flag: false, urgency: "none", related_finding_types: ["vitreoretinal_interface_abnormality"] },
  { type: "flashes_with_field_loss", label: "Flashes with visual field loss", category: "retinal_vitreous", red_flag: true, urgency: "urgent", related_finding_types: ["detachment_like_abnormality"] },
  { type: "curtain_shadow", label: "Curtain / shadow over vision", category: "retinal_vitreous", red_flag: true, urgency: "emergency", related_finding_types: ["detachment_like_abnormality"] },
  { type: "spots_in_vision", label: "Spots in vision", category: "retinal_vitreous", red_flag: false, urgency: "none", related_finding_types: ["retinal_hemorrhage", "indeterminate_focal_hyperreflective_region"] },
  { type: "wavy_lines", label: "Wavy lines", category: "retinal_vitreous", red_flag: false, urgency: "none", related_finding_types: ["vitreoretinal_interface_abnormality", "retinal_thickening"] },
  { type: "missing_vision_areas", label: "Missing areas of vision", category: "retinal_vitreous", red_flag: false, urgency: "none", related_finding_types: ["ischemic_appearing_region", "detachment_like_abnormality"] },

  // ---- Eye discomfort ----
  { type: "eye_pain", label: "Eye pain", category: "discomfort", red_flag: false, urgency: "none", related_finding_types: [] },
  { type: "severe_eye_pain_with_visual_disturbance", label: "Severe eye pain with visual disturbance", category: "discomfort", red_flag: true, urgency: "emergency", related_finding_types: [] },
  { type: "redness", label: "Redness", category: "discomfort", red_flag: false, urgency: "none", related_finding_types: [] },
  { type: "burning", label: "Burning", category: "discomfort", red_flag: false, urgency: "none", related_finding_types: [] },
  { type: "itching", label: "Itching", category: "discomfort", red_flag: false, urgency: "none", related_finding_types: [] },
  { type: "light_sensitivity", label: "Light sensitivity", category: "discomfort", red_flag: false, urgency: "none", related_finding_types: [] },
  { type: "foreign_body_sensation", label: "Foreign-body sensation", category: "discomfort", red_flag: false, urgency: "none", related_finding_types: [] },
  { type: "pressure_sensation", label: "Pressure sensation", category: "discomfort", red_flag: false, urgency: "none", related_finding_types: [] },

  // ---- Other / context ----
  { type: "headache_with_visual_symptoms", label: "Headache associated with visual symptoms", category: "other", red_flag: false, urgency: "none", related_finding_types: [] },
  { type: "recent_eye_trauma", label: "Recent eye trauma", category: "other", red_flag: true, urgency: "urgent", related_finding_types: ["retinal_hemorrhage"] },
  { type: "trauma_with_vision_loss", label: "Recent eye trauma with vision loss", category: "other", red_flag: true, urgency: "emergency", related_finding_types: ["retinal_hemorrhage", "detachment_like_abnormality"] },
  { type: "recent_eye_procedure", label: "Recent eye procedure / surgery", category: "other", red_flag: false, urgency: "none", related_finding_types: [] },
];

export const SYMPTOM_MAP: Record<string, SymptomTypeDef> = Object.fromEntries(
  SYMPTOM_VOCABULARY.map((s) => [s.type, s])
);

// ---------------------------------------------------------------------------
// Structured symptom instance
// ---------------------------------------------------------------------------

export type Onset = "sudden" | "gradual" | "unknown";
export type DurationBand =
  | "less_than_1_hour" | "hours" | "1_day" | "days" | "1_week" | "weeks"
  | "1_month" | "months" | "chronic" | "unknown";
export type Severity = "mild" | "moderate" | "severe";
export type Laterality = "right" | "left" | "both" | "unknown";
export type Progression = "stable" | "worsening" | "improving" | "unknown";
export type Frequency = "constant" | "intermittent" | "unknown";

export interface PatientSymptom {
  type: string;
  onset: Onset;
  duration: DurationBand;
  severity: Severity;
  laterality: Laterality;
  progression: Progression;
  frequency: Frequency;
  free_text?: string | null;
}

export interface SymptomValidationError {
  index: number;
  field: string;
  message: string;
}

const ONSETS: Onset[] = ["sudden", "gradual", "unknown"];
const DURATIONS: DurationBand[] = ["less_than_1_hour", "hours", "1_day", "days", "1_week", "weeks", "1_month", "months", "chronic", "unknown"];
const SEVERITIES: Severity[] = ["mild", "moderate", "severe"];
const LATERALITIES: Laterality[] = ["right", "left", "both", "unknown"];
const PROGRESSIONS: Progression[] = ["stable", "worsening", "improving", "unknown"];
const FREQUENCIES: Frequency[] = ["constant", "intermittent", "unknown"];

/** Strict validation: unknown symptom types are rejected, not coerced. */
export function validateSymptoms(input: unknown): { valid: boolean; errors: SymptomValidationError[]; symptoms: PatientSymptom[] } {
  const errors: SymptomValidationError[] = [];
  const symptoms: PatientSymptom[] = [];
  if (!Array.isArray(input)) {
    return { valid: false, errors: [{ index: -1, field: "$", message: "Symptoms must be an array" }], symptoms: [] };
  }
  input.forEach((raw, i) => {
    const s = raw as Partial<PatientSymptom> | null;
    if (!s || typeof s !== "object") {
      errors.push({ index: i, field: "$", message: "Symptom must be an object" });
      return;
    }
    if (typeof s.type !== "string" || !SYMPTOM_MAP[s.type]) {
      errors.push({ index: i, field: "type", message: `Unknown symptom type: ${String(s.type)}` });
      return;
    }
    const onset = (ONSETS as string[]).includes(s.onset ?? "") ? (s.onset as Onset) : null;
    if (!onset) { errors.push({ index: i, field: "onset", message: `onset must be one of ${ONSETS.join("|")}` }); return; }
    const duration = (DURATIONS as string[]).includes(s.duration ?? "") ? (s.duration as DurationBand) : null;
    if (!duration) { errors.push({ index: i, field: "duration", message: `duration must be one of ${DURATIONS.join("|")}` }); return; }
    const severity = (SEVERITIES as string[]).includes(s.severity ?? "") ? (s.severity as Severity) : null;
    if (!severity) { errors.push({ index: i, field: "severity", message: `severity must be one of ${SEVERITIES.join("|")}` }); return; }
    const laterality = (LATERALITIES as string[]).includes(s.laterality ?? "") ? (s.laterality as Laterality) : null;
    if (!laterality) { errors.push({ index: i, field: "laterality", message: `laterality must be one of ${LATERALITIES.join("|")}` }); return; }
    const progression = (PROGRESSIONS as string[]).includes(s.progression ?? "") ? (s.progression as Progression) : null;
    if (!progression) { errors.push({ index: i, field: "progression", message: `progression must be one of ${PROGRESSIONS.join("|")}` }); return; }
    const frequency = (FREQUENCIES as string[]).includes(s.frequency ?? "") ? (s.frequency as Frequency) : null;
    if (!frequency) { errors.push({ index: i, field: "frequency", message: `frequency must be one of ${FREQUENCIES.join("|")}` }); return; }
    if (s.free_text !== undefined && s.free_text !== null && typeof s.free_text !== "string") {
      errors.push({ index: i, field: "free_text", message: "free_text must be a string" });
      return;
    }
    symptoms.push({
      type: s.type, onset, duration, severity, laterality, progression, frequency,
      free_text: s.free_text ? s.free_text.slice(0, 1000) : null,
    });
  });
  return { valid: errors.length === 0, errors, symptoms };
}

export function redFlagSymptoms(symptoms: PatientSymptom[]): SymptomTypeDef[] {
  return symptoms.map((s) => SYMPTOM_MAP[s.type]).filter((d) => d && d.red_flag);
}

export function maxSymptomUrgency(symptoms: PatientSymptom[]): "emergency" | "urgent" | "none" {
  let worst: "emergency" | "urgent" | "none" = "none";
  const rank = { none: 0, urgent: 1, emergency: 2 } as const;
  for (const d of redFlagSymptoms(symptoms)) {
    if (rank[d.urgency] > rank[worst]) worst = d.urgency;
  }
  return worst;
}

/** Late the demo/synthetic isolation: a fully synthetic symptom record generator (test/demo only). */
export function syntheticDemoSymptom(): PatientSymptom & { synthetic: true } {
  return {
    type: "blurred_vision", onset: "gradual", duration: "weeks", severity: "mild",
    laterality: "unknown", progression: "stable", frequency: "unknown", free_text: null, synthetic: true,
  };
}
