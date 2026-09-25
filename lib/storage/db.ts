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
  // Immutable effect identities used to prove that retries did not create a
  // second canonical result/evidence/report/completion effect.
  "job_effects",
  // Cross-resource recovery records. These are intentionally metadata-only;
  // immutable clinical payloads remain in their source collections.
  "reconciliation_journal",
] as const;

export type Collection = (typeof COLLECTIONS)[number];

const COLLECTION_SET = new Set<string>(COLLECTIONS);
const SQLITE_HEADER = Buffer.from("SQLite format 3\u0000", "ascii");
const SCHEMA_VERSION = 1;
const MIGRATION_VERSION = 1;

/** Explicit relational metadata carried alongside the JSON payload. The
 * application remains payload-first, but these nullable columns make the
 * safety-critical links inspectable/indexable without requiring a full
 * normalization rewrite. */
const RELATIONAL_COLUMNS = [
  "patient_id",
  "encounter_id",
  "study_id",
  "document_id",
  "analysis_id",
  "report_id",
  "tenant_id",
  "job_id",
] as const;

// Every collection uses the same payload envelope and may receive a typed
// reference in a future migration. Applying the additive columns to all
// existing tables keeps older SQLite stores writable after the schema evolves
// (for example, the pre-relational `users` table).
const RELATIONAL_COLLECTIONS = new Set<Collection>(COLLECTIONS);

type RelationalColumn = (typeof RELATIONAL_COLUMNS)[number];

