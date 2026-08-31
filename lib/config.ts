import path from "path";
import fs from "fs";

/**
 * Central configuration. All storage lives on D: by default and is
 * overridable via environment variables (see .env.example).
 * Never hard-code Unix-only paths; always build with path.join().
 */

function envPath(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim().length > 0 ? v.trim() : fallback;
}

const DEFAULT_PROJECT_ROOT = "D:\\AI EYE ANALYSIS PLATFORM";
const DEFAULT_DATA_ROOT = path.join(DEFAULT_PROJECT_ROOT, "data");

export const PROJECT_ROOT = envPath("PROJECT_ROOT", DEFAULT_PROJECT_ROOT);
export const DATA_ROOT = envPath("DATA_ROOT", DEFAULT_DATA_ROOT);

export const UPLOAD_ROOT = envPath("UPLOAD_ROOT", path.join(DATA_ROOT, "uploads"));
export const PROCESSED_ROOT = envPath("PROCESSED_ROOT", path.join(DATA_ROOT, "processed"));
export const REPORT_ROOT = envPath("REPORT_ROOT", path.join(DATA_ROOT, "reports"));
export const DATABASE_ROOT = envPath("DATABASE_ROOT", path.join(DATA_ROOT, "database"));
export const MODEL_ROOT = envPath("MODEL_ROOT", path.join(DATA_ROOT, "models"));
export const LOG_ROOT = envPath("LOG_ROOT", path.join(DATA_ROOT, "logs"));
export const TMP_ROOT = envPath("TMP_ROOT", path.join(DATA_ROOT, "tmp"));
export const DATABASE_FILE = envPath("DATABASE_FILE", path.join(DATABASE_ROOT, "eye-ai.json"));

export const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 26214400); // 25 MB
export const DEMO_MODE = String(process.env.DEMO_MODE ?? "true") !== "false";

export const VALIDATION_STATUS_BANNER =
  process.env.VALIDATION_STATUS ||
  "NOT VALIDATED - NOT A MEDICAL DEVICE - NOT FOR CLINICAL USE";

export const DEMO_LABEL = "DEMO / SYNTHETIC RESULT - NOT FOR CLINICAL USE";

export const ALL_DIRS = [
  PROJECT_ROOT,
  DATA_ROOT,
  UPLOAD_ROOT,
  PROCESSED_ROOT,
  REPORT_ROOT,
  DATABASE_ROOT,
  MODEL_ROOT,
  LOG_ROOT,
  TMP_ROOT,
];

/** Ensure every configured storage directory exists (called lazily). */
export function ensureDirs(): void {
  for (const dir of [UPLOAD_ROOT, PROCESSED_ROOT, REPORT_ROOT, DATABASE_ROOT, MODEL_ROOT, LOG_ROOT, TMP_ROOT]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function tmpPath(name: string): string {
  return path.join(TMP_ROOT, name);
}

/** Paths must never escape the configured roots. */
export function safeJoin(root: string, ...segments: string[]): string {
  const resolved = path.resolve(path.join(root, ...segments));
  const normalizedRoot = path.resolve(root);
  if (!resolved.startsWith(normalizedRoot + path.sep) && resolved !== normalizedRoot) {
    throw new Error("Path traversal rejected");
  }
  return resolved;
}
