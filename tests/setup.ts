import fs from "fs";
import path from "path";

// Tests must never touch a developer's real D: store. This module is loaded by
// Vitest before test modules (and therefore before application config imports).
const repositoryRoot = path.resolve(process.cwd());
const modelRoot = path.join(repositoryRoot, "data", "models");
const runParent = path.join(repositoryRoot, "data", "test-runs");
fs.mkdirSync(runParent, { recursive: true });
const testRoot = fs.mkdtempSync(path.join(runParent, `vitest-${process.pid}-`));

const configuredRoots: Record<string, string> = {
  DATA_ROOT: testRoot,
  UPLOAD_ROOT: path.join(testRoot, "uploads"),
  DOCUMENTS_ROOT: path.join(testRoot, "documents"),
  PROCESSED_ROOT: path.join(testRoot, "processed"),
  REPORT_ROOT: path.join(testRoot, "reports"),
  DATABASE_ROOT: path.join(testRoot, "database"),
  DATABASE_FILE: path.join(testRoot, "database", "eye-ai.db"),
  LEGACY_DATABASE_FILE: path.join(testRoot, "database", "eye-ai.json"),
  LOG_ROOT: path.join(testRoot, "logs"),
  TMP_ROOT: path.join(testRoot, "tmp"),
  MODEL_ROOT: modelRoot,
  VISIONSCAN_PERSISTENCE_BACKEND: "sqlite",
  NODE_ENV: process.env.NODE_ENV ?? "test",
};

for (const [name, value] of Object.entries(configuredRoots)) process.env[name] = value;
process.env.VISIONSCAN_TEST_ISOLATED = "1";

// Do not leave synthetic records or WAL files behind. The handler is scoped to
// the unique run root and never removes the repository's real data directory.
process.on("exit", () => {
  try {
    fs.rmSync(testRoot, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup must not mask test status.
  }
});
