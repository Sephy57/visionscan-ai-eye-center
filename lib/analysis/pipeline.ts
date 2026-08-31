import { newId, StoredFile, readOriginalScan } from "../storage/files";
import { assessQuality, QualityResult } from "../imaging/quality";
import { detectDicom } from "../imaging/dicom";
import { NormalizedStudy } from "../devices/adapter";
import { pickDemoScenario, buildDemoFindings } from "./findings";
import { runEnsemble, estimateUncertainty } from "./ensemble";
import { runTriage, TriageOutcome } from "../clinical/triage";
import { validateAnalysisResult, AnalysisResult, Finding, SCHEMA_VERSION, PIPELINE_VERSION } from "./schema";
import { modelProvenance, RULESET_VERSION, COMPONENTS, getModel, gateModelUse, deviceCompatible, supportsModality } from "../models/registry";
import { assessOod, OOD_MESSAGE } from "./ood";
import { mayEmitFinding } from "./taxonomy";
import { canonicalModality } from "../models/modalities";
import { DEMO_LABEL, VALIDATION_STATUS_BANNER } from "../config";

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
}

export interface PipelineOutput {
  analysis: AnalysisResult;
  quality: QualityResult;
  triage: TriageOutcome;
  validationErrors: string[];
}

const DISALLOWED_CLAIM_PATTERNS: Array<[RegExp, string]> = [
  [/100% accurat/i, "absolutist accuracy claim"],
  [/definitely healthy/i, "definitive health claim"],
  [/you (definitely|certainly) (do not|don't) have/i, "definitive negative claim"],
  [/diagnos(is|ed) (you )?with/i, "diagnostic claim"],
  // Matches affirmative guarantee claims; the mandatory negated disclaimer
  // "does not guarantee that no eye disease is present" must not trigger this.
  [/(?<!not )\bguarantee/i, "guarantee claim"],
];

export async function runPipeline(input: PipelineInput): Promise<PipelineOutput> {
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
  const modelGate = modelRecord ? gateModelUse(modelRecord) : null;
  const deviceInfo = study.metadata.manufacturer || study.metadata.model
    ? { manufacturer: study.metadata.manufacturer, model: study.metadata.model }
    : null;
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

  // ---- Stage 6: clinical rule engine / triage ----
  const triage = runTriage({
    findings,
    qualityAcceptable,
    qualityScore: quality.quality_score,
    uncertainty: uncertainty.overall,
    modality: study.modality,
    ood: { detected: ood.detected, message: ood.message },
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
    },
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
    provenance: { models: modelProvenance(["quality"]), ruleset_version: RULESET_VERSION, analyzed_at: new Date().toISOString(), input_dimensions: { width: 0, height: 0 }, pipeline_version: PIPELINE_VERSION },
    safety: { quality_gate_enforced: true, disclaimers: [VALIDATION_STATUS_BANNER], blocked_claims: [] },
  };
  return { analysis, quality: qualityStub, triage, validationErrors: [] };
}
