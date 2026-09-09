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
  model_version?: string;              // exact producing model version when available
  model_status?: string;               // registry status of producing model (e.g. DEMO)
  source_modality?: string;
  source_asset_id?: string;
  source_page?: number;
  laterality?: "OD" | "OS" | "OU" | "unknown";
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

/**
 * Server-derived provenance for one model/input attempt.  The compact
 * model_execution arrays below remain for backwards compatibility, while
 * this row-oriented ledger is the authoritative coverage view for current
 * analyses.  A row is emitted for every applicable primary asset and every
 * admitted document ROI; it is never accepted from the browser.
 */
export type ModelExecutionStatus =
  | "EXECUTED"
  | "SKIPPED"
  | "UNAVAILABLE"
  | "FAILED"
  | "BLOCKED_QUALITY"
  | "BLOCKED_OOD"
  | "UNSUPPORTED_MODALITY";

export interface ModelExecutionLedgerEntry {
  model_id: string;
  model_version: string;
  task: string;
  artifact_hash: string | null;
  input_asset_id: string;
  input_roi_id: string | null;
  laterality: "OD" | "OS" | "OU" | "unknown";
  eligibility: "ELIGIBLE" | "INELIGIBLE" | "NOT_APPLICABLE";
  execution_status: ModelExecutionStatus;
  skip_reason: string | null;
  quality_status: string;
  domain_status: string;
  runtime_ms: number;
  output_contract_version: string | null;
  validation_status: string;
  /** Models sharing this group consumed the same underlying pixels. */
  dependency_group_id: string;
}

