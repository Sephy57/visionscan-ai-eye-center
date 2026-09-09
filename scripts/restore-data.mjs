#!/usr/bin/env node
/**
 * Verify a VisionScan backup and restore it without overwriting by default.
 * Encrypted backups use the AES-256-GCM/scrypt format emitted by
 * backup-data.mjs. A restore is staged and verified before it is made visible;
 * a missing asset, wrong key, tampered manifest, or partial copy leaves no
 * published restore directory.
 */
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";

const repo = process.cwd();
const assetRoots = ["uploads", "documents", "processed", "reports", "logs"];
const sqliteHeader = "SQLite format 3\u0000";

function valueAfter(flag) {
  const exact = process.argv.find((arg) => arg === flag);
  if (exact) return process.argv[process.argv.indexOf(exact) + 1];
  const prefix = process.argv.find((arg) => arg.startsWith(`${flag}=`));
  return prefix?.slice(flag.length + 1);
}

const backupArg = valueAfter("--backup");
const backup = backupArg ? path.resolve(backupArg) : null;
if (!backup || backup === path.resolve(repo)) throw new Error("--backup <directory> is required");
const activate = process.argv.includes("--activate");
const targetArg = valueAfter("--target");
const target = targetArg ? path.resolve(targetArg) : null;
const dryRun = process.argv.includes("--dry-run") || process.argv.includes("-n");
const keyEnvName = valueAfter("--key-env") ?? process.env.VISIONSCAN_BACKUP_KEY_ENV ?? "VISIONSCAN_BACKUP_KEY";

function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }

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

function safeFileName(value, label) {
  const normalized = safeRelativePath(value, label);
  if (normalized.includes("/")) throw new Error(`Unsafe ${label} in backup manifest`);
  return normalized;
}

