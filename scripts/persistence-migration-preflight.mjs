#!/usr/bin/env node
/**
 * Non-destructive persistence migration preflight.
 *
 * It validates the current JSON store and emits a manifest suitable for a
 * separately reviewed SQLite/PostgreSQL importer. It never deletes, mutates,
 * or renames the source database. Use --write-manifest to create a manifest
 * under data/migrations (which is gitignored); default mode is dry-run.
 */
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const repo = process.cwd();
const source = process.env.VISIONSCAN_LEGACY_DATABASE_FILE ?? process.env.LEGACY_DATABASE_FILE ?? process.env.VISIONSCAN_DATABASE_FILE ?? path.join(repo, "data", "database", "eye-ai.json");
const write = process.argv.includes("--write-manifest");

const raw = await fs.readFile(source, "utf8");
const sha256 = crypto.createHash("sha256").update(raw).digest("hex");
const parsed = JSON.parse(raw);
if (!parsed || typeof parsed !== "object" || !parsed.collections || typeof parsed.collections !== "object") {
  throw new Error("Source is not a VisionScan JSON store (missing collections)");
}

const collections = Object.entries(parsed.collections).map(([name, value]) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Collection ${name} is not an object map`);
  return { name, records: Object.keys(value).length };
});
const manifest = {
  format: "visionscan-persistence-migration-manifest-v1",
  generated_at: new Date().toISOString(),
  source_path: path.resolve(source),
  source_sha256: sha256,
  source_version: parsed.meta?.version ?? null,
  source_last_write: parsed.meta?.lastWrite ?? null,
  source_bytes: Buffer.byteLength(raw),
  collections,
  migration_policy: {
    source_immutable: true,
    dry_run_default: true,
    importer_required: true,
    rollback: "restore verified pre-migration backup and replay audited writes",
  },
};

if (write) {
  const dir = path.join(repo, "data", "migrations");
  await fs.mkdir(dir, { recursive: true });
  const destination = path.join(dir, `preflight-${Date.now()}.json`);
  await fs.writeFile(destination, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ ...manifest, manifest_path: destination }, null, 2));
} else {
  console.log(JSON.stringify(manifest, null, 2));
  console.error("Dry run only. Re-run with --write-manifest to persist this manifest; source was not changed.");
}
