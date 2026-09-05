"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui";
import { presentQuality } from "@/lib/analysis/qualityPresentation";

interface Report {
  report_id: string; study_id: string; generated_at: string;
  validation_banner: string; demo_label: string;
  patient: { identifier?: string | null; age_band?: string | null; notes?: string | null };
  study: { modality: string; eye: string; source: string; captured_at?: string | null; metadata_provenance: string };
  image_quality: { score: number; status: string; acceptable: boolean; artifacts: string[] };
  overall_result: string;
  findings: Array<{ id: string; type: string; location: string; severity: string; confidence: number; confidence_category: string; explanation: string; synthetic: boolean }>;
  possible_associations_note: string;
  uncertainty: { overall: number; reasons: string[] };
  patient_context?: {
    reported: boolean;
    symptoms: Array<{ type: string; label?: string; onset: string; duration: string; severity: string; laterality: string; progression: string; frequency: string; free_text?: string | null }>;
    red_flags: string[];
    note: string;
  };
  symptom_correlation?: {
    state: string;
    urgency: string;
    items: Array<{ symptom_type: string; symptom_label: string; state: string; matched_finding_types: string[]; note: string }>;
    notes: string[];
    label: string;
  };
  possible_conditions?: { conditions: Array<{ id: string; label: string; matched_findings: string[]; commonly_associated_symptoms: string[]; note: string }>; note: string } | null;
  treatment_information?: {
    items: Array<{
      condition_id: string; condition_label: string; available: boolean; reason: string;
      approaches: Array<{
        approach_label: string; purpose: string; evidence_reference: string;
        medications: Array<{ medication_id: string; generic_name: string; drug_class: string; purpose: string; route: string[]; common_contraindications: string[]; warnings: string[]; common_adverse_effects: string[]; evidence_references: string[] }>;
      }>;
      label: string;
    }>;
    dosage_notice: string;
    interaction_notice: string;
    note: string;
  } | null;
  treatment_review?: {
    reviewer_id: string;
    decisions: Array<{ condition_id: string; decision: string; added_medication_ids?: string[]; removed_medication_ids?: string[]; contraindication_note?: string; patient_restriction_note?: string; clinical_note?: string; at: string }>;
  } | null;
  measurements_note: string;
  limitations: string[];
  recommended_next_step: string;
  triage_priority: string;
  review: { status: string; reviewer_id?: string; finalized_at?: string; clinician_changes?: Array<{ field: string; action: string; at: string }> };
  clinician_interpretation?: { reviewer_id: string; overall: string; notes?: string | null } | null;
  clinician_corrections?: Array<{ finding_id: string; original: { type: string; location: string; severity: string; explanation: string }; correction: Record<string, string>; reviewer_id: string; note?: string; at: string }>;
  clinician_observations?: Array<{ observation_id: string; text: string; laterality?: string; reviewer_id: string; at: string }>;
  final_interpretation?: string | null;
  clinician_final_assessment?: { diagnosis?: string | null; impression?: string | null; plan?: string | null; follow_up?: string | null; reviewer_id: string; at: string } | null;
  provenance: { models: Array<Record<string, unknown>>; ruleset_version: string; analyzed_at: string; pipeline_version: string };
  diagnosis_gate?: { allowed: boolean; reasons: string[]; clinical_interpretation: "DIAGNOSIS" | "REQUIRES_CLINICAL_CORRELATION" };
  safety: { disclaimers: string[]; blocked_claims: string[] };
  exports: { json_path?: string; fhir_note: string };
}