function referenceValue(doc: unknown, key: RelationalColumn): string | null {
  if (!doc || typeof doc !== "object") return null;
  const value = (doc as Record<string, unknown>)[key] ??
    (doc as Record<string, unknown>)[key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function tenantValue(doc: unknown): string | null {
  return referenceValue(doc, "tenant_id");
}

const REFERENCE_TARGETS: Partial<Record<Collection, Partial<Record<RelationalColumn, Collection>>>> = {
  encounters: { patient_id: "patients" },
  studies: { patient_id: "patients", encounter_id: "encounters" },
  documents: { study_id: "studies", patient_id: "patients" },
  analyses: { study_id: "studies" },
  reports: { study_id: "studies", analysis_id: "analyses" },
  clinician_reviews: { report_id: "reports" },
  reasoning_records: { study_id: "studies", analysis_id: "analyses", report_id: "reports" },
  model_executions: { analysis_id: "analyses" },
  evidence: { study_id: "studies", analysis_id: "analyses" },
  jobs: { study_id: "studies", document_id: "documents", analysis_id: "analyses" },
  model_errors: { study_id: "studies", analysis_id: "analyses" },
};

// These records are created by the current ingestion/analysis/worker paths.
// They must never introduce another dangling study link.  Other typed links
// remain nullable during the phased legacy migration because their historical
// rows are imported from the pre-relational store and are reconciled out of
// band.  Keeping this allow-list narrow also preserves the report/reasoning
// publication ordering (a reasoning record can be written before its report).
const REQUIRED_FUTURE_REFERENCES: Partial<Record<Collection, Partial<Record<RelationalColumn, Collection>>>> = {
  documents: { study_id: "studies" },
  analyses: { study_id: "studies" },
  jobs: { study_id: "studies" },
  reports: { analysis_id: "analyses" },
  clinician_reviews: { report_id: "reports" },
};

/**
 * Validate the tenant boundary for a typed reference. Missing legacy targets
 * are reported by reconciliation/migration instead of being guessed here;
 * when both sides carry a tenant, a mismatch is always rejected.
 */
function assertTenantReferences(
  collection: Collection,
  doc: unknown,
  lookup: <T>(target: Collection, id: string) => T | null,
): void {
  const sourceTenant = tenantValue(doc);
  const targets = REFERENCE_TARGETS[collection];
  if (!targets) return;
  for (const [column, targetCollection] of Object.entries(targets) as Array<[RelationalColumn, Collection]>) {
    const id = referenceValue(doc, column);
    if (!id) continue;
    const target = lookup(targetCollection, id);
    if (!target) continue; // legacy/import rows are reconciled separately
    const targetTenant = tenantValue(target);
    if (sourceTenant && targetTenant && sourceTenant !== targetTenant) {
      throw new Error(`CROSS_TENANT_REFERENCE:${collection}.${column}->${targetCollection}/${id}`);
    }
  }
}

/**
 * Current writes may not create the historical missing-study state.  Legacy
 * imports bypass this application writer and remain visible to the read-only
 * FK/reconciliation reports, so this is a future-write guard rather than a
 * destructive cleanup or an attempted data repair.
 */
function assertRequiredFutureReferences(
  collection: Collection,
  doc: unknown,
  lookup: <T>(target: Collection, id: string) => T | null,
): void {
  const targets = REQUIRED_FUTURE_REFERENCES[collection];
  if (!targets) return;
  for (const [column, targetCollection] of Object.entries(targets) as Array<[RelationalColumn, Collection]>) {
    const id = referenceValue(doc, column);
    if (!id) continue;
    if (!lookup(targetCollection, id)) {
      throw new Error(`MISSING_TYPED_REFERENCE:${collection}.${column}->${targetCollection}/${id}`);
    }
  }
}

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
          updated_at TEXT NOT NULL,
          patient_id TEXT,
          encounter_id TEXT,
          study_id TEXT,
          document_id TEXT,
          analysis_id TEXT,
          report_id TEXT,
          tenant_id TEXT,
          job_id TEXT
        );
        CREATE INDEX IF NOT EXISTS ${collection}_updated_at_idx ON ${table}(updated_at);`,
      );
      // Existing databases created before the relational metadata layer are
      // upgraded in place. ALTER TABLE is idempotent because PRAGMA is read
      // first; payload rows remain byte-for-byte untouched.
      if (RELATIONAL_COLLECTIONS.has(collection)) {
        const existingColumns = new Set(
          (connection.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name),
        );
        for (const column of RELATIONAL_COLUMNS) {
          if (!existingColumns.has(column)) connection.exec(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT`);
          connection.exec(`CREATE INDEX IF NOT EXISTS ${collection}_${column}_idx ON ${table}(${column})`);
        }
      }
    }
    // A registry keyed by collection/id gives us a target for typed links
    // without relying on ambiguous ids that can legitimately repeat across
    // collections. SQLite foreign keys protect the registry rows themselves.
    connection.exec(`
      CREATE TABLE IF NOT EXISTS persistence_entities (
        entity_key TEXT PRIMARY KEY NOT NULL,
        collection TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        tenant_id TEXT,
        lifecycle TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(lifecycle IN ('ACTIVE','ARCHIVED','DELETED')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(collection, entity_id)
      );
      CREATE INDEX IF NOT EXISTS persistence_entities_tenant_idx ON persistence_entities(tenant_id);
      CREATE TABLE IF NOT EXISTS persistence_links (
        source_key TEXT NOT NULL,
        target_key TEXT NOT NULL,
        relation TEXT NOT NULL,
        tenant_id TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY(source_key, target_key, relation),
        FOREIGN KEY(source_key) REFERENCES persistence_entities(entity_key) ON DELETE RESTRICT,
        FOREIGN KEY(target_key) REFERENCES persistence_entities(entity_key) ON DELETE RESTRICT
      );
      CREATE INDEX IF NOT EXISTS persistence_links_target_idx ON persistence_links(target_key);
    `);
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
let startupRecoveryDone = false;

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
  /** Rows whose indexed relational column equals `value`, oldest first. */
  where<T>(collection: Collection, column: RelationalColumn, value: string): T[];
  put<T>(collection: Collection, id: string, doc: T): void;
  delete(collection: Collection, id: string): boolean;
  deleteMany(collection: Collection, ids: readonly string[]): number;
}

export type DbTransaction = SyncTransaction;

