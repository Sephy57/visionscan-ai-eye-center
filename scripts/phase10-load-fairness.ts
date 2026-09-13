/**
 * Bounded control-plane FIFO/fairness probe. It deliberately does not call a
 * model provider: real provider load numbers remain sourced from the Phase 7
 * artifact and are reported separately as REAL_WORKER evidence.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "visionscan-phase10-fairness-"));
const outputPath = path.join(root, "docs", "generated", "phase10-load-fairness.json");
const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true });
const status = spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8", windowsHide: true });

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
  NODE_ENV: "test",
  VISIONSCAN_TEST_ISOLATED: "1",
  DEMO_MODE: "false",
})) process.env[name] = value;

try {
  const { dbPut, dbAll, closeDatabase } = await import("../lib/storage/db");
  const { listJobsPage } = await import("../lib/jobs/queue");
  const studyId = "phase10-fairness-study";
  await dbPut("studies", studyId, {
    study_id: studyId,
    created_at: "2026-01-01T00:00:00.000Z",
    modality: "fundus",
    eye: "OD",
    source: "synthetic",
    metadata: { providedBy: "none" },
    files: [],
    status: "uploaded",
    original_sha256: "synthetic",
  });
  const expected: string[] = [];
  for (let index = 0; index < 100; index += 1) {
    const jobId = `phase10-fairness-job-${String(index).padStart(3, "0")}`;
    expected.push(jobId);
    await dbPut("jobs", jobId, {
      job_id: jobId,
      study_id: studyId,
      kind: "analysis",
      status: "queued",
      state: "queued",
      attempts: 0,
      created_at: new Date(Date.parse("2026-01-01T00:00:00.000Z") + index).toISOString(),
      progress: { stage: "queued", percent: 0, completed_units: 0, total_units: 0, message: "synthetic queue probe", updated_at: "2026-01-01T00:00:00.000Z" },
    });
  }
  const page = await listJobsPage({ limit: 100, direction: "asc", status: "queued", kind: "analysis" });
  const observed = page.items.map((job) => job.job_id).filter((id) => id.startsWith("phase10-fairness-job-"));
  const rankOvertakes = observed.reduce((max, id, index) => Math.max(max, Math.max(0, expected.indexOf(id) - index)), 0);
  const load = JSON.parse(fs.readFileSync(path.join(root, "docs", "generated", "phase7-real-load.json"), "utf8"));
  const points = Object.fromEntries((load.points ?? []).map((point: any) => [String(point.requested), {
    requested: point.requested,
    queued_jobs: point.queued_jobs,
    completed_jobs: point.completed_jobs,
    failed_jobs: point.failed_jobs,
    timed_out_jobs: point.timed_out_jobs,
    queue_wait_ms: point.queue_wait_ms,
    resource_wait_ms: point.resource_wait_ms,
    service_latency_ms: point.service_latency_ms,
    total_latency_ms: point.job_completion_ms,
    throughput_jobs_per_second: point.throughput_jobs_per_second,
    peak_working_set_bytes: point.peak_working_set_bytes,
    peak_private_bytes: point.peak_private_bytes,
    peak_cpu_seconds: point.peak_cpu_seconds,
    peak_thread_count: point.peak_thread_count,
    retries: point.retries,
    deadlines: point.deadlines,
  }]));
  const result = {
    schema_version: "visionscan-phase10-load-fairness-v1",
    observed_at: new Date().toISOString(),
    implementation_head_at_capture: String(head.stdout ?? "").trim() || null,
    working_tree_dirty_at_capture: String(status.stdout ?? "").trim().length > 0,
    status: rankOvertakes === 0 ? "PARTIAL_REAL_LOAD_PLUS_FIFO_CONTROL_PLANE" : "FAIL_FIFO_CONTROL_PLANE",
    queue_policy: {
      worker_order: "created_at ASC, id ASC",
      api_default_order: "created_at DESC, id DESC",
      worker_concurrency: 1,
      page_bound: 32,
      fairness_metric: "rank_overtakes across a 100-job synthetic queue",
      starvation_definition: "a queued job is starved if a newer job is selected ahead of it while the older job remains runnable",
    },
    fairness: {
      evidence_classification: "INTEGRATION",
      requested_jobs: 100,
      observed_jobs: observed.length,
      rank_overtakes: rankOvertakes,
      starvation_observed: rankOvertakes > 0,
      result: rankOvertakes === 0 ? "FIFO_CONTROL_PLANE_PASS" : "FIFO_CONTROL_PLANE_FAIL",
      limitation: "This is a deterministic queue-order probe, not a sustained model-service starvation SLO measurement.",
    },
    real_provider_load: {
      evidence_classification: "REAL_WORKER",
      source_artifact: "docs/generated/phase7-real-load.json",
      source_status: load.status,
      source_observed_at: load.observed_at,
      points,
      capacity_classification: "PARTIAL — 25-job point had 15 completed and 10 JOB_DEADLINE_EXCEEDED under max_active_leases=1",
    },
    phi_included: false,
    limitations: [
      "The control-plane fairness probe uses synthetic job metadata only and does not claim model throughput.",
      "The real provider curve is preserved as measured Phase 7 evidence; it is not relabelled as a complete Phase 10 pass.",
    ],
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  await closeDatabase();
  fs.rmSync(dataRoot, { recursive: true, force: true });
  console.log(JSON.stringify({ status: result.status, output: path.relative(root, outputPath), rank_overtakes: rankOvertakes }));
} catch (error) {
  fs.rmSync(dataRoot, { recursive: true, force: true });
  throw error;
}
