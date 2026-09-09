import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

// Model packages are deliberately ignored by Git. This audit is therefore
// useful both on a developer workstation (where it verifies local bytes) and
// in a clean CI checkout (where it proves that no unreviewed model package is
// being silently assumed). It never reads patient uploads or emits weights.
const ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const MODELS_ROOT = path.join(ROOT, "data", "models");

const REQUIRED = ["model_id", "version", "artifact.sha256", "license", "training_dataset"];
const OPTIONAL_CANONICAL = ["runtime", "dependencies", "task", "classes", "input", "output", "validation_status"];

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    return { __parseError: error instanceof Error ? error.message : String(error) };
  }
}

function get(obj, dotted) {
  return dotted.split(".").reduce((value, key) => value && typeof value === "object" ? value[key] : undefined, obj);
}

function nonEmpty(value) {
  return typeof value === "string" ? value.trim().length > 0 : value !== null && value !== undefined;
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function canonicalPresence(manifest, field) {
  if (field === "artifact.sha256") return nonEmpty(get(manifest, field));
  if (field === "task") return nonEmpty(manifest.task) || nonEmpty(manifest.output_schema) || nonEmpty(manifest.intended_use);
  if (field === "classes") return Array.isArray(manifest.classes) || (Array.isArray(manifest.supported_findings) && manifest.supported_findings.length > 0);
  if (field === "output") return nonEmpty(manifest.output) || nonEmpty(manifest.output_schema);
  if (field === "validation_status") return nonEmpty(manifest.validation_status) || nonEmpty(manifest.regulatory_status) || nonEmpty(manifest.intended_use);
  if (field === "runtime") return nonEmpty(manifest.runtime) || nonEmpty(manifest.input?.preprocessing);
  if (field === "dependencies") return nonEmpty(manifest.dependencies) || nonEmpty(manifest.input?.preprocessing);
  return nonEmpty(get(manifest, field));
}

function auditManifest(modelDirectory, manifestFile) {
  const modelIdFromDirectory = path.basename(modelDirectory);
  const manifest = readJson(manifestFile);
  const errors = [];
  const warnings = [];
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return { model_id: modelIdFromDirectory, manifest: path.relative(ROOT, manifestFile), status: "FAIL", errors: ["manifest must be a JSON object"], warnings };
  }
  if (manifest.__parseError) {
    return { model_id: modelIdFromDirectory, manifest: path.relative(ROOT, manifestFile), status: "FAIL", errors: [`invalid JSON: ${manifest.__parseError}`], warnings };
  }
  for (const field of REQUIRED) if (!canonicalPresence(manifest, field)) errors.push(`missing required field: ${field}`);

  const modelId = typeof manifest.model_id === "string" ? manifest.model_id.trim() : modelIdFromDirectory;
  const artifact = manifest.artifact && typeof manifest.artifact === "object" ? manifest.artifact : {};
  const artifactFile = typeof artifact.file === "string" ? artifact.file : null;
  const artifactHash = typeof artifact.sha256 === "string"
    ? artifact.sha256.toLowerCase()
    : typeof manifest.artifact_sha256 === "string" ? manifest.artifact_sha256.toLowerCase()
      : typeof manifest.sha256 === "string" ? manifest.sha256.toLowerCase() : null;
  if (!/^[a-f0-9]{64}$/.test(artifactHash ?? "")) errors.push("artifact SHA-256 must be a 64-character hexadecimal digest");
  if (artifactFile && (path.isAbsolute(artifactFile) || artifactFile.includes(".."))) {
    errors.push("artifact.file must be a relative path inside the model package");
  }
  const artifactPath = artifactFile ? path.resolve(modelDirectory, artifactFile) : null;
  const modelRoot = path.resolve(modelDirectory);
  if (artifactPath && !(artifactPath === modelRoot || artifactPath.startsWith(modelRoot + path.sep))) {
    errors.push("artifact.file resolves outside the model package");
  } else if (artifactPath && !fs.existsSync(artifactPath)) {
    errors.push(`artifact file is missing: ${artifactFile}`);
  } else if (artifactPath && artifactHash && /^[a-f0-9]{64}$/.test(artifactHash)) {
    const actual = sha256File(artifactPath);
    if (actual !== artifactHash) errors.push(`artifact SHA-256 mismatch (expected ${artifactHash}, got ${actual})`);
  }
  if (manifest.model_id && manifest.model_id !== modelIdFromDirectory) warnings.push("model_id differs from its containing directory name");
  for (const field of OPTIONAL_CANONICAL) if (!canonicalPresence(manifest, field)) warnings.push(`optional provenance field absent: ${field}`);
  if (manifest.validation_status && manifest.validation_status !== "RESEARCH_ONLY") warnings.push("validation_status is not RESEARCH_ONLY; independent release review is required");
  if (manifest.regulatory_status && manifest.regulatory_status !== "research_only") warnings.push("regulatory_status is not research_only; independent release review is required");

  return {
    model_id: modelId,
    manifest: path.relative(ROOT, manifestFile).replaceAll(path.sep, "/"),
    version: typeof manifest.version === "string" ? manifest.version : null,
    artifact_sha256: artifactHash,
    validation_status: manifest.validation_status ?? manifest.regulatory_status ?? "UNDECLARED",
    status: errors.length > 0 ? "FAIL" : warnings.length > 0 ? "PASS_WITH_WARNINGS" : "PASS",
    errors,
    warnings,
  };
}

function parseOutputArg() {
  const index = process.argv.indexOf("--output");
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
}

const results = [];
if (fs.existsSync(MODELS_ROOT)) {
  for (const entry of fs.readdirSync(MODELS_ROOT, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(MODELS_ROOT, entry.name);
    const manifestFile = path.join(directory, "manifest.json");
    if (fs.existsSync(manifestFile)) results.push(auditManifest(directory, manifestFile));
  }
}

const failed = results.filter((result) => result.status === "FAIL");
const output = {
  schema_version: "visionscan-model-manifest-audit-v1",
  model_root: "data/models",
  manifests_found: results.length,
  status: failed.length > 0 ? "FAIL" : results.some((result) => result.status === "PASS_WITH_WARNINGS") ? "PASS_WITH_WARNINGS" : "PASS",
  patient_data_included: false,
  results,
};
const serialized = JSON.stringify(output, null, 2) + "\n";
const outputArg = parseOutputArg();
if (outputArg) {
  const target = path.resolve(ROOT, outputArg);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, serialized, "utf8");
  process.stdout.write(target + "\n");
} else {
  process.stdout.write(serialized);
}
if (failed.length > 0) process.exitCode = 1;
