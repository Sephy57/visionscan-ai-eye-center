#!/usr/bin/env node
/**
 * Create a deterministic, PHI-minimizing adjudication record for every
 * reconciliation finding.  By default this is read-only.  `--apply-quarantine`
 * moves only unreferenced upload files into a preserved quarantine tree after
 * rechecking their canonical path and hash; it never imports or deletes bytes.
 */
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import crypto from "crypto";
import { scanReconciliation, type ReconciliationIssue } from "../lib/storage/reconciliation";
import { dbAll } from "../lib/storage/db";
import { DATA_ROOT, UPLOAD_ROOT } from "../lib/config";

const repo = process.cwd();
const applyQuarantine = process.argv.includes("--apply-quarantine");
const outputArgIndex = process.argv.indexOf("--output");
const outputArg = outputArgIndex >= 0 ? process.argv[outputArgIndex + 1] : "docs/generated/reconciliation-adjudication.json";
const output = path.resolve(repo, outputArg);
const runAt = new Date().toISOString();
const runId = `reconciliation-${runAt.replace(/[^0-9]/g, "").slice(0, 14)}`;

function hashBytes(value: Buffer | string): string { return crypto.createHash("sha256").update(value).digest("hex"); }
function relFromRepo(value: string | undefined): string | null {
  if (!value) return null;
  const relative = path.relative(repo, value);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative.replaceAll(path.sep, "/") : null;
}
function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
async function noSymlinkAncestors(value: string): Promise<void> {
  let current = path.resolve(value);
  while (true) {
    if (fsSync.existsSync(current) && (await fs.lstat(current)).isSymbolicLink()) throw new Error(`Symlink/reparse path rejected: ${current}`);
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}
async function quarantine(issue: ReconciliationIssue): Promise<{ action: string; path: string | null; hash: string | null }> {
  if (!issue.path) return { action: "manual_review", path: null, hash: null };
  const source = path.resolve(issue.path);
  const uploadRoot = path.resolve(UPLOAD_ROOT);
  if (!isWithin(uploadRoot, source) || source === uploadRoot) throw new Error(`Refusing to quarantine outside uploads: ${source}`);
  await noSymlinkAncestors(source);
  const sourceStat = await fs.lstat(source);
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) throw new Error(`Refusing unsafe orphan: ${source}`);
  const bytes = await fs.readFile(source);
  const hash = hashBytes(bytes);
  const relative = path.relative(uploadRoot, source);
  const destination = path.resolve(DATA_ROOT, "quarantine", "reconciliation", runId, relative);
  if (!isWithin(path.resolve(DATA_ROOT, "quarantine"), destination)) throw new Error("Quarantine path escaped root");
  await noSymlinkAncestors(path.dirname(destination));
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.rename(source, destination);
  const moved = await fs.readFile(destination);
  if (hashBytes(moved) !== hash) throw new Error(`Quarantine hash verification failed: ${relative}`);
  return { action: "quarantine_orphan", path: relFromRepo(destination), hash };
}

