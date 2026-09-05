import { newId, StoredFile, readOriginalScan } from "../storage/files";
import { assessQuality, QualityResult } from "../imaging/quality";
import { detectDicom } from "../imaging/dicom";
import { NormalizedStudy } from "../devices/adapter";
import { pickDemoScenario, buildDemoFindings } from "./findings";
import { runEnsemble, estimateUncertainty } from "./ensemble";
import { runTriage, TriageOutcome } from "../clinical/triage";
import { validateAnalysisResult, AnalysisResult, Finding, SCHEMA_VERSION, PIPELINE_VERSION } from "./schema";
import { modelProvenance, RULESET_VERSION, COMPONENTS, getModel, gateModelUse, deviceCompatible, supportsModality } from "../models/registry";
import { ensureRegistryHydrated } from "../models/registryPersistence";
import { assessOod, OOD_MESSAGE } from "./ood";
import { mayEmitFinding } from "./taxonomy";
import { canonicalModality } from "../models/modalities";
import { correlateSymptoms } from "../clinical/correlation";
import { possibleConditions } from "../clinical/conditions";
import { getTreatmentInformation } from "../treatment/treatmentInfo";
import { PatientSymptom, SYMPTOM_MAP, redFlagSymptoms } from "../clinical/symptoms";
import { DEMO_LABEL, VALIDATION_STATUS_BANNER } from "../config";
import { canDisplayDiagnosis, unvalidatedGateResult, DiagnosisGateInput } from "../models/diagnosisGate";

/**
 * S12 - maps this deployment's registry ModelStatus onto the diagnosis
 * gate's independent validation-status vocabulary. Any status this
 * function does not explicitly recognize (including undefined - no
 * registered model) fails closed to "NOT_VALIDATED", never to a more
 * permissive value.
 */
function mapModelValidationStatus(status: string | undefined): DiagnosisGateInput["modelValidation"] {
  switch (status) {
    case "CLINICALLY_VALIDATED": return "CLINICALLY_VALIDATED";
    case "EXTERNALLY_VALIDATED": return "EXTERNALLY_VALIDATED";
    case "INTERNAL_VALIDATION": return "INTERNALLY_VALIDATED";
    case "RESEARCH": return "RESEARCH_ONLY";
    default: return "NOT_VALIDATED"; // DEMO, unknown/unregistered - fail closed
  }
}

/**
 * AI Analysis Pipeline orchestrator.
 *
 * IMAGE INGESTION -> QUALITY GATE -> ANATOMICAL SEGMENTATION (placeholder)
 *   -> SPECIALIZED DETECTORS (demo/synthetic) -> ENSEMBLE/CONSISTENCY
 *   -> UNCERTAINTY -> CLINICAL RULE ENGINE -> SAFETY VALIDATOR -> RESULT
 *
 * A language model may explain structured results elsewhere, but nothing in
 * this pipeline invents findings, confidence, or measurements.
 */

export interface PipelineInput {
  study: NormalizedStudy;
  originalBytes: Buffer;
  symptoms?: PatientSymptom[];   // structured patient-reported symptoms (context ONLY)
}

export interface PipelineOutput {
  analysis: AnalysisResult;
  quality: QualityResult;
  triage: TriageOutcome;
  validationErrors: string[];
}