function sqliteTransaction(): SyncTransaction {
  if (!sqlite) throw new Error("Database is not initialized");
  const connection = sqlite;
  const readTarget = <T>(target: Collection, id: string): T | null => {
    const row = connection.prepare(`SELECT payload FROM ${tableName(target)} WHERE id = ?`).get(id) as
      | { payload: string }
      | undefined;
    return row ? parsePayload<T>(target, id, row.payload) : null;
  };
  const registerEntity = (collection: Collection, id: string, doc: unknown): void => {
    const entityKey = `${collection}:${id}`;
    const timestamp = now();
    const lifecycle = (() => {
      const raw = doc && typeof doc === "object" ? (doc as Record<string, unknown>).lifecycle ?? (doc as Record<string, unknown>).archive_state : undefined;
      return raw === "ARCHIVED" || raw === "DELETED" ? raw : "ACTIVE";
    })();
    connection.prepare(
      `INSERT INTO persistence_entities(entity_key, collection, entity_id, tenant_id, lifecycle, created_at, updated_at)
       VALUES(?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(entity_key) DO UPDATE SET tenant_id=excluded.tenant_id, lifecycle=excluded.lifecycle, updated_at=excluded.updated_at`,
    ).run(entityKey, collection, id, tenantValue(doc), lifecycle, timestamp, timestamp);

    const targets = REFERENCE_TARGETS[collection];
    if (!targets) return;
    const link = connection.prepare(
      `INSERT OR IGNORE INTO persistence_links(source_key, target_key, relation, tenant_id, created_at) VALUES(?, ?, ?, ?, ?)`,
    );
    for (const [column] of Object.entries(targets) as Array<[RelationalColumn, Collection]>) {
      const refId = referenceValue(doc, column);
      const targetCollection = targets[column];
      if (!refId || !targetCollection) continue;
      const targetKey = `${targetCollection}:${refId}`;
      // Legacy rows may predate the registry. Keep the payload write safe and
      // let reconciliation report the unresolved link rather than inventing a
      // target entity or weakening the FK.
      const targetExists = connection.prepare("SELECT 1 AS present FROM persistence_entities WHERE entity_key = ?").get(targetKey);
      if (targetExists) link.run(entityKey, targetKey, column, tenantValue(doc), timestamp);
    }
  };
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
    where<T>(collection: Collection, column: RelationalColumn, value: string) {
      // `column` is constrained to the fixed RELATIONAL_COLUMNS allow-list, so
      // it is never caller-controlled SQL; the value is always bound.
      if (!RELATIONAL_COLUMNS.includes(column)) throw new Error(`Unsupported relational column: ${column}`);
      const rows = connection
        .prepare(`SELECT id, payload FROM ${tableName(collection)} WHERE ${column} = ? ORDER BY created_at, id`)
        .all(value) as Array<{ id: string; payload: string }>;
      return rows.map((row) => clone(parsePayload<T>(collection, row.id, row.payload)));
    },
    put<T>(collection: Collection, id: string, doc: T) {
      if (collection === "clinician_reviews" && readTarget(collection, id)) {
        throw new Error(`IMMUTABLE_REVIEW_EVENT_EXISTS:${id}`);
      }
      assertRequiredFutureReferences(collection, doc, readTarget);
      assertTenantReferences(collection, doc, readTarget);
      const payload = jsonPayload(doc);
      const timestamp = now();
      connection
        .prepare(
          `INSERT INTO ${tableName(collection)}(id, payload, created_at, updated_at, patient_id, encounter_id, study_id, document_id, analysis_id, report_id, tenant_id, job_id)
           VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at,
             patient_id=excluded.patient_id, encounter_id=excluded.encounter_id, study_id=excluded.study_id,
             document_id=excluded.document_id, analysis_id=excluded.analysis_id, report_id=excluded.report_id,
             tenant_id=excluded.tenant_id, job_id=excluded.job_id`,
        )
        .run(
          id,
          payload,
          timestamp,
          timestamp,
          referenceValue(doc, "patient_id"),
          referenceValue(doc, "encounter_id"),
          referenceValue(doc, "study_id"),
          referenceValue(doc, "document_id"),
          referenceValue(doc, "analysis_id"),
          referenceValue(doc, "report_id"),
          tenantValue(doc),
          referenceValue(doc, "job_id"),
        );
      registerEntity(collection, id, doc);
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
  if (PERSISTENCE_BACKEND === "sqlite" && !startupRecoveryDone) {
    startupRecoveryDone = true;
    // Loaded lazily to keep the low-level store independent of the scanner's
    // audit/fs helpers and to avoid an import cycle during module startup.
    const { recoverPendingReconciliations } = await import("./reconciliation");
    await recoverPendingReconciliations();
  }
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
  startupRecoveryDone = false;
}

export interface DbTransactionOptions {
  /**
   * Take SQLite's write lock at BEGIN (BEGIN IMMEDIATE). Use for
   * read-then-write decisions (claim, idempotent enqueue) that other
   * processes sharing the database file may race: a deferred transaction
   * that reads first can fail with SQLITE_BUSY_SNAPSHOT when it upgrades to
   * a write, which busy_timeout cannot retry.
   */
  immediate?: boolean;
}

// The legacy JSON backend clones one shared cache per transaction; running
// transactions one at a time keeps a concurrent read-modify-write from
// overwriting another's changes.
let jsonTransactionChain: Promise<unknown> = Promise.resolve();

export async function dbTransaction<T>(work: (tx: DbTransaction) => T, options: DbTransactionOptions = {}): Promise<T> {
  await ensureInitialized();
  if (PERSISTENCE_BACKEND === "sqlite") {
    if (!sqlite) throw new Error("Database is not initialized");
    const transaction = sqlite.transaction(() => {
      const result = work(sqliteTransaction());
      assertSyncResult(result);
      return result;
    });
    return (options.immediate ? transaction.immediate() : transaction()) as T;
  }
  const run = jsonTransactionChain.then(() => jsonTransaction(work));
  jsonTransactionChain = run.catch(() => undefined);
  return run;
}

async function jsonTransaction<T>(work: (tx: DbTransaction) => T): Promise<T> {
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
    where<TValue>(collection: Collection, column: RelationalColumn, value: string) {
      return Object.values((draft.collections[collection] ?? {}) as Record<string, unknown>)
        .filter((doc) => referenceValue(doc, column) === value)
        .sort((a, b) => String((a as { created_at?: unknown }).created_at ?? "").localeCompare(String((b as { created_at?: unknown }).created_at ?? ""))
          || String((a as { id?: unknown }).id ?? "").localeCompare(String((b as { id?: unknown }).id ?? "")))
        .map((doc) => clone(doc as TValue));
    },
    put<TValue>(collection: Collection, id: string, doc: TValue) {
      if (collection === "clinician_reviews" && (draft.collections[collection] as Record<string, unknown> | undefined)?.[id] !== undefined) {
        throw new Error(`IMMUTABLE_REVIEW_EVENT_EXISTS:${id}`);
      }
      assertRequiredFutureReferences(collection, doc, <T>(target: Collection, targetId: string) => {
        const value = (draft.collections[target] as Record<string, unknown> | undefined)?.[targetId];
        return value === undefined ? null : value as T;
      });
      assertTenantReferences(collection, doc, <T>(target: Collection, targetId: string) => {
        const value = (draft.collections[target] as Record<string, unknown> | undefined)?.[targetId];
        return value === undefined ? null : value as T;
      });
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
    if (!sqlite) throw new Error("Database is not initialized");
    // Metadata, registry entity, and typed links commit as one unit. A
    // process crash can therefore not leave a payload row without its
    // relational safety envelope.
    const operation = sqlite.transaction(() => sqliteTransaction().put(collection, id, doc));
    operation();
    return;
  }
  const db = await loadJson();
  if (collection === "clinician_reviews" && db.collections[collection]?.[id] !== undefined) {
    throw new Error(`IMMUTABLE_REVIEW_EVENT_EXISTS:${id}`);
  }
  assertRequiredFutureReferences(collection, doc, <TValue>(target: Collection, targetId: string) => {
    const value = (db.collections[target] as Record<string, unknown> | undefined)?.[targetId];
    return value === undefined ? null : value as TValue;
  });
  assertTenantReferences(collection, doc, <TValue>(target: Collection, targetId: string) => {
    const value = (db.collections[target] as Record<string, unknown> | undefined)?.[targetId];
    return value === undefined ? null : value as TValue;
  });
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

/**
 * Bounded, stable keyset pagination over a collection.
 *
 * The storage envelope deliberately keeps the domain record as JSON, but
 * SQLite owns a created_at/id ordering key for every row.  Pages therefore
 * never use OFFSET (which gets slower and shifts under concurrent inserts):
 * the opaque cursor identifies the last (created_at, id) pair returned and
 * the next query seeks past that pair.  The JSON backend implements the same
 * contract in memory for explicitly-selected legacy mode.
 *
 * `predicate` is intended for server-side scope/filtering.  When supplied,
 * the bounded scanner advances the cursor over records that do not match so
 * a filtered page is complete rather than silently dropping rows.  The
 * response remains bounded by `limit`; `max_scan` protects a pathological
 * sparse filter from an unbounded request.
 */
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;
export const MAX_PAGE_SCAN = 100_000;

export type PageDirection = "asc" | "desc";

export interface DbPageOptions<T = unknown> {
  limit?: number;
  cursor?: string;
  direction?: PageDirection;
  predicate?: (value: T) => boolean;
  max_scan?: number;
}

export interface DbPageResult<T> {
  items: T[];
  next_cursor: string | null;
  has_more: boolean;
  limit: number;
}

interface PageCursor {
  version: 1;
  direction: PageDirection;
  created_at: string;
  id: string;
}

function pageLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_PAGE_SIZE;
  return Math.max(1, Math.min(MAX_PAGE_SIZE, Math.floor(value)));
}

function pageScanLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return MAX_PAGE_SCAN;
  return Math.max(1, Math.min(MAX_PAGE_SCAN, Math.floor(value)));
}

