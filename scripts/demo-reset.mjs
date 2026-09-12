#!/usr/bin/env node
/**
 * Reset the isolated synthetic demo store.
 *
 * This command intentionally targets only <checkout>/data/demo. It refuses a
 * caller-supplied DATA_ROOT and never touches the live <checkout>/data store,
 * model weights, or any existing user study. Stop a server configured to use
 * data/demo before running it.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const DATA_ROOT = path.resolve(ROOT, "data", "demo");
const LIVE_DATA_ROOT = path.resolve(ROOT, "data");

if (DATA_ROOT === LIVE_DATA_ROOT || !DATA_ROOT.startsWith(`${LIVE_DATA_ROOT}${path.sep}`)) {
  throw new Error("Demo reset target safety check failed.");
}
if (process.env.DATA_ROOT && path.resolve(process.env.DATA_ROOT) !== DATA_ROOT) {
  throw new Error(`Refusing demo reset while DATA_ROOT points elsewhere: ${process.env.DATA_ROOT}`);
}

fs.rmSync(DATA_ROOT, { recursive: true, force: true });
for (const name of ["uploads", "documents", "processed", "reports", "database", "models", "logs", "tmp"]) {
  fs.mkdirSync(path.join(DATA_ROOT, name), { recursive: true });
}

// Initialize an empty SQLite store using the same isolated root. The dynamic
// import is intentional: config.ts must see the demo environment before it is
// evaluated, otherwise this command could initialize the live store.
const env = process.env;
env.PROJECT_ROOT = ROOT;
env.DATA_ROOT = DATA_ROOT;
env.UPLOAD_ROOT = path.join(DATA_ROOT, "uploads");
env.DOCUMENTS_ROOT = path.join(DATA_ROOT, "documents");
env.PROCESSED_ROOT = path.join(DATA_ROOT, "processed");
env.REPORT_ROOT = path.join(DATA_ROOT, "reports");
env.DATABASE_ROOT = path.join(DATA_ROOT, "database");
env.DATABASE_FILE = path.join(DATA_ROOT, "database", "eye-ai.db");
env.LEGACY_DATABASE_FILE = path.join(DATA_ROOT, "database", "eye-ai.json");
env.MODEL_ROOT = path.join(DATA_ROOT, "models");
env.LOG_ROOT = path.join(DATA_ROOT, "logs");
env.TMP_ROOT = path.join(DATA_ROOT, "tmp");
env.VISIONSCAN_PERSISTENCE_BACKEND = "sqlite";
env.DEMO_MODE = "true";
const initialized = spawnSync(process.execPath, [path.join(ROOT, "node_modules", "vite-node", "vite-node.mjs"), "scripts/init-db.ts"], {
  cwd: ROOT,
  stdio: "inherit",
  windowsHide: true,
  env,
});
if (initialized.status !== 0) throw new Error(`Could not initialize the isolated demo database (exit ${initialized.status ?? 1}).`);

const manifest = {
  format: "visionscan-synthetic-demo-v1",
  created_at: new Date().toISOString(),
  data_root: "data/demo",
  phi_included: false,
  patient_data_included: false,
  model_weights_included: false,
  use: "synthetic pipeline exercises only",
  disclaimer: "NOT VALIDATED - NOT A MEDICAL DEVICE - NOT FOR CLINICAL USE",
};
fs.writeFileSync(path.join(DATA_ROOT, "demo-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(JSON.stringify({ status: "reset", data_root: DATA_ROOT, manifest: "demo-manifest.json", phi_included: false }, null, 2));
