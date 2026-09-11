import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import Database from "better-sqlite3";
import { afterAll, describe, expect, it } from "vitest";

const repo = process.cwd();
const script = path.join(repo, "scripts", "migration", "legacy-closure.mjs");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "visionscan-legacy-closure-"));
const relationalColumns = ["patient_id", "encounter_id", "study_id", "document_id", "analysis_id", "report_id", "tenant_id", "job_id"];
const tables = [
  "studies", "patients", "encounters", "documents", "analyses", "reports", "clinician_reviews",
  "reasoning_records", "model_executions", "jobs", "evidence",
];

function sha256(value: Buffer | string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function command(args: string[], env: Record<string, string> = {}): string {
  return execFileSync(process.execPath, [script, ...args], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function commandFailure(args: string[], env: Record<string, string> = {}): string {
  try {
    command(args, env);
    throw new Error("command unexpectedly succeeded");
  } catch (error) {
    const failure = error as { stderr?: string; stdout?: string; message?: string };
    return `${failure.stderr ?? ""}${failure.stdout ?? ""}${failure.message ?? ""}`;
  }
}

function createDatabase(name: string, documents = 1, deleted = true): string {
  const database = path.join(root, `${name}.db`);
  const db = new Database(database);
  db.exec("CREATE TABLE persistence_meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);");
  db.prepare("INSERT INTO persistence_meta(key,value) VALUES('schema_version','1'),('migration_version','1')").run();
  for (const table of tables) {
    db.exec(`CREATE TABLE "${table}" (id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, ${relationalColumns.map((column) => `${column} TEXT`).join(", ")});`);
  }
  const insert = new Map(tables.map((table) => [table, db.prepare(`INSERT INTO "${table}" (id,payload,created_at,updated_at,${relationalColumns.join(",")}) VALUES (?,?,?, ?,${relationalColumns.map(() => "?").join(",")})`)]));
  const put = (table: string, id: string, value: Record<string, unknown>) => {
    const payload = JSON.stringify(value);
    insert.get(table)!.run(id, payload, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z", ...relationalColumns.map((column) => typeof value[column] === "string" ? value[column] : null));
  };
  // All fixture references are deliberately non-identifying.  The child is
  // marked as a deleted test artifact, which is the only class this command
  // may isolate automatically.
  for (let index = 0; index < documents; index += 1) {
    const document = {
      document_id: `doc-legacy-${index}`,
      study_id: `study-missing-${index}`,
      lifecycle: deleted ? "DELETED" : "ACTIVE",
      status: deleted ? "DELETED" : "UPLOADED",
      tenant_id: "tenant-synthetic",
      sha256: "a".repeat(64),
    } as Record<string, unknown>;
    if (deleted) document.uploaded_by = "synthetic-test";
    put("documents", `doc-legacy-${index}`, document);
  }
  db.close();
  return database;
}

function createBackup(database: string, name: string, expectedHash: string): string {
  const backup = path.join(root, `${name}-backup`);
  fs.mkdirSync(backup, { recursive: true });
  const databaseBackup = path.join(backup, "eye-ai.db");
  fs.copyFileSync(database, databaseBackup);
  fs.writeFileSync(path.join(backup, "manifest.json"), `${JSON.stringify({
    format: "visionscan-data-backup-v1",
    backup_id: name,
    database: {
      file_name: "eye-ai.db",
      backup_file: "eye-ai.db",
      sha256: expectedHash,
      backup_sha256: sha256(fs.readFileSync(databaseBackup)),
      integrity_check: "ok",
    },
  }, null, 2)}\n`);
  return path.join(backup, "manifest.json");
}

function createReview(plan: Record<string, unknown>, name: string, operation: "APPLY" | "ROLLBACK"): string {
  const review = path.join(root, `${name}-${operation.toLowerCase()}-review.json`);
  fs.writeFileSync(review, `${JSON.stringify({
    format: "visionscan-legacy-closure-review-v1",
    plan_digest: plan.plan_digest,
    operation,
    decision: "APPROVED",
    reviewer_role: "INDEPENDENT_DATA_REVIEWER",
    safety_findings: {
      fabricated_bytes: false,
      guessed_relationships: false,
      gate_weakened: false,
      active_records_relabelled: false,
    },
    evidence_digests: [sha256(`${name}:${operation}:pre-migration`), sha256(`${name}:${operation}:plan`), sha256(`${name}:${operation}:test-evidence`)],
  }, null, 2)}\n`);
  return review;
}

function makePlan(database: string, name: string, documents = 1, deleted = true): { database: string; plan: string; value: Record<string, unknown> } {
  const db = createDatabase(name, documents, deleted);
  const plan = path.join(root, `${name}-plan.json`);
  const output = JSON.parse(command(["--database", db, "--dry-run", "--output", plan]));
  return { database: db, plan, value: JSON.parse(fs.readFileSync(plan, "utf8")) as Record<string, unknown> };
}

describe("legacy relationship closure controls", () => {
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  it("creates a PHI-minimizing dry-run without changing the database", () => {
    const fixture = makePlan(path.join(root, "unused.db"), "dry-run");
    const before = sha256(fs.readFileSync(fixture.database));
    const plan = fixture.value;
    expect(plan.format).toBe("visionscan-legacy-closure-plan-v1");
    expect(plan.counts).toMatchObject({ orphan_count: 1, active_orphan_count: 0, legacy_orphan_count: 1, cross_tenant_count: 0 });
    expect(Array.isArray(plan.records)).toBe(true);
    expect((plan.records as Array<Record<string, unknown>>)[0]).not.toHaveProperty("child_id");
    expect(sha256(fs.readFileSync(fixture.database))).toBe(before);
    expect(fs.existsSync(path.join(fixture.database, "legacy_relationship_exceptions"))).toBe(false);
  });

  it("requires an exact backup, independent approval, ADMIN role, and confirmation", () => {
    const fixture = makePlan(path.join(root, "preconditions-unused.db"), "preconditions");
    const expectedHash = String((fixture.value.database as Record<string, unknown>).sha256);
    const backup = createBackup(fixture.database, "preconditions", expectedHash);
    const review = createReview(fixture.value, "preconditions", "APPLY");
    const common: string[] = ["--database", fixture.database, "--apply", "--plan", fixture.plan, "--expected-db-sha256", expectedHash, "--backup-manifest", backup, "--review-artifact", review];
    expect(commandFailure(common, { VISIONSCAN_MIGRATION_ACTOR_ROLE: "REVIEWER" })).toMatch(/ADMIN/);
    expect(commandFailure(common, { VISIONSCAN_MIGRATION_ACTOR_ROLE: "ADMIN" })).toMatch(/confirmation/i);
    const missingBackup = [...common];
    missingBackup[missingBackup.indexOf("--backup-manifest") + 1] = path.join(root, "missing-backup.json");
    expect(commandFailure([...missingBackup, "--confirm", "APPLY_LEGACY_CLOSURE"], { VISIONSCAN_MIGRATION_ACTOR_ROLE: "ADMIN" })).toMatch(/backup|manifest/i);
    const untouched = new Database(fixture.database, { readonly: true });
    expect(untouched.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get("legacy_relationship_exceptions")).toBeUndefined();
    untouched.close();
  });

  it("applies only the reviewed legacy registry rows and is idempotent", () => {
    const fixture = makePlan(path.join(root, "apply-unused.db"), "apply");
    const expectedHash = (fixture.value.database as Record<string, unknown>).sha256 as string;
    const backup = createBackup(fixture.database, "apply", expectedHash);
    const review = createReview(fixture.value, "apply", "APPLY");
    const args = ["--database", fixture.database, "--apply", "--plan", fixture.plan, "--expected-db-sha256", expectedHash, "--backup-manifest", backup, "--review-artifact", review, "--confirm", "APPLY_LEGACY_CLOSURE"];
    const first = JSON.parse(command(args, { VISIONSCAN_MIGRATION_ACTOR_ROLE: "ADMIN" }));
    expect(first).toMatchObject({ status: "applied", inserted_registry_rows: 1, source_rows_changed: 0, source_files_changed: 0 });
    const db = new Database(fixture.database, { readonly: true });
    expect((db.prepare("SELECT COUNT(*) AS count FROM legacy_relationship_exceptions").get() as { count: number }).count).toBe(1);
    expect((db.prepare("SELECT payload FROM documents WHERE id='doc-legacy-0'").get() as { payload: string }).payload).toContain("study-missing-0");
    db.close();
    const replay = JSON.parse(command(args, { VISIONSCAN_MIGRATION_ACTOR_ROLE: "ADMIN" }));
    expect(replay).toMatchObject({ status: "already_applied", inserted_registry_rows: 0, source_rows_changed: 0, source_files_changed: 0 });
  });

  it("never turns an active unresolved relationship into a legacy exception", () => {
    const fixture = makePlan(path.join(root, "active-unused.db"), "active", 1, false);
    const expectedHash = String((fixture.value.database as Record<string, unknown>).sha256);
    const backup = createBackup(fixture.database, "active", expectedHash);
    const review = createReview(fixture.value, "active", "APPLY");
    expect(commandFailure(["--database", fixture.database, "--apply", "--plan", fixture.plan, "--expected-db-sha256", expectedHash, "--backup-manifest", backup, "--review-artifact", review, "--confirm", "APPLY_LEGACY_CLOSURE"], { VISIONSCAN_MIGRATION_ACTOR_ROLE: "ADMIN" })).toMatch(/active|unsupported/i);
    const db = new Database(fixture.database, { readonly: true });
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get("legacy_relationship_exceptions")).toBeUndefined();
    db.close();
  });

  it("rejects a tampered or stale plan before mutation", () => {
    const fixture = makePlan(path.join(root, "stale-unused.db"), "stale");
    const plan = JSON.parse(fs.readFileSync(fixture.plan, "utf8")) as Record<string, unknown>;
    (plan.records as Array<Record<string, unknown>>)[0].classification = "LEGACY_DETACHED_JOB";
    const tampered = path.join(root, "tampered-plan.json");
    fs.writeFileSync(tampered, JSON.stringify(plan));
    const expectedHash = (fixture.value.database as Record<string, unknown>).sha256 as string;
    expect(commandFailure(["--database", fixture.database, "--apply", "--plan", tampered, "--expected-db-sha256", expectedHash, "--backup-manifest", path.join(root, "does-not-exist.json"), "--review-artifact", path.join(root, "does-not-exist-review.json"), "--confirm", "APPLY_LEGACY_CLOSURE"], { VISIONSCAN_MIGRATION_ACTOR_ROLE: "ADMIN" })).toMatch(/digest/i);
    const db = new Database(fixture.database);
    db.prepare("INSERT INTO patients (id,payload,created_at,updated_at) VALUES (?,?,?,?)").run("new-row", "{}", "2026-01-02", "2026-01-02");
    db.close();
    const backup = createBackup(fixture.database, "stale-after-change", expectedHash);
    const review = createReview(fixture.value, "stale", "APPLY");
    expect(commandFailure(["--database", fixture.database, "--apply", "--plan", fixture.plan, "--expected-db-sha256", expectedHash, "--backup-manifest", backup, "--review-artifact", review, "--confirm", "APPLY_LEGACY_CLOSURE"], { VISIONSCAN_MIGRATION_ACTOR_ROLE: "ADMIN" })).toMatch(/changed since dry run|stale/i);
    const inspect = new Database(fixture.database, { readonly: true });
    expect(inspect.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get("legacy_relationship_exceptions")).toBeUndefined();
    inspect.close();
  });

  it("rolls back only registry metadata and supports crash-safe transaction recovery", () => {
    const fixture = makePlan(path.join(root, "rollback-unused.db"), "rollback", 2);
    const expectedHash = (fixture.value.database as Record<string, unknown>).sha256 as string;
    const backup = createBackup(fixture.database, "rollback", expectedHash);
    const review = createReview(fixture.value, "rollback", "APPLY");
    const base = ["--database", fixture.database, "--apply", "--plan", fixture.plan, "--expected-db-sha256", expectedHash, "--backup-manifest", backup, "--review-artifact", review, "--confirm", "APPLY_LEGACY_CLOSURE"];
    expect(commandFailure([...base, "--simulate-crash-after", "1"], { VISIONSCAN_MIGRATION_ACTOR_ROLE: "ADMIN" })).toMatch(/simulated crash/i);
    let inspect = new Database(fixture.database, { readonly: true });
    expect(inspect.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get("legacy_relationship_exceptions")).toBeUndefined();
    inspect.close();
    expect(JSON.parse(command(base, { VISIONSCAN_MIGRATION_ACTOR_ROLE: "ADMIN" })).inserted_registry_rows).toBe(2);
    const rollbackReview = createReview(fixture.value, "rollback", "ROLLBACK");
    const rollback = ["--database", fixture.database, "--rollback", "--plan", fixture.plan, "--expected-db-sha256", expectedHash, "--backup-manifest", backup, "--review-artifact", rollbackReview, "--confirm", "ROLLBACK_LEGACY_CLOSURE"];
    expect(JSON.parse(command(rollback, { VISIONSCAN_MIGRATION_ACTOR_ROLE: "ADMIN" })).status).toBe("rolled_back");
    inspect = new Database(fixture.database, { readonly: true });
    expect((inspect.prepare("SELECT COUNT(*) AS count FROM legacy_relationship_exceptions").get() as { count: number }).count).toBe(0);
    expect((inspect.prepare("SELECT COUNT(*) AS count FROM legacy_relationship_closure_runs WHERE migration_status='ROLLED_BACK'").get() as { count: number }).count).toBe(1);
    inspect.close();
  });
});
