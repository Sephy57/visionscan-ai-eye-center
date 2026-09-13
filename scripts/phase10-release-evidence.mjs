#!/usr/bin/env node

/** PHI-free release-data evidence wrapper for the Phase 10 closure report. */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "docs", "generated", "release-data-check.json");
const outputPath = path.join(root, "docs", "generated", "phase10-release-evidence.json");
const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true });
const source = JSON.parse(fs.readFileSync(sourcePath, "utf8"));

const result = {
  schema_version: "visionscan-phase10-release-evidence-v1",
  observed_at: new Date().toISOString(),
  evidence_classification: "INTEGRATION",
  source_artifact: "docs/generated/release-data-check.json",
  source_generated_at: source.generated_at,
  implementation_head_at_capture: String(head.stdout ?? "").trim() || null,
  working_tree_dirty_at_capture: true,
  decision: source.active_data_release_safe ? "DATA_RELEASE_ALLOWED" : "DATA_RELEASE_BLOCKED",
  status: source.status,
  active_data_release_safe: source.active_data_release_safe,
  counts: {
    active_unresolved_sources: source.active_unresolved_sources,
    legacy_unresolved_sources: source.legacy_unresolved_sources,
    active_fk_orphan_count: source.active_fk_orphan_count,
    legacy_orphan_count: source.legacy_orphan_count,
    cross_tenant_count: source.cross_tenant_count,
    hash_mismatch_count: source.hash_mismatch_count,
    quarantine_count: source.quarantine_count,
  },
  source_reason_counts: source.source_reason_counts,
  fk_classification_counts: source.fk_classification_counts,
  fk_relation_counts: source.fk_relation_counts,
  phi_included: false,
  limitations: [
    "The release-data check was run without weakening or deleting unresolved-source, orphan, quarantine, or hash checks.",
    "This artifact is a release-governance result; it is not a claim that unresolved records are safe to publish.",
  ],
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ status: result.status, decision: result.decision, output: path.relative(root, outputPath) }));
