import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { validateRunManifest, validateRunResult } from "@/lib/models/competitionContract";

const repo = process.cwd();
const script = path.join(repo, "scripts", "model-competition", "freeze-dr-baseline.mjs");

describe("DR competition baseline freezer", () => {
  it("freezes only the existing DR evidence and emits valid immutable contracts", () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "visionscan-dr-competition-"));
    const stdout = execFileSync(process.execPath, [script, "--output-dir", outputDir], { cwd: repo, encoding: "utf8" });
    const bundle = JSON.parse(stdout);
    expect(bundle.status).toBe("FROZEN_BASELINE");
    expect(bundle.manifest.model.model_id).toBe("fundus-dr-grading-effb0");
    expect(bundle.manifest.dataset.case_count).toBe(400);
    expect(bundle.result.measurement_state).toBe("MEASURED");
    expect(bundle.result.calculation_method).toBe("COPIED_FROM_EXISTING_EVIDENCE_SUMMARY");
    expect(bundle.result.metrics.referable.confusion).toMatchObject({ tp: 79, fp: 2, tn: 218, fn: 101 });
    expect(bundle.manifest.limitations.join(" ")).toMatch(/not prospective clinical validation/);
    expect(validateRunManifest(bundle.manifest).valid).toBe(true);
    expect(validateRunResult(bundle.result).valid).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(outputDir, "dr-baseline-run-manifest.json"), "utf8")).manifest_sha256).toBe(bundle.manifest.manifest_sha256);
    expect(JSON.parse(fs.readFileSync(path.join(outputDir, "dr-baseline-run-result.json"), "utf8")).result_sha256).toBe(bundle.result.result_sha256);
  });
});

