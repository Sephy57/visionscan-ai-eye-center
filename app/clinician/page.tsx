"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";

interface Finding {
  id: string; type: string; location: string; severity: string;
  confidence: number; confidence_category: string; explanation: string; synthetic: boolean;
}
interface Bundle {
  study?: { study_id: string; modality: string; eye: string; status: string };
  analysis?: { findings: Finding[]; quality: { acceptable: boolean; status: string; score: number } };
  report?: { report_id: string; review: { status: string; reviewer_id?: string; finalized_at?: string } };
}

function ClinicianInner() {
  const params = useSearchParams();
  const [studyId, setStudyId] = useState(params.get("study") ?? "");
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [reviewer, setReviewer] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load(id: string) {
    setErr(null);
    setMsg(null);
    const res = await fetch(`/api/studies/${encodeURIComponent(id)}`);
    const json = await res.json();
    if (!res.ok) { setErr(json.error ?? "Not found"); setBundle(null); }
    else setBundle(json);
  }

  useEffect(() => { if (studyId) load(studyId); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(action: string, findingId?: string, correction?: Record<string, string>) {
    const res = await fetch(`/api/review/${encodeURIComponent(studyId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewer_id: reviewer || "anonymous-reviewer", action, finding_id: findingId, correction, note }),
    });
    const json = await res.json();
    if (!res.ok) setErr(json.error ?? "Review action failed");
    else {
      setMsg(`Action "${action}" recorded. Every AI result, clinician modification, and the final result are stored for audit.`);
      if (note) setNote("");
      load(studyId);
    }
  }

  return (
    <div>
      <h1>Clinician review interface</h1>
      <p className="muted">
        Human-in-the-loop review: open findings, accept or reject AI findings, add corrections and notes, and
        finalize the report. The system stores the AI result, clinician modifications, and the final result separately
        for continuous validation and auditing.
      </p>

      <div className="panel">
        <div className="grid-2">
          <div className="field">
            <label htmlFor="studyId">Study ID</label>
            <input id="studyId" value={studyId} onChange={(e) => setStudyId(e.target.value)} placeholder="study_..." />
          </div>
          <div className="field">
            <label htmlFor="reviewer">Reviewer ID (pseudonymous; no signatures are fabricated)</label>
            <input id="reviewer" value={reviewer} onChange={(e) => setReviewer(e.target.value)} placeholder="e.g. dr-ops-001" />
          </div>
        </div>
        <button className="btn" onClick={() => load(studyId)} disabled={!studyId}>Open study</button>
      </div>

      {err && <div className="callout danger">{err}</div>}
      {msg && <div className="callout ok">{msg}</div>}

      {bundle?.analysis && (
        <>
          <div className="panel">
            <h2 style={{ marginTop: 0 }}>Study {bundle.study?.study_id}</h2>
            <p className="small muted">
              Modality: {bundle.study?.modality} &middot; Eye: {bundle.study?.eye} &middot; Quality:{" "}
              {bundle.analysis.quality.status} ({bundle.analysis.quality.score}) &middot; Review status:{" "}
              {bundle.report?.review.status}
            </p>
            <p className="small muted">
              The original scan is preserved unchanged on D:. Reviewers should open the original file locally for
              side-by-side inspection; in-image overlay rendering (heatmaps, masks) requires the segmentation
              component, which is an integration placeholder. Any future heatmap will be labeled
              &ldquo;AI-highlighted region&rdquo; and is never proof of a diagnosis.
            </p>
          </div>

          {bundle.analysis.findings.length === 0 && <div className="panel muted">No AI findings to review.</div>}
          {bundle.analysis.findings.map((f) => (
            <div key={f.id} className="finding-card">
              <h3>{f.type.replaceAll("_", " ").toUpperCase()} {f.synthetic && <span className="demo-tag">SYNTHETIC</span>}</h3>
              <dl className="kv">
                <dt>Location</dt><dd>{f.location.replaceAll("_", " ")}</dd>
                <dt>Severity</dt><dd>{f.severity}</dd>
                <dt>Confidence</dt><dd>{f.confidence_category} ({f.confidence})</dd>
              </dl>
              <p className="small">{f.explanation}</p>
              <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                <button className="btn" style={{ padding: "6px 12px" }} onClick={() => act("accept", f.id)}>Accept</button>
                <button className="btn danger" style={{ padding: "6px 12px" }} onClick={() => act("reject", f.id)}>Reject</button>
                <button
                  className="btn secondary"
                  style={{ padding: "6px 12px" }}
                  onClick={() => {
                    const type = prompt("Corrected finding type:", f.type);
                    if (type) act("correct", f.id, { type, location: f.location, severity: f.severity, explanation: f.explanation });
                  }}
                >
                  Correct
                </button>
              </div>
            </div>
          ))}

          <div className="panel">
            <h2 style={{ marginTop: 0 }}>Notes &amp; finalization</h2>
            <div className="field">
              <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Clinical note for the record…" />
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn secondary" onClick={() => act("note")}>Add note</button>
              <button className="btn" onClick={() => act("finalize")}>Finalize report</button>
            </div>
            {bundle.report?.review.finalized_at && (
              <p className="small muted" style={{ marginTop: 8 }}>
                Finalized at {bundle.report.review.finalized_at} by {bundle.report.review.reviewer_id}.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default function ClinicianPage() {
  return (
    <Suspense fallback={<div className="spinner" />}>
      <ClinicianInner />
    </Suspense>
  );
}
