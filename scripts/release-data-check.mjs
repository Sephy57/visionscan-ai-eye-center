#!/usr/bin/env node
/**
 * Read-only release data integrity gate.
 *
 * This command deliberately reports historical failures instead of rewriting
 * them.  A non-zero exit means an active unresolved source or active FK
 * orphan remains; callers can still inspect the PHI-minimizing JSON report.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { buildFkOrphanReport } from "./fk-orphan-report.mjs";

const repo = process.cwd();
const dataRoot = path.resolve(process.env.DATA_ROOT ?? path.join(repo, "data"));
const uploadRoot = path.resolve(process.env.UPLOAD_ROOT ?? path.join(dataRoot, "uploads"));
const reportRoot = path.resolve(process.env.REPORT_ROOT ?? path.join(dataRoot, "reports"));
const database = path.resolve(process.env.DATABASE_FILE ?? path.join(dataRoot, "database", "eye-ai.db"));
const outputIndex = process.argv.indexOf("--output");
const outputArg = outputIndex >= 0 ? process.argv[outputIndex + 1] : "docs/generated/release-data-check.json";

function parsePayload(payload) {
  try { return JSON.parse(payload); } catch { return {}; }
}

function valueOf(record, field) {
  const camel = field.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  const value = record?.[field] ?? record?.[camel];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function lifecycleOf(record) {
  const lifecycle = String(record?.lifecycle ?? record?.archive_state ?? "").toUpperCase();
  const status = String(record?.status ?? "").toUpperCase();
  if (lifecycle === "DELETED" || status === "DELETED") return "DELETED";
  if (lifecycle === "ARCHIVED") return "ARCHIVED";
  return "ACTIVE";
}

function hashFile(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function countFiles(root) {
  if (!fs.existsSync(root)) return 0;
  let count = 0;
  const visit = (dir) => {
    const stat = fs.lstatSync(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return;
    for (const name of fs.readdirSync(dir)) {
      const child = path.join(dir, name);
      const childStat = fs.lstatSync(child);
      if (childStat.isSymbolicLink()) continue;
      if (childStat.isDirectory()) visit(child);
      else if (childStat.isFile()) count += 1;
    }
  };
  visit(root);
  return count;
}

function readRows(db, collection) {
  return db.prepare(`SELECT id, payload, created_at, updated_at FROM "${collection}"`)
    .all()
    .map((row) => ({ ...parsePayload(row.payload), _id: row.id, _db_created_at: row.created_at, _db_updated_at: row.updated_at }));
}

function classifySource(lifecycle) {
  return lifecycle === "DELETED" ? "legacy" : "active";
}

function buildSourceSummary() {
  if (!fs.existsSync(database)) throw new Error(`Database not found: ${database}`);
  const db = new Database(database, { readonly: true, fileMustExist: true });
  try {
    const studies = readRows(db, "studies");
    const studyIds = new Set(studies.map((row) => String(row.study_id ?? row._id)));
    const analyses = readRows(db, "analyses");
    const reports = readRows(db, "reports");
    let active = 0;
    let legacy = 0;
    let hashMismatch = 0;
    const sourceReasons = new Map();
    const addSource = (bucket, reason) => {
      if (bucket === "active") active += 1;
      else legacy += 1;
      const key = `${bucket}:${reason}`;
      sourceReasons.set(key, (sourceReasons.get(key) ?? 0) + 1);
    };

    for (const study of studies) {
      const files = Array.isArray(study.files) ? study.files : [];
      for (const file of files) {
        if (!file || typeof file.relativePath !== "string") {
          addSource(classifySource(lifecycleOf(study)), "MISSING_PATH_METADATA");
          continue;
        }
        const source = path.resolve(uploadRoot, file.relativePath);
        const relative = path.relative(uploadRoot, source);
        const insideRoot = relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
        const stat = insideRoot && fs.existsSync(source) ? fs.lstatSync(source) : null;
        if (!stat || !stat.isFile() || stat.isSymbolicLink()) {
          addSource(classifySource(lifecycleOf(study)), "MISSING_REQUIRED_ARTIFACT");
          continue;
        }
        const expected = typeof file.sha256 === "string" ? file.sha256 : null;
        if (expected && hashFile(source) !== expected) hashMismatch += 1;
      }
    }

    // Reconciliation treats a detached analysis as an unresolved source
    // dependency: it cannot be replayed without its missing study parent.
    for (const analysis of analyses) {
      const studyId = valueOf(analysis, "study_id");
      if (studyId && !studyIds.has(studyId)) addSource(classifySource(lifecycleOf(analysis)), "DETACHED_ANALYSIS_PARENT");
    }

    // Missing report exports are derived-source failures.  Deleted reports
    // remain historical; active reports would be a release blocker.
    for (const report of reports) {
      const reportId = String(report.report_id ?? report._id);
      const reportPath = path.join(reportRoot, `${reportId}.json`);
      if (!fs.existsSync(reportPath)) addSource(classifySource(lifecycleOf(report)), "MISSING_REPORT_EXPORT");
    }

    return {
      active_unresolved_sources: active,
      legacy_unresolved_sources: legacy,
      hash_mismatch_count: hashMismatch,
      source_reason_counts: Object.fromEntries(sourceReasons),
    };
  } finally {
    db.close();
  }
}

function main() {
  const source = buildSourceSummary();
  const fk = buildFkOrphanReport({ database });
  const quarantineRoot = path.join(dataRoot, "quarantine", "reconciliation");
  const quarantineCount = countFiles(quarantineRoot);
  const report = {
    format: "visionscan-release-data-check-v1",
    generated_at: new Date().toISOString(),
    database_file: "<configured-database>",
    active_unresolved_sources: source.active_unresolved_sources,
    legacy_unresolved_sources: source.legacy_unresolved_sources,
    active_fk_orphan_count: fk.active_orphan_count,
    legacy_orphan_count: fk.legacy_orphan_count,
    cross_tenant_count: fk.cross_tenant_count,
    hash_mismatch_count: source.hash_mismatch_count,
    quarantine_count: quarantineCount,
    source_reason_counts: source.source_reason_counts,
    fk_classification_counts: fk.classification_counts,
    fk_relation_counts: fk.relation_counts,
    active_data_release_safe: source.active_unresolved_sources === 0 &&
      fk.active_orphan_count === 0 && fk.cross_tenant_count === 0 && source.hash_mismatch_count === 0,
    status: source.active_unresolved_sources === 0 &&
      fk.active_orphan_count === 0 && fk.cross_tenant_count === 0 && source.hash_mismatch_count === 0
      ? "PASS_ACTIVE_DATA" : "BLOCKERS_REMAIN",
    phi_included: false,
  };
  const output = path.resolve(repo, outputArg);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ output, ...report }, null, 2));
  if (report.status !== "PASS_ACTIVE_DATA") process.exitCode = 1;
}

main();
