import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function readJson(relativePath) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
  } catch {
    return null;
  }
}

function packageNameFromLockKey(key) {
  const marker = "node_modules/";
  const index = key.lastIndexOf(marker);
  return index >= 0 ? key.slice(index + marker.length) : key;
}

function npmComponents() {
  const lock = readJson("package-lock.json");
  const manifest = readJson("package.json");
  if (!lock || !manifest) return { components: [], lockSha256: null };
  const rootDependencies = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
  ]);
  const productionDependencies = new Set(Object.keys(manifest.dependencies ?? {}));
  const components = [];
  for (const [key, record] of Object.entries(lock.packages ?? {})) {
    if (!key.startsWith("node_modules/") || !record || typeof record.version !== "string") continue;
    const name = packageNameFromLockKey(key);
    const encodedName = name.startsWith("@") ? "%40" + name.slice(1) : name;
    const purl = "pkg:npm/" + encodedName + "@" + record.version;
    components.push({
      type: "library",
      name,
      version: record.version,
      scope: rootDependencies.has(name) && !productionDependencies.has(name) ? "optional" : "required",
      purl,
      "bom-ref": "npm:" + sha256(purl).slice(0, 24),
      properties: [{ name: "visionscan:package-manager", value: "npm" }],
    });
  }
  components.sort((a, b) => a.purl.localeCompare(b.purl));
  return {
    components,
    lockSha256: sha256(fs.readFileSync(path.join(ROOT, "package-lock.json"))),
  };
}

function pythonComponents() {
  const candidates = process.platform === "win32"
    ? [path.join(ROOT, ".venv-ophthalmic", "Scripts", "python.exe"), "python"]
    : [path.join(ROOT, ".venv-ophthalmic", "bin", "python3"), "python3", "python"];
  for (const executable of candidates) {
    const probe = spawnSync(executable, ["-m", "pip", "freeze", "--disable-pip-version-check"], {
      cwd: ROOT, encoding: "utf8", timeout: 10000, windowsHide: true,
    });
    if (probe.status !== 0 || !probe.stdout) continue;
    const components = probe.stdout.split(/\r?\n/).flatMap((line) => {
      const match = line.trim().match(/^([A-Za-z0-9_.-]+)==(.+)$/);
      if (!match) return [];
      const name = match[1];
      const version = match[2];
      const purl = "pkg:pypi/" + name.toLowerCase() + "@" + version;
      return [{
        type: "library", name, version, scope: "required", purl,
        "bom-ref": "pypi:" + sha256(purl).slice(0, 24),
        properties: [{ name: "visionscan:package-manager", value: "pip" }],
      }];
    });
    components.sort((a, b) => a.purl.localeCompare(b.purl));
    return { components, detected: true };
  }
  return { components: [], detected: false };
}

function modelComponents() {
  const root = path.join(ROOT, "data", "models");
  if (!fs.existsSync(root)) return [];
  const components = [];
  for (const modelId of fs.readdirSync(root).sort()) {
    const manifest = readJson(path.relative(ROOT, path.join(root, modelId, "manifest.json")));
    if (!manifest || typeof manifest !== "object") continue;
    const version = typeof manifest.version === "string" ? manifest.version : "unknown";
    const component = {
      type: "machine-learning-model",
      name: typeof manifest.model_id === "string" ? manifest.model_id : modelId,
      version,
      "bom-ref": "model:" + modelId + ":" + version,
      properties: [
        { name: "visionscan:task", value: typeof manifest.task === "string" ? manifest.task : "research" },
        { name: "visionscan:validation-status", value: "RESEARCH" },
      ],
    };
    const hash = typeof manifest.artifact_sha256 === "string"
      ? manifest.artifact_sha256
      : typeof manifest.sha256 === "string" ? manifest.sha256
        : typeof manifest.artifact?.sha256 === "string" ? manifest.artifact.sha256 : null;
    if (hash) component.hashes = [{ alg: "SHA-256", content: hash }];
    components.push(component);
  }
  return components;
}

function parseOutputArg() {
  const index = process.argv.indexOf("--output");
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
}

const npm = npmComponents();
const python = pythonComponents();
const components = [...npm.components, ...python.components, ...modelComponents()];
const componentFingerprint = sha256(JSON.stringify(components));
const serial = componentFingerprint.slice(0, 8) + "-" + componentFingerprint.slice(8, 12) + "-" +
  componentFingerprint.slice(12, 16) + "-" + componentFingerprint.slice(16, 20) + "-" + componentFingerprint.slice(20, 32);
const bom = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  serialNumber: "urn:uuid:" + serial,
  version: 1,
  metadata: {
    component: { type: "application", name: "eye-ai-platform", version: readJson("package.json")?.version ?? "unknown" },
    properties: [
      { name: "visionscan:source", value: "package-lock.json + local research manifests" },
      { name: "visionscan:package-lock-sha256", value: npm.lockSha256 ?? "unavailable" },
      { name: "visionscan:python-environment-detected", value: String(python.detected) },
      { name: "visionscan:patient-data-included", value: "false" },
      { name: "visionscan:phi-included", value: "false" },
      { name: "visionscan:persistence", value: "sqlite (better-sqlite3); legacy JSON import tooling only" },
    ],
  },
  components,
};

const outputIndex = process.argv.indexOf("--output");
const output = outputIndex >= 0 && process.argv[outputIndex + 1] ? process.argv[outputIndex + 1] : null;
const serialized = JSON.stringify(bom, null, 2) + "\n";
if (output) {
  const target = path.resolve(ROOT, output);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, serialized, "utf8");
  process.stdout.write(target + "\n");
} else {
  process.stdout.write(serialized);
}
