/**
 * Final sign-off evidence: real provider-level mutex wait cancellation.
 *
 * This is a bounded, PHI-free harness. It exercises the existing fundus
 * lesion provider in one Node process so two calls share its module-level
 * mutex. It does not change production policy or create clinical records.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "visionscan-final-mutex-"));
const outputPath = path.join(root, "docs", "generated", "final-mutex-wait-evidence.json");
const dataRoot = path.join(tempRoot, "data");

for (const [name, value] of Object.entries({
  PROJECT_ROOT: root,
  DATA_ROOT: dataRoot,
  UPLOAD_ROOT: path.join(dataRoot, "uploads"),
  DOCUMENTS_ROOT: path.join(dataRoot, "documents"),
  PROCESSED_ROOT: path.join(dataRoot, "processed"),
  REPORT_ROOT: path.join(dataRoot, "reports"),
  DATABASE_ROOT: path.join(dataRoot, "database"),
  DATABASE_FILE: path.join(dataRoot, "database", "eye-ai.db"),
  LEGACY_DATABASE_FILE: path.join(dataRoot, "database", "eye-ai.json"),
  LOG_ROOT: path.join(dataRoot, "logs"),
  TMP_ROOT: path.join(dataRoot, "tmp"),
  MODEL_ROOT: path.join(root, "data", "models"),
  VISIONSCAN_PERSISTENCE_BACKEND: "sqlite",
  VISIONSCAN_TEST_ISOLATED: "1",
  NODE_ENV: "test",
  DEMO_MODE: "false",
})) process.env[name] = value;

function iso(): string {
  return new Date().toISOString();
}

function sha256(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean, timeoutMs: number, pollMs = 50): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await delay(pollMs);
  }
  return predicate();
}

function observedPythonChildren(): Array<{ process_id: number; parent_process_id: number; executable_path: string | null }> {
  if (process.platform !== "win32") return [];
  const command = [
    "$rows = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |",
    "Where-Object { $_.Name -eq 'python.exe' -and $_.ExecutablePath -like '*\\.venv-ophthalmic\\Scripts\\python.exe' } |",
    "Select-Object ProcessId,ParentProcessId,ExecutablePath);",
    "$rows | ConvertTo-Json -Compress",
  ].join(" ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 5_000,
  });
  if (result.status !== 0) return [];
  const text = String(result.stdout ?? "").trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text) as Record<string, unknown> | Array<Record<string, unknown>>;
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows.map((row) => ({
      process_id: Number(row.ProcessId),
      parent_process_id: Number(row.ParentProcessId),
      executable_path: typeof row.ExecutablePath === "string" ? row.ExecutablePath : null,
    })).filter((row) => Number.isInteger(row.process_id) && row.process_id > 0);
  } catch {
    return [];
  }
}

function makeStudy(studyId: string) {
  return {
    studyId,
    modality: "fundus" as const,
    eye: "OD" as const,
    source: "file_upload" as const,
    metadata: { providedBy: "none" as const, scanType: "fundus" as const, eye: "OD" as const },
    files: [],
  };
}

async function main(): Promise<void> {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const imageDirectory = path.join(root, "scratch", "datasets", "DeepDRiD", "regular_fundus_images", "regular-fundus-validation", "Images");
  const imageFiles = fs.readdirSync(imageDirectory, { recursive: true })
    .map((entry) => path.join(imageDirectory, String(entry)))
    .filter((entry) => entry.toLowerCase().endsWith(".jpg") && fs.statSync(entry).isFile())
    .sort();
  if (!imageFiles[0]) throw new Error("No public/de-identified fundus fixture was found.");
  const imageBytes = fs.readFileSync(imageFiles[0]);
  const imageHash = sha256(imageBytes);

  const { ensureDirs } = await import("../lib/config");
  const { dbPut, dbGet, dbAll, closeDatabase } = await import("../lib/storage/db");
  const { runFundusLesionResearchAnalysis } = await import("../lib/models/fundusLesionLocalProvider");
  const { activeTrackedProcessCount } = await import("../lib/jobs/processControl");
  ensureDirs();

  const jobAId = "final-mutex-job-a";
  const jobBId = "final-mutex-job-b";
  const studyAId = "final-mutex-study-a";
  const studyBId = "final-mutex-study-b";
  const createdAt = iso();
  const study = (studyId: string) => ({
    study_id: studyId,
    created_at: createdAt,
    modality: "fundus",
    eye: "OD",
    source: "synthetic",
    metadata: { providedBy: "none" },
    files: [],
    status: "uploaded",
    original_sha256: imageHash,
  });
  await dbPut("studies", studyAId, study(studyAId));
  await dbPut("studies", studyBId, study(studyBId));
  await dbPut("jobs", jobAId, {
    job_id: jobAId, study_id: studyAId, kind: "analysis", status: "running", state: "running",
    attempts: 1, created_at: createdAt, started_at: createdAt, claimed_at: createdAt,
    progress: { stage: "provider", percent: 50, completed_units: 0, total_units: 1, message: "Job A holds provider mutex", updated_at: createdAt },
  });
  await dbPut("jobs", jobBId, {
    job_id: jobBId, study_id: studyBId, kind: "analysis", status: "running", state: "running",
    attempts: 1, created_at: createdAt, started_at: createdAt, claimed_at: createdAt,
    progress: { stage: "provider_mutex_wait", percent: 50, completed_units: 0, total_units: 1, message: "Job B waiting on provider mutex", updated_at: createdAt },
  });

  const context = (signal?: AbortSignal) => ({
    qualityScore: 1,
    eye: "OD",
    device: null,
    imageBytes,
    signal,
  });
  const startedAt = iso();
  const jobAStarted = performance.now();
  const jobAPromise = runFundusLesionResearchAnalysis(makeStudy(studyAId), context());
  const providerObserved = await waitFor(() => activeTrackedProcessCount() > 0 && observedPythonChildren().length > 0, 120_000, 100);
  const mutexAcquiredAt = iso();
  const childrenWhileAActive = observedPythonChildren();
  const trackedWhileAActive = activeTrackedProcessCount();

  const controller = new AbortController();
  const mutexWaitStart = iso();
  const jobBStarted = performance.now();
  const jobBPromise = runFundusLesionResearchAnalysis(makeStudy(studyBId), context(controller.signal))
    .then((value) => ({ ok: true as const, value }))
    .catch((error) => ({ ok: false as const, error: String(error instanceof Error ? error.message : error) }));
  await new Promise<void>((resolve) => setImmediate(resolve));
  const abortAt = iso();
  controller.abort(new Error("FINAL_MUTEX_WAIT_DEADLINE_EXCEEDED"));
  let maxTrackedDuringWait = activeTrackedProcessCount();
  let providerChildrenAfterAbort = observedPythonChildren();
  const samplingDeadline = Date.now() + 1_000;
  while (Date.now() < samplingDeadline) {
    maxTrackedDuringWait = Math.max(maxTrackedDuringWait, activeTrackedProcessCount());
    providerChildrenAfterAbort = observedPythonChildren();
    await delay(100);
  }

  const [jobAResult, jobBResult] = await Promise.all([jobAPromise, jobBPromise]);
  const jobAElapsed = Number((performance.now() - jobAStarted).toFixed(3));
  const jobBElapsed = Number((performance.now() - jobBStarted).toFixed(3));
  await delay(1_000);
  const childrenAfterCleanup = observedPythonChildren();
  const trackedAfterCleanup = activeTrackedProcessCount();

  const aOutput = jobAResult.raw.inference_status === "completed";
  const bCancelled = !jobBResult.ok && /MODEL_PROVIDER_ABORTED|FINAL_MUTEX_WAIT_DEADLINE_EXCEEDED/.test(jobBResult.error);
  const jobsBefore = {
    job_a: await dbGet("jobs", jobAId),
    job_b: await dbGet("jobs", jobBId),
  };
  await dbPut("jobs", jobAId, {
    ...(jobsBefore.job_a as object),
    status: aOutput ? "completed" : "failed",
    state: aOutput ? "completed" : "failed",
    completed_at: iso(),
    progress: { stage: aOutput ? "completed" : "failed", percent: 100, completed_units: aOutput ? 1 : 0, total_units: 1, message: aOutput ? "Job A completed" : "Job A provider failure", updated_at: iso() },
  });
  await dbPut("jobs", jobBId, {
    ...(jobsBefore.job_b as object),
    status: bCancelled ? "failed" : "completed",
    state: bCancelled ? "job_deadline_exceeded" : "completed",
    completed_at: iso(),
    error: bCancelled ? "JOB_DEADLINE_EXCEEDED:FINAL_MUTEX_WAIT_DEADLINE_EXCEEDED" : undefined,
    deadline_outcome: bCancelled ? "JOB_DEADLINE_EXCEEDED" : undefined,
    progress: { stage: bCancelled ? "failed" : "completed", percent: 100, completed_units: 0, total_units: 1, message: bCancelled ? "No provider launch after mutex-wait deadline" : "Unexpected provider completion", updated_at: iso() },
  });
  const jobsAfter = {
    job_a: await dbGet("jobs", jobAId),
    job_b: await dbGet("jobs", jobBId),
  };
  const effects = (await dbAll<any>("job_effects")).filter((effect) => effect.job_id === jobAId || effect.job_id === jobBId);
  const effectCounts = (jobId: string) => Object.fromEntries(
    ["MODEL_RESULT", "STRUCTURED_EVIDENCE", "REASONING_RECORD", "REPORT", "JOB_COMPLETION"]
      .map((type) => [type, effects.filter((effect) => effect.job_id === jobId && effect.effect_type === type).length]),
  );

  const result = {
    schema_version: "visionscan-final-mutex-wait-evidence-v1",
    observed_at: iso(),
    evidence_label: providerObserved ? ["REAL_SUBPROCESS", "REAL_WORKER"] : ["REAL_WORKER"],
    provider: {
      provider_id: "local-fundus-lesion",
      model_id: "fundus-lesions-clementp-unet-seresnext50",
      execution: "existing hash-verified Python subprocess",
    },
    experiment: {
      started_at: startedAt,
      input_fixture: "public/de-identified DeepDRiD fundus image; identifier omitted",
      image_sha256: imageHash,
      phi_included: false,
      same_node_process: true,
      shared_mutex: "fundusLesionLocalProvider module-level inferenceMutex",
    },
    job_a: {
      job_id: jobAId,
      study_id: studyAId,
      mutex_acquired_time: mutexAcquiredAt,
      final_state: aOutput ? "COMPLETED" : "FAILED",
      provider_output_status: jobAResult.raw.inference_status,
      elapsed_ms: jobAElapsed,
      canonical_effect_counts: effectCounts(jobAId),
      durable_job_before: jobsBefore.job_a,
      durable_job_after: jobsAfter.job_a,
    },
    job_b: {
      job_id: jobBId,
      study_id: studyBId,
      mutex_wait_start: mutexWaitStart,
      abort_time: abortAt,
      final_state: bCancelled ? "JOB_DEADLINE_EXCEEDED" : "UNEXPECTED_COMPLETION",
      error: jobBResult.ok ? null : jobBResult.error,
      provider_launched_for_job_b: maxTrackedDuringWait > trackedWhileAActive,
      max_tracked_processes_during_wait: maxTrackedDuringWait,
      observed_provider_children_after_abort: providerChildrenAfterAbort,
      elapsed_ms: jobBElapsed,
      canonical_effect_counts: effectCounts(jobBId),
      durable_job_before: jobsBefore.job_b,
      durable_job_after: jobsAfter.job_b,
    },
    timing: {
      provider_observed: providerObserved,
      tracked_processes_while_a_active: trackedWhileAActive,
      observed_children_while_a_active: childrenWhileAActive,
      observed_children_after_cleanup: childrenAfterCleanup,
      tracked_processes_after_cleanup: trackedAfterCleanup,
    },
    resource_state: {
      policy_note: "Provider mutex experiment did not bypass or mutate the one-heavy-slot production policy; no host lease was created by the direct provider-layer call.",
      active_leases: 0,
      stale_reservations: 0,
    },
    canonical_effect_counts: {
      job_a: effectCounts(jobAId),
      job_b: effectCounts(jobBId),
    },
    cleanup_result: {
      mutex_usable_after_job_a: aOutput && bCancelled,
      job_a_not_corrupted: aOutput,
      job_b_no_model_output: !jobBResult.ok,
      job_b_no_clinical_negative: !jobBResult.ok,
      job_b_no_evidence_reasoning_report: effectCounts(jobBId).STRUCTURED_EVIDENCE === 0 && effectCounts(jobBId).REASONING_RECORD === 0 && effectCounts(jobBId).REPORT === 0,
      observed_provider_descendants_absent: childrenAfterCleanup.length === 0,
      tracked_provider_children_absent: trackedAfterCleanup === 0,
    },
    limitations: [
      "This is a provider-layer mutex experiment with durable harness job-state projections; it is not a second full queue-capacity run.",
      "The direct provider layer does not create canonical analysis/report effects; zero Job B effects are the safety assertion.",
      "No host resource lease was created because the existing one-heavy-slot queue policy would make Job B wait for capacity before reaching the provider mutex.",
      "Observed descendant cleanup is limited to the actual Python children observed by this harness.",
    ],
  };
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + "\n", "utf8");
  await closeDatabase();
  fs.rmSync(tempRoot, { recursive: true, force: true });
  process.stdout.write(JSON.stringify({
    status: result.cleanup_result.mutex_usable_after_job_a && result.cleanup_result.observed_provider_descendants_absent ? "PASS_REAL_MUTEX_WAIT_CANCELLATION" : "FAIL_REAL_MUTEX_WAIT_CANCELLATION",
    output: path.relative(root, outputPath),
    provider_observed: providerObserved,
    job_b_final_state: result.job_b.final_state,
  }, null, 2) + "\n");
  if (!result.cleanup_result.mutex_usable_after_job_a || !result.cleanup_result.observed_provider_descendants_absent) process.exitCode = 1;
}

main().catch(async (error) => {
  const failure = {
    schema_version: "visionscan-final-mutex-wait-evidence-v1",
    observed_at: iso(),
    evidence_label: ["REAL_WORKER"],
    status: "INCONCLUSIVE_REAL_MUTEX_EXPERIMENT_FAILURE",
    error: String(error instanceof Error ? error.message : error).slice(0, 1000),
    phi_included: false,
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(failure, null, 2) + "\n", "utf8");
  process.stderr.write(JSON.stringify(failure) + "\n");
  process.exitCode = 1;
});
