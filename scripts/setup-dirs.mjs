// Creates the D: data directory structure required by the platform.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = process.env.DATA_ROOT || path.join(root, "data");

const dirs = [
  dataDir,
  path.join(dataDir, "uploads"),
  path.join(dataDir, "processed"),
  path.join(dataDir, "reports"),
  path.join(dataDir, "database"),
  path.join(dataDir, "models"),
  path.join(dataDir, "logs"),
  path.join(dataDir, "tmp"),
];

for (const d of dirs) {
  fs.mkdirSync(d, { recursive: true });
  console.log(`[ok] ${d}`);
}
console.log("Data directories ready on D:");
