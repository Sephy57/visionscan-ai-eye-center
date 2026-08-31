"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import ScanViewer from "@/components/ScanViewer";
import { Badge, ConfidenceIndicator, QualityPanel, EmptyState } from "@/components/ui";

interface Finding {
  id: string; type: string; location: string; severity: string;
  confidence: number; confidence_category: string;
  explanation: string; synthetic: boolean; model_id: string;
  region?: { x: number; y: number; w: number; h: number } | null;
}
interface Bundle {
  study?: { study_id: string; modality: string; eye: string; status: string; original_sha256: string; symptoms?: Array<{ type: string; label?: string; onset: string; duration: string; severity: string; laterality: string; progression: string; free_text?: string | null }> };
  analysis?: {
    findings: Finding[];
    quality: { acceptable: boolean; status: string; score: number; artifacts: string[]; metrics: Record<string, number | boolean> };
    model_registry?: { model_id: string; model_version: string; model_status: string; device_compatibility: { compatible: boolean; note: string } };
    patient_context?: { reported: boolean; symptoms: Array<{ type: string; label?: string; onset: string; duration: string; severity: string; laterality: string; progression: string; free_text?: string | null }>; red_flags: string[]; note: string };
    symptom_correlation?: { state: string; urgency: string; items: Array<{ symptom_type: string; symptom_label: string; state: string; matched_finding_types: string[]; note: string }>; notes: string[]; label: string };
    provenance?: { analyzed_at: string };
  };
  report?: { review: { status: string; reviewer_id?: string; finalized_at?: string }, clinician_interpretation?: { overall: string } | null };
}

const ACTIONS = [
  ["confirm", "Confirm", "secondary"],
  ["reject", "Reject", "danger"],
  ["indeterminate", "Mark Indeterminate", "secondary"],
  ["request_new_scan", "Request New Scan", "secondary"],
] as const;

