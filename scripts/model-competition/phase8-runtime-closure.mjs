#!/usr/bin/env node

/** Project the Phase 7 real-load observations into the Phase 8 runtime ledger. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const INPUT = path.join(ROOT, "docs", "generated", "phase7-real-load.json");
const CRASH = path.join(ROOT, "docs", "generated", "phase7-provider-crash-matrix.json");
const OUTPUT = path.join(ROOT, "docs", "generated", "phase8-runtime-closure.json");

function read(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }

function main() {
  const load = read(INPUT);
  const crash = read(CRASH);
  const point = (load.points ?? []).find((entry) => entry.requested === 25);
  const completed = Number(point?.completed_jobs ?? 0);
  const requested = Number(point?.requested ?? 0);
  const failed = Number(point?.failed_jobs ?? 0);
  const output = {
    schema_version: "visionscan-phase8-runtime-closure-v1",
    observed_at: new Date().toISOString(),
    phi_included: false,
    source_artifacts: ["docs/generated/phase7-real-load.json", "docs/generated/phase7-provider-crash-matrix.json"],
    status: completed === requested && requested > 0 ? "LOCAL RUNTIME VALIDATED — BOUNDED CONFIGURATION" : "LOCAL RUNTIME PARTIAL",
    root_cause: {
      classification: "BOUNDED_SINGLE_SLOT_QUEUE_DEADLINE",
      statement: "The 25-job point did not complete because one heavy-model reservation slot serialized service while queued/resource wait consumed the 120000 ms job deadline from queue claim.",
      observed_deadline_code: point?.deadlines?.JOB_DEADLINE_EXCEEDED ? "JOB_DEADLINE_EXCEEDED" : "NOT_MEASURED",
      capacity_policy: load.config?.max_active_leases === 1 ? "max_active_leases=1" : "NOT_MEASURED",
      evidence: {
        requested_jobs: requested,
        completed_jobs: completed,
        failed_jobs: failed,
        retries: point?.retries ?? null,
        queue_wait_ms: point?.queue_wait_ms ?? null,
        resource_wait_ms: point?.resource_wait_ms ?? null,
        service_latency_ms: point?.service_latency_ms ?? null,
        deadline_counts: point?.deadlines ?? null,
      },
    },
    fairness: {
      status: "NOT_MEASURED",
      reason: "The Phase 7 load probe records completion order and wait distributions but does not define a fairness target or starvation metric.",
      completion_order_available: Array.isArray(point?.jobs),
    },
    backpressure: {
      status: "MEASURED_BOUNDED_ADMISSION",
      admission_limit: load.config?.max_active_leases ?? null,
      rejection_signal: "reservation_limit_reached",
      queue_age_status: "MEASURED",
      queue_age_max_ms: point?.queue_wait_ms?.max ?? null,
    },
    persistence: {
      exactly_once: "NOT_MEASURED",
      crash_before_result_persistence: crash?.recovery_scope?.false_success ?? "NOT_MEASURED",
      crash_after_result_persistence_before_completion: "NOT_MEASURED",
      graceful_shutdown: "NOT_MEASURED",
      restart_recovery: "NOT_MEASURED",
      duplicate_completion: "NOT_MEASURED",
    },
    real_provider_deadline: {
      status: point?.deadlines?.JOB_DEADLINE_EXCEEDED ? "MEASURED_REAL_QUEUE_DEADLINE" : "NOT_MEASURED",
      deadline_ms: load.config?.job_deadline_ms ?? null,
      enforced_from: "QUEUE_CLAIM",
      provider_process_termination: crash?.status ?? "NOT_MEASURED",
    },
    limitations: [
      "This is a projection of the real Phase 7 single-worker run, not a new 25-job rerun.",
      "Fairness, exactly-once completion, post-persistence crash recovery, graceful shutdown, and restart recovery remain NOT_MEASURED.",
      "Host memory readings are observational; they do not enforce an OS-level memory limit.",
    ],
  };
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ output: path.relative(ROOT, OUTPUT), status: output.status, root_cause: output.root_cause.classification }, null, 2));
}

main();
