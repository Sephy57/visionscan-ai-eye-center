/**
 * S7 — reference architecture for a real local-inference provider that
 * would run a PyTorch model (e.g. the RETFound candidate,
 * lib/models/candidateDossiers.ts) via a local Python subprocess, following
 * the S6 authorization's "LOCAL INFERENCE" security default: images/PDFs/
 * OCR/symptoms/patient identifiers are NEVER sent to a cloud AI API. The
 * subprocess runs on this machine only, communicates over stdio, and never
 * opens a network listener or makes an outbound network call itself.
 *
 * HARD RULES (identical to lib/models/candidateProvider.ts):
 *  - never registered in PROVIDERS (lib/models/provider.ts) or MODELS
 *    (lib/models/registry.ts)
 *  - never imported by lib/analysis/pipeline.ts
 *  - every method fails closed - there is no code path here that can
 *    produce a Finding, because (a) no model artifact is installed and
 *    (b) this deployment's Python environment does not currently have the
 *    packages a real bridge would need (see checkPythonInferenceEnvironment
 *    below, which reports the ACTUAL, live state of this machine, not a
 *    simulation)
 *
 * WHY A SUBPROCESS, NOT AN IN-PROCESS BINDING: this application is Node.js/
 * TypeScript; PyTorch has no first-class Node binding. A real provider would
 * spawn a short-lived Python process per analysis (or a long-lived local
 * server on a loopback-only port), pass the study's image bytes via a
 * temp file path (never via a shared filesystem location outside
 * data/tmp), and read back a single JSON document conforming to
 * `RawModelOutput` (lib/models/outputContract.ts) from stdout. The
 * subprocess must run with the artifact's verified SHA-256 already checked
 * (lib/models/integrity.ts) BEFORE it is ever invoked - integrity
 * verification happens in this Node process, not inside the (less trusted)
 * Python process.
 */

import { spawn } from "child_process";
import path from "path";
import { PROJECT_ROOT } from "../config";
import type { NormalizedStudy } from "../devices/adapter";
import type { ModelRecord, ModelGateResult } from "./registry";
import type { IntegrityResult } from "./integrity";
import type { EyeModelProvider, ModelAnalysisContext, ModelAnalysisOutput, ModelCapabilities } from "./provider";
import { CANDIDATE_MODEL_DOSSIER_MAP, type CandidateModelDossier } from "./candidateDossiers";

export class PythonEnvironmentNotReadyError extends Error {
  constructor(missing: string[]) {
    super(`Python inference environment is not ready - missing packages: ${missing.join(", ") || "(spawn/parse failure)"}`);
    this.name = "PythonEnvironmentNotReadyError";
  }
}

export interface PythonEnvironmentCheckResult {
  ready: boolean;
  python_version: string | null;
  packages: Record<string, { available: boolean; version?: string; error?: string }>;
  missing: string[];
  /** Set only when the check itself could not run at all (python3 missing, timeout, unparseable output). */
  check_error?: string;
}

const CHECK_SCRIPT = path.join(PROJECT_ROOT, "scripts", "inference", "check_environment.py");
const CHECK_TIMEOUT_MS = 15_000;

/**
 * S7 - the isolated, project-scoped virtual environment (never global/user
 * site-packages) created for research-only ophthalmic model work. Its
 * interpreter is tried FIRST because it is the only interpreter this
 * project controls the exact package versions of (see requirements below);
 * `python3`/`python` on PATH remain fallbacks for portability/tests only
 * and must never be assumed to have the right packages.
 */
const VENV_PYTHON = path.join(PROJECT_ROOT, ".venv-ophthalmic", process.platform === "win32" ? "Scripts" : "bin", process.platform === "win32" ? "python.exe" : "python3");

// Importing torch/torchvision is an expensive process-level readiness probe,
// and on Windows repeated imports can transiently fail while another CPU
// inference process is releasing its DLLs.  Keep one authoritative result for
// the lifetime of this Node process (with a generous refresh window) so the
// bridge cannot oscillate between "ready" and "not ready" during a single
// validation request.  A failed/not-ready result is still fail-closed and is
// refreshed sooner so an operator can install the runtime without restarting
// a long-lived development process.
const READY_CACHE_TTL_MS = 5 * 60 * 1000;
const NOT_READY_CACHE_TTL_MS = 10 * 1000;
let environmentCache: { result: PythonEnvironmentCheckResult; expiresAt: number } | null = null;
let environmentCheckInFlight: Promise<PythonEnvironmentCheckResult> | null = null;

/**
 * Interpreter candidates, in priority order. Windows has no `python3`
 * command by default (only `python`, and on some machines `python3`
 * resolves to a Microsoft Store install-stub that exits non-zero with a
 * misleading message rather than a real interpreter) while most Linux/macOS
 * setups only have `python3`. This is a command-RESOLUTION fallback only,
 * never a fallback for a FAILED check (a failed check is still reported as
 * ready: false either way, regardless of which interpreter answered).
 */
function candidateInterpreters(): string[] {
  return [VENV_PYTHON, "python3", "python"];
}
function runCheckWith(command: string): Promise<{ code: number | null; stdout: string; stderr: string } | { spawnError: Error }> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const proc = spawn(command, [CHECK_SCRIPT], { timeout: CHECK_TIMEOUT_MS });
    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      resolve({ spawnError: err });
    });
    proc.on("close", (code) => {
      if (settled) return;
      settled = true;
      resolve({ code, stdout, stderr });
    });
  });
}

function parseCheckOutput(stdout: string): PythonEnvironmentCheckResult | null {
  try {
    const parsed = JSON.parse(stdout.trim()) as { python_version: string; packages: PythonEnvironmentCheckResult["packages"]; missing: string[]; ready: boolean };
    return { ready: parsed.ready, python_version: parsed.python_version, packages: parsed.packages, missing: parsed.missing };
  } catch {
    return null;
  }
}

