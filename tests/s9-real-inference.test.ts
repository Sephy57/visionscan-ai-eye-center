import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import {
  runSegformerResearchInference, SEGFORMER_MODEL_DIR, ArtifactNotFoundError,
} from "@/lib/models/segformerResearchProvider";
import { PROJECT_ROOT } from "@/lib/config";
import { validateRawModelOutput } from "@/lib/models/outputContract";
import { getModel } from "@/lib/models/registry";
import { getProviderForModel, defaultProvider } from "@/lib/models/provider";
import { CANDIDATE_MODEL_DOSSIER_MAP } from "@/lib/models/candidateDossiers";

/**
 * S9 - real integration tests against a genuine, locally-downloaded model
 * artifact (segformer-optic-disc-cup-refuge, Apache-2.0 license, safetensors
 * only). The checkpoint lives under scratch/models/ (gitignored, never
 * data/models/) and is NOT part of the committed repository - these tests
 * SKIP (not fail) when the artifact isn't present on the current machine,
 * so the suite stays green on a fresh checkout while still proving real
 * behavior in an environment where the artifact has been acquired.
 *
 * Every result here is RESEARCH_INFERENCE, NOT CLINICALLY VALIDATED - these
 * tests check technical correctness (shape, no NaN/Inf, fail-closed
 * behavior, provenance), never clinical accuracy.
 */

const HAS_ARTIFACT = fs.existsSync(path.join(SEGFORMER_MODEL_DIR, "model.safetensors"));
const EXPECTED_SHA256 = "22e45131b64eb07a5d29a2e5388a7709d10696b13f48d2d0cdcf56cafa1f9ea5"; // recorded S9, matches HF's own LFS sha256
const TEST_IMAGE = path.join(PROJECT_ROOT, "scratch", "test_images", "example_fundus.jpg");

describe.skipIf(!HAS_ARTIFACT)("S9 - real model artifact integrity", () => {
  it("the downloaded checkpoint's SHA-256 matches the recorded, independently-verified hash", () => {
    const bytes = fs.readFileSync(path.join(SEGFORMER_MODEL_DIR, "model.safetensors"));
    const hash = createHash("sha256").update(bytes).digest("hex");
    expect(hash).toBe(EXPECTED_SHA256);
  });

  it("only the safetensors weight file is used - the pickle sibling, if ever present, must never be loaded", () => {
    // The provider hard-codes use_safetensors=True in scripts/inference/segformer_infer.py;
    // this test only confirms the safetensors file itself is the one whose hash we verify.
    expect(fs.existsSync(path.join(SEGFORMER_MODEL_DIR, "model.safetensors"))).toBe(true);
  });
});

describe.skipIf(!HAS_ARTIFACT)("S9 - real CPU inference on a genuine fundus image", () => {
  it("produces a valid, contract-conforming RawModelOutput with no NaN/Inf", async () => {
    const output = await runSegformerResearchInference(TEST_IMAGE);
    expect(output.inference_status).toBe("completed");
    const validated = validateRawModelOutput(output);
    expect(validated.valid).toBe(true);
    expect(output.findings!.length).toBeGreaterThan(0);
    for (const f of output.findings!) {
      expect(f.finding_type).toMatch(/^research_segmented_/);
      expect(f.laterality).toBe("unknown"); // never inferred from pixels
    }
  }, 120_000);

  it("is deterministic across repeated runs on the same image (eval mode, no dropout)", async () => {
    const a = await runSegformerResearchInference(TEST_IMAGE);
    const b = await runSegformerResearchInference(TEST_IMAGE);
    expect(a.findings).toEqual(b.findings);
  }, 120_000);

  it("never fabricates a calibrated confidence value the model doesn't actually produce", async () => {
    const output = await runSegformerResearchInference(TEST_IMAGE);
    expect(output.calibrated_confidence == null).toBe(true);
    for (const f of output.findings!) {
      expect(f.calibrated_confidence == null).toBe(true);
    }
  }, 120_000);

  it("carries explicit NOT-CLINICALLY-VALIDATED limitations text", async () => {
    const output = await runSegformerResearchInference(TEST_IMAGE);
    expect(output.limitations?.some((l) => /NOT CLINICALLY VALIDATED/i.test(l))).toBe(true);
  }, 120_000);
});

describe.skipIf(!HAS_ARTIFACT)("S9 - fail-closed behavior against a genuine loaded model", () => {
  it("a missing image file fails closed (inference_status: failed), never throws uncaught", async () => {
    const output = await runSegformerResearchInference(path.join(PROJECT_ROOT, "scratch", "test_images", "does_not_exist.jpg"));
    expect(output.inference_status).toBe("failed");
    expect(output.findings ?? []).toEqual([]);
  }, 60_000);

  it("malformed (non-image) bytes fail closed", async () => {
    const malformed = path.join(PROJECT_ROOT, "scratch", "test_images", "_malformed_s9_test.jpg");
    fs.writeFileSync(malformed, Buffer.from("NOT_AN_IMAGE_" + "x".repeat(64)));
    try {
      const output = await runSegformerResearchInference(malformed);
      expect(output.inference_status).toBe("failed");
    } finally {
      fs.unlinkSync(malformed);
    }
  }, 60_000);
});

describe("S9 - no artifact present -> ArtifactNotFoundError (real behavior on a fresh checkout)", () => {
  it.skipIf(HAS_ARTIFACT)("throws ArtifactNotFoundError rather than silently proceeding", async () => {
    await expect(runSegformerResearchInference(TEST_IMAGE)).rejects.toThrow(ArtifactNotFoundError);
  });
});

describe("S9 - clinical isolation: the research provider is never reachable through the live registry", () => {
  it("segformer-optic-disc-cup-refuge is not a registered model and has no live provider", () => {
    expect(getModel("segformer-optic-disc-cup-refuge")).toBeFalsy();
    expect(getProviderForModel("segformer-optic-disc-cup-refuge")).toBeNull();
    expect(defaultProvider().modelId).toBe("demo-fundus-synthetic-v0");
  });

  it("the candidate dossier still exists and is CANDIDATE_ONLY regardless of S9 acquisition", () => {
    const dossier = CANDIDATE_MODEL_DOSSIER_MAP["segformer-optic-disc-cup-refuge"];
    expect(dossier).toBeDefined();
    expect(dossier.status).toBe("CANDIDATE_ONLY");
  });
});