const [studies, reports, analyses] = await Promise.all([
  dbAll<Record<string, unknown>>("studies"),
  dbAll<Record<string, unknown>>("reports"),
  dbAll<Record<string, unknown>>("analyses"),
]);
const studyById = new Map(studies.map((row) => [String(row.study_id), row]));
const reportById = new Map(reports.map((row) => [String(row.report_id), row]));
const analysisById = new Map(analyses.map((row) => [String(row.analysis_id), row]));
const records: Array<Record<string, unknown>> = [];
let quarantineCount = 0;
for (const issue of (await scanReconciliation()).issues) {
  const study = studyById.get(issue.resource_id);
  const report = reportById.get(issue.resource_id);
  const analysis = analysisById.get(issue.resource_id);
  const sourceRecord = study ?? report ?? analysis;
  const lifecycle = String(sourceRecord?.lifecycle ?? sourceRecord?.archive_state ?? "").toUpperCase();
  const sourceStatus = typeof sourceRecord?.status === "string" ? sourceRecord.status.toUpperCase() : null;
  const activeOrLegacy = lifecycle === "DELETED" || sourceStatus === "DELETED" ? "LEGACY" : "ACTIVE";
  let classification: string;
  let repairAction: string;
  let result: string;
  let hash: string | null = null;
  let recordPath = relFromRepo(issue.path);
  if (issue.kind === "FILE_WITHOUT_DB_ROW") {
    classification = "QUARANTINED_ORPHAN";
    repairAction = applyQuarantine ? "quarantine_orphan" : "quarantine_orphan_pending_operator";
    result = applyQuarantine ? "QUARANTINED_ORPHAN" : "MANUAL_REVIEW_REQUIRED";
    if (applyQuarantine) {
      const moved = await quarantine(issue);
      recordPath = moved.path;
      hash = moved.hash;
      quarantineCount += 1;
    }
  } else if (lifecycle === "DELETED") {
    classification = "VALID_LEGACY_STATE";
    repairAction = "none";
    result = "DOCUMENTED_EXPECTED_LEGACY";
  } else if (issue.kind === "MISSING_REPORT_EXPORT" && report?.version_freeze) {
    classification = "REBUILDABLE_DERIVATIVE";
    repairAction = "rebuild_derivative";
    result = "MANUAL_REVIEW_REQUIRED";
  } else if (issue.kind === "DB_ROW_WITHOUT_FILE") {
    classification = "MISSING_REQUIRED_ARTIFACT";
    repairAction = "mark_unavailable";
    result = "SOURCE_ARTIFACT_UNAVAILABLE";
    const files = Array.isArray(study?.files) ? study.files as Array<Record<string, unknown>> : [];
    const expected = files.find((file) => issue.path && typeof file.relativePath === "string" && path.resolve(UPLOAD_ROOT, file.relativePath) === path.resolve(issue.path));
    hash = typeof expected?.sha256 === "string" ? expected.sha256 : null;
  } else {
    classification = "MANUAL_REVIEW_REQUIRED";
    repairAction = "manual_review";
    result = "MANUAL_REVIEW_REQUIRED";
  }
  records.push({
    finding_id: issue.issue_id,
    finding_type: issue.kind,
    entity_type: issue.resource,
    entity_id: issue.resource_id,
    path: recordPath,
    hash,
    patient_scope: null,
    tenant_scope: null,
    reason: issue.detail,
    classification,
    repair_action: repairAction,
    reviewer: "release-auditor",
    timestamp: runAt,
    result,
    source_lifecycle: lifecycle || null,
    source_status: sourceStatus,
    active_or_legacy: activeOrLegacy,
    source_classification: activeOrLegacy === "LEGACY" ? "LEGACY_STALE_REFERENCE" : "REAL_REQUIRED_SOURCE",
    release_impact: activeOrLegacy === "LEGACY" ? "NON_BLOCKING_LEGACY" : "ACTIVE_RELEASE_BLOCKER",
    evidence: {
      source_bytes_present: issue.kind !== "DB_ROW_WITHOUT_FILE" ? null : false,
      content_hash_present: Boolean(hash),
      parent_or_source_missing: issue.kind === "DB_ROW_WITHOUT_FILE",
      lifecycle_explicit: Boolean(lifecycle),
      status_explicit: Boolean(sourceStatus),
    },
    safe_scope_note: "Patient and tenant identifiers are intentionally omitted; correlate by finding_id in the local operator console.",
  });
}
const counts = Object.fromEntries(records.reduce((map, row) => {
  const key = String(row.classification);
  map.set(key, (map.get(key) ?? 0) + 1);
  return map;
}, new Map<string, number>()));
const outputRecord = {
  format: "visionscan-reconciliation-adjudication-v1",
  generated_at: runAt,
  run_id: runId,
  database_file: "<configured-database>",
  auto_repair: false,
  quarantine_applied: applyQuarantine,
  quarantine_count: quarantineCount,
  counts,
  total_findings: records.length,
  phi_included: false,
  records,
};
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, `${JSON.stringify(outputRecord, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ output, run_id: runId, total_findings: records.length, counts, quarantine_applied: applyQuarantine, quarantine_count: quarantineCount }, null, 2));
