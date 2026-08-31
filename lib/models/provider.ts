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

/** Gate helper shared by all providers. Throws when the model may not run. */
export async function gateOrThrow(modelId: string): Promise<{ model: ModelRecord; gate: ModelGateResult }> {
  const model = getModel(modelId);
  if (!model) throw new Error(`Model not registered: ${modelId}`);
  const gate = gateModelUse(model);
  if (!gate.allowed) {
    throw new Error(`Model use rejected by registry gate: ${gate.reasons.join(" ")}`);
  }
  return { model, gate };
}

/**
 * The ONLY provider installed in this deployment. Deterministic synthetic
 * output for pipeline exercise. Registered as status DEMO.
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
    const { model, gate } = await gateOrThrow(this.modelId);

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

/** Provider registry - extend as real providers (ONNX, remote servers) are added. */
const PROVIDERS: Record<string, EyeModelProvider> = {
  "placeholder-demo": new PlaceholderDemoProvider(),
};

export function getProvider(providerId: string): EyeModelProvider | null {
  return PROVIDERS[providerId] ?? null;
}

export function defaultProvider(): EyeModelProvider {
  return PROVIDERS["placeholder-demo"];
}
