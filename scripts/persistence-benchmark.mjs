#!/usr/bin/env node
/** Bounded synthetic persistence benchmark; never opens the configured data store. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "visionscan-persistence-benchmark-"));
const requested = process.argv.find((arg) => arg.startsWith("--records="))?.slice(10);
const sizes = requested ? requested.split(",").map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0 && value <= 50000) : [1000, 10000, 50000];
const results = [];
const clock = () => Number(process.hrtime.bigint()) / 1e6;
try {
  for (const count of sizes) {
    const sqliteFile = path.join(root, `bench-${count}.db`);
    const db = new Database(sqliteFile);
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = FULL");
    db.exec("CREATE TABLE records(id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL);");
    const insert = db.prepare("INSERT INTO records(id, kind, payload, updated_at) VALUES(?, ?, ?, ?)");
    const payload = JSON.stringify({ synthetic: true, value: "bounded-benchmark" });
    const started = clock();
    db.transaction(() => {
      for (let index = 0; index < count; index += 1) insert.run(`patient-${index}`, "patient", payload, new Date().toISOString());
    })();
    const insertMs = clock() - started;
    const readStarted = clock();
    const dashboard = db.prepare("SELECT COUNT(*) AS count FROM records WHERE kind='patient'").get().count;
    const readMs = clock() - readStarted;
    const cleanupStarted = clock();
    db.transaction(() => db.prepare("DELETE FROM records WHERE kind='patient'").run())();
    const cleanupMs = clock() - cleanupStarted;
    db.close();

    const jsonRows = {};
    for (let index = 0; index < count; index += 1) jsonRows[`patient-${index}`] = { synthetic: true, value: "bounded-benchmark" };
    const jsonFile = path.join(root, `legacy-${count}.json`);
    await fs.writeFile(jsonFile, JSON.stringify({ collections: { patients: jsonRows } }));
    const jsonDb = JSON.parse(await fs.readFile(jsonFile, "utf8"));
    const jsonStarted = clock();
    delete jsonDb.collections.patients[`patient-${Math.floor(count / 2)}`];
    await fs.writeFile(jsonFile, JSON.stringify(jsonDb));
    const jsonRewriteMs = clock() - jsonStarted;
    results.push({ records: count, sqlite_insert_ms: Number(insertMs.toFixed(2)), sqlite_dashboard_count: dashboard, sqlite_dashboard_ms: Number(readMs.toFixed(2)), sqlite_cleanup_ms: Number(cleanupMs.toFixed(2)), json_single_mutation_rewrite_ms: Number(jsonRewriteMs.toFixed(2)) });
  }
  console.log(JSON.stringify({ format: "visionscan-persistence-benchmark-v1", synthetic_only: true, max_records: Math.max(...sizes), results }, null, 2));
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