/**
 * Runs scripts/inference/check_environment.py and reports the REAL, live
 * readiness of this machine's Python environment. Performs no inference, no
 * model loading, no network access. Fails closed (ready: false) on any
 * spawn/timeout/parse error rather than throwing, so callers always get a
 * usable result to display (e.g. on a future model-health panel).
 */
export async function checkPythonInferenceEnvironment(): Promise<PythonEnvironmentCheckResult> {
  const now = Date.now();
  if (environmentCache && environmentCache.expiresAt > now) {
    return environmentCache.result;
  }
  if (environmentCheckInFlight) {
    return environmentCheckInFlight;
  }

  const run = (async (): Promise<PythonEnvironmentCheckResult> => {
    const failures: string[] = [];
    for (const command of candidateInterpreters()) {
      const result = await runCheckWith(command);
      if ("spawnError" in result) {
        failures.push(`"${command}": not found (${result.spawnError.message})`);
        continue; // this interpreter name doesn't exist on PATH at all - try the next one
      }
      if (result.code !== 0) {
        // Covers Windows' "python3" Microsoft Store install-stub, which exists
        // as an executable but exits non-zero instead of a real interpreter.
        failures.push(`"${command}": exited ${result.code} (${result.stderr.slice(0, 150) || "no stderr"})`);
        continue;
      }
      const parsed = parseCheckOutput(result.stdout);
      if (!parsed) {
        failures.push(`"${command}": unparseable output (${result.stdout.slice(0, 100)})`);
        continue;
      }
      environmentCache = {
        result: parsed,
        expiresAt: Date.now() + (parsed.ready ? READY_CACHE_TTL_MS : NOT_READY_CACHE_TTL_MS),
      };
      return parsed;
    }
    const failed: PythonEnvironmentCheckResult = {
      ready: false,
      python_version: null,
      packages: {},
      missing: [],
      check_error: `No usable Python interpreter found. ${failures.join(" | ")}`,
    };
    environmentCache = { result: failed, expiresAt: Date.now() + NOT_READY_CACHE_TTL_MS };
    return failed;
  })();

  environmentCheckInFlight = run;
  try {
    return await run;
  } finally {
    if (environmentCheckInFlight === run) {
      environmentCheckInFlight = null;
    }
  }
}

/**
 * Reference EyeModelProvider for a candidate that WOULD run via the Python
 * bridge once its environment, license, and artifact review are all
 * complete. Every method fails closed against the machine's actual current
 * state - there is no simulated success path.
 */
export class PythonBridgeProvider implements EyeModelProvider {
  readonly providerId: string;
  readonly modelId: string;
  private readonly dossier: CandidateModelDossier;

  constructor(candidateId: string) {
    const dossier = CANDIDATE_MODEL_DOSSIER_MAP[candidateId];
    if (!dossier) throw new Error(`Unknown candidate id: ${candidateId}`);
    this.dossier = dossier;
    this.providerId = `python-bridge:${candidateId}`;
    this.modelId = candidateId;
  }

  async loadModel(): Promise<void> {
    const env = await checkPythonInferenceEnvironment();
    if (!env.ready) {
      throw new PythonEnvironmentNotReadyError(env.missing.length ? env.missing : [env.check_error ?? "unknown"]);
    }
    // A ready Python environment does not mean a model may load: no artifact
    // is installed under data/models/ for any candidate (the RETFound
    // checkpoint download is itself blocked - see docs/MODEL_INTEGRATION.md
    // "Checkpoint acquisition status"), and this provider is never
    // registered, so no analysis output can ever result from this call.
    throw new Error(`No installed artifact for candidate "${this.modelId}" - dossier status is CANDIDATE_ONLY.`);
  }

  async validateModel(): Promise<IntegrityResult & { gate: ModelGateResult }> {
    const env = await checkPythonInferenceEnvironment();
    const checks: IntegrityResult["checks"] = [
      {
        check: "python_environment",
        passed: env.ready,
        detail: env.ready
          ? `Python ${env.python_version} with all required packages available.`
          : env.check_error ?? `Missing packages: ${env.missing.join(", ")}`,
      },
      { check: "artifact_installed", passed: false, detail: "No model artifact is installed under data/models/ for this candidate." },
      { check: "license_scope", passed: false, detail: `License: ${this.dossier.license} - see lib/models/candidateDossiers.ts unresolved_blockers.` },
    ];
    return {
      trusted: false,
      checks,
      model: null,
      gate: {
        allowed: false,
        reasons: checks.filter((c) => !c.passed).map((c) => c.detail),
        label: null,
        findings_use: "none - candidate has no registry entry, no installed artifact, and this environment cannot currently run the inference runtime it would need",
      },
    };
  }

  async analyzeStudy(_study: NormalizedStudy, _ctx: ModelAnalysisContext): Promise<ModelAnalysisOutput> {
    throw new Error(`analyzeStudy() may never be called for "${this.modelId}" - validateModel() cannot pass in this environment.`);
  }

  async getCapabilities(): Promise<ModelCapabilities> {
    return {
      model_id: this.dossier.candidate_id,
      modalities: this.dossier.modality,
      supported_findings: [],
      supports_measurements: false,
      supports_localization: false,
      calibration_available: false,
    };
  }

  async getModelMetadata(): Promise<ModelRecord | null> {
    return null;
  }

  async unloadModel(): Promise<void> {
    // Nothing was ever loaded.
  }

  getDossier(): CandidateModelDossier {
    return this.dossier;
  }
}
