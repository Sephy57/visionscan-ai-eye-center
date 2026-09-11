import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import Database from "better-sqlite3";
import { afterAll, describe, expect, it } from "vitest";

const repo = process.cwd();
const script = path.join(repo, "scripts", "data-closure.mjs");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "visionscan-active-closure-"));
const relational = ["patient_id", "encounter_id", "study_id", "document_id", "analysis_id", "report_id", "tenant_id", "job_id"];
const tables = ["studies", "analyses", "reports", "documents", "reasoning_records", "clinician_reviews", "model_executions", "evidence", "condition_assessments", "specialist_packages", "derived_assets", "document_pages", "oct_rois", "reviews"];

const sha256 = (value: Buffer | string) => crypto.createHash("sha256").update(value).digest("hex");

function makeDb(name: string, studyPayload: Record<string, unknown>, extra?: (put: (table: string, id: string, payload: Record<string, unknown>) => void) => void) {
  const data = path.join(root, name);
  const dataRoot = path.join(data, "data");
  fs.mkdirSync(path.join(dataRoot, "uploads"), { recursive: true });
  fs.mkdirSync(path.join(dataRoot, "reports"), { recursive: true });
  const database = path.join(dataRoot, "database", "eye-ai.db");
  fs.mkdirSync(path.dirname(database), { recursive: true });
  const db = new Database(database);
  db.exec("CREATE TABLE persistence_meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);");
  db.prepare("INSERT INTO persistence_meta(key,value) VALUES ('schema_version','1'),('migration_version','1')").run();
  for (const table of tables) db.exec(`CREATE TABLE "${table}" (id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, ${relational.map((column) => `${column} TEXT`).join(",")})`);
  const statements = new Map(tables.map((table) => [table, db.prepare(`INSERT INTO "${table}" (id,payload,created_at,updated_at,${relational.join(",")}) VALUES (?,?,?, ?,${relational.map(() => "?").join(",")})`)]));
  const put = (table: string, id: string, payload: Record<string, unknown>) => {
    const now = "2026-01-01T00:00:00.000Z";
    statements.get(table)!.run(id, JSON.stringify(payload), now, now, ...relational.map((column) => typeof payload[column] === "string" ? payload[column] : null));
  };
  put("studies", String(studyPayload.study_id ?? "study-fixture"), studyPayload);
  extra?.(put);
  db.close();
  return { data, dataRoot, database };
}

function envFor(fixture: { dataRoot: string }) {
  return { ...process.env, DATA_ROOT: fixture.dataRoot, UPLOAD_ROOT: path.join(fixture.dataRoot, "uploads"), REPORT_ROOT: path.join(fixture.dataRoot, "reports"), CLOSURE_ALLOW_FIXTURE_COUNT: "1" };
}

function dry(fixture: { dataRoot: string; database: string }, name: string) {
  const ledger = path.join(fixture.dataRoot, `${name}-ledger.json`);
  const plan = path.join(fixture.dataRoot, `${name}-plan.json`);
  const output = execFileSync(process.execPath, [script, "--database", fixture.database, "--ledger-output", ledger, "--output", plan, "--dry-run"], { cwd: repo, env: envFor(fixture), encoding: "utf8" });
  return { output: JSON.parse(output), ledger: JSON.parse(fs.readFileSync(ledger, "utf8")), plan: JSON.parse(fs.readFileSync(plan, "utf8")) };
}

