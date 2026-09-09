import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("bounded SQLite lock behavior", () => {
  it("returns SQLITE_BUSY within the configured timeout for a competing writer", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "visionscan-lock-matrix-"));
    roots.push(root);
    const file = path.join(root, "lock.db");
    const writer = new Database(file);
    const contender = new Database(file);
    try {
      writer.pragma("journal_mode = WAL");
      contender.pragma("journal_mode = WAL");
      contender.pragma("busy_timeout = 250");
      writer.exec("CREATE TABLE lock_probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL); BEGIN IMMEDIATE;");
      const started = Date.now();
      expect(() => contender.prepare("INSERT INTO lock_probe(value) VALUES ('blocked')").run()).toThrow(/busy|locked/i);
      const elapsed = Date.now() - started;
      expect(elapsed).toBeLessThan(2_000);
    } finally {
      try { writer.exec("ROLLBACK"); } catch { /* transaction may already be closed */ }
      writer.close();
      contender.close();
    }
  });
});
