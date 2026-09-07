/**
 * Strict Model Registry (Phase 2).
 *
 * HONESTY RULES (non-negotiable):
 *  - A model file on disk is NEVER trusted by its existence alone.
 *  - Validation status comes ONLY from registry records with recorded
 *    evidence references. Developers cannot type "validated=true" without
 *    an evidence reference (validation run id / external dataset id).
 *  - The DEMO detector produces synthetic output only. The fundus lesion
 *    checkpoint (status RESEARCH) runs real local inference from a
 *    hash-verified package; its output is uncalibrated research observations
 *    only, never clinical findings.
 */

import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { MODEL_ROOT } from "../config";
import { SUPPORTED_MODALITIES, Modality } from "./modalities";

// ---------------------------------------------------------------------------
// Statuses
// ---------------------------------------------------------------------------

export type ModelStatus =
  | "DEMO"                  // synthetic output, pipeline exercise only
  | "RESEARCH"              // research use only, no clinical claims
  | "INTERNAL_VALIDATION"   // evaluated on internal held-out data
  | "EXTERNALLY_VALIDATED"  // evaluated on independent external dataset
  | "CLINICALLY_VALIDATED"  // full clinical validation evidence recorded
  | "RETIRED";              // must never be loaded for new analyses

/** What each status unlocks. Clinical deployment requires explicit config + CLINICALLY_VALIDATED. */
export const STATUS_CAPABILITIES: Record<ModelStatus, {
  may_produce_findings: boolean;
  findings_use: "demo_only" | "research_only" | "validated_research" | "clinical_deployment" | "none";
  requires_label: string | null;
}> = {
  DEMO:                 { may_produce_findings: true,  findings_use: "demo_only",           requires_label: "DEMO / SYNTHETIC RESULT - NOT FOR CLINICAL USE" },
  RESEARCH:             { may_produce_findings: true,  findings_use: "research_only",       requires_label: "RESEARCH USE ONLY - NOT VALIDATED FOR CLINICAL USE" },
  INTERNAL_VALIDATION:  { may_produce_findings: true,  findings_use: "research_only",       requires_label: "INTERNAL VALIDATION ONLY - NOT EXTERNALLY VALIDATED" },
  EXTERNALLY_VALIDATED: { may_produce_findings: true,  findings_use: "validated_research",  requires_label: "EXTERNALLY VALIDATED - REGULATORY REVIEW REQUIRED FOR CLINICAL USE" },
  CLINICALLY_VALIDATED: { may_produce_findings: true,  findings_use: "clinical_deployment", requires_label: null },
  RETIRED:              { may_produce_findings: false, findings_use: "none",                requires_label: "MODEL RETIRED - MUST NOT BE USED" },
};

// ---------------------------------------------------------------------------
// Registry record
// ---------------------------------------------------------------------------

export interface DatasetDescription {
  name: string;
  version: string;
  size_studies: number | null;
  size_patients: number | null;
  population: string | null;
  devices: string[];
  provenance_reference: string | null; // dataset registry id - required for validation evidence
}

export interface PerformanceMetrics {
  sensitivity: number | null;   // 0..1 or null = not measured
  specificity: number | null;
  ppv: number | null;
  npv: number | null;
  auroc: number | null;
  auprc: number | null;
  calibration: string | null;   // e.g. "ECE 0.03 on external set v2" or null
  evidence_reference: string | null; // evaluation run id - REQUIRED unless all metrics are null
}

export interface DeviceCompatibility {
  manufacturer: string;
  model: string;
  firmware?: string;
  scan_protocol?: string;
  resolution?: string;
  field_of_view?: string;
}

