import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { afterAll, describe, expect, it } from "vitest";

const repo = process.cwd();
const script = path.join(repo, "scripts", "migrate-data.mjs");
const fixture = path.join(repo, "tests", "fixtures", "legacy-store.json");
const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), "visionscan-migration-"));
const source = path.join(runRoot, "legacy.json");
const destination = path.join(runRoot, "eye-ai.db");
fs.copyFileSync(fixture, source);

function run(...args: string[]): string {
  return execFileSync(process.execPath, [script, ...args], { cwd: runRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

describe("legacy persistence migration", () => {
  it("dry-runs without creating a destination", () => {
    const output = JSON.parse(run("--dry-run", "--source", source, "--destination", destination));
    expect(output.status).toBe("dry_run");
    expect(output.dry_run).toBe(true);
    expect(output.collections.studies).toBe(1);
    expect(output.legacy_report_ids).toContain("rep_fixture-study");
    expect(fs.existsSync(destination)).toBe(false);
  });

  it("applies counts and is idempotent", () => {
    const applied = JSON.parse(run("--apply", "--source", source, "--destination", destination));
    expect(applied.status).toBe("applied");
    expect(fs.existsSync(destination)).toBe(true);
    const replay = JSON.parse(run("--apply", "--source", source, "--destination", destination));
    expect(replay.status).toBe("already_applied");
    expect(fs.readFileSync(source, "utf8")).toContain("fixture-study");
  });

  it("rejects invalid source without creating a destination", () => {
    const invalid = path.join(runRoot, "invalid.json");
    fs.writeFileSync(invalid, "not-json", "utf8");
    expect(() => run("--apply", "--source", invalid, "--destination", path.join(runRoot, "invalid.db"))).toThrow();
    expect(fs.existsSync(path.join(runRoot, "invalid.db"))).toBe(false);
  });
});

afterAll(() => fs.rmSync(runRoot, { recursive: true, force: true }));