// Exported (Phase 4, §26) so other presentation-facing text generators -
// e.g. lib/models/reasoningEngine.ts's forbidden-claims scan - reuse this
// SAME list rather than maintaining a second, potentially-divergent one.
export const DISALLOWED_CLAIM_PATTERNS: Array<[RegExp, string]> = [
  [/100% accurat/i, "absolutist accuracy claim"],
  [/definitely healthy/i, "definitive health claim"],
  [/you (definitely|certainly) (do not|don't) have/i, "definitive negative claim"],
  [/diagnos(is|ed) (you )?with/i, "diagnostic claim"],
  // Matches affirmative guarantee claims; the mandatory negated disclaimer
  // "does not guarantee that no eye disease is present" must not trigger this.
  [/(?<!not )\bguarantee/i, "guarantee claim"],
  // Phase 3: symptom -> diagnosis / symptom -> fabricated finding causal claims.
  [/because (the patient|they) reports?/i, "symptom-causation claim"],
  [/due to the reported symptom/i, "symptom-causation claim"],
  [/symptoms? (indicate|confirm|prove)s? (a |an )?diagnosis/i, "symptom-causation claim"],
];

export async function runPipeline(input: PipelineInput): Promise<PipelineOutput> {
  await ensureRegistryHydrated();
  const { study, originalBytes } = input;

  // ---- Stage 0: format gate (DICOM detection) ----
  const dicom = detectDicom(originalBytes);
  if (dicom.isDicom) {
    // Safety rule: never silently analyze an unsupported scan.
    return unsupportedResult(study, dicom.note);
  }

  // ---- Stage 1: quality gate (REAL metrics) ----
  const quality = await assessQuality(originalBytes);
  const qualityAcceptable = quality.quality_status === "pass";

  // ---- Stage 1b: model registry gate + out-of-distribution check ----
  const modelRecord = getModel("demo-fundus-synthetic-v0"); // the only registered model
  const deviceInfo = study.metadata.manufacturer || study.metadata.model
    ? { manufacturer: study.metadata.manufacturer, model: study.metadata.model }
    : null;
  // device is passed explicitly (per-study execution gate) so a non-DEMO
  // model with incompatible/undeclared device support is hard-blocked here,
  // the same point modality already is - device is informational-only for
  // DEMO, which is unaffected by this check (see gateModelUse's doc comment).
  const modelGate = modelRecord ? gateModelUse(modelRecord, deviceInfo) : null;
  const ood = assessOod({
    modality: study.modality,
    quality,
    model: modelRecord,
    device: deviceInfo,
    metadataProvided: study.metadata.providedBy !== "none",
  });

  // ---- Stage 2: anatomical segmentation (placeholder) ----
  // Emits no structures or measurements. Recorded for provenance.

  // ---- Stage 3: specialized detectors (DEMO / SYNTHETIC ONLY) ----
  let findings: Finding[] = [];
  if (qualityAcceptable && modelGate?.allowed) {
    const scenario = pickDemoScenario(originalBytes);
    findings = buildDemoFindings(scenario, quality.quality_score);
    // Taxonomy + provenance tagging; enforce taxonomy/modality/status rules.
    findings = findings.flatMap((f) => {
      const gate = mayEmitFinding(f.type, canonicalModality(study.modality), modelRecord!.status);
      if (!gate.ok) return []; // refuse to emit a finding the taxonomy forbids
      return [{ ...f, taxonomy_level: "observation" as const, model_status: modelRecord!.status }];
    });
  }
  // If quality gate failed: findings stay EMPTY (safety rule), and the result
  // carries the mandatory insufficient-quality message.

  // ---- Stage 4: ensemble / consistency ----
  const ensemble = runEnsemble(findings);
  findings = ensemble.cappedFindings;

  // ---- Stage 5: uncertainty ----
  const uncertainty = estimateUncertainty(quality.quality_score, findings, ensemble);
  if (ood.detected) {
    uncertainty.reasons.push(OOD_MESSAGE);
    uncertainty.reasons.push(...ood.reasons);
    uncertainty.overall = Math.min(0.99, uncertainty.overall + 0.1);
  }

  // ---- Stage 5b: symptom correlation (AFTER model output; context only) ----
  const symptoms = input.symptoms ?? [];
  const correlation = symptoms.length
    ? correlateSymptoms({
        symptoms,
        findings,
        qualityAcceptable,
        modelStatus: modelRecord?.status ?? "DEMO",
        modelUsesSymptoms: modelRecord?.uses_symptoms ?? false,
        qualityScore: quality.quality_score,
      })
    : null;

  // ---- Stage 5c: possible conditions (associations only; empty for unvalidated models) ----
  const conditions = possibleConditions({
    supported_conditions: modelRecord?.supported_conditions ?? [],
    modality: study.modality,
    modelStatus: modelRecord?.status ?? "DEMO",
    hasValidationEvidence: !!modelRecord?.performance.evidence_reference,
    findings,
  });

  // ---- Stage 5d: treatment information (ONLY for conditions that already
  // passed possible_conditions gating - finding -> condition -> treatment
  // provenance chain; STOP and produce nothing if that chain is broken) ----
  const treatmentInformation = getTreatmentInformation(
    conditions.conditions.map((c) => ({ id: c.id, label: c.label }))
  );

  // ---- Stage 6: clinical rule engine / triage ----
  const triage = runTriage({
    findings,
    qualityAcceptable,
    qualityScore: quality.quality_score,
    uncertainty: uncertainty.overall,
    modality: study.modality,
    ood: { detected: ood.detected, message: ood.message },
    // Structured red-flag symptoms escalate via deterministic rules - but they
    // never name a condition and never create findings.
    redFlagSymptoms: redFlagSymptoms(symptoms).map((d) => d.type),
    symptomUrgency: symptoms.length ? correlation!.urgency : undefined,
  });

  // ---- Stage 6b: diagnosis gate (S12 - additive, fail-closed) ----
  // Decides whether this result may EVER use diagnostic ("this is X
  // condition") language vs. correlation-required language. Every field
  // that has no documented/formal basis in this deployment (intended-use
  // approval, calibration evidence) defaults to the value that keeps the
  // gate CLOSED, per the S12 integration policy - only modelValidation,
  // modalityMatches, qualityStatus, oodDetected and evidenceSufficient are
  // derived from real pipeline state; the gate is closed by modelValidation
  // alone today (DEMO is never CLINICALLY_VALIDATED), regardless.
  const diagnosisGateResult = canDisplayDiagnosis({
    modelValidation: mapModelValidationStatus(modelRecord?.status),
    intendedUseMatches: false, // no formally documented/approved intended use exists in this deployment
    modalityMatches: !!modelRecord && supportsModality(modelRecord, study.modality),
    qualityStatus: quality.quality_status,
    oodDetected: ood.detected,
    calibrationAvailable: false, // no documented calibration evidence exists in this deployment
    evidenceSufficient: conditions.conditions.length > 0 && !!modelRecord?.performance.evidence_reference,
  });

  // ---- Assemble structured result ----
  const first = study.files[0];
  const analysis: AnalysisResult = {
    schema_version: SCHEMA_VERSION,
    study: {
      study_id: study.studyId,
      modality: study.modality,
      eye: study.eye,
      source: study.source,
      captured_at: study.metadata.scanDateTime ?? null,
      metadata_provenance: study.metadata.providedBy,
    },
    quality: {
      score: quality.quality_score,
      acceptable: qualityAcceptable,
      status: quality.quality_status,
      artifacts: quality.detected_artifacts,
      affected_regions: quality.affected_regions,
      recommended_reacquisition: quality.recommended_reacquisition,
    },
    segmentation: {
      implemented: false,
      note:
        "Anatomical segmentation is an integration placeholder (component: " +
        COMPONENTS.anatomySegmentation.id + " v" + COMPONENTS.anatomySegmentation.version +
        "). No structures were segmented and no measurements derived from segmentation.",
    },
    findings: qualityAcceptable ? findings : [],
    uncertainty: {
      overall: uncertainty.overall,
      reasons: uncertainty.reasons,
      ensemble_agreement: ensemble.agreement,
    },
    ood: {
      detected: ood.detected,
      reasons: ood.reasons,
      message: ood.message,
    },
    model_registry: {
      model_id: modelRecord?.model_id ?? "none",
      model_version: modelRecord?.version ?? "none",
      model_status: modelRecord?.status ?? "DEMO",
      display_label: modelGate?.label ?? DEMO_LABEL,
      integrity_checks: [
        { check: "registry", passed: !!modelRecord, detail: modelRecord ? "Registered model in use." : "No registered model." },
        { check: "artifact", passed: true, detail: "Placeholder DEMO model: no artifact on disk by design (data/models is empty)." },
        { check: "status_gate", passed: !!modelGate?.allowed, detail: modelGate ? modelGate.reasons.join(" ") || "Status permits demo use only." : "No gate result." },
      ],
      device_compatibility: modelRecord ? deviceCompatible(modelRecord, deviceInfo) : { compatible: false, note: "Device compatibility has not been validated. No registered model in use." },
      model_input: modelRecord?.input_schema ?? "IMAGE_ONLY",
    },
    patient_context: {
      reported: symptoms.length > 0,
      symptoms: symptoms.map((s) => ({
        type: s.type,
        label: SYMPTOM_MAP[s.type]?.label,
        onset: s.onset, duration: s.duration, severity: s.severity,
        laterality: s.laterality, progression: s.progression, frequency: s.frequency,
        free_text: s.free_text ?? null,
      })),
      red_flags: redFlagSymptoms(symptoms).map((d) => d.type),
      note:
        symptoms.length > 0
          ? "Patient-reported symptoms provide CONTEXT only. They do not create imaging findings and never establish a diagnosis."
          : "No structured symptoms were reported for this study.",
    },
    symptom_correlation: correlation ?? undefined,
    possible_conditions: symptoms.length || findings.length ? conditions : undefined,
    treatment_information: treatmentInformation,
    recommendation: {
      priority: triage.priority,
      action: triage.action,
      rationale: triage.rationale,
    },
    ensemble: {
      performed: ensemble.performed,
      checks: ensemble.checks,
      note: ensemble.note,
    },
    demo: {
      synthetic_result: true,
      label: DEMO_LABEL,
    },
    diagnosis_gate: {
      allowed: diagnosisGateResult.allowed,
      reasons: diagnosisGateResult.reasons,
      clinical_interpretation: diagnosisGateResult.clinicalInterpretation,
    },
    provenance: {
      models: modelProvenance(["quality", "segmentation", "detector", "ensemble"]),
      ruleset_version: RULESET_VERSION,
      analyzed_at: new Date().toISOString(),
      input_dimensions: {
        width: quality.metrics.width,
        height: quality.metrics.height,
      },
      pipeline_version: PIPELINE_VERSION,
    },
    safety: {
      quality_gate_enforced: true,
      disclaimers: [
        VALIDATION_STATUS_BANNER,
        DEMO_LABEL,
        "This system is a screening/decision-support architecture. It does not establish diagnoses. Only a qualified eye-care professional can diagnose eye disease.",
        "A negative automated result does not guarantee that no eye disease is present.",
      ],
      blocked_claims: [],
    },
  };

  // ---- Stage 7: safety validator ----
  const validation = validateAnalysisResult(analysis);
  const blocked: string[] = [];
  const text = JSON.stringify(analysis);
  for (const [rx, label] of DISALLOWED_CLAIM_PATTERNS) {
    if (rx.test(text)) blocked.push(label);
  }
  analysis.safety.blocked_claims = blocked;

  const validationErrors = validation.errors.map((e) => `${e.path}: ${e.message}`);
  if (!validation.valid) {
    // Safety rule: never store or display an invalid structured result.
    throw new Error(`Structured result failed schema validation: ${validationErrors.join("; ")}`);
  }
  if (blocked.length > 0) {
    throw new Error(`Safety validator blocked forbidden claims: ${blocked.join(", ")}`);
  }

  return { analysis, quality, triage, validationErrors };
}

function unsupportedResult(study: NormalizedStudy, note: string): PipelineOutput {
  const qualityStub: QualityResult = {
    quality_score: 0,
    quality_status: "fail",
    detected_artifacts: ["unsupported_format"],
    affected_regions: [],
    recommended_reacquisition: false,
    metrics: { width: 0, height: 0, sharpness_score: 0, illumination_mean: 0, illumination_p5: 0, illumination_p95: 0, highlight_clip_ratio: 0, shadow_clip_ratio: 0, colorfulness: 0, grayscale_only: true },
    thresholds: {},
    limitations: [note],
  };
  const triage: TriageOutcome = {
    priority: "specialist_review_required",
    action: "File format not supported by the analysis pipeline. Have the study interpreted by an eye-care professional.",
    rationale: "Unsupported/corrupted input must never be silently analyzed (mandatory safety rule).",
    triggered_rules: ["unsupported_format_block"],
  };
  const analysis: AnalysisResult = {
    schema_version: SCHEMA_VERSION,
    study: { study_id: study.studyId, modality: study.modality, eye: study.eye, source: study.source, captured_at: null, metadata_provenance: study.metadata.providedBy },
    quality: { score: 0, acceptable: false, status: "fail", artifacts: ["unsupported_format"], affected_regions: [], recommended_reacquisition: false },
    segmentation: { implemented: false, note: "Not performed." },
    findings: [],
    uncertainty: { overall: 1, reasons: [note] },
    recommendation: { priority: triage.priority, action: triage.action, rationale: triage.rationale },
    ensemble: { performed: false, checks: [], note: "Not performed." },
    demo: { synthetic_result: false, label: DEMO_LABEL },
    diagnosis_gate: (() => {
      const g = unvalidatedGateResult();
      return { allowed: g.allowed, reasons: g.reasons, clinical_interpretation: g.clinicalInterpretation };
    })(),
    provenance: { models: modelProvenance(["quality"]), ruleset_version: RULESET_VERSION, analyzed_at: new Date().toISOString(), input_dimensions: { width: 0, height: 0 }, pipeline_version: PIPELINE_VERSION },
    safety: { quality_gate_enforced: true, disclaimers: [VALIDATION_STATUS_BANNER], blocked_claims: [] },
  };
  return { analysis, quality: qualityStub, triage, validationErrors: [] };
}
