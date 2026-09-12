#!/usr/bin/env node

/**
 * Acquire the canonical RETGUARD DR research archive without executing any
 * repository code from the archive.  The archive is verified as a ZIP and its
 * member digests are checked in a disposable Python stdlib process.  This is
 * an acquisition/evidence command only: it never registers or promotes the
 * candidate and it never places it in the live model registry.
 *
 * Usage:
 *   node scripts/model-competition/acquire-retguard-dr.mjs
 *   node scripts/model-competition/acquire-retguard-dr.mjs --output-dir <dir>
 */

import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SOURCE_REVISION = "v1.0.0";
const SOURCE_URL = "https://github.com/anchor-neuro/retguard/releases/download/v1.0.0/retguard-dr-v1.0.0.zip";
const ZIP_NAME = "retguard-dr-v1.0.0.zip";
const EXPECTED_ZIP_BYTES = 204_707_438;
const EXPECTED_ZIP_SHA256 = "663c7f8bbc3676df2fe353efa0f3913c757db8c35cf9bf97ab451a756792d2e0";
const EXPECTED_MEMBERS = Object.freeze({
  "retguard_dr_v1.0.0.onnx": "f0e19fa86d5a27a05731550d1d6708c01f6f363f45a1fa57849de988f91e775b",
  "ood_gate_dr_v1.0.0.npz": "cb99b4d375ecc384ce6fbeff4f9b94c42613964b32b7a96cef8b3e1227dbf5b2",
  "MODEL_CARD_dr.md": "458b059546bb8295fd00694d91d1a4ae12c7056450dab1e55a5608f5bb6eda06",
  "LICENSE.txt": "c925d59d1d98fa8c8957273dfbe81386acc69f53079a55abb4be62ac6d2fb2df",
});

function argument(name) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (index >= 0 && (!value || value.startsWith("--"))) throw new Error(`${name} requires a directory`);
  return value;
}

function defaultOutputDir() {
  return path.join(ROOT, "scratch", "phase6-candidates", "retguard-dr-v1.0.0");
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let bytes = 0;
    for (;;) {
      const read = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (read === 0) break;
      hash.update(buffer.subarray(0, read));
      bytes += read;
    }
    return { bytes, sha256: hash.digest("hex") };
  } finally {
    fs.closeSync(fd);
  }
}

function findPython() {
  const configured = process.platform === "win32"
    ? path.join(ROOT, ".venv-ophthalmic", "Scripts", "python.exe")
    : path.join(ROOT, ".venv-ophthalmic", "bin", "python3");
  if (fs.existsSync(configured)) return configured;
  for (const name of process.platform === "win32" ? ["python", "py"] : ["python3", "python"]) {
    const probe = spawnSync(name, ["-I", "-s", "-c", "import sys; print(sys.executable)"], {
      cwd: ROOT, encoding: "utf8", windowsHide: true, timeout: 10_000,
    });
    if (probe.status === 0) return name;
  }
  return null;
}

function inspectZipWithPython(python, zipPath) {
  if (!python) throw new Error("Python is required for safe stdlib ZIP member verification");
  const script = [
    "import hashlib, json, sys, zipfile",
    "p = sys.argv[1]",
    "with zipfile.ZipFile(p) as z:",
    "    bad = z.testzip()",
    "    if bad: raise RuntimeError('ZIP_CRC_FAILED:' + bad)",
    "    members = {}",
    "    for info in z.infolist():",
    "        if info.is_dir(): continue",
    "        digest = hashlib.sha256()",
    "        with z.open(info, 'r') as src:",
    "            while True:",
    "                chunk = src.read(1024 * 1024)",
    "                if not chunk: break",
    "                digest.update(chunk)",
    "        members[info.filename] = {'bytes': info.file_size, 'sha256': digest.hexdigest()} ",
    "print(json.dumps({'members': members}, sort_keys=True))",
  ].join("\n");
  const result = spawnSync(python, ["-I", "-s", "-c", script, zipPath], {
    cwd: ROOT, encoding: "utf8", windowsHide: true, timeout: 300_000,
  });
  if (result.status !== 0) throw new Error(`ZIP_INSPECTION_FAILED:${(result.stderr || result.stdout || "").trim()}`);
  return JSON.parse(result.stdout);
}

