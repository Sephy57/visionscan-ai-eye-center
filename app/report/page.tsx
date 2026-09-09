"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui";
import { presentQuality } from "@/lib/analysis/qualityPresentation";

interface Report {
  report_id: string; study_id: string; generated_at: string;
  validation_banner: string; demo_label: string;
  patient: { identifier?: string | null; age_band?: string | null; notes?: string | null };
  analysis_mode?: string;
  asset_routing?: { container_type: string; modality: string; modality_state: string; device_state: string; domain_state: string; source_hash: string; warnings: string[] };
  document_routing?: Array<{ document_id: string; document_modality: string; pages: Array<{ page: number; content_type: string; modality: string; laterality: string; classifier_method: string; verification_state: string; source_page_hash?: string }>; measurements: Array<{ key: string; value_raw: string; value_normalized: number | null; unit: string | null; laterality: string; page: number; verification_status: string }>; image_regions: Array<{ region_id: string; page: number; content_type: string; laterality: string; bbox: { x: number; y: number; w: number; h: number }; roi_hash: string; source_page_hash: string; verification_status: string }> }>;
  model_execution?: { models_attempted: string[]; models_executed: string[]; models_failed: string[]; models_skipped: Array<{ model_id: string; reason: string }>; artifact_hashes: Record<string, string | null>; artifact_verification?: Record<string, string>; model_versions: Record<string, string>; runtime_status: string };
  model_execution_ledger?: Array<{ model_id: string; model_version: string; task: string; artifact_hash: string | null; input_asset_id: string; input_roi_id: string | null; laterality: string; eligibility: string; execution_status: string; skip_reason: string | null; quality_status: string; domain_status: string; runtime_ms: number; output_contract_version: string | null; validation_status: string; dependency_group_id: string }>;
  oct_region_results?: Array<{ asset_id: string; document_id: string; page: number; laterality: string; source_page_hash: string; roi_hash: string; content_type: string; status: string; note?: string }>;
  oct_aggregation?: string;
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
  coverage_snapshot?: {
    registry_version: string; production_targets: string[]; general_detector_state: string;
    candidate_targets_not_run: string[]; unsupported_targets: string[]; notice: string;
  };
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

interface EvidenceWorkspaceSummary {
  evidence: Array<{ id: string; source_type: string; category: string; laterality: string; presence: string; qualitative_finding?: string; value?: number; unit?: string }>;
  conflicts: Array<{ id: string; category: string; severity: string; note: string }>;
  possible_conditions: Array<{ canonical_name: string; laterality: string; state: string; missing_required: string[]; note: string }>;
  examination_context?: { source_count?: { symptoms?: number; test_results?: number; ai_findings?: number; source_document_diagnoses?: number; history?: number; medications?: number; allergies?: number } };
}

function ReportInner() {
  const params = useSearchParams();
  const study = params.get("study") ?? "";
  const [report, setReport] = useState<Report | null>(null);
  const [evidence, setEvidence] = useState<EvidenceWorkspaceSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!study) { setErr("No study id supplied."); return; }
    fetch(`/api/studies/${encodeURIComponent(study)}`)
      .then((r) => r.json())
      .then((json) => { if (!json.report) setErr(json.error ?? "Report not found"); else setReport(json.report); })
      .catch(() => setErr("Failed to load report"));
    fetch(`/api/studies/${encodeURIComponent(study)}/evidence`)
      .then((r) => r.ok ? r.json() : null)
      .then((json) => { if (json) setEvidence(json as EvidenceWorkspaceSummary); })
      .catch(() => { /* evidence is additive; report remains usable */ });
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
          <Badge tone={report.analysis_mode === "DEMO_ONLY" ? "demo" : report.analysis_mode === "MODEL_FAILED" ? "bad" : "info"}>{report.demo_label}</Badge>
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
          <dt>Analysis mode</dt><dd>{(report.analysis_mode ?? "UNKNOWN").replaceAll("_", " ")}</dd>
          <dt>Generated at</dt><dd>{new Date(report.generated_at).toLocaleString()}</dd>
        </dl>
      </div>