function encodePageCursor(cursor: Omit<PageCursor, "version">): string {
  return Buffer.from(JSON.stringify({ version: 1, ...cursor }), "utf8").toString("base64url");
}

function decodePageCursor(raw: string | undefined, direction: PageDirection): PageCursor | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid pagination cursor");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("Invalid pagination cursor");
  const candidate = parsed as Partial<PageCursor>;
  if (candidate.version !== 1 || candidate.direction !== direction ||
      typeof candidate.created_at !== "string" || typeof candidate.id !== "string" ||
      !candidate.id || candidate.created_at.length > 128 || candidate.id.length > 512) {
    throw new Error("Invalid pagination cursor");
  }
  return candidate as PageCursor;
}

function recordCreatedAt(value: unknown): string {
  const candidate = value as { created_at?: unknown } | null;
  return typeof candidate?.created_at === "string" ? candidate.created_at : "";
}

function comparePageKey(a: { created_at: string; id: string }, b: { created_at: string; id: string }): number {
  const timestamp = a.created_at.localeCompare(b.created_at);
  return timestamp || a.id.localeCompare(b.id);
}

function isAfterPageCursor(
  row: { created_at: string; id: string },
  cursor: PageCursor | null,
  direction: PageDirection,
): boolean {
  if (!cursor) return true;
  const comparison = comparePageKey(row, cursor);
  return direction === "asc" ? comparison > 0 : comparison < 0;
}

