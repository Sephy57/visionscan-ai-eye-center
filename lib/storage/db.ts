import fs from "fs/promises";
import path from "path";
import { DATABASE_ROOT, DATABASE_FILE, ensureDirs } from "../config";

/**
 * Lightweight JSON document store for local development.
 * Stored on D: at data/database/eye-ai.json.
 *
 * Interface is intentionally shaped so it can be swapped for SQLite
 * (data/database/eye-ai.db) without changing callers. SQLite is a planned
 * upgrade - this JSON store is NOT presented as a production database.
 */

export type Collection =
  | "studies"
  | "analyses"
  | "reports"
  | "reviews"
  | "devices"
  | "comparisons"
  | "users";

interface DbShape {
  meta: { version: number; createdAt: string; lastWrite: string };
  collections: Record<Collection, Record<string, unknown>>;
}

const EMPTY: DbShape = {
  meta: { version: 1, createdAt: new Date().toISOString(), lastWrite: new Date().toISOString() },
  collections: {
    studies: {},
    analyses: {},
    reports: {},
    reviews: {},
    devices: {},
    comparisons: {},
    users: {},
  },
};

let cache: DbShape | null = null;
let writeChain: Promise<void> = Promise.resolve();

async function load(): Promise<DbShape> {
  if (cache) return cache;
  ensureDirs();
  try {
    const raw = await fs.readFile(DATABASE_FILE, "utf8");
    const parsed = JSON.parse(raw) as DbShape;
    for (const key of Object.keys(EMPTY.collections)) {
      if (!parsed.collections[key as Collection]) parsed.collections[key as Collection] = {};
    }
    cache = parsed;
  } catch {
    cache = JSON.parse(JSON.stringify(EMPTY)) as DbShape;
  }
  return cache;
}

function persist(db: DbShape): Promise<void> {
  db.meta.lastWrite = new Date().toISOString();
  writeChain = writeChain.then(async () => {
    const tmp = DATABASE_FILE + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(db, null, 2), "utf8");
    await fs.rename(tmp, DATABASE_FILE); // atomic on same volume
  });
  return writeChain;
}

export async function dbPut<T>(collection: Collection, id: string, doc: T): Promise<void> {
  const db = await load();
  db.collections[collection][id] = doc;
  await persist(db);
}

export async function dbGet<T>(collection: Collection, id: string): Promise<T | null> {
  const db = await load();
  return (db.collections[collection][id] as T) ?? null;
}

export async function dbAll<T>(collection: Collection): Promise<T[]> {
  const db = await load();
  return Object.values(db.collections[collection]) as T[];
}

export async function dbDelete(collection: Collection, id: string): Promise<boolean> {
  const db = await load();
  if (!(id in db.collections[collection])) return false;
  delete db.collections[collection][id];
  await persist(db);
  return true;
}

export function databaseFilePath(): string {
  return DATABASE_FILE;
}

export function databaseDir(): string {
  return DATABASE_ROOT;
}

export const DB_PATH_INFO = path.dirname(DATABASE_FILE);