export interface ModelRecord {
  model_id: string;
  model_name: string;
  version: string;
  sha256: string | null;              // checksum of the model artifact; null => nothing on disk
  format: "onnx" | "safetensors" | "pytorch" | "tensorflow" | "tflite" | "remote_api" | "heuristic" | "placeholder" | null;
  file_path: string | null;           // relative to MODEL_ROOT
  modalities: Modality[];             // explicit modality support - empty => cannot run
  supported_anatomy: string[];
  supported_findings: string[];       // taxonomy finding types this model may emit
  intended_use: string;
  contraindications: string[];
  limitations: string[];
  training_dataset: DatasetDescription | null;
  validation_dataset: DatasetDescription | null;
  patient_level_split: boolean | null; // null = unknown/not documented
  performance: PerformanceMetrics;
  validation_date: string | null;      // ISO date of the validation run
  external_validation_status: "none" | "in_progress" | "completed";
  clinical_validation_status: "none" | "in_progress" | "completed";
  regulatory_status: "none" | "research_only" | "registered" | "cleared" | "approved";
  status: ModelStatus;
  devices: DeviceCompatibility[];      // devices the model is validated/allowed for; empty => no device validated
  // ---- Symptom support (Phase 3) ----
  uses_symptoms: boolean;              // false => model input is IMAGE ONLY; correlation runs post-hoc
  input_schema: "IMAGE_ONLY" | "IMAGE_AND_SYMPTOMS";
  supported_symptom_types: string[];   // symptom vocabulary types the model actually accepts
  performance_with_symptoms: PerformanceMetrics | null;   // never assumed - measured experimentally
  performance_without_symptoms: PerformanceMetrics | null;
  // ---- Condition support (Phase 3) ----
  supported_conditions: string[];      // condition taxonomy ids; model cannot claim unregistered conditions
  notes?: string;
}

// ---------------------------------------------------------------------------
// Built-in components (pipeline stages). Existing exports are preserved for
// backward compatibility with the pipeline, admin UI, and provenance output.
// ---------------------------------------------------------------------------

export type ValidationStatus =
  | "not_validated"
  | "internal_validation"
  | "external_validation"
  | "regulatory_cleared";

export interface ComponentDescriptor {
  id: string;
  name: string;
  role: string;
  version: string;
  implementation: "heuristic" | "ml_model" | "placeholder";
  validationStatus: ValidationStatus;
  checksum: string;
  notes?: string;
}

const v = (s: string) => s;

export const COMPONENTS: Record<string, ComponentDescriptor> = {
  qualityGate: {
    id: "quality-gate",
    name: "Image Quality Gate",
    role: "quality",
    version: "0.3.0",
    implementation: "heuristic",
    validationStatus: "not_validated",
    checksum: v("qg-0.3.0-laplacian-illumination-glare-fov"),
    notes: "Deterministic image metrics (sharpness, illumination, clipping, resolution). Thresholds not clinically validated.",
  },
  oodGate: {
    id: "ood-gate",
    name: "Out-of-Distribution Gate",
    role: "quality",
    version: "0.1.0",
    implementation: "heuristic",
    validationStatus: "not_validated",
    checksum: v("ood-0.1.0-modality-metadata-characteristics"),
    notes: "Flags inputs outside declared operating conditions. Not a validated OOD detector.",
  },
  anatomySegmentation: {
    id: "anatomy-segmentation",
    name: "Anatomical Segmentation",
    role: "segmentation",
    version: "0.0.1",
    implementation: "placeholder",
    validationStatus: "not_validated",
    checksum: v("seg-0.0.1-placeholder"),
    notes: "Integration placeholder. No segmentation model installed. Produces no measurements.",
  },
  fundusDetector: {
    id: "fundus-lesion-detector",
    name: "Fundus Lesion Detector",
    role: "detector",
    version: "0.2.0",
    implementation: "ml_model",
    validationStatus: "not_validated",
    checksum: v("fd-0.2.0-lesion-research-provider"),
    notes: "RESEARCH provider (FundusLesionLocalProvider): real local SafeTensors inference, uncalibrated observations only, DEMO fallback when unavailable. NOT clinically validated.",
  },
  vascularAnalyzer: {
    id: "retinal-vascular-analyzer",
    name: "Retinal Vascular Analyzer",
    role: "detector",
    version: "0.0.1",
    implementation: "placeholder",
    validationStatus: "not_validated",
    checksum: v("va-0.0.1-placeholder"),
    notes: "Integration placeholder. Schema prepared (see lib/analysis/taxonomy.ts); no detection implemented.",
  },
  octAnalyzer: {
    id: "oct-analyzer",
    name: "OCT Structural Analyzer",
    role: "detector",
    version: "0.0.1",
    implementation: "placeholder",
    validationStatus: "not_validated",
    checksum: v("oct-0.0.1-placeholder"),
    notes: "Integration placeholder. OCT finding schema prepared; no segmentation or measurements implemented.",
  },
  ensemble: {
    id: "ensemble-check",
    name: "Ensemble / Consistency Check",
    role: "ensemble",
    version: "0.1.0",
    implementation: "heuristic",
    validationStatus: "not_validated",
    checksum: v("ens-0.1.0-agreement-rules"),
    notes: "Agreement logic over detector outputs. With a single DEMO detector it can only report single_model.",
  },
  triage: {
    id: "triage-engine",
    name: "Clinical Triage Engine",
    role: "rules",
    version: "0.2.0",
    implementation: "heuristic",
    validationStatus: "not_validated",
    checksum: v("tri-0.2.0-conservative-rules"),
    notes: "Deterministic conservative ruleset. Engineering-reviewed, NOT clinically validated.",
  },
};