function pageResult<T>(items: T[], last: { created_at: string; id: string } | null, hasMore: boolean, limit: number, direction: PageDirection): DbPageResult<T> {
  return {
    items,
    next_cursor: hasMore && last ? encodePageCursor({ direction, created_at: last.created_at, id: last.id }) : null,
    has_more: hasMore,
    limit,
  };
}

async function sqlitePage<T>(collection: Collection, options: DbPageOptions<T>): Promise<DbPageResult<T>> {
  if (!sqlite) throw new Error("Database is not initialized");
  const limit = pageLimit(options.limit);
  const direction = options.direction ?? "desc";
  const cursor = decodePageCursor(options.cursor, direction);
  const order = direction === "asc" ? "ASC" : "DESC";
  const table = tableName(collection);
  const fetchRows = (after: PageCursor | null, fetchLimit: number) => {
    if (!after) {
      return sqlite!.prepare(`SELECT id, payload, created_at FROM ${table} ORDER BY created_at ${order}, id ${order} LIMIT ?`).all(fetchLimit) as Array<{ id: string; payload: string; created_at: string }>;
    }
    const operator = direction === "asc" ? ">" : "<";
    return sqlite!.prepare(
      `SELECT id, payload, created_at FROM ${table}
       WHERE created_at ${operator} ? OR (created_at = ? AND id ${operator} ?)
       ORDER BY created_at ${order}, id ${order} LIMIT ?`,
    ).all(after.created_at, after.created_at, after.id, fetchLimit) as Array<{ id: string; payload: string; created_at: string }>;
  };

  // The common path has no predicate and is a single indexed/ordered SQL
  // query.  Fetch one sentinel row to establish has_more without a COUNT.
  if (!options.predicate) {
    const rows = fetchRows(cursor, limit + 1);
    const pageRows = rows.slice(0, limit);
    const items = pageRows.map((row) => clone(parsePayload<T>(collection, row.id, row.payload)));
    const last = pageRows.length ? pageRows[pageRows.length - 1] : null;
    return pageResult(items, last, rows.length > limit, limit, direction);
  }

  const maxScan = pageScanLimit(options.max_scan);
  const items: T[] = [];
  let scanCursor = cursor;
  let scanned = 0;
  let hasMore = false;
  const filterBatchSize = MAX_PAGE_SIZE + 1;
  while (items.length < limit) {
    const rows = fetchRows(scanCursor, Math.max(limit + 1, filterBatchSize));
    if (!rows.length) break;
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      scanned += 1;
      if (scanned > maxScan) throw new Error("Pagination scan limit exceeded");
      scanCursor = { version: 1, direction, created_at: row.created_at, id: row.id };
      const value = clone(parsePayload<T>(collection, row.id, row.payload));
      if (options.predicate!(value)) items.push(value);
      if (items.length >= limit) {
        // A row after the last matching item was fetched, or the batch was
        // filled to its limit: either case proves that another page may
        // exist.  Returning the last matching row keeps the cursor semantic
        // intuitive and makes skipped rows eligible on the next request.
        const lastMatching = row;
        hasMore = index < rows.length - 1 || rows.length > filterBatchSize - 1;
        return pageResult(items, lastMatching, hasMore, limit, direction);
      }
    }
    if (rows.length < filterBatchSize) break;
  }
  return pageResult(items, items.length ? scanCursor : null, false, limit, direction);
}