async function acquire(zipPath) {
  if (fs.existsSync(zipPath)) return { downloaded: false };
  const response = await fetch(SOURCE_URL, { redirect: "follow", headers: { "User-Agent": "VisionScan-Phase6-Research" } });
  if (!response.ok || !response.body) throw new Error(`DOWNLOAD_FAILED:HTTP_${response.status}`);
  await fsp.mkdir(path.dirname(zipPath), { recursive: true });
  const temporary = `${zipPath}.${process.pid}.${crypto.randomBytes(5).toString("hex")}.part`;
  try {
    await pipeline(response.body, fs.createWriteStream(temporary, { flags: "wx" }));
    await fsp.rename(temporary, zipPath);
    // Do not persist the redirected signed release-assets URL; it may contain
    // short-lived access tokens. The canonical URL is sufficient provenance.
    return { downloaded: true };
  } finally {
    await fsp.rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function main() {
  const outputDir = path.resolve(argument("--output-dir") || defaultOutputDir());
  await fsp.mkdir(outputDir, { recursive: true });
  const zipPath = path.join(outputDir, ZIP_NAME);
  const retrieval = await acquire(zipPath);
  const archive = sha256File(zipPath);
  if (archive.bytes !== EXPECTED_ZIP_BYTES) throw new Error(`ZIP_SIZE_MISMATCH:${archive.bytes}`);
  if (archive.sha256 !== EXPECTED_ZIP_SHA256) throw new Error(`ZIP_SHA256_MISMATCH:${archive.sha256}`);
  const memberReport = inspectZipWithPython(findPython(), zipPath);
  const memberErrors = [];
  const names = Object.keys(memberReport.members).sort();
  for (const [name, expected] of Object.entries(EXPECTED_MEMBERS)) {
    const actual = memberReport.members[name];
    if (!actual) memberErrors.push(`missing:${name}`);
    else if (actual.sha256 !== expected) memberErrors.push(`sha256:${name}:${actual.sha256}`);
  }
  if (names.length !== Object.keys(EXPECTED_MEMBERS).length || memberErrors.length > 0) {
    throw new Error(`ZIP_MEMBER_INTEGRITY_FAILED:${memberErrors.join(",") || `unexpected-members:${names.join(",")}`}`);
  }
  const evidence = {
    format: "visionscan-phase6-candidate-acquisition/v1",
    candidate_id: "retguard-dr-v1.0.0",
    acquired_at: new Date().toISOString(),
    source_url: SOURCE_URL,
    source_revision: SOURCE_REVISION,
    archive: {
      file: path.relative(ROOT, zipPath).replaceAll("\\", "/"),
      bytes: archive.bytes,
      sha256: archive.sha256,
      publisher_sha256: EXPECTED_ZIP_SHA256,
      downloaded_by_this_run: retrieval.downloaded,
    },
    members: memberReport.members,
    rights_state: "RIGHTS_RESTRICTED",
    validation_state: "CANDIDATE_ONLY",
    runtime_state: "NOT_BENCHMARK_READY",
    stop_rule: "ONNX_LOGIT_PARITY_FAILED",
    stop_reason: "The publisher model card records maximum logit difference 0.002526 against a 0.001 tolerance; the released ONNX artifact is not benchmark-ready under the frozen Phase 6 gate.",
    limitations: [
      "Acquisition and hash verification do not establish model validity or clinical safety.",
      "The candidate has no local same-protocol DeepDRiD head-to-head result.",
      "The candidate is excluded from ordinary VisionScan inference and model registry promotion.",
    ],
  };
  await fsp.writeFile(path.join(outputDir, "acquisition.json"), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ status: "ACQUIRED_BUT_NOT_BENCHMARK_READY", ...evidence }, null, 2)}\n`);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
