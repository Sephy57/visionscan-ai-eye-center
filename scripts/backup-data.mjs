#!/usr/bin/env node
/** Create a recoverable, hashed local data backup under ignored data/backups. */
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import Database from "better-sqlite3";

const repo = process.cwd();
const database = path.resolve(process.env.DATABASE_FILE ?? path.join(repo, "data", "database", "eye-ai.db"));
const legacyDatabase = path.resolve(process.env.LEGACY_DATABASE_FILE ?? path.join(repo, "data", "database", "eye-ai.json"));
const outputArg = process.argv.find((arg) => arg === "--output") ? process.argv[process.argv.indexOf("--output") + 1] : process.argv.find((arg) => arg.startsWith("--output="))?.slice(9);
const output = path.resolve(outputArg ?? path.join(repo, "data", "backups", `backup-${Date.now()}`));
const dryRun = process.argv.includes("--dry-run") || process.argv.includes("-n");
const assetRoots = ["uploads", "documents", "processed", "reports", "logs"];

function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
async function hashFile(file) { return sha256(await fs.readFile(file)); }
async function walk(root, relative = "", includeHashes = !dryRun) {
  const absolute = path.join(root, relative);
  if (!fsSync.existsSync(absolute)) return [];
  const entries = (await fs.readdir(absolute, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
  const files = [];
  for (const entry of entries) {
    const rel = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await walk(root, rel, includeHashes));
    else if (entry.isFile()) {
      const full = path.join(root, rel);
      const stat = await fs.stat(full);
      files.push({ path: rel.replaceAll(path.sep, "/"), size: stat.size, sha256: includeHashes ? await hashFile(full) : null });
    }
  }
  return files;
}
function gitCommit() {
  try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; }
}
function appVersion() {
  try { return JSON.parse(fsSync.readFileSync(path.join(repo, "package.json"), "utf8")).version ?? null; } catch { return null; }
}
function sqliteInfo() {
  if (!fsSync.existsSync(database) || fsSync.statSync(database).size === 0) return { kind: "missing_or_empty" };
  const header = fsSync.readFileSync(database).subarray(0, 16).toString("ascii");
  if (header !== "SQLite format 3\u0000") return { kind: "legacy_or_non_sqlite" };
  const db = new Database(database, { readonly: true, fileMustExist: true });
  try {
    const integrity = db.pragma("integrity_check", { simple: true });
    const schema = db.prepare("SELECT value FROM persistence_meta WHERE key='schema_version'").get()?.value ?? null;
    const migration = db.prepare("SELECT value FROM persistence_meta WHERE key='migration_version'").get()?.value ?? null;
    return { kind: "sqlite", integrity_check: integrity, schema_version: schema, migration_version: migration };
  } finally { db.close(); }
}

const plans = [];
let assetCount = 0;
const assetManifest = [];
const rootPlans = await Promise.all(assetRoots.map(async (rootName) => {
  const root = path.join(repo, "data", rootName);
  const files = await walk(root, "", !dryRun);
  return { rootName, root, files };
}));
for (const { rootName, root, files } of rootPlans) {
  assetCount += files.length;
  assetManifest.push(...files.map((file) => ({ root: rootName, ...file })));
  plans.push({ root: rootName, path: root, files: files.length, bytes: files.reduce((sum, file) => sum + file.size, 0) });
}
const dbExists = fsSync.existsSync(database) && fsSync.statSync(database).isFile();
const dbBytes = dbExists ? fsSync.statSync(database).size : 0;
const dbHash = dbExists ? await hashFile(database) : null;
const legacyExists = fsSync.existsSync(legacyDatabase) && fsSync.statSync(legacyDatabase).isFile();
const legacyHash = legacyExists ? await hashFile(legacyDatabase) : null;
const manifestHash = sha256(JSON.stringify(assetManifest));
const manifest = {
  format: "visionscan-data-backup-v1",
  created_at: new Date().toISOString(),
  repository: repo,
  git_commit: gitCommit(),
  app_version: appVersion(),
  database: { path: database, file_name: path.basename(database), bytes: dbBytes, sha256: dbHash, ...sqliteInfo() },
  legacy_database: { path: legacyDatabase, file_name: path.basename(legacyDatabase), bytes: legacyExists ? fsSync.statSync(legacyDatabase).size : 0, sha256: legacyHash },
  assets: { roots: plans, asset_count: assetCount, manifest_sha256: manifestHash },
  model_weights_included: false,
  hashes_deferred_in_dry_run: dryRun,
  credentials_included: false,
  dry_run: dryRun,
};

if (dryRun) {
  console.log(JSON.stringify({ ...manifest, output, plan_only: true }, null, 2));
  console.error("Dry run only; no backup directory or files were written.");
  process.exit(0);
}

const liveDataRoot = path.resolve(path.join(repo, "data"));
const backupRoot = path.resolve(path.join(repo, "data", "backups"));
if ((output === liveDataRoot || output.startsWith(`${liveDataRoot}${path.sep}`)) &&
    !(output === backupRoot || output.startsWith(`${backupRoot}${path.sep}`))) {
  throw new Error("Backup output must not be inside the live data root");
}
if (fsSync.existsSync(output)) throw new Error(`Backup output already exists; refusing overwrite: ${output}`);

await fs.mkdir(output, { recursive: true });
if (dbExists) {
  await fs.copyFile(database, path.join(output, path.basename(database)));
  if (await hashFile(path.join(output, path.basename(database))) !== dbHash) throw new Error("Copied database hash verification failed");
}
if (legacyExists && path.resolve(legacyDatabase) !== path.resolve(database)) {
  await fs.copyFile(legacyDatabase, path.join(output, path.basename(legacyDatabase)));
  if (await hashFile(path.join(output, path.basename(legacyDatabase))) !== legacyHash) throw new Error("Copied legacy database hash verification failed");
}
for (const suffix of ["-wal", "-shm"]) if (fsSync.existsSync(`${database}${suffix}`)) await fs.copyFile(`${database}${suffix}`, path.join(output, `${path.basename(database)}${suffix}`));
for (const rootName of assetRoots) {
  const sourceRoot = path.join(repo, "data", rootName);
  const destinationRoot = path.join(output, "assets", rootName);
  if (fsSync.existsSync(sourceRoot)) await fs.cp(sourceRoot, destinationRoot, { recursive: true, force: false, errorOnExist: false });
}
await fs.writeFile(path.join(output, "asset-manifest.json"), `${JSON.stringify(assetManifest, null, 2)}\n`, { flag: "wx" });
await fs.writeFile(path.join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ ...manifest, output }, null, 2));
