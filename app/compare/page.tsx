"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";

interface StudyRow { study_id: string; created_at: string; modality: string; status: string }

interface CompareOutcome {
  note: string;
  quantitative_comparison: string;
  finding_type_changes: Array<{ type: string; previous: number; current: number; direction: string }>;
}

function CompareInner() {
  const params = useSearchParams();
  const [rows, setRows] = useState<StudyRow[]>([]);
  const [previous, setPrevious] = useState(params.get("previous") ?? "");
  const [current, setCurrent] = useState(params.get("current") ?? "");
  const [outcome, setOutcome] = useState<CompareOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/studies").then((r) => r.json()).then((j) => setRows(j.studies ?? [])).catch(() => {});
  }, []);

  async function run() {
    setError(null);
    setOutcome(null);
    if (!previous || !current) { setError("Select both a previous and a current study."); return; }
    if (previous === current) { setError("Select two different studies."); return; }
    const res = await fetch("/api/compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ previous, current }),
    });
    const json = await res.json();
    if (!res.ok) setError(json.error ?? "Comparison failed");
    else setOutcome(json);
  }

  return (
    <div>
      <h1>Historical comparison</h1>
      <p className="muted">
        Compare a previous scan with the current one. The platform compares what was actually detected; it never
        claims disease progression.
      </p>

      <div className="panel">
        <div className="grid-2">
          <div className="field">
            <label htmlFor="prev">Previous scan</label>
            <select id="prev" value={previous} onChange={(e) => setPrevious(e.target.value)}>
              <option value="">Select…</option>
              {rows.map((s) => <option key={s.study_id} value={s.study_id}>{new Date(s.created_at).toLocaleString()} — {s.study_id}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="cur">Current scan</label>
            <select id="cur" value={current} onChange={(e) => setCurrent(e.target.value)}>
              <option value="">Select…</option>
              {rows.map((s) => <option key={s.study_id} value={s.study_id}>{new Date(s.created_at).toLocaleString()} — {s.study_id}</option>)}
            </select>
          </div>
        </div>
        <button className="btn" onClick={run}>Compare</button>
      </div>

      {error && <div className="callout danger">{error}</div>}

      {outcome && (
        <>
          <div className="callout warn">
            {outcome.note}
          </div>
          <div className="panel">
            <h3 style={{ marginTop: 0 }}>Detected finding types: Previous → Current</h3>
            <table className="table">
              <thead><tr><th>Finding type</th><th>Previous</th><th>Current</th><th>Change</th></tr></thead>
              <tbody>
                {outcome.finding_type_changes.map((c) => (
                  <tr key={c.type}>
                    <td>{c.type.replaceAll("_", " ")}</td>
                    <td>{c.previous}</td>
                    <td>{c.current}</td>
                    <td>
                      {c.direction === "increased" ? <span className="badge warn">increased</span> :
                       c.direction === "decreased" ? <span className="badge info">decreased</span> :
                       <span className="badge neutral">unchanged</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="small muted">
              A change in detected findings is not a statement about disease progression or improvement. Interpretation
              requires a qualified professional and validated quantitative algorithms.
            </p>
          </div>
          <div className="panel">
            <h3 style={{ marginTop: 0 }}>Quantitative comparison</h3>
            <p className="small muted">{outcome.quantitative_comparison}</p>
          </div>
        </>
      )}
    </div>
  );
}

export default function ComparePage() {
  return (
    <Suspense fallback={<div className="spinner" />}>
      <CompareInner />
    </Suspense>
  );
}
