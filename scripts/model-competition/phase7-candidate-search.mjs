#!/usr/bin/env node

/**
 * Publish the bounded Phase 7 second-candidate screen.
 *
 * This is intentionally a source-and-rights ledger, not a downloader. A
 * repository license is never promoted to a weight license, and a README
 * link is never treated as an immutable artifact hash. The result is safe to
 * run in CI because it contains no credentials, network-derived bytes, or
 * model files.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUTPUT = path.join(ROOT, "docs", "generated", "phase7-candidate-search.json");

function sha256(relativePath) {
  try {
    return crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, relativePath))).digest("hex");
  } catch {
    return null;
  }
}

const candidates = [
  {
    candidate_id: "abssnet-dr-v1.0.0",
    source_repository: "https://github.com/guptapradeep85/ABSSNET",
    source_revision: "Zenodo software archive 10.5281/zenodo.21459156; GitHub main tree reviewed",
    artifact_url: "https://zenodo.org/records/21459156",
    artifact_format: "PyTorch .pth per-fold checkpoints",
    artifact_sha256: null,
    license: {
      code: "MIT (repository metadata)",
      weights: "NOT_SEPARATELY_SPECIFIED",
      dataset: "Third-party Kaggle APTOS-derived data under provider terms",
      commercial: "NOT_ESTABLISHED",
      redistribution: "NOT_ESTABLISHED",
      research: "NOT_ESTABLISHED_FROM_A_WEIGHT_LICENSE",
    },
    task: "five-class ICDR diabetic retinopathy grading",
    preprocessing: "CLAHE on LAB L, 224x224 bilinear, ImageNet normalization; source-described",
    runtime: "PyTorch/timm; CPU feasibility not demonstrated in VisionScan",
    artifact_state: "NO_CANONICAL_LOCAL_CHECKPOINT",
    rights_state: "WEIGHTS_RIGHTS_UNVERIFIED",
    decision: "BLOCKED_BEFORE_INFERENCE",
    blockers: [
      "The GitHub tree contains source and derived tables but no .pth/.pt/ONNX/SafeTensors checkpoint.",
      "The Zenodo metadata describes trained checkpoints but does not separately establish weight redistribution or commercial rights.",
      "The published training/evaluation data are not the frozen DeepDRiD validation export.",
      "The available checkpoint format would require isolated inspection before any runtime use.",
    ],
  },
  {
    candidate_id: "retinalens-dr-v1.0.0",
    source_repository: "https://github.com/egwaojeangel/retinalens-ai-diabetic-retinopathy-detection",
    source_revision: "GitHub main tree reviewed",
    artifact_url: "https://github.com/egwaojeangel/retinalens-ai-diabetic-retinopathy-detection",
    artifact_format: "UNLOCATED",
    artifact_sha256: null,
    license: {
      code: "Repository LICENSE present; exact weight terms not established",
      weights: "UNVERIFIED",
      dataset: "Multiple third-party datasets described by README; terms not bundled",
      commercial: "UNVERIFIED",
      redistribution: "UNVERIFIED",
      research: "UNVERIFIED",
    },
    task: "five-class diabetic retinopathy grading described by source",
    preprocessing: "Source-described; no pinned VisionScan-compatible artifact",
    runtime: "PyTorch/EfficientNet application; CPU feasibility not demonstrated in VisionScan",
    artifact_state: "NO_CANONICAL_LOCAL_CHECKPOINT_IN_REVIEWED_TREE",
    rights_state: "WEIGHTS_RIGHTS_UNVERIFIED",
    decision: "BLOCKED_BEFORE_INFERENCE",
    blockers: [
      "The reviewed source tree contains no canonical model checkpoint with a reproducible digest.",
      "The repository description is not evidence of a redistributable weight artifact.",
    ],
  },
  {
    candidate_id: "retfound-aptos-task-head-v1",
    source_repository: "https://github.com/rmaphoh/RETFound",
    source_revision: "BENCHMARK.md and README.md reviewed",
    artifact_url: "https://github.com/rmaphoh/RETFound",
    artifact_format: "PyTorch checkpoint via external download",
    artifact_sha256: null,
    license: {
      code: "Repository license reviewed",
      weights: "ACCESS_AGREEMENT_REQUIRED_OR_NOT_RECORDED_FOR_THIS_RUN",
      dataset: "APTOS/Kaggle provider terms",
      commercial: "NOT_ESTABLISHED",
      redistribution: "NOT_ESTABLISHED",
      research: "ACCESS_NOT_OBTAINED",
    },
    task: "APTOS2019 five-class diabetic retinopathy task head listed by source",
    preprocessing: "224x224 source pipeline; exact task-head artifact and local parity unavailable",
    runtime: "PyTorch/torchrun; no local artifact or CPU experiment",
    artifact_state: "NOT_ACQUIRED",
    rights_state: "ACCESS_AND_WEIGHT_RIGHTS_UNRESOLVED",
    decision: "BLOCKED_BEFORE_INFERENCE",
    blockers: [
      "The task checkpoint is obtained through external access-controlled download links.",
      "No authenticated access or weight artifact was supplied for this run.",
      "Foundation weights without a validated task head are not a DR candidate.",
    ],
  },
];

const result = {
  schema_version: "visionscan-phase7-candidate-search-v1",
  observed_at: new Date().toISOString(),
  search_scope: ["ABSSNET", "RetinaLens", "RETFound task-specific head"],
  rights_gate_before_artifact_execution: true,
  artifact_gate_before_preprocessing: true,
  candidates,
  selected_candidate_id: null,
  decision: "NO_SECOND_CANDIDATE_BENCHMARK_READY",
  stop_reason: "No candidate simultaneously supplied a canonical immutable artifact, separately supportable weight rights, and a VisionScan-verifiable preprocessing/output contract.",
  no_unknown_weights_loaded: true,
  phi_included: false,
  source_hashes: {
    script_sha256: sha256("scripts/model-competition/phase7-candidate-search.mjs"),
  },
  limitations: [
    "This screen records public source evidence and does not imply that an unacquired artifact is invalid.",
    "A future candidate requires a canonical artifact URL and SHA-256, separate weight rights, isolated inspection if pickle-based, and publisher/local preprocessing parity before inference.",
    "No candidate metrics are copied into VisionScan results from publisher reports.",
  ],
};

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, `${JSON.stringify(result, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ status: result.decision, output: path.relative(ROOT, OUTPUT), candidates: candidates.length }, null, 2)}\n`);
