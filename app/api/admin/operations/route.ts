import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { listJobsPage, isExternalWorkerMode } from "@/lib/jobs/queue";
import { DEFAULT_OVERALL_JOB_DEADLINE_MS } from "@/lib/jobs/queue";
import { activeTrackedProcessCount } from "@/lib/jobs/processControl";
import { getHostModelJobResourceGovernor } from "@/lib/runtime";
import { resolveJobDeadlinePolicy } from "@/lib/jobs/deadlinePolicy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PHI-free bounded worker snapshot for the internal Validation Center. It
 * exposes counts and policy state only; no study, document, patient, or job
 * identifiers cross this route.
 */
export async function GET(req: NextRequest) {
  const denied = await requireRole(req, ["ADMIN", "REVIEWER", "RESEARCHER"]);
  if (denied) return denied;

  const page = await listJobsPage({ limit: 100 });
  const jobs = page.items;
  const byStatus = Object.fromEntries(["queued", "running", "stale", "retryable", "completed", "failed", "cancelled"].map((status) => [status, jobs.filter((job) => job.status === status).length]));
  const running = jobs.filter((job) => job.status === "running");
  const deadlines = running.filter((job) => job.deadline_at && Date.parse(job.deadline_at) <= Date.now()).length;
  const governor = getHostModelJobResourceGovernor().snapshot();
  const deadlinePolicy = resolveJobDeadlinePolicy();
  const queued = jobs.filter((job) => job.status === "queued" || job.status === "retryable");
  const queuedAges = queued.map((job) => Math.max(0, Date.now() - Date.parse(job.created_at))).filter(Number.isFinite);
  const deadlineOutcomes = Object.fromEntries(["WITHIN_BUDGET", "QUEUE_TIMEOUT", "JOB_DEADLINE_EXCEEDED"].map((outcome) => [outcome, jobs.filter((job) => job.deadline_outcome === outcome).length]));

  return NextResponse.json({
    schema_version: "visionscan-operations-snapshot-v1",
    scope: "process_local",
    phi_included: false,
    queue: {
      sample_limit: 100,
      has_more: page.has_more,
      counts: byStatus,
      running_deadline_overdue: deadlines,
      active_processes: activeTrackedProcessCount(),
      oldest_queued_age_ms: queuedAges.length ? Math.max(...queuedAges) : 0,
      deadline_outcomes: deadlineOutcomes,
    },
    worker: {
      mode: isExternalWorkerMode() ? "external" : "in_process",
      max_jobs_per_poll: 1,
      crash_recovery: "lease_fencing_and_bounded_retry",
      termination: "centralized_windows_taskkill_tree_path",
    },
    resource_governor: governor,
    deadline: {
      default_ms: DEFAULT_OVERALL_JOB_DEADLINE_MS,
      source: "VISIONSCAN_OVERALL_JOB_DEADLINE_MS_or_bounded_default",
      enforced_from_claim: true,
      no_unbounded_jobs: true,
      policy: deadlinePolicy,
    },
  }, { headers: { "cache-control": "no-store" } });
}
