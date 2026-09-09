import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { afterAll, describe, expect, it } from "vitest";

const repo = process.cwd();
const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), "visionscan-backup-restore-"));
const source = path.join(runRoot, "legacy.json");
const database = path.join(runRoot, "eye-ai.db");
const backup = path.join(runRoot, "backup");
fs.copyFileSync(path.join(repo, "tests", "fixtures", "legacy-store.json"), source);

function run(script: string, args: string[]) {
  return execFileSync(process.execPath, [path.join(repo, "scripts", script), ...args], { cwd: runRoot, encoding: "utf8", env: { ...process.env, DATABASE_FILE: database } });
}

describe("data backup and restore controls", () => {
  it("creates a hash-verified backup and restores to a new directory", () => {
    run("migrate-data.mjs", ["--apply", "--source", source, "--destination", database]);
    const backupOutput = JSON.parse(run("backup-data.mjs", ["--output", backup]));
    expect(backupOutput.database.kind).toBe("sqlite");
    expect(fs.existsSync(path.join(backup, "manifest.json"))).toBe(true);
    const restoredOutput = JSON.parse(run("restore-data.mjs", ["--backup", backup]));
    expect(restoredOutput.status).toBe("restored_to_new_directory");
    expect(fs.existsSync(path.join(restoredOutput.output, "eye-ai.db"))).toBe(true);
  });

  it("dry-run backup and restore do not mutate their targets", () => {
    const plan = JSON.parse(run("backup-data.mjs", ["--dry-run", "--output", path.join(runRoot, "plan")]));
    expect(plan.plan_only).toBe(true);
    const restorePlan = JSON.parse(run("restore-data.mjs", ["--backup", backup, "--dry-run"]));
    expect(restorePlan.plan_only).toBe(true);
    expect(fs.existsSync(path.join(runRoot, "plan"))).toBe(false);
  });
});

afterAll(() => fs.rmSync(runRoot, { recursive: true, force: true }));
