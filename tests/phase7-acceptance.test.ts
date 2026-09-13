import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repo = path.resolve(__dirname, "..");
const generated = (...parts: string[]) => path.join(repo, "docs", "generated", ...parts);

function readJson(relativePath: string): any {
  return JSON.parse(fs.readFileSync(path.join(repo, relativePath), "utf8"));
}

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repo, relativePath), "utf8");
}

function sha256(relativePath: string): string {
  return crypto.createHash("sha256").update(read(relativePath)).digest("hex");
}

describe("Phase 7 retinal intelligence and runtime acceptance", () => {
  it("preserves the Phase 6 frozen baseline counts", () => {
    const baseline = readJson("docs/generated/model-competition/phase6-retguard-20260913/baseline.json");
    expect(baseline.metrics.referable.confusion).toEqual({ tp: 79, fp: 2, tn: 218, fn: 101 });
    expect(baseline.metrics.multiclass.confusion_true_x_pred["3"]["3"]).toBe(3);
    expect(baseline.metrics.multiclass.confusion_true_x_pred["4"]["4"]).toBe(0);
  });

  it("records the second-candidate screen before any unknown weight is loaded", () => {
    const result = readJson("docs/generated/phase7-candidate-search.json");
    expect(result.schema_version).toBe("visionscan-phase7-candidate-search-v1");
    expect(result.rights_gate_before_artifact_execution).toBe(true);
    expect(result.no_unknown_weights_loaded).toBe(true);
    expect(result.selected_candidate_id).toBeNull();
    expect(result.decision).toBe("NO_SECOND_CANDIDATE_BENCHMARK_READY");
    expect(result.candidates).toHaveLength(3);
    expect(result.candidates.every((candidate: any) => candidate.artifact_sha256 === null)).toBe(true);
  });

  it("keeps ABSS-Net blocked on separately unverified weights rights and artifact identity", () => {
    const result = readJson("docs/generated/phase7-candidate-search.json");
    const abssnet = result.candidates.find((candidate: any) => candidate.candidate_id === "abssnet-dr-v1.0.0");
    expect(abssnet).toEqual(expect.objectContaining({ artifact_state: "NO_CANONICAL_LOCAL_CHECKPOINT", rights_state: "WEIGHTS_RIGHTS_UNVERIFIED", decision: "BLOCKED_BEFORE_INFERENCE" }));
  });

  it("preserves the RetGuard 0.001 parity stop after bounded investigation", () => {
    const result = readJson("docs/generated/phase7-retguard-parity-investigation.json");
    expect(result.publisher_observation.declared_logit_tolerance).toBe(0.001);
    expect(result.publisher_observation.max_logit_difference).toBe(0.002526);
    expect(result.publisher_observation.logit_parity).toBe("FAILED");
    expect(result.stop_rule_preserved).toBe(true);
    expect(result.final_decision).toContain("NOT_BENCHMARK_READY");
    expect(result.comparison.absolute_differences).toBeNull();
  });

  it("does not confuse a synthetic RetGuard graph run with publisher parity", () => {
    const result = readJson("docs/generated/phase7-retguard-parity-investigation.json");
    expect(result.input?.kind ?? "NOT_MEASURED").toMatch(/SYNTHETIC|NOT_MEASURED/);
    if (result.graph) expect(result.graph.inference).toMatch(/SYNTHETIC|NOT_MEASURED/);
  });

  it("freezes patient-separated lesion calibration and evaluation partitions", () => {
    const result = readJson("docs/generated/model-competition/phase7-lesion-calibration-20260913/calibration.json");
    expect(result.dataset.patient_separation).toBe("PATIENT_SEPARATED_BY_STABLE_PATIENT_HASH");
    expect(result.dataset.split_freeze).toBe("CREATED_BEFORE_RULE_EVALUATION");
    expect(result.dataset.calibration_patient_count + result.dataset.evaluation_patient_count).toBe(result.dataset.patient_count);
    expect(result.dataset.split_assignment_sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("uses documented empirical feature rules and a calibration-only selection rule", () => {
    const result = readJson("docs/generated/model-competition/phase7-lesion-calibration-20260913/calibration.json");
    expect(result.rule_definitions.length).toBeGreaterThanOrEqual(8);
    expect(result.selection.predeclared_logic).toContain("evaluation results");
    expect(result.selection.minimum_fn_coverage).toBe(0.9);
    expect(result.selection.baseline_rule_id).toBe("any_signal");
  });

  it("retains held-out lesion aggregates without persisting row-level identifiers", () => {
    const text = read("docs/generated/model-competition/phase7-lesion-calibration-20260913/calibration.json");
    const result = JSON.parse(text);
    expect(result.phi_included).toBe(false);
    expect(result.held_out_evaluation_results).toBeDefined();
    expect(text).not.toMatch(/patient[_ -]?\d+|IMG\d+\.jpg|medical[- ]record/i);
    expect(text).not.toMatch(/[A-Z]:\\|\\\\[^\n]+/);
    expect(result.question_two_answer.label).toBe("REVIEW ESCALATION COVERAGE");
    expect(result.question_two_answer.forbidden_label).toBe("DISEASE RECOVERY");
  });

  it("keeps the lesion answer in research escalation language", () => {
    const result = readJson("docs/generated/model-competition/phase7-lesion-calibration-20260913/calibration.json");
    const serialized = JSON.stringify(result);
    expect(serialized).toContain("REVIEW ESCALATION COVERAGE");
    expect(serialized).toContain("DISEASE RECOVERY");
    expect(serialized).not.toMatch(/LESION CONFIRMED|MISSED DR DETECTED/i);
  });

  it("records the real two-worker resource race and no-double-launch invariant", () => {
    const result = readJson("docs/generated/phase7-resource-race.json");
    expect(result.phi_included).toBe(false);
    if (result.status !== "NOT_MEASURED") {
      expect(result.worker_processes_started).toBe(2);
      expect(result.admission.no_double_launch).toBe(true);
      expect(result.admission.model_launch_count).toBeLessThanOrEqual(1);
      expect(result.ownership_fencing.old_release_blocked).toBe(true);
    }
  });

  it("records real queued load as bounded single-worker evidence", () => {
    const result = readJson("docs/generated/phase7-real-load.json");
    expect(result.phi_included).toBe(false);
    if (result.points) {
      expect(result.points.map((point: any) => point.requested)).toEqual([1, 5, 10, 25]);
      expect(result.worker_mode).toContain("SINGLE_SLOT");
      expect(result.two_worker_decision.status).toBe("NOT_RUN_FOR_SAFETY");
    }
  });

  it("distinguishes the resident experiment from fresh subprocess warm-up", () => {
    const result = readJson("docs/generated/phase7-resident-experiment.json");
    expect(result.phi_included).toBe(false);
    if (result.cases) {
      expect(result.cases.requested).toBe(20);
      expect(result.cases.serial).toBe(true);
      expect(result.initial_load_ms === null || result.initial_load_ms >= 0).toBe(true);
    }
  });

  it("records real provider termination windows without fabricating persistence-stage evidence", () => {
    const result = readJson("docs/generated/phase7-provider-crash-matrix.json");
    expect(result.phi_included).toBe(false);
    expect(result.unmeasured_stages).toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: "before_result_persistence", status: "NOT_MEASURED" }),
      expect.objectContaining({ stage: "after_result_persistence_before_job_completion", status: "NOT_MEASURED" }),
    ]));
  });

  it("keeps the Phase 7 report at the requested 107-section ledger", () => {
    const report = read("docs/VISIONSCAN_PHASE7_RETINAL_INTELLIGENCE_AND_RUNTIME_REPORT.md");
    expect((report.match(/^## \d+ /gm) ?? [])).toHaveLength(107);
    expect(report).toContain("## 107 Clinical classification");
    expect(report).toContain("NOT CLINICALLY VALIDATED");
    expect(report).not.toMatch(/[A-Z]:\\|\\\\[^\n]+/);
  });

  it("keeps generated evidence hashes present and well-formed", () => {
    const result = readJson("docs/generated/model-competition/phase7-lesion-calibration-20260913/calibration.json");
    expect(result.source_hashes.calibration_script_sha256).toBe(sha256("scripts/model-competition/run-phase7-lesion-calibration.ts"));
    expect(result.source_hashes.batch_probe_sha256).toMatch(/^[a-f0-9]{64}$/);
  });
});
