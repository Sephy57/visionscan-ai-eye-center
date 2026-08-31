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
  measurements?: Record<string, number | string>; // only real measurements allowed
  region?: { x: number; y: number; w: number; h: number } | null; // normalized bbox
  explanation: string;                 // careful, non-overstating language
  synthetic: boolean;                  // MUST be true for any demo-generated finding
  model_id: string;                    // component that produced this finding
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

  return { valid: errors.length === 0, errors };
}

export const SCHEMA_VERSION = "1.0.0";
export const PIPELINE_VERSION = "0.4.0";
