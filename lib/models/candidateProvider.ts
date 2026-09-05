/**
 * S6-C — a reference EyeModelProvider implementation for an uninstalled
 * CANDIDATE model. This class demonstrates that the existing provider
 * interface (lib/models/provider.ts) can host a real-model integration
 * WITHOUT requiring any change to the interface itself, while guaranteeing
 * every method fails closed because no artifact is installed.
 *
 * HARD RULES:
 *  - never registered in PROVIDERS (lib/models/provider.ts) or MODELS
 *    (lib/models/registry.ts) - getProviderForModel()/defaultProvider()
 *    never return an instance of this class
 *  - never imported by lib/analysis/pipeline.ts
 *  - loadModel()/validateModel()/analyzeStudy() all throw or return a
 *    fail-closed result; there is no code path here that could produce a
 *    Finding, because there is no artifact on disk to run
 */

import { NormalizedStudy } from "../devices/adapter";
import type { ModelRecord, ModelGateResult } from "./registry";
import type { IntegrityResult } from "./integrity";
import type { EyeModelProvider, ModelAnalysisContext, ModelAnalysisOutput, ModelCapabilities } from "./provider";
import { CANDIDATE_MODEL_DOSSIER_MAP, type CandidateModelDossier } from "./candidateDossiers";

export class CandidateOnlyModelError extends Error {
  constructor(candidateId: string, reason: string) {
    super(`Candidate model "${candidateId}" is CANDIDATE_ONLY - ${reason}`);
    this.name = "CandidateOnlyModelError";
  }
}

/**
 * A provider for a dossier-only candidate. Every method either throws or
 * returns an explicitly "not trusted / not available" result - there is no
 * successful path through this class, by construction, because no artifact
 * exists on disk (`data/models/` is not searched here at all).
 */
export class CandidateOnlyProvider implements EyeModelProvider {
  readonly providerId: string;
  readonly modelId: string;
  private readonly dossier: CandidateModelDossier;

  constructor(candidateId: string) {
    const dossier = CANDIDATE_MODEL_DOSSIER_MAP[candidateId];
    if (!dossier) throw new Error(`Unknown candidate id: ${candidateId}`);
    this.dossier = dossier;
    this.providerId = `candidate-only:${candidateId}`;
    this.modelId = candidateId;
  }

  async loadModel(): Promise<void> {
    throw new CandidateOnlyModelError(this.dossier.candidate_id, "no model artifact is installed under data/models/; nothing to load.");
  }

  async validateModel(): Promise<IntegrityResult & { gate: ModelGateResult }> {
    return {
      trusted: false,
      checks: [{ check: "candidate_only", passed: false, detail: "This model has never been installed; it exists only as a due-diligence dossier (lib/models/candidateDossiers.ts)." }],
      model: null,
      gate: {
        allowed: false,
        reasons: ["CANDIDATE_ONLY: not registered, not installed, requires explicit human authorization before any further step."],
        label: null,
        findings_use: "none - candidate has no registry entry and no installed artifact",
      },
    };
  }

  async analyzeStudy(_study: NormalizedStudy, _ctx: ModelAnalysisContext): Promise<ModelAnalysisOutput> {
    throw new CandidateOnlyModelError(this.dossier.candidate_id, "analyzeStudy() may never be called for a candidate whose validateModel() cannot pass.");
  }

  async getCapabilities(): Promise<ModelCapabilities> {
    return {
      model_id: this.dossier.candidate_id,
      modalities: this.dossier.modality,
      supported_findings: [],
      supports_measurements: false,
      supports_localization: false,
      calibration_available: false,
    };
  }

  /** Never a registered ModelRecord - this candidate has no registry entry by design. */
  async getModelMetadata(): Promise<ModelRecord | null> {
    return null;
  }

  async unloadModel(): Promise<void> {
    // Nothing was ever loaded.
  }

  getDossier(): CandidateModelDossier {
    return this.dossier;
  }
}

/** Convenience: build a fail-closed provider for every dossier, for infrastructure exercise/tests only. */
export function candidateProviders(): CandidateOnlyProvider[] {
  return Object.keys(CANDIDATE_MODEL_DOSSIER_MAP).map((id) => new CandidateOnlyProvider(id));
}
