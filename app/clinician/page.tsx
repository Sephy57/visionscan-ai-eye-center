"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import ScanViewer from "@/components/ScanViewer";
import Link from "next/link";
import { Badge, ConfidenceIndicator, QualityPanel, EmptyState, PageHeader, Provenance, SectionHeader, StatePanel, shortId } from "@/components/ui";
import { Icon } from "@/components/icons";
import { useDialog } from "@/components/Dialog";
import { DASHBOARD_STATUS_META } from "@/lib/reports/terminology";
import { authFetch } from "@/lib/auth/clientFetch";

interface Finding {
  id: string; type: string; location: string; severity: string;
  confidence: number; confidence_category: string;
  explanation: string; synthetic: boolean; model_id: string;
  laterality?: "OD" | "OS" | "OU" | "unknown";
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
      conflicts?: Array<{ conflict_id: string; finding_id: string | null; prior_revision: number; incoming_action: string; at: string; reason: string; adjudicated_at?: string; adjudicated_by?: string; adjudication_note?: string }>;
      adjudications?: Array<{ conflict_id: string; resolution: string; note: string; reviewer_id: string; at: string }>;
    };
    clinician_interpretation?: { overall: string } | null;
    clinician_corrections?: Array<{ finding_id: string; original: { type: string; location: string; severity: string; explanation: string }; correction: Record<string, string>; reviewer_id: string; note?: string; at: string }>;
    clinician_observations?: Array<{ observation_id: string; text: string; laterality?: string; reviewer_id: string; at: string }>;
    clinician_final_assessment?: { diagnosis?: string | null; impression?: string | null; plan?: string | null; follow_up?: string | null; reviewer_id: string; at: string } | null;
    treatment_review?: { reviewer_id: string; decisions: Array<{ condition_id: string; decision: string; contraindication_note?: string; patient_restriction_note?: string; clinical_note?: string; at: string }> } | null;
  };
  reviewEvents?: Array<{ review_event_id: string; reviewer_id: string; action: string; reason: string; finding_id: string | null; created_at: string }>;
}


interface QueueRow { study_id: string; created_at: string; modality: string; eye: string; patient_ref?: string | null; dashboard_status?: string }

const REVIEW_STATUS_TEXT: Record<string, string> = {
  ai_only: "Awaiting review",
  clinician_reviewed: "Review in progress",
  clinician_finalized: "Finalized",
};

