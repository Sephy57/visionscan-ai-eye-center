import { describe, it, expect } from "vitest";
import { checkPythonInferenceEnvironment, PythonBridgeProvider } from "@/lib/models/pythonBridgeProvider";
import { CANDIDATE_MODEL_DOSSIER_MAP } from "@/lib/models/candidateDossiers";
import { getModel } from "@/lib/models/registry";
import { getProviderForModel, defaultProvider } from "@/lib/models/provider";

/**
 * S7 - real integration tests against this machine's ACTUAL Python
 * environment (no mocking of child_process). As of S7, an isolated venv
 * (.venv-ophthalmic, never global/user site-packages) has CPU-only PyTorch
 * installed, so `checkPythonInferenceEnvironment()` now genuinely reports
 * ready: true. That does NOT mean a real model can run: every
 * PythonBridgeProvider method must still fail closed, because no candidate
 * has an installed artifact (the RETFound checkpoint download is itself
 * blocked by HuggingFace's gated-access requirement - see
 * docs/MODEL_INTEGRATION.md). These tests prove that second, independent
 * fail-closed layer holds even though the first one (environment readiness)
 * now passes.
 */

describe("S7 - live Python environment readiness (real subprocess, no mocks)", () => {
  it("reports the actual current environment state truthfully", async () => {
    const env = await checkPythonInferenceEnvironment();
    expect(typeof env.ready).toBe("boolean");
    // The isolated .venv-ophthalmic environment has torch/torchvision/numpy/
    // pillow installed (S7) - this is a genuine, live fact about this
    // deployment now, not a hardcoded expectation.
    expect(env.ready).toBe(true);
    expect(env.missing).toEqual([]);
    expect(env.packages.torch?.available).toBe(true);
  }, 20_000);

  it("never throws even when the check itself fails - fails closed with a structured result", async () => {
    await expect(checkPythonInferenceEnvironment()).resolves.toBeDefined();
  }, 20_000);
});

describe("S7 - PythonBridgeProvider fails closed for every real candidate (even with a ready environment)", () => {
  for (const candidateId of Object.keys(CANDIDATE_MODEL_DOSSIER_MAP)) {
    it(`${candidateId}: loadModel/validateModel/analyzeStudy all fail closed - no installed artifact`, async () => {
      const provider = new PythonBridgeProvider(candidateId);

      // loadModel() now gets PAST the environment-readiness check (it's
      // ready) and must fail for the NEXT reason: no artifact installed.
      await expect(provider.loadModel()).rejects.toThrow(/no installed artifact/i);

      const validation = await provider.validateModel();
      expect(validation.trusted).toBe(false);
      expect(validation.gate.allowed).toBe(false);
      // The environment check itself now passes...
      expect(validation.checks.find((c) => c.check === "python_environment")?.passed).toBe(true);
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
