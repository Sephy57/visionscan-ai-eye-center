"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge, EmptyState } from "@/components/ui";

interface StudyRow {
  study_id: string; created_at: string; modality: string; eye: string; status: string; sha256: string;
}

export default function HistoryPage() {
  const [rows, setRows] = useState<StudyRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/studies");
    const json = await res.json();
    setRows(json.studies ?? []);
  }
  useEffect(() => { load().catch(() => setError("Could not load studies.")); }, []);

  async function remove(id: string) {
    if (!confirm(`Delete study ${id}, its analysis, report, and stored original image? This cannot be undone.`)) return;
    const res = await fetch(`/api/studies/${id}`, { method: "DELETE" });
    if (res.ok) load(); else setError("Delete failed");
  }

  const grouped = new Map<string, StudyRow[]>();
  for (const r of rows ?? []) {
    const day = new Date(r.created_at).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
    if (!grouped.has(day)) grouped.set(day, []);
    grouped.get(day)!.push(r);
  }

  return (
    <div style={{ maxWidth: 820, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div>
          <h1 style={{ marginBottom: 2 }}>History</h1>
          <p className="muted small" style={{ margin: 0 }}>All studies stored locally on D:. Originals preserved unchanged; analyses auditable.</p>
        </div>
        <Link className="btn" href="/analyze">＋ New Analysis</Link>
      </div>

      {error && <div className="alert danger" style={{ marginTop: 14 }}><span className="alert-icon" aria-hidden="true">⚠</span><div className="alert-body">{error}</div></div>}

      {!rows && <div style={{ display: "flex", justifyContent: "center", padding: 60 }}><div className="spinner" /></div>}

      {rows?.length === 0 && (
        <div style={{ marginTop: 24 }}>
          <EmptyState icon="◉" title="No scans yet"
            action={<Link className="btn" href="/analyze">Start Analysis</Link>}>
            Upload your first ophthalmic image to begin analysis and build a reviewable history.
          </EmptyState>
        </div>
      )}

      {rows && rows.length > 0 && (
        <div className="timeline" style={{ marginTop: 24 }}>
          {[...grouped.entries()].map(([day, items]) => (
            <div key={day}>
              <div className="timeline-item" style={{ paddingBottom: 6 }}>
                <div className="tl-date">{day}</div>
              </div>
              {items.map((s) => (
                <div key={s.study_id} className="timeline-item">
                  <div className="card hover" style={{ padding: 16 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                      <span aria-hidden="true" style={{ width: 38, height: 38, borderRadius: 10, background: "var(--accent-soft)", color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center" }}>◉</span>
                      <div style={{ flex: 1, minWidth: 180 }}>
                        <strong className="small" style={{ display: "block" }}>{s.modality} • {s.eye}</strong>
                        <span className="tiny muted">{new Date(s.created_at).toLocaleTimeString()} • <code>{s.study_id.slice(0, 20)}…</code></span>
                      </div>
                      {s.status === "analyzed" ? <Badge tone="info">Analysis complete</Badge>
                        : s.status === "rejected" ? <Badge tone="bad">Quality rejected</Badge>
                        : <Badge tone="neutral">Uploaded</Badge>}
                    </div>
                    <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
                      <Link className="btn secondary sm" href={`/result?study=${s.study_id}`}>Result</Link>
                      <Link className="btn secondary sm" href={`/report?study=${s.study_id}`}>Report</Link>
                      <Link className="btn secondary sm" href={`/compare?current=${s.study_id}`}>Compare</Link>
                      <button className="btn ghost sm" style={{ color: "var(--danger)" }} onClick={() => remove(s.study_id)}>Delete</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      <p className="tiny muted" style={{ marginTop: 10 }}>
        A change between scans does not automatically mean disease progression. Interpretation requires a
        qualified professional and validated quantitative algorithms.
      </p>
    </div>
  );
}