export function componentsForRoles(roles: string[]): ComponentDescriptor[] {
  return Object.values(COMPONENTS).filter((c) => roles.includes(c.role));
}

export function modelProvenance(roles: string[]) {
  return componentsForRoles(roles).map((c) => ({
    model_id: c.id,
    model_name: c.name,
    model_version: c.version,
    checksum: c.checksum,
    implementation: c.implementation,
    validation_status: c.validationStatus,
  }));
}

export const RULESET_VERSION = "clinical-rules-0.2.0";

// ---------------------------------------------------------------------------
// Registered models (the model registry proper).
// data\models\ is intentionally EMPTY: no real model artifact exists.
// ---------------------------------------------------------------------------

export const MODELS: Record<string, ModelRecord> = {
  "demo-fundus-synthetic-v0": {
    model_id: "demo-fundus-synthetic-v0",
    model_name: "Demo Synthetic Fundus Detector",
    version: "0.1.0",
    sha256: null, // no artifact on disk - output is generated deterministically from the image hash
    format: "placeholder",
    file_path: null,
    modalities: ["FUNDUS", "EXTERNAL_EYE"],
    supported_anatomy: ["retina", "macula", "optic_disc"],
    supported_findings: [
      "possible_retinal_hemorrhage",
      "indeterminate_focal_hyperreflective_region",
      "possible_drusen_like_deposit",
    ],
    intended_use: "Software engineering demonstration of the analysis pipeline. Produces synthetic findings to exercise triage, reporting, review, and audit. MUST NOT be used for any clinical purpose.",
    contraindications: [
      "Any clinical use",
      "Any patient-care decision",
      "Research data collection presented as real output",
    ],
    limitations: [
      "Findings are synthetic and do not correspond to image content beyond a deterministic hash bucket.",
      "No sensitivity, specificity, PPV, NPV, AUROC, or calibration has ever been measured.",
      "Not trained on any medical dataset.",
    ],
    training_dataset: null,
    validation_dataset: null,
    patient_level_split: null,
    performance: {
      sensitivity: null, specificity: null, ppv: null, npv: null, auroc: null, auprc: null,
      calibration: null, evidence_reference: null,
    },
    validation_date: null,
    external_validation_status: "none",
    clinical_validation_status: "none",
    regulatory_status: "none",
    status: "DEMO",
    devices: [], // no device compatibility has been established
    uses_symptoms: false,
    input_schema: "IMAGE_ONLY",
    supported_symptom_types: [], // image-only model: it consumes no symptoms
    performance_with_symptoms: null,
    performance_without_symptoms: null,
    supported_conditions: [], // DEMO model supports no conditions - none can ever be displayed
    notes: "Registered DEMO model. Produces labeled synthetic output only.",
  },
  "fundus-lesions-clementp-unet-seresnext50": {
    model_id: "fundus-lesions-clementp-unet-seresnext50",
    model_name: "ClementP fundus lesion segmentation U-Net SE-ResNeXt50 32x4d",
    version: "a2cfcb594e483",
    sha256: "a7a7cb45b92328f7c9a8e581eec3944fd435d37fae8cbf340b1319c5f987c6d2",
    format: "safetensors",
    file_path: "fundus-lesions-clementp-unet-seresnext50/model.safetensors",
    modalities: ["FUNDUS"],
    supported_anatomy: ["retina"],
    supported_findings: [
      "cotton_wool_spot",
      "hard_exudate",
      "retinal_hemorrhage",
      "microaneurysm_like_lesion",
    ],
    intended_use: "Offline technical research only: lesion-like region localization on fundus photographs as decision-support observations requiring ophthalmic review. Never a diagnosis, never a normality claim.",
    contraindications: [
      "Any clinical use, diagnosis, treatment, or prescribing decision",
      "Any claim of a normal/healthy fundus or absence of disease",
      "AMD, retinal detachment/tear, vascular occlusion, tumors, glaucoma assessment, or any pathology outside the four supported lesion-like classes",
      "Use without hash-verified package, reviewed runtime, and clinician review of every finding",
    ],
    limitations: [
      "RESEARCH status; no clinical validation and no independent external validation completed.",
      "Connected components are unfiltered argmax regions, not validated lesions.",
      "Argmax masks are not calibrated probabilities; no calibrated confidence is ever produced.",
      "Device compatibility is unvalidated for every device; domain validation is UNKNOWN for every study.",
      "Only four lesion-like classes are covered; many sight-threatening conditions are explicitly unsupported.",
    ],
    training_dataset: {
      name: "DDR + FGADR + IDRiD + MESSIDOR + RETLES (as reported on the publisher model card)",
      version: "as-reported-by-publisher",
      size_studies: null,
      size_patients: null,
      population: "not documented by publisher; must not be assumed",
      devices: [],
      provenance_reference: "https://huggingface.co/ClementP/fundus-lesions-segmentation-unet_seresnext50_32x4d",
    },
    validation_dataset: null,
    patient_level_split: null,
    performance: {
      sensitivity: null, specificity: null, ppv: null, npv: null, auroc: null, auprc: null,
      calibration: null, evidence_reference: null,
    },
    validation_date: null,
    external_validation_status: "none",
    clinical_validation_status: "none",
    regulatory_status: "research_only",
    status: "RESEARCH",
    devices: [], // no device compatibility has been established for any device
    uses_symptoms: false,
    input_schema: "IMAGE_ONLY",
    supported_symptom_types: [],
    performance_with_symptoms: null,
    performance_without_symptoms: null,
    supported_conditions: [], // RESEARCH model claims no conditions - associations stay empty, never diagnoses
    notes: "Registered RESEARCH model. Real local SafeTensors inference via FundusLesionLocalProvider; output is uncalibrated research observations only.",
  },
  "fundus-dr-grading-effb0": {
    model_id: "fundus-dr-grading-effb0",
    model_name: "ClementP fundus DR grading EfficientNet-B0 (regression head)",
    version: "aa5741419b90",
    sha256: "0d9a18b0cb6c90d1f30bf2e66153b368bd7ff0bcb45b6690e8d5ce14fa19f69b",
    format: "safetensors",
    file_path: "fundus-dr-grading-effb0/model.safetensors",
    modalities: ["FUNDUS"],
    supported_anatomy: ["retina"],
    supported_findings: ["dr_grade_estimate"],
    intended_use: "Offline technical research only: image-level diabetic-retinopathy grade estimation as a decision-support observation requiring ophthalmic review. Never a diagnosis, never a normality claim, never a probability.",
    contraindications: [
      "Any clinical use, diagnosis, referral, treatment, or prescribing decision",
      "Any claim of absence of diabetic retinopathy or of a normal fundus",
      "Use of the raw logit as a calibrated probability or confidence",
      "Use without hash-verified package, reviewed runtime, and clinician review of every output",
    ],
    limitations: [
      "RESEARCH status; no clinical validation and no independent external validation completed.",
      "Single regression logit rounded to an integer grade; grade boundaries are uncalibrated.",
      "No calibrated confidence exists for any grade; the raw logit is a ranking score only.",
      "Device compatibility is unvalidated for every device; domain validation is UNKNOWN for every study.",
      "Publisher-reported training data (EyePACS/APTOS/DDR/IDRiD) overlaps common benchmarks; only non-overlapping cohorts validate generalization.",
    ],
    training_dataset: {
      name: "EyePACS + APTOS + DDR + IDRiD (per publisher collection page; exact manifests unavailable)",
      version: "as-reported-by-publisher",
      size_studies: null,
      size_patients: null,
      population: "not documented by publisher; must not be assumed",
      devices: [],
      provenance_reference: "https://huggingface.co/collections/ClementP/fundus-grading",
    },
    validation_dataset: null,
    patient_level_split: null,
    performance: {
      sensitivity: null, specificity: null, ppv: null, npv: null, auroc: null, auprc: null,
      calibration: null, evidence_reference: null,
    },
    validation_date: null,
    external_validation_status: "none",
    clinical_validation_status: "none",
    regulatory_status: "research_only",
    status: "RESEARCH",
    devices: [], // no device compatibility has been established for any device
    uses_symptoms: false,
    input_schema: "IMAGE_ONLY",
    supported_symptom_types: [],
    performance_with_symptoms: null,
    performance_without_symptoms: null,
    supported_conditions: [], // RESEARCH model claims no conditions - associations stay empty, never diagnoses
    notes: "Registered RESEARCH model. Real local SafeTensors inference via DrGradeLocalProvider; output is an uncalibrated research grade estimate only.",
  },
};