async function assertNoSymlinkAncestors(targetPath) {
  let current = path.resolve(targetPath);
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

async function safeBackupPath(relativePath, label = "backup path") {
  const normalized = safeRelativePath(relativePath, label);
  const candidate = path.resolve(backup, normalized.replaceAll("/", path.sep));
  if (!pathIsWithin(backup, candidate)) throw new Error(`Unsafe ${label} in backup manifest`);
  await assertNoSymlinkAncestors(path.dirname(candidate));
  const stat = await fs.lstat(candidate).catch(() => null);
  if (!stat || !stat.isFile() || stat.isSymbolicLink()) throw new Error(`Backup file is missing or unsafe: ${normalized}`);
  return candidate;
}

function readSecret() {
  let value = process.env[keyEnvName];
  if (process.argv.includes("--key-stdin")) value = fsSync.readFileSync(0, "utf8").replace(/\r?\n$/, "");
  if (typeof value !== "string" || value.length === 0) throw new Error(`Encrypted backup requires a key (set ${keyEnvName} or use --key-stdin)`);
  return Buffer.from(value, "utf8");
}

function deriveKey(secret, salt, params) {
  if (!Buffer.isBuffer(salt) || salt.length < 16 || salt.length > 64) throw new Error("Malformed encryption salt");
  if (!params || params.N !== 16_384 || params.r !== 8 || params.p !== 1 || params.key_length !== 32) throw new Error("Unsupported backup KDF parameters");
  return crypto.scryptSync(secret, salt, 32, { N: params.N, r: params.r, p: params.p, maxmem: 64 * 1024 * 1024 });
}

function decryptPayload(payload, key, associatedData) {
  if (payload.length < 5 + 12 + 16 || payload.subarray(0, 5).toString("ascii") !== "VSBK1") throw new Error("Encrypted backup payload has an invalid format");
  const iv = payload.subarray(5, 17);
  const tag = payload.subarray(17, 33);
  const ciphertext = payload.subarray(33);
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from(associatedData, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new Error("Encrypted backup authentication failed");
  }
}

function canonicalManifest(manifest) {
  const copy = JSON.parse(JSON.stringify(manifest));
  if (copy.encryption) delete copy.encryption.manifest_hmac;
  return JSON.stringify(copy);
}

function verifyManifestAuthentication(manifest, key) {
  const expected = manifest.encryption?.manifest_hmac;
  if (typeof expected !== "string" || !/^[0-9a-f]{64}$/i.test(expected)) throw new Error("Encrypted backup manifest authentication is missing or malformed");
  const actual = crypto.createHmac("sha256", key).update(canonicalManifest(manifest)).digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(actual, "hex");
  if (expectedBuffer.length !== actualBuffer.length || !crypto.timingSafeEqual(expectedBuffer, actualBuffer)) throw new Error("Encrypted backup manifest authentication failed");
}

function validateRetention(retention) {
  if (retention === undefined) return;
  if (!retention || retention.policy_version !== "v1") throw new Error("Malformed backup retention metadata");
  if (retention.retention_days !== null && (!Number.isInteger(retention.retention_days) || retention.retention_days < 0)) throw new Error("Malformed backup retention metadata");
  if (typeof retention.legal_hold !== "boolean" || !["ACTIVE", "ARCHIVED"].includes(retention.archive_state) || retention.automatic_deletion !== false || retention.operator_action_required !== true) throw new Error("Unsafe backup retention metadata");
  if (retention.deletion_eligible_at !== null && (typeof retention.deletion_eligible_at !== "string" || Number.isNaN(Date.parse(retention.deletion_eligible_at)))) throw new Error("Malformed backup retention metadata");
}

const manifestPath = path.join(backup, "manifest.json");
await assertNoSymlinkAncestors(backup);
const backupStat = await fs.lstat(backup).catch(() => null);
if (!backupStat || !backupStat.isDirectory() || backupStat.isSymbolicLink()) throw new Error("Backup directory is missing or unsafe");
const manifestStat = await fs.lstat(manifestPath).catch(() => null);
if (!manifestStat || !manifestStat.isFile() || manifestStat.isSymbolicLink()) throw new Error("Backup manifest is missing or unsafe");
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
if (!manifest || manifest.format !== "visionscan-data-backup-v1") throw new Error("Unsupported or malformed backup manifest");
validateRetention(manifest.retention);

let backupKey = null;
if (manifest.encryption?.enabled === true) {
  if (manifest.encryption.version !== 1 || manifest.encryption.algorithm !== "aes-256-gcm" || manifest.encryption.kdf !== "scrypt" || typeof manifest.encryption.salt !== "string") throw new Error("Unsupported backup encryption format");
  let salt;
  try { salt = Buffer.from(manifest.encryption.salt, "base64"); } catch { throw new Error("Malformed encryption salt"); }
  const secret = readSecret();
  backupKey = deriveKey(secret, salt, manifest.encryption.kdf_params);
  secret.fill(0);
  verifyManifestAuthentication(manifest, backupKey);
} else if (manifest.encryption?.enabled !== false && manifest.encryption !== undefined) {
  throw new Error("Malformed backup encryption metadata");
}

const dbName = safeFileName(manifest.database?.file_name ?? "eye-ai.db", "database file name");
const dbBackupFile = safeRelativePath(manifest.database?.backup_file ?? dbName, "database backup file");
const dbPath = await safeBackupPath(dbBackupFile, "database backup file");
const encryptedDatabaseLogicalName = `database/${dbName}`;
const rawDatabase = await fs.readFile(dbPath);
if (manifest.database?.backup_sha256 && sha256(rawDatabase) !== manifest.database.backup_sha256) throw new Error("Backup database encrypted hash does not match manifest");
const databaseBytes = backupKey ? decryptPayload(rawDatabase, backupKey, encryptedDatabaseLogicalName) : rawDatabase;
if (manifest.database?.sha256 && sha256(databaseBytes) !== manifest.database.sha256) throw new Error("Backup database hash does not match manifest");
const header = databaseBytes.subarray(0, 16).toString("ascii");
let integrity = null;
if (header === sqliteHeader) {
  const inspectionDir = await fs.mkdtemp(path.join(os.tmpdir(), "visionscan-restore-inspect-"));
  const inspection = path.join(inspectionDir, "database.db");
  try {
    await fs.writeFile(inspection, databaseBytes, { flag: "wx" });
    const db = new Database(inspection, { readonly: true, fileMustExist: true });
    try { integrity = db.pragma("integrity_check", { simple: true }); } finally { db.close(); }
  } finally { await fs.rm(inspectionDir, { recursive: true, force: true }).catch(() => undefined); }
  if (integrity !== "ok") throw new Error(`Backup SQLite integrity_check failed: ${integrity}`);
}

const assetManifestFile = safeRelativePath(manifest.assets?.manifest_file ?? "asset-manifest.json", "asset manifest file");
const assetManifestPath = await safeBackupPath(assetManifestFile, "asset manifest file");
const rawAssetManifest = await fs.readFile(assetManifestPath);
if (manifest.assets?.manifest_backup_sha256 && sha256(rawAssetManifest) !== manifest.assets.manifest_backup_sha256) throw new Error("Asset manifest encrypted hash does not match manifest");
const assetManifestBytes = backupKey ? decryptPayload(rawAssetManifest, backupKey, "asset-manifest.json") : rawAssetManifest;
let assetManifest;
try { assetManifest = JSON.parse(assetManifestBytes.toString("utf8")); } catch { throw new Error("Asset manifest is not valid JSON"); }
if (!Array.isArray(assetManifest)) throw new Error("Asset manifest is not an array");
if (manifest.assets?.manifest_sha256 && sha256(JSON.stringify(assetManifest)) !== manifest.assets.manifest_sha256) throw new Error("Asset manifest hash does not match backup manifest");
if (Number.isInteger(manifest.assets?.asset_count) && assetManifest.length !== manifest.assets.asset_count) throw new Error("Asset count does not match backup manifest");

const validatedAssets = [];
const seenAssetPaths = new Set();
const seenBackupPaths = new Set([dbBackupFile, assetManifestFile]);
for (const entry of assetManifest) {
  if (!entry || typeof entry.root !== "string" || !assetRoots.includes(entry.root)) throw new Error("Unsafe asset root in backup manifest");
  const relative = safeRelativePath(entry.path, "asset path");
const targetKey = `${entry.root}/${relative}`;
  if (seenAssetPaths.has(targetKey)) throw new Error(`Duplicate asset path in backup manifest: ${targetKey}`);
  seenAssetPaths.add(targetKey);
  const expectedBackup = backupKey ? `assets/${entry.root}/${relative}.enc` : `assets/${entry.root}/${relative}`;
  const backupFile = safeRelativePath(entry.backup_file ?? expectedBackup, "asset backup file");
  if (backupKey && backupFile !== expectedBackup) throw new Error(`Encrypted asset backup path mismatch: ${targetKey}`);
  if (!backupKey && backupFile !== expectedBackup) throw new Error(`Asset backup path mismatch: ${targetKey}`);
  if (seenBackupPaths.has(backupFile)) throw new Error(`Duplicate backup path in manifest: ${backupFile}`);
  seenBackupPaths.add(backupFile);
  const source = await safeBackupPath(backupFile, "asset backup file");
  const raw = await fs.readFile(source);
  if (entry.backup_sha256 && sha256(raw) !== entry.backup_sha256) throw new Error(`Asset encrypted hash mismatch: ${targetKey}`);
  const bytes = backupKey ? decryptPayload(raw, backupKey, `assets/${entry.root}/${relative}`) : raw;
  if (Number.isInteger(entry.size) && bytes.length !== entry.size) throw new Error(`Asset size mismatch: ${targetKey}`);
  if (entry.sha256 && sha256(bytes) !== entry.sha256) throw new Error(`Asset hash mismatch: ${targetKey}`);
  validatedAssets.push({ entry, relative, bytes });
}

const plan = {
  backup,
  backup_database: dbPath,
  target,
  activate,
  integrity_check: integrity,
  asset_count: assetManifest.length,
  encrypted: Boolean(backupKey),
  retention: manifest.retention ?? null,
  dry_run: dryRun,
  credentials_included: false,
};
if (dryRun) {
  backupKey?.fill(0);
  console.log(JSON.stringify({ ...plan, plan_only: true }, null, 2));
  console.error("Dry run only; no restore directory or target was changed.");
  process.exit(0);
}
if (activate && !target) throw new Error("--activate requires --target <database path>");

if (!activate) {
  const restoreRoot = path.join(repo, "data", "restores");
  await assertNoSymlinkAncestors(restoreRoot);
  await fs.mkdir(restoreRoot, { recursive: true });
  const output = path.join(restoreRoot, `restore-${Date.now()}-${process.pid}`);
  const staging = `${output}.tmp-${crypto.randomBytes(4).toString("hex")}`;
  if (fsSync.existsSync(output) || fsSync.existsSync(staging)) throw new Error("Restore output already exists; refusing overwrite");
  await fs.mkdir(staging, { recursive: true });
  try {
    await fs.writeFile(path.join(staging, dbName), databaseBytes, { flag: "wx" });
    for (const sidecar of manifest.database?.sidecars ?? []) {
      const sidecarName = safeFileName(sidecar.file_name, "database sidecar name");
      const sidecarBackup = safeRelativePath(sidecar.backup_file ?? sidecarName, "database sidecar backup file");
      const expectedSidecarBackup = backupKey ? `${sidecarName}.enc` : sidecarName;
      if (sidecarBackup !== expectedSidecarBackup) throw new Error(`Database sidecar backup path mismatch: ${sidecarName}`);
      const source = await safeBackupPath(sidecarBackup, "database sidecar backup file");
      const raw = await fs.readFile(source);
      if (sidecar.backup_sha256 && sha256(raw) !== sidecar.backup_sha256) throw new Error(`Database sidecar encrypted hash mismatch: ${sidecarName}`);
      const bytes = backupKey ? decryptPayload(raw, backupKey, `database/${sidecarName}`) : raw;
      if (sidecar.sha256 && sha256(bytes) !== sidecar.sha256) throw new Error(`Database sidecar hash mismatch: ${sidecarName}`);
      await fs.writeFile(path.join(staging, sidecarName), bytes, { flag: "wx" });
    }
    await fs.writeFile(path.join(staging, "asset-manifest.json"), assetManifestBytes, { flag: "wx" });
    for (const { entry, relative, bytes } of validatedAssets) {
      const destination = path.resolve(staging, "assets", entry.root, relative.replaceAll("/", path.sep));
      if (!pathIsWithin(path.join(staging, "assets", entry.root), destination)) throw new Error("Unsafe restore asset path");
      await assertNoSymlinkAncestors(path.dirname(destination));
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, bytes, { flag: "wx" });
    }
    const legacyName = safeFileName(manifest.legacy_database?.file_name ?? "eye-ai.json", "legacy database file name");
    const legacyBackup = safeRelativePath(manifest.legacy_database?.backup_file ?? legacyName, "legacy database backup file");
    if (legacyBackup !== dbBackupFile) {
      if (backupKey && legacyBackup !== `${legacyName}.enc`) throw new Error("Legacy database backup path mismatch");
      const legacyCandidate = path.resolve(backup, legacyBackup.replaceAll("/", path.sep));
      if (!pathIsWithin(backup, legacyCandidate)) throw new Error("Unsafe legacy database backup file");
      const legacyRequired = Boolean(manifest.legacy_database?.sha256 || manifest.legacy_database?.backup_sha256);
      if (legacyRequired || fsSync.existsSync(legacyCandidate)) {
        const source = await safeBackupPath(legacyBackup, "legacy database backup file");
        const raw = await fs.readFile(source);
        if (manifest.legacy_database?.backup_sha256 && sha256(raw) !== manifest.legacy_database.backup_sha256) throw new Error("Legacy database encrypted hash mismatch");
        const bytes = backupKey ? decryptPayload(raw, backupKey, `legacy/${legacyName}`) : raw;
        if (manifest.legacy_database?.sha256 && sha256(bytes) !== manifest.legacy_database.sha256) throw new Error("Legacy database hash mismatch");
        await fs.writeFile(path.join(staging, legacyName), bytes, { flag: "wx" });
      }
    }
    await fs.copyFile(manifestPath, path.join(staging, "manifest.json"));
    await fs.rename(staging, output);
    backupKey?.fill(0);
    console.log(JSON.stringify({ ...plan, status: "restored_to_new_directory", output }, null, 2));
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
    backupKey?.fill(0);
    throw error;
  }
  process.exit(0);
}

