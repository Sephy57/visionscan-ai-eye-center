"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

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

  useEffect(() => { load().catch((e) => setError(String(e))); }, []);

  async function remove(id: string) {
    if (!confirm(`Delete study ${id}, its analysis, report, and stored original image? This cannot be undone.`)) return;
    const res = await fetch(`/api/studies/${id}`, { method: "DELETE" });
    if (res.ok) load();
    else setError("Delete failed");
  }

  return (
    <div>
      <h1>Scan history</h1>
      <p className="muted">All studies stored locally on drive D:. Originals are preserved unchanged; analyses are auditable.</p>
      {error && <div className="callout danger">{error}</div>}
      {!rows && <div className="spinner" />}
      {rows?.length === 0 && (
        <div className="panel">
          <p className="muted">No studies yet.</p>
          <Link className="btn" href="/analyze">Analyze your first scan</Link>
        </div>
      )}
      {rows && rows.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Study</th><th>Date</th><th>Modality</th><th>Eye</th><th>Status</th><th>SHA-256 (first 12)</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.study_id}>
                <td><code>{s.study_id}</code></td>
                <td>{new Date(s.created_at).toLocaleString()}</td>
                <td>{s.modality}</td>
                <td>{s.eye}</td>
                <td>
                  {s.status === "analyzed" ? <span className="badge info">analyzed</span> :
                   s.status === "rejected" ? <span className="badge bad">quality rejected</span> :
                   <span className="badge neutral">uploaded</span>}
                </td>
                <td className="small muted">{s.sha256.slice(0, 12)}…</td>
                <td>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <Link className="btn secondary" style={{ padding: "4px 10px" }} href={`/result?study=${s.study_id}`}>Result</Link>
                    <Link className="btn secondary" style={{ padding: "4px 10px" }} href={`/report?study=${s.study_id}`}>Report</Link>
                    <button className="btn danger" style={{ padding: "4px 10px" }} onClick={() => remove(s.study_id)}>Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
