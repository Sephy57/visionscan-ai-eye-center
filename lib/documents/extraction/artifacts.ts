import fs from "fs/promises";
import path from "path";
import { DOCUMENTS_ROOT, ensureDirs, safeJoin } from "../../config";
import { EXTRACTION_SUBDIR } from "../constants";
import { ExtractionArtifact } from "./types";

/**
 * Extraction-artifact storage (S2). Artifacts contain potentially
 * PHI-bearing text and are therefore:
 *  - stored SEPARATELY from the immutable originals (data\documents\extracted\)
 *  - never written to logs or audit events
 *  - served only to roles authorized for document content
 * Paths are derived from the server-generated documentId only.
 */

function artifactPath(documentId: string): string {
  if (!/^[A-Za-z0-9_.-]+$/.test(documentId)) {
    throw new Error("Path traversal rejected");
  }
  return safeJoin(DOCUMENTS_ROOT, EXTRACTION_SUBDIR, `${documentId}.json`);
}

export async function writeExtractionArtifact(artifact: ExtractionArtifact): Promise<string> {
  ensureDirs();
  const target = artifactPath(artifact.document_id);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  try {
    const handle = await fs.open(tmp, "w");
    try {
      await handle.writeFile(JSON.stringify(artifact, null, 2), "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await fs.rename(tmp, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "EEXIST" && (error as NodeJS.ErrnoException)?.code !== "EPERM") throw error;
      await fs.rm(target, { force: true });
      await fs.rename(tmp, target);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "EEXIST") throw error;
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
  }
  return target;
}

export async function readExtractionArtifact(documentId: string): Promise<ExtractionArtifact | null> {
  try {
    const raw = await fs.readFile(artifactPath(documentId), "utf8");
    return JSON.parse(raw) as ExtractionArtifact;
  } catch {
    return null;
  }
}

export async function deleteExtractionArtifact(documentId: string): Promise<void> {
  try {
    await fs.rm(artifactPath(documentId), { force: true });
  } catch {
    /* nothing to remove */
  }
}
