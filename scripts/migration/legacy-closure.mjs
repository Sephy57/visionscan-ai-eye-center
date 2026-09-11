#!/usr/bin/env node
/**
 * Evidence-bound legacy relationship closure.
 *
 * This command is intentionally conservative.  The default operation is a
 * read-only plan.  Apply mode only records already-observed legacy orphan
 * relationships in an exception registry; it never guesses a parent, changes
 * a child payload, changes a source file, or deletes a record.  A plan is
 * bound to both the binary database hash and a logical content hash.  The
 * latter allows an exact re-run after this command has added its own registry
 * rows while still rejecting any unrelated database change.
 *
 * The script is kept independent of the application writer so that it can be
 * run against an isolated restore.  A production caller must provide a
 * verified backup manifest, an explicit independent-review artifact, an
 * ADMIN role, and a confirmation phrase before a transaction can start.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";

const REPO = process.cwd();
const DATABASE_DEFAULT = path.join(REPO, "data", "database", "eye-ai.db");
const PLAN_FORMAT = "visionscan-legacy-closure-plan-v1";
const REGISTRY_TABLE = "legacy_relationship_exceptions";
const RUNS_TABLE = "legacy_relationship_closure_runs";
const EXCLUDED_FROM_CONTENT_HASH = new Set([REGISTRY_TABLE, RUNS_TABLE]);
const ALLOWED_LEGACY_CLASSES = new Set([
  "LEGACY_DETACHED_DOCUMENT",
  "LEGACY_DETACHED_ANALYSIS",
  "LEGACY_DETACHED_JOB",
]);
const RELATIONS = [
  ["studies", "patient_id", "patients"],
  ["studies", "encounter_id", "encounters"],
  ["documents", "patient_id", "patients"],
  ["documents", "study_id", "studies"],
  ["analyses", "study_id", "studies"],
  ["reports", "analysis_id", "analyses"],
  ["clinician_reviews", "report_id", "reports"],
  ["reasoning_records", "analysis_id", "analyses"],
  ["model_executions", "analysis_id", "analyses"],
  ["jobs", "study_id", "studies"],
  ["evidence", "analysis_id", "analyses"],
];
const TABLES = new Set(RELATIONS.flatMap(([source, , target]) => [source, target]));
const RELATIONAL_COLUMNS = [
  "patient_id", "encounter_id", "study_id", "document_id", "analysis_id",
  "report_id", "tenant_id", "job_id",
];

function argument(flag, fallback = undefined) {
  const exact = process.argv.find((item) => item === flag);
  if (exact) return process.argv[process.argv.indexOf(exact) + 1] ?? fallback;
  const prefix = process.argv.find((item) => item.startsWith(`${flag}=`));
  return prefix ? prefix.slice(flag.length + 1) : fallback;
}

function hasFlag(flag) {
  return process.argv.includes(flag) || process.argv.some((item) => item.startsWith(`${flag}=`));
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256File(file) {
  return sha256(fs.readFileSync(file));
}

function opaque(value) {
  return sha256(String(value)).slice(0, 16);
}

function parsePayload(value) {
  try { return JSON.parse(value); } catch { return {}; }
}

function camel(field) {
  return field.replace(/_([a-z])/g, (_, character) => character.toUpperCase());
}

function valueOf(row, field) {
  const payload = row?.payload_object ?? parsePayload(row?.payload);
  const value = row?.[field] ?? payload?.[field] ?? payload?.[camel(field)];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function statusOf(row) {
  const payload = row?.payload_object ?? parsePayload(row?.payload);
  const value = payload?.status;
  return typeof value === "string" && value.trim() ? value.trim().toUpperCase() : null;
}

function lifecycleOf(row) {
  const payload = row?.payload_object ?? parsePayload(row?.payload);
  const lifecycle = String(payload?.lifecycle ?? payload?.archive_state ?? "").toUpperCase();
  const status = String(payload?.status ?? "").toUpperCase();
  if (lifecycle === "DELETED" || status === "DELETED") return "DELETED";
  if (lifecycle === "ARCHIVED") return "ARCHIVED";
  return "ACTIVE";
}

function originOf(row) {
  const payload = row?.payload_object ?? parsePayload(row?.payload);
  const actor = [payload?.uploaded_by, payload?.created_by, payload?.owner_username]
    .find((value) => typeof value === "string" && value.trim());
  if (typeof actor === "string" && /(?:tester|synth|fixture|smoke-admin|test)/i.test(actor)) return "TEST_DEV_DATA";
  if (lifecycleOf(row) === "DELETED") return "DELETED_RECORD";
  if (statusOf(row) === "COMPLETED") return "TERMINAL_RECORD";
  return "UNCLASSIFIED";
}

function identifier(value) {
  if (typeof value !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error(`Unsafe SQL identifier: ${value}`);
  return `"${value}"`;
}

function readRows(db, table) {
  const selected = ["id", "payload", "created_at", "updated_at", ...RELATIONAL_COLUMNS];
  return db.prepare(`SELECT ${selected.map(identifier).join(", ")} FROM ${identifier(table)}`)
    .all()
    .map((row) => ({ ...row, payload_object: parsePayload(row.payload) }));
}

function deterministicRow(row) {
  const output = {};
  for (const key of Object.keys(row).filter((name) => name !== "payload_object").sort()) output[key] = row[key];
  return output;
}

/**
 * Logical hash of every application row, excluding only this command's two
 * metadata tables.  It detects a legitimate write even though applying a
 * closure plan necessarily changes the SQLite file bytes.
 */
