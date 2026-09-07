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
import { unavailableFundusAbnormalityResult, resultFromResearchDetector } from "../models/fundusAbnormality";
import { unavailableDrAssessmentResult, resultFromResearchGrader } from "../models/drAssessment";
import type { FundusLesionResearchRun } from "../models/fundusLesionLocalProvider";
import type { DrGradeResearchRun } from "../models/drGradeLocalProvider";

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

  // ---- Stage 1c: general fundus-abnormality gate (before any disease reasoning) ----
  // A reviewed detector plugs in here. There is intentionally no fallback to
  // SegFormer: optic-disc/cup segmentation has no lesion-detection scope.
  // When the hash-verified RESEARCH lesion detector runs, its genuine output
  // flows through resultFromResearchDetector(); otherwise this returns a
  // transparent MODEL_UNAVAILABLE state rather than a reassuring "normal".
  // The RESEARCH lesion model is attempted for in-scope fundus input only.
  // Device compatibility is intentionally NOT a block here: the IMAGE_ONLY
  // lesion computation does not branch on device metadata, so an absent
  // device is disclosed as DOMAIN_VALIDATION_UNKNOWN (see provider notes),
  // never silently passed or failed. The context-free registry gate below
  // still enforces registration, checksum presence, modality declaration,
  // and RESEARCH status before any inference is attempted.
  let fundusAbnormality = unavailableFundusAbnormalityResult(quality, ood, study.modality);
  let researchRun: FundusLesionResearchRun | null = null;
  let researchAttemptNote: string | null = null;
  const lesionRecord = getModel("fundus-lesions-clementp-unet-seresnext50");
  const lesionGate = lesionRecord ? gateModelUse(lesionRecord) : null;
  if (
    qualityAcceptable &&
    canonicalModality(study.modality) === "FUNDUS" &&
    lesionRecord &&
    lesionGate?.allowed &&
    supportsModality(lesionRecord, study.modality)
  ) {
    try {
      // Lazy import: the DEMO/quality/OOD path never loads the ML worker module.
      const { runFundusLesionResearchAnalysis } = await import("../models/fundusLesionLocalProvider");
      const run = await runFundusLesionResearchAnalysis(study, {
        qualityScore: quality.quality_score,
        eye: study.eye,
        device: deviceInfo,
        imageBytes: originalBytes,
      });
      if (run.raw.inference_status !== "completed") {
        // Worker failed (no package, no runtime, timeout, malformed output):
        // keep the original quality/OOD verdict (it already distinguishes
        // OOD from unavailable) and fall back to the labeled DEMO path below.
        // The failure reason is preserved in the integrity-check notes.
        researchAttemptNote = run.notes[0] ?? "Research lesion detector failed; no finding was inferred.";
      } else {
        researchRun = run;
        // Lesion-domain OOD: image characteristics and modality still block;
        // missing device metadata is DOMAIN_VALIDATION_UNKNOWN (disclosed in
        // provider notes), never conflated into OUT_OF_DISTRIBUTION.
        const lesionOod = assessOod({
          modality: study.modality,
          quality,
          model: lesionRecord,
          device: deviceInfo,
          metadataProvided: study.metadata.providedBy !== "none",
          deviceUnknownIsDomainUnknown: true,
        });
        fundusAbnormality = resultFromResearchDetector({
          raw: researchRun.raw,
          quality,
          ood: lesionOod,
          modelId: lesionRecord.model_id,
          modelVersion: lesionRecord.version,
          supportedFindingTypes: new Set(lesionRecord.supported_findings),
        });
      }
    } catch (err) {
      researchRun = null;
      researchAttemptNote = `Research lesion detector could not run: ${String(err instanceof Error ? err.message : err).slice(0, 200)}`;
    }
  } else if (canonicalModality(study.modality) === "FUNDUS" && qualityAcceptable && lesionRecord && !lesionGate?.allowed) {
    researchAttemptNote = `Research lesion detector gated off: ${(lesionGate?.reasons ?? ["unknown reason"]).join(" ").slice(0, 200)}`;
  }

  // ---- Stage 1d: research DR grade estimation (before any disease reasoning) ----
  // Same scoping and honesty rules as Stage 1c: FUNDUS + quality-pass input
  // only, IMAGE_ONLY model so device metadata is disclosed (not gated), and
  // any worker failure keeps the original quality/OOD verdict with a labeled
  // DEMO fallback. Runs after the lesion detector (sequentially, never
  // stacked in RAM) so the two research outputs can corroborate or disagree.
  let drAssessment = unavailableDrAssessmentResult(quality, ood, study.modality);
  let drRun: DrGradeResearchRun | null = null;
  let drAttemptNote: string | null = null;
  const drRecord = getModel("fundus-dr-grading-effb0");
  const drGate = drRecord ? gateModelUse(drRecord) : null;
  const researchScopeOk =
    qualityAcceptable &&
    canonicalModality(study.modality) === "FUNDUS" &&
    drRecord &&
    drGate?.allowed &&
    supportsModality(drRecord, study.modality);
  if (researchScopeOk) {
    try {
      const { runDrGradeResearchAnalysis } = await import("../models/drGradeLocalProvider");
      const run = await runDrGradeResearchAnalysis(study, {
        qualityScore: quality.quality_score,
        eye: study.eye,
        device: deviceInfo,
        imageBytes: originalBytes,
      });
      if (run.raw.inference_status !== "completed" || !run.grade) {
        drAttemptNote = run.notes[0] ?? "Research DR grader failed; no grade was estimated.";
      } else {
        drRun = run;
        const researchOod = assessOod({
          modality: study.modality,
          quality,
          model: drRecord,
          device: deviceInfo,
          metadataProvided: study.metadata.providedBy !== "none",
          deviceUnknownIsDomainUnknown: true,
        });
        drAssessment = resultFromResearchGrader({
          grade: drRun.grade,
          raw: drRun.raw,
          quality,
          ood: researchOod,
          modelId: drRecord.model_id,
          modelVersion: drRecord.version,
        });
      }
    } catch (err) {
      drRun = null;
      drAttemptNote = `Research DR grader could not run: ${String(err instanceof Error ? err.message : err).slice(0, 200)}`;
    }
  } else if (canonicalModality(study.modality) === "FUNDUS" && qualityAcceptable && drRecord && !drGate?.allowed) {
    drAttemptNote = `Research DR grader gated off: ${(drGate?.reasons ?? ["unknown reason"]).join(" ").slice(0, 200)}`;
  }

  // ---- Stage 2: anatomical segmentation (placeholder) ----
  // Emits no structures or measurements. Recorded for provenance.

  // ---- Stage 3: specialized detectors ----
  // Fundus studies use REAL research-detector output when it completed;
  // every other path keeps the labeled DEMO/synthetic behavior exactly.
  // When both research models complete, both contribute findings (each keeps
  // its own model provenance); the lesion detector remains the primary
  // registry model because it localizes.
  let findings: Finding[] = [];
  let activeModelRecord = modelRecord;
  let activeModelGate = modelGate;
  const usedLesionResearch = !!researchRun && researchRun.raw.inference_status === "completed";
  const usedDrResearch = !!drRun && drRun.raw.inference_status === "completed" && !!drRun.grade;
  const usedResearch = usedLesionResearch || usedDrResearch;
  const tagResearch = (list: Finding[]) =>
    list.flatMap((f) => {
      const gate = mayEmitFinding(f.type, canonicalModality(study.modality), "RESEARCH");
      if (!gate.ok) return []; // refuse to emit a finding the taxonomy forbids
      return [{ ...f, taxonomy_level: "observation" as const, model_status: "RESEARCH" as const }];
    });
  if (usedLesionResearch && researchRun && lesionRecord && lesionGate) {
    activeModelRecord = lesionRecord;
    activeModelGate = lesionGate;
    findings = [...findings, ...tagResearch(researchRun.findings)];
  }
  if (usedDrResearch && drRun && drRecord && drGate) {
    if (!usedLesionResearch) {
      activeModelRecord = drRecord;
      activeModelGate = drGate;
    }
    findings = [...findings, ...tagResearch(drRun.findings)];
  }
  if (!usedResearch && qualityAcceptable && modelGate?.allowed) {
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
        modelStatus: activeModelRecord?.status ?? "DEMO",
        modelUsesSymptoms: activeModelRecord?.uses_symptoms ?? false,
        qualityScore: quality.quality_score,
      })
    : null;

  // ---- Stage 5c: possible conditions (associations only; empty for unvalidated models) ----
  const conditions = possibleConditions({
    supported_conditions: activeModelRecord?.supported_conditions ?? [],
    modality: study.modality,
    modelStatus: activeModelRecord?.status ?? "DEMO",
    hasValidationEvidence: !!activeModelRecord?.performance.evidence_reference,
    findings,
  });

  // ---- Stage 5d: treatment information (ONLY for conditions that already
  // passed possible_conditions gating - finding -> condition -> treatment
  // provenance chain; STOP and produce nothing if that chain is broken) ----
  const treatmentInformation = getTreatmentInformation(
    conditions.conditions.map((c) => ({ id: c.id, label: c.label }))
  );

  // ---- Stage 5e: multi-model research agreement (no score averaging) ----
  // Compares the lesion detector (regions present?) with the DR grader
  // (referable grade?) when BOTH completed. Corroboration strengthens
  // evidence visibility; disagreement stays visible with no automatic
  // winner; consistent negatives are still not normality.
  const lesionPositive = usedLesionResearch && !!researchRun ? researchRun.findings.length > 0 : false;
  const drReferable = usedDrResearch && !!drRun?.grade ? drRun.grade.referable_dr : null;
  const drGradeValue = usedDrResearch && !!drRun?.grade ? drRun.grade.predicted_grade : null;
  let multiModelAgreement: "CORROBORATED_RESEARCH_EVIDENCE" | "MODEL_DISAGREEMENT" | "CONSISTENT_RESEARCH_NEGATIVE" | "SINGLE_RESEARCH_MODEL" | "NO_RESEARCH_MODEL_OUTPUT";
  const multiModelNotes: string[] = [];
  if (usedLesionResearch && usedDrResearch) {
    if (drReferable && lesionPositive) {
      multiModelAgreement = "CORROBORATED_RESEARCH_EVIDENCE";
      multiModelNotes.push(
        `CORROBORATED_RESEARCH_EVIDENCE (not a confirmed diagnosis): the DR grader estimated grade ${drGradeValue}/4 (referable threshold met) and the lesion detector localized ${researchRun!.findings.length} lesion-like region(s). Two uncalibrated research outputs agree; ophthalmic review is still required.`
      );
    } else if (drReferable !== lesionPositive) {
      multiModelAgreement = "MODEL_DISAGREEMENT";
      multiModelNotes.push(
        `MODEL_DISAGREEMENT (no automatic winner): DR grader ${drReferable ? `estimated grade ${drGradeValue}/4 (referable)` : "did not reach the referable threshold"} while the lesion detector ${lesionPositive ? `localized ${researchRun!.findings.length} region(s)` : "found no target regions"}. Both outputs are uncalibrated research evidence; a clinician must reconcile them.`
      );
    } else {
      multiModelAgreement = "CONSISTENT_RESEARCH_NEGATIVE";
      multiModelNotes.push(
        "CONSISTENT_RESEARCH_NEGATIVE: DR grader below the referable threshold and no target lesion regions. Other ocular abnormalities may still be present; this is not a normal-fundus result."
      );
    }
  } else if (usedResearch) {
    multiModelAgreement = "SINGLE_RESEARCH_MODEL";
    multiModelNotes.push(
      `Only one research model completed (${usedLesionResearch ? "lesion detector" : "DR grader"}); no cross-model agreement statement is possible.`
    );
  } else {
    multiModelAgreement = "NO_RESEARCH_MODEL_OUTPUT";
    multiModelNotes.push("No research imaging model completed for this study.");
  }

  // ---- Stage 6: clinical rule engine / triage ----
  const triage = runTriage({
    findings,
    qualityAcceptable,
    qualityScore: quality.quality_score,
    uncertainty: uncertainty.overall,
    modality: study.modality,
    ood: { detected: ood.detected, message: ood.message },
    generalDetector: {
      state: fundusAbnormality.state,
      validation_state: fundusAbnormality.validation_state,
    },
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
    modelValidation: mapModelValidationStatus(activeModelRecord?.status),
    intendedUseMatches: false, // no formally documented/approved intended use exists in this deployment
    modalityMatches: !!activeModelRecord && supportsModality(activeModelRecord, study.modality),
    qualityStatus: quality.quality_status,
    oodDetected: ood.detected,
    calibrationAvailable: false, // no documented calibration evidence exists in this deployment
    evidenceSufficient: conditions.conditions.length > 0 && !!activeModelRecord?.performance.evidence_reference,
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
    fundus_abnormality: fundusAbnormality,
    dr_assessment: drAssessment,
    multi_model: {
      performed: usedLesionResearch || usedDrResearch,
      agreement: multiModelAgreement,
      models: [
        ...(usedLesionResearch && researchRun
          ? [{ model_id: researchRun.model.model_id, model_version: researchRun.model.version, model_status: researchRun.model.status, output_summary: `${researchRun.findings.length} lesion-like region(s)` }]
          : []),
        ...(usedDrResearch && drRun && drRun.grade
          ? [{ model_id: drRun.model.model_id, model_version: drRun.model.version, model_status: drRun.model.status, output_summary: `grade ${drRun.grade.predicted_grade}/4 (${drRun.grade.grade_label}), referable=${drRun.grade.referable_dr}` }]
          : []),
      ],
      notes: multiModelNotes,
    },
    model_registry: {
      model_id: activeModelRecord?.model_id ?? "none",
      model_version: activeModelRecord?.version ?? "none",
      model_status: activeModelRecord?.status ?? "DEMO",
      display_label: activeModelGate?.label ?? DEMO_LABEL,
      integrity_checks: [
        { check: "registry", passed: !!activeModelRecord, detail: activeModelRecord ? "Registered model in use." : "No registered model." },
        (() => {
          const primaryRun = researchRun ?? drRun;
          return usedResearch && primaryRun
            ? { check: "artifact", passed: primaryRun.integrity.trusted, detail: primaryRun.integrity.checks.map((c) => `${c.check}:${c.passed ? "pass" : "FAIL"}`).join(" ") || "Research artifact integrity verification." }
            : { check: "artifact", passed: true, detail: "Placeholder DEMO model: no artifact on disk by design (data/models is empty)." };
        })(),
        { check: "status_gate", passed: !!activeModelGate?.allowed, detail: activeModelGate ? activeModelGate.reasons.join(" ") || (usedResearch ? "Status permits research use only." : "Status permits demo use only.") : "No gate result." },
        ...(researchAttemptNote ? [{ check: "research_detector_attempt" as const, passed: false, detail: researchAttemptNote }] : []),
        ...((researchRun?.notes ?? []).map((n) => ({ check: "research_detector_note" as const, passed: true, detail: n.slice(0, 300) }))),
        ...(drAttemptNote ? [{ check: "dr_grader_attempt" as const, passed: false, detail: drAttemptNote }] : []),
        ...((drRun?.notes ?? []).map((n) => ({ check: "dr_grader_note" as const, passed: true, detail: n.slice(0, 300) }))),
      ],
      device_compatibility: activeModelRecord ? deviceCompatible(activeModelRecord, deviceInfo) : { compatible: false, note: "Device compatibility has not been validated. No registered model in use." },
      model_input: activeModelRecord?.input_schema ?? "IMAGE_ONLY",
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
      synthetic_result: !usedResearch,
      label: activeModelGate?.label ?? DEMO_LABEL,
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
        activeModelGate?.label ?? DEMO_LABEL,
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
