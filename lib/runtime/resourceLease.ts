import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { DATABASE_FILE, PERSISTENCE_BACKEND } from "../config";
import { initializeDatabase } from "../storage/db";
import { observeHostMemory, type HostMemoryObservation } from "./hostMemory";

/** Durable host-wide lease state. No patient or source-image data belongs here. */
export type ResourceLeaseState = "ACTIVE" | "RELEASED" | "EXPIRED";

export interface ResourceLeaseRequest {
  readonly workerId: string;
  readonly jobId: string;
  readonly modelId: string;
  readonly memoryBytes: number;
  readonly threads: number;
}

export interface ResourceLeaseConfig {
  readonly memoryBytes: number;
  readonly threads: number;
  readonly headroomBytes: number;
  readonly leaseMs: number;
  readonly maxActiveLeases: number;
}

export interface ResourceLeaseHandle extends ResourceLeaseRequest {
  readonly reservationId: string;
  readonly expiresAt: string;
}

export interface ResourceLeaseSnapshot {
  readonly configured: boolean;
  readonly backend: "sqlite" | "json";
  readonly budget: { readonly memoryBytes: number; readonly threads: number } | null;
  readonly reserved: { readonly memoryBytes: number; readonly threads: number };
  readonly available: { readonly memoryBytes: number; readonly threads: number };
  readonly activeLeases: number;
  readonly maxActiveLeases: number;
  readonly headroomBytes: number;
  readonly hostMemory: HostMemoryObservation;
}

export type ResourceLeaseRejectionReason =
  | "invalid_configuration"
  | "configuration_mismatch"
  | "invalid_request"
  | "persistence_backend_unsupported"
  | "reservation_limit_reached"
  | "memory_budget_exceeded"
  | "thread_budget_exceeded"
  | "host_memory_low"
  | "database_error";

export interface ResourceLeaseDecision {
  readonly admitted: boolean;
  readonly reservation: ResourceLeaseHandle | null;
  readonly reason: ResourceLeaseRejectionReason | null;
  readonly snapshot: ResourceLeaseSnapshot;
  readonly reclaimed: number;
}

export interface ResourceLeaseOperationResult {
  readonly changed: boolean;
  readonly snapshot: ResourceLeaseSnapshot;
}

export interface ResourceLeaseReapResult {
  readonly expired: number;
  readonly snapshot: ResourceLeaseSnapshot;
}

const TABLE = "resource_leases";
const CONFIG_TABLE = "resource_lease_config";
const DEFAULT_HEADROOM_BYTES = 1 * 1024 ** 3;
const DEFAULT_LEASE_MS = 60_000;
const DEFAULT_MAX_ACTIVE_LEASES = 1024;
const MAX_OPERATION_MS = 24 * 60 * 60 * 1000;
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,160}$/;

function positiveInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) return null;
  return value;
}

function nonNegativeInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return null;
  return value;
}

