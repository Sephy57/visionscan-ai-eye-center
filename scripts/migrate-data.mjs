#!/usr/bin/env node
/**
 * Import the legacy VisionScan JSON envelope into transactional SQLite.
 * Dry-run is the default. Applying a migration always creates a hashed,
 * ignored backup and verifies counts, hashes, and PRAGMA integrity_check before
 * replacing the destination.
 */
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";

const repo = process.cwd();
const collections = [
  "users", "patients", "encounters", "studies", "documents", "document_pages",
  "derived_assets", "oct_rois", "analyses", "model_executions", "evidence",
  "evidence_dependencies", "reasoning_records", "condition_assessments",
  "specialist_packages", "reports", "clinician_reviews", "jobs", "audit_events",
  "validation_cases", "model_errors", "model_error_adjudications", "test_results",
  "reviews", "devices", "comparisons", "datasets", "dataset_samples", "adjudications",
  "transitions", "evaluation_runs", "model_registry_state", "sessions", "access_grants",
  "consent", "reset_tokens", "calibration_records", "record_extractions",
];
const collectionSet = new Set(collections);
const schemaVersion = 1;
const migrationVersion = 1;
const sqliteHeader = Buffer.from("SQLite format 3\u0000", "ascii");

function valueAfter(flag, fallback) {
  const exact = process.argv.find((arg) => arg === flag);
  if (exact) return process.argv[process.argv.indexOf(exact) + 1] ?? fallback;
  const prefix = process.argv.find((arg) => arg.startsWith(`${flag}=`));
  return prefix ? prefix.slice(flag.length + 1) : fallback;
}

const source = path.resolve(valueAfter("--source", process.env.VISIONSCAN_LEGACY_DATABASE_FILE ?? process.env.LEGACY_DATABASE_FILE ?? path.join(repo, "data", "database", "eye-ai.json")));
const destination = path.resolve(valueAfter("--destination", process.env.VISIONSCAN_SQLITE_DATABASE_FILE ?? process.env.DATABASE_FILE ?? path.join(repo, "data", "database", "eye-ai.db")));
const apply = process.argv.includes("--apply");
const dryRun = process.argv.includes("--dry-run") || !apply;
const force = process.argv.includes("--force");
const requestedReport = valueAfter("--report", null);

function timestamp() {
  return new Date().toISOString();
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function canonicalRecordHash(parsed) {
  const rows = [];
  for (const name of collections) {
    const map = parsed.collections?.[name];
    if (!map || typeof map !== "object" || Array.isArray(map)) continue;
    for (const id of Object.keys(map).sort()) {
      rows.push(`${name}\u0000${id}\u0000${JSON.stringify(map[id])}`);
    }
  }
  return sha256(rows.join("\n"));
}

function safeIdentifier(name) {
  if (!collectionSet.has(name)) throw new Error(`Unsupported collection: ${name}`);
  return `"${name.replaceAll('"', '""')}"`;
}

function schemaSql() {
  return collections.map((name) => {
    const table = safeIdentifier(name);
    return `CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL CHECK(length(payload) > 0), created_at TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS ${name}_updated_at_idx ON ${table}(updated_at);`;
  }).join("\n");
}

function createSchema(db) {
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = FULL");
  db.exec("CREATE TABLE IF NOT EXISTS persistence_meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);");
  db.exec(schemaSql());
}

function readHeader(file) {
  if (!fsSync.existsSync(file)) return "missing";
  const stat = fsSync.statSync(file);
  if (!stat.isFile()) return "not-file";
  if (stat.size === 0) return "empty";
  const fd = fsSync.openSync(file, "r");
  try {
    const header = Buffer.alloc(sqliteHeader.length);
    fsSync.readSync(fd, header, 0, header.length, 0);
    return header.equals(sqliteHeader) ? "sqlite" : "non-sqlite";
  } finally {
    fsSync.closeSync(fd);
  }
}

async function validateSource() {
  const raw = await fs.readFile(source, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || !parsed.collections || typeof parsed.collections !== "object" || Array.isArray(parsed.collections)) {
    throw new Error("Source is not a VisionScan JSON store (missing collections envelope)");
  }
  const counts = {};
  const invalid = [];
  const manualReview = [];
  let validRecords = 0;
  for (const [name, value] of Object.entries(parsed.collections)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      invalid.push({ collection: name, reason: "collection is not an id map" });
      continue;
    }
    counts[name] = Object.keys(value).length;
    if (!collectionSet.has(name)) manualReview.push({ collection: name, reason: "unsupported collection" });
    for (const [id, record] of Object.entries(value)) {
      if (!id || record === undefined) {
        invalid.push({ collection: name, id, reason: "missing id or record" });
        continue;
      }
      try {
        const payload = JSON.stringify(record);
        if (!payload) throw new Error("empty JSON payload");
        if (!collectionSet.has(name)) continue;
        validRecords += 1;
      } catch (error) {
        invalid.push({ collection: name, id, reason: String(error) });
      }
    }
  }
  const references = [
    ["documents", "study_id", "studies"],
    ["analyses", "study_id", "studies"],
    ["reports", "study_id", "studies"],
    ["reasoning_records", "study_id", "studies"],
    ["reasoning_records", "report_id", "reports"],
    ["encounters", "linked_study_ids", "studies"],
    ["consent", "studyId", "studies"],
    ["access_grants", "user_id", "users"],
  ];
  for (const [collection, field, targetCollection] of references) {
    const map = parsed.collections[collection];
    const target = parsed.collections[targetCollection];
    if (!map || typeof map !== "object" || !target || typeof target !== "object") continue;
    let missing = 0;
    for (const record of Object.values(map)) {
      if (!record || typeof record !== "object") continue;
      const value = record[field];
      const values = field === "linked_study_ids" && Array.isArray(value) ? value : [value];
      for (const ref of values) if (typeof ref === "string" && ref && !Object.prototype.hasOwnProperty.call(target, ref)) missing += 1;
    }
    if (missing) manualReview.push({ collection, reason: `missing ${field} references in ${targetCollection}`, count: missing });
  }
  const reports = parsed.collections.reports && typeof parsed.collections.reports === "object" ? parsed.collections.reports : {};
  const legacyReports = Object.entries(reports).filter(([, report]) => {
    const item = report && typeof report === "object" ? report : {};
    return !item.version_freeze || !item.reasoning_snapshot;
  }).map(([id]) => id);
  const sourceBytes = Buffer.byteLength(raw);
  return {
    raw,
    parsed,
    sourceSha256: sha256(raw),
    sourceBytes,
    counts,
    validRecords,
    invalid,
    manualReview,
    manualReviewRecordCount: manualReview.reduce((sum, item) => sum + Number(item.count ?? 1), 0),
    legacyReports,
    sourceVersion: parsed.meta?.version ?? null,
    sourceLastWrite: parsed.meta?.lastWrite ?? null,
    canonicalRecordHash: canonicalRecordHash(parsed),
  };
}

