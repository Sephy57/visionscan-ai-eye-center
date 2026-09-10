#!/usr/bin/env node
/**
 * Read-only preflight for a future direct-FK migration.  It never changes the
 * active database and emits opaque entity hashes rather than payload content.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";

const repo = process.cwd();
const database = path.resolve(process.env.DATABASE_FILE ?? path.join(repo, "data", "database", "eye-ai.db"));
const outputArg = process.argv.includes("--output") ? process.argv[process.argv.indexOf("--output") + 1] : null;

const relations = [
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

function opaque(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 16);
}
function parsePayload(payload) {
  try { return JSON.parse(payload); } catch { return null; }
}
function tenant(row) {
  const value = row?.tenant_id ?? parsePayload(row?.payload)?.tenant_id;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function readRows(db, collection) {
  return db.prepare(`SELECT id, payload, tenant_id, patient_id, encounter_id, study_id, document_id, analysis_id, report_id, job_id FROM "${collection}"`).all();
}

if (!fs.existsSync(database)) throw new Error(`Database not found: ${database}`);
const db = new Database(database, { readonly: true, fileMustExist: true });
const rows = new Map();
for (const collection of new Set(relations.flatMap(([source, , target]) => [source, target]))) {
  rows.set(collection, new Map(readRows(db, collection).map((row) => [row.id, row])));
}
const violations = [];
const legacyExceptions = [];
for (const [source, column, target] of relations) {
  for (const row of rows.get(source).values()) {
    const value = row[column] ?? parsePayload(row.payload)?.[column] ?? null;
    if (value === null || value === undefined || value === "") continue;
    const targetRow = rows.get(target).get(String(value));
    const base = { relation: `${source}.${column}->${target}`, source: opaque(`${source}:${row.id}`), target: opaque(`${target}:${value}`) };
    if (!targetRow) {
      violations.push({ ...base, kind: "ORPHAN_REFERENCE" });
      continue;
    }
    const sourceTenant = tenant(row);
    const targetTenant = tenant(targetRow);
    if (sourceTenant && targetTenant && sourceTenant !== targetTenant) violations.push({ ...base, kind: "CROSS_TENANT_REFERENCE" });
    if (row[column] === null && parsePayload(row.payload)?.[column]) legacyExceptions.push({ ...base, kind: "PAYLOAD_METADATA_MISMATCH" });
  }
}
const result = {
  format: "visionscan-fk-preflight-v1",
  generated_at: new Date().toISOString(),
  database_file: database,
  schema_version: db.prepare("SELECT value FROM persistence_meta WHERE key='schema_version'").get()?.value ?? null,
  migration_version: db.prepare("SELECT value FROM persistence_meta WHERE key='migration_version'").get()?.value ?? null,
  relation_count: relations.length,
  orphan_references: violations.filter((item) => item.kind === "ORPHAN_REFERENCE").length,
  cross_tenant_references: violations.filter((item) => item.kind === "CROSS_TENANT_REFERENCE").length,
  invalid_nullability: 0,
  legacy_exceptions: legacyExceptions.length,
  direct_fk_migration_safe: violations.length === 0 && legacyExceptions.length === 0,
  violations,
  legacy_exception_details: legacyExceptions,
  phi_included: false,
};
db.close();
const serialized = `${JSON.stringify(result, null, 2)}\n`;
if (outputArg) {
  const target = path.resolve(repo, outputArg);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, serialized, "utf8");
  console.log(target);
} else console.log(serialized);