      <div className={`result-hero ${!report.image_quality.acceptable ? "reject" : report.analysis_mode === "DEMO_ONLY" && report.overall_result.includes("NO TARGET") ? "normal" : "abnormal"}`} style={{ padding: 24 }}>
        <div className="eyebrow">SCREENING RESULT</div>
        <h2>{report.overall_result}</h2>
        <p className="small" style={{ margin: 0 }}>
          {report.image_quality.acceptable
            ? report.analysis_mode === "MODEL_FAILED"
              ? "Applicable research model execution failed. No finding was inferred and no synthetic replacement was used."
              : report.analysis_mode === "NO_MODEL_EXECUTED"
                ? "No compatible research model executed for this asset. This is not evidence of normality."
              : report.overall_result.includes("NO TARGET")
                ? "No target abnormality was identified by the available model. This does not exclude other eye disease."
                : "Findings below are automated screening signals. They are not diagnoses."
            : "Image quality is insufficient for reliable automated analysis. No clinical interpretation was generated."}
        </p>
      </div>

      {report.coverage_snapshot && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Automated imaging coverage</h2>
          <dl className="kv">
            <dt>General detector</dt><dd>{report.coverage_snapshot.general_detector_state.replaceAll("_", " ")}</dd>
            <dt>Active production targets</dt><dd>{report.coverage_snapshot.production_targets.length ? report.coverage_snapshot.production_targets.join(", ") : "None"}</dd>
            <dt>Candidate targets not run</dt><dd>{report.coverage_snapshot.candidate_targets_not_run.map((v) => v.replaceAll("_", " ")).join(", ") || "None"}</dd>
            <dt>Unsupported / unavailable targets</dt><dd>{report.coverage_snapshot.unsupported_targets.map((v) => v.replaceAll("_", " ")).join(", ")}</dd>
          </dl>
          <p className="tiny muted" style={{ marginBottom: 0 }}>{report.coverage_snapshot.notice} Registry {report.coverage_snapshot.registry_version}.</p>
        </div>
      )}

      {report.asset_routing && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Uploaded assets</h2>
          <dl className="kv">
            <dt>Container</dt><dd>{report.asset_routing.container_type}</dd>
            <dt>Content modality</dt><dd>{report.asset_routing.modality.replaceAll("_", " ")}</dd>
            <dt>Modality state</dt><dd>{report.asset_routing.modality_state.replaceAll("_", " ")}</dd>
            <dt>Device state</dt><dd>{report.asset_routing.device_state.replaceAll("_", " ")}</dd>
            <dt>Domain state</dt><dd>{report.asset_routing.domain_state.replaceAll("_", " ")}</dd>
          </dl>
          {report.oct_region_results && report.oct_region_results.length > 0 && (
            <div className="table-wrap" tabIndex={0} style={{ marginTop: 10 }}><table className="table"><thead><tr><th>PDF page</th><th>Content</th><th>Eye</th><th>Execution</th><th>B-box / ROI hash</th></tr></thead><tbody>
              {report.oct_region_results.map((region) => <tr key={region.asset_id}><td>{region.page}</td><td>{region.content_type}</td><td>{region.laterality}</td><td>{region.status}</td><td className="tiny">{region.roi_hash.slice(0, 12)}…</td></tr>)}
            </tbody></table></div>
          )}
          {report.oct_aggregation && <p className="tiny muted" style={{ marginBottom: 0 }}>OCT scan aggregation: {report.oct_aggregation.replaceAll("_", " ")} (categorical; logits are not averaged).</p>}
          {report.document_routing?.map((doc) => <div key={doc.document_id} style={{ marginTop: 12 }}><strong className="small">Document {doc.document_id}</strong><div className="table-wrap" tabIndex={0}><table className="table"><thead><tr><th>Page</th><th>Content type</th><th>Laterality</th><th>Method</th><th>Verification</th></tr></thead><tbody>{doc.pages.map((p) => <tr key={`${doc.document_id}-${p.page}`}><td>{p.page}</td><td>{p.content_type}</td><td>{p.laterality}</td><td>{p.classifier_method}</td><td>{p.verification_state}</td></tr>)}</tbody></table></div>{doc.measurements.length > 0 && <p className="tiny muted">Measurements (unreviewed): {doc.measurements.map((m) => `${m.key.replaceAll("_", " ")}=${m.value_normalized ?? m.value_raw}${m.unit ? ` ${m.unit}` : ""} (${m.laterality}, p${m.page})`).join(" · ")}</p>}</div>)}
        </div>
      )}

      {report.model_execution && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Model execution</h2>
          <div className="table-wrap" tabIndex={0}><table className="table"><thead><tr><th>Model</th><th>Version</th><th>Execution</th><th>Artifact hash</th></tr></thead><tbody>
            {[...new Set([...report.model_execution.models_attempted, ...report.model_execution.models_failed, ...report.model_execution.models_skipped.map((x) => x.model_id)])].map((id) => {
              const status = report.model_execution!.models_executed.includes(id) ? "EXECUTED" : report.model_execution!.models_failed.includes(id) ? "FAILED" : "SKIPPED";
              const verification = report.model_execution!.artifact_verification?.[id] ?? (report.model_execution!.artifact_hashes[id] ? "EXPECTED_REGISTRY_HASH" : "UNAVAILABLE");
              return <tr key={id}><td>{id}</td><td>{report.model_execution!.model_versions[id] ?? "—"}</td><td>{status}</td><td className="tiny">{verification} {report.model_execution!.artifact_hashes[id] ? `${report.model_execution!.artifact_hashes[id]!.slice(0, 12)}…` : ""}</td></tr>;
            })}
          </tbody></table></div>
          <p className="tiny muted" style={{ marginBottom: 0 }}>Runtime: {report.model_execution.runtime_status}. RESEARCH output is uncalibrated and requires clinician review.</p>
        </div>
      )}

      {report.model_execution_ledger && (
        <div className="card">
          <div className="card-title"><h2 style={{ marginTop: 0 }}>Input / model execution ledger</h2><Badge tone="info">{report.model_execution_ledger.length} row(s)</Badge></div>
          <p className="tiny muted">Server-derived rows retain asset/ROI lineage, gate state, runtime, and dependency groups. This is an execution record, not a clinical conclusion.</p>
          <div className="table-wrap" tabIndex={0}><table className="table"><thead><tr><th>Task / model</th><th>Asset / ROI</th><th>Eye</th><th>Eligibility</th><th>Status</th><th>Quality / domain</th><th>Runtime</th></tr></thead><tbody>
            {report.model_execution_ledger.map((row, i) => <tr key={`${row.model_id}-${row.input_asset_id}-${i}`}><td><strong>{row.task.replaceAll("_", " ")}</strong><div className="tiny muted">{row.model_id} v{row.model_version}</div></td><td className="tiny">{row.input_asset_id.slice(0, 16)}…{row.input_roi_id ? <div>ROI {row.input_roi_id.slice(0, 12)}…</div> : null}</td><td>{row.laterality}</td><td>{row.eligibility}</td><td>{row.execution_status}{row.skip_reason ? <div className="tiny muted">{row.skip_reason}</div> : null}</td><td className="tiny">{row.quality_status} / {row.domain_status}</td><td>{row.runtime_ms} ms</td></tr>)}
          </tbody></table></div>
        </div>
      )}

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

      {evidence && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Clinical record evidence</h2>
          <p className="tiny muted" style={{ marginTop: 0 }}>Documented symptoms, objective tests, source claims, and research findings are kept as separate evidence types. This section does not create a diagnosis.</p>
          <div className="table-wrap" tabIndex={0}>
            <table className="table">
              <thead><tr><th>Source</th><th>Items</th></tr></thead>
              <tbody>{Object.entries(evidence.examination_context?.source_count ?? {}).map(([key, value]) => <tr key={key}><td>{key.replaceAll("_", " ")}</td><td>{value ?? 0}</td></tr>)}</tbody>
            </table>
          </div>
          {evidence.conflicts.length > 0 && <div className="alert warn" style={{ marginTop: 10 }}><div className="alert-body"><strong>Unresolved evidence conflicts ({evidence.conflicts.length})</strong><div className="tiny">{evidence.conflicts.map((c) => `${c.category} (${c.severity})`).join(" · ")}</div></div></div>}
          {evidence.possible_conditions.length > 0 && <details style={{ marginTop: 10 }}><summary className="small" style={{ cursor: "pointer", fontWeight: 650 }}>Evidence patterns and missing confirmation</summary><ul className="tiny muted" style={{ margin: "6px 0", paddingLeft: 18 }}>{evidence.possible_conditions.map((c, i) => <li key={i}><strong>{c.canonical_name}</strong> ({c.laterality}) — {c.state.replaceAll("_", " ")}. {c.missing_required.length ? `Missing: ${c.missing_required.join(", ")}` : c.note}</li>)}</ul></details>}
        </div>
      )}

      {report.patient_context?.reported && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Reported symptoms</h2>
          <div className="table-wrap" tabIndex={0}>
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
        <div className="table-wrap" tabIndex={0}>
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
            <div className="table-wrap" tabIndex={0}>
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
