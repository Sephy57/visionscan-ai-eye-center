import { describe, expect, it, beforeEach } from "vitest";
import { incrementMetric, observeMetricDuration, resetMetricsForTests, snapshotMetrics } from "@/lib/observability/metrics";

describe("PHI-safe operational metrics", () => {
  beforeEach(() => resetMetricsForTests());

  it("keeps only bounded allow-listed labels and never stores identifiers", () => {
    incrementMetric("security_events", { outcome: "rejected", stage: "authz" });
    incrementMetric("security_events", { outcome: "rejected", stage: "authz" });
    observeMetricDuration("jobs_completed", 42, { outcome: "ok", stage: "analysis" });
    const snapshot = snapshotMetrics();
    expect(snapshot).toHaveLength(2);
    expect(JSON.stringify(snapshot)).not.toMatch(/patient|study|document|mrn|alice/i);
    expect(snapshot.find((m) => m.name === "security_events")?.count).toBe(2);
    expect(snapshot.find((m) => m.name === "jobs_completed")?.duration_ms_max).toBe(42);
  });

  it("rejects invalid durations and counter amounts", () => {
    incrementMetric("job_failures", {}, -1);
    observeMetricDuration("jobs_completed", Number.NaN);
    expect(snapshotMetrics()).toEqual([]);
  });
});