export function getModel(modelId: string): ModelRecord | null {
  return MODELS[modelId] ?? null;
}

export function listModels(): ModelRecord[] {
  return Object.values(MODELS);
}

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

export interface ModelGateResult {
  allowed: boolean;
  reasons: string[];
  label: string | null;          // mandatory display label when findings are produced
  findings_use: string;
}

/**
 * Hard validation-status gate: what may this model do right now?
 *
 * `device` is OPTIONAL and distinguishes two different call shapes:
 *  - omitted entirely (`undefined`): a context-free check (e.g. the model
 *    registry listing UI) - device compatibility is NOT evaluated, since
 *    there is no specific study/device to check against.
 *  - passed explicitly (a device object, or `null` for "no device metadata
 *    was provided"): a per-study execution gate (pipeline/provider call
 *    sites). For any non-DEMO model, device compatibility is then hard-
 *    enforced here, the same point modality is already enforced - this
 *    closes the Phase 4/5 audit finding that device compatibility was
 *    checked and displayed but never actually gated inference.
 */
export function gateModelUse(model: ModelRecord, device?: { manufacturer?: string; model?: string } | null): ModelGateResult {
  const reasons: string[] = [];
  const caps = STATUS_CAPABILITIES[model.status];

  if (!caps) {
    return { allowed: false, reasons: [`Unknown model status: ${model.status}`], label: null, findings_use: "none" };
  }
  if (!caps.may_produce_findings) {
    reasons.push(`Model status ${model.status} does not permit producing findings.`);
  }
  if (model.status !== "DEMO" && model.modalities.length === 0) {
    reasons.push("Model declares no supported modalities.");
  }
  if (model.status !== "DEMO") {
    // Non-demo models must have artifact integrity evidence before use.
    if (!model.sha256) reasons.push("Registry record has no artifact checksum.");
    if (!model.validation_date && model.status !== "RESEARCH") {
      reasons.push("No validation date recorded.");
    }
    if (
      model.status !== "RESEARCH" &&
      model.status !== "INTERNAL_VALIDATION" &&
      model.performance.evidence_reference === null &&
      Object.values(model.performance).some((x) => typeof x === "number")
    ) {
      reasons.push("Performance metrics present without evaluation evidence reference.");
    }
    if (device !== undefined) {
      const compat = deviceCompatible(model, device);
      if (!compat.compatible) reasons.push(`Device compatibility check failed: ${compat.note}`);
    }
  }
  return {
    allowed: reasons.length === 0,
    reasons,
    label: caps.requires_label,
    findings_use: caps.findings_use,
  };
}