function contentHash(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((row) => String(row.name))
    .filter((name) => !EXCLUDED_FROM_CONTENT_HASH.has(name));
  const chunks = [];
  for (const table of tables) {
    const columns = db.prepare(`PRAGMA table_info(${identifier(table)})`).all()
      .sort((left, right) => Number(left.pk ?? 0) - Number(right.pk ?? 0) || Number(left.cid ?? 0) - Number(right.cid ?? 0));
    const primary = columns.filter((column) => Number(column.pk ?? 0) > 0).sort((left, right) => Number(left.pk) - Number(right.pk));
    const order = (primary.length > 0 ? primary : columns.slice(0, 1)).map((column) => identifier(String(column.name))).join(", ");
    const rows = db.prepare(`SELECT * FROM ${identifier(table)} ORDER BY ${order || "rowid"}`).all();
    chunks.push(`${table}\u0000${JSON.stringify(rows.map(deterministicRow))}`);
  }
  return sha256(chunks.join("\n"));
}

function classify(source, column, row, reports, referenceId) {
  const lifecycle = lifecycleOf(row);
  const status = statusOf(row);
  const origin = originOf(row);
  if (source === "documents" && (lifecycle === "DELETED" || origin === "TEST_DEV_DATA")) {
    return {
      classification: "LEGACY_DETACHED_DOCUMENT",
      result: "LEGACY_ISOLATED",
      reason_codes: ["PARENT_ABSENT", "CHILD_LOGICALLY_DELETED", "NO_DETERMINISTIC_ID_MAPPING"],
    };
  }
  if (source === "analyses" && column === "study_id" && reports.some((report) => valueOf(report, "study_id") === referenceId)) {
    return {
      classification: "LEGACY_DETACHED_ANALYSIS",
      result: "LEGACY_ISOLATED",
      reason_codes: ["PARENT_ABSENT", "DETACHED_DERIVATIVE_PAIR", "NO_DETERMINISTIC_ID_MAPPING"],
    };
  }
  if (source === "jobs" && status === "COMPLETED") {
    return {
      classification: "LEGACY_DETACHED_JOB",
      result: "LEGACY_ISOLATED",
      reason_codes: ["PARENT_ABSENT", "TERMINAL_JOB", "NO_DETERMINISTIC_ID_MAPPING"],
    };
  }
  return {
    classification: "ACTIVE_UNRESOLVED_REFERENCE",
    result: "ACTIVE_RELEASE_BLOCKER",
    reason_codes: ["PARENT_ABSENT", "NO_DETERMINISTIC_ID_MAPPING"],
  };
}