function targetPathFor(reportPath) {
  if (reportPath) return path.resolve(reportPath);
  return path.join(repo, "data", "migrations", "reports", `migration-${Date.now()}.json`);
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
}

async function copyIfPresent(from, to) {
  if (!fsSync.existsSync(from)) return null;
  await fs.copyFile(from, to);
  return sha256(await fs.readFile(to));
}

function destinationMeta() {
  if (readHeader(destination) !== "sqlite") return null;
  const db = new Database(destination, { readonly: true, fileMustExist: true });
  try {
    const row = db.prepare("SELECT value FROM persistence_meta WHERE key = ?").get("migration_source_sha256");
    return row?.value ?? null;
  } catch {
    return null;
  } finally {
    db.close();
  }
}

async function applyMigration(info) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const existingKind = readHeader(destination);
  const existingHash = destinationMeta();
  if (existingHash === info.sourceSha256) {
    return { status: "already_applied", destination, source_sha256: info.sourceSha256 };
  }
  if (existingKind === "sqlite" && existingHash && existingHash !== info.sourceSha256 && !force) {
    throw new Error("Destination contains a different migration source; use --force only after reviewing a backup");
  }
  if (existingKind === "sqlite" && !existingHash && !force) {
    throw new Error("Destination is SQLite but has no migration provenance; use --force only after reviewing a backup");
  }

  const backupDir = path.join(repo, "data", "backups", `migration-${Date.now()}-${process.pid}`);
  await fs.mkdir(backupDir, { recursive: true });
  const sourceBackup = path.join(backupDir, "legacy-store.json");
  await fs.copyFile(source, sourceBackup);
  if (sha256(await fs.readFile(sourceBackup)) !== info.sourceSha256) throw new Error("Legacy backup hash verification failed");
  if (sha256(await fs.readFile(source)) !== info.sourceSha256) throw new Error("Source changed during migration preflight");
  const backupManifest = {
    format: "visionscan-migration-backup-v1",
    created_at: timestamp(),
    source_path: source,
    source_sha256: info.sourceSha256,
    source_bytes: info.sourceBytes,
    destination_path: destination,
    destination_kind: existingKind,
    destination_sha256: null,
    counts: info.counts,
    legacy_report_ids: info.legacyReports,
    credentials_included: false,
  };
  if (existingKind !== "missing" && existingKind !== "not-file") {
    const destinationBackup = path.join(backupDir, "destination.db");
    backupManifest.destination_sha256 = await copyIfPresent(destination, destinationBackup);
    for (const suffix of ["-wal", "-shm"]) await copyIfPresent(`${destination}${suffix}`, `${destinationBackup}${suffix}`);
  }

  const temp = `${destination}.migrate-${process.pid}-${Math.random().toString(36).slice(2, 10)}.tmp`;
  await fs.rm(temp, { force: true });
  await fs.rm(`${temp}-wal`, { force: true });
  await fs.rm(`${temp}-shm`, { force: true });
  let db;
  try {
    db = new Database(temp);
    createSchema(db);
    const setMeta = db.prepare("INSERT INTO persistence_meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
    const inserts = new Map(collections.map((name) => [name, db.prepare(`INSERT INTO ${safeIdentifier(name)}(id, payload, created_at, updated_at) VALUES(?, ?, ?, ?)`)]));
    const migrate = db.transaction(() => {
      for (const [name, value] of Object.entries(info.parsed.collections)) {
        if (!collectionSet.has(name) || !value || typeof value !== "object" || Array.isArray(value)) continue;
        const insert = inserts.get(name);
        for (const [id, record] of Object.entries(value)) {
          const payload = JSON.stringify(record);
          if (!payload) throw new Error(`Empty payload for ${name}/${id}`);
          const created = record && typeof record === "object" && typeof record.created_at === "string" ? record.created_at : timestamp();
          const updated = record && typeof record === "object" && typeof record.updated_at === "string" ? record.updated_at : created;
          insert.run(id, payload, created, updated);
        }
      }
      const metadata = [
        ["schema_version", String(schemaVersion)],
        ["backend", "sqlite"],
        ["migration_version", String(migrationVersion)],
        ["migration_source_sha256", info.sourceSha256],
        ["migration_source_record_hash", info.canonicalRecordHash],
        ["migrated_at", timestamp()],
      ];
      for (const [key, value] of metadata) setMeta.run(key, value);
    });
    migrate();
    for (const [name, expected] of Object.entries(info.counts)) {
      if (!collectionSet.has(name)) continue;
      const actual = db.prepare(`SELECT COUNT(*) AS count FROM ${safeIdentifier(name)}`).get().count;
      if (actual !== expected) throw new Error(`Count verification failed for ${name}: ${actual} != ${expected}`);
    }
    const integrity = db.pragma("integrity_check", { simple: true });
    if (integrity !== "ok") throw new Error(`SQLite integrity_check failed: ${integrity}`);
    db.close();
    db = null;

    const liveBackup = path.join(backupDir, "destination-live.db");
    let movedOld = false;
    try {
      if (existingKind !== "missing" && existingKind !== "not-file") {
        await fs.rename(destination, liveBackup);
        movedOld = true;
        for (const suffix of ["-wal", "-shm"]) {
          if (fsSync.existsSync(`${destination}${suffix}`)) await fs.rename(`${destination}${suffix}`, `${liveBackup}${suffix}`);
        }
      }
      await fs.rename(temp, destination);
    } catch (error) {
      if (movedOld && !fsSync.existsSync(destination) && fsSync.existsSync(liveBackup)) await fs.rename(liveBackup, destination).catch(() => undefined);
      throw error;
    }
    const report = {
      format: "visionscan-persistence-migration-v1",
      status: "applied",
      applied_at: timestamp(),
      source_path: source,
      destination_path: destination,
      source_sha256: info.sourceSha256,
      source_bytes: info.sourceBytes,
      source_record_hash: info.canonicalRecordHash,
      counts: info.counts,
      valid_records: info.validRecords,
      invalid_records: info.invalid,
      manual_review: info.manualReview,
      manual_review_record_count: info.manualReviewRecordCount,
      legacy_report_ids: info.legacyReports,
      legacy_report_policy: "LEGACY_UNSEALED annotation only; no seal or reasoning snapshot is fabricated",
      backup_dir: backupDir,
      credentials_included: false,
    };
    const reportPath = targetPathFor(requestedReport);
    await writeJson(reportPath, report);
    await writeJson(path.join(backupDir, "manifest.json"), backupManifest);
    return { ...report, report_path: reportPath };
  } catch (error) {
    if (db) db.close();
    await fs.rm(temp, { force: true }).catch(() => undefined);
    await fs.rm(`${temp}-wal`, { force: true }).catch(() => undefined);
    await fs.rm(`${temp}-shm`, { force: true }).catch(() => undefined);
    throw error;
  }
}

const info = await validateSource();
const dryResult = {
  format: "visionscan-persistence-migration-v1",
  status: "dry_run",
  dry_run: true,
  generated_at: timestamp(),
  source_path: source,
  destination_path: destination,
  source_sha256: info.sourceSha256,
  source_bytes: info.sourceBytes,
  source_version: info.sourceVersion,
  source_last_write: info.sourceLastWrite,
  source_record_hash: info.canonicalRecordHash,
  collections: info.counts,
  valid_records: info.validRecords,
  invalid_records: info.invalid,
  manual_review: info.manualReview,
  manual_review_record_count: info.manualReviewRecordCount,
  legacy_report_ids: info.legacyReports,
  legacy_report_count: info.legacyReports.length,
  estimated_sqlite_bytes: Math.max(4096, Math.round(info.sourceBytes * 0.75)),
  apply_required: true,
  source_immutable: true,
};
if (dryRun) {
  console.log(JSON.stringify(dryResult, null, 2));
  console.error("Dry run only; no destination, backup, or report was written. Use --apply after reviewing this output.");
} else {
  const result = await applyMigration(info);
  console.log(JSON.stringify(result, null, 2));
}
