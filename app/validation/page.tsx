"use client";

import { useEffect, useState } from "react";
import { Badge, EmptyState } from "@/components/ui";
import { Icon } from "@/components/icons";

interface Run {
  run_id: string;
  model_id: string;
  model_version: string;
  split: string;
  cases: number;
  patient_count: number | null;
  device_count: number | null;
  modality: string | null;
  metrics: { sensitivity: number | null; specificity: number | null; auroc: number | null; auprc: number | null; ece: number | null };
  errors: { false_negatives: number; false_positives: number; missed_urgent_cases: number; quality_blocked: number; out_of_distribution: number; urgent_fn_rate: number | null };
  created_at: string;
}

interface Dashboard {
  phi_included: boolean;
  notice: string;
  runs: Run[];
  totals: { cases: number; false_negatives: number; false_positives: number; missed_urgent_cases: number; quality_blocked: number; out_of_distribution: number };
}

interface RegistryError {
  error_id: string;
  model_id: string;
  model_version: string;
  category: string;
  status: string;
  lifecycle?: string;
  severity?: string;
  modality?: string;
  laterality?: string;
  observed_at: string;
}

const pct = (value: number | null) => value === null ? "—" : (value * 100).toFixed(1) + "%";

export default function ValidationPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [registryErrors, setRegistryErrors] = useState<RegistryError[]>([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/validation/dashboard"),
      fetch("/api/validation/errors"),
    ]).then(async ([dashboardResponse, errorsResponse]) => {
      if (!dashboardResponse.ok) throw new Error("validation access denied");
      const dashboard = await dashboardResponse.json() as Dashboard;
      if (errorsResponse.ok) {
        const registry = await errorsResponse.json() as { errors?: RegistryError[] };
        setRegistryErrors(registry.errors ?? []);
      }
      setData(dashboard);
    }).catch(() => setError(true));
  }, []);

  return (
    <div>
      <div className="stat-label">ADMIN / RESEARCH validation</div>
      <h1 style={{ marginBottom: 2 }}>Validation evidence</h1>
      <p className="muted small">Aggregate research checks and error signals. This view never presents a clinical validation claim.</p>

      {error && <div className="alert danger" role="alert"><span className="alert-icon" aria-hidden="true">⚠</span><div className="alert-body">Validation evidence is unavailable or your role is not permitted.</div></div>}
      {!data && !error && <div role="status" aria-live="polite" style={{ display: "flex", justifyContent: "center", padding: 50 }}><div className="spinner" /><span className="sr-only">Loading validation evidence…</span></div>}
      {data && (
        <>
          <div className="alert info" style={{ marginTop: 14 }}>
            <span className="alert-icon" aria-hidden="true">◈</span>
            <div className="alert-body"><strong>Aggregate-only privacy boundary</strong><br />{data.notice}</div>
          </div>
          <div className="grid grid-4" style={{ marginTop: 14 }}>
            <div className="card stat-card"><span className="stat-label">Cases evaluated</span><span className="stat-value">{data.totals.cases}</span><span className="stat-detail">No case identifiers shown</span></div>
            <div className="card stat-card"><span className="stat-label">False negatives</span><span className="stat-value">{data.totals.false_negatives}</span><span className="stat-detail">Urgent misses: {data.totals.missed_urgent_cases}</span></div>
            <div className="card stat-card"><span className="stat-label">Quality blocked</span><span className="stat-value">{data.totals.quality_blocked}</span><span className="stat-detail">Input gate failures</span></div>
            <div className="card stat-card"><span className="stat-label">OOD rejections</span><span className="stat-value">{data.totals.out_of_distribution}</span><span className="stat-detail">Outside model conditions</span></div>
          </div>

          {data.runs.length === 0 ? (
            <div style={{ marginTop: 18 }}><EmptyState icon={<Icon name="status" size={24} />} title="No evaluation runs yet">Create a locked or external research evaluation before interpreting these metrics.</EmptyState></div>
          ) : (
            <div style={{ display: "grid", gap: 14, marginTop: 18 }}>
              {data.runs.map((run) => (
                <div className="card" key={run.run_id}>
                  <div className="card-title">
                    <div><h3 style={{ marginBottom: 1 }}>{run.model_id} <span className="tiny muted">v{run.model_version}</span></h3><span className="tiny muted">{run.split.replaceAll("_", " ")} · {new Date(run.created_at).toLocaleString()}</span></div>
                    <Badge tone="info">{run.cases} cases</Badge>
                  </div>
                  <div className="grid grid-4">
                    {[["Sensitivity", pct(run.metrics.sensitivity)], ["Specificity", pct(run.metrics.specificity)], ["AUROC", run.metrics.auroc?.toFixed(3) ?? "—"], ["ECE", run.metrics.ece?.toFixed(3) ?? "—"]].map(([label, value]) => <div className="stat-card" key={label}><span className="stat-label">{label}</span><span className="stat-value" style={{ fontSize: "0.98rem" }}>{value}</span></div>)}
                  </div>
                  <div className="divider" style={{ margin: "12px 0" }} />
                  <dl className="kv tiny" style={{ gridTemplateColumns: "180px 1fr", marginBottom: 0 }}>
                    <dt>False positives / negatives</dt><dd>{run.errors.false_positives} / {run.errors.false_negatives}</dd>
                    <dt>Urgent false negatives</dt><dd>{run.errors.missed_urgent_cases} {run.errors.urgent_fn_rate === null ? "" : "(" + pct(run.errors.urgent_fn_rate) + ")"}</dd>
                    <dt>Quality / OOD blocks</dt><dd>{run.errors.quality_blocked} / {run.errors.out_of_distribution}</dd>
                  </dl>
                </div>
              ))}
            </div>
          )}
          <section className="card" style={{ marginTop: 18 }} aria-labelledby="validation-error-registry-title">
            <div className="card-title">
              <div><h2 id="validation-error-registry-title" style={{ marginBottom: 2 }}>Known model-error registry</h2><span className="tiny muted">Synthetic cases only; no raw output or patient data.</span></div>
              <Badge tone={registryErrors.length ? "warn" : "ok"}>{registryErrors.length} tracked</Badge>
            </div>
            {registryErrors.length === 0 ? <p className="small muted" style={{ marginBottom: 0 }}>No registered validation errors yet.</p> : (
              <div style={{ display: "grid", gap: 8 }}>
                {registryErrors.slice(0, 20).map((entry) => (
                  <div key={entry.error_id} className="card" style={{ padding: 10 }}>
                    <div className="card-title" style={{ marginBottom: 4 }}><strong>{entry.category.replaceAll("_", " ")}</strong><Badge tone={entry.lifecycle === "REGRESSION_PROTECTED" ? "ok" : "warn"}>{entry.lifecycle ?? entry.status}</Badge></div>
                    <span className="tiny muted">{entry.model_id} v{entry.model_version} · {entry.modality ?? "unknown modality"} · {entry.laterality ?? "unknown eye"} · severity {entry.severity ?? "unknown"}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
          <p className="tiny muted" style={{ marginTop: 12 }}>Research evidence is fallible and uncalibrated unless explicitly documented. No finding, absence of a finding, or aggregate score establishes normality or clinical safety.</p>
        </>
      )}
    </div>
  );
}
