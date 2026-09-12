import fs from "fs";
import path from "path";
import { newId, StoredFile, readOriginalScan } from "../storage/files";
import { assessQuality, assessOctBscanQuality, QualityResult } from "../imaging/quality";
import { detectDicom } from "../imaging/dicom";
import { NormalizedStudy } from "../devices/adapter";
import { pickDemoScenario, buildDemoFindings } from "./findings";
import { runEnsemble, estimateUncertainty } from "./ensemble";
import { runTriage, TriageOutcome } from "../clinical/triage";
import { validateAnalysisResult, AnalysisResult, Finding, SCHEMA_VERSION, PIPELINE_VERSION, ModelExecutionLedgerEntry, ModelExecutionStatus } from "./schema";
import { buildClaimLedger } from "../clinical/claimLedger";
import { modelProvenance, RULESET_VERSION, COMPONENTS, getModel, gateModelUse, deviceCompatible, supportsModality } from "../models/registry";
import { ensureRegistryHydrated } from "../models/registryPersistence";
import { assessOod, OOD_MESSAGE } from "./ood";
import { mayEmitFinding } from "./taxonomy";
import { canonicalModality } from "../models/modalities";
import { correlateSymptoms } from "../clinical/correlation";
import { possibleConditions } from "../clinical/conditions";
import { getTreatmentInformation } from "../treatment/treatmentInfo";
import { PatientSymptom, SYMPTOM_MAP, redFlagSymptoms } from "../clinical/symptoms";
import { DEMO_LABEL, VALIDATION_STATUS_BANNER, MODEL_ROOT, PROJECT_ROOT } from "../config";
import { canDisplayDiagnosis, unvalidatedGateResult, DiagnosisGateInput } from "../models/diagnosisGate";
import { unavailableFundusAbnormalityResult, resultFromResearchDetector } from "../models/fundusAbnormality";
import { unavailableDrAssessmentResult, resultFromResearchGrader } from "../models/drAssessment";
import { unavailableOctAssessmentResult, resultFromResearchOct } from "../models/octAssessment";
import type { FundusLesionResearchRun } from "../models/fundusLesionLocalProvider";
import type { DrGradeResearchRun } from "../models/drGradeLocalProvider";
import type { OctResearchRun } from "../models/octLocalProvider";
import { routeUploadedAsset, AssetRoutingResult } from "../assets/assetRouter";
import { OUTPUT_CONTRACT_VERSION } from "../models/outputContract";

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
  asset_routing?: AssetRoutingResult;
  document_routing?: import("../documents/extraction/pdfIntelligence").PdfAssetRouting[];
  document_assets?: Array<{
    asset_id: string; document_id: string; page: number;
    bbox: { x: number; y: number; w: number; h: number };
    source_page_hash: string; roi_hash: string; content_type: "OCT_BSCAN";
    modality: "OCT"; eye: "OD" | "OS" | "unknown"; bytes: Buffer;
  }>;
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

/**
 * A registry entry describes a model that may be used, but a fresh checkout
 * does not necessarily contain its private artifact/runtime.  Keep that
 * deployment state separate from a provider failure: only a genuinely
 * installed package is eligible for a research attempt.  This inexpensive
 * presence check deliberately does not replace the provider's hash and
 * manifest verification immediately before inference.
 */
function researchPackagePresent(model: ReturnType<typeof getModel>): boolean {
  if (!model || model.status === "DEMO" || !model.file_path) return false;
  const packageDir = path.resolve(MODEL_ROOT, model.model_id);
  const artifactPath = path.resolve(MODEL_ROOT, model.file_path);
  const root = path.resolve(MODEL_ROOT);
  const relativeArtifact = path.relative(root, artifactPath);
  if (relativeArtifact.startsWith("..") || path.isAbsolute(relativeArtifact)) return false;
  const pythonPath = path.join(
    PROJECT_ROOT,
    ".venv-ophthalmic",
    process.platform === "win32" ? "Scripts" : "bin",
    process.platform === "win32" ? "python.exe" : "python3",
  );
  return fs.existsSync(path.join(packageDir, "manifest.json")) &&
    fs.existsSync(artifactPath) &&
    fs.existsSync(pythonPath);
}

