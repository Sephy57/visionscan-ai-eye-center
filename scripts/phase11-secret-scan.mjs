import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const outputArg = process.argv.indexOf("--output");
const outputPath = outputArg >= 0 && process.argv[outputArg + 1]
  ? path.resolve(ROOT, process.argv[outputArg + 1])
  : null;

const placeholderValues = new Set([
  "operator-supplied-secret",
  "use-a-secret-from-your-secret-manager",
  "secret-from-your-secret-manager",
  "replace-me",
  "changeme",
  "example-secret",
  "test-secret",
]);

const detectors = [
  { name: "private_key_pem", regex: /-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----/g },
  { name: "provider_token_prefix", regex: /\b(?:sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,})\b/g },
  { name: "jwt_literal", regex: /\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  {
    name: "credential_assignment",
    regex: /\b(?:OPENAI_API_KEY|ANTHROPIC_API_KEY|GITHUB_TOKEN|AWS_SECRET_ACCESS_KEY|AWS_ACCESS_KEY_ID|(?:api|access|auth|client|private|secret)[_-]?(?:key|token|secret))\s*[:=]\s*["'`]([^"'`\r\n]{20,})["'`]/gi,
  },
];

function lineNumber(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

function isText(buffer) {
  return !buffer.includes(0);
}

function isPlaceholder(value) {
  const normalized = value.trim().toLowerCase();
  return placeholderValues.has(normalized) || normalized.includes("operator-supplied") || normalized.includes("secret-manager");
}

function trackedFiles() {
  const raw = execFileSync("git", ["-C", ROOT, "ls-files", "-z"], { encoding: "buffer" });
  return raw.toString("utf8").split("\0").filter(Boolean);
}

const findings = [];
let scannedFiles = 0;
for (const relative of trackedFiles()) {
  const absolute = path.join(ROOT, relative);
  const buffer = fs.readFileSync(absolute);
  if (!isText(buffer)) continue;
  scannedFiles += 1;
  const content = buffer.toString("utf8");
  for (const detector of detectors) {
    detector.regex.lastIndex = 0;
    for (const match of content.matchAll(detector.regex)) {
      const value = match[1] ?? match[0];
      if (detector.name === "credential_assignment" && isPlaceholder(value)) continue;
      findings.push({ file: relative.replaceAll(path.sep, "/"), line: lineNumber(content, match.index ?? 0), pattern: detector.name });
    }
  }
}

const result = {
  status: findings.length === 0 ? "PASS_NO_HIGH_CONFIDENCE_SECRET" : "FAIL_SECRET_PATTERNS",
  generated_at: new Date().toISOString(),
  scanned_tracked_text_files: scannedFiles,
  findings,
  policy: "Tracked text only; placeholders are excluded; no credentials are printed.",
};
const serialized = JSON.stringify(result, null, 2) + "\n";
if (outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, serialized, "utf8");
}
process.stdout.write(serialized);
process.exitCode = findings.length === 0 ? 0 : 1;
