"use client";

import { useEffect, useState } from "react";
import { Badge, EmptyState, PageHeader, PageLoading } from "@/components/ui";
import { Icon } from "@/components/icons";

interface Run {
  run_id: string; model_id: string; model_version: string;
  split: string; cases: number;
  patient_count: number | null; device_count: number | null; modality: string | null;
  metrics: {
    sensitivity: number | null; specificity: number | null; ppv: number | null;
    npv: number | null; auroc: number | null; auprc: number | null; ece: number | null;
  };
  errors: {
    false_negatives: number; false_positives: number;
    missed_urgent_cases: number;
    quality_blocked: number; out_of_distribution: number;
    urgent_fn_rate: number | null;
  };
  created_at: string;
}

const pct = (x: number | null) => (x === null ? "—" : (x * 100).toFixed(1) + "%");

export default function EvaluationsPage() {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    fetch("/api/evaluations")
      .then((r) => { if (!r.ok) { setDenied(true); return { runs: [] }; } return r.json(); })
      .then((j) => setRuns(j.runs ?? []))
      .catch(() => { setDenied(true); setRuns([]); });
  }, []);

  return (
    <div>
      <PageHeader eyebrow="AI & Research" title="Model Evaluation" lede={<>Per-split research metrics with failure analysis. <strong>No single &ldquo;AI accuracy&rdquo; score is reported</strong> — performance is always broken out per split and metric, with false-negative analysis. Research metrics are not clinical validation.</>} />

      {!runs && <PageLoading label="Loading evaluation runs…" />}

      {denied && (
        <div className="alert danger" role="alert"><span className="alert-icon" aria-hidden="true"><Icon name="lock" size={16} /></span>
          <div className="alert-body"><strong>Evaluation runs unavailable</strong>This view is restricted to ADMIN and RESEARCHER roles, or the evaluation service did not respond.</div></div>
      )}

      {!denied && runs?.length === 0 && (
        <div style={{ marginTop: 18 }}>
          <EmptyState icon={<Icon name="status" size={24} />} title="No evaluation runs yet">
            Evaluation runs are created from locked or external test datasets via{" "}
            <code>POST /api/evaluations</code>. Runs on patient-level-separated data can then be registered as
            evidence for model status transitions. The research API is ready; no evaluations have been performed
            because no real model is installed.
          </EmptyState>
        </div>
      )}

      {(runs ?? []).map((r) => (
        <div className="card" key={r.run_id} style={{ marginTop: 14 }}>
          <div className="card-title">
            <div>
              <h3 style={{ marginBottom: 1 }}>{r.model_id} <span className="tiny muted">v{r.model_version}</span></h3>
              <span className="tiny muted">{r.run_id} · {new Date(r.created_at).toLocaleString()}</span>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <Badge tone="info">{r.split.replaceAll("_", " ")}</Badge>
              <Badge tone="neutral">{r.cases} cases</Badge>
              {r.patient_count !== null && <Badge tone="neutral">{r.patient_count} patients</Badge>}
              {r.device_count !== null && <Badge tone="neutral">{r.device_count} devices</Badge>}
            </div>
          </div>
          <div className="grid grid-4">
            {[
              ["Sensitivity", pct(r.metrics.sensitivity)], ["Specificity", pct(r.metrics.specificity)],
              ["PPV", pct(r.metrics.ppv)], ["NPV", pct(r.metrics.npv)],
              ["AUROC", r.metrics.auroc?.toFixed(3) ?? "—"], ["AUPRC", r.metrics.auprc?.toFixed(3) ?? "—"],
              ["Calibration (ECE)", r.metrics.ece?.toFixed(3) ?? "—"],
              ["False negatives", String(r.errors.false_negatives)],
            ].map(([label, value]) => (
              <div key={label} className="stat-card">
                <span className="stat-label">{label}</span>
                <span className="stat-value" style={{ fontSize: "0.98rem" }}>{value}</span>
              </div>
            ))}
          </div>

          <div className="divider" style={{ margin: "12px 0" }} />
          <div className="grid grid-2">
            <div>
              <div className="stat-label" style={{ marginBottom: 6 }}>Safety signals</div>
              <dl className="kv tiny" style={{ gridTemplateColumns: "175px 1fr" }}>
                <dt>Missed urgent cases</dt>
                <dd style={{ color: r.errors.missed_urgent_cases > 0 ? "var(--danger)" : "var(--ok)", fontWeight: 650 }}>
                  {r.errors.missed_urgent_cases}
                </dd>
                <dt>Urgent FN rate</dt>
                <dd>{r.errors.urgent_fn_rate === null ? "—" : pct(r.errors.urgent_fn_rate)}</dd>
                <dt>Quality blocked</dt><dd>{r.errors.quality_blocked}</dd>
                <dt>OOD rejections</dt><dd>{r.errors.out_of_distribution}</dd>
              </dl>
            </div>
            <div><div className="stat-label" style={{ marginBottom: 6 }}>Privacy boundary</div><p className="tiny muted" style={{ margin: 0 }}>Aggregate metrics only. Case identifiers, patient identifiers, dataset references, subgroup labels, and free text are withheld.</p></div>
          </div>
        </div>
      ))}
    </div>
  );
}
