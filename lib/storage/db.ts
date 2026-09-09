import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import Database from "better-sqlite3";
import {
  DATABASE_ROOT,
  DATABASE_FILE,
  LEGACY_DATABASE_FILE,
  PERSISTENCE_BACKEND,
  ensureDirs,
} from "../config";

/**
 * Transactional local persistence.
 *
 * SQLite is the default backend. The JSON implementation remains available
 * only when explicitly selected (VISIONSCAN_PERSISTENCE_BACKEND=json or a
 * .json DATABASE_FILE), so older development stores can be inspected and
 * migrated without silently losing data.
 */

export const COLLECTIONS = [
  "users",
  "patients",
  "encounters",
  "studies",
  "documents",
  "document_pages",
  "derived_assets",
  "oct_rois",
  "analyses",
  "model_executions",
  "evidence",
  "evidence_dependencies",
  "reasoning_records",
  "condition_assessments",
  "specialist_packages",
  "reports",
  "clinician_reviews",
  "jobs",
  "audit_events",
  "validation_cases",
  "model_errors",
  "model_error_adjudications",
  "test_results",
  "reviews",
  "devices",
  "comparisons",
  "datasets",
  "dataset_samples",
  "adjudications",
  "transitions",
  "evaluation_runs",
  "model_registry_state",
  "sessions",
  "access_grants",
  "consent",
  "reset_tokens",
  "calibration_records",
  "record_extractions",
] as const;

export type Collection = (typeof COLLECTIONS)[number];

const COLLECTION_SET = new Set<string>(COLLECTIONS);
const SQLITE_HEADER = Buffer.from("SQLite format 3\u0000", "ascii");
const SCHEMA_VERSION = 1;
const MIGRATION_VERSION = 1;

export class PersistenceMigrationRequiredError extends Error {
  readonly code = "PERSISTENCE_MIGRATION_REQUIRED" as const;

  constructor(filePath: string) {
    super(
      `Persistence migration required: ${filePath} is not a SQLite database. ` +
        `Run npm run migrate:data -- --apply (or explicitly select the legacy JSON backend).`,
    );
    this.name = "PersistenceMigrationRequiredError";
  }
}

export class PersistenceCorruptionError extends Error {
  readonly code = "PERSISTENCE_CORRUPTION" as const;

  constructor(message: string) {
    super(message);
    this.name = "PersistenceCorruptionError";
  }
}

interface DbShape {
  meta: { version: number; createdAt: string; lastWrite: string };
  collections: Partial<Record<Collection, Record<string, unknown>>> & Record<string, unknown>;
}

const now = () => new Date().toISOString();

function emptyDb(): DbShape {
  const timestamp = now();
  const collections: Record<string, Record<string, unknown>> = {};
  for (const collection of COLLECTIONS) collections[collection] = {};
  return { meta: { version: 1, createdAt: timestamp, lastWrite: timestamp }, collections };
}

function clone<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function tableName(collection: Collection): string {
  if (!COLLECTION_SET.has(collection)) throw new Error(`Unknown persistence collection: ${collection}`);
  // COLLECTIONS is a closed allow-list; quote defensively for SQL identifiers.
  return `"${collection.replaceAll('"', '""')}"`;
}

function jsonPayload(value: unknown): string {
  let payload: string | undefined;
  try {
    payload = JSON.stringify(value);
  } catch (error) {
    throw new PersistenceCorruptionError(`Record could not be serialized: ${String(error)}`);
  }
  if (!payload) throw new PersistenceCorruptionError("Record serialized to an empty payload");
  return payload;
}

function parsePayload<T>(collection: Collection, id: string, payload: string): T {
  try {
    return JSON.parse(payload) as T;
  } catch (error) {
    throw new PersistenceCorruptionError(
      `Invalid JSON payload in ${collection}/${id}: ${String(error)}`,
    );
  }
}

function assertDatabaseFileIsSQLite(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new PersistenceCorruptionError(`Database path is not a file: ${filePath}`);
  if (stat.size === 0) return;
  const fd = fs.openSync(filePath, "r");
  try {
    const header = Buffer.alloc(SQLITE_HEADER.length);
    fs.readSync(fd, header, 0, header.length, 0);
    if (!header.equals(SQLITE_HEADER)) throw new PersistenceMigrationRequiredError(filePath);
  } finally {
    fs.closeSync(fd);
  }
}