function scanExceptions(db) {
  const rows = new Map();
  for (const table of TABLES) rows.set(table, readRows(db, table));
  const byId = new Map([...rows.entries()].map(([table, values]) => [table, new Map(values.map((row) => [String(row.id), row]))]));
  const reports = rows.get("reports") ?? [];
  const records = [];
  let crossTenantCount = 0;
  for (const [source, column, target] of RELATIONS) {
    const sourceRows = rows.get(source) ?? [];
    const targetRows = byId.get(target) ?? new Map();
    for (const row of sourceRows) {
      const referenceId = valueOf(row, column);
      if (!referenceId) continue;
      const parent = targetRows.get(referenceId);
      const childTenant = valueOf(row, "tenant_id");
      const parentTenant = parent ? valueOf(parent, "tenant_id") : null;
      if (childTenant && parentTenant && childTenant !== parentTenant) crossTenantCount += 1;
      if (parent) continue;
      const classification = classify(source, column, row, reports, referenceId);
      const relation = `${source}.${column}->${target}`;
      // Bind the plan to the observed lifecycle/status/origin evidence as
      // well as the relation and classification. A later legitimate state
      // transition therefore cannot be silently consumed by an old plan.
      const exceptionHash = sha256(`${relation}\u0000${row.id}\u0000${referenceId}\u0000${classification.classification}\u0000${classification.result}\u0000${classification.reason_codes.join(",")}\u0000${lifecycleOf(row)}\u0000${statusOf(row) ?? ""}\u0000${originOf(row)}`);
      records.push({
        relation,
        child_table: source,
        child_id: String(row.id),
        parent_table: target,
        expected_parent_id: referenceId,
        child_id_hash: opaque(`${source}:${row.id}`),
        expected_parent_id_hash: opaque(`${target}:${referenceId}`),
        exception_hash: exceptionHash,
        classification: classification.classification,
        result: classification.result,
        reason_codes: classification.reason_codes,
        child_lifecycle: lifecycleOf(row),
        child_status: statusOf(row),
        origin: originOf(row),
      });
    }
  }
  records.sort((left, right) => left.exception_hash.localeCompare(right.exception_hash));
  const classificationCounts = Object.fromEntries(records.reduce((counts, record) => {
    counts.set(record.classification, (counts.get(record.classification) ?? 0) + 1);
    return counts;
  }, new Map()));
  return {
    records,
    orphan_count: records.length,
    active_orphan_count: records.filter((record) => record.result === "ACTIVE_RELEASE_BLOCKER").length,
    legacy_orphan_count: records.filter((record) => record.result === "LEGACY_ISOLATED").length,
    cross_tenant_count: crossTenantCount,
    classification_counts: classificationCounts,
  };
}

function planRecords(records) {
  return records.map((record) => ({
    relation: record.relation,
    child_id_hash: record.child_id_hash,
    expected_parent_id_hash: record.expected_parent_id_hash,
    exception_hash: record.exception_hash,
    classification: record.classification,
    result: record.result,
    reason_codes: record.reason_codes,
  }));
}

function canonicalPlan(plan) {
  const copy = JSON.parse(JSON.stringify(plan));
  copy.plan_digest = null;
  return JSON.stringify(copy);
}

function planDigest(plan) {
  return sha256(canonicalPlan(plan));
}

function outputPlan({ database, db, scan }) {
  const integrity = db.pragma("integrity_check", { simple: true });
  if (integrity !== "ok") throw new Error(`SQLite integrity_check failed: ${integrity}`);
  const rawPlan = {
    format: PLAN_FORMAT,
    generated_at: new Date().toISOString(),
    database: {
      file: "<configured-database>",
      sha256: sha256File(database),
      content_sha256: contentHash(db),
      integrity_check: integrity,
      schema_version: db.prepare("SELECT value FROM persistence_meta WHERE key='schema_version'").get()?.value ?? null,
      migration_version: db.prepare("SELECT value FROM persistence_meta WHERE key='migration_version'").get()?.value ?? null,
    },
    counts: {
      orphan_count: scan.orphan_count,
      active_orphan_count: scan.active_orphan_count,
      legacy_orphan_count: scan.legacy_orphan_count,
      cross_tenant_count: scan.cross_tenant_count,
      classification_counts: scan.classification_counts,
    },
    policy: {
      action: "ISOLATE_LEGACY_RELATIONSHIP_EXCEPTION",
      no_reassociation: true,
      no_payload_mutation: true,
      no_source_mutation: true,
      no_deletion: true,
      active_orphans_must_remain_blocked: true,
    },
    preconditions: {
      verified_backup_required: true,
      expected_database_sha256_required: true,
      independent_review_artifact_required: true,
      admin_role_required: true,
      confirmation_required: true,
    },
    records: planRecords(scan.records),
    plan_digest: null,
  };
  rawPlan.plan_digest = planDigest(rawPlan);
  return rawPlan;
}

