import Database from "better-sqlite3";
import { afterAll, describe, expect, it } from "vitest";
import {
  closeDatabase,
  dbAll,
  dbGet,
  dbPut,
  dbTransaction,
  PersistenceCorruptionError,
  persistenceInfo,
} from "@/lib/storage/db";

describe("transactional SQLite persistence", () => {
  it("initializes the deliberate SQLite backend and pragmas", async () => {
    const info = await import("@/lib/storage/db").then((module) => module.initializeDatabase());
    expect(info.backend).toBe("sqlite");
    expect(info.pragmas.foreign_keys).toBe(1);
    expect(info.pragmas.journal_mode).toBe("wal");
    expect(info.pragmas.busy_timeout).toBe(5000);
    expect(info.pragmas.synchronous).toBe(2);
  });

  it("rolls back every collection when a transaction throws", async () => {
    await expect(dbTransaction((tx) => {
      tx.put("studies", "tx-study", { study_id: "tx-study" });
      tx.put("reports", "tx-report", { report_id: "tx-report" });
      throw new Error("synthetic rollback");
    })).rejects.toThrow("synthetic rollback");
    expect(await dbGet("studies", "tx-study")).toBeNull();
    expect(await dbGet("reports", "tx-report")).toBeNull();
  });

  it("commits cross-collection records atomically", async () => {
    await dbTransaction((tx) => {
      tx.put("studies", "atomic-study", { study_id: "atomic-study" });
      tx.put("analyses", "atomic-analysis", { analysis_id: "atomic-analysis" });
      tx.put("reasoning_records", "atomic-reasoning", { reasoning_record_id: "atomic-reasoning" });
      tx.put("reports", "atomic-report", { report_id: "atomic-report" });
    });
    expect((await dbGet<{ study_id: string }>("studies", "atomic-study"))?.study_id).toBe("atomic-study");
    expect((await dbGet<{ report_id: string }>("reports", "atomic-report"))?.report_id).toBe("atomic-report");
  });

  it("serializes concurrent puts without lost records", async () => {
    await Promise.all(Array.from({ length: 100 }, (_, index) => dbPut("audit_events", `event-${index}`, { index })));
    const values = await dbAll<{ index: number }>("audit_events");
    expect(values.filter((value) => Number.isInteger(value.index))).toHaveLength(100);
  });

  it("keeps same-key updates as one deterministic primary-key row", async () => {
    await Promise.all([
      dbPut("jobs", "same-job", { state: "first" }),
      dbPut("jobs", "same-job", { state: "second" }),
      dbPut("jobs", "same-job", { state: "final" }),
    ]);
    const rows = (await dbAll<{ state: string }>("jobs")).filter((row) => ["first", "second", "final"].includes(row.state));
    expect(rows).toHaveLength(1);
    expect(["first", "second", "final"]).toContain(rows[0].state);
  });

  it("fails closed when a stored payload is corrupted", async () => {
    const databaseFile = process.env.DATABASE_FILE!;
    await dbPut("studies", "corrupt-study", { study_id: "corrupt-study" });
    const direct = new Database(databaseFile);
    direct.prepare('UPDATE "studies" SET payload = ? WHERE id = ?').run("{not-json", "corrupt-study");
    direct.close();
    await expect(dbGet("studies", "corrupt-study")).rejects.toBeInstanceOf(PersistenceCorruptionError);
  });

  it("does not expose mutable references from reads", async () => {
    await dbPut("patients", "clone-patient", { nested: { value: 1 } });
    const read = await dbGet<{ nested: { value: number } }>("patients", "clone-patient");
    read!.nested.value = 99;
    expect((await dbGet<{ nested: { value: number } }>("patients", "clone-patient"))?.nested.value).toBe(1);
  });
});

afterAll(async () => {
  // Closing the native handle allows the setup exit hook to remove the
  // isolated run directory, including SQLite WAL/SHM sidecars.
  await closeDatabase();
});