/** Study selection when no study is open: the real review queue, plus manual entry. */
function ReviewQueue({ studyId, setStudyId, onOpen }: { studyId: string; setStudyId: (v: string) => void; onOpen: (id: string) => void }) {
  const [rows, setRows] = useState<QueueRow[] | null>(null);
  const [queueError, setQueueError] = useState(false);
  const [truncated, setTruncated] = useState(false);
  useEffect(() => {
    // Follow the server's cursor so older studies still awaiting review are
    // never hidden behind the newest page. Bounded; if the bound is reached
    // the page says so instead of implying the queue is complete.
    const AWAITING = ["URGENT_REVIEW", "CLINICAL_CORRELATION_REQUIRED", "REVIEW_REQUIRED"];
    const MAX_PAGES = 20;
    let active = true;
    (async () => {
      const found: QueueRow[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const res: Response = await fetch(`/api/studies?with_status=1&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body: { studies?: QueueRow[]; has_more?: boolean; next_cursor?: string | null } = await res.json();
        found.push(...(body.studies ?? []).filter((s) => AWAITING.includes(s.dashboard_status ?? "")));
        cursor = body.has_more ? body.next_cursor ?? null : null;
        if (!cursor) break;
      }
      if (!active) return;
      setTruncated(Boolean(cursor));
      setRows(found);
    })().catch(() => { if (active) { setQueueError(true); setRows([]); } });
    return () => { active = false; };
  }, []);
  return (
    <div className="grid stack-mobile" style={{ gridTemplateColumns: "minmax(0, 1.6fr) minmax(260px, 1fr)", alignItems: "start" }}>
      <section aria-labelledby="queue-title" style={{ minWidth: 0 }}>
        <SectionHeader eyebrow="Queue" title="Studies awaiting review" id="queue-title" caption="Urgent first · real server-computed status" />
        {!rows && <div className="loading-row" role="status"><span className="pulse-dot" aria-hidden="true" /> Loading review queue…</div>}
        {queueError && (
          <div className="alert danger" role="alert"><span className="alert-icon" aria-hidden="true"><Icon name="warning" size={16} /></span>
            <div className="alert-body"><strong>Review queue unavailable</strong>The study list could not be loaded, so no queue is shown rather than an empty one. Retry, or open a study by its ID.</div></div>
        )}
        {truncated && (
          <p className="small muted">Showing studies awaiting review among the 2,000 most recent. Older studies may also need review — see <Link href="/history?filter=awaiting">Studies & History</Link>.</p>
        )}
        {rows && !queueError && rows.length === 0 && (
          <EmptyState icon={<Icon name="review" size={22} />} title="No studies awaiting review" action={<Link className="btn secondary" href="/history">Browse all studies</Link>}>
            Every analyzed study visible to your account has a recorded clinician decision, or no analysis has completed yet.
          </EmptyState>
        )}
        {rows && rows.length > 0 && (
          <div className="card flush">
            <div className="table-wrap" tabIndex={0} role="region" aria-label="Review queue">
              <table className="table">
                <caption className="sr-only">Studies awaiting clinician review</caption>
                <thead><tr><th scope="col">Status</th><th scope="col">Study</th><th scope="col">Modality</th><th scope="col" className="actions">Action</th></tr></thead>
                <tbody>
                  {[...rows].sort((a, b) => (a.dashboard_status === "URGENT_REVIEW" ? -1 : 0) - (b.dashboard_status === "URGENT_REVIEW" ? -1 : 0) || b.created_at.localeCompare(a.created_at)).map((r) => (
                    <tr key={r.study_id}>
                      <td><Badge tone={DASHBOARD_STATUS_META[r.dashboard_status ?? ""]?.tone ?? "neutral"}>{DASHBOARD_STATUS_META[r.dashboard_status ?? ""]?.label ?? "Uploaded"}</Badge></td>
                      <td>{r.patient_ref && <strong>{r.patient_ref} </strong>}<span className="id-cell">{shortId(r.study_id, 18)}</span></td>
                      <td>{r.modality.replaceAll("_", " ")} · {r.eye}</td>
                      <td className="actions"><button className="btn sm" onClick={() => onOpen(r.study_id)}>Open review</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
      <aside className="card">
        <div className="card-kicker" style={{ marginBottom: 10 }}><Icon name="search" size={13} /> Open by study ID</div>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="studyId">Study ID</label>
          <input id="studyId" value={studyId} onChange={(e) => setStudyId(e.target.value)} placeholder="study_..." onKeyDown={(e) => { if (e.key === "Enter" && studyId) onOpen(studyId); }} />
        </div>
        <button className="btn block" style={{ marginTop: 12 }} onClick={() => onOpen(studyId)} disabled={!studyId}>Open study</button>
        <p className="tiny muted" style={{ margin: "10px 0 0" }}>
          Review actions are attributed to your signed-in account — there is no separate reviewer-id field to fill in.
        </p>
      </aside>
    </div>
  );
}

function ClinicianInner() {
  const params = useSearchParams();
  const [studyId, setStudyId] = useState(params.get("study") ?? "");
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [note, setNote] = useState("");
  const [reviewReason, setReviewReason] = useState("");
  const [assessment, setAssessment] = useState({ diagnosis: "", impression: "", plan: "", follow_up: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [activeRegion, setActiveRegion] = useState<Finding["region"]>(null);
  const dialog = useDialog();

  async function load(id: string) {
    setErr(null); setMsg(null);
    try {
      const [res, eventsRes] = await Promise.all([
        fetch(`/api/studies/${encodeURIComponent(id)}`),
        authFetch(`/api/review/${encodeURIComponent(id)}/events`),
      ]);
      const json = await res.json().catch(() => ({}));
      const eventsJson = eventsRes.ok ? await eventsRes.json() : null;
      if (!res.ok) { setErr(json.error ?? "Not found"); setBundle(null); }
      else setBundle({ ...json, reviewEvents: eventsJson?.events ?? [] });
    } catch {
      setErr("Network error — the study could not be loaded.");
    }
  }
  function open(id: string) {
    setStudyId(id);
    window.history.replaceState({}, "", `/clinician?study=${encodeURIComponent(id)}`);
    load(id);
  }
  useEffect(() => { if (studyId) load(studyId); }, []);

  async function act(action: string, findingId?: string, correction?: Record<string, string>, extra?: { condition_id?: string; medication_id?: string; note?: string; conflict_id?: string; resolution?: string }) {
    // reviewer_id is always taken server-side from the authenticated
    // session (see app/api/review/[id]/route.ts) - it is not sent from here.
    setBusy(true);
    try {
      const res = await authFetch(`/api/review/${encodeURIComponent(studyId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action, finding_id: findingId, correction,
          note: extra?.note ?? note, reason: reviewReason || undefined,
          condition_id: extra?.condition_id, medication_id: extra?.medication_id,
          adjudication: extra?.conflict_id ? { conflict_id: extra.conflict_id, resolution: extra.resolution, note: extra.note ?? note } : undefined,
          assessment: action === "finalize" ? assessment : undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) setErr(json.error ?? "Review action failed");
      else {
        setErr(null);
        setMsg(`Action "${action.replaceAll("_", " ")}" recorded. AI output, clinician interpretation, and final report are stored separately and every change is audited.`);
        setNote(""); setReviewReason(""); load(studyId);
      }
    } finally {
      setBusy(false);
    }
  }

  async function correctFinding(f: Finding) {
    const v = await dialog.ask({
      title: "Correct AI finding",
      body: <>The original AI output is preserved; your correction is stored as a separate, attributed clinician record.</>,
      confirmLabel: "Record correction",
      fields: [
        { name: "type", label: "Corrected finding type", initial: f.type, required: true, maxLength: 120 },
        { name: "laterality", label: "Corrected laterality", initial: f.laterality ?? "unknown", options: [["OD", "OD — right eye"], ["OS", "OS — left eye"], ["OU", "OU — both eyes"], ["unknown", "Unknown"]] },
      ],
    });
    if (v) act("correct", f.id, { type: v.type, location: f.location, severity: f.severity, explanation: f.explanation, laterality: v.laterality });
  }

  async function withNote(title: string, label: string, action: string, conditionId: string, confirmLabel = "Record") {
    const v = await dialog.ask({ title, confirmLabel, fields: [{ name: "note", label, multiline: true, required: true }] });
    if (v) act(action, undefined, undefined, { condition_id: conditionId, note: v.note });
  }

  async function withMedication(title: string, action: string, conditionId: string) {
    const v = await dialog.ask({ title, confirmLabel: "Record", fields: [{ name: "medication_id", label: "Medication ID", hint: "Must exist in the medication registry. The server rejects unknown identifiers.", required: true, maxLength: 120 }] });
    if (v) act(action, undefined, undefined, { condition_id: conditionId, medication_id: v.medication_id.trim() });
  }

  async function confirmCaseAction(action: "indeterminate" | "request_new_scan") {
    const v = await dialog.ask({
      title: action === "indeterminate" ? "Mark the case indeterminate?" : "Request a new scan?",
      body: action === "indeterminate"
        ? "Records that the available evidence does not support an interpretation. The AI output is not modified."
        : "Records that a repeat acquisition is required before interpretation. The AI output is not modified.",
      confirmLabel: action === "indeterminate" ? "Mark indeterminate" : "Request new scan",
    });
    if (v) act(action);
  }

  async function finalize() {
    const filled = (["diagnosis", "impression", "plan", "follow_up"] as const).filter((k) => assessment[k].trim());
    const v = await dialog.ask({
      title: "Finalize this clinical report?",
      tone: "authority",
      body: (
        <>
          <p style={{ marginTop: 0 }}>Finalizing records <strong>your</strong> clinician assessment as the authoritative interpretation for this study, attributed to your account and audited.</p>
          <ul style={{ margin: "0 0 8px", paddingLeft: 18 }}>
            {(["diagnosis", "impression", "plan", "follow_up"] as const).map((k) => (
              <li key={k}><strong>{k.replace("_", " ")}:</strong> {assessment[k].trim() ? assessment[k].trim().slice(0, 140) : <em>empty</em>}</li>
            ))}
          </ul>
          {filled.length === 0 && <p style={{ color: "var(--warning)", margin: 0 }}>No assessment field is filled. The server may reject finalization without an assessment.</p>}
          <p style={{ marginBottom: 0 }}>Do not copy an AI output as a diagnosis without clinical review.</p>
        </>
      ),
      confirmLabel: "Finalize report",
    });
    if (v) act("finalize");
  }

  async function adjudicate(conflictId: string) {
    const v = await dialog.ask({
      title: "Record conflict adjudication",
      body: "Append-only events are preserved. Your adjudication note is attributed and audited.",
      confirmLabel: "Record adjudication",
      fields: [{ name: "note", label: "Adjudication note", multiline: true, required: true, initial: "Reviewed competing clinician event and acknowledged the preserved projection." }],
    });
    if (v?.note.trim()) act("adjudicate_conflict", undefined, undefined, { conflict_id: conflictId, resolution: "MANUAL_REVIEW_ACKNOWLEDGED", note: v.note });
  }

  const status = bundle?.report?.review.status;
  const finalized = status === "clinician_finalized";

  return (
    <div>
      {dialog.element}
      <PageHeader
        eyebrow="Human-in-the-loop review"
        title="Clinical Review"
        lede="Confirm, reject, or correct AI findings, record case decisions, and finalize. The AI never modifies your interpretation — AI output, clinician interpretation, and the final report are stored separately."
        actions={bundle?.report ? (
          <>
            <Badge tone={status === "ai_only" ? "warn" : finalized ? "ok" : "info"}>{REVIEW_STATUS_TEXT[status ?? ""] ?? status?.replaceAll("_", " ").toUpperCase()}</Badge>
            <Link className="btn secondary sm" href={`/result?study=${encodeURIComponent(studyId)}`}>Results workspace</Link>
            <Link className="btn secondary sm" href={`/report?study=${encodeURIComponent(studyId)}`}>Report</Link>
          </>
        ) : undefined}
      />

      {err && <div className="alert danger" role="alert"><span className="alert-icon" aria-hidden="true"><Icon name="warning" size={16} /></span><div className="alert-body"><strong>Review action not completed</strong>{err}</div></div>}
      {msg && <div className="alert ok" role="status"><span className="alert-icon" aria-hidden="true"><Icon name="check" size={16} /></span><div className="alert-body">{msg}</div></div>}

      {!bundle && !err && <ReviewQueue studyId={studyId} setStudyId={setStudyId} onOpen={open} />}
      {!bundle && err && (
        <div style={{ marginTop: 16 }}>
          <StatePanel tone="danger" icon="warning" title="Study could not be opened for review"
            what={err} why="The study may not exist, may not be visible to your account, or the server may be unavailable."
            next="Choose a study from the review queue."
            actions={<button className="btn" onClick={() => { setErr(null); setStudyId(""); window.history.replaceState({}, "", "/clinician"); }}>Back to review queue</button>} />
        </div>
      )}

      {bundle?.report?.review.conflict_state === "CONCURRENT_REVIEW_CONFLICT" && (
        <div className="alert danger" role="alert" style={{ marginTop: 14 }}>
          <span className="alert-icon" aria-hidden="true"><Icon name="warning" size={16} /></span>
          <div className="alert-body">
            <strong>Concurrent clinician review requires adjudication.</strong> Append-only events were preserved, but the current projection must not be treated as settled.
            {(bundle.report.review.conflicts ?? []).filter((conflict) => !conflict.adjudicated_at).map((conflict) => (
              <div key={conflict.conflict_id} style={{ marginTop: 8 }}>
                <span className="tiny">Conflict {conflict.conflict_id} — {conflict.incoming_action.replaceAll("_", " ")}</span>{" "}
                <button className="btn secondary sm" onClick={() => adjudicate(conflict.conflict_id)} disabled={busy}>Record adjudication</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {bundle?.analysis && (
        <>
          <dl className="identity-bar" aria-label="Study identity">
            <div><dt>Study</dt><dd className="mono" title={bundle.study?.study_id}>{shortId(bundle.study?.study_id, 18)}</dd></div>
            <div><dt>Modality · eye</dt><dd>{bundle.study?.modality} · {bundle.study?.eye}</dd></div>
            <div><dt>Analysis</dt><dd>{bundle.analysis.analysis_mode === "DEMO_ONLY" ? "Demo / synthetic output" : bundle.analysis.analysis_mode === "MODEL_FAILED" ? "Model failed — no output" : bundle.analysis.analysis_mode === "NO_MODEL_EXECUTED" ? "No applicable model" : "Research output"}</dd></div>
            <div><dt>AI findings</dt><dd className="num">{bundle.analysis.findings.length}</dd></div>
            <div><dt>Review</dt><dd>{finalized ? <Provenance kind="clinician" label="Finalized" /> : <Badge tone="warn">{REVIEW_STATUS_TEXT[status ?? ""] ?? "Awaiting review"}</Badge>}</dd></div>
          </dl>

          {bundle.analysis.patient_context?.reported && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-title">
                <h3>Patient symptoms</h3>
                <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><Provenance kind="observed" label="Patient-reported" />
                {bundle.analysis.patient_context.red_flags.length > 0 && <Badge tone="bad">⚠ RED FLAG: {bundle.analysis.patient_context.red_flags.map((r) => r.replaceAll("_", " ")).join(", ")}</Badge>}</span>
              </div>
              <div className="table-wrap" tabIndex={0} role="region" aria-label="Reported symptoms">
              <table className="table">
                <thead><tr><th scope="col">Symptom</th><th scope="col">Onset</th><th scope="col">Duration</th><th scope="col">Severity</th><th scope="col">Eye</th></tr></thead>
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
                  <Provenance kind="inferred" label="Rules inference" />{" "}
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

          <div className="grid clinician-review-grid">
            {/* LEFT — AI output (read-only evidence; clinician acts on it) */}
            <section className="ai-panel" aria-labelledby="ai-output-title">
              <div className="ai-kicker"><Icon name="model" size={13} /> AI output · research, unvalidated</div>
              <h2 id="ai-output-title" style={{ margin: "0 0 12px", fontSize: "1rem" }}>
                AUTOMATED ANALYSIS — {bundle.analysis.analysis_mode === "DEMO_ONLY" ? "Demo / synthetic output" : bundle.analysis.analysis_mode === "MODEL_FAILED" ? "Model failed — no output" : bundle.analysis.analysis_mode === "NO_MODEL_EXECUTED" ? "No applicable model" : "Research output"}
              </h2>
              <ScanViewer
                src={`/api/studies/${encodeURIComponent(studyId)}/image`}
                alt={`Original scan ${bundle.study?.study_id}`}
                region={activeRegion}
                localizations={(bundle.analysis.fundus_abnormality?.regions ?? []).map((r) => ({ id: r.id, finding_id: r.id, kind: r.localization.kind, coordinates: r.localization.coordinates, priority: "high" as const, note: `SUSPICIOUS REGION — ${r.finding_type.replaceAll("_", " ")}` }))}
                overlayStatus={(bundle.analysis.fundus_abnormality?.regions ?? []).length ? (bundle.analysis.fundus_abnormality?.validation_state === "CLINICALLY_VALIDATED" ? "CLINICALLY_VALIDATED" : "RESEARCH") : undefined}
                overlayUnavailableNote={(bundle.analysis.fundus_abnormality?.regions ?? []).length ? undefined : "AI localization is not available for this result."}
              />
              <p className="tiny muted" style={{ marginBottom: 0, marginTop: 8 }}>
                SHA-256: <span className="mono">{bundle.study?.original_sha256.slice(0, 24)}…</span> — original preserved unchanged.
                Any future heatmap will be labeled &ldquo;AI-highlighted region&rdquo; and is never proof of a diagnosis.
              </p>

              <div className="card-title" style={{ marginTop: 18 }}>
                <h3>AI findings ({bundle.analysis.findings.length})</h3>
                {bundle.report?.review.status !== "ai_only" && <Badge tone="info">{bundle.report?.review.status.replaceAll("_", " ")}</Badge>}
              </div>
              {bundle.analysis.findings.length === 0 && (
                <p className="muted small" style={{ margin: 0 }}>No AI findings to review for this study. Case-level decisions remain available on the right.</p>
              )}
              {bundle.analysis.findings.map((f) => (
                <div key={f.id} className={`finding-card${f.synthetic ? " synthetic" : ""}`}>
                  <div className="finding-head">
                    <h4>{f.type.replaceAll("_", " ").toUpperCase()}</h4>
                    <span style={{ display: "flex", gap: 6 }}><Provenance kind="model" />{f.synthetic && <Badge tone="demo">Synthetic</Badge>}</span>
                  </div>
                  <p className="small muted" style={{ margin: "4px 0 8px" }}>
                    {f.location.replaceAll("_", " ")} • Model {f.model_id}
                    {bundle.analysis?.model_registry && <> • Status <strong>{bundle.analysis.model_registry.model_status}</strong></>}
                  </p>
                  <ConfidenceIndicator finding={f} />
                  <p className="small" style={{ margin: "8px 0" }}>{f.explanation}</p>
                  <div className="finding-actions" role="group" aria-label={`Clinician decision for ${f.type.replaceAll("_", " ")}`}>
                    <button className="btn authority sm" onClick={() => act("confirm", f.id)} disabled={busy}><Icon name="check" size={13} /> Confirm</button>
                    <button className="btn danger sm" onClick={() => act("reject", f.id)} disabled={busy}><Icon name="x" size={13} /> Reject</button>
                    <button className="btn secondary sm" onClick={() => correctFinding(f)} disabled={busy}>Correct</button>
                    <button className="btn secondary sm" onClick={() => act("indeterminate", f.id)} disabled={busy}>Indeterminate</button>
                    {f.region && <button className="btn ghost sm" onClick={() => setActiveRegion(f.region ?? null)}><Icon name="target" size={13} /> View region</button>}
                  </div>
                </div>
              ))}
            </section>

            {/* RIGHT — clinician authority */}
            <section className="authority-panel" aria-labelledby="authority-title">
              <div className="authority-kicker"><Icon name="review" size={13} /> Human authority</div>
              <h2 id="authority-title" style={{ margin: "0 0 4px", fontSize: "1rem" }}>CLINICIAN INTERPRETATION — Human review</h2>
              <p className="tiny muted" style={{ marginTop: 0 }}>Your decisions are stored as a separate, attributed, append-only record. The AI output on the left is never overwritten.</p>

              <div className={`review-status ${finalized ? "finalized" : "pending"}`} style={{ marginBottom: 16 }}>
                <Icon name={finalized ? "check" : "clock"} size={18} />
                <span>
                  <strong>{finalized ? "Report finalized" : REVIEW_STATUS_TEXT[status ?? ""] ?? "Awaiting review"}</strong>
                  <span className="tiny muted">
                    {bundle.report?.review.finalized_at
                      ? `Finalized ${new Date(bundle.report.review.finalized_at).toLocaleString()} by ${bundle.report.review.reviewer_id}.`
                      : "No interpretation is authoritative until finalized."}
                  </span>
                </span>
              </div>

              <div className="card-title"><h3>Case decision</h3></div>
              <div className="action-grid">
                <button className="action-tile" onClick={() => confirmCaseAction("indeterminate")} disabled={busy}>Mark Indeterminate<span>Evidence does not support an interpretation</span></button>
                <button className="action-tile" onClick={() => confirmCaseAction("request_new_scan")} disabled={busy}>Request New Scan<span>Repeat acquisition required</span></button>
              </div>

              <div className="field">
                <label htmlFor="note">Clinician notes</label>
                <textarea id="note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Clinical note for the record…" />
              </div>
              <div className="field">
                <label htmlFor="review-reason">Structured review reason</label>
                <input id="review-reason" value={reviewReason} onChange={(e) => setReviewReason(e.target.value)} maxLength={1000} placeholder="Why was this action taken? (optional but recommended)" />
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="btn secondary sm" onClick={() => act("note")} disabled={busy || !note.trim()}>Add note</button>
                <button className="btn secondary sm" onClick={() => act("add_observation")} disabled={busy || !note.trim()}>Add clinician observation</button>
              </div>

              <fieldset style={{ marginTop: 18 }}>
                <legend>Final clinician assessment (required to finalize)</legend>
                <p className="tiny muted" style={{ marginTop: 0 }}>These are your authored fields, stored separately from AI output. Do not copy an AI diagnosis without clinical review.</p>
                {(["diagnosis", "impression", "plan", "follow_up"] as const).map((field) => (
                  <div className="field" key={field}>
                    <label htmlFor={`assessment-${field}`} style={{ textTransform: "capitalize" }}>{field.replace("_", " ")}</label>
                    <textarea id={`assessment-${field}`} rows={field === "impression" || field === "plan" ? 3 : 2} value={assessment[field]} onChange={(e) => setAssessment({ ...assessment, [field]: e.target.value })} maxLength={4000} placeholder={`Clinician ${field.replace("_", " ")}…`} />
                  </div>
                ))}
              </fieldset>
              <button className="btn authority lg block" onClick={finalize} disabled={busy}><Icon name="shield" size={16} /> Finalize Report</button>
              <p className="tiny muted" style={{ margin: "8px 0 0" }}>Finalization asks for confirmation and is never automatic.</p>

              {bundle.report?.clinician_observations && bundle.report.clinician_observations.length > 0 && (
                <div style={{ marginTop: 14, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                  <strong className="tiny">Clinician observations (additive)</strong>
                  {bundle.report.clinician_observations.map((o) => (
                    <p key={o.observation_id} className="tiny muted" style={{ margin: "4px 0" }}>
                      {o.text}{o.laterality ? ` · ${o.laterality}` : ""} · {o.reviewer_id}
                    </p>
                  ))}
                </div>
              )}
            </section>
          </div>

          {bundle.analysis.treatment_information && bundle.analysis.treatment_information.items.length > 0 && (
            <div className="card" style={{ marginTop: 16 }}>
              <div className="card-title">
                <h3>TREATMENT INFORMATION — Clinician review required</h3>
                <Provenance kind="inferred" label="Knowledge base" />
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
                  <div className="finding-actions">
                    <button className="btn authority sm" onClick={() => act("treatment_accept", undefined, undefined, { condition_id: item.condition_id })} disabled={busy}>Accept</button>
                    <button className="btn danger sm" onClick={() => act("treatment_reject", undefined, undefined, { condition_id: item.condition_id })} disabled={busy}>Reject</button>
                    <button className="btn secondary sm" onClick={() => withMedication("Add medication", "treatment_add_medication", item.condition_id)} disabled={busy}>Add medication</button>
                    <button className="btn secondary sm" onClick={() => withMedication("Remove medication", "treatment_remove_medication", item.condition_id)} disabled={busy}>Remove medication</button>
                    <button className="btn secondary sm" onClick={() => withNote("Mark contraindication", "Contraindication note", "treatment_mark_contraindication", item.condition_id)} disabled={busy}>Mark contraindication</button>
                    <button className="btn secondary sm" onClick={() => withNote("Mark patient-specific restriction", "Patient-specific restriction note", "treatment_mark_restriction", item.condition_id)} disabled={busy}>Mark restriction</button>
                    <button className="btn ghost sm" onClick={() => withNote("Add clinical note", "Clinical note", "treatment_note", item.condition_id)} disabled={busy}>Add note</button>
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
        </>
      )}

      {bundle?.reviewEvents && bundle.reviewEvents.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-title"><h3>Immutable review event history</h3><Badge tone="info">{bundle.reviewEvents.length} event(s)</Badge></div>
          <p className="tiny muted">Events are append-only. A concurrent projection conflict is never silently resolved in the UI.</p>
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Review event history">
            <table className="table"><thead><tr><th scope="col">Time</th><th scope="col">Reviewer</th><th scope="col">Action</th><th scope="col">Finding</th><th scope="col">Reason</th></tr></thead>
              <tbody>{bundle.reviewEvents.map((event) => <tr key={event.review_event_id}><td className="num">{new Date(event.created_at).toLocaleString()}</td><td>{event.reviewer_id}</td><td>{event.action.replaceAll("_", " ")}</td><td>{event.finding_id ?? "report"}</td><td>{event.reason}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ClinicianPage() {
  return (
    <Suspense fallback={<div className="page-loading" role="status"><span className="spinner" aria-hidden="true" />Loading clinical review…</div>}>
      <ClinicianInner />
    </Suspense>
  );
}
