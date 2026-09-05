/**
 * Process-local, PHI-safe operational metrics.
 *
 * This is intentionally not a production telemetry backend. It provides a
 * bounded in-process snapshot for local operations and tests. Labels are
 * allow-listed and never contain patient, study, document, image, or free
 * text identifiers. A deployment must export equivalent counters to its
 * approved metrics system without sending PHI.
 */

export type MetricName =
  | "jobs_started"
  | "jobs_completed"
  | "job_failures"
  | "ocr_failures"
  | "model_failures"
  | "quality_rejects"
  | "ood_rejects"
  | "clinician_corrections"
  | "security_events";

export type MetricLabels = Readonly<{
  outcome?: "ok" | "error" | "rejected";
  stage?: "upload" | "ocr" | "extraction" | "analysis" | "report" | "authz";
  model_status?: "demo" | "research" | "unavailable" | "error";
}>;

type Counter = { count: number; duration_ms_total: number; duration_ms_max: number };
const counters = new Map<string, Counter>();

function key(name: MetricName, labels: MetricLabels = {}): string {
  return `${name}|${labels.outcome ?? ""}|${labels.stage ?? ""}|${labels.model_status ?? ""}`;
}

export function incrementMetric(name: MetricName, labels: MetricLabels = {}, amount = 1): void {
  if (!Number.isFinite(amount) || amount < 0) return;
  const k = key(name, labels);
  const current = counters.get(k) ?? { count: 0, duration_ms_total: 0, duration_ms_max: 0 };
  current.count += Math.min(amount, 1_000_000);
  counters.set(k, current);
}

export function observeMetricDuration(name: MetricName, durationMs: number, labels: MetricLabels = {}): void {
  if (!Number.isFinite(durationMs) || durationMs < 0) return;
  const k = key(name, labels);
  const current = counters.get(k) ?? { count: 0, duration_ms_total: 0, duration_ms_max: 0 };
  current.count += 1;
  current.duration_ms_total += Math.min(durationMs, 86_400_000);
  current.duration_ms_max = Math.max(current.duration_ms_max, Math.min(durationMs, 86_400_000));
  counters.set(k, current);
}

export function snapshotMetrics(): Array<{
  name: MetricName;
  labels: MetricLabels;
  count: number;
  duration_ms_total: number;
  duration_ms_max: number;
}> {
  return [...counters.entries()].map(([encoded, value]) => {
    const [, outcome, stage, model_status] = encoded.split("|");
    return {
      name: encoded.split("|", 1)[0] as MetricName,
      labels: {
        ...(outcome ? { outcome: outcome as MetricLabels["outcome"] } : {}),
        ...(stage ? { stage: stage as MetricLabels["stage"] } : {}),
        ...(model_status ? { model_status: model_status as MetricLabels["model_status"] } : {}),
      },
      ...value,
    };
  });
}

/** Test/process reset only; production code should never call this. */
export function resetMetricsForTests(): void {
  counters.clear();
}

