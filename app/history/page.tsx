"use client";

import { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Badge, EmptyState } from "@/components/ui";
import { Icon } from "@/components/icons";
import { authFetch } from "@/lib/auth/clientFetch";
import { DASHBOARD_STATUS_META as STATUS_META } from "@/lib/reports/terminology";

interface StudyRow {
  study_id: string; created_at: string; modality: string; eye: string; status: string;
  dashboard_status?: string;
}

const FILTER_TO_STATUS: Record<string, string> = {
  urgent: "URGENT_REVIEW",
  correlation: "CLINICAL_CORRELATION_REQUIRED",
  review: "REVIEW_REQUIRED",
  "model-failed": "MODEL_FAILED",
  unsupported: "UNSUPPORTED_MODALITY",
  "quality-blocked": "IMAGE_NOT_SUITABLE",
  "out-of-distribution": "OUT_OF_DISTRIBUTION",
};

export default function HistoryPage() {
  return (
    <Suspense fallback={<div role="status" aria-live="polite" style={{ display: "flex", justifyContent: "center", padding: 50 }}><div className="spinner" /><span className="sr-only">Loading history…</span></div>}>
      <HistoryInner />
    </Suspense>
  );
}

function HistoryInner() {
  const [rows, setRows] = useState<StudyRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const filter = searchParams.get("filter");
  const filterStatus = filter ? FILTER_TO_STATUS[filter] : undefined;

  async function load() {
    const res = await fetch("/api/studies?with_status=1");
    const json = await res.json();
    setRows(json.studies ?? []);
    setLoaded(true);
  }
  useEffect(() => { load().catch(() => { setError("Could not load studies."); setLoaded(true); }); }, []);

  const visibleRows = filterStatus ? rows.filter((r) => r.dashboard_status === filterStatus) : rows;

  async function remove(id: string) {
    if (!confirm(`Delete study ${id}, its analysis, report, and stored original image? This cannot be undone.`)) return;
    const res = await authFetch(`/api/studies/${id}`, { method: "DELETE" });
    if (res.ok) load(); else setError("Delete failed");
  }

  const statusBadge = (status?: string) => {
    const meta = status ? STATUS_META[status] : undefined;
    return <Badge tone={meta?.tone ?? "neutral"}>{meta?.label ?? "Uploaded"}</Badge>;
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div>
          <h1 style={{ marginBottom: 2 }}>History</h1>
          <p className="muted small" style={{ margin: 0 }}>All studies stored locally on D:. Originals preserved unchanged; analyses auditable.</p>
        </div>
        <Link className="btn" href="/analyze"><Icon name="plus" size={14} /> New Analysis</Link>
      </div>

      {filterStatus && (
        <p className="small" style={{ margin: "10px 0 0" }}>
          Filtered: <strong>{STATUS_META[filterStatus]?.label ?? filter}</strong> ({visibleRows.length}){" "}
          <Link href="/history">Clear filter</Link>
        </p>
      )}

      {error && <div className="alert danger" role="alert" style={{ marginTop: 14 }}><span className="alert-icon" aria-hidden="true">⚠</span><div className="alert-body">{error}</div></div>}

      {!loaded && <div role="status" aria-live="polite" style={{ display: "flex", justifyContent: "center", padding: 50 }}><div className="spinner" /><span className="sr-only">Loading studies…</span></div>}

      {loaded && visibleRows.length === 0 && (
        <div style={{ marginTop: 20 }}>
          <EmptyState icon={<Icon name="eye" size={26} />} title={filterStatus ? "No studies match this filter" : "No analyses yet"}
            action={<Link className="btn" href="/analyze">+ New Analysis</Link>}>
            {filterStatus
              ? "No studies currently have this status."
              : "Start a new ophthalmic imaging analysis to begin building a reviewable history."}
          </EmptyState>
        </div>
      )}

      {loaded && visibleRows.length > 0 && (
        <div className="card" style={{ marginTop: 18, padding: "4px 14px" }}>
          <div className="table-wrap" tabIndex={0}>
            <table className="table">
              <thead>
                <tr><th scope="col">Date</th><th scope="col">Study</th><th scope="col">Eye</th><th scope="col">Modality</th><th scope="col">Status</th><th scope="col" style={{ textAlign: "right" }}>Actions</th></tr>
              </thead>
              <tbody>
                {visibleRows.map((s) => (
                  <tr key={s.study_id}>
                    <td className="small">{new Date(s.created_at).toLocaleDateString()}</td>
                    <td><code className="tiny">{s.study_id.slice(0, 16)}…</code></td>
                    <td>{s.eye}</td>
                    <td>{s.modality}</td>
                    <td>{statusBadge(s.dashboard_status)}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <Link className="btn ghost sm" href={`/result?study=${s.study_id}`}>Result</Link>{" "}
                      <Link className="btn ghost sm" href={`/report?study=${s.study_id}`}>Report</Link>{" "}
                      <Link className="btn ghost sm" href={`/compare?current=${s.study_id}`}>Compare</Link>{" "}
                      <button className="btn ghost sm" style={{ color: "var(--danger)" }} onClick={() => remove(s.study_id)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <p className="tiny muted" style={{ marginTop: 10 }}>
        A change between scans does not automatically mean disease progression. Interpretation requires a
        qualified professional and validated quantitative algorithms.
      </p>
    </div>
  );
}