function envPositive(environment: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = environment[name]?.trim();
  if (!raw || !/^\d+$/.test(raw)) return fallback;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function envNonNegative(environment: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = environment[name]?.trim();
  if (!raw || !/^\d+$/.test(raw)) return fallback;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

export function resourceLeaseConfigFromEnv(environment: NodeJS.ProcessEnv = process.env): ResourceLeaseConfig {
  return {
    memoryBytes: envPositive(environment, "VISIONSCAN_MODEL_MEMORY_BUDGET_BYTES", 0),
    threads: envPositive(environment, "VISIONSCAN_MODEL_THREAD_BUDGET", 0),
    headroomBytes: envNonNegative(environment, "VISIONSCAN_RESOURCE_HEADROOM_BYTES", DEFAULT_HEADROOM_BYTES),
    leaseMs: Math.min(MAX_OPERATION_MS, envPositive(environment, "VISIONSCAN_RESOURCE_LEASE_MS", DEFAULT_LEASE_MS)),
    maxActiveLeases: Math.min(DEFAULT_MAX_ACTIVE_LEASES, envPositive(environment, "VISIONSCAN_RESOURCE_MAX_ACTIVE_LEASES", DEFAULT_MAX_ACTIVE_LEASES)),
  };
}

function validConfig(config: ResourceLeaseConfig): boolean {
  return positiveInteger(config.memoryBytes) !== null &&
    positiveInteger(config.threads) !== null &&
    nonNegativeInteger(config.headroomBytes) !== null &&
    positiveInteger(config.leaseMs) !== null && config.leaseMs <= MAX_OPERATION_MS &&
    positiveInteger(config.maxActiveLeases) !== null;
}

function validRequest(request: ResourceLeaseRequest): boolean {
  return !!request &&
    ID_PATTERN.test(request.workerId) &&
    ID_PATTERN.test(request.jobId) &&
    ID_PATTERN.test(request.modelId) &&
    positiveInteger(request.memoryBytes) !== null &&
    positiveInteger(request.threads) !== null;
}

function nowIso(nowMs?: number): { ms: number; iso: string } {
  const ms = nowMs === undefined ? Date.now() : nowMs;
  if (!Number.isFinite(ms)) throw new Error("Invalid resource lease clock");
  return { ms, iso: new Date(ms).toISOString() };
}

function databasePath(explicit?: string): string {
  const file = explicit?.trim() || DATABASE_FILE;
  return path.resolve(file);
}

function ensureLeaseTable(connection: Database.Database): void {
  connection.exec(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      reservation_id TEXT PRIMARY KEY NOT NULL,
      worker_id TEXT NOT NULL,
      job_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      memory_budget INTEGER NOT NULL CHECK(memory_budget > 0),
      thread_budget INTEGER NOT NULL CHECK(thread_budget > 0),
      created_at TEXT NOT NULL,
      heartbeat_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('ACTIVE','RELEASED','EXPIRED'))
    );
    CREATE INDEX IF NOT EXISTS resource_leases_active_idx ON ${TABLE}(state, expires_at);
    CREATE INDEX IF NOT EXISTS resource_leases_worker_idx ON ${TABLE}(worker_id, state);
    CREATE INDEX IF NOT EXISTS resource_leases_job_idx ON ${TABLE}(job_id, state);
    CREATE TABLE IF NOT EXISTS ${CONFIG_TABLE} (
      config_id INTEGER PRIMARY KEY CHECK(config_id = 1),
      memory_budget INTEGER NOT NULL CHECK(memory_budget > 0),
      thread_budget INTEGER NOT NULL CHECK(thread_budget > 0),
      headroom_bytes INTEGER NOT NULL CHECK(headroom_bytes >= 0),
      lease_ms INTEGER NOT NULL CHECK(lease_ms > 0),
      max_active_leases INTEGER NOT NULL CHECK(max_active_leases > 0)
    );
  `);
}

function configureConnection(connection: Database.Database): void {
  connection.pragma("journal_mode = WAL");
  connection.pragma("busy_timeout = 5000");
  connection.pragma("synchronous = FULL");
  ensureLeaseTable(connection);
}

function openConnection(filePath: string): Database.Database {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const connection = new Database(filePath);
  try {
    configureConnection(connection);
    return connection;
  } catch (error) {
    connection.close();
    throw error;
  }
}

async function prepareConnection(filePath: string): Promise<Database.Database> {
  // The application database owns its normal schema initialization. Explicit
  // test paths can be initialized by this module alone, which keeps race tests
  // isolated and prevents a test from touching the developer's real store.
  if (filePath === databasePath() && PERSISTENCE_BACKEND === "sqlite") await initializeDatabase();
  return openConnection(filePath);
}

function activeRows(connection: Database.Database): Array<{
  reservation_id: string;
  worker_id: string;
  job_id: string;
  model_id: string;
  memory_budget: number;
  thread_budget: number;
  created_at: string;
  heartbeat_at: string;
  expires_at: string;
  state: ResourceLeaseState;
}> {
  return connection.prepare(`SELECT reservation_id, worker_id, job_id, model_id, memory_budget, thread_budget, created_at, heartbeat_at, expires_at, state FROM ${TABLE} WHERE state = 'ACTIVE'`).all() as Array<{
    reservation_id: string;
    worker_id: string;
    job_id: string;
    model_id: string;
    memory_budget: number;
    thread_budget: number;
    created_at: string;
    heartbeat_at: string;
    expires_at: string;
    state: ResourceLeaseState;
  }>;
}

function snapshotInTransaction(
  connection: Database.Database,
  config: ResourceLeaseConfig,
  hostMemory: HostMemoryObservation,
): ResourceLeaseSnapshot {
  const rows = activeRows(connection);
  const reservedMemory = rows.reduce((sum, row) => sum + Number(row.memory_budget), 0);
  const reservedThreads = rows.reduce((sum, row) => sum + Number(row.thread_budget), 0);
  const configured = PERSISTENCE_BACKEND === "sqlite" && validConfig(config);
  return Object.freeze({
    configured,
    backend: PERSISTENCE_BACKEND,
    budget: configured ? Object.freeze({ memoryBytes: config.memoryBytes, threads: config.threads }) : null,
    reserved: Object.freeze({ memoryBytes: reservedMemory, threads: reservedThreads }),
    available: Object.freeze({
      memoryBytes: configured ? Math.max(0, config.memoryBytes - reservedMemory) : 0,
      threads: configured ? Math.max(0, config.threads - reservedThreads) : 0,
    }),
    activeLeases: rows.length,
    maxActiveLeases: config.maxActiveLeases,
    headroomBytes: config.headroomBytes,
    hostMemory,
  });
}

function reclaimExpired(connection: Database.Database, atIso: string): number {
  return Number(connection.prepare(`UPDATE ${TABLE} SET state = 'EXPIRED', heartbeat_at = ? WHERE state = 'ACTIVE' AND expires_at <= ?`).run(atIso, atIso).changes);
}

function configurationMatches(connection: Database.Database, config: ResourceLeaseConfig): boolean {
  const stored = connection.prepare(
    `SELECT memory_budget, thread_budget, headroom_bytes, lease_ms, max_active_leases FROM ${CONFIG_TABLE} WHERE config_id = 1`,
  ).get() as {
    memory_budget: number;
    thread_budget: number;
    headroom_bytes: number;
    lease_ms: number;
    max_active_leases: number;
  } | undefined;
  if (!stored) {
    connection.prepare(
      `INSERT INTO ${CONFIG_TABLE}(config_id, memory_budget, thread_budget, headroom_bytes, lease_ms, max_active_leases) VALUES(1, ?, ?, ?, ?, ?)`,
    ).run(config.memoryBytes, config.threads, config.headroomBytes, config.leaseMs, config.maxActiveLeases);
    return true;
  }
  return stored.memory_budget === config.memoryBytes &&
    stored.thread_budget === config.threads &&
    stored.headroom_bytes === config.headroomBytes &&
    stored.lease_ms === config.leaseMs &&
    stored.max_active_leases === config.maxActiveLeases;
}

function rejection(
  connection: Database.Database,
  config: ResourceLeaseConfig,
  hostMemory: HostMemoryObservation,
  reason: ResourceLeaseRejectionReason,
  reclaimed: number,
): ResourceLeaseDecision {
  return { admitted: false, reservation: null, reason, snapshot: snapshotInTransaction(connection, config, hostMemory), reclaimed };
}

export async function acquireResourceLease(options: {
  request: ResourceLeaseRequest;
  config?: ResourceLeaseConfig;
  nowMs?: number;
  databaseFile?: string;
  hostMemory?: HostMemoryObservation;
}): Promise<ResourceLeaseDecision> {
  const config = options.config ?? resourceLeaseConfigFromEnv();
  const hostMemory = options.hostMemory ?? observeHostMemory();
  if (PERSISTENCE_BACKEND !== "sqlite") {
    const snapshot: ResourceLeaseSnapshot = Object.freeze({
      configured: false,
      backend: PERSISTENCE_BACKEND,
      budget: null,
      reserved: Object.freeze({ memoryBytes: 0, threads: 0 }),
      available: Object.freeze({ memoryBytes: 0, threads: 0 }),
      activeLeases: 0,
      maxActiveLeases: config.maxActiveLeases,
      headroomBytes: config.headroomBytes,
      hostMemory,
    });
    return { admitted: false, reservation: null, reason: "persistence_backend_unsupported", snapshot, reclaimed: 0 };
  }
  if (!validConfig(config)) {
    const snapshot: ResourceLeaseSnapshot = Object.freeze({
      configured: false,
      backend: PERSISTENCE_BACKEND,
      budget: null,
      reserved: Object.freeze({ memoryBytes: 0, threads: 0 }),
      available: Object.freeze({ memoryBytes: 0, threads: 0 }),
      activeLeases: 0,
      maxActiveLeases: config.maxActiveLeases,
      headroomBytes: config.headroomBytes,
      hostMemory,
    });
    return { admitted: false, reservation: null, reason: "invalid_configuration", snapshot, reclaimed: 0 };
  }
  if (!validRequest(options.request)) {
    const snapshot: ResourceLeaseSnapshot = Object.freeze({
      configured: true,
      backend: PERSISTENCE_BACKEND,
      budget: Object.freeze({ memoryBytes: config.memoryBytes, threads: config.threads }),
      reserved: Object.freeze({ memoryBytes: 0, threads: 0 }),
      available: Object.freeze({ memoryBytes: config.memoryBytes, threads: config.threads }),
      activeLeases: 0,
      maxActiveLeases: config.maxActiveLeases,
      headroomBytes: config.headroomBytes,
      hostMemory,
    });
    return { admitted: false, reservation: null, reason: "invalid_request", snapshot, reclaimed: 0 };
  }

  const at = nowIso(options.nowMs);
  let connection: Database.Database;
  try {
    connection = await prepareConnection(databasePath(options.databaseFile));
  } catch {
    const snapshot: ResourceLeaseSnapshot = Object.freeze({
      configured: true,
      backend: PERSISTENCE_BACKEND,
      budget: Object.freeze({ memoryBytes: config.memoryBytes, threads: config.threads }),
      reserved: Object.freeze({ memoryBytes: 0, threads: 0 }),
      available: Object.freeze({ memoryBytes: config.memoryBytes, threads: config.threads }),
      activeLeases: 0,
      maxActiveLeases: config.maxActiveLeases,
      headroomBytes: config.headroomBytes,
      hostMemory,
    });
    return { admitted: false, reservation: null, reason: "database_error", snapshot, reclaimed: 0 };
  }
  try {
    const transaction = connection.transaction(() => {
      const reclaimed = reclaimExpired(connection, at.iso);
      if (!configurationMatches(connection, config)) return rejection(connection, config, hostMemory, "configuration_mismatch", reclaimed);
      const current = snapshotInTransaction(connection, config, hostMemory);
      const request = options.request;
      if (current.activeLeases >= config.maxActiveLeases) return rejection(connection, config, hostMemory, "reservation_limit_reached", reclaimed);
      if (request.memoryBytes > current.available.memoryBytes) return rejection(connection, config, hostMemory, "memory_budget_exceeded", reclaimed);
      if (request.threads > current.available.threads) return rejection(connection, config, hostMemory, "thread_budget_exceeded", reclaimed);
      if (hostMemory.availableBytes !== null && hostMemory.availableBytes < current.reserved.memoryBytes + request.memoryBytes + config.headroomBytes) {
        return rejection(connection, config, hostMemory, "host_memory_low", reclaimed);
      }
      const reservationId = `lease-${crypto.randomUUID()}`;
      const expiresAt = new Date(at.ms + config.leaseMs).toISOString();
      connection.prepare(
        `INSERT INTO ${TABLE}(reservation_id, worker_id, job_id, model_id, memory_budget, thread_budget, created_at, heartbeat_at, expires_at, state) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`,
      ).run(reservationId, request.workerId, request.jobId, request.modelId, request.memoryBytes, request.threads, at.iso, at.iso, expiresAt);
      const reservation: ResourceLeaseHandle = Object.freeze({ ...request, reservationId, expiresAt });
      return { admitted: true, reservation, reason: null, snapshot: snapshotInTransaction(connection, config, hostMemory), reclaimed };
    });
    return transaction() as ResourceLeaseDecision;
  } catch (error) {
    const fallback = snapshotInTransaction(connection, config, hostMemory);
    return { admitted: false, reservation: null, reason: "database_error", snapshot: fallback, reclaimed: 0 };
  } finally {
    connection.close();
  }
}

export async function heartbeatResourceLease(options: {
  reservation: ResourceLeaseHandle;
  config?: ResourceLeaseConfig;
  nowMs?: number;
  databaseFile?: string;
  hostMemory?: HostMemoryObservation;
}): Promise<ResourceLeaseOperationResult> {
  const config = options.config ?? resourceLeaseConfigFromEnv();
  const hostMemory = options.hostMemory ?? observeHostMemory();
  const at = nowIso(options.nowMs);
  const connection = await prepareConnection(databasePath(options.databaseFile));
  try {
    const changed = connection.transaction(() => {
      reclaimExpired(connection, at.iso);
      const expiresAt = new Date(at.ms + config.leaseMs).toISOString();
      const result = connection.prepare(
        `UPDATE ${TABLE} SET heartbeat_at = ?, expires_at = ? WHERE reservation_id = ? AND worker_id = ? AND job_id = ? AND model_id = ? AND state = 'ACTIVE' AND expires_at > ?`,
      ).run(at.iso, expiresAt, options.reservation.reservationId, options.reservation.workerId, options.reservation.jobId, options.reservation.modelId, at.iso);
      return result.changes > 0;
    })();
    return { changed, snapshot: snapshotInTransaction(connection, config, hostMemory) };
  } finally {
    connection.close();
  }
}

export async function releaseResourceLease(options: {
  reservation: ResourceLeaseHandle;
  config?: ResourceLeaseConfig;
  nowMs?: number;
  databaseFile?: string;
  hostMemory?: HostMemoryObservation;
}): Promise<ResourceLeaseOperationResult> {
  const config = options.config ?? resourceLeaseConfigFromEnv();
  const hostMemory = options.hostMemory ?? observeHostMemory();
  const at = nowIso(options.nowMs);
  const connection = await prepareConnection(databasePath(options.databaseFile));
  try {
    const changed = connection.transaction(() => {
      reclaimExpired(connection, at.iso);
      const result = connection.prepare(
        `UPDATE ${TABLE} SET state = 'RELEASED', heartbeat_at = ? WHERE reservation_id = ? AND worker_id = ? AND job_id = ? AND model_id = ? AND state = 'ACTIVE'`,
      ).run(at.iso, options.reservation.reservationId, options.reservation.workerId, options.reservation.jobId, options.reservation.modelId);
      return result.changes > 0;
    })();
    return { changed, snapshot: snapshotInTransaction(connection, config, hostMemory) };
  } finally {
    connection.close();
  }
}

export async function reapExpiredResourceLeases(options: {
  config?: ResourceLeaseConfig;
  nowMs?: number;
  databaseFile?: string;
  hostMemory?: HostMemoryObservation;
} = {}): Promise<ResourceLeaseReapResult> {
  const config = options.config ?? resourceLeaseConfigFromEnv();
  const hostMemory = options.hostMemory ?? observeHostMemory();
  const at = nowIso(options.nowMs);
  const connection = await prepareConnection(databasePath(options.databaseFile));
  try {
    const expired = connection.transaction(() => reclaimExpired(connection, at.iso))();
    return { expired, snapshot: snapshotInTransaction(connection, config, hostMemory) };
  } finally {
    connection.close();
  }
}

export async function inspectResourceLeases(options: {
  config?: ResourceLeaseConfig;
  databaseFile?: string;
  hostMemory?: HostMemoryObservation;
} = {}): Promise<ResourceLeaseSnapshot> {
  const config = options.config ?? resourceLeaseConfigFromEnv();
  const hostMemory = options.hostMemory ?? observeHostMemory();
  const connection = await prepareConnection(databasePath(options.databaseFile));
  try {
    return snapshotInTransaction(connection, config, hostMemory);
  } finally {
    connection.close();
  }
}

export const RESOURCE_LEASE_TABLE = TABLE;
export const RESOURCE_LEASE_CONFIG_TABLE = CONFIG_TABLE;