async function jsonPage<T>(collection: Collection, options: DbPageOptions<T>): Promise<DbPageResult<T>> {
  const db = await loadJson();
  const limit = pageLimit(options.limit);
  const direction = options.direction ?? "desc";
  const cursor = decodePageCursor(options.cursor, direction);
  const rows = Object.entries(db.collections[collection] ?? {})
    .map(([id, value]) => ({ id, value: clone(value as T), created_at: recordCreatedAt(value) }))
    .sort((a, b) => direction === "asc" ? comparePageKey(a, b) : comparePageKey(b, a));
  const maxScan = pageScanLimit(options.max_scan);
  const items: T[] = [];
  let scanned = 0;
  let last: { created_at: string; id: string } | null = null;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (!isAfterPageCursor(row, cursor, direction)) continue;
    scanned += 1;
    if (scanned > maxScan) throw new Error("Pagination scan limit exceeded");
    const matches = options.predicate ? options.predicate(row.value) : true;
    if (matches) {
      items.push(row.value);
      last = row;
      if (items.length >= limit) {
        return pageResult(items, last, index < rows.length - 1, limit, direction);
      }
    }
    last = row;
  }
  return pageResult(items, items.length ? last : null, false, limit, direction);
}

export async function dbPage<T>(collection: Collection, options: DbPageOptions<T> = {}): Promise<DbPageResult<T>> {
  await ensureInitialized();
  return PERSISTENCE_BACKEND === "sqlite" ? sqlitePage(collection, options) : jsonPage(collection, options);
}

/**
 * Oldest rows whose top-level payload `field` is NOT one of `excluded`
 * (case-insensitive; a missing field counts as not excluded), optionally only
 * those whose `dueField` is absent or at/before `dueAtOrBefore` (ISO-8601
 * strings compare chronologically). SQLite evaluates the filter itself, so
 * the cost does not grow with parsing every historical row in JavaScript and
 * there is no page-scan ceiling. Field names are restricted to identifiers
 * and every value is bound.
 */
