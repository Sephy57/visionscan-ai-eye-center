import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";

const ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));

function sha256File(relativePath) {
  try { return crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, relativePath))).digest("hex"); } catch { return null; }
}
function read(relativePath) {
  try { return fs.readFileSync(path.join(ROOT, relativePath), "utf8"); } catch { return ""; }
}
function json(relativePath) {
  try { return JSON.parse(read(relativePath)); } catch { return null; }
}
function git(args) {
  const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf8", windowsHide: true });
  return result.status === 0 ? result.stdout.trim() : null;
}
function pythonVersion() {
  const candidates = process.platform === "win32"
    ? [path.join(ROOT, ".venv-ophthalmic", "Scripts", "python.exe"), "python"]
    : [path.join(ROOT, ".venv-ophthalmic", "bin", "python3"), "python3", "python"];
  for (const executable of candidates) {
    const result = spawnSync(executable, ["--version"], { cwd: ROOT, encoding: "utf8", timeout: 5000, windowsHide: true });
    if (result.status === 0) return (result.stdout || result.stderr || "").trim();
  }
  return null;
}
function modelInventory() {
  const root = path.join(ROOT, "data", "models");
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).sort().flatMap((modelId) => {
    const manifest = json(path.relative(ROOT, path.join(root, modelId, "manifest.json")));
    if (!manifest || typeof manifest !== "object") return [];
    return [{
      model_id: typeof manifest.model_id === "string" ? manifest.model_id : modelId,
      version: typeof manifest.version === "string" ? manifest.version : "unknown",
      artifact_sha256: typeof manifest.artifact_sha256 === "string"
        ? manifest.artifact_sha256
        : typeof manifest.sha256 === "string"
          ? manifest.sha256
          : typeof manifest.artifact?.sha256 === "string" ? manifest.artifact.sha256 : null,
      validation_status: "RESEARCH",
    }];
  });
}

function backupInventory() {
  const root = path.join(ROOT, "data", "backups");
  let candidates = [];
  try {
    candidates = fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("backup-"))
      .map((entry) => entry.name)
      .sort()
      .reverse();
  } catch { return { status: "NO_VERIFIED_BACKUP", latest: null }; }
  for (const name of candidates) {
    const relativePath = path.posix.join("data", "backups", name);
    const manifest = json(path.join(relativePath, "manifest.json"));
    if (!manifest || manifest.format !== "visionscan-data-backup-v1") continue;
    const verified = manifest.database?.integrity_check === "ok" &&
      typeof manifest.database?.backup_sha256 === "string" &&
      typeof manifest.assets?.manifest_backup_sha256 === "string" &&
      manifest.credentials_included === false;
    return {
      status: verified ? "VERIFIED_BACKUP_AVAILABLE" : "UNVERIFIED_BACKUP",
      latest: {
        path: relativePath,
        created_at: manifest.created_at ?? null,
        encrypted: manifest.encryption?.enabled === true,
        integrity_check: manifest.database?.integrity_check ?? null,
        schema_version: manifest.database?.schema_version ?? null,
        migration_version: manifest.database?.migration_version ?? null,
        asset_count: Number.isInteger(manifest.assets?.asset_count) ? manifest.assets.asset_count : null,
        credentials_included: manifest.credentials_included === true,
      },
    };
  }
  return { status: "NO_VERIFIED_BACKUP", latest: null };
}

function reconciliationInventory() {
  const relativePath = "docs/generated/reconciliation-adjudication.json";
  const report = json(relativePath);
  if (!report || report.format !== "visionscan-reconciliation-adjudication-v1") {
    return { status: "NOT_GENERATED", path: relativePath, total_findings: null, counts: null, quarantine_applied: false };
  }
  const counts = report.counts && typeof report.counts === "object" ? report.counts : {};
  const unresolved = Number(counts.MISSING_REQUIRED_ARTIFACT ?? 0) + Number(counts.MANUAL_REVIEW_REQUIRED ?? 0);
  return {
    status: unresolved === 0 ? "ADJUDICATED_NO_UNRESOLVED" : "ADJUDICATED_BLOCKERS_REMAIN",
    path: relativePath,
    total_findings: Number.isInteger(report.total_findings) ? report.total_findings : null,
    counts,
    quarantine_applied: report.quarantine_applied === true,
    unresolved_blocking_findings: unresolved,
  };
}

