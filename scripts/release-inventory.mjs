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