describe("active source closure forensics", () => {
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  it("classifies a missing active source conservatively and excludes it from new reasoning", () => {
    const fixture = makeDb("unknown", { study_id: "study-unknown", status: "UPLOADED", source: "file_upload", files: [{ relativePath: "study-unknown/original.png", sha256: sha256("original") }] });
    const result = dry(fixture, "unknown");
    expect(result.plan.counts).toMatchObject({ total_findings: 1, recoverable: 0, retireable: 0, ambiguous: 1, unchanged: 1 });
    const row = result.ledger.records[0];
    expect(row.classification).toBe("UNKNOWN_REQUIRES_REVIEW");
    expect(row.allowed_action).toBe("KEEP_BLOCKED");
    expect(row.classification_evidence.new_reasoning_eligible).toBe(false);
    expect(row.classification_evidence.replay_status).toBe("SOURCE_UNAVAILABLE_FOR_REPLAY");
    expect(result.ledger.phi_included).toBe(false);
    const repeat = dry(fixture, "unknown-repeat");
    expect(repeat.plan.plan_digest).toBe(result.plan.plan_digest);
  });

  it("permits only an exact hash candidate with the study scope and rejects wrong-scope or derivative copies", () => {
    const bytes = Buffer.from("same bytes");
    const hash = sha256(bytes);
    const fixture = makeDb("candidates", { study_id: "study-candidate", status: "UPLOADED", files: [{ relativePath: "study-candidate/missing.png", sha256: hash }] });
    fs.mkdirSync(path.join(fixture.dataRoot, "uploads", "study-candidate"), { recursive: true });
    fs.writeFileSync(path.join(fixture.dataRoot, "uploads", "study-candidate", "recovered.png"), bytes);
    fs.mkdirSync(path.join(fixture.dataRoot, "uploads", "other-study"), { recursive: true });
    fs.writeFileSync(path.join(fixture.dataRoot, "uploads", "other-study", "same.png"), bytes);
    fs.mkdirSync(path.join(fixture.dataRoot, "processed"), { recursive: true });
    fs.writeFileSync(path.join(fixture.dataRoot, "processed", "derived.png"), bytes);
    const result = dry(fixture, "candidate");
    const row = result.ledger.records[0];
    expect(row.candidate_recovery_count).toBe(1);
    expect(row.classification).toBe("ACTIVE_REQUIRED_SOURCE");
    expect(row.allowed_action).toBe("RECOVER_ONLY_AFTER_TWO_PERSON_REVIEW");
    expect(row.classification_evidence.exact_hash_matches_rejected_for_scope_or_provenance).toBeGreaterThanOrEqual(1);
  });

  it("keeps incomplete and synthetic records reviewable instead of silently retiring them", () => {
    const fixture = makeDb("states", { study_id: "study-incomplete", status: "PROCESSING", files: [{ relativePath: "study-incomplete/original.png", sha256: sha256("missing") }] }, (put) => {
      put("studies", "study-synthetic", { study_id: "study-synthetic", status: "UPLOADED", synthetic: true, files: [{ relativePath: "study-synthetic/original.png", sha256: sha256("synthetic") }] });
    });
    const result = dry(fixture, "states");
    const byStudy = new Map<string, Record<string, any>>(result.ledger.records.map((row: Record<string, any>) => [String(row.study_id), row]));
    expect(byStudy.get("study-incomplete")?.classification).toBe("ACTIVE_INCOMPLETE_UPLOAD");
    expect(byStudy.get("study-synthetic")?.classification).toBe("SYNTHETIC_TEST_RECORD");
    expect(result.plan.counts.retireable).toBe(1);
    expect(byStudy.get("study-synthetic")?.action_result).toBe("UNCHANGED");
  });

  it("records report/reasoning dependencies without treating derivatives as source", () => {
    const fixture = makeDb("dependencies", { study_id: "study-dependent", status: "ANALYZED", files: [{ relativePath: "study-dependent/original.png", sha256: sha256("missing") }] }, (put) => {
      put("reports", "report-dependent", { report_id: "report-dependent", study_id: "study-dependent", lifecycle: "FINALIZED" });
      put("reasoning_records", "reason-dependent", { reasoning_id: "reason-dependent", study_id: "study-dependent" });
      put("derived_assets", "roi-dependent", { asset_id: "roi-dependent", study_id: "study-dependent", source_type: "ROI" });
    });
    const result = dry(fixture, "dependencies");
    const row = result.ledger.records[0];
    expect(row.report_reference_count).toBeGreaterThan(0);
    expect(row.reasoning_reference_count).toBeGreaterThan(0);
    expect(row.dependency_graph.source.replay).toBe("SOURCE_UNAVAILABLE_FOR_REPLAY");
    expect(row.classification_evidence.new_reasoning_eligible).toBe(false);
  });

  it("requires backup, admin, confirmation and review before the no-op apply", () => {
    const fixture = makeDb("apply", { study_id: "study-apply", status: "UPLOADED", files: [{ relativePath: "study-apply/original.png", sha256: sha256("missing") }] });
    const result = dry(fixture, "apply");
    const backupDir = path.join(fixture.dataRoot, "backup");
    fs.mkdirSync(backupDir, { recursive: true });
    const backupFile = path.join(backupDir, "eye-ai.db");
    fs.copyFileSync(fixture.database, backupFile);
    const dbHash = sha256(fs.readFileSync(fixture.database));
    fs.writeFileSync(path.join(backupDir, "manifest.json"), JSON.stringify({ format: "visionscan-data-backup-v1", backup_id: "fixture", credentials_included: false, database: { file_name: "eye-ai.db", backup_file: "eye-ai.db", sha256: dbHash, backup_sha256: sha256(fs.readFileSync(backupFile)), integrity_check: "ok" } }));
    const review = path.join(fixture.dataRoot, "review.json");
    fs.writeFileSync(review, JSON.stringify({ format: "visionscan-data-closure-review-v1", plan_digest: result.plan.plan_digest, decision: "APPROVED", reviewer_role: "INDEPENDENT_DATA_REVIEWER", safety_findings: { fabricated_bytes: false, guessed_relationships: false, gate_weakened: false, active_records_relabelled: false } }));
    const args = [script, "--apply", "--database", fixture.database, "--plan", path.join(fixture.dataRoot, "apply-plan.json"), "--backup-id", backupDir, "--expected-db-sha256", dbHash, "--review-artifact", review, "--actor-role", "ADMIN", "--confirm", "APPLY_DATA_CLOSURE"];
    const applied = JSON.parse(execFileSync(process.execPath, args, { cwd: repo, env: envFor(fixture), encoding: "utf8" }));
    expect(applied).toMatchObject({ status: "NO_ACTIONS_APPLIED", actions_applied: 0, source_rows_changed: 0, source_files_changed: 0 });
    expect(sha256(fs.readFileSync(fixture.database))).toBe(dbHash);
    expect(() => execFileSync(process.execPath, args.filter((value) => value !== "--actor-role" && value !== "ADMIN"), { cwd: repo, env: envFor(fixture), encoding: "utf8", stdio: "pipe" })).toThrow();
  });
});
