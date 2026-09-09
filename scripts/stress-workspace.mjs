#!/usr/bin/env node
/**
 * Production-shaped, synthetic-only workspace stress run. It uses a temporary
 * SQLite database and never touches the configured VisionScan data directory.
 * The workload mirrors the 100-patient/500-study acceptance gate while keeping
 * all values explicitly synthetic and non-clinical.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const patientsTotal = Number(process.argv.find((arg) => arg.startsWith("--patients="))?.slice(11) ?? 100);
const studiesTotal = Number(process.argv.find((arg) => arg.startsWith("--studies="))?.slice(10) ?? 500);
if (!Number.isInteger(patientsTotal) || patientsTotal < 1 || patientsTotal > 1000) throw new Error("--patients must be an integer between 1 and 1000");
if (!Number.isInteger(studiesTotal) || studiesTotal < 1 || studiesTotal > 5000) throw new Error("--studies must be an integer between 1 and 5000");

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "visionscan-workspace-stress-"));
const db = new Database(path.join(tempRoot, "stress.db"));
db.pragma("journal_mode = WAL");
db.pragma("synchronous = FULL");
db.pragma("busy_timeout = 5000");
for (const table of ["patients", "studies", "documents", "analyses", "jobs", "reports", "reviews", "model_errors"]) {
  db.exec(`CREATE TABLE ${table}(id TEXT PRIMARY KEY, patient_id TEXT, study_id TEXT, status TEXT, payload TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
  db.exec(`CREATE INDEX ${table}_created_idx ON ${table}(created_at DESC, id DESC)`);
}

const now = () => new Date().toISOString();
const clock = () => Number(process.hrtime.bigint()) / 1e6;
const metric = (name, started, extra = {}) => ({ name, ms: Number((clock() - started).toFixed(2)), ...extra });
const results = [];

const createStarted = clock();
db.transaction(() => {
  const insert = {
    patients: db.prepare("INSERT INTO patients(id, patient_id, status, payload, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?)"),
    studies: db.prepare("INSERT INTO studies(id, patient_id, status, payload, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?)"),
    documents: db.prepare("INSERT INTO documents(id, patient_id, study_id, status, payload, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?)"),
    analyses: db.prepare("INSERT INTO analyses(id, patient_id, study_id, status, payload, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?)"),
    jobs: db.prepare("INSERT INTO jobs(id, patient_id, study_id, status, payload, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?)"),
    reports: db.prepare("INSERT INTO reports(id, patient_id, study_id, status, payload, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?)"),
    reviews: db.prepare("INSERT INTO reviews(id, patient_id, study_id, status, payload, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?)"),
    model_errors: db.prepare("INSERT INTO model_errors(id, patient_id, study_id, status, payload, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?)"),
  };
  for (let index = 0; index < patientsTotal; index += 1) {
    const id = `patient-${index}`; const at = now();
    insert.patients.run(id, id, "ACTIVE", JSON.stringify({ synthetic: true, patient_id: id, tenant_id: `tenant-${index % 5}` }), at, at);
  }
  for (let index = 0; index < studiesTotal; index += 1) {
    const patient = `patient-${index % patientsTotal}`; const study = `study-${index}`; const at = now();
    insert.studies.run(study, patient, "ACTIVE", JSON.stringify({ synthetic: true, study_id: study, patient_id: patient }), at, at);
    insert.documents.run(`document-${index}`, patient, study, "UPLOADED", JSON.stringify({ synthetic: true, study_id: study }), at, at);
    insert.analyses.run(`analysis-${index}`, patient, study, "COMPLETE", JSON.stringify({ synthetic: true, study_id: study }), at, at);
    insert.jobs.run(`job-${index}`, patient, study, index % 10 === 0 ? "RETRYABLE" : "COMPLETED", JSON.stringify({ synthetic: true, study_id: study, retry_count: index % 3 }), at, at);
    insert.reports.run(`report-${index}`, patient, study, "AI_ONLY", JSON.stringify({ synthetic: true, study_id: study }), at, at);
    if (index % 2 === 0) insert.reviews.run(`review-${index}`, patient, study, "REVIEWED", JSON.stringify({ synthetic: true, study_id: study }), at, at);
    insert.model_errors.run(`model-error-${index}`, patient, study, "UNREVIEWED", JSON.stringify({ synthetic: true, study_id: study }), at, at);
  }
})();
results.push(metric("create_upload_metadata", createStarted, { patients: patientsTotal, studies: studiesTotal }));

const lookupStarted = clock();
const lookup = db.prepare("SELECT payload FROM studies WHERE id = ?");
for (let index = 0; index < Math.min(studiesTotal, 1000); index += 1) lookup.get(`study-${index}`);
results.push(metric("analysis_lookup", lookupStarted, { lookups: Math.min(studiesTotal, 1000) }));

const paginationStarted = clock();
const page = db.prepare("SELECT id FROM studies ORDER BY created_at DESC, id DESC LIMIT 50").all();
results.push(metric("study_pagination", paginationStarted, { page_size: 50, rows: page.length }));

const dashboardStarted = clock();
const dashboard = db.prepare("SELECT status, COUNT(*) AS count FROM studies GROUP BY status").all();
results.push(metric("dashboard_aggregate", dashboardStarted, { buckets: dashboard.length }));

const workspaceStarted = clock();
const workspace = db.prepare("SELECT COUNT(*) AS count FROM studies WHERE patient_id = ?").get("patient-0");
results.push(metric("patient_workspace", workspaceStarted, { patient: "synthetic", studies: Number(workspace.count) }));

const lifecycleStarted = clock();
db.transaction(() => {
  db.prepare("UPDATE jobs SET status='CANCELLED', updated_at=? WHERE id LIKE 'job-%' AND CAST(substr(id, 5) AS INTEGER) % 17 = 0").run(now());
  db.prepare("UPDATE studies SET status='ARCHIVED', updated_at=? WHERE id LIKE 'study-%' AND CAST(substr(id, 7) AS INTEGER) % 11 = 0").run(now());
  db.prepare("UPDATE reports SET status='ARCHIVED', updated_at=? WHERE id LIKE 'report-%' AND CAST(substr(id, 8) AS INTEGER) % 11 = 0").run(now());
})();
results.push(metric("retry_cancel_report_review_archive", lifecycleStarted));

const validationStarted = clock();
const validationCount = db.prepare("SELECT COUNT(*) AS count FROM model_errors WHERE status='UNREVIEWED'").get();
results.push(metric("validation_error_writes", validationStarted, { rows: Number(validationCount.count) }));

const cleanupStarted = clock();
db.transaction(() => {
  db.prepare("DELETE FROM documents WHERE CAST(substr(id, 10) AS INTEGER) % 23 = 0").run();
  db.prepare("UPDATE studies SET status='DELETED', updated_at=? WHERE CAST(substr(id, 7) AS INTEGER) % 29 = 0").run(now());
})();
results.push(metric("delete_archive_cleanup", cleanupStarted));
const integrity = db.pragma("integrity_check", { simple: true });
const counts = Object.fromEntries(["patients", "studies", "documents", "analyses", "jobs", "reports", "reviews", "model_errors"].map((table) => [table, db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count]));
db.close();
await fs.rm(tempRoot, { recursive: true, force: true });
console.log(JSON.stringify({ format: "visionscan-workspace-stress-v1", synthetic_only: true, patients: patientsTotal, studies: studiesTotal, integrity_check: integrity, counts, measurements: results }, null, 2));

