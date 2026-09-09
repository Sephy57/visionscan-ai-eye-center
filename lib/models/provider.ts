/**
 * EyeModelProvider - provider interface so future models can use ONNX Runtime,
 * PyTorch, TensorFlow, local inference servers, or remote services without
 * changing the clinical workflow.
 *
 * Contract:
 *  - validateModel() MUST pass before analyzeStudy() may be called.
 *  - Providers report their model metadata and validation status from the
 *    registry; they can never self-declare validation.
 *  - analyzeStudy() returns structured findings only; it cannot modify
 *    triage, disclaimers, or safety output.
 */

import { NormalizedStudy } from "../devices/adapter";
import { Finding } from "../analysis/schema";
import { ModelRecord, getModel, gateModelUse, ModelGateResult } from "./registry";
import { verifyModelIntegrity, IntegrityResult } from "./integrity";
import { checkModalitySupported } from "./modalities";
import { FundusLesionLocalProvider } from "./fundusLesionLocalProvider";
import { DrGradeLocalProvider } from "./drGradeLocalProvider";
import { OctLocalProvider } from "./octLocalProvider";

export interface ModelCapabilities {
  model_id: string;
  modalities: string[];
  supported_findings: string[];
  supports_measurements: boolean;
  supports_localization: boolean;
  calibration_available: boolean;
}

export interface ModelAnalysisContext {
  qualityScore: number;
  eye: string;
  device?: { manufacturer?: string; model?: string } | null;
  /**
   * Raw study image bytes for providers that run REAL pixel inference.
   * Optional so byte-free providers (e.g. the DEMO generator) are unaffected.
   * A provider that needs pixels but receives none must fail closed.
   */
  imageBytes?: Buffer;
  /** Server-derived immutable cache scope. For a bounded PDF ROI,
   * contentHash is the source-page hash and roiHash must match imageBytes. */
  cacheProvenance?: { contentHash: string; roiHash: string | null };
}

export interface ModelAnalysisOutput {
  findings: Finding[];
  per_model_metadata: {
    model_id: string;
    model_version: string;
    validation_status: string;
    display_label: string | null;
    integrity: IntegrityResult;
  };
  notes: string[];
}

export interface EyeModelProvider {
  readonly providerId: string;
  readonly modelId: string;
  loadModel(): Promise<void>;
  validateModel(): Promise<IntegrityResult & { gate: ModelGateResult }>;
  analyzeStudy(study: NormalizedStudy, ctx: ModelAnalysisContext): Promise<ModelAnalysisOutput>;
  getCapabilities(): Promise<ModelCapabilities>;
  getModelMetadata(): Promise<ModelRecord | null>;
  unloadModel(): Promise<void>;
}

/**
 * Gate helper shared by all providers. Throws when the model may not run.
 * `device` is passed through to gateModelUse() unchanged - omit it for a
 * context-free check (e.g. validateModel(), with no specific study yet),
 * pass the study's declared device (or `null`) for a real per-study
 * execution gate, which then hard-enforces device compatibility for any
 * non-DEMO model.
 */
export async function gateOrThrow(modelId: string, device?: { manufacturer?: string; model?: string } | null): Promise<{ model: ModelRecord; gate: ModelGateResult }> {
  const model = getModel(modelId);
  if (!model) throw new Error(`Model not registered: ${modelId}`);
  const gate = gateModelUse(model, device);
  if (!gate.allowed) {
    throw new Error(`Model use rejected by registry gate: ${gate.reasons.join(" ")}`);
  }
  return { model, gate };
}

/**
 * Deterministic synthetic DEMO provider and pipeline default. Registered as
 * status DEMO. A second provider ("local-fundus-lesion", RESEARCH) exists for
 * the hash-verified lesion checkpoint - see fundusLesionLocalProvider.ts.
 */
export class PlaceholderDemoProvider implements EyeModelProvider {
  readonly providerId = "placeholder-demo";
  readonly modelId = "demo-fundus-synthetic-v0";

  async loadModel(): Promise<void> { /* nothing to load - deterministic generator */ }
  async unloadModel(): Promise<void> {}

  async validateModel(): Promise<IntegrityResult & { gate: ModelGateResult }> {
    const integrity = verifyModelIntegrity(this.modelId);
    const { gate } = await gateOrThrow(this.modelId);
    return { ...integrity, gate };
  }

  async getCapabilities(): Promise<ModelCapabilities> {
    return {
      model_id: this.modelId,
      modalities: ["FUNDUS", "EXTERNAL_EYE"],
      supported_findings: [
        "possible_retinal_hemorrhage",
        "indeterminate_focal_hyperreflective_region",
        "possible_drusen_like_deposit",
      ],
      supports_measurements: false, // synthetic model produces no measurements
      supports_localization: false, // pseudo-regions are demo overlays, not localization
      calibration_available: false, // no calibration has ever been performed
    };
  }

  async getModelMetadata(): Promise<ModelRecord | null> {
    return getModel(this.modelId);
  }