function initializeSqliteConnection(): Database.Database {
  ensureDirs();
  // Do not silently create an empty database while an adjacent legacy store
  // still exists. This is the common post-upgrade collision and must require
  // an explicit, hashed migration decision.
  if (!fs.existsSync(DATABASE_FILE) &&
      path.resolve(LEGACY_DATABASE_FILE) !== path.resolve(DATABASE_FILE) &&
      fs.existsSync(LEGACY_DATABASE_FILE) &&
      fs.statSync(LEGACY_DATABASE_FILE).size > 0) {
    throw new PersistenceMigrationRequiredError(
      `${DATABASE_FILE} is missing while legacy JSON exists at ${LEGACY_DATABASE_FILE}`,
    );
  }
  assertDatabaseFileIsSQLite(DATABASE_FILE);
  const connection = new Database(DATABASE_FILE);
  try {
    connection.pragma("foreign_keys = ON");
    connection.pragma("journal_mode = WAL");
    connection.pragma("busy_timeout = 5000");
    connection.pragma("synchronous = FULL");
    connection.exec(
      `CREATE TABLE IF NOT EXISTS persistence_meta (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      );`,
    );
    for (const collection of COLLECTIONS) {
      const table = tableName(collection);
      connection.exec(
        `CREATE TABLE IF NOT EXISTS ${table} (
          id TEXT PRIMARY KEY NOT NULL,
          payload TEXT NOT NULL CHECK(length(payload) > 0),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS ${collection}_updated_at_idx ON ${table}(updated_at);`,
      );
    }
    const schemaMeta = connection
      .prepare("SELECT value FROM persistence_meta WHERE key = ?")
      .get("schema_version") as { value: string } | undefined;
    if (schemaMeta && Number(schemaMeta.value) > SCHEMA_VERSION) {
      throw new PersistenceCorruptionError(
        `Database schema ${schemaMeta.value} is newer than supported schema ${SCHEMA_VERSION}`,
      );
    }
    const setMeta = connection.prepare(
      "INSERT INTO persistence_meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    );
    const metadata: Array<[string, string]> = [
      ["schema_version", String(SCHEMA_VERSION)],
      ["backend", "sqlite"],
      ["migration_version", String(MIGRATION_VERSION)],
      ["initialized_at", now()],
    ];
    const writeMeta = connection.transaction(() => {
      for (const [key, value] of metadata) setMeta.run(key, value);
    });
    writeMeta();
    return connection;
  } catch (error) {
    connection.close();
    throw error;
  }
}

let sqlite: Database.Database | null = null;
let jsonCache: DbShape | null = null;
let writeChain: Promise<void> = Promise.resolve();
let initialization: Promise<void> | null = null;

async function ensureInitialized(): Promise<void> {
  if (PERSISTENCE_BACKEND === "json") {
    if (!jsonCache) await loadJson();
    return;
  }
  if (sqlite) return;
  if (!initialization) {
    initialization = Promise.resolve().then(() => {
      if (!sqlite) sqlite = initializeSqliteConnection();
    });
  }
  await initialization;
}

async function loadJson(): Promise<DbShape> {
  if (jsonCache) return jsonCache;
  ensureDirs();
  try {
    const raw = await fsp.readFile(DATABASE_FILE, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new PersistenceCorruptionError(`Invalid legacy JSON database ${DATABASE_FILE}: ${String(error)}`);
    }
    if (!parsed || typeof parsed !== "object" || !("collections" in parsed)) {
      throw new PersistenceCorruptionError(`Legacy JSON database has no collections envelope: ${DATABASE_FILE}`);
    }
    const candidate = parsed as DbShape;
    if (!candidate.collections || typeof candidate.collections !== "object") {
      throw new PersistenceCorruptionError(`Legacy JSON database collections is not an object: ${DATABASE_FILE}`);
    }
    for (const collection of COLLECTIONS) {
      const value = candidate.collections[collection];
      if (value === undefined) candidate.collections[collection] = {};
      else if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new PersistenceCorruptionError(`Legacy collection ${collection} is not an id map`);
      }
    }
    jsonCache = candidate;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") jsonCache = emptyDb();
    else throw error;
  }
  return jsonCache;
}

