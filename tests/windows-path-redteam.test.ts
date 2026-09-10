import fs from "fs/promises";
import fsSync from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { describe, expect, it } from "vitest";

const windowsOnly = process.platform === "win32" ? describe : describe.skip;

function runBackup(cwd: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const script = path.resolve(process.cwd(), "scripts", "backup-data.mjs");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, "--dry-run"], { cwd, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code, stdout, stderr }));
  });
}

windowsOnly("Windows reparse-point and path red-team controls", () => {
  it("fails closed when an asset root is a junction", async (context) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "visionscan-junction-root-"));
    const target = path.join(root, "target");
    const data = path.join(root, "data");
    const uploads = path.join(data, "uploads");
    try {
      await fs.mkdir(target, { recursive: true });
      await fs.mkdir(data, { recursive: true });
      await fs.symlink(target, uploads, "junction");
    } catch (error) {
      await fs.rm(root, { recursive: true, force: true });
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === "EPERM" || code === "EACCES" || code === "UNKNOWN") {
        context.skip(`Windows runner does not permit junction creation (${code})`);
        return;
      }
      throw error;
    }
    try {
      const result = await runBackup(root);
      expect(result.code).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toMatch(/symlink|reparse/i);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it("detects a nested junction before traversing outside the asset root", async (context) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "visionscan-nested-junction-"));
    const target = path.join(root, "outside");
    const uploads = path.join(root, "data", "uploads");
    try {
      await fs.mkdir(target, { recursive: true });
      await fs.mkdir(uploads, { recursive: true });
      await fs.symlink(target, path.join(uploads, "linked"), "junction");
    } catch (error) {
      await fs.rm(root, { recursive: true, force: true });
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === "EPERM" || code === "EACCES" || code === "UNKNOWN") {
        context.skip(`Windows runner does not permit junction creation (${code})`);
        return;
      }
      throw error;
    }
    try {
      const result = await runBackup(root);
      expect(result.code).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toMatch(/symlink|reparse/i);
      expect(fsSync.existsSync(path.join(uploads, "linked"))).toBe(true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});
