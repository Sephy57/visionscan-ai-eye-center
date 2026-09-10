import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import Database from "better-sqlite3";
import { execFileSync, spawn } from "child_process";
import { afterAll, describe, expect, it } from "vitest";

const repo = process.cwd();
const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), "visionscan-backup-restore-"));
const source = path.join(runRoot, "legacy.json");
const database = path.join(runRoot, "eye-ai.db");
const backup = path.join(runRoot, "backup");
fs.copyFileSync(path.join(repo, "tests", "fixtures", "legacy-store.json"), source);
fs.mkdirSync(path.join(runRoot, "data", "uploads"), { recursive: true });
fs.writeFileSync(path.join(runRoot, "data", "uploads", "fixture.bin"), Buffer.from("synthetic backup fixture\n"));

function run(script: string, args: string[], extraEnv: Record<string, string> = {}, input?: string) {
  return execFileSync(process.execPath, [path.join(repo, "scripts", script), ...args], { cwd: runRoot, encoding: "utf8", input, env: { ...process.env, DATABASE_FILE: database, ...extraEnv } });
}

function runFailure(script: string, args: string[], extraEnv: Record<string, string> = {}) {
  try {
    run(script, args, extraEnv);
    throw new Error("expected command to fail");
  } catch (error) {
    if (error instanceof Error && error.message === "expected command to fail") throw error;
    const result = error as NodeJS.ErrnoException & { stdout?: Buffer | string; stderr?: Buffer | string };
    return `${result.stdout ?? ""}${result.stderr ?? ""}`;
  }
}

