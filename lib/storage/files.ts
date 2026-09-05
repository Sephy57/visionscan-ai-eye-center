import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { createHash } from "crypto";
import { UPLOAD_ROOT, PROCESSED_ROOT, REPORT_ROOT, tmpPath, ensureDirs, safeJoin } from "../config";

/**
 * File storage layer. Original scans are preserved byte-for-byte
 * (sha256 recorded; originals are never modified by the pipeline).
 */

export interface StoredFile {
  id: string;
  relativePath: string;
  absolutePath: string;
  size: number;
  sha256: string;
  mimeType: string;
  storedAt: string;
}

export function newId(prefix: string): string {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${t}${r}`;
}

export async function saveOriginalScan(
  studyId: string,
  fileName: string,
  data: Buffer,
  mimeType: string
): Promise<StoredFile> {
  ensureDirs();
  const ext = path.extname(fileName).toLowerCase() || ".bin";
  const relativePath = path.join(studyId, `original${ext}`);
  const absolutePath = safeJoin(UPLOAD_ROOT, relativePath); // fails closed on path traversal
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  // Write original bytes unchanged. The pipeline never edits this file.
  await fs.writeFile(absolutePath, data, { flag: "wx" });
  return {
    id: newId("file"),
    relativePath,
    absolutePath,
    size: data.length,
    sha256: sha256(data),
    mimeType,
    storedAt: new Date().toISOString(),
  };
}

export async function readOriginalScan(studyId: string): Promise<Buffer | null> {
  let dir: string;
  try {
    dir = safeJoin(UPLOAD_ROOT, studyId); // fails closed on path traversal
  } catch {
    return null;
  }
  try {
    const files = await fs.readdir(dir);
    for (const f of files) {
      if (f.startsWith("original")) return await fs.readFile(path.join(dir, f));
    }
  } catch {
    return null;
  }
  return null;
}

export function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export async function writeJson(kind: "processed" | "reports", id: string, obj: unknown): Promise<string> {
  ensureDirs();
  const root = kind === "processed" ? PROCESSED_ROOT : REPORT_ROOT;
  const p = path.join(root, `${id}.json`);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(obj, null, 2), "utf8");
  return p;
}

export async function readJson<T>(kind: "processed" | "reports", id: string): Promise<T | null> {
  const p = path.join(kind === "processed" ? PROCESSED_ROOT : REPORT_ROOT, `${id}.json`);
  try {
    return JSON.parse(await fs.readFile(p, "utf8")) as T;
  } catch {
    return null;
  }
}

export async function listJson(kind: "processed" | "reports"): Promise<string[]> {
  ensureDirs();
  const dir = kind === "processed" ? PROCESSED_ROOT : REPORT_ROOT;
  try {
    const files = await fs.readdir(dir);
    return files.filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
  } catch {
    return [];
  }
}

export async function deleteStudyFiles(studyId: string): Promise<void> {
  for (const dir of [UPLOAD_ROOT, PROCESSED_ROOT, REPORT_ROOT]) {
    const target = safeJoin(dir, studyId); // fails closed on path traversal - never delete outside the study's own dir
    await fs.rm(target, { recursive: true, force: true });
    await fs.rm(safeJoin(dir, `${studyId}.json`), { force: true });
  }
}

/** Clean stale temp files older than maxAgeMs (Windows-safe, no /tmp assumption). */
export async function cleanTmp(maxAgeMs = 24 * 60 * 60 * 1000): Promise<number> {
  ensureDirs();
  let removed = 0;
  const files = await fs.readdir(tmpPath(""));
  for (const f of files) {
    const p = path.join(tmpPath(""), f);
    const st = await fs.stat(p);
    if (Date.now() - st.mtimeMs > maxAgeMs) {
      await fs.rm(p, { recursive: true, force: true });
      removed++;
    }
  }
  return removed;
}

export function existsSync(p: string): boolean {
  return fsSync.existsSync(p);
}
