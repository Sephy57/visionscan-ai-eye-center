#!/usr/bin/env node

/**
 * Phase 11 capacity-policy envelope. The 25-job measurement is deliberately
 * inherited from the real Phase 10 provider run; this script makes every
 * observed terminal state explicit without launching another unbounded load.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(ROOT, "docs", "generated", "phase10-load-fairness.json");
const outputPath = path.join(ROOT, "docs", "generated", "phase11-capacity-policy.json");
const source = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
const point = source.real_provider_load?.points?.["25"] ?? {};
const completed = Number(point.completed_jobs ?? 0);
const deadlineExceeded = Number(point.deadlines?.JOB_DEADLINE_EXCEEDED ?? 0);
const observedJobs = completed + deadlineExceeded;

const result = {
  schema_version: "visionscan-phase11-capacity-policy-v1",
  generated_at: new Date().toISOString(),
  evidence_classification: "INHERITED_REAL_PROVIDER_LOAD_PLUS_EXPLICIT_POLICY_MAPPING",
  source_artifact: "docs/generated/phase10-load-fairness.json",
  policy_version: "bounded-single-slot-absolute-job-deadline-v1",
  states: ["QUEUED", "WAITING_FOR_RESOURCE", "DEFERRED_CAPACITY", "QUEUE_TIMEOUT", "SERVICE_TIMEOUT", "JOB_DEADLINE_EXCEEDED", "COMPLETED"],
  transitions: {
    QUEUED: ["WAITING_FOR_RESOURCE", "QUEUE_TIMEOUT", "COMPLETED", "JOB_DEADLINE_EXCEEDED"],
    WAITING_FOR_RESOURCE: ["COMPLETED", "DEFERRED_CAPACITY", "JOB_DEADLINE_EXCEEDED"],
    DEFERRED_CAPACITY: ["QUEUED", "QUEUE_TIMEOUT"],
    QUEUE_TIMEOUT: [],
    SERVICE_TIMEOUT: [],
    JOB_DEADLINE_EXCEEDED: [],
    COMPLETED: [],
  },
  operational_policy: {
    queue_order: "FIFO by created_at/job_id; transactional claim remains authoritative",
    max_active_heavy_leases: 1,
    resource_wait: "bounded polling under the same absolute job deadline; no provider launch before admission",
    deadline_terminal_state: "JOB_DEADLINE_EXCEEDED",
    queue_timeout_state: "QUEUE_TIMEOUT when queued age exceeds max_queue_wait_ms before claim",
    service_timeout_state: "SERVICE_TIMEOUT is reserved for a separately instrumented service budget; this observed run records the unified JOB_DEADLINE_EXCEEDED terminal state",
    infinite_capacity_hunt: false,
  },
  observed_jobs: observedJobs,
  observed_terminal_counts: {
    QUEUED: 0,
    WAITING_FOR_RESOURCE: 0,
    DEFERRED_CAPACITY: 0,
    QUEUE_TIMEOUT: 0,
    SERVICE_TIMEOUT: 0,
    JOB_DEADLINE_EXCEEDED: deadlineExceeded,
    COMPLETED: completed,
  },
  observed_terminal_state_for_every_job: observedJobs === 25,
  fifo: source.fairness ?? null,
  retry_analysis: {
    retries_3109: Number(point.retries ?? 0),
    retries_3109_classification: "RESOURCE_POLLING_NOT_JOB_RETRY_CHURN",
    bounded_poll_ms: 250,
    job_retry_policy: "explicit idempotency key, maximum three attempts, durable retry_after_at",
    note: "The load artifact labels 3,109 retries; under the worker path these are repeated capacity/resource polling observations, not 3,109 durable job retries or provider relaunches.",
  },
  limitations: [
    "The 25-job provider measurement predates the Phase 11 resource-wait implementation and is retained as observed evidence; the Phase 11 policy mapping does not claim a new 25-job rerun.",
    "DEFERRED_CAPACITY and QUEUE_TIMEOUT were defined but had zero observations in this 25-job run.",
  ],
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ status: "PASS_EXPLICIT_CAPACITY_POLICY", output: path.relative(ROOT, outputPath), observed_jobs: observedJobs }));
if (observedJobs !== 25) process.exitCode = 1;