function ciRunIds() {
  const raw = process.env.VISIONSCAN_CI_RUN_IDS ?? "";
  return raw.split(",").map((value) => value.trim()).filter(Boolean).slice(0, 20);
}
function versionFrom(source, name) {
  const match = source.match(new RegExp(name + "\\s*=\\s*\"([^\"]+)\""));
  return match?.[1] ?? null;
}
function parseOutputArg() {
  const index = process.argv.indexOf("--output");
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
}

function persistenceInventory() {
  const configured = process.env.DATABASE_FILE ?? path.join(ROOT, "data", "database", "eye-ai.db");
  const databaseFile = path.resolve(configured);
  const requested = String(process.env.VISIONSCAN_PERSISTENCE_BACKEND ?? "").trim().toLowerCase();
  const backend = requested === "json" || databaseFile.toLowerCase().endsWith(".json") ? "json" : "sqlite";
  let schema = null;
  let migration = null;
  try {
    const header = fs.readFileSync(databaseFile).subarray(0, 16).toString("ascii");
    if (backend === "sqlite" && header === "SQLite format 3\u0000") {
      const db = new Database(databaseFile, { readonly: true, fileMustExist: true });
      try {
        schema = db.prepare("SELECT value FROM persistence_meta WHERE key='schema_version'").get()?.value ?? null;
        migration = db.prepare("SELECT value FROM persistence_meta WHERE key='migration_version'").get()?.value ?? null;
      } finally { db.close(); }
    }
  } catch { /* inventory remains metadata-only when no local database exists */ }
  return {
    backend,
    database_schema_version: schema,
    migration_version: migration,
    database_file_extension: path.extname(databaseFile).toLowerCase() || null,
  };
}

const packageJson = json("package.json") ?? {};
const lockSha = sha256File("package-lock.json");
const sbomIndex = process.argv.indexOf("--sbom");
const sbomRelative = sbomIndex >= 0 && process.argv[sbomIndex + 1] ? process.argv[sbomIndex + 1] : "docs/generated/SBOM.cdx.json";
const inventory = {
  schema_version: "visionscan-release-inventory-v1",
  application: { name: packageJson.name ?? "eye-ai-platform", version: packageJson.version ?? "unknown" },
  source: {
    commit: git(["rev-parse", "HEAD"]),
    branch: git(["branch", "--show-current"]),
    working_tree_clean: (git(["status", "--porcelain"]) ?? "") === "",
  },
  runtime: { node: process.version, platform: process.platform, python: pythonVersion() },
  models: modelInventory(),
  rulesets: {
    pipeline_version: versionFrom(read("lib/analysis/schema.ts"), "PIPELINE_VERSION"),
    ruleset_version: versionFrom(read("lib/models/registry.ts"), "RULESET_VERSION"),
    validation_registry_version: versionFrom(read("lib/models/validationRegistry.ts"), "VALIDATION_REGISTRY_VERSION"),
  },
  dependencies: { package_lock_sha256: lockSha, sbom_path: sbomRelative, sbom_sha256: sha256File(sbomRelative) },
  backup: backupInventory(),
  reconciliation: reconciliationInventory(),
  ci_run_ids: ciRunIds(),
  persistence: persistenceInventory(),
  phi_included: false,
  generated_at: new Date().toISOString(),
};

const output = parseOutputArg();
const serialized = JSON.stringify(inventory, null, 2) + "\n";
if (output) {
  const target = path.resolve(ROOT, output);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, serialized, "utf8");
  process.stdout.write(target + "\n");
} else {
  process.stdout.write(serialized);
}
