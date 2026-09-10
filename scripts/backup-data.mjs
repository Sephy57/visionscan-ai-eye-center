#!/usr/bin/env node
/**
 * Create a recoverable, hashed local data backup.
 *
 * Backups are plaintext by default for backwards compatibility. Passing
 * --encrypt (or setting VISIONSCAN_BACKUP_ENCRYPTION=true) encrypts every
 * data payload with AES-256-GCM. The passphrase is read from
 * VISIONSCAN_BACKUP_KEY by default, from the environment variable named by
 * --key-env, or from stdin with --key-stdin. Secrets are never written to a
 * manifest or printed to stdout/stderr.
 */
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import Database from "better-sqlite3";

const repo = process.cwd();
const database = path.resolve(process.env.DATABASE_FILE ?? path.join(repo, "data", "database", "eye-ai.db"));
const legacyDatabase = path.resolve(process.env.LEGACY_DATABASE_FILE ?? path.join(repo, "data", "database", "eye-ai.json"));
const assetRoots = ["uploads", "documents", "processed", "reports", "logs"];
const sqliteHeader = "SQLite format 3\u0000";

function valueAfter(flag) {
  const exact = process.argv.find((arg) => arg === flag);
  if (exact) return process.argv[process.argv.indexOf(exact) + 1];
  const prefix = process.argv.find((arg) => arg.startsWith(`${flag}=`));
  return prefix?.slice(flag.length + 1);
}

const outputArg = valueAfter("--output");
const output = path.resolve(outputArg ?? path.join(repo, "data", "backups", `backup-${Date.now()}`));
const dryRun = process.argv.includes("--dry-run") || process.argv.includes("-n");
const keyEnvName = valueAfter("--key-env") ?? process.env.VISIONSCAN_BACKUP_KEY_ENV ?? "VISIONSCAN_BACKUP_KEY";
const encryptArg = valueAfter("--encrypt");
const encryptFlagPresent = process.argv.includes("--encrypt") || process.argv.some((arg) => arg.startsWith("--encrypt="));
const encryptionRequested = (encryptFlagPresent && (encryptArg === undefined || !["false", "0", "no"].includes(String(encryptArg).toLowerCase()))) ||
  /^(1|true|yes)$/i.test(process.env.VISIONSCAN_BACKUP_ENCRYPTION ?? "");

function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
async function hashFile(file) { return sha256(await fs.readFile(file)); }

function pathIsWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function decodeForPathSafety(value) {
  let decoded = String(value);
  for (let index = 0; index < 4; index += 1) {
    let next;
    try { next = decodeURIComponent(decoded); } catch { throw new Error("Unsafe encoded path in backup manifest"); }
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
}

function safeRelativePath(value, label = "path") {
  if (typeof value !== "string" || value.length === 0 || value.includes("\u0000")) throw new Error(`Unsafe ${label} in backup manifest`);
  const decoded = decodeForPathSafety(value).replaceAll("\\", "/");
  if (decoded.startsWith("/") || decoded.startsWith("//") || /^[A-Za-z]:\//.test(decoded)) throw new Error(`Unsafe ${label} in backup manifest`);
  const parts = decoded.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) throw new Error(`Unsafe ${label} in backup manifest`);
  return parts.join("/");
}

async function assertNoSymlinkAncestors(target) {
  let current = path.resolve(target);
  while (true) {
    if (fsSync.existsSync(current)) {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) throw new Error("Symlink/reparse path rejected");
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

async function walk(root, relative = "", includeHashes = !dryRun, rootReal = null) {
  const absolute = path.join(root, relative);
  const rootStat = await fs.lstat(absolute).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (!rootStat) return [];
  const rootCanonical = rootReal ?? await fs.realpath(root);
  if (rootStat.isSymbolicLink()) throw new Error(`Symlink/reparse path rejected: ${absolute}`);
  if (!rootStat.isDirectory()) throw new Error(`Asset root is not a directory: ${absolute}`);
  const entries = (await fs.readdir(absolute, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
  const files = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) throw new Error(`Symlink/reparse path rejected: ${path.join(absolute, entry.name)}`);
    const rel = safeRelativePath(path.join(relative, entry.name).replaceAll(path.sep, "/"), "asset path");
    const full = path.join(root, rel.replaceAll("/", path.sep));
    const stat = await fs.lstat(full);
    if (stat.isDirectory()) files.push(...await walk(root, rel.replaceAll("/", path.sep), includeHashes, rootCanonical));
    else if (stat.isFile()) {
      const canonical = await fs.realpath(full);
      if (!pathIsWithin(rootCanonical, canonical)) throw new Error(`Asset path escapes root: ${rel}`);
      files.push({ path: rel, size: stat.size, sha256: includeHashes ? await hashFile(full) : null });
    } else throw new Error(`Unsupported filesystem object in asset root: ${full}`);
  }
  return files;
}

function readSecret() {
  let value = process.env[keyEnvName];
  if (process.argv.includes("--key-stdin")) value = fsSync.readFileSync(0, "utf8").replace(/\r?\n$/, "");
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Encryption requested but no backup key was supplied (set ${keyEnvName} or use --key-stdin)`);
  }
  return Buffer.from(value, "utf8");
}

function deriveKey(secret, salt) {
  return crypto.scryptSync(secret, salt, 32, { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

function encryptionDescriptor(salt) {
  return {
    enabled: true,
    version: 1,
    algorithm: "aes-256-gcm",
    kdf: "scrypt",
    kdf_params: { N: 16_384, r: 8, p: 1, key_length: 32 },
    salt: salt.toString("base64"),
    manifest_authentication: "hmac-sha256",
    manifest_hmac: null,
  };
}

function encryptPayload(bytes, key, associatedData) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(associatedData, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from("VSBK1", "ascii"), iv, tag, ciphertext]);
}

function canonicalManifest(manifest) {
  const copy = JSON.parse(JSON.stringify(manifest));
  if (copy.encryption) delete copy.encryption.manifest_hmac;
  return JSON.stringify(copy);
}

function signManifest(manifest, key) {
  return crypto.createHmac("sha256", key).update(canonicalManifest(manifest)).digest("hex");
}

function gitCommit() {
  try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; }
}

function appVersion() {
  try { return JSON.parse(fsSync.readFileSync(path.join(repo, "package.json"), "utf8")).version ?? null; } catch { return null; }
}

function sqliteInfo(filePath = database) {
  if (!fsSync.existsSync(filePath) || fsSync.statSync(filePath).size === 0) return { kind: "missing_or_empty" };
  const header = fsSync.readFileSync(filePath).subarray(0, 16).toString("ascii");
  if (header !== sqliteHeader) return { kind: "legacy_or_non_sqlite" };
  const db = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    const integrity = db.pragma("integrity_check", { simple: true });
    const schema = db.prepare("SELECT value FROM persistence_meta WHERE key='schema_version'").get()?.value ?? null;
    const migration = db.prepare("SELECT value FROM persistence_meta WHERE key='migration_version'").get()?.value ?? null;
    return { kind: "sqlite", integrity_check: integrity, schema_version: schema, migration_version: migration };
  } finally { db.close(); }
}

function parseRetention(createdAt) {
  const value = valueAfter("--retention-days") ?? process.env.VISIONSCAN_BACKUP_RETENTION_DAYS;
  let retentionDays = null;
  if (value !== undefined && value !== null && value !== "") {
    if (!/^\d+$/.test(value) || Number(value) > 365_000) throw new Error("--retention-days must be an integer between 0 and 365000");
    retentionDays = Number(value);
  }
  const legalHoldFlag = process.argv.find((arg) => arg === "--legal-hold" || arg.startsWith("--legal-hold="));
  let legalHold = /^(1|true|yes)$/i.test(process.env.VISIONSCAN_BACKUP_LEGAL_HOLD ?? "");
  if (process.argv.includes("--no-legal-hold")) legalHold = false;
  else if (legalHoldFlag === "--legal-hold") legalHold = true;
  else if (legalHoldFlag?.startsWith("--legal-hold=")) legalHold = !["false", "0", "no"].includes(legalHoldFlag.slice("--legal-hold=".length).toLowerCase());
  const archiveState = String(valueAfter("--archive-state") ?? process.env.VISIONSCAN_BACKUP_ARCHIVE_STATE ?? "ACTIVE").toUpperCase();
  if (!["ACTIVE", "ARCHIVED"].includes(archiveState)) throw new Error("--archive-state must be ACTIVE or ARCHIVED");
  const explicitEligible = valueAfter("--deletion-eligible-at") ?? process.env.VISIONSCAN_BACKUP_DELETION_ELIGIBLE_AT ?? null;
  let deletionEligibleAt = null;
  if (explicitEligible !== null) {
    const parsed = Date.parse(explicitEligible);
    if (Number.isNaN(parsed)) throw new Error("--deletion-eligible-at must be a valid timestamp");
    deletionEligibleAt = new Date(parsed).toISOString();
  }
  if (!deletionEligibleAt && retentionDays !== null) deletionEligibleAt = new Date(Date.parse(createdAt) + retentionDays * 86_400_000).toISOString();
  return {
    policy_version: "v1",
    retention_days: retentionDays,
    legal_hold: legalHold,
    archive_state: archiveState,
    deletion_eligible_at: deletionEligibleAt,
    automatic_deletion: false,
    operator_action_required: true,
  };
}

async function copyPayload(source, destination, logicalName, key, expectedHash) {
  const sourceStat = await fs.lstat(source).catch(() => null);
  if (!sourceStat || !sourceStat.isFile() || sourceStat.isSymbolicLink()) throw new Error(`Source file is missing or unsafe: ${logicalName}`);
  const bytes = await fs.readFile(source);
  if (expectedHash && sha256(bytes) !== expectedHash) throw new Error(`Source changed during backup: ${logicalName}`);
  const payload = key ? encryptPayload(bytes, key, logicalName) : bytes;
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, payload, { flag: "wx" });
  return { sha256: sha256(payload), bytes: payload.length };
}

async function verifyDatabaseSourcesUnchanged() {
  // The online-backup snapshot is already a consistent point-in-time copy;
  // only the legacy file-copy path needs a live-source race check. In that
  // path compare with the hash captured before any payload copy.
  if (!snapshotBackedUp && dbExists && (await hashFile(database)) !== liveDatabaseHash) throw new Error("Database changed during backup; retry after writes quiesce");
  if (!snapshotBackedUp) for (const sidecar of sidecars) {
    const source = path.join(path.dirname(database), sidecar.file_name);
    if ((await hashFile(source)) !== sidecar.sha256) throw new Error(`Database sidecar changed during backup: ${sidecar.file_name}`);
  }
}

/**
 * SQLite's online backup API copies a transactionally consistent snapshot even
 * while another connection has an active writer. Copying the live database
 * file directly is unsafe with WAL because the main file and sidecar can be
 * observed at different points in time. The snapshot is placed outside the
 * data tree and removed at process exit.
 */
async function createSqliteSnapshot(source, destination) {
  const db = new Database(source, { readonly: true, fileMustExist: true });
  try {
    await db.backup(destination);
  } finally {
    db.close();
  }
  const check = new Database(destination, { readonly: true, fileMustExist: true });
  try {
    const integrity = check.pragma("integrity_check", { simple: true });
    if (integrity !== "ok") throw new Error(`SQLite online backup integrity_check failed: ${integrity}`);
  } finally {
    check.close();
  }
}

let backupKey = null;
let encryption = { enabled: false, version: 1, algorithm: null, kdf: null, manifest_authentication: null, manifest_hmac: null };
let encryptionSalt = null;
if (encryptionRequested) {
  const secret = readSecret();
  encryptionSalt = crypto.randomBytes(16);
  backupKey = deriveKey(secret, encryptionSalt);
  secret.fill(0);
  encryption = encryptionDescriptor(encryptionSalt);
}

const createdAt = new Date().toISOString();
const retention = parseRetention(createdAt);
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
const dbName = path.basename(database);
const dbStat = fsSync.existsSync(database) ? fsSync.lstatSync(database) : null;
if (dbStat?.isSymbolicLink()) throw new Error("Database source symlink/reparse path rejected");
const dbExists = Boolean(dbStat?.isFile());
let databaseSource = database;
let databaseSnapshotDir = null;
let snapshotBackedUp = false;
let dbBytes = dbExists ? fsSync.statSync(database).size : 0;
const liveDatabaseHash = dbExists ? await hashFile(database) : null;
let dbHash = liveDatabaseHash;
if (!dryRun && dbExists && fsSync.readFileSync(database).subarray(0, 16).toString("ascii") === sqliteHeader) {
  databaseSnapshotDir = await fs.mkdtemp(path.join(os.tmpdir(), "visionscan-backup-snapshot-"));
  process.once("exit", () => { if (databaseSnapshotDir) fsSync.rmSync(databaseSnapshotDir, { recursive: true, force: true }); });
  databaseSource = path.join(databaseSnapshotDir, dbName);
  await createSqliteSnapshot(database, databaseSource);
  dbBytes = fsSync.statSync(databaseSource).size;
  dbHash = await hashFile(databaseSource);
  snapshotBackedUp = true;
}
const legacyStat = fsSync.existsSync(legacyDatabase) ? fsSync.lstatSync(legacyDatabase) : null;
if (legacyStat?.isSymbolicLink()) throw new Error("Legacy database source symlink/reparse path rejected");
const legacyExists = Boolean(legacyStat?.isFile());
const legacyBytes = legacyExists ? fsSync.statSync(legacyDatabase).size : 0;
const legacyHash = legacyExists ? await hashFile(legacyDatabase) : null;
const legacyName = path.basename(legacyDatabase);
const databaseBackupFile = encryptionRequested ? `${dbName}.enc` : dbName;
const legacyBackupFile = encryptionRequested ? `${legacyName}.enc` : legacyName;
const assetManifestFile = encryptionRequested ? "asset-manifest.json.enc" : "asset-manifest.json";
const sidecars = [];
for (const suffix of snapshotBackedUp ? [] : ["-wal", "-shm"]) {
  const source = `${database}${suffix}`;
  const stat = fsSync.existsSync(source) ? fsSync.lstatSync(source) : null;
  if (stat?.isSymbolicLink()) throw new Error(`Database sidecar symlink/reparse path rejected: ${source}`);
  if (stat?.isFile()) {
    const fileName = `${dbName}${suffix}`;
    sidecars.push({ file_name: fileName, sha256: await hashFile(source), bytes: stat.size, backup_file: encryptionRequested ? `${fileName}.enc` : fileName });
  }
}
for (const entry of assetManifest) if (encryptionRequested) entry.backup_file = `assets/${entry.root}/${entry.path}.enc`;
const manifest = {
  format: "visionscan-data-backup-v1",
  created_at: createdAt,
  repository: repo,
  git_commit: gitCommit(),
  app_version: appVersion(),
  database: { path: database, file_name: dbName, backup_file: databaseBackupFile, bytes: dbBytes, sha256: dbHash, sidecars, snapshot_method: snapshotBackedUp ? "sqlite_online_backup" : "file_copy", ...sqliteInfo(databaseSource) },
  legacy_database: { path: legacyDatabase, file_name: legacyName, backup_file: legacyBackupFile, bytes: legacyBytes, sha256: legacyHash },
  assets: { roots: plans, asset_count: assetCount, manifest_file: assetManifestFile, manifest_sha256: sha256(JSON.stringify(assetManifest)) },
  encryption,
  retention,
  model_weights_included: false,
  hashes_deferred_in_dry_run: dryRun,
  credentials_included: false,
  dry_run: dryRun,
};

if (dryRun) {
  backupKey?.fill(0);
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
await assertNoSymlinkAncestors(path.dirname(output));
const staging = `${output}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
if (fsSync.existsSync(staging)) throw new Error(`Backup staging path already exists; refusing overwrite: ${staging}`);
await fs.mkdir(staging, { recursive: true });
try {
  if (dbExists) {
    const result = await copyPayload(databaseSource, path.join(staging, databaseBackupFile), `database/${dbName}`, backupKey, dbHash);
    manifest.database.backup_sha256 = result.sha256;
    manifest.database.backup_bytes = result.bytes;
  }
  if (legacyExists && path.resolve(legacyDatabase) !== path.resolve(database)) {
    const result = await copyPayload(legacyDatabase, path.join(staging, legacyBackupFile), `legacy/${legacyName}`, backupKey, legacyHash);
    manifest.legacy_database.backup_sha256 = result.sha256;
    manifest.legacy_database.backup_bytes = result.bytes;
  }
  for (const sidecar of sidecars) {
    const source = path.join(path.dirname(database), sidecar.file_name);
    const result = await copyPayload(source, path.join(staging, sidecar.backup_file), `database/${sidecar.file_name}`, backupKey, sidecar.sha256);
    sidecar.backup_sha256 = result.sha256;
    sidecar.backup_bytes = result.bytes;
  }
  for (const entry of assetManifest) {
    const source = path.join(repo, "data", entry.root, entry.path.replaceAll("/", path.sep));
    const destination = path.join(staging, "assets", entry.root, encryptionRequested ? `${entry.path}.enc` : entry.path.replaceAll("/", path.sep));
    const result = await copyPayload(source, destination, `assets/${entry.root}/${entry.path}`, backupKey, entry.sha256);
    entry.backup_sha256 = result.sha256;
    entry.backup_bytes = result.bytes;
  }
  // A copy can race a WAL checkpoint or another writer after its individual
  // read/hash. Re-check all SQLite source bytes immediately before publishing
  // the backup so an overlapping write fails closed instead of producing a
  // falsely complete snapshot. A caller can retry after quiescing writers.
  await verifyDatabaseSourcesUnchanged();
  // Asset entries may contain encrypted-file metadata and their hash therefore
  // must be finalized before signing the manifest.
  manifest.assets.manifest_sha256 = sha256(JSON.stringify(assetManifest));
  const assetManifestBytes = Buffer.from(`${JSON.stringify(assetManifest, null, 2)}\n`, "utf8");
  const assetManifestPayload = backupKey ? encryptPayload(assetManifestBytes, backupKey, "asset-manifest.json") : assetManifestBytes;
  await fs.writeFile(path.join(staging, assetManifestFile), assetManifestPayload, { flag: "wx" });
  manifest.assets.manifest_backup_sha256 = sha256(assetManifestPayload);
  manifest.assets.manifest_backup_bytes = assetManifestPayload.length;
  if (backupKey) manifest.encryption.manifest_hmac = signManifest(manifest, backupKey);
  await fs.writeFile(path.join(staging, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  await fs.rename(staging, output);
} catch (error) {
  await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
  throw error;
} finally {
  backupKey?.fill(0);
}
console.log(JSON.stringify({ ...manifest, output }, null, 2));
