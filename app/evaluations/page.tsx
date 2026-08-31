"use client";

import { useEffect, useState } from "react";
import { Badge, EmptyState } from "@/components/ui";
import { Icon } from "@/components/icons";

interface Run {
  run_id: string; model_id: string; model_version: string;
  dataset_ref: string; split: string; cases: number;
  patient_count: number | null; device_count: number | null; modality: string | null;
  metrics: {
    sensitivity: number | null; specificity: number | null; ppv: number | null;
    npv: number | null; auroc: number | null; auprc: number | null; ece: number | null;
  };
  failure_analysis: {
    false_negatives: number; false_positives: number;
    missed_urgent_cases: unknown[];
    fn_by_urgent_vs_non_urgent: { fn_urgent: number; urgent_total: number; urgent_fn_rate: number | null };
    quality_failures: number; ood_failures: number;
  };
  symptom_stratified: {
    with_symptoms: { sensitivity: number | null; auroc: number | null } | null;
    without_symptoms: { sensitivity: number | null; auroc: number | null } | null;
    delta_notes: string[];
    warning: string;
  } | null;
  created_at: string;
}

const pct = (x: number | null) => (x === null ? "—" : (x * 100).toFixed(1) + "%");

export default function EvaluationsPage() {
  const [runs, setRuns] = useState<Run[] | null>(null);

  useEffect(() => {
    fetch("/api/evaluations").then((r) => r.json()).then((j) => setRuns(j.runs ?? [])).catch(() => setRuns([]));
  }, []);

  return (
    <div>
      <div className="stat-label">Research evaluation dashboard</div>
      <h1 style={{ marginBottom: 2 }}>Model Evaluation</h1>
      <p className="muted small">
        Per-split metrics with failure analysis. <strong>No single &ldquo;AI accuracy&rdquo; score is reported</strong> —
        performance is always broken out per split, per metric, per subgroup, with false-negative analysis.
      </p>

      {!runs && <div style={{ display: "flex", justifyContent: "center", padding: 50 }}><div className="spinner" /></div>}

      {runs?.length === 0 && (
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
              ["False negatives", String(r.failure_analysis.false_negatives)],
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
                <dd style={{ color: r.failure_analysis.missed_urgent_cases.length > 0 ? "var(--danger)" : "var(--ok)", fontWeight: 650 }}>
                  {r.failure_analysis.missed_urgent_cases.length}
                </dd>
                <dt>Urgent FN rate</dt>
                <dd>{r.failure_analysis.fn_by_urgent_vs_non_urgent.urgent_fn_rate === null ? "—" : pct(r.failure_analysis.fn_by_urgent_vs_non_urgent.urgent_fn_rate)}</dd>
                <dt>Quality failures</dt><dd>{r.failure_analysis.quality_failures}</dd>
                <dt>OOD failures</dt><dd>{r.failure_analysis.ood_failures}</dd>
              </dl>
            </div>
            <div>
              <div className="stat-label" style={{ marginBottom: 6 }}>Symptom-stratified (image only vs image + symptoms)</div>
              {r.symptom_stratified ? (
                <>
                  <dl className="kv tiny" style={{ gridTemplateColumns: "145px 1fr" }}>
                    <dt>Sensitivity (with)</dt><dd>{pct(r.symptom_stratified.with_symptoms?.sensitivity ?? null)}</dd>
                    <dt>Sensitivity (without)</dt><dd>{pct(r.symptom_stratified.without_symptoms?.sensitivity ?? null)}</dd>
                    <dt>AUROC (with)</dt><dd>{r.symptom_stratified.with_symptoms?.auroc?.toFixed(3) ?? "—"}</dd>
                    <dt>AUROC (without)</dt><dd>{r.symptom_stratified.without_symptoms?.auroc?.toFixed(3) ?? "—"}</dd>
                  </dl>
                  <p className="tiny muted" style={{ marginBottom: 0 }}>{r.symptom_stratified.warning}</p>
                </>
              ) : (
                <p className="tiny muted" style={{ margin: 0 }}>Cases carried no symptom-context metadata; stratified comparison unavailable.</p>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
