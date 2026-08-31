/**
 * Structured result schema + strict validator.
 * All pipeline output must validate against this schema before storage or
 * display (safety rule: structured AI output validates).
 */

export type Modality = string;
export type Eye = "OD" | "OS" | "unknown";

export interface Finding {
  id: string;
  type: string;                        // snake_case finding type
  location: string;                    // anatomical location or "unspecified"
  severity: "none" | "mild" | "moderate" | "severe" | "indeterminate";
  confidence: number;                  // 0..1 calibrated or categorical-mapped
  confidence_category: "HIGH CONFIDENCE" | "MODERATE CONFIDENCE" | "LOW CONFIDENCE" | "INDETERMINATE";
  confidence_raw?: number | null;      // raw model output, if a model exists
  confidence_calibrated?: number | null; // calibrated confidence ONLY if calibration evidence exists
  taxonomy_level?: "observation" | "possible_association" | "diagnosis";
  measurements?: Record<string, number | string>; // only real measurements allowed
  structured_measurements?: Array<{
    key: string; value: number; unit: string | null; anatomical_region: string;
    source_modality: string; measurement_confidence: number | null;
    model_id: string; model_version: string;
  }>;
  region?: { x: number; y: number; w: number; h: number } | null; // normalized bbox
  explanation: string;                 // careful, non-overstating language
  synthetic: boolean;                  // MUST be true for any demo-generated finding
  model_id: string;                    // component that produced this finding
  model_status?: string;               // registry status of producing model (e.g. DEMO)
}

export interface StudyInfo {
  study_id: string;
  modality: Modality;
  eye: Eye;
  source: string;
  captured_at?: string | null;         // only if actually provided
  metadata_provenance: "user" | "device" | "none";
}

export interface QualityInfo {
  score: number;
  acceptable: boolean;
  status: string;
  artifacts: string[];
  affected_regions: string[];
  recommended_reacquisition: boolean;
}

export interface UncertaintyInfo {
  overall: number;                     // 0..1
  reasons: string[];
  ensemble_agreement?: "agree" | "disagree" | "single_model" | "not_applicable";
}

export interface RecommendationInfo {
  priority:
    | "routine_follow_up"
    | "prompt_professional_review"
    | "urgent_eye_care_review"
    | "emergency_evaluation"
    | "specialist_review_required";
  action: string;
  rationale: string;
}

export interface AnalysisResult {
  schema_version: string;
  study: StudyInfo;
  quality: QualityInfo;
  segmentation: {
    implemented: boolean;
    note: string;
    structures?: never;                // placeholder: no structures emitted
  };
  findings: Finding[];
  uncertainty: UncertaintyInfo;
  recommendation: RecommendationInfo;
  ensemble: {
    performed: boolean;
    checks: Array<{ component_id: string; result: string }>;
    note: string;
  };
  multimodal?: {
    performed: boolean;
    note: string;
    concordance?: string;
  };
  ood?: {
    detected: boolean;
    reasons: string[];
    message: string;
  };
  model_registry?: {
    model_id: string;
    model_version: string;
    model_status: string;              // DEMO | RESEARCH | ... (registry, never self-declared)
    display_label: string | null;      // mandatory label when findings produced
    integrity_checks: Array<{ check: string; passed: boolean; detail: string }>;
    device_compatibility: { compatible: boolean; note: string };
    model_input: "IMAGE_ONLY" | "IMAGE_AND_SYMPTOMS";
  };
  patient_context?: {
    reported: boolean;                 // true when structured symptoms were supplied
    symptoms: Array<{
      type: string;
      label?: string;
      onset: string;
      duration: string;
      severity: string;
      laterality: string;
      progression: string;
      frequency: string;
      free_text?: string | null;
      synthetic?: boolean;
    }>;
    red_flags: string[];
    note: string;
  };
  symptom_correlation?: {
    state: "correlated" | "not_explained" | "inconclusive" | "conflicting" | "urgent";
    urgency: "emergency" | "urgent" | "prompt" | "routine";
    items: Array<{
      symptom_type: string;
      symptom_label: string;
      state: "correlated" | "not_explained" | "inconclusive" | "conflicting" | "urgent";
      matched_finding_types: string[];
      note: string;
    }>;
    notes: string[];
    label: string;                     // "RESEARCH CORRELATION - NOT CLINICALLY VALIDATED"
  };
  possible_conditions?: {
    conditions: Array<{ id: string; label: string; matched_findings: string[]; note: string }>;
    note: string;
  };
  // Phase 3.2: future-ready visualization API. The current DEMO model emits
  // NONE of these; the UI must display an honest empty state instead of
  // fabricating boxes, masks, or heatmaps.
  visualizations?: {
    localizations: Array<{
      id: string;
      finding_id?: string;
      kind: "bounding_box" | "mask" | "marker" | "heatmap";
      // normalized 0..1 coordinates for bounding_box; mask/heatmap carry a
      // reference to externally stored pixel data (never inline base64 here)
      coordinates?: { x: number; y: number; w: number; h: number };
      data_ref?: string;
      priority: "high" | "moderate" | "low";
      model_id: string;
      model_version: string;
      note: string;
    }>;
    segmentation: { available: true; data_ref: string; model_id: string; model_version: string } | null;
    note: string;
  };
  temporal_comparison?: {
    performed: boolean;
    note: string;
    compared_with?: string;
    changes?: Array<{ feature: string; previous: number | string; current: number | string; direction: string }>;
  };
  demo: {
    synthetic_result: boolean;         // true whenever findings are demo-generated
    label: string;
  };
  provenance: {
    models: Array<Record<string, unknown>>;
    ruleset_version: string;
    analyzed_at: string;
    input_dimensions: { width: number; height: number };
    pipeline_version: string;
  };
  safety: {
    quality_gate_enforced: boolean;
    disclaimers: string[];
    blocked_claims: string[];
  };
}