/** Can this model analyze this modality? Explicit declaration required. */
export function supportsModality(model: ModelRecord, modality: string): boolean {
  const m = modality.toUpperCase();
  return model.modalities.includes(m as Modality);
}

/** Device compatibility: validated on Device A != validated on Device B. */
export function deviceCompatible(model: ModelRecord, device: { manufacturer?: string; model?: string } | null): { compatible: boolean; note: string } {
  if (!device || (!device.manufacturer && !device.model)) {
    return { compatible: false, note: "Device compatibility has not been validated. No device metadata was provided." };
  }
  if (model.devices.length === 0) {
    return { compatible: false, note: "Device compatibility has not been validated for this model." };
  }
  const match = model.devices.some(
    (d) =>
      (d.manufacturer.toLowerCase() === (device.manufacturer ?? "").toLowerCase() || !device.manufacturer) &&
      (d.model.toLowerCase() === (device.model ?? "").toLowerCase() || !device.model)
  );
  return match
    ? { compatible: true, note: "Device listed in model compatibility metadata." }
    : { compatible: false, note: "Device compatibility has not been validated. This device is not listed in the model registry." };
}

export function isSupportedModality(modality: string): boolean {
  return SUPPORTED_MODALITIES.includes(modality.toUpperCase() as Modality);
}