function ReportInner() {
  const params = useSearchParams();
  const study = params.get("study") ?? "";
  const [report, setReport] = useState<Report | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!study) { setErr("No study id supplied."); return; }
    fetch(`/api/studies/${encodeURIComponent(study)}`)
      .then((r) => r.json())
      .then((json) => { if (!json.report) setErr(json.error ?? "Report not found"); else setReport(json.report); })
      .catch(() => setErr("Failed to load report"));
  }, [study]);

  if (err) return <div className="alert danger"><span className="alert-icon" aria-hidden="true">⚠</span><div className="alert-body"><strong>Report unavailable</strong>{err}</div></div>;
  if (!report) return <div style={{ display: "flex", justifyContent: "center", padding: 60 }}><div className="spinner" /></div>;

  const qp = presentQuality({ quality_status: report.image_quality.status, detected_artifacts: report.image_quality.artifacts });

  function downloadJson() {
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${report!.report_id}.json`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{ maxWidth: 860, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }} className="no-print">
        <div>
          <div className="tiny" style={{ color: "var(--text-3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>Clinical screening report</div>
          <h1 style={{ marginBottom: 0 }}>Report</h1>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn secondary sm" onClick={() => window.print()}>Print / PDF</button>
          <button className="btn secondary sm" onClick={downloadJson}>Download JSON</button>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <span className="logo-mark" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 5C6.5 5 2.6 9.6 1.5 12c1.1 2.4 5 7 10.5 7s9.4-4.6 10.5-7C21.4 9.6 17.5 5 12 5z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/><circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="2"/></svg>
          </span>
          <strong>VisionScan AI</strong>
          <Badge tone="warn">{report.validation_banner}</Badge>
          <Badge tone="demo">{report.demo_label}</Badge>
        </div>

        <h2>Study information</h2>
        <dl className="kv">
          <dt>Report ID</dt><dd>{report.report_id}</dd>
          <dt>Study ID</dt><dd>{report.study_id}</dd>
          <dt>Modality</dt><dd>{report.study.modality}</dd>
          <dt>Laterality</dt><dd>{report.study.eye}</dd>
          <dt>Source</dt><dd>{report.study.source}</dd>
          <dt>Acquisition date</dt><dd>{report.study.captured_at ?? "Not provided"}</dd>
          <dt>Metadata provenance</dt><dd>{report.study.metadata_provenance}</dd>
          <dt>Generated at</dt><dd>{new Date(report.generated_at).toLocaleString()}</dd>
        </dl>
      </div>

      <div className={`result-hero ${report.image_quality.acceptable ? (report.findings.length ? "abnormal" : "normal") : "reject"}`} style={{ padding: 24 }}>
        <div className="eyebrow">SCREENING RESULT</div>
        <h2>{report.overall_result}</h2>
        <p className="small" style={{ margin: 0 }}>
          {report.image_quality.acceptable
            ? report.findings.length === 0
              ? "This result means the system did not identify a significant abnormality in the supplied image under the conditions of this analysis. It does not guarantee that no eye disease is present."
              : "Findings below are automated screening signals. They are not diagnoses."
            : "Image quality is insufficient for reliable automated analysis. No clinical interpretation was generated."}
        </p>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Image quality <Badge tone={qp.blocked ? "bad" : report.image_quality.artifacts.length > 0 ? "warn" : "ok"}>{qp.overall_label}</Badge></h2>
        <dl className="kv">
          <dt>Quality score</dt><dd>{report.image_quality.score} ({report.image_quality.status})</dd>
          <dt>Acceptable</dt><dd>{report.image_quality.acceptable ? "Yes" : "No"}</dd>
          <dt>Detected artifacts</dt><dd>{report.image_quality.artifacts.join(", ") || "None"}</dd>
        </dl>
        {/* S12: honest quality presentation - a "pass" status can still carry
            real artifacts; never shown as bare "GOOD" when one was detected. */}
        <p className="tiny muted" style={{ margin: "8px 0 0" }}>{qp.impact_note}</p>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Findings ({report.findings.length})</h2>
        {report.findings.length === 0 && <p className="muted small">No findings recorded in this report.</p>}
        {report.findings.map((f) => (
          <div key={f.id} style={{ borderTop: "1px solid var(--border)", padding: "12px 0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <strong className="small" style={{ letterSpacing: "0.02em" }}>{f.type.replaceAll("_", " ").toUpperCase()}</strong>
              {f.synthetic && <Badge tone="demo">Synthetic</Badge>}
            </div>
            <dl className="kv" style={{ marginTop: 6 }}>
              <dt>Location</dt><dd>{f.location.replaceAll("_", " ")}</dd>
              <dt>Severity</dt><dd style={{ textTransform: "capitalize" }}>{f.severity}</dd>
              <dt>Confidence</dt><dd>{f.confidence_category} ({f.confidence})</dd>
            </dl>
            <p className="small muted" style={{ marginTop: 6 }}>{f.explanation}</p>
          </div>
        ))}
      </div>

      {report.patient_context?.reported && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Reported symptoms</h2>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Symptom</th><th>Onset</th><th>Duration</th><th>Severity</th><th>Eye</th><th>Progression</th></tr></thead>
              <tbody>
                {report.patient_context.symptoms.map((s, i) => (
                  <tr key={i}>
                    <td>{s.label ?? s.type.replaceAll("_", " ")}{report.patient_context!.red_flags.includes(s.type) ? " ⚠" : ""}</td>
                    <td>{s.onset}</td>
                    <td>{s.duration.replaceAll("_", " ")}</td>
                    <td>{s.severity}</td>
                    <td>{s.laterality === "right" ? "Right (OD)" : s.laterality === "left" ? "Left (OS)" : s.laterality}</td>
                    <td>{s.progression}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {report.patient_context.symptoms.some((s) => s.free_text) && (
            <p className="small muted">Description: {report.patient_context.symptoms.filter((s) => s.free_text).map((s) => s.free_text).join(" | ")}</p>
          )}
          <p className="tiny muted" style={{ marginBottom: 0 }}>{report.patient_context.note}</p>
        </div>
      )}

      {report.symptom_correlation && report.patient_context?.reported && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Symptom / imaging correlation <Badge tone="warn">{report.symptom_correlation.label}</Badge></h2>
          {report.symptom_correlation.items.map((item, i) => (
            <div key={i} style={{ borderTop: "1px solid var(--border)", paddingTop: 10, marginTop: i === 0 ? 0 : 10 }}>
              <strong className="small">{item.symptom_label}</strong> — {item.state.replaceAll("_", " ")}
              <p className="small muted" style={{ margin: "4px 0 0" }}>{item.note}</p>
            </div>
          ))}
          <p className="tiny muted" style={{ margin: "10px 0 0" }}>
            Overall state: {report.symptom_correlation.state.replaceAll("_", " ")} • Urgency: {report.symptom_correlation.urgency}.{" "}
            {report.symptom_correlation.notes.join(" ")}
          </p>
        </div>
      )}

      {report.possible_conditions && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Possible conditions to consider</h2>
          {report.possible_conditions.conditions.length === 0 ? (
            <p className="small muted" style={{ margin: 0 }}>No condition associations met the evidence requirements for display (model not validated).</p>
          ) : (
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
              {report.possible_conditions.conditions.map((c) => (
                <li key={c.id} style={{ marginBottom: 6 }}>
                  <strong>{c.label}</strong> — {c.note} (matched findings: {c.matched_findings.join(", ")})
                  {c.commonly_associated_symptoms.length > 0 && (
                    <div className="tiny muted">
                      Commonly associated symptoms (knowledge base — not necessarily reported by this patient):{" "}
                      {c.commonly_associated_symptoms.map((s) => s.replaceAll("_", " ")).join(", ")}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="tiny muted" style={{ marginBottom: 0, marginTop: 8 }}>{report.possible_conditions.note}</p>
        </div>
      )}

      {report.treatment_information && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Treatment information <Badge tone="warn">Clinician review required</Badge></h2>
          {report.treatment_information.items.length === 0 ? (
            <p className="small muted" style={{ margin: 0 }}>No treatment information is registered for the conditions above.</p>
          ) : (
            report.treatment_information.items.map((item) => (
              <div key={item.condition_id} style={{ borderTop: "1px solid var(--border)", paddingTop: 10, marginTop: 10 }}>
                <strong className="small">{item.condition_label}</strong>
                {item.available ? (
                  item.approaches.map((ap, i) => (
                    <div key={i} className="small" style={{ marginTop: 4 }}>
                      <strong>{ap.approach_label}</strong> — {ap.purpose}
                      {ap.medications.length > 0 && (
                        <ul className="tiny muted" style={{ margin: "4px 0 0", paddingLeft: 16 }}>
                          {ap.medications.map((m) => <li key={m.medication_id}>{m.generic_name} ({m.drug_class})</li>)}
                        </ul>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="small muted" style={{ margin: "4px 0 0" }}>{item.reason}</p>
                )}
              </div>
            ))
          )}
          {report.treatment_review && report.treatment_review.decisions.length > 0 && (
            <div style={{ marginTop: 10, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
              <p className="tiny muted" style={{ margin: "0 0 4px" }}>Clinician disposition (recorded separately from the AI-generated information above):</p>
              {report.treatment_review.decisions.map((d, i) => (
                <p key={i} className="tiny muted" style={{ margin: "2px 0" }}>
                  {d.condition_id}: {d.decision}
                  {d.contraindication_note ? ` — contraindication noted: ${d.contraindication_note}` : ""}
                  {d.patient_restriction_note ? ` — restriction noted: ${d.patient_restriction_note}` : ""}
                  {d.clinical_note ? ` — ${d.clinical_note}` : ""}
                  {" "}(by {report.treatment_review!.reviewer_id}, {new Date(d.at).toLocaleString()})
                </p>
              ))}
            </div>
          )}
          {report.treatment_information.items.length > 0 && (
            <p className="tiny muted" style={{ marginBottom: 0, marginTop: 8 }}>
              {report.treatment_information.dosage_notice} {report.treatment_information.interaction_notice}{" "}
              {report.treatment_information.note}
            </p>
          )}
        </div>
      )}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Measurements</h2>
        <p className="small muted" style={{ margin: 0 }}>{report.measurements_note}</p>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Possible clinical associations</h2>
        <p className="small muted" style={{ margin: 0 }}>{report.possible_associations_note}</p>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Uncertainty</h2>
        {/* S12: relabeled - this is a heuristic score from the DEMO pipeline's
            quality/agreement heuristics, not calibrated model confidence; a
            bare percentage here could be misread as AI confidence. */}
        <p className="small"><strong>Heuristic uncertainty score (not calibrated confidence): {(report.uncertainty.overall * 100).toFixed(0)}%</strong></p>
        <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
          {report.uncertainty.reasons.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>AI model information</h2>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Model</th><th>Version</th><th>Implementation</th><th>Validation status</th></tr></thead>
            <tbody>
              {report.provenance.models.map((m, i) => (
                <tr key={i}>
                  <td>{String(m.model_id)}</td>
                  <td>{String(m.model_version)}</td>
                  <td>{String(m.implementation)}</td>
                  <td><Badge tone="warn">{String(m.validation_status)}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <details className="tech" style={{ marginTop: 10 }}>
          <summary>Advanced technical information</summary>
          <dl className="kv">
            <dt>Pipeline version</dt><dd>{report.provenance.pipeline_version}</dd>
            <dt>Ruleset version</dt><dd>{report.provenance.ruleset_version}</dd>
            <dt>Heuristic uncertainty score</dt><dd>{(report.uncertainty.overall * 100).toFixed(0)}% (not calibrated confidence)</dd>
            <dt>Clinical interpretation gate</dt>
            <dd>
              {report.diagnosis_gate?.clinical_interpretation === "DIAGNOSIS" ? "DIAGNOSIS" : "REQUIRES CLINICAL CORRELATION"}
              {report.diagnosis_gate && report.diagnosis_gate.reasons.length > 0 ? ` — ${report.diagnosis_gate.reasons.join(" ")}` : ""}
            </dd>
          </dl>
        </details>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Clinician review</h2>
        <dl className="kv">
          <dt>Review status</dt>
          <dd>{report.review.status}{report.review.reviewer_id ? ` by ${report.review.reviewer_id}` : ""}{report.review.finalized_at ? ` at ${new Date(report.review.finalized_at).toLocaleString()}` : ""}</dd>
        </dl>
        {report.clinician_interpretation && (
          <dl className="kv" style={{ marginTop: 10 }}>
            <dt>Clinician interpretation</dt>
            <dd>{report.clinician_interpretation.overall.replaceAll("_", " ")} — {report.clinician_interpretation.reviewer_id}</dd>
            {report.clinician_interpretation.notes && (<><dt>Notes</dt><dd className="small">{report.clinician_interpretation.notes}</dd></>)}
          </dl>
        )}
        {report.final_interpretation && (
          <div className="alert ok" style={{ marginBottom: 0 }}>
            <span className="alert-icon" aria-hidden="true">✓</span>
            <div className="alert-body"><strong>Final interpretation</strong>{report.final_interpretation}</div>
          </div>
        )}
        {report.clinician_final_assessment && (
          <div className="card" style={{ marginTop: 12, marginBottom: 0, background: "var(--surface-2)" }}>
            <h3 style={{ marginTop: 0 }}>Clinician final assessment</h3>
            <dl className="kv">
              {(["diagnosis", "impression", "plan", "follow_up"] as const).map((field) => report.clinician_final_assessment?.[field] ? <><dt key={`${field}-dt`}>{field.replace("_", " ")}</dt><dd key={`${field}-dd`}>{report.clinician_final_assessment![field]}</dd></> : null)}
            </dl>
            <p className="tiny muted" style={{ marginBottom: 0 }}>Entered by {report.clinician_final_assessment.reviewer_id} · {new Date(report.clinician_final_assessment.at).toLocaleString()}</p>
          </div>
        )}
        {report.clinician_corrections && report.clinician_corrections.length > 0 && (
          <div className="alert warn" style={{ marginTop: 10, marginBottom: 0 }}>
            <div className="alert-body">
              <strong>Clinician amendments (original AI findings preserved)</strong>
              {report.clinician_corrections.map((c) => (
                <div key={`${c.finding_id}-${c.at}`} className="tiny" style={{ marginTop: 4 }}>
                  {c.finding_id}: {Object.entries(c.correction).map(([k, v]) => `${k}=${v}`).join(", ")} · {c.reviewer_id}
                  {c.note ? ` — ${c.note}` : ""}
                </div>
              ))}
            </div>
          </div>
        )}
        {report.clinician_observations && report.clinician_observations.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <strong className="small">Clinician observations (additive)</strong>
            {report.clinician_observations.map((o) => (
              <p key={o.observation_id} className="tiny muted" style={{ margin: "4px 0" }}>
                {o.text}{o.laterality ? ` · ${o.laterality}` : ""} · {o.reviewer_id}
              </p>
            ))}
          </div>
        )}
        {report.review.clinician_changes && report.review.clinician_changes.length > 0 && (
          <details className="tech" style={{ marginTop: 10 }}>
            <summary>Review trail ({report.review.clinician_changes.length} actions)</summary>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Field</th><th>Action</th><th>At</th></tr></thead>
                <tbody>
                  {report.review.clinician_changes.map((c, i) => (
                    <tr key={i}><td>{c.field}</td><td>{c.action}</td><td className="small">{new Date(c.at).toLocaleString()}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </div>

      <div className="alert warn">
        <span className="alert-icon" aria-hidden="true">→</span>
        <div className="alert-body">
          <strong>Recommended next step</strong>
          {report.recommended_next_step}
          <div className="tiny muted" style={{ marginTop: 4 }}>Triage priority: {report.triage_priority}</div>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Limitations</h2>
        <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
          {report.limitations.map((l, i) => <li key={i}>{l}</li>)}
        </ul>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Interoperability &amp; audit</h2>
        <p className="small muted" style={{ margin: 0 }}>{report.exports.fhir_note}</p>
        <p className="tiny muted" style={{ marginTop: 8 }}>
          Audit: every analysis records model versions, checksums, quality score, uncertainty, and ruleset version.
          Original scans preserved unchanged (SHA-256 verified). No clinician signatures are generated by this
          system; a report becomes a clinical document only after qualified professional review and finalization.
        </p>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Safety disclaimers</h2>
        <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
          {report.safety.disclaimers.map((d, i) => <li key={i}>{d}</li>)}
        </ul>
      </div>
    </div>
  );
}

export default function ReportPage() {
  return (
    <Suspense fallback={<div style={{ display: "flex", justifyContent: "center", padding: 60 }}><div className="spinner" /></div>}>
      <ReportInner />
    </Suspense>
  );
}