async function writeExclusive(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
}

function loadJson(file, label) {
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { throw new Error(`${label} is not valid JSON: ${String(error)}`); }
  if (!parsed || typeof parsed !== "object") throw new Error(`${label} must be a JSON object`);
  return parsed;
}

function assertRegularFile(file, label) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file`);
}

function validatePlan(plan) {
  if (plan.format !== PLAN_FORMAT || typeof plan.plan_digest !== "string" || !/^[0-9a-f]{64}$/.test(plan.plan_digest)) {
    throw new Error("Unsupported or malformed closure plan");
  }
  if (planDigest(plan) !== plan.plan_digest) throw new Error("Closure plan digest mismatch; refuse tampered plan");
  if (!plan.database || !/^[0-9a-f]{64}$/.test(plan.database.sha256) || !/^[0-9a-f]{64}$/.test(plan.database.content_sha256)) {
    throw new Error("Closure plan is missing database hash preconditions");
  }
  if (!Array.isArray(plan.records)) throw new Error("Closure plan records must be an array");
  const hashes = plan.records.map((record) => record?.exception_hash).sort();
  if (hashes.some((hash) => typeof hash !== "string" || !/^[0-9a-f]{64}$/.test(hash)) || new Set(hashes).size !== hashes.length) {
    throw new Error("Closure plan contains malformed or duplicate exception hashes");
  }
  for (const record of plan.records) {
    if (!ALLOWED_LEGACY_CLASSES.has(record.classification) || record.result !== "LEGACY_ISOLATED") {
      throw new Error("Closure apply refuses a plan containing an active or unsupported classification");
    }
  }
}

function validateBackup(manifestFile, expectedDatabaseHash) {
  assertRegularFile(manifestFile, "Verified backup manifest");
  const manifest = loadJson(manifestFile, "Verified backup manifest");
  if (!["visionscan-data-backup-v1", "visionscan-closure-backup-v1"].includes(manifest.format)) throw new Error("Unsupported backup manifest format");
  const database = manifest.database;
  if (!database || database.sha256 !== expectedDatabaseHash || database.integrity_check !== "ok") {
    throw new Error("Verified backup does not match the expected database hash/integrity result");
  }
  const backupId = typeof manifest.backup_id === "string" && manifest.backup_id.trim()
    ? manifest.backup_id.trim() : path.basename(path.dirname(path.resolve(manifestFile)));
  if (!backupId || /[\\/]/.test(backupId)) throw new Error("Backup manifest has no safe backup id");
  if (database.backup_sha256) {
    const backupFile = path.resolve(path.dirname(manifestFile), database.backup_file ?? database.file_name ?? "eye-ai.db");
    const backupStat = fs.lstatSync(backupFile);
    if (!backupStat.isFile() || backupStat.isSymbolicLink()) throw new Error("Verified backup database payload is missing or unsafe");
    if (sha256File(backupFile) !== database.backup_sha256) throw new Error("Verified backup payload hash mismatch");
  }
  return { backup_id: backupId, manifest_sha256: sha256File(manifestFile) };
}

function validateReview(reviewFile, expectedPlanDigest, operation) {
  assertRegularFile(reviewFile, "Review artifact");
  const review = loadJson(reviewFile, "Review artifact");
  if (review.format !== "visionscan-legacy-closure-review-v1" || review.plan_digest !== expectedPlanDigest || review.operation !== operation || review.decision !== "APPROVED") {
    throw new Error("Review artifact is not an approval for this plan and operation");
  }
  if (review.reviewer_role !== "INDEPENDENT_DATA_REVIEWER") throw new Error("Review artifact must identify an independent data reviewer role");
  const safety = review.safety_findings;
  if (!safety || safety.fabricated_bytes !== false || safety.guessed_relationships !== false || safety.gate_weakened !== false || safety.active_records_relabelled !== false) {
    throw new Error("Review artifact does not establish the required safety findings");
  }
  if (!Array.isArray(review.evidence_digests) || review.evidence_digests.length < 3 || review.evidence_digests.some((value) => typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value))) {
    throw new Error("Review artifact must bind pre/post reports, the plan, and test evidence by digest");
  }
  return { sha256: sha256File(reviewFile) };
}

function requireAdmin() {
  const role = String(argument("--actor-role", process.env.VISIONSCAN_MIGRATION_ACTOR_ROLE ?? "")).toUpperCase();
  if (role !== "ADMIN") throw new Error("Legacy closure apply requires actor role ADMIN");
  return role;
}

function requireConfirmation(operation) {
  const expected = operation === "APPLY" ? "APPLY_LEGACY_CLOSURE" : "ROLLBACK_LEGACY_CLOSURE";
  if (argument("--confirm", argument("--confirmation", "")) !== expected) throw new Error(`Explicit confirmation required: ${expected}`);
}

function registrySchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${identifier(REGISTRY_TABLE)} (
      exception_hash TEXT PRIMARY KEY NOT NULL,
      relation TEXT NOT NULL,
      child_table TEXT NOT NULL,
      child_id TEXT NOT NULL,
      parent_table TEXT NOT NULL,
      expected_parent_id TEXT NOT NULL,
      classification TEXT NOT NULL CHECK(classification IN ('LEGACY_DETACHED_DOCUMENT','LEGACY_DETACHED_ANALYSIS','LEGACY_DETACHED_JOB')),
      reason_code TEXT NOT NULL,
      created_at TEXT NOT NULL,
      migration_status TEXT NOT NULL CHECK(migration_status IN ('ISOLATED','REASSOCIATED','RETIRED','ROLLED_BACK')),
      review_status TEXT NOT NULL CHECK(review_status IN ('PENDING','INDEPENDENTLY_REVIEWED')),
      plan_digest TEXT NOT NULL,
      backup_id TEXT NOT NULL,
      created_by_role TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS legacy_relationship_exceptions_identity_idx
      ON ${identifier(REGISTRY_TABLE)}(relation, child_id, expected_parent_id);
    CREATE TABLE IF NOT EXISTS ${identifier(RUNS_TABLE)} (
      plan_digest TEXT PRIMARY KEY NOT NULL,
      pre_database_sha256 TEXT NOT NULL,
      content_sha256 TEXT NOT NULL,
      exception_count INTEGER NOT NULL,
      migration_status TEXT NOT NULL CHECK(migration_status IN ('APPLIED','ROLLED_BACK')),
      backup_id TEXT NOT NULL,
      review_artifact_sha256 TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
}

function registryHasPlan(db, plan, scan) {
  if (!db.pragma("table_list").some((table) => table.name === REGISTRY_TABLE)) return false;
  const rows = db.prepare(`SELECT exception_hash, relation, child_table, child_id, parent_table, expected_parent_id, classification, migration_status FROM ${identifier(REGISTRY_TABLE)} WHERE exception_hash = ?`);
  const byHash = new Map(scan.records.map((record) => [record.exception_hash, record]));
  for (const expected of plan.records) {
    const record = byHash.get(expected.exception_hash);
    const found = rows.get(expected.exception_hash);
    if (!record || !found || found.relation !== record.relation || found.child_table !== record.child_table || found.child_id !== record.child_id || found.parent_table !== record.parent_table || found.expected_parent_id !== record.expected_parent_id || found.classification !== record.classification || found.migration_status !== "ISOLATED") return false;
  }
  return true;
}

function createOrApplyRegistry(db, plan, scan, backup, review, actorRole, databaseHash, simulateCrashAfter) {
  const transaction = db.transaction(() => {
    registrySchema(db);
    const insert = db.prepare(`INSERT OR IGNORE INTO ${identifier(REGISTRY_TABLE)} (exception_hash, relation, child_table, child_id, parent_table, expected_parent_id, classification, reason_code, created_at, migration_status, review_status, plan_digest, backup_id, created_by_role) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ISOLATED', 'INDEPENDENTLY_REVIEWED', ?, ?, ?)`);
    const verify = db.prepare(`SELECT relation, child_table, child_id, parent_table, expected_parent_id, classification, migration_status FROM ${identifier(REGISTRY_TABLE)} WHERE exception_hash = ?`);
    let inserted = 0;
    let alreadyPresent = 0;
    for (let index = 0; index < scan.records.length; index += 1) {
      const record = scan.records[index];
      if (!ALLOWED_LEGACY_CLASSES.has(record.classification) || record.result !== "LEGACY_ISOLATED") throw new Error("Active or unsupported exception reached apply transaction");
      const result = insert.run(record.exception_hash, record.relation, record.child_table, record.child_id, record.parent_table, record.expected_parent_id, record.classification, record.reason_codes.join(","), new Date().toISOString(), plan.plan_digest, backup.backup_id, actorRole);
      if (result.changes === 0) alreadyPresent += 1;
      else inserted += 1;
      const found = verify.get(record.exception_hash);
      if (!found || found.relation !== record.relation || found.child_table !== record.child_table || found.child_id !== record.child_id || found.parent_table !== record.parent_table || found.expected_parent_id !== record.expected_parent_id || found.classification !== record.classification || found.migration_status !== "ISOLATED") throw new Error("Existing registry entry conflicts with the reviewed plan");
      if (simulateCrashAfter !== null && index + 1 >= simulateCrashAfter) throw new Error("Simulated crash before transaction commit");
    }
    const runInsert = db.prepare(`INSERT OR IGNORE INTO ${identifier(RUNS_TABLE)} (plan_digest, pre_database_sha256, content_sha256, exception_count, migration_status, backup_id, review_artifact_sha256, actor_role, created_at) VALUES (?, ?, ?, ?, 'APPLIED', ?, ?, ?, ?)`);
    runInsert.run(plan.plan_digest, databaseHash, plan.database.content_sha256, scan.records.length, backup.backup_id, review.sha256, actorRole, new Date().toISOString());
    return { inserted, alreadyPresent };
  });
  return transaction();
}

