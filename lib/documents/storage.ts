import fs from "fs/promises";
import path from "path";
import { DOCUMENTS_ROOT, ensureDirs } from "../config";

/**
 * Immutable original-document storage (S1). Original uploaded bytes are
 * written once (exclusive create), never modified, and always addressed via
 * a server-generated documentId - see lib/documents/security.ts.
 */

export async function saveOriginalDocument(documentId: string, bytes: Buffer): Promise<string> {
  ensureDirs();
  await fs.mkdir(DOCUMENTS_ROOT, { recursive: true });
  const { documentStoragePath } = await import("./security");
  const target = documentStoragePath(documentId); // fail-closed path derivation
  // "wx" = fail if the file already exists: originals are write-once.
  await fs.writeFile(target, bytes, { flag: "wx" });
  return path.relative(DOCUMENTS_ROOT, target);
}

export async function readOriginalDocument(documentId: string): Promise<Buffer | null> {
  try {
    const { documentStoragePath } = await import("./security");
    return await fs.readFile(documentStoragePath(documentId));
  } catch {
    return null;
  }
}

export async function deleteOriginalDocument(documentId: string): Promise<boolean> {
  try {
    const { documentStoragePath } = await import("./security");
    await fs.rm(documentStoragePath(documentId), { force: false });
    return true;
  } catch {
    return false;
  }
}

export async function documentExistsOnDisk(documentId: string): Promise<boolean> {
  try {
    const { documentStoragePath } = await import("./security");
    await fs.access(documentStoragePath(documentId));
    return true;
  } catch {
    return false;
  }
}
