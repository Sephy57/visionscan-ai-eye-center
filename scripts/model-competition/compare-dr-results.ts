#!/usr/bin/env -S npx vite-node

import fs from "node:fs";
import process from "node:process";
import { compareDrCompetitionResults, validateRunResult, type DrCompetitionRunResult } from "../../lib/models/competitionContract";

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a JSON path`);
  return value;
}

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function main(): void {
  const baseline = readJson(argument("--baseline"));
  const candidate = readJson(argument("--candidate"));
  const baselineValidation = validateRunResult(baseline);
  const candidateValidation = validateRunResult(candidate);
  if (!baselineValidation.valid || !candidateValidation.valid) {
    process.stdout.write(`${JSON.stringify({ status: "BLOCKED", reasons: [
      ...baselineValidation.errors.map((error) => `baseline: ${error}`),
      ...candidateValidation.errors.map((error) => `candidate: ${error}`),
    ] }, null, 2)}\n`);
    process.exitCode = 2;
    return;
  }
  const comparison = compareDrCompetitionResults(baseline as DrCompetitionRunResult, candidate as DrCompetitionRunResult);
  process.stdout.write(`${JSON.stringify(comparison, null, 2)}\n`);
  if (comparison.status !== "COMPARABLE") process.exitCode = 2;
}

try { main(); } catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
