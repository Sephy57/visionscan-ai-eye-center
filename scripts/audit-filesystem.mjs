// Filesystem audit: verifies source code, data, logs, and .git are on D:,
// and reports any unavoidable C: dependencies honestly.
import fs from "fs";
import os from "os";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = process.env.DATA_ROOT || path.join(root, "data");

function check(label, p) {
  const exists = fs.existsSync(p);
  const onD = p.toUpperCase().startsWith("D:");
  const status = exists ? (onD ? "OK (on D:)" : "WARNING (not on D:)") : "MISSING";
  console.log(`${exists ? "[ok ]" : "[MISS]"} ${label.padEnd(34)} ${p}  -> ${status}`);
  return exists && onD;
}

console.log(`\n=== Filesystem audit: ${new Date().toISOString()} ===`);
console.log(`Project root: ${root}\n`);

let allOk = true;
allOk &= check("Source code (app/)", path.join(root, "app"));
allOk &= check("Source code (lib/)", path.join(root, "lib"));
allOk &= check("Source code (components)", path.join(root, "components"));
allOk &= check("Git repository (.git)", path.join(root, ".git"));
allOk &= check("Uploaded scans", path.join(dataDir, "uploads"));
allOk &= check("Processed analyses", path.join(dataDir, "processed"));
allOk &= check("Generated reports", path.join(dataDir, "reports"));
allOk &= check("Database", path.join(dataDir, "database"));
allOk &= check("Model storage", path.join(dataDir, "models"));
allOk &= check("Logs", path.join(dataDir, "logs"));
allOk &= check("Temp files", path.join(dataDir, "tmp"));

// Contents check (do the stores actually hold data on D:)
const countFiles = (p) => {
  try {
    return fs.readdirSync(p).length;
  } catch {
    return -1;
  }
};
console.log("\nDirectory contents:");
for (const sub of ["uploads", "processed", "reports", "database", "logs", "tmp"]) {
  const p = path.join(dataDir, sub);
  console.log(`  ${sub.padEnd(12)} ${countFiles(p)} entries`);
}

// Disk space
try {
  const out = execSync("Get-PSDrive D | Select-Object -ExpandProperty Free", { shell: "powershell.exe" }).toString().trim();
  console.log(`\nD: free space: ${(Number(out) / 1e9).toFixed(1)} GB`);
} catch {
  console.log("\nD: free space: (could not query)");
}

// Honest listing of known C: dependencies
console.log("\nKnown C: dependencies (unavoidable, system-level):");
console.log("  - Node.js runtime:       " + execSync("where node").toString().split("\n")[0].trim());
console.log("  - npm:                   " + execSync("where npm").toString().split("\n")[0].trim());
console.log("  - npm cache (default):   " + path.join(os.homedir(), "AppData", "Local", "npm-cache"));
console.log("    -> redirect with: npm config set cache \"D:\\npm-cache\"");
console.log("  - Windows TEMP for npm install scripts: " + os.tmpdir());
console.log("  - Application temp files themselves are on D: (data\\tmp)");

console.log(`\n${allOk ? "AUDIT PASSED: project and data live on D:" : "AUDIT: some items missing - see above"}\n`);