function rollbackRegistry(db, plan, backup) {
  if (!db.pragma("table_list").some((table) => table.name === RUNS_TABLE)) throw new Error("No closure run exists for this plan");
  const run = db.prepare(`SELECT plan_digest, migration_status, exception_count FROM ${identifier(RUNS_TABLE)} WHERE plan_digest = ?`).get(plan.plan_digest);
  if (!run || run.migration_status !== "APPLIED") throw new Error("Closure plan is not in an applied state");
  const owned = db.prepare(`SELECT COUNT(*) AS count FROM ${identifier(REGISTRY_TABLE)} WHERE plan_digest = ?`).get(plan.plan_digest).count;
  if (Number(owned) !== Number(run.exception_count) || Number(owned) !== plan.records.length) throw new Error("Rollback coverage does not match the applied plan; refusing partial metadata rollback");
  const transaction = db.transaction(() => {
    const conflicting = db.prepare(`SELECT COUNT(*) AS count FROM ${identifier(REGISTRY_TABLE)} WHERE plan_digest = ? AND (migration_status <> 'ISOLATED' OR backup_id <> ?)`).get(plan.plan_digest, backup.backup_id).count;
    if (Number(conflicting) !== 0) throw new Error("Rollback would remove registry rows that were changed after apply; refusing destructive metadata rollback");
    const removed = db.prepare(`DELETE FROM ${identifier(REGISTRY_TABLE)} WHERE plan_digest = ?`).run(plan.plan_digest).changes;
    db.prepare(`UPDATE ${identifier(RUNS_TABLE)} SET migration_status = 'ROLLED_BACK' WHERE plan_digest = ?`).run(plan.plan_digest);
    return Number(removed);
  });
  return transaction();
}

