#!/usr/bin/env node
/** Verify a VisionScan backup and restore it without overwriting by default. */
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";

const repo = process.cwd();
function valueAfter(flag) {
  const exact = process.argv.find((arg) => arg === flag);
  if (exact) return process.argv[process.argv.indexOf(exact) + 1];
  const prefix = process.argv.find((arg) => arg.startsWith(`${flag}=`));
  return prefix?.slice(flag.length + 1);
}
const backup = path.resolve(valueAfter("--backup") ?? "");
if (!backup || backup === path.resolve(repo)) throw new Error("--backup <directory> is required");
const activate = process.argv.includes("--activate");
const targetArg = valueAfter("--target");
const target = targetArg ? path.resolve(targetArg) : null;
const dryRun = process.argv.includes("--dry-run") || process.argv.includes("-n");
const manifestPath = path.join(backup, "manifest.json");
const assetManifestPath = path.join(backup, "asset-manifest.json");
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
if (manifest.format !== "visionscan-data-backup-v1") throw new Error("Unsupported or malformed backup manifest");
let assetManifest = [];
if (fsSync.existsSync(assetManifestPath)) {
  assetManifest = JSON.parse(await fs.readFile(assetManifestPath, "utf8"));
  const manifestHash = crypto.createHash("sha256").update(JSON.stringify(assetManifest)).digest("hex");
  if (manifest.assets?.manifest_sha256 && manifestHash !== manifest.assets.manifest_sha256) throw new Error("Asset manifest hash does not match backup manifest");
}
const dbName = path.basename(manifest.database?.file_name ?? "eye-ai.db");
const backupDb = path.join(backup, dbName);
if (!fsSync.existsSync(backupDb)) throw new Error(`Backup database is missing: ${backupDb}`);
const actualHash = crypto.createHash("sha256").update(await fs.readFile(backupDb)).digest("hex");
if (manifest.database?.sha256 && actualHash !== manifest.database.sha256) throw new Error("Backup database hash does not match manifest");
const header = (await fs.readFile(backupDb)).subarray(0, 16).toString("ascii");
let integrity = null;
if (header === "SQLite format 3\u0000") {
  const db = new Database(backupDb, { readonly: true, fileMustExist: true });
  try { integrity = db.pragma("integrity_check", { simple: true }); } finally { db.close(); }
  if (integrity !== "ok") throw new Error(`Backup SQLite integrity_check failed: ${integrity}`);
}
const plan = { backup, backup_database: backupDb, target, activate, integrity_check: integrity, asset_count: assetManifest.length, dry_run: dryRun, credentials_included: false };
if (dryRun) {
  console.log(JSON.stringify({ ...plan, plan_only: true }, null, 2));
  console.error("Dry run only; no restore directory or target was changed.");
  process.exit(0);
}
if (activate && !target) throw new Error("--activate requires --target <database path>");

if (!activate) {
  const output = path.join(repo, "data", "restores", `restore-${Date.now()}`);
  await fs.mkdir(output, { recursive: true });
  await fs.copyFile(backupDb, path.join(output, dbName));
  for (const suffix of ["-wal", "-shm"]) if (fsSync.existsSync(`${backupDb}${suffix}`)) await fs.copyFile(`${backupDb}${suffix}`, path.join(output, `${dbName}${suffix}`));
  if (fsSync.existsSync(assetManifestPath)) {
    await fs.copyFile(assetManifestPath, path.join(output, "asset-manifest.json"));
    for (const entry of assetManifest) {
      if (!entry || typeof entry.root !== "string" || typeof entry.path !== "string" || entry.path.includes("..")) throw new Error("Unsafe asset path in backup manifest");
      const sourceAsset = path.join(backup, "assets", entry.root, entry.path);
      const targetAsset = path.join(output, "assets", entry.root, entry.path);
      if (!fsSync.existsSync(sourceAsset)) throw new Error(`Backup asset is missing: ${entry.root}/${entry.path}`);
      if (entry.sha256 && crypto.createHash("sha256").update(await fs.readFile(sourceAsset)).digest("hex") !== entry.sha256) throw new Error(`Backup asset hash mismatch: ${entry.root}/${entry.path}`);
      await fs.mkdir(path.dirname(targetAsset), { recursive: true });
      await fs.copyFile(sourceAsset, targetAsset);
    }
  }
  const legacyName = path.basename(manifest.legacy_database?.file_name ?? "eye-ai.json");
  if (legacyName !== dbName && fsSync.existsSync(path.join(backup, legacyName))) await fs.copyFile(path.join(backup, legacyName), path.join(output, legacyName));
  await fs.copyFile(manifestPath, path.join(output, "manifest.json"));
  console.log(JSON.stringify({ ...plan, status: "restored_to_new_directory", output }, null, 2));
  process.exit(0);
}

await fs.mkdir(path.dirname(target), { recursive: true });
const currentBackup = path.join(repo, "data", "backups", `restore-pre-activation-${Date.now()}`);
await fs.mkdir(currentBackup, { recursive: true });
if (fsSync.existsSync(target)) await fs.copyFile(target, path.join(currentBackup, path.basename(target)));
for (const suffix of ["-wal", "-shm"]) if (fsSync.existsSync(`${target}${suffix}`)) await fs.copyFile(`${target}${suffix}`, path.join(currentBackup, `${path.basename(target)}${suffix}`));
const temp = `${target}.restore-${process.pid}-${Math.random().toString(36).slice(2, 8)}.tmp`;
const liveTarget = path.join(currentBackup, `${path.basename(target)}.live`);
let movedTarget = false;
try {
  await fs.copyFile(backupDb, temp);
  const restoredHash = crypto.createHash("sha256").update(await fs.readFile(temp)).digest("hex");
  if (restoredHash !== actualHash) throw new Error("Temporary restore hash changed before activation");
  if (fsSync.existsSync(target)) {
    await fs.rename(target, liveTarget);
    movedTarget = true;
    for (const suffix of ["-wal", "-shm"]) if (fsSync.existsSync(`${target}${suffix}`)) await fs.rename(`${target}${suffix}`, `${liveTarget}${suffix}`);
  }
  await fs.rename(temp, target);
  console.log(JSON.stringify({ ...plan, status: "activated", target, pre_activation_backup: currentBackup }, null, 2));
} catch (error) {
  await fs.rm(temp, { force: true }).catch(() => undefined);
  if (movedTarget && !fsSync.existsSync(target) && fsSync.existsSync(liveTarget)) await fs.rename(liveTarget, target).catch(() => undefined);
  throw error;
}