describe("data backup and restore controls", () => {
  it("creates a hash-verified backup and restores to a new directory", () => {
    run("migrate-data.mjs", ["--apply", "--source", source, "--destination", database]);
    const backupOutput = JSON.parse(run("backup-data.mjs", ["--output", backup]));
    expect(backupOutput.database.kind).toBe("sqlite");
    expect(fs.existsSync(path.join(backup, "manifest.json"))).toBe(true);
    const restoredOutput = JSON.parse(run("restore-data.mjs", ["--backup", backup]));
    expect(restoredOutput.status).toBe("restored_to_new_directory");
    expect(fs.existsSync(path.join(restoredOutput.output, "eye-ai.db"))).toBe(true);
  });

  it("dry-run backup and restore do not mutate their targets", () => {
    const plan = JSON.parse(run("backup-data.mjs", ["--dry-run", "--output", path.join(runRoot, "plan")]));
    expect(plan.plan_only).toBe(true);
    const restorePlan = JSON.parse(run("restore-data.mjs", ["--backup", backup, "--dry-run"]));
    expect(restorePlan.plan_only).toBe(true);
    expect(fs.existsSync(path.join(runRoot, "plan"))).toBe(false);
  });

  it("encrypts every payload with authenticated metadata and restores with the operator key", () => {
    const encryptedBackup = path.join(runRoot, "backup-encrypted");
    const key = "test-only operator backup key";
    const backupOutput = JSON.parse(run("backup-data.mjs", [
      "--encrypt", "--retention-days", "30", "--legal-hold", "--archive-state", "ARCHIVED", "--output", encryptedBackup,
    ], { VISIONSCAN_BACKUP_KEY: key }));
    expect(backupOutput.encryption).toMatchObject({ enabled: true, algorithm: "aes-256-gcm", kdf: "scrypt", manifest_authentication: "hmac-sha256" });
    expect(backupOutput.encryption.manifest_hmac).toMatch(/^[0-9a-f]{64}$/);
    expect(backupOutput.retention).toMatchObject({ retention_days: 30, legal_hold: true, archive_state: "ARCHIVED", automatic_deletion: false, operator_action_required: true });
    expect(fs.existsSync(path.join(encryptedBackup, "eye-ai.db.enc"))).toBe(true);
    expect(fs.existsSync(path.join(encryptedBackup, "eye-ai.db"))).toBe(false);
    expect(fs.existsSync(path.join(encryptedBackup, "assets", "uploads", "fixture.bin.enc"))).toBe(true);
    expect(fs.readFileSync(path.join(encryptedBackup, "eye-ai.db.enc")).subarray(0, 16).toString("ascii")).not.toContain("SQLite");

    const restored = JSON.parse(run("restore-data.mjs", ["--backup", encryptedBackup], { VISIONSCAN_BACKUP_KEY: key }));
    expect(restored.status).toBe("restored_to_new_directory");
    expect(fs.readFileSync(path.join(restored.output, "eye-ai.db")).subarray(0, 16).toString("ascii")).toBe("SQLite format 3\u0000");
    expect(fs.readFileSync(path.join(restored.output, "assets", "uploads", "fixture.bin"))).toEqual(Buffer.from("synthetic backup fixture\n"));
  });

  it("fails closed for wrong keys, tampered manifests/ciphertext, and missing assets", () => {
    const encryptedBackup = path.join(runRoot, "backup-encrypted");
    const key = "test-only operator backup key";
    expect(runFailure("restore-data.mjs", ["--backup", encryptedBackup], { VISIONSCAN_BACKUP_KEY: "wrong key" })).toMatch(/authentication|key/i);

    const tamperedManifest = path.join(runRoot, "backup-tampered-manifest");
    fs.cpSync(encryptedBackup, tamperedManifest, { recursive: true });
    const manifestPath = path.join(tamperedManifest, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.encryption.manifest_hmac = `${manifest.encryption.manifest_hmac.slice(0, -1)}${manifest.encryption.manifest_hmac.endsWith("0") ? "1" : "0"}`;
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    expect(runFailure("restore-data.mjs", ["--backup", tamperedManifest], { VISIONSCAN_BACKUP_KEY: key })).toMatch(/authentication/i);

    const tamperedDatabase = path.join(runRoot, "backup-tampered-database");
    fs.cpSync(encryptedBackup, tamperedDatabase, { recursive: true });
    const encryptedDatabasePath = path.join(tamperedDatabase, "eye-ai.db.enc");
    const encryptedDatabase = fs.readFileSync(encryptedDatabasePath);
    encryptedDatabase[encryptedDatabase.length - 1] ^= 0x01;
    fs.writeFileSync(encryptedDatabasePath, encryptedDatabase);
    expect(runFailure("restore-data.mjs", ["--backup", tamperedDatabase], { VISIONSCAN_BACKUP_KEY: key })).toMatch(/authentication|hash/i);

    const missingAssetBackup = path.join(runRoot, "backup-missing-asset");
    fs.cpSync(encryptedBackup, missingAssetBackup, { recursive: true });
    fs.rmSync(path.join(missingAssetBackup, "assets", "uploads", "fixture.bin.enc"));
    const restoreRoot = path.join(runRoot, "data", "restores");
    const before = fs.existsSync(restoreRoot) ? fs.readdirSync(restoreRoot).filter((entry) => !entry.includes(".tmp-")) : [];
    expect(runFailure("restore-data.mjs", ["--backup", missingAssetBackup], { VISIONSCAN_BACKUP_KEY: key })).toMatch(/missing/i);
    const after = fs.existsSync(restoreRoot) ? fs.readdirSync(restoreRoot).filter((entry) => !entry.includes(".tmp-")) : [];
    expect(after).toEqual(before);
  });

  it("rejects traversal in a plaintext asset manifest", () => {
    const traversalBackup = path.join(runRoot, "backup-traversal");
    fs.cpSync(backup, traversalBackup, { recursive: true });
    const assetManifestPath = path.join(traversalBackup, "asset-manifest.json");
    const assetManifest = JSON.parse(fs.readFileSync(assetManifestPath, "utf8"));
    assetManifest[0].path = "%2e%2e/escape.bin";
    fs.writeFileSync(assetManifestPath, `${JSON.stringify(assetManifest, null, 2)}\n`);
    const manifestPath = path.join(traversalBackup, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.assets.manifest_sha256 = crypto.createHash("sha256").update(JSON.stringify(assetManifest)).digest("hex");
    manifest.assets.manifest_backup_sha256 = crypto.createHash("sha256").update(fs.readFileSync(assetManifestPath)).digest("hex");
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    expect(runFailure("restore-data.mjs", ["--backup", traversalBackup])).toMatch(/hash|unsafe|traversal/i);
    expect(fs.existsSync(path.join(runRoot, "escape.bin"))).toBe(false);
  });

  it("accepts a one-shot stdin key without exposing it in the manifest", () => {
    const stdinBackup = path.join(runRoot, "backup-stdin");
    const key = "stdin-only operator key";
    const output = JSON.parse(run("backup-data.mjs", ["--encrypt", "--key-stdin", "--output", stdinBackup], {}, `${key}\n`));
    const manifestText = fs.readFileSync(path.join(stdinBackup, "manifest.json"), "utf8");
    expect(manifestText).not.toContain(key);
    expect(JSON.parse(run("restore-data.mjs", ["--backup", stdinBackup, "--key-stdin"], {}, `${key}\n`)).status).toBe("restored_to_new_directory");
    expect(output.encryption.enabled).toBe(true);
  });

  it("refuses encryption when no key is supplied", () => {
    expect(runFailure("backup-data.mjs", ["--encrypt", "--output", path.join(runRoot, "backup-no-key")], { VISIONSCAN_BACKUP_KEY: "" })).toMatch(/no backup key/i);
    expect(fs.existsSync(path.join(runRoot, "backup-no-key"))).toBe(false);
  });

  it("takes a transactionally consistent snapshot while an inference-like writer is active", async () => {
    const writer = path.join(runRoot, "active-writer.mjs");
    fs.writeFileSync(writer, `
      import { createRequire } from "node:module";
      const Database = createRequire(import.meta.url)(${JSON.stringify(path.join(repo, "node_modules", "better-sqlite3"))});
      const db = new Database(process.argv[2]);
      db.pragma("busy_timeout = 5000");
      db.exec("BEGIN IMMEDIATE; CREATE TABLE IF NOT EXISTS backup_write_probe (id INTEGER PRIMARY KEY, marker TEXT NOT NULL); DELETE FROM backup_write_probe;");
      const insert = db.prepare("INSERT INTO backup_write_probe(marker) VALUES (?)");
      for (let i = 0; i < 1000; i += 1) insert.run("INFERENCE_WRITE_" + i);
      setTimeout(() => { db.exec("COMMIT"); db.close(); }, 500);
    `, "utf8");
    const child = spawn(process.execPath, [writer, database], { cwd: runRoot, windowsHide: true });
    const childExit = new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => resolve(code));
    });
    await new Promise((resolve) => setTimeout(resolve, 75));
    const duringBackup = path.join(runRoot, "backup-during-write");
    const output = JSON.parse(run("backup-data.mjs", ["--output", duringBackup]));
    expect(output.database.snapshot_method).toBe("sqlite_online_backup");
    const exitCode = await childExit;
    expect(exitCode).toBe(0);
    const restored = JSON.parse(run("restore-data.mjs", ["--backup", duringBackup]));
    const restoredDbPath = path.join(restored.output, "eye-ai.db");
    const restoredDb = new Database(restoredDbPath, { readonly: true, fileMustExist: true });
    try {
      expect(restoredDb.pragma("integrity_check", { simple: true })).toBe("ok");
      let rows = 0;
      try { rows = Number((restoredDb.prepare("SELECT count(*) AS count FROM backup_write_probe").get() as { count: number }).count); } catch { /* snapshot preceded the commit */ }
      expect([0, 1000]).toContain(rows);
    } finally {
      restoredDb.close();
    }
  }, 60_000);

  it("records expired eligibility without deleting an archived or legal-held backup", () => {
    const expired = path.join(runRoot, "backup-expired-eligible");
    const output = JSON.parse(run("backup-data.mjs", [
      "--retention-days", "0", "--deletion-eligible-at", "2000-01-01T00:00:00.000Z",
      "--legal-hold", "--archive-state", "ARCHIVED", "--output", expired,
    ]));
    expect(output.retention).toMatchObject({ retention_days: 0, legal_hold: true, archive_state: "ARCHIVED", automatic_deletion: false, operator_action_required: true });
    expect(output.retention.deletion_eligible_at).toBe("2000-01-01T00:00:00.000Z");
    expect(fs.existsSync(path.join(expired, "manifest.json"))).toBe(true);
  });
});

afterAll(() => fs.rmSync(runRoot, { recursive: true, force: true }));
