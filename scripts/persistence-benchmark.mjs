#!/usr/bin/env node
/**
 * Bounded production-shaped persistence benchmark.
 *
 * This script uses only deterministic synthetic records in a temporary OS
 * directory. It never opens, mutates, or reads the configured VisionScan
 * store, and it intentionally exercises the same relationship shape used by
 * the application rather than only inserting one flat collection.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "visionscan-persistence-benchmark-"));
const requested = process.argv.find((arg) => arg.startsWith("--records="))?.slice(10);
const sizes = requested
  ? requested.split(",").map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0 && value <= 50_000)
  : [1_000, 10_000, 50_000];
if (sizes.length === 0) throw new Error("--records must contain at least one integer in the range 1..50000");

const MIX_WEIGHTS = [
  ["patients", 0.02],
  ["encounters", 0.04],
  ["studies", 0.25],
  ["documents", 0.15],
  ["analyses", 0.15],
  ["evidence", 0.20],
  ["reports", 0.10],
  ["audit_events", 0.05],
  ["jobs", 0.04],
];
const clock = () => Number(process.hrtime.bigint()) / 1e6;

function distribution(total) {
  const counts = Object.fromEntries(MIX_WEIGHTS.map(([kind, weight]) => [kind, Math.floor(total * weight)]));
  let assigned = Object.values(counts).reduce((sum, value) => sum + value, 0);
  for (const [kind] of MIX_WEIGHTS) {
    if (assigned >= total) break;
    counts[kind] += 1;
    assigned += 1;
  }
  return counts;
}

function timestamp(index) {
  return new Date(Date.UTC(2026, 0, 1) + index * 1_000).toISOString();
}

function recordFor(kind, index, counts) {
  const id = `${kind.slice(0, -1)}-${index}`;
  const patientId = `patient-${index % Math.max(1, counts.patients)}`;
  const studyId = `study-${index % Math.max(1, counts.studies)}`;
  const createdAt = timestamp(index);
  const status = index % 7 === 0 ? "ARCHIVED" : index % 5 === 0 ? "REVIEW_REQUIRED" : "ACTIVE";
  const links = {
    patient_id: patientId,
    encounter_id: `encounter-${index % Math.max(1, counts.encounters)}`,
    study_id: studyId,
    document_id: `document-${index % Math.max(1, counts.documents)}`,
    analysis_id: `analysi-${index % Math.max(1, counts.analyses)}`,
    report_id: `report-${index % Math.max(1, counts.reports)}`,
    tenant_id: `tenant-${index % 10}`,
    job_id: `job-${index % Math.max(1, counts.jobs)}`,
  };
  const payload = {
    synthetic: true,
    kind,
    status,
    created_at: createdAt,
    ...links,
    patient_ref: `SYNTH-${String(index % Math.max(1, counts.patients)).padStart(5, "0")}`,
    provenance: { source: "benchmark", bytes: false },
  };
  return { id, created_at: createdAt, updated_at: createdAt, status, ...links, payload: JSON.stringify(payload) };
}

function sqliteSchema(db, tables) {
  for (const table of tables) {
    db.exec(`CREATE TABLE "${table}"(
      id TEXT PRIMARY KEY NOT NULL,
      patient_id TEXT,
      encounter_id TEXT,
      study_id TEXT,
      document_id TEXT,
      analysis_id TEXT,
      report_id TEXT,
      tenant_id TEXT,
      job_id TEXT,
      status TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX "${table}_created_idx" ON "${table}"(created_at DESC, id DESC);
    CREATE INDEX "${table}_study_idx" ON "${table}"(study_id);
    CREATE INDEX "${table}_patient_idx" ON "${table}"(patient_id);`);
  }
}

function relationColumns(row) {
  return [row.id, row.patient_id, row.encounter_id, row.study_id, row.document_id, row.analysis_id, row.report_id, row.tenant_id, row.job_id, row.status, row.payload, row.created_at, row.updated_at];
}

async function benchmark(total) {
  const counts = distribution(total);
  const tables = Object.keys(counts);
  const sqliteFile = path.join(root, `bench-${total}.db`);
  const db = new Database(sqliteFile);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = FULL");
  db.pragma("busy_timeout = 5000");
  sqliteSchema(db, tables);

  const rowsByTable = Object.fromEntries(tables.map((table) => [table, []]));
  for (const table of tables) {
    for (let index = 0; index < counts[table]; index += 1) rowsByTable[table].push(recordFor(table, index, counts));
  }

  const insertStarted = clock();
  db.transaction(() => {
    for (const table of tables) {
      const insert = db.prepare(`INSERT INTO "${table}"(id, patient_id, encounter_id, study_id, document_id, analysis_id, report_id, tenant_id, job_id, status, payload, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const row of rowsByTable[table]) insert.run(...relationColumns(row));
    }
  })();
  const insertMs = clock() - insertStarted;

  const lookupStatement = db.prepare("SELECT payload FROM studies WHERE id = ?");
  const lookupStarted = clock();
  const lookupCount = Math.min(1_000, Math.max(1, counts.studies));
  for (let index = 0; index < lookupCount; index += 1) lookupStatement.get(`study-${index % counts.studies}`);
  const lookupMs = clock() - lookupStarted;

  const pageSize = 100;
  const firstPageStatement = db.prepare("SELECT id, created_at FROM studies ORDER BY created_at DESC, id DESC LIMIT ?");
  const nextPageStatement = db.prepare("SELECT id, created_at FROM studies WHERE created_at < ? OR (created_at = ? AND id < ?) ORDER BY created_at DESC, id DESC LIMIT ?");
  const paginationStarted = clock();
  let cursor = null;
  let paginationPages = 0;
  let paginationRows = 0;
  while (paginationPages < Math.min(100, Math.ceil(counts.studies / pageSize))) {
    const rows = cursor
      ? nextPageStatement.all(cursor.created_at, cursor.created_at, cursor.id, pageSize)
      : firstPageStatement.all(pageSize);
    if (rows.length === 0) break;
    paginationRows += rows.length;
    cursor = rows[rows.length - 1];
    paginationPages += 1;
    if (rows.length < pageSize) break;
  }
  const paginationMs = clock() - paginationStarted;

  const dashboardStarted = clock();
  const dashboard = db.prepare("SELECT status, COUNT(*) AS count FROM studies GROUP BY status ORDER BY status").all();
  const dashboardMs = clock() - dashboardStarted;

  const workspaceStarted = clock();
  const workspace = db.prepare("SELECT COUNT(*) AS count FROM studies WHERE patient_id = ?").get("patient-0");
  const patientWorkspaceMs = clock() - workspaceStarted;

  const archiveStarted = clock();
  const archiveCount = Math.min(1_000, counts.studies);
  db.transaction(() => {
    const archive = db.prepare("UPDATE studies SET status = 'ARCHIVED' WHERE id = ?");
    for (let index = 0; index < archiveCount; index += 1) archive.run(`study-${index}`);
  })();
  const archiveMs = clock() - archiveStarted;

  const jsonCollections = {};
  for (const table of tables) jsonCollections[table] = Object.fromEntries(rowsByTable[table].map((row) => [row.id, { ...row, payload: undefined }]));
  const jsonFile = path.join(root, `legacy-${total}.json`);
  await fs.writeFile(jsonFile, JSON.stringify({ collections: jsonCollections }), "utf8");
  const jsonDb = JSON.parse(await fs.readFile(jsonFile, "utf8"));
  const jsonStarted = clock();
  delete jsonDb.collections.studies[`study-${Math.floor(counts.studies / 2)}`];
  await fs.writeFile(jsonFile, JSON.stringify(jsonDb), "utf8");
  const jsonRewriteMs = clock() - jsonStarted;

  const cleanupStarted = clock();
  db.transaction(() => {
    for (const table of tables) db.prepare(`DELETE FROM "${table}"`).run();
  })();
  const cleanupMs = clock() - cleanupStarted;
  // Close the WAL cleanly before Windows/antivirus file handles see the
  // temporary directory. This is synthetic benchmark cleanup only; the live
  // application keeps WAL enabled for crash safety.
  try { db.pragma("wal_checkpoint(TRUNCATE)"); } catch { /* close below still releases the handle */ }
  db.close();

  return {
    records: total,
    mix: counts,
    sqlite_insert_ms: Number(insertMs.toFixed(2)),
    sqlite_lookup_ms: Number(lookupMs.toFixed(2)),
    sqlite_lookup_count: lookupCount,
    sqlite_pagination_ms: Number(paginationMs.toFixed(2)),
    sqlite_pagination_pages: paginationPages,
    sqlite_pagination_rows: paginationRows,
    sqlite_dashboard_ms: Number(dashboardMs.toFixed(2)),
    sqlite_dashboard_status_counts: dashboard,
    sqlite_patient_workspace_ms: Number(patientWorkspaceMs.toFixed(2)),
    sqlite_patient_workspace_study_count: Number(workspace.count),
    sqlite_archive_ms: Number(archiveMs.toFixed(2)),
    sqlite_archive_count: archiveCount,
    sqlite_cleanup_ms: Number(cleanupMs.toFixed(2)),
    // Kept as a direct comparison with the previous one-collection benchmark.
    json_single_mutation_rewrite_ms: Number(jsonRewriteMs.toFixed(2)),
  };
}

async function removeTempRoot() {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await fs.rm(root, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 7) {
        // A Windows file scanner can briefly hold a just-closed SQLite file.
        // Do not turn an otherwise valid benchmark into a false data result;
        // report the cleanup limitation while leaving no live DB handle.
        console.error(`warning: temporary benchmark cleanup deferred: ${String(error)}`);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
}

const results = [];
try {
  for (const size of sizes) results.push(await benchmark(size));
  console.log(JSON.stringify({
    format: "visionscan-persistence-benchmark-v2",
    synthetic_only: true,
    production_shaped: true,
    max_records: Math.max(...sizes),
    page_size: 100,
    results,
  }, null, 2));
} finally {
  await removeTempRoot();
}
