import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { safeJoin } from "@/lib/config";

const roots: string[] = [];

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "visionscan-corruption-matrix-"));
  roots.push(root);
  return root;
}

function createDatabase(file: string, mode: "delete" | "wal" = "delete") {
  const database = new Database(file);
  database.pragma(`journal_mode = ${mode.toUpperCase()}`);
  if (mode === "wal") database.pragma("wal_autocheckpoint = 0");
  database.exec("CREATE TABLE sentinel (id INTEGER PRIMARY KEY, value TEXT NOT NULL);");
  const insert = database.prepare("INSERT INTO sentinel(value) VALUES (?)");
  const transaction = database.transaction(() => {
    for (let index = 0; index < 200; index += 1) insert.run(`MATRIX_SENTINEL_${index}_${"x".repeat(512)}`);
  });
  transaction();
  return database;
}

function integrityFails(file: string): boolean {
  let database: Database.Database | undefined;
  try {
    database = new Database(file);
    const result = String(database.pragma("integrity_check", { simple: true }));
    return result !== "ok";
  } catch {
    return true;
  } finally {
    try { database?.close(); } catch { /* already rejected by SQLite */ }
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("explicit corruption and path fault matrix", () => {
  it("fails closed for SQLite page corruption", () => {
    const root = tempRoot();
    const source = path.join(root, "source.db");
    const database = createDatabase(source);
    database.close();
    const corrupted = path.join(root, "page-corrupt.db");
    fs.copyFileSync(source, corrupted);
    const bytes = fs.readFileSync(corrupted);
    // Corrupt a page payload, not the header, so SQLite must validate the page.
    bytes[Math.min(bytes.length - 1, 8192)] ^= 0xff;
    fs.writeFileSync(corrupted, bytes);
    expect(integrityFails(corrupted)).toBe(true);
  });

  it("fails closed for a truncated SQLite database", () => {
    const root = tempRoot();
    const source = path.join(root, "source.db");
    const database = createDatabase(source);
    database.close();
    const truncated = path.join(root, "truncated.db");
    const bytes = fs.readFileSync(source);
    fs.writeFileSync(truncated, bytes.subarray(0, Math.min(bytes.length, 512)));
    expect(integrityFails(truncated)).toBe(true);
  });

  it("does not accept a tampered WAL sidecar as a healthy sentinel database", () => {
    const root = tempRoot();
    const source = path.join(root, "source.db");
    const database = createDatabase(source, "wal");
    const copy = path.join(root, "wal-corrupt.db");
    fs.copyFileSync(source, copy);
    fs.copyFileSync(`${source}-wal`, `${copy}-wal`);
    fs.copyFileSync(`${source}-shm`, `${copy}-shm`);
    database.close();
    const wal = fs.readFileSync(`${copy}-wal`);
    // The WAL header checksum is part of SQLite's authenticity check. A
    // changed checksum must cause the sidecar to be ignored or rejected.
    wal[24] ^= 0xff;
    fs.writeFileSync(`${copy}-wal`, wal);
    let accepted = false;
    let opened: Database.Database | undefined;
    try {
      opened = new Database(copy, { readonly: true, fileMustExist: true });
      const row = opened.prepare("SELECT value FROM sentinel ORDER BY id LIMIT 1").get() as { value?: string } | undefined;
      accepted = row?.value?.startsWith("MATRIX_SENTINEL_0_") === true;
    } catch {
      accepted = false;
    } finally {
      try { opened?.close(); } catch { /* malformed WAL may reject close */ }
    }
    expect(accepted).toBe(false);
  });

  it("rejects traversal variants while allowing an in-root asset path", () => {
    const root = tempRoot();
    for (const candidate of ["../outside.bin", "..\\outside.bin", "a/../../outside.bin", "a\\..\\..\\outside.bin"]) {
      expect(() => safeJoin(root, candidate)).toThrow();
    }
    expect(safeJoin(root, "study-123", "original.png")).toBe(path.join(root, "study-123", "original.png"));
  });
});
