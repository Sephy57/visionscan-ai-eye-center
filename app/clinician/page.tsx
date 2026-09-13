"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import ScanViewer from "@/components/ScanViewer";
import { Badge, ConfidenceIndicator, QualityPanel, EmptyState } from "@/components/ui";
import { Icon } from "@/components/icons";
import { authFetch } from "@/lib/auth/clientFetch";

interface Finding {
  id: string; type: string; location: string; severity: string;
  confidence: number; confidence_category: string;
  explanation: string; synthetic: boolean; model_id: string;
  region?: { x: number; y: number; w: number; h: number } | null;
}
interface Bundle {
  study?: { study_id: string; modality: string; eye: string; status: string; original_sha256: string; symptoms?: Array<{ type: string; label?: string; onset: string; duration: string; severity: string; laterality: string; progression: string; free_text?: string | null }> };
  analysis?: {
    analysis_mode?: string;
    findings: Finding[];
    quality: { acceptable: boolean; status: string; score: number; artifacts: string[]; metrics: Record<string, number | boolean> };
    model_registry?: { model_id: string; model_version: string; model_status: string; device_compatibility: { compatible: boolean; note: string } };
    fundus_abnormality?: {
      state: string; validation_state: string;
      regions: Array<{ id: string; finding_type: string; localization: { kind: "bounding_box"; coordinates: { x: number; y: number; w: number; h: number } }; note: string }>;
    };
    patient_context?: { reported: boolean; symptoms: Array<{ type: string; label?: string; onset: string; duration: string; severity: string; laterality: string; progression: string; free_text?: string | null }>; red_flags: string[]; note: string };
    symptom_correlation?: { state: string; urgency: string; items: Array<{ symptom_type: string; symptom_label: string; state: string; matched_finding_types: string[]; note: string }>; notes: string[]; label: string };
    treatment_information?: {
      items: Array<{
        condition_id: string; condition_label: string; available: boolean; reason: string;
        approaches: Array<{ approach_label: string; purpose: string; evidence_reference: string; medications: Array<{ medication_id: string; generic_name: string; drug_class: string }> }>;
        label: string;
      }>;
      dosage_notice: string; interaction_notice: string; note: string;
    };
    provenance?: { analyzed_at: string };
  };
  report?: {
    review: {
      status: string; reviewer_id?: string; finalized_at?: string; revision?: number;
      conflict_state?: "NONE" | "CONCURRENT_REVIEW_CONFLICT";
      conflicts?: Array<{ conflict_id: string; finding_id: string | null; prior_revision: number; incoming_action: string; at: string; reason: string }>;
    };
    clinician_interpretation?: { overall: string } | null;
    clinician_corrections?: Array<{ finding_id: string; original: { type: string; location: string; severity: string; explanation: string }; correction: Record<string, string>; reviewer_id: string; note?: string; at: string }>;
    clinician_observations?: Array<{ observation_id: string; text: string; laterality?: string; reviewer_id: string; at: string }>;
    clinician_final_assessment?: { diagnosis?: string | null; impression?: string | null; plan?: string | null; follow_up?: string | null; reviewer_id: string; at: string } | null;
    treatment_review?: { reviewer_id: string; decisions: Array<{ condition_id: string; decision: string; contraindication_note?: string; patient_restriction_note?: string; clinical_note?: string; at: string }> } | null;
  };
  reviewEvents?: Array<{ review_event_id: string; reviewer_id: string; action: string; reason: string; finding_id: string | null; created_at: string }>;
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
  const [note, setNote] = useState("");
  const [assessment, setAssessment] = useState({ diagnosis: "", impression: "", plan: "", follow_up: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [activeRegion, setActiveRegion] = useState<Finding["region"]>(null);

  async function load(id: string) {
    setErr(null); setMsg(null);
    const [res, eventsRes] = await Promise.all([
      fetch(`/api/studies/${encodeURIComponent(id)}`),
      authFetch(`/api/review/${encodeURIComponent(id)}/events`),
    ]);
    const json = await res.json();
    const eventsJson = eventsRes.ok ? await eventsRes.json() : null;
    if (!res.ok) { setErr(json.error ?? "Not found"); setBundle(null); }
    else setBundle({ ...json, reviewEvents: eventsJson?.events ?? [] });
  }
  useEffect(() => { if (studyId) load(studyId); }, []);

  async function act(action: string, findingId?: string, correction?: Record<string, string>, extra?: { condition_id?: string; medication_id?: string; note?: string }) {
    // reviewer_id is always taken server-side from the authenticated
    // session (see app/api/review/[id]/route.ts) - it is not sent from here.
    const res = await authFetch(`/api/review/${encodeURIComponent(studyId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action, finding_id: findingId, correction,
        note: extra?.note ?? note, condition_id: extra?.condition_id, medication_id: extra?.medication_id,
        assessment: action === "finalize" ? assessment : undefined,
      }),
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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div>
          <div className="stat-label">Clinician review</div>
          <h1 style={{ marginBottom: 2 }}>Clinical Review</h1>
          <p className="muted small" style={{ margin: 0 }}>Stored locally in this research environment. AI output and clinician interpretation are kept separate.</p>
        </div>
        {bundle?.report && (
          <Badge tone={bundle.report.review.status === "ai_only" ? "warn" : bundle.report.review.status === "clinician_finalized" ? "ok" : "info"}>
            {bundle.report.review.status === "ai_only" ? "AWAITING REVIEW" : bundle.report.review.status.replaceAll("_", " ").toUpperCase()}
          </Badge>
        )}
      </div>
      <p className="muted">
        Human-in-the-loop review workspace. Confirm, reject, or correct AI findings, mark the case indeterminate,
        request a new scan, or finalize the report. The AI never modifies your interpretation — records are kept
        separately (AI output / clinician interpretation / final report).
      </p>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="studyId">Study ID</label>
          <input id="studyId" value={studyId} onChange={(e) => setStudyId(e.target.value)} placeholder="study_..." />
        </div>
        <p className="tiny muted" style={{ margin: "6px 0 0" }}>
          Review actions are attributed to your signed-in account - there is no separate reviewer-id field to fill in.
        </p>
        <button className="btn" style={{ marginTop: 14 }} onClick={() => load(studyId)} disabled={!studyId}>Open study</button>
      </div>

      {err && <div className="alert danger"><span className="alert-icon" aria-hidden="true">⚠</span><div className="alert-body">{err}</div></div>}
      {msg && <div className="alert ok"><span className="alert-icon" aria-hidden="true">✓</span><div className="alert-body">{msg}</div></div>}

      {bundle?.report?.review.conflict_state === "CONCURRENT_REVIEW_CONFLICT" && (
        <div className="alert danger" role="alert" style={{ marginTop: 14 }}>
          <span className="alert-icon" aria-hidden="true">⚠</span>
          <div className="alert-body"><strong>Concurrent clinician review requires adjudication.</strong> Append-only events were preserved, but the current projection must not be treated as settled.</div>
        </div>
      )}

      {bundle?.analysis && (
        <>
          {bundle.analysis.patient_context?.reported && (
            <div className="card" style={{ marginTop: 16 }}>
              <div className="card-title">
                <h3>Patient symptoms</h3>
                {bundle.analysis.patient_context.red_flags.length > 0 && <Badge tone="bad">⚠ RED FLAG: {bundle.analysis.patient_context.red_flags.map((r) => r.replaceAll("_", " ")).join(", ")}</Badge>}
              </div>
              <div className="table-wrap" tabIndex={0}>
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
              </div>
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

          <div className="grid stack-mobile clinician-review-grid" style={{ gridTemplateColumns: "1.2fr 1fr", alignItems: "start", marginTop: 16 }} >
          <div className="card" style={{ margin: 0 }}>
            <div className="card-title">
              <h3>Original scan — {bundle.study?.study_id}</h3>
              <Badge tone="neutral">{bundle.study?.modality} • {bundle.study?.eye}</Badge>
            </div>
            <ScanViewer
              src={`/api/studies/${encodeURIComponent(studyId)}/image`}
              alt={`Original scan ${bundle.study?.study_id}`}
              region={activeRegion}
              localizations={(bundle.analysis.fundus_abnormality?.regions ?? []).map((r) => ({ id: r.id, finding_id: r.id, kind: r.localization.kind, coordinates: r.localization.coordinates, priority: "high" as const, note: `SUSPICIOUS REGION — ${r.finding_type.replaceAll("_", " ")}` }))}
              overlayStatus={(bundle.analysis.fundus_abnormality?.regions ?? []).length ? (bundle.analysis.fundus_abnormality?.validation_state === "CLINICALLY_VALIDATED" ? "CLINICALLY_VALIDATED" : "RESEARCH") : undefined}
              overlayUnavailableNote={(bundle.analysis.fundus_abnormality?.regions ?? []).length ? undefined : "AI localization is not available for this result."}
            />
            <p className="tiny muted" style={{ marginBottom: 0, marginTop: 8 }}>
              SHA-256: {bundle.study?.original_sha256.slice(0, 24)}… — original preserved unchanged.
              Any future heatmap will be labeled &ldquo;AI-highlighted region&rdquo; and is never proof of a diagnosis.
            </p>
          </div>

          <div style={{ display: "grid", gap: 16 }}>
            <div className="card" style={{ margin: 0 }}>
              <div className="card-title">
                <h3 style={{ fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--text-3)", margin: 0 }}>AUTOMATED ANALYSIS — {bundle.analysis.analysis_mode === "DEMO_ONLY" ? "Demo / synthetic output" : bundle.analysis.analysis_mode === "MODEL_FAILED" ? "Model failed — no output" : bundle.analysis.analysis_mode === "NO_MODEL_EXECUTED" ? "No applicable model" : "Research output"}</h3>
              </div>
              <div className="card-title" style={{ marginTop: -6 }}>
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
              <div className="card-title" style={{ marginBottom: 4 }}>
              <h3 style={{ fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--text-3)" }}>CLINICIAN INTERPRETATION — Human review</h3>
            </div>
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
                <button className="btn secondary sm" onClick={() => act("add_observation")}>Add clinician observation</button>
                <button className="btn" onClick={() => act("finalize")}>Finalize Report</button>
              </div>
              <fieldset style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 12, margin: "10px 0" }}>
                <legend className="small">Final clinician assessment (required to finalize)</legend>
                <p className="tiny muted">These are your authored fields, stored separately from AI output. Do not copy an AI diagnosis without clinical review.</p>
                {(["diagnosis", "impression", "plan", "follow_up"] as const).map((field) => (
                  <div className="field" key={field}>
                    <label htmlFor={`assessment-${field}`}>{field.replace("_", " ")}</label>
                    <textarea id={`assessment-${field}`} rows={field === "impression" || field === "plan" ? 3 : 2} value={assessment[field]} onChange={(e) => setAssessment({ ...assessment, [field]: e.target.value })} maxLength={4000} placeholder={`Clinician ${field.replace("_", " ")}…`} />
                  </div>
                ))}
              </fieldset>
              {bundle.report?.clinician_observations && bundle.report.clinician_observations.length > 0 && (
                <div style={{ marginTop: 10, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                  <strong className="tiny">Clinician observations (additive)</strong>
                  {bundle.report.clinician_observations.map((o) => (
                    <p key={o.observation_id} className="tiny muted" style={{ margin: "4px 0" }}>
                      {o.text}{o.laterality ? ` · ${o.laterality}` : ""} · {o.reviewer_id}
                    </p>
                  ))}
                </div>
              )}
              {bundle.report?.review.finalized_at && (
                <p className="tiny muted" style={{ marginTop: 10, marginBottom: 0 }}>
                  Finalized {new Date(bundle.report.review.finalized_at).toLocaleString()} by {bundle.report.review.reviewer_id}.
                </p>
              )}
            </div>
          </div>
          </div>

          {bundle.analysis.treatment_information && bundle.analysis.treatment_information.items.length > 0 && (
            <div className="card" style={{ marginTop: 16 }}>
              <div className="card-title">
                <h3 style={{ fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--text-3)" }}>
                  TREATMENT INFORMATION — Clinician review required
                </h3>
              </div>
              {bundle.analysis.treatment_information.items.map((item) => (
                <div key={item.condition_id} style={{ borderTop: "1px solid var(--border)", paddingTop: 12, marginTop: 12 }}>
                  <strong className="small">{item.condition_label}</strong>
                  {item.available ? (
                    item.approaches.map((ap, i) => (
                      <p key={i} className="small muted" style={{ margin: "4px 0" }}>
                        <strong>{ap.approach_label}</strong> — {ap.purpose}
                        {ap.medications.length > 0 && ` (${ap.medications.map((m) => m.generic_name).join(", ")})`}
                      </p>
                    ))
                  ) : (
                    <p className="small muted" style={{ margin: "4px 0" }}>{item.reason}</p>
                  )}
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                    <button className="btn sm" onClick={() => act("treatment_accept", undefined, undefined, { condition_id: item.condition_id })}>Accept</button>
                    <button className="btn danger sm" onClick={() => act("treatment_reject", undefined, undefined, { condition_id: item.condition_id })}>Reject</button>
                    <button className="btn secondary sm" onClick={() => {
                      const medId = prompt("Medication ID to add (must exist in the medication registry):");
                      if (medId) act("treatment_add_medication", undefined, undefined, { condition_id: item.condition_id, medication_id: medId });
                    }}>Add medication</button>
                    <button className="btn secondary sm" onClick={() => {
                      const medId = prompt("Medication ID to remove:");
                      if (medId) act("treatment_remove_medication", undefined, undefined, { condition_id: item.condition_id, medication_id: medId });
                    }}>Remove medication</button>
                    <button className="btn secondary sm" onClick={() => {
                      const n = prompt("Contraindication note:");
                      if (n) act("treatment_mark_contraindication", undefined, undefined, { condition_id: item.condition_id, note: n });
                    }}>Mark contraindication</button>
                    <button className="btn secondary sm" onClick={() => {
                      const n = prompt("Patient-specific restriction note:");
                      if (n) act("treatment_mark_restriction", undefined, undefined, { condition_id: item.condition_id, note: n });
                    }}>Mark restriction</button>
                    <button className="btn ghost sm" onClick={() => {
                      const n = prompt("Clinical note:");
                      if (n) act("treatment_note", undefined, undefined, { condition_id: item.condition_id, note: n });
                    }}>Add note</button>
                  </div>
                </div>
              ))}
              <p className="tiny muted" style={{ marginTop: 10, marginBottom: 0 }}>
                {bundle.analysis.treatment_information.dosage_notice} {bundle.analysis.treatment_information.interaction_notice} The
                AI-generated treatment information above is never modified by these actions — clinician decisions are
                recorded as a separate, additive record.
              </p>
              {bundle.report?.treatment_review && bundle.report.treatment_review.decisions.length > 0 && (
                <div style={{ marginTop: 10, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                  {bundle.report.treatment_review.decisions.map((d, i) => (
                    <p key={i} className="tiny muted" style={{ margin: "2px 0" }}>
                      {d.condition_id}: {d.decision}
                      {d.contraindication_note ? ` — contraindication: ${d.contraindication_note}` : ""}
                      {d.patient_restriction_note ? ` — restriction: ${d.patient_restriction_note}` : ""}
                      {d.clinical_note ? ` — ${d.clinical_note}` : ""}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
          </>
      )}

      {bundle?.reviewEvents && bundle.reviewEvents.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-title"><h3>Immutable review event history</h3><Badge tone="info">{bundle.reviewEvents.length} event(s)</Badge></div>
          <p className="tiny muted">Events are append-only. A concurrent projection conflict is never silently resolved in the UI.</p>
          <div className="table-wrap" tabIndex={0}>
            <table className="table"><thead><tr><th>Time</th><th>Reviewer</th><th>Action</th><th>Finding</th><th>Reason</th></tr></thead>
              <tbody>{bundle.reviewEvents.map((event) => <tr key={event.review_event_id}><td>{new Date(event.created_at).toLocaleString()}</td><td>{event.reviewer_id}</td><td>{event.action.replaceAll("_", " ")}</td><td>{event.finding_id ?? "report"}</td><td>{event.reason}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
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
          <EmptyState icon={<Icon name="review" size={22} />} title="Open a study to begin review">
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
