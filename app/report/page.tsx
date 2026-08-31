"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";

interface Report {
  report_id: string;
  study_id: string;
  generated_at: string;
  validation_banner: string;
  demo_label: string;
  patient: { identifier?: string | null; age_band?: string | null; notes?: string | null };
  study: { modality: string; eye: string; source: string; captured_at?: string | null; metadata_provenance: string };
  image_quality: { score: number; status: string; acceptable: boolean; artifacts: string[] };
  overall_result: string;
  findings: Array<{ id: string; type: string; location: string; severity: string; confidence: number; confidence_category: string; explanation: string; synthetic: boolean }>;
  possible_associations_note: string;
  uncertainty: { overall: number; reasons: string[] };
  measurements_note: string;
  limitations: string[];
  recommended_next_step: string;
  triage_priority: string;
  review: { status: string; reviewer_id?: string; finalized_at?: string; clinician_changes?: Array<{ field: string; action: string; at: string }> };
  provenance: { models: Array<Record<string, unknown>>; ruleset_version: string; analyzed_at: string; pipeline_version: string };
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
    (async () => {
      const res = await fetch(`/api/studies/${encodeURIComponent(study)}`);
      const json = await res.json();
      if (!res.ok) setErr(json.error ?? "Not found");
      else setReport(json.report);
    })();
  }, [study]);

  if (err) return <div className="callout danger">{err}</div>;
  if (!report) return <div className="spinner" />;

  function downloadJson() {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${report.report_id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="report-print">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <h1 style={{ marginBottom: 0 }}>Clinical screening report</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn secondary" onClick={() => window.print()}>Print / PDF export</button>
          <button className="btn secondary" onClick={downloadJson}>Download JSON</button>
        </div>
      </div>
      <div className="banner banner-validation" style={{ margin: "10px -20px", borderRadius: 0 }}>
        {report.validation_banner}
      </div>
      <p><span className="demo-tag">{report.demo_label}</span></p>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Study information</h2>
        <dl className="kv">
          <dt>Report ID</dt><dd>{report.report_id}</dd>
          <dt>Study ID</dt><dd>{report.study_id}</dd>
          <dt>Modality</dt><dd>{report.study.modality}</dd>
          <dt>Laterality</dt><dd>{report.study.eye}</dd>
          <dt>Source</dt><dd>{report.study.source}</dd>
          <dt>Captured at</dt><dd>{report.study.captured_at ?? "not provided"}</dd>
          <dt>Metadata provenance</dt><dd>{report.study.metadata_provenance}</dd>
          <dt>Generated at</dt><dd>{report.generated_at}</dd>
          <dt>Review status</dt>
          <dd>
            {report.review.status}
            {report.review.reviewer_id ? ` by ${report.review.reviewer_id}` : ""}
            {report.review.finalized_at ? ` at ${report.review.finalized_at}` : ""}
          </dd>
        </dl>
      </div>

      <div className={`result-hero ${report.image_quality.acceptable ? (report.findings.length ? "abnormal" : "normal") : "reject"}`}>
        <h2 style={{ marginTop: 0 }}>OVERALL RESULT</h2>
        <h1 style={{ fontSize: "1.3rem" }}>{report.overall_result}</h1>
        <p className="small">
          {report.image_quality.acceptable
            ? report.findings.length === 0
              ? "This result means the system did not identify a significant abnormality in the supplied image under the conditions of this analysis. It does not guarantee that no eye disease is present."
              : "Findings below are automated screening signals. They are not diagnoses."
            : "Image quality is insufficient for reliable automated analysis. No clinical interpretation was generated."}
        </p>
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Image quality</h2>
        <dl className="kv">
          <dt>Quality score</dt><dd>{report.image_quality.score} ({report.image_quality.status})</dd>
          <dt>Acceptable</dt><dd>{report.image_quality.acceptable ? "Yes" : "No"}</dd>
          <dt>Detected artifacts</dt><dd>{report.image_quality.artifacts.join(", ") || "none"}</dd>
        </dl>
      </div>

      <h2>Findings ({report.findings.length})</h2>
      {report.findings.length === 0 && <p className="muted">No findings recorded in this report.</p>}
      {report.findings.map((f) => (
        <div key={f.id} className="finding-card">
          <h3>{f.type.replaceAll("_", " ").toUpperCase()} {f.synthetic && <span className="demo-tag">SYNTHETIC</span>}</h3>
          <dl className="kv">
            <dt>Location</dt><dd>{f.location.replaceAll("_", " ")}</dd>
            <dt>Severity</dt><dd>{f.severity}</dd>
            <dt>Confidence</dt><dd>{f.confidence_category} ({f.confidence})</dd>
          </dl>
          <p className="small">{f.explanation}</p>
        </div>
      ))}

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Possible clinical associations</h2>
        <p className="small muted">{report.possible_associations_note}</p>
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Uncertainty</h2>
        <p>Overall: <strong>{(report.uncertainty.overall * 100).toFixed(0)}%</strong></p>
        <ul className="small muted">{report.uncertainty.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Measurements</h2>
        <p className="small muted">{report.measurements_note}</p>
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Limitations</h2>
        <ul className="small muted">{report.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul>
      </div>

      <div className="callout warn">
        <h3 style={{ margin: "0 0 6px" }}>Recommended next step</h3>
        <p style={{ margin: 0 }}>{report.recommended_next_step}</p>
        <p className="small muted" style={{ marginBottom: 0 }}>Triage priority: {report.triage_priority}</p>
      </div>

      {report.review.clinician_changes && report.review.clinician_changes.length > 0 && (
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Clinician review trail</h2>
          <table className="table">
            <thead><tr><th>Field</th><th>Action</th><th>At</th></tr></thead>
            <tbody>
              {report.review.clinician_changes.map((c, i) => (
                <tr key={i}><td>{c.field}</td><td>{c.action}</td><td>{c.at}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Model provenance</h2>
        <table className="table">
          <thead><tr><th>Model</th><th>Version</th><th>Implementation</th><th>Validation status</th></tr></thead>
          <tbody>
            {report.provenance.models.map((m, i) => (
              <tr key={i}>
                <td>{String(m.model_id)}</td>
                <td>{String(m.model_version)}</td>
                <td>{String(m.implementation)}</td>
                <td><span className="badge warn">{String(m.validation_status)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="small muted">
          Ruleset: {report.provenance.ruleset_version} &middot; Pipeline: {report.provenance.pipeline_version}
        </p>
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Interoperability</h2>
        <p className="small muted">{report.exports.fhir_note}</p>
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Safety disclaimers</h2>
        <ul className="small muted">{report.safety.disclaimers.map((d, i) => <li key={i}>{d}</li>)}</ul>
        {report.safety.blocked_claims.length > 0 && (
          <p className="small">Safety validator blocked claims: {report.safety.blocked_claims.join(", ")}</p>
        )}
      </div>

      <p className="small muted">
        No clinician signatures are generated by this system. A report becomes a clinical document only when a
        qualified professional reviews, amends if needed, and finalizes it through the clinician review workflow.
      </p>
    </div>
  );
}

export default function ReportPage() {
  return (
    <Suspense fallback={<div className="spinner" />}>
      <ReportInner />
    </Suspense>
  );
}