  async analyzeStudy(study: NormalizedStudy, ctx: ModelAnalysisContext): Promise<ModelAnalysisOutput> {
    const { model, gate } = await gateOrThrow(this.modelId, ctx.device);

    const modCheck = checkModalitySupported(model, study.modality);
    if (!modCheck.ok) {
      return {
        findings: [],
        per_model_metadata: {
          model_id: model.model_id,
          model_version: model.version,
          validation_status: model.status,
          display_label: gate.label,
          integrity: { trusted: false, checks: [{ check: "modality", passed: false, detail: modCheck.reason! }], model },
        },
        notes: [modCheck.reason!],
      };
    }

    // Defer to the deterministic synthetic generator (kept from Phase 1).
    const { scenarioFromSeed, buildDemoFindings } = await import("../analysis/findings");
    const scenario = scenarioFromSeed(study.hashSeed ?? 0);
    let findings = buildDemoFindings(scenario, ctx.qualityScore);
    // Tag taxonomy level (observation-level only for DEMO status).
    findings = findings.map((f) => ({ ...f, taxonomy_level: "observation" as const }));

    return {
      findings,
      per_model_metadata: {
        model_id: model.model_id,
        model_version: model.version,
        validation_status: model.status,
        display_label: gate.label,
        integrity: verifyModelIntegrity(this.modelId),
      },
      notes: ["Output is synthetic (DEMO status). No medical model is installed."],
    };
  }
}

/**
 * Installed providers in this deployment:
 *  - "placeholder-demo": deterministic synthetic DEMO generator (default).
 *  - "local-fundus-lesion": real local SafeTensors lesion inference
 *    (RESEARCH status, fundus only). Lazily imported so the DEMO path never
 *    pays for - or depends on - the ML worker module.
 */
const PROVIDERS: Record<string, EyeModelProvider> = {
  "placeholder-demo": new PlaceholderDemoProvider(),
};

function lesionProvider(): EyeModelProvider {
  return new FundusLesionLocalProvider();
}

export function getProvider(providerId: string): EyeModelProvider | null {
  if (providerId === "local-fundus-lesion") return lesionProvider();
  if (providerId === "local-dr-grade") return new DrGradeLocalProvider();
  if (providerId === "local-oct-retinal") return new OctLocalProvider();
  return PROVIDERS[providerId] ?? null;
}

export function getProviderForModel(modelId: string): EyeModelProvider | null {
  if (modelId === "fundus-lesions-clementp-unet-seresnext50") return lesionProvider();
  if (modelId === "fundus-dr-grading-effb0") return new DrGradeLocalProvider();
  if (modelId === "oct-retinal-weights-fp32") return new OctLocalProvider();
  return Object.values(PROVIDERS).find((p) => p.modelId === modelId) ?? null;
}

export function defaultProvider(): EyeModelProvider {
  return PROVIDERS["placeholder-demo"];
}

export interface ModelHealthResult {
  model_id: string;
  healthy: boolean;
  checked_at: string;
  steps: Array<{ step: "provider_lookup" | "load" | "validate" | "unload"; passed: boolean; detail?: string }>;
}

/**
 * Model-load health check (Phase 6 infrastructure). Fails closed: any
 * exception at any step (provider missing, load failure, validation
 * failure, unload failure) marks the model unhealthy rather than
 * propagating a raw error or, worse, assuming health by default. A real
 * provider's loadModel() might load actual weights into a runtime
 * (ONNX, etc.) - this is the place that failure surfaces before any
 * inference is attempted against real patient data.
 */
export async function checkModelHealth(modelId: string): Promise<ModelHealthResult> {
  const steps: ModelHealthResult["steps"] = [];
  const provider = getProviderForModel(modelId);
  if (!provider) {
    return {
      model_id: modelId, healthy: false, checked_at: new Date().toISOString(),
      steps: [{ step: "provider_lookup", passed: false, detail: "No provider is registered for this model id." }],
    };
  }
  steps.push({ step: "provider_lookup", passed: true });

  let loaded = false;
  try {
    await provider.loadModel();
    loaded = true;
    steps.push({ step: "load", passed: true });
  } catch (err) {
    steps.push({ step: "load", passed: false, detail: String(err instanceof Error ? err.message : err).slice(0, 200) });
  }

  if (loaded) {
    try {
      const result = await provider.validateModel();
      steps.push({ step: "validate", passed: result.gate.allowed && result.trusted, detail: result.gate.allowed ? undefined : result.gate.reasons.join(" ").slice(0, 200) });
    } catch (err) {
      steps.push({ step: "validate", passed: false, detail: String(err instanceof Error ? err.message : err).slice(0, 200) });
    }
    try {
      await provider.unloadModel();
      steps.push({ step: "unload", passed: true });
    } catch (err) {
      steps.push({ step: "unload", passed: false, detail: String(err instanceof Error ? err.message : err).slice(0, 200) });
    }
  }

  return {
    model_id: modelId,
    healthy: steps.every((s) => s.passed),
    checked_at: new Date().toISOString(),
    steps,
  };
}
