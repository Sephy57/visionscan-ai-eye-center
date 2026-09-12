#!/usr/bin/env -S npx vite-node

/**
 * Create the PHI-free Phase 6 competition bundle. This command packages the
 * frozen baseline and the RetGuard integrity/rights stop decision; it never
 * runs a candidate and never changes registry state.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  candidateManifestFromBaseline,
  notMeasuredResult,
  type CompetitionEvidenceRef,
  type DrCompetitionRunManifest,
  type DrCompetitionRunResult,
} from "../../lib/models/competitionContract";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_RUN_ID = "phase6-retguard-20260913";
const CANDIDATE_MODEL_ID = "retguard-dr-v1.0.0";
const CANDIDATE_MODEL_VERSION = "v1.0.0";
const CANDIDATE_SHA256 = "f0e19fa86d5a27a05731550d1d6708c01f6f363f45a1fa57849de988f91e775b";
const ARCHIVE_SHA256 = "663c7f8bbc3676df2fe353efa0f3913c757db8c35cf9bf97ab451a756792d2e0";
const CANDIDATE_ARTIFACT_PATH = "scratch/phase6-candidates/retguard-dr-v1.0.0/extracted/retguard_dr_v1.0.0.onnx";
const CANDIDATE_MANIFEST_PATH = "docs/model-manifests/retguard-dr-v1.0.0-candidate.json";
const RIGHTS_DOSSIER_PATH = "docs/PHASE6_CANDIDATE_RIGHTS_DOSSIER.md";
const ACQUISITION_PATH = "docs/model-manifests/retguard-dr-v1.0.0-acquisition.json";

function readJson(relativePath: string): any {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function sha256File(relativePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, relativePath))).digest("hex");
}

function evidence(id: string, relativePath: string, role: CompetitionEvidenceRef["role"]): CompetitionEvidenceRef {
  return { id, path: relativePath, sha256: sha256File(relativePath), role };
}

function runId(): string {
  const index = process.argv.indexOf("--run-id");
  const supplied = index >= 0 ? process.argv[index + 1] : undefined;
  if (supplied && /^[A-Za-z0-9._-]{1,100}$/.test(supplied)) return supplied;
  return DEFAULT_RUN_ID;
}

function baselineBundle(): { manifest: DrCompetitionRunManifest; result: DrCompetitionRunResult } {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "visionscan-phase6-freeze-"));
  try {
    const freezer = path.join(ROOT, "scripts", "model-competition", "freeze-dr-baseline.mjs");
    execFileSync(process.execPath, [freezer, "--output-dir", temporary], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return {
      manifest: readJsonFrom(path.join(temporary, "dr-baseline-run-manifest.json")),
      result: readJsonFrom(path.join(temporary, "dr-baseline-run-result.json")),
    };
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

function readJsonFrom(filePath: string): any {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(directory: string, name: string, value: unknown): void {
  fs.writeFileSync(path.join(directory, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function main(): void {
  const id = runId();
  const output = path.join(ROOT, "docs", "generated", "model-competition", id);
  fs.mkdirSync(output, { recursive: true });
  const baseline = baselineBundle();
  const candidateManifest = candidateManifestFromBaseline(
    baseline.manifest,
    {
      model_id: CANDIDATE_MODEL_ID,
      model_version: CANDIDATE_MODEL_VERSION,
      artifact_path: CANDIDATE_ARTIFACT_PATH,
      artifact_sha256: CANDIDATE_SHA256,
      artifact_format: "onnx",
    },
    `${id}-candidate-manifest`,
    "2026-09-13T00:00:00.000Z",
  );
  const candidateEvidence = [
    evidence("retguard-candidate-manifest", CANDIDATE_MANIFEST_PATH, "model_manifest"),
    evidence("retguard-rights-dossier", RIGHTS_DOSSIER_PATH, "result_source"),
    evidence("retguard-acquisition-record", ACQUISITION_PATH, "result_source"),
  ];
  const candidate = notMeasuredResult({
    manifest: candidateManifest,
    result_id: `${id}-candidate-result`,
    evidence: candidateEvidence,
    limitations: [
      "Candidate is RIGHTS_RESTRICTED and CANDIDATE_ONLY; no promotion or redistribution authorization is recorded.",
      "Published RetGuard ONNX logit parity gate failed: maximum logit difference 0.002526 against a 0.001 tolerance on six samples.",
      "Candidate input is 480x480 while the frozen VisionScan competition contract is 3x512x512; no semantic conversion was accepted.",
      "Publisher-reported calibration ECE is above its stated gate; this is not local calibration evidence.",
      "Candidate inference was stopped before predictions; FN recovery, FP burden, high-grade behavior, threshold curves, and ensembles are unmeasured.",
    ],
  });
  const pairedErrors = {
    schema_version: "visionscan-phase6-paired-errors-v1",
    measurement_state: "NOT_MEASURED",
    case_set: { dataset: baseline.manifest.dataset.name, case_count: baseline.manifest.dataset.case_count, patient_count: baseline.manifest.dataset.patient_count, case_keys: "NOT_INCLUDED_HASH_ONLY_POLICY" },
    counts: { baseline_wrong_candidate_correct: null, baseline_correct_candidate_wrong: null, both_correct: null, both_wrong: null },
    fn_recovery: { baseline_fn_count: baseline.result.metrics?.referable.confusion.fn ?? null, fn_recovered: null, fn_shared: null, fn_new: null, candidate_failed: null, candidate_unavailable: baseline.manifest.dataset.case_count },
    fp_cost: { baseline_fp: baseline.result.metrics?.referable.confusion.fp ?? null, candidate_fp: null, new_fp: null, removed_fp: null, shared_fp: null },
    reason: "Candidate did not reach benchmark-ready status; no candidate row was generated.",
  };
  const metrics = {
    schema_version: "visionscan-phase6-metrics-v1",
    baseline: baseline.result.metrics,
    candidate: null,
    comparison: { status: "BLOCKED", reasons: ["Candidate result is NOT_MEASURED; no metric is inferred."] },
  };
  const confusion = {
    schema_version: "visionscan-phase6-confusion-v1",
    baseline: baseline.result.metrics?.multiclass.confusion_true_x_pred ?? null,
    candidate: null,
    note: "Candidate confusion matrix is not generated because no candidate case was executed.",
  };
  const runtime = {
    schema_version: "visionscan-phase6-runtime-v1",
    candidate: { model_id: CANDIDATE_MODEL_ID, artifact_sha256: CANDIDATE_SHA256, archive_sha256: ARCHIVE_SHA256, graph_load: "PASSED", cpu_execution_provider: "PASSED", input_shape: ["batch_size", 3, 480, 480], inference: "NOT_RUN_STOP_RULE_ONNX_LOGIT_PARITY_FAILED", process_tree: "NOT_APPLICABLE" },
    approved_local_artifacts: { source: "docs/generated/phase6-model-benchmark.json", status: "BOUNDED_ONE_COLD_ONE_WARM_OBSERVATION" },
    claims_not_supported: ["production capacity", "resident-worker safety", "1/5/10/25 model load curve", "universal orphan freedom"],
  };
  const limitations = {
    schema_version: "visionscan-phase6-limitations-v1",
    primary_outcome: "DR CANDIDATE EVALUATED — IMPROVEMENT NOT ESTABLISHED",
    candidate_stop_rule: "ONNX_LOGIT_PARITY_FAILED",
    no_cherry_picking: true,
    phi_included: false,
    limitations: [
      "RetGuard was authenticated and graph-loaded, but was not benchmark-ready under the frozen protocol.",
      "The bundle contains no raw patient identifiers, source image bytes, or per-case identifiers.",
      "Lesion escalation is a separate aggregate technical-research study; it is not substituted for the blocked DR candidate head-to-head and does not establish disease recovery.",
      "Research evidence is not clinical validation and cannot establish diagnosis, normality, or treatment safety.",
    ],
  };
  const review = {
    schema_version: "visionscan-phase6-review-v1",
    promotion_decision: "NOT_ELIGIBLE",
    candidate_lifecycle: "CANDIDATE_ONLY",
    formal_three_reviewer_gate: "NOT_COMPLETE",
    reviewers: [
      { role: "Implementation Reviewer", status: "PENDING_FORMAL_SIGNOFF" },
      { role: "Validation/Statistics Reviewer", status: "PENDING_FORMAL_SIGNOFF" },
      { role: "Safety/Governance Reviewer", status: "PENDING_FORMAL_SIGNOFF" },
    ],
    reason: "No candidate promotion is permitted without three independent reviewer sign-offs and a measured, comparable result.",
  };
  writeJson(output, "manifest.json", {
    schema_version: "visionscan-phase6-model-competition-bundle-v1",
    run_id: id,
    source_commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
    generated_at: new Date().toISOString(),
    phi_included: false,
    frozen_baseline_manifest: baseline.manifest,
    candidate_manifest: candidateManifest,
    candidate_governance: { rights_state: "RIGHTS_RESTRICTED", lifecycle_status: "CANDIDATE_ONLY", validation_state: "NOT_BENCHMARK_READY", runtime_state: "GRAPH_LOAD_ONLY" },
  });
  writeJson(output, "baseline.json", baseline.result);
  writeJson(output, "candidate.json", candidate);
  writeJson(output, "paired-errors.json", pairedErrors);
  writeJson(output, "metrics.json", metrics);
  writeJson(output, "confusion-matrix.json", confusion);
  writeJson(output, "runtime.json", runtime);
  writeJson(output, "limitations.json", limitations);
  writeJson(output, "review.json", review);
  const names = ["manifest.json", "baseline.json", "candidate.json", "paired-errors.json", "metrics.json", "confusion-matrix.json", "runtime.json", "limitations.json", "review.json"];
  writeJson(output, "hashes.json", { schema_version: "visionscan-phase6-bundle-hashes-v1", files: Object.fromEntries(names.map((name) => [name, crypto.createHash("sha256").update(fs.readFileSync(path.join(output, name))).digest("hex")])), excludes: ["hashes.json"] });
  process.stdout.write(`${JSON.stringify({ status: "PHASE6_BUNDLE_CREATED", run_id: id, output: path.relative(ROOT, output), candidate_state: candidate.measurement_state }, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
