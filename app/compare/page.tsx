"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import ScanViewer from "@/components/ScanViewer";
import { Icon } from "@/components/icons";
import { Badge, EmptyState } from "@/components/ui";
import { authFetch } from "@/lib/auth/clientFetch";

interface StudyRow { study_id: string; created_at: string; modality: string; eye: string; status: string }
interface Bundle { study?: { study_id: string; modality: string; eye: string }; analysis?: { findings: Array<{ id: string; type: string; region?: { x: number; y: number; w: number; h: number } | null }> } }

function CompareInner() {
  const params = useSearchParams();
  const [rows, setRows] = useState<StudyRow[]>([]);
  const [previous, setPrevious] = useState(params.get("previous") ?? "");
  const [current, setCurrent] = useState(params.get("current") ?? "");
  const [prevBundle, setPrevBundle] = useState<Bundle | null>(null);
  const [curBundle, setCurBundle] = useState<Bundle | null>(null);
  const [sync, setSync] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [outcome, setOutcome] = useState<{ note: string; quantitative_comparison: string; finding_type_changes: Array<{ type: string; previous: number; current: number; direction: string }> } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/studies").then((r) => r.json()).then((j) => setRows(j.studies ?? [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (previous) fetch(`/api/studies/${previous}`).then((r) => r.json()).then(setPrevBundle).catch(() => setPrevBundle(null));
    else setPrevBundle(null);
  }, [previous]);
  useEffect(() => {
    if (current) fetch(`/api/studies/${current}`).then((r) => r.json()).then(setCurBundle).catch(() => setCurBundle(null));
    else setCurBundle(null);
  }, [current]);

  async function run() {
    setError(null);
    setOutcome(null);
    if (!previous || !current) { setError("Select both a previous and a current study."); return; }
    if (previous === current) { setError("Select two different studies."); return; }
    const res = await authFetch("/api/compare", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ previous, current }),
    });
    const json = await res.json();
    if (!res.ok) setError(json.error ?? "Comparison failed"); else setOutcome(json);
  }

  return (
    <div>
      <h1>Compare scans</h1>
      <p className="muted">Previous and current side by side. The platform compares what was actually detected — it never claims disease progression.</p>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="grid grid-2">
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="prev">Previous scan</label>
            <select id="prev" value={previous} onChange={(e) => setPrevious(e.target.value)}>
              <option value="">Select…</option>
              {rows.map((s) => <option key={s.study_id} value={s.study_id}>{new Date(s.created_at).toLocaleString()} — {s.modality} {s.eye}</option>)}
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="cur">Current scan</label>
            <select id="cur" value={current} onChange={(e) => setCurrent(e.target.value)}>
              <option value="">Select…</option>
              {rows.map((s) => <option key={s.study_id} value={s.study_id}>{new Date(s.created_at).toLocaleString()} — {s.modality} {s.eye}</option>)}
            </select>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 14 }}>
          <button className="btn" onClick={run}>Compare</button>
          <label className="small muted" style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
            <input type="checkbox" style={{ width: "auto" }} checked={sync} onChange={(e) => setSync(e.target.checked)} />
            Synchronized zoom
          </label>
        </div>
      </div>

      {error && <div className="alert danger" style={{ marginTop: 14 }}><span className="alert-icon" aria-hidden="true">⚠</span><div className="alert-body">{error}</div></div>}

      <div className="grid grid-2" style={{ marginTop: 16, alignItems: "start" }}>
        <div className="card">
          <div className="card-title"><h3>Previous scan</h3>{prevBundle?.study && <Badge tone="neutral">{prevBundle.study.modality} • {prevBundle.study.eye}</Badge>}</div>
          {prevBundle?.study ? (
            <ScanViewer
              src={`/api/studies/${encodeURIComponent(previous)}/image`}
              alt="Previous scan"
              zoom={sync ? zoom : undefined}
              onZoomChange={sync ? setZoom : undefined}
              infoOverlay={{ eye: prevBundle.study.eye, modality: prevBundle.study.modality }}
            />
          ) : <EmptyState icon={<Icon name="eye" size={22} />} title="Select a previous scan" />}
        </div>
        <div className="card">
          <div className="card-title"><h3>Current scan</h3>{curBundle?.study && <Badge tone="neutral">{curBundle.study.modality} • {curBundle.study.eye}</Badge>}</div>
          {curBundle?.study ? (
            <ScanViewer
              src={`/api/studies/${encodeURIComponent(current)}/image`}
              alt="Current scan"
              region={curBundle.analysis?.findings?.[0]?.region ?? null}
              zoom={sync ? zoom : undefined}
              onZoomChange={sync ? setZoom : undefined}
              infoOverlay={{ eye: curBundle.study.eye, modality: curBundle.study.modality }}
            />
          ) : <EmptyState icon={<Icon name="eye" size={22} />} title="Select a current scan" />}
        </div>
      </div>

      {outcome && (
        <>
          <div className="alert warn" style={{ marginTop: 16 }}>
            <span className="alert-icon" aria-hidden="true">⇄</span>
            <div className="alert-body"><strong>Comparison result</strong>{outcome.note}</div>
          </div>
          <div className="card" style={{ marginTop: 14 }}>
            <h3 style={{ marginTop: 0 }}>Detected finding types: previous → current</h3>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Finding type</th><th>Previous</th><th>Current</th><th>Change</th></tr></thead>
                <tbody>
                  {outcome.finding_type_changes.map((c) => (
                    <tr key={c.type}>
                      <td>{c.type.replaceAll("_", " ")}</td>
                      <td>{c.previous}</td>
                      <td>{c.current}</td>
                      <td>
                        {c.direction === "increased" ? <Badge tone="warn">increased</Badge> :
                         c.direction === "decreased" ? <Badge tone="info">decreased</Badge> :
                         <Badge tone="neutral">unchanged</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="tiny muted" style={{ marginBottom: 0 }}>
              A change in detected findings is not a statement about disease progression. Quantitative comparison:{" "}
              {outcome.quantitative_comparison}
            </p>
          </div>
        </>
      )}
    </div>
  );
}

export default function ComparePage() {
  return (
    <Suspense fallback={<div style={{ display: "flex", justifyContent: "center", padding: 60 }}><div className="spinner" /></div>}>
      <CompareInner />
    </Suspense>
  );
}