function hashSet(records) {
  return records.map((record) => record.exception_hash).sort().join("\n");
}

function comparePlanToScan(plan, scan) {
  if (Number(plan.counts?.orphan_count) !== scan.orphan_count || hashSet(plan.records) !== hashSet(scan.records)) throw new Error("Database relationships changed since dry run; refuse stale or incomplete plan");
  if (Number(plan.counts?.active_orphan_count) !== scan.active_orphan_count || Number(plan.counts?.cross_tenant_count) !== scan.cross_tenant_count) throw new Error("Database safety counts changed since dry run; refuse plan");
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

const database = path.resolve(argument("--database", process.env.DATABASE_FILE ?? DATABASE_DEFAULT));
const planFile = argument("--plan");
const outputFile = argument("--output");
const apply = hasFlag("--apply");
const rollback = hasFlag("--rollback");
if (apply && rollback) throw new Error("Choose exactly one of --apply or --rollback");
if (!fs.existsSync(database)) throw new Error(`Database not found: ${database}`);
assertRegularFile(database, "Database");

if (!apply && !rollback) {
  const db = new Database(database, { readonly: true, fileMustExist: true });
  try {
    const scan = scanExceptions(db);
    const plan = outputPlan({ database, db, scan });
    if (outputFile) await writeExclusive(path.resolve(outputFile), plan);
    print({ status: "dry_run", dry_run: true, output: outputFile ? path.resolve(outputFile) : null, plan_digest: plan.plan_digest, counts: plan.counts, credentials_included: false, phi_included: false });
  } finally { db.close(); }
  process.exit(0);
}

if (!planFile) throw new Error("--plan <file> is required for apply or rollback");
const resolvedPlanFile = path.resolve(planFile);
assertRegularFile(resolvedPlanFile, "Closure plan");
const plan = loadJson(resolvedPlanFile, "Closure plan");
validatePlan(plan);
const expectedDatabaseHash = argument("--expected-db-sha256");
if (expectedDatabaseHash !== plan.database.sha256 || !/^[0-9a-f]{64}$/.test(String(expectedDatabaseHash ?? ""))) throw new Error("--expected-db-sha256 must exactly match the plan database hash");
const actorRole = requireAdmin();
requireConfirmation(rollback ? "ROLLBACK" : "APPLY");
const backupManifest = argument("--backup-manifest");
if (!backupManifest) throw new Error("--backup-manifest <manifest.json> is required");
const backup = validateBackup(path.resolve(backupManifest), expectedDatabaseHash);
const reviewArtifact = argument("--review-artifact");
if (!reviewArtifact) throw new Error("--review-artifact <json> is required");
const review = validateReview(path.resolve(reviewArtifact), plan.plan_digest, rollback ? "ROLLBACK" : "APPLY");
const currentDatabaseHash = sha256File(database);
const db = new Database(database, { fileMustExist: true });
try {
  const currentContentHash = contentHash(db);
  const scan = scanExceptions(db);
  comparePlanToScan(plan, scan);
  if (rollback) {
    if (currentContentHash !== plan.database.content_sha256) throw new Error("Database content changed since apply; rollback is refused");
    const removed = rollbackRegistry(db, plan, backup);
    print({ status: "rolled_back", plan_digest: plan.plan_digest, removed_registry_rows: removed, database_sha256_at_rollback: currentDatabaseHash, content_sha256: currentContentHash, source_rows_changed: 0, source_files_changed: 0 });
    process.exit(0);
  }

  const exactPrecondition = currentDatabaseHash === expectedDatabaseHash && currentContentHash === plan.database.content_sha256;
  const repeatPrecondition = currentContentHash === plan.database.content_sha256 && registryHasPlan(db, plan, scan);
  if (!exactPrecondition && !repeatPrecondition) throw new Error("Database changed since dry run; refuse stale plan");
  if (repeatPrecondition) {
    print({ status: "already_applied", plan_digest: plan.plan_digest, database_sha256_current: currentDatabaseHash, content_sha256: currentContentHash, inserted_registry_rows: 0, source_rows_changed: 0, source_files_changed: 0 });
    process.exit(0);
  }
  const rawCrash = argument("--simulate-crash-after");
  const simulateCrashAfter = rawCrash === undefined ? null : Number(rawCrash);
  if (simulateCrashAfter !== null && (!Number.isInteger(simulateCrashAfter) || simulateCrashAfter < 1)) throw new Error("--simulate-crash-after must be a positive integer");
  const result = createOrApplyRegistry(db, plan, scan, backup, review, actorRole, currentDatabaseHash, simulateCrashAfter);
  const integrity = db.pragma("integrity_check", { simple: true });
  if (integrity !== "ok") throw new Error(`SQLite integrity_check failed after apply: ${integrity}`);
  print({ status: "applied", plan_digest: plan.plan_digest, database_sha256_before: currentDatabaseHash, content_sha256: currentContentHash, inserted_registry_rows: result.inserted, already_present_registry_rows: result.alreadyPresent, source_rows_changed: 0, source_files_changed: 0, registry_table: REGISTRY_TABLE, backup_id: backup.backup_id, reviewer_artifact_sha256: review.sha256 });
} finally { db.close(); }