export async function dbSelectExcludingFieldValues<T>(collection: Collection, options: {
  field: string; excluded: readonly string[]; dueField?: string; dueAtOrBefore?: string; limit: number;
}): Promise<T[]> {
  await ensureInitialized();
  const identifier = /^[a-z_][a-z0-9_]*$/;
  if (!identifier.test(options.field) || (options.dueField && !identifier.test(options.dueField))) {
    throw new Error("Unsupported payload field");
  }
  const limit = Math.max(1, Math.min(MAX_PAGE_SIZE, Math.floor(options.limit)));
  const excluded = options.excluded.map((value) => value.toLowerCase());
  if (PERSISTENCE_BACKEND === "sqlite") {
    if (!sqlite) throw new Error("Database is not initialized");
    const fieldExpr = `lower(json_extract(payload, '$.${options.field}'))`;
    const clauses = [`(${fieldExpr} IS NULL${excluded.length ? ` OR ${fieldExpr} NOT IN (${excluded.map(() => "?").join(", ")})` : ""})`];
    const params: unknown[] = [...excluded];
    if (options.dueField && options.dueAtOrBefore) {
      clauses.push(`(json_extract(payload, '$.${options.dueField}') IS NULL OR json_extract(payload, '$.${options.dueField}') <= ?)`);
      params.push(options.dueAtOrBefore);
    }
    const rows = sqlite
      .prepare(`SELECT id, payload FROM ${tableName(collection)} WHERE ${clauses.join(" AND ")} ORDER BY created_at, id LIMIT ?`)
      .all(...params, limit) as Array<{ id: string; payload: string }>;
    return rows.map((row) => clone(parsePayload<T>(collection, row.id, row.payload)));
  }
  const db = await loadJson();
  return Object.values((db.collections[collection] ?? {}) as Record<string, Record<string, unknown>>)
    .filter((doc) => {
      const value = doc[options.field];
      if (value !== undefined && value !== null && excluded.includes(String(value).toLowerCase())) return false;
      if (options.dueField && options.dueAtOrBefore) {
        const due = doc[options.dueField];
        if (due !== undefined && due !== null && String(due) > options.dueAtOrBefore) return false;
      }
      return true;
    })
    .sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) || String(a.id ?? "").localeCompare(String(b.id ?? "")))
    .slice(0, limit)
    .map((doc) => clone(doc as T));
}

/** Cheap aggregate count used by bounded list endpoints and dashboards. */
export async function dbCount(collection: Collection): Promise<number> {
  await ensureInitialized();
  if (PERSISTENCE_BACKEND === "sqlite") {
    if (!sqlite) throw new Error("Database is not initialized");
    const row = sqlite.prepare(`SELECT COUNT(*) AS count FROM ${tableName(collection)}`).get() as { count: number };
    return Number(row.count);
  }
  const db = await loadJson();
  return Object.keys(db.collections[collection] ?? {}).length;
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

export interface DatabaseMaintenanceResult {
  backend: "sqlite" | "json";
  integrity_check: string;
  wal_checkpoint: unknown;
  database_bytes: number;
  wal_bytes: number;
  shm_bytes: number;
  collection_counts: Partial<Record<Collection, number>>;
  performed_at: string;
}

/** Safe admin maintenance primitives. No VACUUM is issued while the service
 * is running; callers can schedule that separately during a maintenance
 * window if it is ever justified. */
export async function databaseMaintenance(): Promise<DatabaseMaintenanceResult> {
  await ensureInitialized();
  if (PERSISTENCE_BACKEND === "json" || !sqlite) {
    const counts: Partial<Record<Collection, number>> = {};
    for (const collection of COLLECTIONS) counts[collection] = await dbCount(collection);
    const stat = await fsp.stat(DATABASE_FILE).catch(() => null);
    return { backend: "json", integrity_check: "not_applicable", wal_checkpoint: null, database_bytes: stat?.size ?? 0, wal_bytes: 0, shm_bytes: 0, collection_counts: counts, performed_at: now() };
  }
  const integrity = String(sqlite.pragma("integrity_check", { simple: true }));
  let checkpoint: unknown = null;
  try { checkpoint = sqlite.pragma("wal_checkpoint(PASSIVE)"); } catch (error) { checkpoint = { error: String(error) }; }
  const counts: Partial<Record<Collection, number>> = {};
  for (const collection of COLLECTIONS) {
    const row = sqlite.prepare(`SELECT COUNT(*) AS count FROM ${tableName(collection)}`).get() as { count: number };
    counts[collection] = Number(row.count);
  }
  const [dbStat, walStat, shmStat] = await Promise.all([
    fsp.stat(DATABASE_FILE).catch(() => null),
    fsp.stat(`${DATABASE_FILE}-wal`).catch(() => null),
    fsp.stat(`${DATABASE_FILE}-shm`).catch(() => null),
  ]);
  return { backend: "sqlite", integrity_check: integrity, wal_checkpoint: checkpoint, database_bytes: dbStat?.size ?? 0, wal_bytes: walStat?.size ?? 0, shm_bytes: shmStat?.size ?? 0, collection_counts: counts, performed_at: now() };
}

export function legacyDatabaseFilePath(): string {
  return LEGACY_DATABASE_FILE;
}

export const DB_PATH_INFO = path.dirname(DATABASE_FILE);
