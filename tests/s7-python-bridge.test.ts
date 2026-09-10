import { describe, it, expect } from "vitest";
import { checkPythonInferenceEnvironment, PythonBridgeProvider } from "@/lib/models/pythonBridgeProvider";
import { CANDIDATE_MODEL_DOSSIER_MAP } from "@/lib/models/candidateDossiers";
import { getModel } from "@/lib/models/registry";
import { getProviderForModel, defaultProvider } from "@/lib/models/provider";

/**
 * S7 - optional real integration tests against this machine's ACTUAL Python
 * environment (no mocking of child_process). The generic bridge is not a
 * release-required component: no candidate is registered or called by the
 * application pipeline. When explicitly enabled, this test reports the
 * machine's actual runtime state. A ready environment does NOT mean a real
 * model can run: every
 * PythonBridgeProvider method must still fail closed, because no candidate
 * has an installed artifact (the RETFound checkpoint download is itself
 * blocked by HuggingFace's gated-access requirement - see
 * docs/MODEL_INTEGRATION.md). These tests prove that second, independent
 * fail-closed layer when the optional probe is intentionally enabled.
 */

// A clean checkout must not inherit assumptions about the developer's Python
// installation.  Opt into the real environment probe explicitly when the
// dedicated research runtime is present; CI and model-optional runs retain the
// structured fail-closed contract without requiring torch/torchvision.
const RUN_LIVE_PYTHON = process.env.VISIONSCAN_RUN_LIVE_PYTHON === "1";

describe.skipIf(!RUN_LIVE_PYTHON)("S7 - live Python environment readiness (real subprocess, no mocks)", () => {
  it("reports the actual current environment state truthfully", async () => {
    const env = await checkPythonInferenceEnvironment();
    expect(typeof env.ready).toBe("boolean");
    expect(Array.isArray(env.missing)).toBe(true);
    // Readiness is a report of the selected machine environment, not a
    // release invariant. An optional bridge may legitimately be unavailable.
    expect(env.ready).toBe(env.missing.length === 0 && Object.values(env.packages).every((pkg) => pkg.available));
  }, 20_000);

  it("never throws even when the check itself fails - fails closed with a structured result", async () => {
    await expect(checkPythonInferenceEnvironment()).resolves.toBeDefined();
  }, 20_000);
});

describe.skipIf(!RUN_LIVE_PYTHON)("S7 - PythonBridgeProvider fails closed for every real candidate (even with a ready environment)", () => {
  for (const candidateId of Object.keys(CANDIDATE_MODEL_DOSSIER_MAP)) {
    it(`${candidateId}: loadModel/validateModel/analyzeStudy all fail closed - no installed artifact`, async () => {
      const provider = new PythonBridgeProvider(candidateId);
      const env = await checkPythonInferenceEnvironment();

      // The bridge must fail closed for either truthful environment state:
      // absent dependencies are reported first; a ready environment still
      // cannot load a candidate-only provider without an artifact.
      if (env.ready) {
        await expect(provider.loadModel()).rejects.toThrow(/no installed artifact/i);
      } else {
        await expect(provider.loadModel()).rejects.toThrow(/environment is not ready/i);
      }

      const validation = await provider.validateModel();
      expect(validation.trusted).toBe(false);
      expect(validation.gate.allowed).toBe(false);
      // The environment check mirrors the actual opt-in probe result...
      expect(validation.checks.find((c) => c.check === "python_environment")?.passed).toBe(env.ready);
      // ...but the artifact-installed check still correctly fails.
      expect(validation.checks.find((c) => c.check === "artifact_installed")?.passed).toBe(false);

      await expect(provider.analyzeStudy({} as any, {} as any)).rejects.toThrow();

      const metadata = await provider.getModelMetadata();
      expect(metadata).toBeNull();
    }, 45_000);
  }

  it("no candidate is reachable through the live registry or provider map", async () => {
    for (const candidateId of Object.keys(CANDIDATE_MODEL_DOSSIER_MAP)) {
      expect(getModel(candidateId)).toBeFalsy();
      expect(getProviderForModel(candidateId)).toBeNull();
    }
    expect(defaultProvider().modelId).toBe("demo-fundus-synthetic-v0");
  });
});
