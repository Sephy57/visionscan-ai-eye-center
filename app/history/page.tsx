"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge, EmptyState } from "@/components/ui";
import { Icon } from "@/components/icons";

interface StudyRow {
  study_id: string; created_at: string; modality: string; eye: string; status: string; sha256: string;
}
interface ReportLite {
  review: { status: string };
  triage_priority: string;
}

export default function HistoryPage() {
  const [rows, setRows] = useState<Array<StudyRow & { review?: string }>>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/studies");
    const json = await res.json();
    const studies: StudyRow[] = json.studies ?? [];
    // Attach review status from reports (light fetch per study; dev scale only).
    const withReview = await Promise.all(studies.map(async (s) => {
      try {
        const r = await fetch(`/api/studies/${s.study_id}`);
        const j = await r.json();
        return { ...s, review: j.report?.review?.status ?? undefined };
      } catch { return { ...s }; }
    }));
    setRows(withReview);
    setLoaded(true);
  }
  useEffect(() => { load().catch(() => { setError("Could not load studies."); setLoaded(true); }); }, []);

  async function remove(id: string) {
    if (!confirm(`Delete study ${id}, its analysis, report, and stored original image? This cannot be undone.`)) return;
    const res = await fetch(`/api/studies/${id}`, { method: "DELETE" });
    if (res.ok) load(); else setError("Delete failed");
  }

  function reviewBadge(review?: string) {
    switch (review) {
      case "clinician_finalized": return <Badge tone="ok">Finalized</Badge>;
      case "clinician_reviewed": return <Badge tone="info">Reviewed</Badge>;
      default: return <Badge tone="neutral">Research</Badge>;
    }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div>
          <h1 style={{ marginBottom: 2 }}>History</h1>
          <p className="muted small" style={{ margin: 0 }}>All studies stored locally on D:. Originals preserved unchanged; analyses auditable.</p>
        </div>
        <Link className="btn" href="/analyze"><Icon name="plus" size={14} /> New Analysis</Link>
      </div>

      {error && <div className="alert danger" style={{ marginTop: 14 }}><span className="alert-icon" aria-hidden="true">⚠</span><div className="alert-body">{error}</div></div>}

      {!loaded && <div style={{ display: "flex", justifyContent: "center", padding: 50 }}><div className="spinner" /></div>}

      {loaded && rows.length === 0 && (
        <div style={{ marginTop: 20 }}>
          <EmptyState icon={<Icon name="eye" size={26} />} title="No analyses yet"
            action={<Link className="btn" href="/analyze">+ New Analysis</Link>}>
            Start a new ophthalmic imaging analysis to begin building a reviewable history.
          </EmptyState>
        </div>
      )}

      {loaded && rows.length > 0 && (
        <div className="card" style={{ marginTop: 18, padding: "4px 14px" }}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Date</th><th>Study</th><th>Eye</th><th>Modality</th><th>Status</th><th>Review</th><th style={{ textAlign: "right" }}>Actions</th></tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.study_id}>
                    <td className="small">{new Date(s.created_at).toLocaleDateString()}</td>
                    <td><code className="tiny">{s.study_id.slice(0, 16)}…</code></td>
                    <td>{s.eye}</td>
                    <td>{s.modality}</td>
                    <td>
                      {s.status === "analyzed" ? <Badge tone="info">Analyzed</Badge>
                        : s.status === "rejected" ? <Badge tone="bad">Quality rejected</Badge>
                        : <Badge tone="neutral">Uploaded</Badge>}
                    </td>
                    <td>{reviewBadge(s.review)}</td>
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
