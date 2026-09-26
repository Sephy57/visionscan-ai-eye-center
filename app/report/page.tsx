"use client";

import { Fragment, useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Badge, EmptyState, PageHeader, Provenance, SafetyBoundary, StatePanel, shortId } from "@/components/ui";
import { Icon } from "@/components/icons";
import { DASHBOARD_STATUS_META } from "@/lib/reports/terminology";
import { presentQuality } from "@/lib/analysis/qualityPresentation";

interface Report {
  report_id: string; study_id: string; generated_at: string;
  validation_banner: string; demo_label: string;
  legacy_status?: "LEGACY_UNSEALED"; legacy_warning?: string;
  patient: { identifier?: string | null; age_band?: string | null; notes?: string | null };
  analysis_mode?: string;
  asset_routing?: { container_type: string; modality: string; modality_state: string; device_state: string; domain_state: string; source_hash: string; warnings: string[] };
  document_routing?: Array<{ document_id: string; document_modality: string; pages: Array<{ page: number; content_type: string; modality: string; laterality: string; classifier_method: string; verification_state: string; source_page_hash?: string }>; measurements: Array<{ key: string; value_raw: string; value_normalized: number | null; unit: string | null; laterality: string; page: number; verification_status: string }>; image_regions: Array<{ region_id: string; page: number; content_type: string; laterality: string; bbox: { x: number; y: number; w: number; h: number }; roi_hash: string; source_page_hash: string; verification_status: string }> }>;
  model_execution?: { models_attempted: string[]; models_executed: string[]; models_failed: string[]; models_skipped: Array<{ model_id: string; reason: string }>; artifact_hashes: Record<string, string | null>; artifact_verification?: Record<string, string>; model_versions: Record<string, string>; runtime_status: string };
  model_execution_ledger?: Array<{ model_id: string; model_version: string; task: string; artifact_hash: string | null; input_asset_id: string; input_roi_id: string | null; laterality: string; eligibility: string; execution_status: string; skip_reason: string | null; quality_status: string; domain_status: string; runtime_ms: number; output_contract_version: string | null; validation_status: string; dependency_group_id: string }>;
  claim_ledger?: { schema_version: string; entries: Array<{ claim_id: string; claim_type: string; text: string; release_status: string; evidence_refs: string[]; laterality: string; certainty?: string; source_ids?: string[]; model_execution_ids?: string[]; rule_ids?: string[]; knowledge_source_ids?: string[]; provenance: { model_id: string | null; model_version: string | null; model_status: string }; blocked_reasons: string[]; clinician_review_required: true }>; publication_status: string; publication_blocked: boolean; note: string };
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

function ReportIndex() {
  const [rows, setRows] = useState<Array<{ study_id: string; created_at: string; modality: string; eye: string; patient_ref?: string | null; dashboard_status?: string; status: string }> | null>(null);
  useEffect(() => {
    fetch("/api/studies?with_status=1&limit=50").then((r) => (r.ok ? r.json() : { studies: [] })).then((j) => setRows(j.studies ?? [])).catch(() => setRows([]));
  }, []);
  const analyzed = (rows ?? []).filter((r) => r.status !== "uploaded");
  return (
    <div>
      <PageHeader eyebrow="Research reports" title="Reports" lede="Version-frozen research analysis reports. A report becomes a clinical document only after qualified professional review and finalization." />
      {!rows && <div className="loading-row" role="status"><span className="pulse-dot" aria-hidden="true" /> Loading reports…</div>}
      {rows && analyzed.length === 0 && (
        <EmptyState icon={<Icon name="reports" size={22} />} title="No reports yet" action={<Link className="btn" href="/analyze">Start a new analysis</Link>}>
          Reports are generated automatically when an analysis completes. No analyzed study is visible to your account yet.
        </EmptyState>
      )}
      {analyzed.length > 0 && (
        <div className="card flush">
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Reports">
            <table className="table">
              <caption className="sr-only">Research reports for analyzed studies</caption>
              <thead><tr><th scope="col">Study</th><th scope="col">Modality</th><th scope="col">Status</th><th scope="col">Created</th><th scope="col" className="actions">Open</th></tr></thead>
              <tbody>{analyzed.map((r) => (
                <tr key={r.study_id}>
                  <td>{r.patient_ref && <strong>{r.patient_ref} </strong>}<span className="id-cell">{shortId(r.study_id, 18)}</span></td>
                  <td>{r.modality.replaceAll("_", " ")} · {r.eye}</td>
                  <td><Badge tone={DASHBOARD_STATUS_META[r.dashboard_status ?? ""]?.tone ?? "neutral"}>{DASHBOARD_STATUS_META[r.dashboard_status ?? ""]?.label ?? "Uploaded"}</Badge></td>
                  <td className="small muted num">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="actions"><Link className="btn sm" href={`/report?study=${encodeURIComponent(r.study_id)}`}>Open report</Link></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

const SECTIONS: Array<[string, string]> = [
  ["study", "Study information"], ["summary", "Research summary"], ["quality", "Imaging quality"], ["findings", "Observed findings"],
  ["models", "Model assessments"], ["multimodal", "Multimodal evidence"], ["context", "Clinical context"], ["associations", "Possible associations"],
  ["review", "Clinician review"], ["limitations", "Limitations"], ["provenance", "Model / provenance"], ["audit", "Audit"], ["safety", "Safety boundary"],
];
const num = (id: string) => String(SECTIONS.findIndex(([k]) => k === id) + 1).padStart(2, "0");

function Section({ id, children, extra }: { id: string; children: React.ReactNode; extra?: React.ReactNode }) {
  const title = SECTIONS.find(([k]) => k === id)?.[1] ?? id;
  return (
    <section className="report-section" id={`r-${id}`} aria-labelledby={`r-${id}-title`}>
      <h2 id={`r-${id}-title`}><span className="section-index">{num(id)}</span>{title}{extra}</h2>
      {children}
    </section>
  );
}

function ReportInner() {
  const params = useSearchParams();
  const study = params.get("study") ?? "";
  const [report, setReport] = useState<Report | null>(null);
  const [evidence, setEvidence] = useState<EvidenceWorkspaceSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!study) return;
    fetch(`/api/studies/${encodeURIComponent(study)}`)
      .then((r) => r.json())
      .then((json) => { if (!json.report) setErr(json.error ?? "No report has been generated for this study yet."); else setReport(json.report); })
      .catch(() => setErr("Failed to load report"));
    fetch(`/api/studies/${encodeURIComponent(study)}/evidence`)
      .then((r) => r.ok ? r.json() : null)
      .then((json) => { if (json) setEvidence(json as EvidenceWorkspaceSummary); })
      .catch(() => { /* evidence is additive; report remains usable */ });
  }, [study]);

  if (!study) return <ReportIndex />;
  if (err) {
    return (
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <PageHeader eyebrow="Research report" title="Report unavailable" />
        <StatePanel tone="warn" icon="reports" role="alert" title="This report cannot be displayed"
          what={err}
          why="The analysis may not have completed, the study may have been deleted, or it is not visible to your account."
          next="Open the study's results workspace to check its analysis state, or choose another report."
          actions={<><Link className="btn" href="/report">All reports</Link><Link className="btn secondary" href={`/result?study=${encodeURIComponent(study)}`}>Results workspace</Link></>} />
      </div>
    );
  }
  if (!report) return <div className="page-loading" role="status"><span className="spinner" aria-hidden="true" />Loading report…</div>;

  const qp = presentQuality({ quality_status: report.image_quality.status, detected_artifacts: report.image_quality.artifacts });
  const finalized = report.review.status === "clinician_finalized";

  function downloadJson() {
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${report!.report_id}.json`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="report-doc">
      <div className="no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <Link className="btn ghost sm" href={`/result?study=${encodeURIComponent(study)}`}><Icon name="chevronLeft" size={14} /> Results workspace</Link>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link className="btn authority sm" href={`/clinician?study=${encodeURIComponent(study)}`}><Icon name="review" size={14} /> Clinical review</Link>
          <button className="btn secondary sm" onClick={() => window.print()}><Icon name="print" size={14} /> Print / PDF</button>
          <button className="btn secondary sm" onClick={downloadJson}><Icon name="download" size={14} /> Download JSON</button>
        </div>
      </div>

      <header className="report-masthead">
        <span className="logo-mark" aria-hidden="true"><Icon name="eye" size={18} /></span>
        <div>
          <div className="eyebrow">VisionScan AI Eye Center · Research analysis report</div>
          <h1>Report {shortId(report.report_id, 22)}</h1>
          <div className="masthead-sub">Generated {new Date(report.generated_at).toLocaleString()} · Study {shortId(report.study_id, 22)}</div>
        </div>
        <div style={{ display: "grid", gap: 6, justifyItems: "end" }}>
          <Badge tone="warn">{report.validation_banner}</Badge>
          <Badge tone={report.analysis_mode === "DEMO_ONLY" ? "demo" : report.analysis_mode === "MODEL_FAILED" ? "bad" : "info"}>{report.demo_label}</Badge>
          {finalized ? <Provenance kind="clinician" label="Clinician finalized" /> : <Badge tone="warn">Not finalized — AI research output only</Badge>}
        </div>
      </header>

      <div className="report-body">
        <nav className="report-toc" aria-label="Report sections">
          {SECTIONS.map(([id, title]) => <a key={id} href={`#r-${id}`}>{num(id)} {title}</a>)}
        </nav>

        {report.legacy_status === "LEGACY_UNSEALED" && (
          <div className="alert warn" role="alert">
            <span className="alert-icon" aria-hidden="true"><Icon name="warning" size={16} /></span>
            <div className="alert-body"><strong>Legacy report requires verification</strong><div>{report.legacy_warning ?? "This report has no immutable version freeze or reasoning snapshot."}</div></div>
          </div>
        )}

        <Section id="study">
          <dl className="kv">
            <dt>Report ID</dt><dd className="mono">{report.report_id}</dd>
            <dt>Study ID</dt><dd className="mono">{report.study_id}</dd>
            <dt>Modality</dt><dd>{report.study.modality}</dd>
            <dt>Laterality</dt><dd>{report.study.eye}</dd>
            <dt>Source</dt><dd>{report.study.source}</dd>
            <dt>Acquisition date</dt><dd>{report.study.captured_at ?? "Not provided"}</dd>
            <dt>Metadata provenance</dt><dd>{report.study.metadata_provenance}</dd>
            <dt>Analysis mode</dt><dd>{(report.analysis_mode ?? "UNKNOWN").replaceAll("_", " ")}</dd>
            <dt>Generated at</dt><dd>{new Date(report.generated_at).toLocaleString()}</dd>
          </dl>
        </Section>

        <Section id="summary">
          <div className={`result-hero ${!report.image_quality.acceptable ? "reject" : report.analysis_mode === "DEMO_ONLY" && report.overall_result.includes("NO TARGET") ? "normal" : "abnormal"}`} style={{ marginBottom: 12 }}>
            <span className="hero-icon" aria-hidden="true"><Icon name={report.image_quality.acceptable ? "warning" : "x"} size={20} /></span>
            <div>
              <div className="eyebrow">SCREENING RESULT · RESEARCH OUTPUT</div>
              <h3 style={{ margin: "0 0 4px", fontSize: "1.05rem" }}>{report.overall_result}</h3>
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
            <span />
          </div>
          <div className="alert warn" style={{ marginBottom: 0 }}>
            <span className="alert-icon" aria-hidden="true"><Icon name="arrowRight" size={16} /></span>
            <div className="alert-body">
              <strong>Recommended next step</strong>
              {report.recommended_next_step}
              <div className="tiny muted" style={{ marginTop: 4 }}>Triage priority: {report.triage_priority}</div>
            </div>
          </div>
        </Section>

        <Section id="quality" extra={<Badge tone={qp.blocked ? "bad" : report.image_quality.artifacts.length > 0 ? "warn" : "ok"}>{qp.overall_label}</Badge>}>
          <dl className="kv">
            <dt>Quality score</dt><dd>{report.image_quality.score} ({report.image_quality.status})</dd>
            <dt>Acceptable</dt><dd>{report.image_quality.acceptable ? "Yes" : "No"}</dd>
            <dt>Detected artifacts</dt><dd>{report.image_quality.artifacts.join(", ") || "None"}</dd>
          </dl>
          {/* S12: honest quality presentation - a "pass" status can still carry
              real artifacts; never shown as bare "GOOD" when one was detected. */}
          <p className="tiny muted" style={{ margin: "8px 0 0" }}>{qp.impact_note}</p>
        </Section>

        <Section id="findings" extra={<><Provenance kind="model" /><Badge tone="neutral">{report.findings.length}</Badge></>}>
          {report.findings.length === 0 && <p className="muted small">No findings recorded in this report. This is not evidence of normality.</p>}
          {report.findings.map((f) => (
            <div key={f.id} className={`finding-card${f.synthetic ? " synthetic" : ""}`}>
              <div className="finding-head">
                <h4>{f.type.replaceAll("_", " ").toUpperCase()}</h4>
                {f.synthetic ? <Badge tone="demo">Synthetic</Badge> : <Badge tone="warn">Research / unvalidated</Badge>}
              </div>
              <dl className="kv">
                <dt>Location</dt><dd>{f.location.replaceAll("_", " ")}</dd>
                <dt>Severity</dt><dd style={{ textTransform: "capitalize" }}>{f.severity}</dd>
                <dt>Confidence</dt><dd>{f.confidence_category} ({f.confidence}, uncalibrated)</dd>
              </dl>
              <p className="small muted" style={{ marginTop: 6, marginBottom: 0 }}>{f.explanation}</p>
            </div>
          ))}
        </Section>

        <Section id="models" extra={<Provenance kind="model" />}>
          {report.model_execution && (
            <>
              <div className="table-wrap" tabIndex={0} role="region" aria-label="Model execution"><table className="table"><thead><tr><th scope="col">Model</th><th scope="col">Version</th><th scope="col">Execution</th><th scope="col">Artifact hash</th></tr></thead><tbody>
                {[...new Set([...report.model_execution.models_attempted, ...report.model_execution.models_failed, ...report.model_execution.models_skipped.map((x) => x.model_id)])].map((id) => {
                  const status = report.model_execution!.models_executed.includes(id) ? "EXECUTED" : report.model_execution!.models_failed.includes(id) ? "FAILED" : "SKIPPED";
                  const verification = report.model_execution!.artifact_verification?.[id] ?? (report.model_execution!.artifact_hashes[id] ? "EXPECTED_REGISTRY_HASH" : "UNAVAILABLE");
                  return <tr key={id}><td>{id}</td><td>{report.model_execution!.model_versions[id] ?? "—"}</td><td>{status}</td><td className="tiny mono">{verification} {report.model_execution!.artifact_hashes[id] ? `${report.model_execution!.artifact_hashes[id]!.slice(0, 12)}…` : ""}</td></tr>;
                })}
              </tbody></table></div>
              <p className="tiny muted">Runtime: {report.model_execution.runtime_status}. RESEARCH output is uncalibrated and requires clinician review.</p>
            </>
          )}
          {report.coverage_snapshot && (
            <div className="card sunken" style={{ marginTop: 10 }}>
              <h3 style={{ marginTop: 0 }}>Automated imaging coverage</h3>
              <dl className="kv">
                <dt>General detector</dt><dd>{report.coverage_snapshot.general_detector_state.replaceAll("_", " ")}</dd>
                <dt>Active production targets</dt><dd>{report.coverage_snapshot.production_targets.length ? report.coverage_snapshot.production_targets.join(", ") : "None"}</dd>
                <dt>Candidate targets not run</dt><dd>{report.coverage_snapshot.candidate_targets_not_run.map((v) => v.replaceAll("_", " ")).join(", ") || "None"}</dd>
                <dt>Unsupported / unavailable targets</dt><dd>{report.coverage_snapshot.unsupported_targets.map((v) => v.replaceAll("_", " ")).join(", ")}</dd>
              </dl>
              <p className="tiny muted" style={{ marginBottom: 0 }}>{report.coverage_snapshot.notice} Registry {report.coverage_snapshot.registry_version}.</p>
            </div>
          )}
          <h3 style={{ marginTop: 16 }}>AI model information</h3>
          <div className="table-wrap" tabIndex={0} role="region" aria-label="AI model information">
            <table className="table">
              <thead><tr><th scope="col">Model</th><th scope="col">Version</th><th scope="col">Implementation</th><th scope="col">Validation status</th></tr></thead>
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
        </Section>

        <Section id="multimodal">
          {report.asset_routing ? (
            <div>
              <h3 style={{ marginTop: 0 }}>Uploaded assets</h3>
              <dl className="kv">
                <dt>Container</dt><dd>{report.asset_routing.container_type}</dd>
                <dt>Content modality</dt><dd>{report.asset_routing.modality.replaceAll("_", " ")}</dd>
                <dt>Modality state</dt><dd>{report.asset_routing.modality_state.replaceAll("_", " ")}</dd>
                <dt>Device state</dt><dd>{report.asset_routing.device_state.replaceAll("_", " ")}</dd>
                <dt>Domain state</dt><dd>{report.asset_routing.domain_state.replaceAll("_", " ")}</dd>
              </dl>
              {report.oct_region_results && report.oct_region_results.length > 0 && (
                <div className="table-wrap" tabIndex={0} role="region" aria-label="OCT regions" style={{ marginTop: 10 }}><table className="table"><thead><tr><th scope="col">PDF page</th><th scope="col">Content</th><th scope="col">Eye</th><th scope="col">Execution</th><th scope="col">B-box / ROI hash</th></tr></thead><tbody>
                  {report.oct_region_results.map((region) => <tr key={region.asset_id}><td>{region.page}</td><td>{region.content_type}</td><td>{region.laterality}</td><td>{region.status}</td><td className="tiny mono">{region.roi_hash.slice(0, 12)}…</td></tr>)}
                </tbody></table></div>
              )}
              {report.oct_aggregation && <p className="tiny muted" style={{ marginBottom: 0 }}>OCT scan aggregation: {report.oct_aggregation.replaceAll("_", " ")} (categorical; logits are not averaged).</p>}
              {report.document_routing?.map((doc) => <div key={doc.document_id} style={{ marginTop: 12 }}><strong className="small">Document {doc.document_id}</strong> <Provenance kind="observed" label="Document-extracted" /><div className="table-wrap" tabIndex={0} role="region" aria-label={`Document ${doc.document_id} pages`}><table className="table"><thead><tr><th scope="col">Page</th><th scope="col">Content type</th><th scope="col">Laterality</th><th scope="col">Method</th><th scope="col">Verification</th></tr></thead><tbody>{doc.pages.map((p) => <tr key={`${doc.document_id}-${p.page}`}><td>{p.page}</td><td>{p.content_type}</td><td>{p.laterality}</td><td>{p.classifier_method}</td><td>{p.verification_state}</td></tr>)}</tbody></table></div>{doc.measurements.length > 0 && <p className="tiny muted">Measurements (unreviewed): {doc.measurements.map((m) => `${m.key.replaceAll("_", " ")}=${m.value_normalized ?? m.value_raw}${m.unit ? ` ${m.unit}` : ""} (${m.laterality}, p${m.page})`).join(" · ")}</p>}</div>)}
            </div>
          ) : <p className="small muted" style={{ marginTop: 0 }}>No asset routing record is attached to this report.</p>}
          {report.model_execution_ledger && (
            <details className="disclosure" style={{ marginTop: 14 }}>
              <summary>Input / model execution ledger ({report.model_execution_ledger.length} row(s))</summary>
              <p className="tiny muted">Server-derived rows retain asset/ROI lineage, gate state, runtime, and dependency groups. This is an execution record, not a clinical conclusion.</p>
              <div className="table-wrap" tabIndex={0} role="region" aria-label="Execution ledger"><table className="table"><thead><tr><th scope="col">Task / model</th><th scope="col">Asset / ROI</th><th scope="col">Eye</th><th scope="col">Eligibility</th><th scope="col">Status</th><th scope="col">Quality / domain</th><th scope="col">Runtime</th></tr></thead><tbody>
                {report.model_execution_ledger.map((row, i) => <tr key={`${row.model_id}-${row.input_asset_id}-${i}`}><td><strong>{row.task.replaceAll("_", " ")}</strong><div className="tiny muted">{row.model_id} v{row.model_version}</div></td><td className="tiny mono">{row.input_asset_id.slice(0, 16)}…{row.input_roi_id ? <div>ROI {row.input_roi_id.slice(0, 12)}…</div> : null}</td><td>{row.laterality}</td><td>{row.eligibility}</td><td>{row.execution_status}{row.skip_reason ? <div className="tiny muted">{row.skip_reason}</div> : null}</td><td className="tiny">{row.quality_status} / {row.domain_status}</td><td>{row.runtime_ms} ms</td></tr>)}
              </tbody></table></div>
            </details>
          )}
          {evidence && (
            <div style={{ marginTop: 14 }}>
              <h3>Clinical record evidence</h3>
              <p className="tiny muted" style={{ marginTop: 0 }}>Documented symptoms, objective tests, source claims, and research findings are kept as separate evidence types. This section does not create a diagnosis.</p>
              <div className="table-wrap" tabIndex={0} role="region" aria-label="Evidence sources">
                <table className="table">
                  <thead><tr><th scope="col">Source</th><th scope="col">Items</th></tr></thead>
                  <tbody>{Object.entries(evidence.examination_context?.source_count ?? {}).map(([key, value]) => <tr key={key}><td>{key.replaceAll("_", " ")}</td><td>{value ?? 0}</td></tr>)}</tbody>
                </table>
              </div>
              {evidence.conflicts.length > 0 && <div className="alert warn" style={{ marginTop: 10 }}><div className="alert-body"><strong>Unresolved evidence conflicts ({evidence.conflicts.length})</strong><div className="tiny">{evidence.conflicts.map((c) => `${c.category} (${c.severity})`).join(" · ")}</div></div></div>}
              {evidence.possible_conditions.length > 0 && <details className="disclosure" style={{ marginTop: 10 }}><summary>Evidence patterns and missing confirmation</summary><ul className="tiny muted" style={{ margin: "6px 0", paddingLeft: 18 }}>{evidence.possible_conditions.map((c, i) => <li key={i}><strong>{c.canonical_name}</strong> ({c.laterality}) — {c.state.replaceAll("_", " ")}. {c.missing_required.length ? `Missing: ${c.missing_required.join(", ")}` : c.note}</li>)}</ul></details>}
            </div>
          )}
        </Section>

        <Section id="context" extra={report.patient_context?.reported ? <Provenance kind="observed" label="Patient-reported" /> : undefined}>
          {report.patient_context?.reported ? (
            <>
              <div className="table-wrap" tabIndex={0} role="region" aria-label="Reported symptoms">
                <table className="table">
                  <thead><tr><th scope="col">Symptom</th><th scope="col">Onset</th><th scope="col">Duration</th><th scope="col">Severity</th><th scope="col">Eye</th><th scope="col">Progression</th></tr></thead>
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
              <p className="tiny muted">{report.patient_context.note}</p>
              {report.symptom_correlation && (
                <div style={{ marginTop: 12 }}>
                  <h3 style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>Symptom / imaging correlation <Provenance kind="inferred" label="Rules inference" /> <Badge tone="warn">{report.symptom_correlation.label}</Badge></h3>
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
            </>
          ) : <p className="small muted" style={{ margin: 0 }}>No symptoms were reported for this study.</p>}
        </Section>

        <Section id="associations" extra={<Provenance kind="inferred" />}>
          {report.possible_conditions && (
            report.possible_conditions.conditions.length === 0 ? (
              <p className="small muted" style={{ marginTop: 0 }}>No condition associations met the evidence requirements for display (model not validated).</p>
            ) : (
              <ul className="small" style={{ marginTop: 0, paddingLeft: 18 }}>
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
            )
          )}
          {report.possible_conditions && <p className="tiny muted">{report.possible_conditions.note}</p>}
          <h3>Possible clinical associations</h3>
          <p className="small muted">{report.possible_associations_note}</p>
          <h3>Measurements</h3>
          <p className="small muted">{report.measurements_note}</p>
          {report.treatment_information && (
            <div className="card sunken" style={{ marginTop: 10 }}>
              <h3 style={{ marginTop: 0, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>Treatment information <Badge tone="warn">Clinician review required</Badge></h3>
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
        </Section>

        <Section id="review" extra={finalized ? <Provenance kind="clinician" label="Finalized" /> : <Badge tone="warn">Report not finalized</Badge>}>
          <dl className="kv">
            <dt>Review status</dt>
            <dd>{report.review.status}{report.review.reviewer_id ? ` by ${report.review.reviewer_id}` : ""}{report.review.finalized_at ? ` at ${new Date(report.review.finalized_at).toLocaleString()}` : ""}</dd>
          </dl>
          {!finalized && <p className="small muted">This report is AI research output only. It has not been finalized by a qualified clinician and is not a clinical document.</p>}
          {report.clinician_interpretation && (
            <dl className="kv" style={{ marginTop: 10 }}>
              <dt>Clinician interpretation</dt>
              <dd>{report.clinician_interpretation.overall.replaceAll("_", " ")} — {report.clinician_interpretation.reviewer_id}</dd>
              {report.clinician_interpretation.notes && (<><dt>Notes</dt><dd className="small">{report.clinician_interpretation.notes}</dd></>)}
            </dl>
          )}
          {report.final_interpretation && (
            <div className="alert ok">
              <span className="alert-icon" aria-hidden="true"><Icon name="check" size={16} /></span>
              <div className="alert-body"><strong>Final interpretation</strong>{report.final_interpretation}</div>
            </div>
          )}
          {report.clinician_final_assessment && (
            <div className="authority-panel" style={{ marginTop: 12 }}>
              <div className="authority-kicker"><Icon name="review" size={13} /> Clinician final assessment</div>
              <dl className="kv">
                {(["diagnosis", "impression", "plan", "follow_up"] as const).map((field) => report.clinician_final_assessment?.[field] ? <Fragment key={field}><dt style={{ textTransform: "capitalize" }}>{field.replace("_", " ")}</dt><dd>{report.clinician_final_assessment![field]}</dd></Fragment> : null)}
              </dl>
              <p className="tiny muted" style={{ marginBottom: 0 }}>Entered by {report.clinician_final_assessment.reviewer_id} · {new Date(report.clinician_final_assessment.at).toLocaleString()}</p>
            </div>
          )}
          {report.clinician_corrections && report.clinician_corrections.length > 0 && (
            <div className="alert warn">
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
            <details className="disclosure" style={{ marginTop: 10 }}>
              <summary>Review trail ({report.review.clinician_changes.length} actions)</summary>
              <div className="table-wrap" tabIndex={0} role="region" aria-label="Review trail">
                <table className="table">
                  <thead><tr><th scope="col">Field</th><th scope="col">Action</th><th scope="col">At</th></tr></thead>
                  <tbody>
                    {report.review.clinician_changes.map((c, i) => (
                      <tr key={i}><td>{c.field}</td><td>{c.action}</td><td className="small">{new Date(c.at).toLocaleString()}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </Section>

        <Section id="limitations">
          {/* S12: relabeled - this is a heuristic score from the pipeline's
              quality/agreement heuristics, not calibrated model confidence; a
              bare percentage here could be misread as AI confidence. */}
          <p className="small"><strong>Heuristic uncertainty score (not calibrated confidence): {(report.uncertainty.overall * 100).toFixed(0)}%</strong></p>
          <ul className="small muted" style={{ paddingLeft: 18 }}>
            {report.uncertainty.reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
          <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
            {report.limitations.map((l, i) => <li key={i}>{l}</li>)}
          </ul>
        </Section>

        <Section id="provenance">
          {report.claim_ledger && (
            <div>
              <h3 style={{ marginTop: 0, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>Claim ledger <Badge tone={report.claim_ledger.publication_blocked ? "bad" : "info"}>{report.claim_ledger.publication_status}</Badge></h3>
              <p className="tiny muted">Each presentation-facing observation or triage recommendation retains evidence references, laterality, model provenance, and an explicit clinician-review state. This ledger never upgrades research output to a diagnosis.</p>
              <div className="table-wrap" tabIndex={0} role="region" aria-label="Claim ledger"><table className="table"><thead><tr><th scope="col">Claim</th><th scope="col">Scope</th><th scope="col">Certainty</th><th scope="col">Release state</th><th scope="col">Evidence / traceability</th><th scope="col">Provenance</th></tr></thead><tbody>
                {report.claim_ledger.entries.map((entry) => <tr key={entry.claim_id}><td><strong>{entry.claim_type.replaceAll("_", " ")}</strong><div className="tiny muted">{entry.text}</div></td><td>{entry.laterality}</td><td>{entry.certainty ?? "LEGACY / UNSET"}</td><td>{entry.release_status}{entry.blocked_reasons.length > 0 ? <div className="tiny muted">{entry.blocked_reasons.join(", ")}</div> : null}</td><td className="tiny"><div>Evidence: {entry.evidence_refs.join(", ") || "none"}</div><div>Sources: {entry.source_ids?.join(", ") || "none"}</div><div>Models: {entry.model_execution_ids?.join(", ") || "none"}</div><div>Rules: {entry.rule_ids?.join(", ") || "none"}</div><div>Knowledge: {entry.knowledge_source_ids?.join(", ") || "none"}</div></td><td className="tiny">{entry.provenance.model_id ?? entry.provenance.model_status}{entry.provenance.model_version ? ` v${entry.provenance.model_version}` : ""}</td></tr>)}
              </tbody></table></div>
            </div>
          )}
          <details className="tech" style={{ marginTop: 12 }}>
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
        </Section>

        <Section id="audit">
          <p className="small muted" style={{ marginTop: 0 }}>{report.exports.fhir_note}</p>
          <p className="tiny muted" style={{ marginBottom: 0 }}>
            Audit: every analysis records model versions, checksums, quality score, uncertainty, and ruleset version.
            Original scans preserved unchanged (SHA-256 verified). No clinician signatures are generated by this
            system; a report becomes a clinical document only after qualified professional review and finalization.
          </p>
        </Section>

        <Section id="safety">
          <SafetyBoundary title="Safety disclaimers">
            <ul className="small">
              {report.safety.disclaimers.map((d, i) => <li key={i}>{d}</li>)}
            </ul>
          </SafetyBoundary>
        </Section>
      </div>
    </div>
  );
}

export default function ReportPage() {
  return (
    <Suspense fallback={<div className="page-loading" role="status"><span className="spinner" aria-hidden="true" />Loading report…</div>}>
      <ReportInner />
    </Suspense>
  );
}