export async function runPipeline(input: PipelineInput): Promise<PipelineOutput> {
  await ensureRegistryHydrated();
  const { originalBytes } = input;
  // Always recompute the route from immutable bytes.  A caller-provided
  // routing object is display/provenance context only and must never be able
  // to promote a PDF, random image, or another modality into a research path.
  // This also makes a stale/tampered sidecar fail closed on every execution.
  const routedAsset = await routeUploadedAsset(originalBytes, {
    declaredModality: input.study.modality,
    device: { manufacturer: input.study.metadata.manufacturer, model: input.study.metadata.model },
  });
  const contentModality = routedAsset.modality === "FUNDUS_PHOTO" ? "fundus" : routedAsset.modality === "OCT" ? "oct" : null;
  const declaredCanonical = canonicalModality(input.study.modality);
  const declaredIsUnknown = !input.study.modality || input.study.modality.toLowerCase() === "unknown";
  const contentCanonical = contentModality ? canonicalModality(contentModality) : null;
  const researchModalityConflict = !!contentCanonical && !!declaredCanonical &&
    (declaredCanonical === "FUNDUS" || declaredCanonical === "OCT") &&
    (contentCanonical === "FUNDUS" || contentCanonical === "OCT") && declaredCanonical !== contentCanonical;
  // Content classification fills an omitted/unknown declaration. If a caller
  // explicitly declares the other research modality, fail closed to UNKNOWN
  // rather than sending a fundus frame to OCT (or vice versa). Unsupported
  // non-research declarations retain their declared demo-only route so legacy
  // integrations remain transparent and cannot gain research execution.
  const effectiveModality = contentModality && routedAsset.method === "CONTENT_HEURISTICS" &&
    (declaredIsUnknown || declaredCanonical === contentCanonical)
    ? contentModality
    : researchModalityConflict ? "unknown" : input.study.modality;
  const study: NormalizedStudy = { ...input.study, modality: effectiveModality, asset_routing: routedAsset };

  // ---- Stage 0: format gate (DICOM detection) ----
  const dicom = detectDicom(originalBytes);
  if (dicom.isDicom) {
    // Safety rule: never silently analyze an unsupported scan.
    return unsupportedResult(study, dicom.note, routedAsset);
  }
  if (routedAsset.container_type !== "IMAGE") {
    // PDFs are decomposed by the document workflow before any OCT inference;
    // the primary image pipeline must not feed a whole PDF to sharp/model
    // code.  OTHER containers are equally explicit and fail closed.
    return unsupportedResult(study, `Unsupported asset container: ${routedAsset.container_type}.`, routedAsset);
  }

  // ---- Stage 1: quality gate (REAL metrics) ----
  let quality: QualityResult;
  try {
    quality = await assessQuality(originalBytes);
  } catch {
    // MIME/extension claims are not proof of a decodable image.  Return a
    // structured unsuitable result rather than throwing or falling through to
    // a demo interpretation.
    return unsupportedResult(study, "Image bytes could not be decoded by the server quality gate.", routedAsset);
  }
  const qualityAcceptable = quality.quality_status === "pass";

  // ---- Stage 1b: model registry gate + out-of-distribution check ----
  const canonicalInputModality = canonicalModality(study.modality);
  // A registry entry can exist in source control while its private
  // hash-verified package is absent from a fresh checkout/CI runner.  Treat
  // that as "research unavailable" and retain the established labeled DEMO
  // path for that deployment.  Once a package/runtime is present, the real
  // provider is attempted and a runtime failure remains MODEL_FAILED (never a
  // synthetic substitute).
  const lesionRecord = getModel("fundus-lesions-clementp-unet-seresnext50");
  const drRecord = getModel("fundus-dr-grading-effb0");
  const octRecord = getModel("oct-retinal-weights-fp32");
  const lesionPackagePresent = researchPackagePresent(lesionRecord);
  const drPackagePresent = researchPackagePresent(drRecord);
  const octPackagePresent = researchPackagePresent(octRecord);
  const researchProviderAvailable = canonicalInputModality === "FUNDUS"
    ? lesionPackagePresent || drPackagePresent
    : canonicalInputModality === "OCT" ? octPackagePresent : false;
  // Select a real modality-specific registry record for the primary gate only
  // when at least one applicable research package is installed. Otherwise the
  // explicit DEMO registry record is used and its strict OOD/device wording
  // remains intact for legacy/demo-only deployments.
  const primaryResearchRecord = canonicalInputModality === "FUNDUS"
    ? (lesionPackagePresent ? lesionRecord : drPackagePresent ? drRecord : null)
    : canonicalInputModality === "OCT" && octPackagePresent ? octRecord : null;
  const modelRecord = primaryResearchRecord ?? getModel("demo-fundus-synthetic-v0");
  const deviceInfo = study.metadata.manufacturer || study.metadata.model
    ? { manufacturer: study.metadata.manufacturer, model: study.metadata.model }
    : null;
  // device is passed explicitly (per-study execution gate) so a non-DEMO
  // model with incompatible/undeclared device support is hard-blocked here,
  // the same point modality already is - device is informational-only for
  // DEMO, which is unaffected by this check (see gateModelUse's doc comment).
  const modelGate = modelRecord
    ? (modelRecord.status === "DEMO" ? gateModelUse(modelRecord, deviceInfo) : gateModelUse(modelRecord))
    : null;
  const ood = assessOod({
    modality: study.modality,
    quality,
    model: modelRecord,
    device: deviceInfo,
    metadataProvided: study.metadata.providedBy !== "none",
    deviceUnknownIsDomainUnknown: modelRecord?.status !== "DEMO",
  });

  const modelsAttempted = new Set<string>();
  const modelsExecuted = new Set<string>();
  const modelsFailed = new Set<string>();
  const modelsSkipped = new Map<string, string>();
  const artifactHashes: Record<string, string | null> = {};
  const artifactVerification: Record<string, "EXPECTED_REGISTRY_HASH" | "VERIFIED" | "FAILED" | "UNAVAILABLE"> = {};
  const modelVersions: Record<string, string> = {};
  const modelRuntimeMs = new Map<string, number>();
  const modelStartedAt = new Map<string, number>();
  // ROI timings are kept separately from the model aggregate so a clinician
  // can see which source-page crop was actually processed.  A failed or
  // gated ROI remains in the ledger with a zero runtime and an explicit
  // status; zero never means that the model was fast.
  const roiRuntimeMs = new Map<string, number>();
  const roiQualityStatus = new Map<string, string>();
  const roiDomainStatus = new Map<string, string>();
  const roiSkipReason = new Map<string, string>();
  const markModel = (record: ReturnType<typeof getModel>, state: "attempted" | "executed" | "failed" | "skipped", reason?: string) => {
    if (!record) return;
    modelVersions[record.model_id] = record.version;
    artifactHashes[record.model_id] = record.sha256;
    artifactVerification[record.model_id] = record.sha256 ? "EXPECTED_REGISTRY_HASH" : "UNAVAILABLE";
    if (state === "attempted") {
      modelsAttempted.add(record.model_id);
      modelStartedAt.set(record.model_id, Date.now());
    }
    if (state === "executed") {
      modelsAttempted.add(record.model_id); modelsExecuted.add(record.model_id);
      const started = modelStartedAt.get(record.model_id);
      if (started !== undefined) modelRuntimeMs.set(record.model_id, (modelRuntimeMs.get(record.model_id) ?? 0) + Math.max(0, Date.now() - started));
      modelStartedAt.delete(record.model_id);
    }
    if (state === "failed") {
      modelsAttempted.add(record.model_id); modelsFailed.add(record.model_id);
      const started = modelStartedAt.get(record.model_id);
      if (started !== undefined) modelRuntimeMs.set(record.model_id, (modelRuntimeMs.get(record.model_id) ?? 0) + Math.max(0, Date.now() - started));
      modelStartedAt.delete(record.model_id);
    }
    if (state === "skipped") modelsSkipped.set(record.model_id, reason ?? "not eligible");
  };
  const markArtifactVerification = (modelId: string, trusted: boolean) => { artifactVerification[modelId] = trusted ? "VERIFIED" : "FAILED"; };

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
  const lesionGate = lesionRecord ? gateModelUse(lesionRecord) : null;
  if (
    qualityAcceptable &&
    canonicalModality(study.modality) === "FUNDUS" &&
    lesionPackagePresent &&
    lesionRecord &&
    lesionGate?.allowed &&
    supportsModality(lesionRecord, study.modality)
  ) {
    markModel(lesionRecord, "attempted");
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
        // OOD from unavailable). Research-scoped failures never fall through
        // to synthetic DEMO output; the reason is retained in provenance.
        researchAttemptNote = run.notes[0] ?? "Research lesion detector failed; no finding was inferred.";
        markModel(lesionRecord, "failed", researchAttemptNote);
      } else {
        researchRun = run;
        markModel(lesionRecord, "executed");
        markArtifactVerification(lesionRecord.model_id, run.integrity.trusted);
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
      markModel(lesionRecord, "failed", researchAttemptNote);
    }
  } else if (canonicalModality(study.modality) === "FUNDUS" && qualityAcceptable && lesionRecord && !lesionGate?.allowed) {
    researchAttemptNote = `Research lesion detector gated off: ${(lesionGate?.reasons ?? ["unknown reason"]).join(" ").slice(0, 200)}`;
    markModel(lesionRecord, "skipped", researchAttemptNote);
  } else if (canonicalModality(study.modality) === "FUNDUS" && lesionRecord) {
    markModel(lesionRecord, "skipped", !lesionPackagePresent
      ? "research package/runtime unavailable on this deployment"
      : qualityAcceptable ? "content/modality gate did not match" : "quality gate failed");
  }

  // ---- Stage 1d: research DR grade estimation (before any disease reasoning) ----
  // Same scoping and honesty rules as Stage 1c: FUNDUS + quality-pass input
  // only, IMAGE_ONLY model so device metadata is disclosed (not gated), and
  // any worker failure keeps the original quality/OOD verdict with no
  // synthetic fallback. Runs after the lesion detector (sequentially, never
  // stacked in RAM) so the two research outputs can corroborate or disagree.
  let drAssessment = unavailableDrAssessmentResult(quality, ood, study.modality);
  let drRun: DrGradeResearchRun | null = null;
  let drAttemptNote: string | null = null;
  const drGate = drRecord ? gateModelUse(drRecord) : null;
  const researchScopeOk =
    qualityAcceptable &&
    canonicalModality(study.modality) === "FUNDUS" &&
    drPackagePresent &&
    drRecord &&
    drGate?.allowed &&
    supportsModality(drRecord, study.modality);
  if (researchScopeOk) {
    markModel(drRecord, "attempted");
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
        markModel(drRecord, "failed", drAttemptNote);
      } else {
        drRun = run;
        markModel(drRecord, "executed");
        markArtifactVerification(drRecord.model_id, run.integrity.trusted);
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
      markModel(drRecord, "failed", drAttemptNote);
    }
  } else if (canonicalModality(study.modality) === "FUNDUS" && qualityAcceptable && drRecord && !drGate?.allowed) {
    drAttemptNote = `Research DR grader gated off: ${(drGate?.reasons ?? ["unknown reason"]).join(" ").slice(0, 200)}`;
    markModel(drRecord, "skipped", drAttemptNote);
  } else if (canonicalModality(study.modality) === "FUNDUS" && drRecord) {
    markModel(drRecord, "skipped", !drPackagePresent
      ? "research package/runtime unavailable on this deployment"
      : qualityAcceptable ? "content/modality gate did not match" : "quality gate failed");
  }

  // ---- Stage 1e: research OCT classification (native OCT + PDF B-scan ROIs) ----
  // The classifier receives only validated OCT B-scan bytes. Report pages,
  // tables, logos, thickness maps, and whole-page screenshots are never sent.
  let octAssessment = unavailableOctAssessmentResult(quality, ood, study.modality);
  let octRun: OctResearchRun | null = null;
  let octAttemptNote: string | null = null;
  const octGate = octRecord ? gateModelUse(octRecord) : null;
  const octRegionResults: NonNullable<AnalysisResult["oct_region_results"]> = [];
  const octRegionFindings: Finding[] = [];
  const octRegionRuns: OctResearchRun[] = [];
  const octScopeOk =
    qualityAcceptable &&
    canonicalModality(study.modality) === "OCT" &&
    octPackagePresent &&
    octRecord &&
    octGate?.allowed &&
    supportsModality(octRecord, study.modality);
  if (octScopeOk) {
    markModel(octRecord, "attempted");
    try {
      const { runOctResearchAnalysis } = await import("../models/octLocalProvider");
      const run = await runOctResearchAnalysis(study, {
        qualityScore: quality.quality_score,
        eye: study.eye,
        device: deviceInfo,
        imageBytes: originalBytes,
      });
      if (run.raw.inference_status !== "completed" || !run.oct) {
        octAttemptNote = run.notes[0] ?? "Research OCT classifier failed; no class was estimated.";
        markModel(octRecord, "failed", octAttemptNote);
      } else {
        octRun = run;
        markModel(octRecord, "executed");
        markArtifactVerification(octRecord.model_id, run.integrity.trusted);
        const octOod = assessOod({
          modality: study.modality,
          quality,
          model: octRecord,
          device: deviceInfo,
          metadataProvided: study.metadata.providedBy !== "none",
          deviceUnknownIsDomainUnknown: true,
        });
        octAssessment = resultFromResearchOct({
          oct: octRun.oct,
          raw: octRun.raw,
          quality,
          ood: octOod,
          modelId: octRecord.model_id,
          modelVersion: octRecord.version,
        });
      }
    } catch (err) {
      octRun = null;
      octAttemptNote = `Research OCT classifier could not run: ${String(err instanceof Error ? err.message : err).slice(0, 200)}`;
      markModel(octRecord, "failed", octAttemptNote);
    }
  } else if (canonicalModality(study.modality) === "OCT" && qualityAcceptable && octRecord && !octGate?.allowed) {
    octAttemptNote = `Research OCT classifier gated off: ${(octGate?.reasons ?? ["unknown reason"]).join(" ").slice(0, 200)}`;
    markModel(octRecord, "skipped", octAttemptNote);
  } else if (canonicalModality(study.modality) === "OCT" && octRecord) {
    markModel(octRecord, "skipped", !octPackagePresent
      ? "research package/runtime unavailable on this deployment"
      : qualityAcceptable ? "content/modality gate did not match" : "quality gate failed");
  }

  // PDF-derived B-scans are independent assets. A fundus primary study may
  // therefore produce a mixed research result without changing the primary
  // study modality or mixing laterality.
  if (octPackagePresent && octRecord && octGate?.allowed && (input.document_assets?.length ?? 0) > 0) {
    const { runOctResearchAnalysis } = await import("../models/octLocalProvider");
    for (const asset of input.document_assets ?? []) {
      if (asset.content_type !== "OCT_BSCAN" || asset.modality !== "OCT") continue;
      const roiStartedAt = Date.now();
      // B-scan sidecars are bounded strips (often 512x128 or similar), so
      // apply the explicit OCT ROI profile instead of the whole-fundus
      // 512x512 minimum. Other quality checks remain identical and the
      // profile is disclosed as an unvalidated engineering threshold.
      const roiQuality = await assessOctBscanQuality(asset.bytes);
      roiQualityStatus.set(asset.asset_id, roiQuality.quality_status);
      const base = { asset_id: asset.asset_id, document_id: asset.document_id, page: asset.page, laterality: asset.eye, source_page_hash: asset.source_page_hash, roi_hash: asset.roi_hash, content_type: "OCT_BSCAN" as const };
      if (roiQuality.quality_status !== "pass") {
        roiRuntimeMs.set(asset.asset_id, Math.max(0, Date.now() - roiStartedAt));
        roiDomainStatus.set(asset.asset_id, "DOMAIN_VALIDATION_UNKNOWN");
        roiSkipReason.set(asset.asset_id, `quality gate failed: ${roiQuality.quality_status}`);
        octRegionResults.push({ ...base, status: "SKIPPED", note: `ROI quality gate failed (${roiQuality.quality_status}; ${roiQuality.detected_artifacts.join(", ") || "unspecified"}); no OCT inference attempted.` });
        continue;
      }
      const roiOod = assessOod({ modality: "oct", quality: roiQuality, model: octRecord, device: deviceInfo, metadataProvided: study.metadata.providedBy !== "none", deviceUnknownIsDomainUnknown: true, resolutionProfile: "oct_bscan" });
      roiDomainStatus.set(asset.asset_id, roiOod.detected ? "OUT_OF_DISTRIBUTION" : "DOMAIN_VALIDATION_UNKNOWN");
      if (roiOod.detected) {
        roiRuntimeMs.set(asset.asset_id, Math.max(0, Date.now() - roiStartedAt));
        roiSkipReason.set(asset.asset_id, `out-of-distribution: ${roiOod.reasons.join(" ").slice(0, 180)}`);
        octRegionResults.push({ ...base, status: "SKIPPED", note: `ROI OOD gate: ${roiOod.reasons.join(" ").slice(0, 240)}` });
        continue;
      }
      markModel(octRecord, "attempted");
      try {
        const roiStudy: NormalizedStudy = {
          ...study,
          studyId: `${study.studyId}:${asset.asset_id}`,
          modality: "oct",
          eye: asset.eye,
          files: [],
        };
        const run = await runOctResearchAnalysis(roiStudy, {
          qualityScore: roiQuality.quality_score,
          eye: asset.eye,
          device: deviceInfo,
          imageBytes: asset.bytes,
          cacheProvenance: { contentHash: asset.source_page_hash, roiHash: asset.roi_hash },
        });
        if (run.raw.inference_status !== "completed" || !run.oct) {
          markModel(octRecord, "failed", run.notes[0] ?? "OCT ROI classifier failed");
          roiRuntimeMs.set(asset.asset_id, Math.max(0, Date.now() - roiStartedAt));
          roiSkipReason.set(asset.asset_id, run.notes[0] ?? "OCT ROI classifier failed");
          octRegionResults.push({ ...base, status: "FAILED", note: run.notes[0] ?? "OCT ROI classifier failed" });
          continue;
        }
        markModel(octRecord, "executed");
        roiRuntimeMs.set(asset.asset_id, Math.max(0, Date.now() - roiStartedAt));
        markArtifactVerification(octRecord.model_id, run.integrity.trusted);
        octRegionRuns.push(run);
        const assessment = resultFromResearchOct({ oct: run.oct, raw: run.raw, quality: roiQuality, ood: roiOod, modelId: octRecord.model_id, modelVersion: octRecord.version });
        octRegionResults.push({ ...base, status: "EXECUTED", assessment });
        const roiFindings = run.findings.map((finding) => ({ ...finding, source_modality: "OCT", source_asset_id: asset.asset_id, source_page: asset.page, laterality: asset.eye }));
        octRegionFindings.push(...roiFindings);
      } catch (err) {
        const note = `OCT ROI classifier could not run: ${String(err instanceof Error ? err.message : err).slice(0, 200)}`;
        markModel(octRecord, "failed", note);
        roiRuntimeMs.set(asset.asset_id, Math.max(0, Date.now() - roiStartedAt));
        roiSkipReason.set(asset.asset_id, note);
        octRegionResults.push({ ...base, status: "FAILED", note });
      }
    }
  } else if ((input.document_assets?.length ?? 0) > 0 && octRecord) {
    for (const asset of input.document_assets ?? []) {
      if (asset.content_type === "OCT_BSCAN") {
        roiQualityStatus.set(asset.asset_id, qualityAcceptable ? "not_assessed" : quality.quality_status);
        roiDomainStatus.set(asset.asset_id, "DOMAIN_VALIDATION_UNKNOWN");
        roiSkipReason.set(asset.asset_id, "OCT registry gate unavailable.");
        octRegionResults.push({ asset_id: asset.asset_id, document_id: asset.document_id, page: asset.page, laterality: asset.eye, source_page_hash: asset.source_page_hash, roi_hash: asset.roi_hash, content_type: "OCT_BSCAN", status: "SKIPPED", note: "OCT registry gate unavailable." });
      }
    }
  }

  // ---- Stage 2: anatomical segmentation (placeholder) ----
  // Emits no structures or measurements. Recorded for provenance.

  // ---- Stage 3: specialized detectors ----
  // Fundus/OCT studies use REAL research output when it completes; unsupported
  // modalities retain the labeled DEMO behavior, while research failures stay
  // explicit and never receive a synthetic substitute.
  // When both research models complete, both contribute findings (each keeps
  // its own model provenance); the lesion detector remains the primary
  // registry model because it localizes.
  let findings: Finding[] = [];
  let activeModelRecord = modelRecord;
  let activeModelGate = modelGate;
  const usedLesionResearch = !!researchRun && researchRun.raw.inference_status === "completed";
  const usedDrResearch = !!drRun && drRun.raw.inference_status === "completed" && !!drRun.grade;
  const usedOctResearch = (!!octRun && octRun.raw.inference_status === "completed" && !!octRun.oct) || octRegionRuns.length > 0;
  const usedResearch = usedLesionResearch || usedDrResearch || usedOctResearch;
  const tagResearch = (list: Finding[], modality = study.modality) =>
    list.flatMap((f) => {
      const gate = mayEmitFinding(f.type, canonicalModality(modality), "RESEARCH");
      if (!gate.ok) return []; // refuse to emit a finding the taxonomy forbids
      return [{ ...f, taxonomy_level: "observation" as const, model_status: "RESEARCH" as const, source_modality: f.source_modality ?? modality }];
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
  if (octRun && octRecord && octGate) {
    if (!usedLesionResearch && !usedDrResearch) {
      activeModelRecord = octRecord;
      activeModelGate = octGate;
    }
    findings = [...findings, ...tagResearch(octRun.findings, "oct")];
  }
  if (octRegionRuns.length > 0) {
    if (octRegionFindings.length > 0) findings = [...findings, ...tagResearch(octRegionFindings, "oct")];
    if (!usedLesionResearch && !usedDrResearch && !octRun && octRecord && octGate) {
      activeModelRecord = octRecord;
      activeModelGate = octGate;
    }
  }
  // Demo is available only when no applicable research package/runtime is
  // installed (or the modality is unsupported). Once a research provider is
  // installed, a provider failure is represented as MODEL_FAILED with no
  // fabricated findings.
  const researchModality = canonicalInputModality === "FUNDUS" || canonicalInputModality === "OCT";
  const researchApplicable = researchModality && researchProviderAvailable;
  const unroutedImage = routedAsset.container_type === "IMAGE" &&
    (routedAsset.modality_state === "MODALITY_UNKNOWN" || researchModalityConflict);
  let demoUsed = false;
  if (!usedResearch && !researchApplicable && !unroutedImage && qualityAcceptable && modelGate?.allowed) {
    demoUsed = true;
    markModel(modelRecord, "attempted");
    markModel(modelRecord, "executed");
    const scenario = pickDemoScenario(originalBytes);
    findings = buildDemoFindings(scenario, quality.quality_score);
    // Taxonomy + provenance tagging; enforce taxonomy/modality/status rules.
    findings = findings.flatMap((f) => {
      const gate = mayEmitFinding(f.type, canonicalModality(study.modality), modelRecord!.status);
      if (!gate.ok) return []; // refuse to emit a finding the taxonomy forbids
      return [{ ...f, taxonomy_level: "observation" as const, model_status: modelRecord!.status }];
    });
  }
  if (researchModalityConflict) {
    if (declaredCanonical === "FUNDUS") {
      if (lesionRecord) markModel(lesionRecord, "skipped", "declared fundus conflicts with server OCT content route");
      if (drRecord) markModel(drRecord, "skipped", "declared fundus conflicts with server OCT content route");
    } else if (declaredCanonical === "OCT" && octRecord) {
      markModel(octRecord, "skipped", "declared OCT conflicts with server fundus content route");
    }
  }
  const failedResearch = modelsFailed.size > 0 && !usedResearch;
  const analysisMode: AnalysisResult["analysis_mode"] = usedResearch && demoUsed
    ? "MIXED_RESEARCH_AND_DEMO"
    : usedResearch ? "RESEARCH_MODEL_ANALYSIS"
      : demoUsed ? "DEMO_ONLY"
        : failedResearch ? "MODEL_FAILED" : "NO_MODEL_EXECUTED";
  if (!usedResearch && !demoUsed && unroutedImage) {
    // A real image whose pixels cannot be classified is not a safe DEMO
    // candidate. Preserve the asset and report an explicit no-model state.
    activeModelRecord = null;
    activeModelGate = null;
  }
  if (!usedResearch && researchApplicable && modelsAttempted.size === 0) {
    if (canonicalInputModality === "FUNDUS") {
      if (lesionRecord) markModel(lesionRecord, "skipped", qualityAcceptable ? "research model not eligible" : "quality gate failed");
      if (drRecord) markModel(drRecord, "skipped", qualityAcceptable ? "research model not eligible" : "quality gate failed");
    } else if (canonicalInputModality === "OCT" && octRecord) {
      markModel(octRecord, "skipped", qualityAcceptable ? "research model not eligible" : "quality gate failed");
    }
  }

  // ---- Stage 3b: row-oriented execution ledger -------------------------
  // The legacy model_execution arrays are intentionally retained for API
  // compatibility, but they cannot answer the clinician's most important
  // question: which model saw which immutable asset/ROI, under which quality
  // and domain gates, and what actually happened.  Build the authoritative
  // rows only from server state collected above; the browser never supplies
  // any of these values.
  const primaryAssetId = study.files[0]?.id ?? routedAsset.source_hash;
  const primaryDependencyGroup = `image:${study.studyId}:${routedAsset.source_hash}`;
  const primaryLaterality: ModelExecutionLedgerEntry["laterality"] =
    study.eye === "OD" || study.eye === "OS" ? study.eye : "unknown";
  const primaryDomainStatus = ood.detected
    ? "OUT_OF_DISTRIBUTION"
    : routedAsset.domain_state === "IN_DOMAIN"
      ? "IN_DOMAIN_UNVALIDATED"
      : routedAsset.domain_state;
  const packageByModel = new Map<string, boolean>([
    [lesionRecord?.model_id ?? "", lesionPackagePresent],
    [drRecord?.model_id ?? "", drPackagePresent],
    [octRecord?.model_id ?? "", octPackagePresent],
  ]);
  const expectedModalityByModel = new Map<string, "FUNDUS" | "OCT">([
    [lesionRecord?.model_id ?? "", "FUNDUS"],
    [drRecord?.model_id ?? "", "FUNDUS"],
    [octRecord?.model_id ?? "", "OCT"],
  ]);
  const gateByModel = new Map<string, ReturnType<typeof gateModelUse> | null>([
    [lesionRecord?.model_id ?? "", lesionGate],
    [drRecord?.model_id ?? "", drGate],
    [octRecord?.model_id ?? "", octGate],
  ]);
  const reasonToStatus = (reason: string): ModelExecutionStatus => {
    if (/quality/i.test(reason)) return "BLOCKED_QUALITY";
    if (/ood|out.of.distribution|domain/i.test(reason)) return "BLOCKED_OOD";
    if (/modality|content route|unsupported/i.test(reason)) return "UNSUPPORTED_MODALITY";
    if (/unavailable|package|runtime|not installed/i.test(reason)) return "UNAVAILABLE";
    return "SKIPPED";
  };
  const primaryLedgerStatus = (record: NonNullable<ReturnType<typeof getModel>>, expected: "FUNDUS" | "OCT"): { status: ModelExecutionStatus; reason: string | null } => {
    const skippedReason = modelsSkipped.get(record.model_id);
    if (modelsExecuted.has(record.model_id) && !modelsFailed.has(record.model_id)) return { status: "EXECUTED", reason: null };
    if (modelsFailed.has(record.model_id)) return { status: "FAILED", reason: skippedReason ?? "Model execution failed closed." };
    if (skippedReason) return { status: reasonToStatus(skippedReason), reason: skippedReason };
    if (canonicalInputModality !== expected) return { status: "UNSUPPORTED_MODALITY", reason: `Input modality ${canonicalInputModality ?? "unknown"} is not supported by this model.` };
    if (!qualityAcceptable) return { status: "BLOCKED_QUALITY", reason: `Quality gate status was ${quality.quality_status}.` };
    if (ood.detected) return { status: "BLOCKED_OOD", reason: ood.message || "Input was flagged out of distribution." };
    if (!packageByModel.get(record.model_id)) return { status: "UNAVAILABLE", reason: "Model package/runtime unavailable on this deployment." };
    if (!gateByModel.get(record.model_id)?.allowed) return { status: "SKIPPED", reason: "Model registry gate did not allow execution." };
    return { status: "UNAVAILABLE", reason: "No completed server execution was recorded." };
  };
  const ledgerRows: ModelExecutionLedgerEntry[] = [];
  const addPrimaryLedger = (record: ReturnType<typeof getModel>, expected: "FUNDUS" | "OCT", task: string) => {
    if (!record) return;
    const outcome = primaryLedgerStatus(record, expected);
    const eligible = canonicalInputModality === expected && qualityAcceptable && !ood.detected && !!packageByModel.get(record.model_id) && !!gateByModel.get(record.model_id)?.allowed;
    ledgerRows.push({
      model_id: record.model_id,
      model_version: record.version,
      task,
      artifact_hash: record.sha256,
      input_asset_id: primaryAssetId,
      input_roi_id: null,
      laterality: primaryLaterality,
      eligibility: canonicalInputModality === expected ? (eligible ? "ELIGIBLE" : "INELIGIBLE") : "NOT_APPLICABLE",
      execution_status: outcome.status,
      skip_reason: outcome.reason,
      quality_status: quality.quality_status,
      domain_status: primaryDomainStatus,
      runtime_ms: Math.max(0, modelRuntimeMs.get(record.model_id) ?? 0),
      output_contract_version: modelsAttempted.has(record.model_id) ? OUTPUT_CONTRACT_VERSION : null,
      validation_status: record.status,
      dependency_group_id: primaryDependencyGroup,
    });
  };
  addPrimaryLedger(lesionRecord, "FUNDUS", "fundus_lesion_localization");
  addPrimaryLedger(drRecord, "FUNDUS", "diabetic_retinopathy_grading");
  addPrimaryLedger(octRecord, "OCT", "oct_classification");
  if (demoUsed && modelRecord && modelRecord.status === "DEMO") {
    ledgerRows.push({
      model_id: modelRecord.model_id,
      model_version: modelRecord.version,
      task: "synthetic_demo_pipeline",
      artifact_hash: modelRecord.sha256,
      input_asset_id: primaryAssetId,
      input_roi_id: null,
      laterality: primaryLaterality,
      eligibility: "ELIGIBLE",
      execution_status: "EXECUTED",
      skip_reason: null,
      quality_status: quality.quality_status,
      domain_status: primaryDomainStatus,
      runtime_ms: Math.max(0, modelRuntimeMs.get(modelRecord.model_id) ?? 0),
      output_contract_version: null,
      validation_status: modelRecord.status,
      dependency_group_id: primaryDependencyGroup,
    });
  }
  for (const region of octRegionResults) {
    const record = octRecord;
    if (!record) continue;
    const regionReason = roiSkipReason.get(region.asset_id) ?? (region.status === "FAILED" ? region.note ?? "OCT ROI classifier failed." : null);
    const regionStatus: ModelExecutionStatus = region.status === "EXECUTED"
      ? "EXECUTED"
      : region.status === "FAILED" ? "FAILED"
        : reasonToStatus(regionReason ?? "ROI was skipped.");
    const regionQuality = roiQualityStatus.get(region.asset_id) ?? (qualityAcceptable ? "not_assessed" : quality.quality_status);
    const regionDomain = roiDomainStatus.get(region.asset_id) ?? "DOMAIN_VALIDATION_UNKNOWN";
    ledgerRows.push({
      model_id: record.model_id,
      model_version: record.version,
      task: "oct_classification",
      artifact_hash: record.sha256,
      input_asset_id: region.asset_id,
      input_roi_id: region.asset_id,
      laterality: region.laterality,
      eligibility: regionStatus === "UNSUPPORTED_MODALITY" ? "NOT_APPLICABLE" : regionStatus === "EXECUTED" ? "ELIGIBLE" : "INELIGIBLE",
      execution_status: regionStatus,
      skip_reason: regionStatus === "EXECUTED" ? null : regionReason,
      quality_status: regionQuality,
      domain_status: regionDomain,
      runtime_ms: Math.max(0, roiRuntimeMs.get(region.asset_id) ?? 0),
      output_contract_version: regionStatus === "EXECUTED" || regionStatus === "FAILED" ? OUTPUT_CONTRACT_VERSION : null,
      validation_status: record.status,
      dependency_group_id: `document:${region.document_id}:page:${region.page}:roi:${region.roi_hash}`,
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
    const onlyModel = usedLesionResearch ? "lesion detector" : usedDrResearch ? "DR grader" : "OCT classifier";
    multiModelNotes.push(
      `Only one research model completed (${onlyModel}); no cross-model agreement statement is possible.`
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
    analysis_mode: analysisMode,
    asset_routing: routedAsset,
    document_routing: input.document_routing,
    model_execution: {
      models_attempted: [...modelsAttempted],
      models_executed: [...modelsExecuted],
      models_failed: [...modelsFailed],
      models_skipped: [...modelsSkipped.entries()].map(([model_id, reason]) => ({ model_id, reason })),
      artifact_hashes: artifactHashes,
      artifact_verification: artifactVerification,
      model_versions: modelVersions,
      runtime_status: modelsFailed.size > 0 && modelsExecuted.size > 0 ? "COMPLETED_WITH_FAILURES" : modelsFailed.size > 0 ? "FAILED_OR_UNAVAILABLE" : modelsExecuted.size > 0 ? "COMPLETED" : "NOT_RUN",
    },
    model_execution_ledger: ledgerRows,
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
    oct_assessment: octAssessment,
    oct_region_results: octRegionResults.length ? octRegionResults : undefined,
    oct_aggregation: octRegionResults.length
      ? (() => {
          const classes = octRegionResults.map((r) => r.assessment?.predicted_class).filter((x): x is string => !!x);
          if (classes.length === 0) return "INSUFFICIENT_SCAN_QUALITY" as const;
          return new Set(classes).size === 1 ? "CONSISTENT_TARGET_CLASS" as const : "MIXED_OCT_CLASS_RESULTS" as const;
        })()
      : undefined,
    multi_model: {
      performed: usedLesionResearch || usedDrResearch || usedOctResearch,
      agreement: multiModelAgreement,
      models: [
        ...(usedLesionResearch && researchRun
          ? [{ model_id: researchRun.model.model_id, model_version: researchRun.model.version, model_status: researchRun.model.status, output_summary: `${researchRun.findings.length} lesion-like region(s)` }]
          : []),
        ...(usedDrResearch && drRun && drRun.grade
          ? [{ model_id: drRun.model.model_id, model_version: drRun.model.version, model_status: drRun.model.status, output_summary: `grade ${drRun.grade.predicted_grade}/4 (${drRun.grade.grade_label}), referable=${drRun.grade.referable_dr}` }]
          : []),
        ...(usedOctResearch && octRun && octRun.oct
          ? [{ model_id: octRun.model.model_id, model_version: octRun.model.version, model_status: octRun.model.status, output_summary: `class ${octRun.oct.predicted_class} (backbone argmax, uncalibrated)` }]
          : []),
        ...(octRegionRuns.length > 0 && octRecord
          ? [{ model_id: octRecord.model_id, model_version: octRecord.version, model_status: octRecord.status, output_summary: `${octRegionRuns.length} PDF OCT B-scan ROI(s) classified` }]
          : []),
      ],
      notes: multiModelNotes,
    },
    model_registry: {
      model_id: activeModelRecord?.model_id ?? "none",
      model_version: activeModelRecord?.version ?? "none",
      model_status: activeModelRecord?.status ?? "NONE",
      display_label: activeModelGate?.label ?? (demoUsed ? DEMO_LABEL : null),
      integrity_checks: [
        { check: "registry", passed: !!activeModelRecord, detail: activeModelRecord ? "Registered model in use." : "No registered model." },
        (() => {
          const primaryRun = researchRun ?? drRun ?? octRun ?? octRegionRuns[0];
          return usedResearch && primaryRun
            ? { check: "artifact", passed: primaryRun.integrity.trusted, detail: primaryRun.integrity.checks.map((c) => `${c.check}:${c.passed ? "pass" : "FAIL"}`).join(" ") || "Research artifact integrity verification." }
            : demoUsed
              ? { check: "artifact", passed: true, detail: "DEMO model has no artifact by design; deterministic synthetic output is explicitly labeled." }
              : { check: "artifact", passed: false, detail: "No research execution artifact was produced for this attempt." };
        })(),
        { check: "status_gate", passed: !!activeModelGate?.allowed, detail: activeModelGate ? activeModelGate.reasons.join(" ") || (usedResearch ? "Status permits research use only." : "Status permits demo use only.") : "No gate result." },
        ...(researchAttemptNote ? [{ check: "research_detector_attempt" as const, passed: false, detail: researchAttemptNote }] : []),
        ...((researchRun?.notes ?? []).map((n) => ({ check: "research_detector_note" as const, passed: true, detail: n.slice(0, 300) }))),
        ...(drAttemptNote ? [{ check: "dr_grader_attempt" as const, passed: false, detail: drAttemptNote }] : []),
        ...((drRun?.notes ?? []).map((n) => ({ check: "dr_grader_note" as const, passed: true, detail: n.slice(0, 300) }))),
        ...(octAttemptNote ? [{ check: "oct_classifier_attempt" as const, passed: false, detail: octAttemptNote }] : []),
        ...((octRun?.notes ?? []).map((n) => ({ check: "oct_classifier_note" as const, passed: true, detail: n.slice(0, 300) }))),
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
      synthetic_result: demoUsed,
      label: demoUsed ? DEMO_LABEL : (activeModelGate?.label ?? VALIDATION_STATUS_BANNER),
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
        demoUsed ? DEMO_LABEL : (activeModelGate?.label ?? VALIDATION_STATUS_BANNER),
        "This system is a screening/decision-support architecture. It does not establish diagnoses. Only a qualified eye-care professional can diagnose eye disease.",
        "A negative automated result does not guarantee that no eye disease is present.",
      ],
      blocked_claims: [],
    },
  };

  analysis.claim_ledger = buildClaimLedger(analysis);

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

function unsupportedResult(study: NormalizedStudy, note: string, assetRouting?: AssetRoutingResult): PipelineOutput {
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
    analysis_mode: "NO_MODEL_EXECUTED",
    asset_routing: assetRouting ?? study.asset_routing,
    model_execution: {
      models_attempted: [], models_executed: [], models_failed: [],
      models_skipped: [{ model_id: "all", reason: "unsupported format" }], artifact_hashes: {}, model_versions: {}, runtime_status: "NOT_RUN",
    },
    model_execution_ledger: [{
      model_id: "none",
      model_version: "none",
      task: "asset_validation",
      artifact_hash: null,
      input_asset_id: assetRouting?.source_hash ?? "unknown-asset",
      input_roi_id: null,
      laterality: study.eye === "OD" || study.eye === "OS" ? study.eye : "unknown",
      eligibility: "NOT_APPLICABLE",
      execution_status: "UNSUPPORTED_MODALITY",
      skip_reason: note,
      quality_status: "not_assessed",
      domain_status: assetRouting?.domain_state ?? "NOT_ASSESSED",
      runtime_ms: 0,
      output_contract_version: null,
      validation_status: "NOT_VALIDATED",
      dependency_group_id: `asset:${assetRouting?.source_hash ?? study.studyId}`,
    }],
    quality: { score: 0, acceptable: false, status: "fail", artifacts: ["unsupported_format"], affected_regions: [], recommended_reacquisition: false },
    segmentation: { implemented: false, note: "Not performed." },
    findings: [],
    uncertainty: { overall: 1, reasons: [note] },
    recommendation: { priority: triage.priority, action: triage.action, rationale: triage.rationale },
    ensemble: { performed: false, checks: [], note: "Not performed." },
    demo: { synthetic_result: false, label: DEMO_LABEL },
    model_registry: {
      model_id: "none",
      model_version: "none",
      model_status: "NONE",
      display_label: null,
      integrity_checks: [{ check: "container", passed: false, detail: note }],
      device_compatibility: { compatible: false, note: "No model was eligible for this asset." },
      model_input: "IMAGE_ONLY",
    },
    diagnosis_gate: (() => {
      const g = unvalidatedGateResult();
      return { allowed: g.allowed, reasons: g.reasons, clinical_interpretation: g.clinicalInterpretation };
    })(),
    provenance: { models: modelProvenance(["quality"]), ruleset_version: RULESET_VERSION, analyzed_at: new Date().toISOString(), input_dimensions: { width: 0, height: 0 }, pipeline_version: PIPELINE_VERSION },
    safety: { quality_gate_enforced: true, disclaimers: [VALIDATION_STATUS_BANNER], blocked_claims: [] },
  };
  return { analysis, quality: qualityStub, triage, validationErrors: [] };
}