/** Registry integrity self-check: non-DEMO models must not claim validation without evidence. */
export function auditRegistryConsistency(): Array<{ model_id: string; problems: string[] }> {
  const problems: Array<{ model_id: string; problems: string[] }> = [];
  for (const m of Object.values(MODELS)) {
    const p: string[] = [];
    const claimsValidation = ["EXTERNALLY_VALIDATED", "CLINICALLY_VALIDATED", "INTERNAL_VALIDATION"].includes(m.status);
    if (claimsValidation) {
      if (!m.performance.evidence_reference) p.push("Validation status claimed without evaluation evidence reference.");
      if (!m.validation_dataset) p.push("Validation status claimed without validation dataset description.");
      if (m.validation_date === null) p.push("Validation status claimed without validation date.");
      if (m.status !== "INTERNAL_VALIDATION" && m.external_validation_status !== "completed") {
        p.push("External-validation-level status claimed but external_validation_status != completed.");
      }
    }
    if (m.sha256 && !m.file_path) p.push("Checksum recorded but no artifact path.");
    problems.push({ model_id: m.model_id, problems: p });
  }
  return problems.filter((x) => x.problems.length > 0);
}

/** Locate and hash a model artifact under MODEL_ROOT. */
export function hashModelArtifact(relativePath: string): { sha256: string | null; error?: string } {
  const p = path.resolve(MODEL_ROOT, relativePath);
  const relative = path.relative(path.resolve(MODEL_ROOT), p);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return { sha256: null, error: "Path escapes MODEL_ROOT" };
  if (!fs.existsSync(p)) return { sha256: null, error: "Model artifact not found on disk" };
  const stat = fs.lstatSync(p);
  if (!stat.isFile() || stat.isSymbolicLink()) return { sha256: null, error: "Model artifact must be a regular file, not a symlink" };
  if (stat.size > 2 * 1024 * 1024 * 1024) return { sha256: null, error: "Model artifact exceeds the 2 GiB safety limit" };
  const hash = createHash("sha256");
  const fd = fs.openSync(p, "r");
  const chunk = Buffer.allocUnsafe(1024 * 1024);
  try {
    let read = 0;
    do {
      read = fs.readSync(fd, chunk, 0, chunk.length, null);
      if (read > 0) hash.update(chunk.subarray(0, read));
    } while (read > 0);
  } finally {
    fs.closeSync(fd);
  }
  return { sha256: hash.digest("hex") };
}