function ClinicianInner() {
  const params = useSearchParams();
  const [studyId, setStudyId] = useState(params.get("study") ?? "");
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [reviewer, setReviewer] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [activeRegion, setActiveRegion] = useState<Finding["region"]>(null);

  async function load(id: string) {
    setErr(null); setMsg(null);
    const res = await fetch(`/api/studies/${encodeURIComponent(id)}`);
    const json = await res.json();
    if (!res.ok) { setErr(json.error ?? "Not found"); setBundle(null); }
    else setBundle(json);
  }
  useEffect(() => { if (studyId) load(studyId); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(action: string, findingId?: string, correction?: Record<string, string>) {
    if (action !== "note" && !reviewer.trim()) { setErr("Enter a reviewer ID first (pseudonymous — no signatures are fabricated)."); return; }
    const res = await fetch(`/api/review/${encodeURIComponent(studyId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewer_id: reviewer || "anonymous-reviewer", action, finding_id: findingId, correction, note }),
    });
    const json = await res.json();
    if (!res.ok) setErr(json.error ?? "Review action failed");
    else {
      setMsg(`Action "${action.replaceAll("_", " ")}" recorded. AI output, clinician interpretation, and final report are stored separately and every change is audited.`);
      setNote(""); load(studyId);
    }
  }

  return (
    <div>
      <h1>Clinical review</h1>
      <p className="muted">
        Human-in-the-loop review workspace. Confirm, reject, or correct AI findings, mark the case indeterminate,
        request a new scan, or finalize the report. The AI never modifies your interpretation — records are kept
        separately (AI output / clinician interpretation / final report).
      </p>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="grid grid-2">
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="studyId">Study ID</label>
            <input id="studyId" value={studyId} onChange={(e) => setStudyId(e.target.value)} placeholder="study_..." />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="reviewer">Reviewer ID (pseudonymous; no signatures are fabricated)</label>
            <input id="reviewer" value={reviewer} onChange={(e) => setReviewer(e.target.value)} placeholder="e.g. dr-ops-001" />
          </div>
        </div>
        <button className="btn" style={{ marginTop: 14 }} onClick={() => load(studyId)} disabled={!studyId}>Open study</button>
      </div>

      {err && <div className="alert danger"><span className="alert-icon" aria-hidden="true">⚠</span><div className="alert-body">{err}</div></div>}
      {msg && <div className="alert ok"><span className="alert-icon" aria-hidden="true">✓</span><div className="alert-body">{msg}</div></div>}

      {bundle?.analysis && (
        <>
          {bundle.analysis.patient_context?.reported && (
            <div className="card" style={{ marginTop: 16 }}>
              <div className="card-title">
                <h3>Patient symptoms</h3>
                {bundle.analysis.patient_context.red_flags.length > 0 && <Badge tone="bad">⚠ RED FLAG: {bundle.analysis.patient_context.red_flags.map((r) => r.replaceAll("_", " ")).join(", ")}</Badge>}
              </div>
              <table className="table">
                <thead><tr><th>Symptom</th><th>Onset</th><th>Duration</th><th>Severity</th><th>Eye</th></tr></thead>
                <tbody>
                  {bundle.analysis.patient_context.symptoms.map((s, i) => (
                    <tr key={i}>
                      <td>{s.label ?? s.type.replaceAll("_", " ")}{bundle.analysis!.patient_context!.red_flags.includes(s.type) ? " ⚠" : ""}</td>
                      <td>{s.onset}</td>
                      <td>{s.duration.replaceAll("_", " ")}</td>
                      <td>{s.severity}</td>
                      <td>{s.laterality === "right" ? "Right" : s.laterality === "left" ? "Left" : s.laterality}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {bundle.analysis.symptom_correlation && (
                <div style={{ marginTop: 10 }}>
                  <strong className="small">Symptom / imaging correlation</strong>{" "}
                  <Badge tone={bundle.analysis.symptom_correlation.state === "urgent" ? "bad" : "warn"}>
                    {bundle.analysis.symptom_correlation.state.replaceAll("_", " ")}
                  </Badge>
                  {bundle.analysis.symptom_correlation.items.map((item, i) => (
                    <p key={i} className="small muted" style={{ margin: "6px 0 0" }}>
                      <strong>{item.symptom_label}:</strong> {item.note}
                    </p>
                  ))}
                  <p className="tiny muted" style={{ marginBottom: 0, marginTop: 6 }}>{bundle.analysis.symptom_correlation.label}</p>
                </div>
              )}
              <p className="tiny muted" style={{ marginBottom: 0, marginTop: 8 }}>{bundle.analysis.patient_context.note}</p>
            </div>
          )}

          <div className="grid" style={{ gridTemplateColumns: "1.2fr 1fr", alignItems: "start", marginTop: 16 }} >
          <div className="card" style={{ margin: 0 }}>
            <div className="card-title">
              <h3>Original scan — {bundle.study?.study_id}</h3>
              <Badge tone="neutral">{bundle.study?.modality} • {bundle.study?.eye}</Badge>
            </div>
            <ScanViewer
              src={`/api/studies/${encodeURIComponent(studyId)}/image`}
              alt={`Original scan ${bundle.study?.study_id}`}
              region={activeRegion}
              overlayAvailable={activeRegion != null}
              overlayUnavailableNote="AI localization is not available for this model."
            />
            <p className="tiny muted" style={{ marginBottom: 0, marginTop: 8 }}>
              SHA-256: {bundle.study?.original_sha256.slice(0, 24)}… — original preserved unchanged.
              Any future heatmap will be labeled &ldquo;AI-highlighted region&rdquo; and is never proof of a diagnosis.
            </p>
          </div>

          <div style={{ display: "grid", gap: 16 }}>
            <div className="card" style={{ margin: 0 }}>
              <div className="card-title">
                <h3>AI findings ({bundle.analysis.findings.length})</h3>
                {bundle.report?.review.status !== "ai_only" && <Badge tone="info">{bundle.report?.review.status.replaceAll("_", " ")}</Badge>}
              </div>
              {bundle.analysis.findings.length === 0 && (
                <p className="muted small" style={{ margin: 0 }}>No AI findings to review for this study.</p>
              )}
              {bundle.analysis.findings.map((f) => (
                <div key={f.id} style={{ borderTop: "1px solid var(--border)", paddingTop: 12, marginTop: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                    <strong className="small">{f.type.replaceAll("_", " ").toUpperCase()}</strong>
                    {f.synthetic && <Badge tone="demo">Synthetic</Badge>}
                  </div>
                  <p className="small muted" style={{ margin: "4px 0 8px" }}>
                    {f.location.replaceAll("_", " ")} • Model {f.model_id}
                    {bundle.analysis?.model_registry && <> • Status <strong>{bundle.analysis.model_registry.model_status}</strong></>}
                  </p>
                  <ConfidenceIndicator finding={f} />
                  <p className="small" style={{ margin: "8px 0" }}>{f.explanation}</p>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button className="btn sm" onClick={() => act("confirm", f.id)}>Confirm</button>
                    <button className="btn danger sm" onClick={() => act("reject", f.id)}>Reject</button>
                    <button className="btn secondary sm" onClick={() => {
                      const type = prompt("Corrected finding type:", f.type);
                      if (type) act("correct", f.id, { type, location: f.location, severity: f.severity, explanation: f.explanation });
                    }}>Correct</button>
                    <button className="btn secondary sm" onClick={() => act("indeterminate", f.id)}>Indeterminate</button>
                    {f.region && <button className="btn ghost sm" onClick={() => setActiveRegion(f.region ?? null)}>View region</button>}
                  </div>
                </div>
              ))}
            </div>

            <div className="card" style={{ margin: 0 }}>
              <div className="card-title"><h3>Case decision</h3></div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {ACTIONS.filter(([a]) => a !== "confirm" && a !== "reject").map(([a, label, style]) => (
                  <button key={a} className={`btn ${style === "danger" ? "danger" : "secondary"} sm`} onClick={() => act(a)}>{label}</button>
                ))}
              </div>
              <div className="field">
                <label htmlFor="note">Clinician notes</label>
                <textarea id="note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Clinical note for the record…" />
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="btn secondary sm" onClick={() => act("note")}>Add note</button>
                <button className="btn" onClick={() => act("finalize")}>Finalize Report</button>
              </div>
              {bundle.report?.review.finalized_at && (
                <p className="tiny muted" style={{ marginTop: 10, marginBottom: 0 }}>
                  Finalized {new Date(bundle.report.review.finalized_at).toLocaleString()} by {bundle.report.review.reviewer_id}.
                </p>
              )}
            </div>
          </div>
          </div>
          </>
      )}

      {bundle?.analysis && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-title"><h3>Image quality &amp; limitations</h3></div>
          <div className="grid grid-2">
            <QualityPanel quality={bundle.analysis.quality} />
            <div>
              {bundle.analysis.model_registry && (
                <dl className="kv">
                  <dt>Model</dt><dd>{bundle.analysis.model_registry.model_id} v{bundle.analysis.model_registry.model_version}</dd>
                  <dt>Validation status</dt><dd><Badge tone="warn">{bundle.analysis.model_registry.model_status}</Badge></dd>
                  <dt>Device compatibility</dt><dd className="small">{bundle.analysis.model_registry.device_compatibility.note}</dd>
                </dl>
              )}
              <p className="tiny muted" style={{ marginBottom: 0 }}>
                Every change is audited. AI output is never overwritten by review actions — decisions are recorded
                in the clinician interpretation layer.
              </p>
            </div>
          </div>
        </div>
      )}

      {!bundle && !err && (
        <div style={{ marginTop: 16 }}>
          <EmptyState icon="✓" title="Open a study to begin review">
            Enter a study ID above, or open a result from the History page and click Clinical Review.
          </EmptyState>
        </div>
      )}
    </div>
  );
}

export default function ClinicianPage() {
  return (
    <Suspense fallback={<div style={{ display: "flex", justifyContent: "center", padding: 60 }}><div className="spinner" /></div>}>
      <ClinicianInner />
    </Suspense>
  );
}