function persistJson(db: DbShape): Promise<void> {
  db.meta = db.meta ?? emptyDb().meta;
  db.meta.lastWrite = now();
  writeChain = writeChain.then(async () => {
    const tmp = `${DATABASE_FILE}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    const payload = JSON.stringify(db, null, 2);
    let lastError: unknown;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await fsp.writeFile(tmp, payload, "utf8");
        await fsp.rename(tmp, DATABASE_FILE);
        return;
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
      } finally {
        await fsp.rm(tmp, { force: true }).catch(() => undefined);
      }
    }
    throw lastError;
  });
  return writeChain;
}

interface SyncTransaction {
  get<T>(collection: Collection, id: string): T | null;
  all<T>(collection: Collection): T[];
  put<T>(collection: Collection, id: string, doc: T): void;
  delete(collection: Collection, id: string): boolean;
  deleteMany(collection: Collection, ids: readonly string[]): number;
}

export type DbTransaction = SyncTransaction;

function sqliteTransaction(): SyncTransaction {
  if (!sqlite) throw new Error("Database is not initialized");
  const connection = sqlite;
  return {
    get<T>(collection: Collection, id: string) {
      const row = connection.prepare(`SELECT payload FROM ${tableName(collection)} WHERE id = ?`).get(id) as
        | { payload: string }
        | undefined;
      return row ? clone(parsePayload<T>(collection, id, row.payload)) : null;
    },
    all<T>(collection: Collection) {
      const rows = connection
        .prepare(`SELECT id, payload FROM ${tableName(collection)} ORDER BY created_at, id`)
        .all() as Array<{ id: string; payload: string }>;
      return rows.map((row) => clone(parsePayload<T>(collection, row.id, row.payload)));
    },
    put<T>(collection: Collection, id: string, doc: T) {
      const payload = jsonPayload(doc);
      const timestamp = now();
      connection
        .prepare(
          `INSERT INTO ${tableName(collection)}(id, payload, created_at, updated_at)
           VALUES(?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at`,
        )
        .run(id, payload, timestamp, timestamp);
    },
    delete(collection: Collection, id: string) {
      const result = connection.prepare(`DELETE FROM ${tableName(collection)} WHERE id = ?`).run(id);
      return result.changes > 0;
    },
    deleteMany(collection: Collection, ids: readonly string[]) {
      const uniqueIds = [...new Set(ids)];
      if (uniqueIds.length === 0) return 0;
      const statement = connection.prepare(`DELETE FROM ${tableName(collection)} WHERE id = ?`);
      let deleted = 0;
      for (const id of uniqueIds) deleted += Number(statement.run(id).changes);
      return deleted;
    },
  };
}

function assertSyncResult(value: unknown): void {
  if (value && typeof (value as PromiseLike<unknown>).then === "function") {
    throw new Error("dbTransaction callback must be synchronous so the transaction encloses every write");
  }
}

export async function initializeDatabase(): Promise<ReturnType<typeof persistenceInfo>> {
  await ensureInitialized();
  return persistenceInfo();
}

export async function closeDatabase(): Promise<void> {
  if (sqlite) {
    sqlite.close();
    sqlite = null;
  }
  initialization = null;
  jsonCache = null;
  writeChain = Promise.resolve();
}

export async function dbTransaction<T>(work: (tx: DbTransaction) => T): Promise<T> {
  await ensureInitialized();
  if (PERSISTENCE_BACKEND === "sqlite") {
    if (!sqlite) throw new Error("Database is not initialized");
    const transaction = sqlite.transaction(() => {
      const result = work(sqliteTransaction());
      assertSyncResult(result);
      return result;
    });
    return transaction() as T;
  }

  const current = await loadJson();
  const draft = clone(current);
  const tx: DbTransaction = {
    get<TValue>(collection: Collection, id: string) {
      const value = (draft.collections[collection] as Record<string, unknown> | undefined)?.[id];
      return value === undefined ? null : clone(value as TValue);
    },
    all<TValue>(collection: Collection) {
      return Object.values((draft.collections[collection] ?? {}) as Record<string, unknown>).map((value) =>
        clone(value as TValue),
      );
    },
    put<TValue>(collection: Collection, id: string, doc: TValue) {
      if (!draft.collections[collection]) draft.collections[collection] = {};
      (draft.collections[collection] as Record<string, unknown>)[id] = clone(doc);
    },
    delete(collection: Collection, id: string) {
      const map = (draft.collections[collection] ?? {}) as Record<string, unknown>;
      if (!(id in map)) return false;
      delete map[id];
      return true;
    },
    deleteMany(collection: Collection, ids: readonly string[]) {
      const map = (draft.collections[collection] ?? {}) as Record<string, unknown>;
      let count = 0;
      for (const id of new Set(ids)) {
        if (id in map) {
          delete map[id];
          count += 1;
        }
      }
      return count;
    },
  };
  const result = work(tx);
  assertSyncResult(result);
  jsonCache = draft;
  await persistJson(draft);
  return result;
}

export async function dbPut<T>(collection: Collection, id: string, doc: T): Promise<void> {
  await ensureInitialized();
  if (PERSISTENCE_BACKEND === "sqlite") {
    sqliteTransaction().put(collection, id, doc);
    return;
  }
  const db = await loadJson();
  if (!db.collections[collection]) db.collections[collection] = {};
  db.collections[collection]![id] = clone(doc);
  await persistJson(db);
}

export async function dbGet<T>(collection: Collection, id: string): Promise<T | null> {
  await ensureInitialized();
  if (PERSISTENCE_BACKEND === "sqlite") return sqliteTransaction().get<T>(collection, id);
  const db = await loadJson();
  const value = (db.collections[collection] ?? {})[id];
  return value === undefined ? null : clone(value as T);
}

export async function dbAll<T>(collection: Collection): Promise<T[]> {
  await ensureInitialized();
  if (PERSISTENCE_BACKEND === "sqlite") return sqliteTransaction().all<T>(collection);
  const db = await loadJson();
  return Object.values(db.collections[collection] ?? {}).map((value) => clone(value as T));
}

export async function dbDelete(collection: Collection, id: string): Promise<boolean> {
  await ensureInitialized();
  if (PERSISTENCE_BACKEND === "sqlite") return sqliteTransaction().delete(collection, id);
  const db = await loadJson();
  const map = (db.collections[collection] ?? {}) as Record<string, unknown>;
  if (!(id in map)) return false;
  delete map[id];
  await persistJson(db);
  return true;
}

export async function dbDeleteMany(collection: Collection, ids: readonly string[]): Promise<number> {
  await ensureInitialized();
  if (PERSISTENCE_BACKEND === "sqlite") {
    if (!sqlite) throw new Error("Database is not initialized");
    const operation = sqlite.transaction(() => sqliteTransaction().deleteMany(collection, ids));
    return operation();
  }
  const db = await loadJson();
  const map = (db.collections[collection] ?? {}) as Record<string, unknown>;
  let deleted = 0;
  for (const id of new Set(ids)) {
    if (id in map) {
      delete map[id];
      deleted += 1;
    }
  }
  if (deleted) await persistJson(db);
  return deleted;
}

export function persistenceInfo(): {
  backend: "sqlite" | "json";
  database_file: string;
  database_schema_version: number;
  migration_version: number;
  pragmas: {
    foreign_keys: number | null;
    journal_mode: string | null;
    synchronous: number | null;
    busy_timeout: number | null;
  };
} {
  if (PERSISTENCE_BACKEND === "sqlite" && sqlite) {
    return {
      backend: "sqlite",
      database_file: DATABASE_FILE,
      database_schema_version: SCHEMA_VERSION,
      migration_version: MIGRATION_VERSION,
      pragmas: {
        foreign_keys: Number(sqlite.pragma("foreign_keys", { simple: true })),
        journal_mode: String(sqlite.pragma("journal_mode", { simple: true })),
        synchronous: Number(sqlite.pragma("synchronous", { simple: true })),
        busy_timeout: Number(sqlite.pragma("busy_timeout", { simple: true })),
      },
    };
  }
  return {
    backend: PERSISTENCE_BACKEND,
    database_file: DATABASE_FILE,
    database_schema_version: PERSISTENCE_BACKEND === "sqlite" ? SCHEMA_VERSION : 1,
    migration_version: PERSISTENCE_BACKEND === "sqlite" ? MIGRATION_VERSION : 0,
    pragmas: { foreign_keys: null, journal_mode: null, synchronous: null, busy_timeout: null },
  };
}

export function databaseFilePath(): string {
  return DATABASE_FILE;
}

export function databaseDir(): string {
  return DATABASE_ROOT;
}

export function legacyDatabaseFilePath(): string {
  return LEGACY_DATABASE_FILE;
}

export const DB_PATH_INFO = path.dirname(DATABASE_FILE);