export interface AnalysisResult {
  schema_version: string;
  study: StudyInfo;
  /** Actual execution state, derived from providers rather than UI defaults. */
  analysis_mode?: "DEMO_ONLY" | "RESEARCH_MODEL_ANALYSIS" | "MIXED_RESEARCH_AND_DEMO" | "NO_MODEL_EXECUTED" | "MODEL_FAILED";
  asset_routing?: import("../assets/assetRouter").AssetRoutingResult;
  document_routing?: import("../documents/extraction/pdfIntelligence").PdfAssetRouting[];
  model_execution?: {
    models_attempted: string[];
    models_executed: string[];
    models_failed: string[];
    models_skipped: Array<{ model_id: string; reason: string }>;
    artifact_hashes: Record<string, string | null>;
    artifact_verification?: Record<string, "EXPECTED_REGISTRY_HASH" | "VERIFIED" | "FAILED" | "UNAVAILABLE">;
    model_versions: Record<string, string>;
    runtime_status: string;
  };
  /** Complete, server-derived model/input ledger for current analyses. */
  model_execution_ledger?: ModelExecutionLedgerEntry[];
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
  /** Dedicated, pre-diagnosis fundus safety layer. It is never a global-normal claim. */
  fundus_abnormality?: import("../models/fundusAbnormality").FundusAbnormalityResult;
  /** Dedicated DR grade-estimate layer. A low grade never excludes disease. */
  dr_assessment?: import("../models/drAssessment").DrAssessmentResult;
  /** Dedicated OCT class-estimate layer. A NORMAL estimate never means a healthy macula. */
  oct_assessment?: import("../models/octAssessment").OctAssessmentResult;
  oct_region_results?: Array<{
    asset_id: string; document_id: string; page: number; laterality: "OD" | "OS" | "unknown";
    source_page_hash: string; roi_hash: string; content_type: "OCT_BSCAN";
    status: "EXECUTED" | "FAILED" | "SKIPPED"; assessment?: import("../models/octAssessment").OctAssessmentResult; note?: string;
  }>;
  oct_aggregation?: "CONSISTENT_TARGET_CLASS" | "MIXED_OCT_CLASS_RESULTS" | "INSUFFICIENT_SCAN_QUALITY" | "NOT_COMPARABLE";
  /** Cross-model research agreement. Scores are never averaged; disagreement has no automatic winner. */
  multi_model?: {
    performed: boolean;
    agreement: "CORROBORATED_RESEARCH_EVIDENCE" | "MODEL_DISAGREEMENT" | "CONSISTENT_RESEARCH_NEGATIVE" | "SINGLE_RESEARCH_MODEL" | "NO_RESEARCH_MODEL_OUTPUT";
    models: Array<{ model_id: string; model_version: string; model_status: string; output_summary: string }>;
    notes: string[];
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
    conditions: Array<{ id: string; label: string; matched_findings: string[]; commonly_associated_symptoms: string[]; note: string }>;
    note: string;
  };
  // Phase 5: treatment information is generated ONLY for conditions that
  // already passed possible_conditions gating (finding -> condition ->
  // treatment provenance chain). Never a prescription; always clinician-review-gated.
  treatment_information?: {
    items: Array<{
      condition_id: string;
      condition_label: string;
      available: boolean;
      reason: string;
      approaches: Array<{
        approach_label: string;
        purpose: string;
        medications: Array<{
          medication_id: string; generic_name: string; drug_class: string; purpose: string;
          route: string[]; common_contraindications: string[]; warnings: string[];
          common_adverse_effects: string[]; evidence_references: string[];
        }>;
        evidence_reference: string;
      }>;
      label: string;
    }>;
    dosage_notice: string;
    interaction_notice: string;
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
  // S12: server-side, fail-closed decision of whether this result may ever
  // use diagnostic ("this is X condition") language vs. correlation-required
  // language. Computed via lib/models/diagnosisGate.ts's canDisplayDiagnosis
  // - never constructed ad hoc by a UI layer. Optional only for backward
  // compatibility with any pre-S12 stored result; a missing value must be
  // treated as closed (REQUIRES_CLINICAL_CORRELATION), never as open.
  diagnosis_gate?: {
    allowed: boolean;
    reasons: string[];
    clinical_interpretation: "DIAGNOSIS" | "REQUIRES_CLINICAL_CORRELATION";
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
  if (o.analysis_mode !== undefined) {
    need(["DEMO_ONLY", "RESEARCH_MODEL_ANALYSIS", "MIXED_RESEARCH_AND_DEMO", "NO_MODEL_EXECUTED", "MODEL_FAILED"].includes(o.analysis_mode), "analysis_mode", "invalid execution mode");
  }
  if (o.model_execution !== undefined) {
    need(Array.isArray(o.model_execution.models_attempted), "model_execution.models_attempted", "must be array");
    need(Array.isArray(o.model_execution.models_executed), "model_execution.models_executed", "must be array");
    need(Array.isArray(o.model_execution.models_failed), "model_execution.models_failed", "must be array");
    need(Array.isArray(o.model_execution.models_skipped), "model_execution.models_skipped", "must be array");
    need(typeof o.model_execution.runtime_status === "string", "model_execution.runtime_status", "required");
  }
  if (o.model_execution_ledger !== undefined) {
    need(Array.isArray(o.model_execution_ledger), "model_execution_ledger", "must be array");
    const statuses = new Set<ModelExecutionStatus>([
      "EXECUTED", "SKIPPED", "UNAVAILABLE", "FAILED", "BLOCKED_QUALITY", "BLOCKED_OOD", "UNSUPPORTED_MODALITY",
    ]);
    const eligibilities = new Set(["ELIGIBLE", "INELIGIBLE", "NOT_APPLICABLE"]);
    const eyes = new Set(["OD", "OS", "OU", "unknown"]);
    for (const [i, row] of (o.model_execution_ledger ?? []).entries()) {
      need(!!row && typeof row === "object", `model_execution_ledger[${i}]`, "must be object");
      if (!row || typeof row !== "object") continue;
      need(typeof row.model_id === "string" && row.model_id.length > 0, `model_execution_ledger[${i}].model_id`, "required");
      need(typeof row.model_version === "string" && row.model_version.length > 0, `model_execution_ledger[${i}].model_version`, "required");
      need(typeof row.task === "string" && row.task.length > 0, `model_execution_ledger[${i}].task`, "required");
      need(row.artifact_hash === null || typeof row.artifact_hash === "string", `model_execution_ledger[${i}].artifact_hash`, "must be string or null");
      need(typeof row.input_asset_id === "string" && row.input_asset_id.length > 0, `model_execution_ledger[${i}].input_asset_id`, "required");
      need(row.input_roi_id === null || typeof row.input_roi_id === "string", `model_execution_ledger[${i}].input_roi_id`, "must be string or null");
      need(eyes.has(row.laterality), `model_execution_ledger[${i}].laterality`, "invalid laterality");
      need(eligibilities.has(row.eligibility), `model_execution_ledger[${i}].eligibility`, "invalid eligibility");
      need(statuses.has(row.execution_status), `model_execution_ledger[${i}].execution_status`, "invalid execution status");
      need(row.skip_reason === null || typeof row.skip_reason === "string", `model_execution_ledger[${i}].skip_reason`, "must be string or null");
      need(typeof row.quality_status === "string", `model_execution_ledger[${i}].quality_status`, "required");
      need(typeof row.domain_status === "string", `model_execution_ledger[${i}].domain_status`, "required");
      need(typeof row.runtime_ms === "number" && Number.isFinite(row.runtime_ms) && row.runtime_ms >= 0, `model_execution_ledger[${i}].runtime_ms`, "must be a finite non-negative number");
      need(row.output_contract_version === null || typeof row.output_contract_version === "string", `model_execution_ledger[${i}].output_contract_version`, "must be string or null");
      need(typeof row.validation_status === "string", `model_execution_ledger[${i}].validation_status`, "required");
      need(typeof row.dependency_group_id === "string" && row.dependency_group_id.length > 0, `model_execution_ledger[${i}].dependency_group_id`, "required");
    }
  }

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

  // Phase 5: treatment information may only exist for conditions that already
  // passed possible_conditions gating (the finding -> condition -> treatment
  // provenance chain). If any link is missing, STOP - never display treatment
  // information for an ungated condition.
  if (o.treatment_information) {
    const gatedIds = new Set((o.possible_conditions?.conditions ?? []).map((c) => c.id));
    (o.treatment_information.items ?? []).forEach((item, i) => {
      if (!gatedIds.has(item.condition_id)) {
        errors.push({
          path: `treatment_information.items[${i}]`,
          message: "Treatment information exists for a condition that did not pass possible_conditions gating - provenance chain broken",
        });
      }
      if (!item.label || !item.label.includes("clinician review required")) {
        errors.push({ path: `treatment_information.items[${i}].label`, message: "Treatment information must carry the mandatory clinician-review label" });
      }
    });
    if (o.model_registry?.model_status === "DEMO" && (o.treatment_information.items?.length ?? 0) > 0) {
      errors.push({ path: "treatment_information.items", message: "DEMO models can never surface treatment information" });
    }
    const dosagePattern = /\b\d+(\.\d+)?\s?(mg|mcg|g|ml|units?)\b.{0,20}\b(once|twice|three times|daily|per day|bid|tid|qid|q\d+h)\b/i;
    if (dosagePattern.test(JSON.stringify(o.treatment_information))) {
      errors.push({ path: "treatment_information", message: "Output resembles a patient-specific dosing instruction - never permitted" });
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

  if (o.fundus_abnormality) {
    const fa = o.fundus_abnormality;
    const validStates = ["NO_TARGET_ABNORMALITY_DETECTED", "SUSPICIOUS_ABNORMALITY", "MULTIPLE_ABNORMALITIES", "IMAGE_NOT_SUITABLE", "OUT_OF_DISTRIBUTION", "MODEL_UNAVAILABLE", "MODEL_NOT_VALIDATED_FOR_IMAGE"];
    need(validStates.includes(fa.state), "fundus_abnormality.state", "invalid state");
    need(Array.isArray(fa.regions), "fundus_abnormality.regions", "must be array");
    if (["MODEL_UNAVAILABLE", "IMAGE_NOT_SUITABLE", "OUT_OF_DISTRIBUTION", "MODEL_NOT_VALIDATED_FOR_IMAGE"].includes(fa.state) && fa.regions.length > 0) {
      errors.push({ path: "fundus_abnormality.regions", message: "unavailable/blocked abnormality state cannot carry regions" });
    }
    for (const [i, region] of fa.regions.entries()) {
      const c = region.localization?.coordinates;
      if (!c || ![c.x, c.y, c.w, c.h].every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1) || c.x + c.w > 1 || c.y + c.h > 1) {
        errors.push({ path: `fundus_abnormality.regions[${i}].localization`, message: "must contain finite, in-bounds normalized coordinates" });
      }
    }
  }

  if (o.dr_assessment) {
    const dr = o.dr_assessment;
    const validDrStates = ["GRADE_ESTIMATED", "IMAGE_NOT_SUITABLE", "OUT_OF_DISTRIBUTION", "MODEL_UNAVAILABLE"];
    need(validDrStates.includes(dr.state), "dr_assessment.state", "invalid state");
    if (dr.state === "GRADE_ESTIMATED") {
      need(Number.isInteger(dr.grade) && (dr.grade as number) >= 0 && (dr.grade as number) <= 4, "dr_assessment.grade", "must be an integer grade 0..4");
      need(typeof dr.grade_label === "string" && dr.grade_label.length > 0, "dr_assessment.grade_label", "required");
      need(typeof dr.referable_dr === "boolean", "dr_assessment.referable_dr", "must be a boolean");
      need(dr.model_score === null || (typeof dr.model_score === "number" && Number.isFinite(dr.model_score)), "dr_assessment.model_score", "must be null or finite (MODEL_SCORE, never a probability)");
      need(dr.calibration_state === "NOT_CALIBRATED", "dr_assessment.calibration_state", "DR grades may not claim calibration");
      need(dr.validation_state === "RESEARCH", "dr_assessment.validation_state", "estimated grades are RESEARCH only");
    } else if (dr.grade !== null || dr.grade_label !== null || dr.referable_dr !== null) {
      errors.push({ path: "dr_assessment", message: "unavailable/blocked DR state cannot carry a grade" });
    }
  }
  if (o.oct_assessment) {
    const oc = o.oct_assessment;
    const validOctStates = ["CLASS_ESTIMATED", "IMAGE_NOT_SUITABLE", "OUT_OF_DISTRIBUTION", "MODEL_UNAVAILABLE"];
    need(validOctStates.includes(oc.state), "oct_assessment.state", "invalid state");
    if (oc.state === "CLASS_ESTIMATED") {
      need(["CNV", "DME", "DRUSEN", "NORMAL"].includes(oc.predicted_class as string), "oct_assessment.predicted_class", "must be one of CNV/DME/DRUSEN/NORMAL");
      need(Number.isInteger(oc.predicted_index) && (oc.predicted_index as number) >= 0 && (oc.predicted_index as number) <= 3, "oct_assessment.predicted_index", "must be 0..3");
      need(oc.model_scores === null || (Array.isArray(oc.model_scores) && oc.model_scores.length === 4 && oc.model_scores.every((v) => typeof v === "number" && Number.isFinite(v))), "oct_assessment.model_scores", "must be null or 4 finite MODEL_SCOREs, never probabilities");
      need(oc.calibration_state === "NOT_CALIBRATED", "oct_assessment.calibration_state", "OCT classes may not claim calibration");
      need(oc.validation_state === "RESEARCH", "oct_assessment.validation_state", "estimated classes are RESEARCH only");
    } else if (oc.predicted_class !== null || oc.predicted_index !== null) {
      errors.push({ path: "oct_assessment", message: "unavailable/blocked OCT state cannot carry a class" });
    }
  }

  if (o.multi_model) {
    const mm = o.multi_model;
    const validAgreements = ["CORROBORATED_RESEARCH_EVIDENCE", "MODEL_DISAGREEMENT", "CONSISTENT_RESEARCH_NEGATIVE", "SINGLE_RESEARCH_MODEL", "NO_RESEARCH_MODEL_OUTPUT"];
    need(validAgreements.includes(mm.agreement), "multi_model.agreement", "invalid agreement state");
    need(Array.isArray(mm.models), "multi_model.models", "must be array");
    need(Array.isArray(mm.notes) && mm.notes.length > 0 && mm.notes.every((n) => typeof n === "string" && n.length > 0), "multi_model.notes", "at least one explicit agreement note is required");
    for (const [i, m] of (mm.models ?? []).entries()) {
      if (!m.model_id || !m.model_version || !m.output_summary) {
        errors.push({ path: `multi_model.models[${i}]`, message: "model provenance (id/version/output summary) required" });
      }
    }
    if (mm.agreement === "NO_RESEARCH_MODEL_OUTPUT" && (mm.models?.length ?? 0) > 0) {
      errors.push({ path: "multi_model.models", message: "no-output agreement cannot list models" });
    }
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
