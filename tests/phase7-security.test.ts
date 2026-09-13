import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repo = path.resolve(__dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(repo, relativePath), "utf8");

describe("Phase 7 security and governance boundaries", () => {
  it("exposes only a role-gated GET projection for Phase 7 evidence", () => {
    const route = read("app/api/validation/phase7/route.ts");
    expect(route).toContain("requireRole(req, [\"ADMIN\", \"REVIEWER\", \"RESEARCHER\"])");
    expect(route).toContain("export async function GET");
    expect(route).not.toMatch(/export async function (POST|PUT|PATCH|DELETE)/);
    expect(route).not.toContain("NextResponse.json(readJson");
  });

  it("keeps model promotion server-controlled and clinical state unavailable", () => {
    const route = read("app/api/validation/phase7/route.ts");
    expect(route).toContain("allowed_states: [\"CANDIDATE_ONLY\", \"RESEARCH_ONLY\"]");
    expect(route).toContain("clinical_state: \"NOT_ALLOWED\"");
    expect(read("app/validation-center/ValidationCenterClient.tsx")).toContain("/api/validation/phase7");
  });

  it("does not expose candidate local paths or row-level data through the Phase 7 projection", () => {
    const route = read("app/api/validation/phase7/route.ts");
    expect(route).not.toContain("artifact_path");
    expect(route).not.toContain("image_path");
    expect(route).not.toContain("patient_id");
    expect(route).not.toContain("case_id");
  });

  it("keeps RetGuard investigation fail-closed and tolerance immutable", () => {
    const probe = read("scripts/inference/retguard_parity_probe.py");
    expect(probe).toContain("DECLARED_TOLERANCE = 0.001");
    expect(probe).toContain("publisher_framework_logits");
    expect(probe).toContain("absolute_differences");
    expect(probe).toContain("stop_rule_preserved");
  });

  it("requires isolated SafeTensors/ONNX model handling in the new runtime scripts", () => {
    expect(read("scripts/inference/fundus_lesion_resident_probe.py")).toContain("-I -s");
    expect(read("scripts/inference/fundus_lesion_resident_probe.py")).toContain("load_file");
    expect(read("scripts/model-competition/phase7-real-resource-worker.ts")).toContain("acquireResourceLease");
  });

  it("does not add a force-upgrade or force-push escape hatch", () => {
    const packageJson = read("package.json");
    expect(packageJson).not.toContain("npm audit fix --force");
    const candidateSearch = read("scripts/model-competition/phase7-candidate-search.mjs");
    expect(candidateSearch).not.toContain("npm audit fix --force");
    expect(candidateSearch).not.toMatch(/git\s+push\s+--force/);
  });

  it("keeps the Phase 7 additions aggregate-only by contract", () => {
    for (const file of [
      "docs/generated/phase7-candidate-search.json",
      "docs/generated/phase7-retguard-parity-investigation.json",
      "docs/generated/phase7-resource-race.json",
      "docs/generated/phase7-real-load.json",
      "docs/generated/phase7-resident-experiment.json",
      "docs/generated/phase7-provider-crash-matrix.json",
      "docs/generated/model-competition/phase7-lesion-calibration-20260913/calibration.json",
    ]) {
      const text = read(file);
      expect(JSON.parse(text).phi_included).toBe(false);
      expect(text).not.toMatch(/patient[_ -]?\d+|IMG\d+\.jpg|date of birth|medical[- ]record number/i);
    }
  });
});