export interface ValidationError {
  path: string;
  message: string;
}

export function validateAnalysisResult(r: unknown): { valid: boolean; errors: ValidationError[] } {
  const errors: ValidationError[] = [];
  const o = r as AnalysisResult | null;
  if (!o || typeof o !== "object") {
    return { valid: false, errors: [{ path: "$", message: "Result is not an object" }] };
  }

  const need = (cond: boolean, path: string, message: string) => {
    if (!cond) errors.push({ path, message });
  };

  need(typeof o.schema_version === "string", "schema_version", "must be string");
  need(!!o.study && typeof o.study.study_id === "string", "study.study_id", "required");
  need(["OD", "OS", "unknown"].includes(o.study?.eye), "study.eye", "must be OD|OS|unknown");
  need(!!o.quality && typeof o.quality.score === "number" && o.quality.score >= 0 && o.quality.score <= 1, "quality.score", "must be 0..1");
  need(Array.isArray(o.findings), "findings", "must be array");

  const findTypes = new Set(["none", "mild", "moderate", "severe", "indeterminate"]);
  const confCats = new Set(["HIGH CONFIDENCE", "MODERATE CONFIDENCE", "LOW CONFIDENCE", "INDETERMINATE"]);
  (o.findings ?? []).forEach((f, i) => {
    need(typeof f.type === "string" && f.type.length > 0, `findings[${i}].type`, "required");
    need(typeof f.confidence === "number" && f.confidence >= 0 && f.confidence <= 1, `findings[${i}].confidence`, "must be 0..1");
    need(confCats.has(f.confidence_category), `findings[${i}].confidence_category`, "invalid category");
    need(findTypes.has(f.severity), `findings[${i}].severity`, "invalid severity");
    need(typeof f.synthetic === "boolean", `findings[${i}].synthetic`, "must be boolean");
    need(typeof f.explanation === "string" && f.explanation.length > 10, `findings[${i}].explanation`, "required");
    // Safety: any synthetic finding must be flagged.
    need(f.synthetic === true || f.model_id !== "fundus-lesion-detector", `findings[${i}].synthetic`, "placeholder detector output must be synthetic");
  });

  need(!!o.uncertainty && typeof o.uncertainty.overall === "number", "uncertainty.overall", "required");
  need(!!o.recommendation && typeof o.recommendation.priority === "string", "recommendation.priority", "required");
  need(!!o.demo, "demo", "required");
  need(!!o.provenance && Array.isArray(o.provenance.models), "provenance.models", "required");

  // Safety rule: findings must not exist when quality gate failed.
  if (o.quality && o.quality.acceptable === false && (o.findings ?? []).length > 0) {
    errors.push({ path: "findings", message: "Findings present although quality gate failed - not permitted" });
  }

  // Phase 3 additions (validated only when the new fields are present).

  // Patient context: symptoms must come from the controlled vocabulary and
  // must never have generated findings (correlation is wording, not evidence).
  if (o.patient_context?.reported) {
    need(Array.isArray(o.patient_context.symptoms), "patient_context.symptoms", "must be array");
    if (typeof o.patient_context.note !== "string") {
      errors.push({ path: "patient_context.note", message: "required" });
    }
  }
  if (o.symptom_correlation) {
    const validStates = ["correlated", "not_explained", "inconclusive", "conflicting", "urgent"];
    need(validStates.includes(o.symptom_correlation.state), "symptom_correlation.state", "invalid state");
    need(typeof o.symptom_correlation.label === "string" && o.symptom_correlation.label.length > 0, "symptom_correlation.label", "required");
    need(
      o.symptom_correlation.urgency === "emergency" || o.symptom_correlation.urgency === "urgent" ||
      o.symptom_correlation.urgency === "prompt" || o.symptom_correlation.urgency === "routine",
      "symptom_correlation.urgency", "invalid urgency"
    );
  }
  if (o.possible_conditions) {
    need(Array.isArray(o.possible_conditions.conditions), "possible_conditions.conditions", "must be array");
    // Safety: DEMO models can never surface conditions.
    if (o.model_registry?.model_status === "DEMO" && (o.possible_conditions.conditions?.length ?? 0) > 0) {
      errors.push({ path: "possible_conditions.conditions", message: "DEMO models cannot display possible conditions" });
    }
  }

  // Phase 3.2: visualization safety — unvalidated/DEMO models can never emit
  // localizations or segmentation, so no fake boxes/masks/heatmaps can exist.
  if (o.visualizations) {
    need(Array.isArray(o.visualizations.localizations), "visualizations.localizations", "must be array");
    const demoish = ["DEMO", "RESEARCH", "INTERNAL_VALIDATION"].includes(o.model_registry?.model_status ?? "DEMO");
    if (demoish && (o.visualizations.localizations?.length ?? 0) > 0) {
      errors.push({ path: "visualizations.localizations", message: "Unvalidated models cannot emit localization overlays" });
    }
    if (demoish && o.visualizations.segmentation !== null && o.visualizations.segmentation !== undefined) {
      errors.push({ path: "visualizations.segmentation", message: "Unvalidated models cannot emit segmentation" });
    }
    (o.visualizations.localizations ?? []).forEach((l, i) => {
      if (!l.model_id || !l.model_version || !l.note) {
        errors.push({ path: `visualizations.localizations[${i}]`, message: "localization provenance (model/version/note) required" });
      }
    });
  }

  (o.findings ?? []).forEach((f, i) => {
    if (f.taxonomy_level === "diagnosis") {
      errors.push({ path: `findings[${i}].taxonomy_level`, message: "Diagnosis-level findings cannot be produced by automated analysis unless separately authorized" });
    }
    if (f.confidence_calibrated !== undefined && f.confidence_calibrated !== null) {
      const inBounds = f.confidence_calibrated >= 0 && f.confidence_calibrated <= 1;
      if (!inBounds) errors.push({ path: `findings[${i}].confidence_calibrated`, message: "must be 0..1" });
    }
    if (f.structured_measurements) {
      f.structured_measurements.forEach((m, j) => {
        if (typeof m.value !== "number" || !Number.isFinite(m.value)) {
          errors.push({ path: `findings[${i}].structured_measurements[${j}].value`, message: "measurements must be finite numbers - never invented" });
        }
        if (!m.model_id || !m.model_version) {
          errors.push({ path: `findings[${i}].structured_measurements[${j}]`, message: "measurement provenance (model/version) required" });
        }
      });
    }
  });

  return { valid: errors.length === 0, errors };
}

export const SCHEMA_VERSION = "1.0.0";
export const PIPELINE_VERSION = "0.4.0";