await assertNoSymlinkAncestors(path.dirname(target));
if (fsSync.existsSync(target) && (await fs.lstat(target)).isSymbolicLink()) throw new Error("Restore target symlink/reparse path rejected");
await fs.mkdir(path.dirname(target), { recursive: true });
const currentBackup = path.join(repo, "data", "backups", `restore-pre-activation-${Date.now()}-${process.pid}`);
await assertNoSymlinkAncestors(path.dirname(currentBackup));
await fs.mkdir(currentBackup, { recursive: true });
if (fsSync.existsSync(target)) await fs.copyFile(target, path.join(currentBackup, path.basename(target)));
const targetSidecars = [];
for (const suffix of ["-wal", "-shm"]) {
  if (fsSync.existsSync(`${target}${suffix}`)) {
    const backupSidecar = path.join(currentBackup, `${path.basename(target)}${suffix}`);
    await fs.copyFile(`${target}${suffix}`, backupSidecar);
    targetSidecars.push({ source: `${target}${suffix}`, live: `${path.join(currentBackup, path.basename(target))}${suffix}`, backup: backupSidecar, moved: false });
  }
}
const temp = `${target}.restore-${process.pid}-${crypto.randomBytes(4).toString("hex")}.tmp`;
const liveTarget = path.join(currentBackup, `${path.basename(target)}.live`);
let movedTarget = false;
try {
  await fs.writeFile(temp, databaseBytes, { flag: "wx" });
  const restoredHash = sha256(await fs.readFile(temp));
  if (manifest.database?.sha256 && restoredHash !== manifest.database.sha256) throw new Error("Temporary restore hash changed before activation");
  if (header === sqliteHeader) {
    const db = new Database(temp, { readonly: true, fileMustExist: true });
    try { if (db.pragma("integrity_check", { simple: true }) !== "ok") throw new Error("Temporary restore SQLite integrity_check failed"); } finally { db.close(); }
  }
  if (fsSync.existsSync(target)) {
    await fs.rename(target, liveTarget);
    movedTarget = true;
    for (const sidecar of targetSidecars) {
      await fs.rename(sidecar.source, sidecar.live);
      sidecar.moved = true;
    }
  }
  await fs.rename(temp, target);
  backupKey?.fill(0);
  console.log(JSON.stringify({ ...plan, status: "activated", target, pre_activation_backup: currentBackup }, null, 2));
} catch (error) {
  await fs.rm(temp, { force: true }).catch(() => undefined);
  for (const sidecar of [...targetSidecars].reverse()) {
    if (sidecar.moved && !fsSync.existsSync(sidecar.source) && fsSync.existsSync(sidecar.live)) await fs.rename(sidecar.live, sidecar.source).catch(() => undefined);
  }
  if (movedTarget && !fsSync.existsSync(target) && fsSync.existsSync(liveTarget)) await fs.rename(liveTarget, target).catch(() => undefined);
  backupKey?.fill(0);
  throw error;
}
