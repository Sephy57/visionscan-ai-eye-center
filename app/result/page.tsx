"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

interface Finding {
  id: string; type: string; location: string; severity: string;
  confidence: number; confidence_category: string;
  explanation: string; synthetic: boolean; model_id: string;
  region?: { x: number; y: number; w: number; h: number } | null;
}

interface Bundle {
  study?: { study_id: string; modality: string; eye: string; status: string; created_at: string; original_sha256: string };
  analysis?: {
    quality: { score: number; status: string; acceptable: boolean; artifacts: string[]; recommended_reacquisition: boolean };
    findings: Finding[];
    uncertainty: { overall: number; reasons: string[]; ensemble_agreement?: string };
    recommendation: { priority: string; action: string; rationale: string };
    demo: { synthetic_result: boolean; label: string };
    ensemble: { performed: boolean; note: string };
    provenance: { analyzed_at: string; pipeline_version: string; ruleset_version: string };
    safety: { disclaimers: string[] };
  };
  report?: { report_id: string; overall_result: string; triage_priority: string };
  error?: string;
}

function confidenceBadge(cat: string) {
  if (cat === "HIGH CONFIDENCE") return <span className="badge ok">{cat}</span>;
  if (cat === "MODERATE CONFIDENCE") return <span className="badge info">{cat}</span>;
  if (cat === "LOW CONFIDENCE") return <span className="badge warn">{cat}</span>;
  return <span className="badge bad">{cat}</span>;
}

function triageBadge(p: string) {
  if (p === "routine_follow_up") return <span className="badge ok">ROUTINE FOLLOW-UP</span>;
  if (p === "prompt_professional_review") return <span className="badge warn">PROMPT EYE-CARE REVIEW</span>;
  if (p === "urgent_eye_care_review") return <span className="badge bad">URGENT EYE-CARE REVIEW</span>;
  if (p === "emergency_evaluation") return <span className="badge bad">EMERGENCY EVALUATION</span>;
  return <span className="badge warn">SPECIALIST REVIEW REQUIRED</span>;
}

function ResultInner() {
  const router = useRouter();
  const params = useSearchParams();
  const study = params.get("study") ?? "";
  const [data, setData] = useState<Bundle | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!study) { setErr("No study id supplied."); return; }
    (async () => {
      const res = await fetch(`/api/studies/${encodeURIComponent(study)}`);
      const json = await res.json();
      if (!res.ok) setErr(json.error ?? "Not found");
      else setData(json);
    })();
  }, [study]);

  if (err) return (<div><h1>Result</h1><div className="callout danger">{err}</div><a className="btn" href="/analyze">Analyze a scan</a></div>);
  if (!data?.analysis) return <div className="spinner" />;

  const a = data.analysis;
  const rejected = !a.quality.acceptable;
  const abnormal = a.findings.length > 0;

  return (
    <div>
      <div className={`result-hero ${rejected ? "reject" : abnormal ? "abnormal" : "normal"}`}>
        <span className="demo-tag">{a.demo.label}</span>
        <h1 style={{ marginTop: 10 }}>
          {rejected
            ? "Image quality insufficient for reliable automated analysis"
            : abnormal
              ? "Potential abnormal finding detected"
              : "No significant abnormality detected by automated screening"}
        </h1>
        {rejected ? (
          <p style={{ fontSize: "1.05rem" }}>
            Image quality is insufficient for reliable automated analysis. Please acquire another scan or have the
            image reviewed by an eye-care professional.
          </p>
        ) : abnormal ? (
          <p style={{ fontSize: "1.05rem" }}>
            The automated analysis identified findings below. These are screening signals, not diagnoses. A qualified
            eye-care professional must interpret them.
          </p>
        ) : (
          <p style={{ fontSize: "1.05rem" }}>
            This result means the system did not identify a significant abnormality in the supplied image under the
            conditions of this analysis. <strong>It does not guarantee that no eye disease is present.</strong>
          </p>
        )}
        <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
          {triageBadge(a.recommendation.priority)}
          <span className="badge neutral">Quality: {a.quality.status} ({a.quality.score})</span>
          <span className="badge neutral">Uncertainty: {(a.uncertainty.overall * 100).toFixed(0)}%</span>
          <span className="badge neutral">Eye: {data.study?.eye}</span>
          <span className="badge neutral">Modality: {data.study?.modality}</span>
        </div>
      </div>

      <div className="callout warn">
        <strong>Recommended next action:</strong> {a.recommendation.action}
        <div className="small muted" style={{ marginTop: 4 }}>{a.recommendation.rationale}</div>
      </div>

      <h2>Findings {abnormal ? `(${a.findings.length})` : ""}</h2>
      {!abnormal && !rejected && (
        <div className="panel muted small">
          No findings were emitted by this analysis. Note that all detection components are unvalidated placeholders;
          a negative result has very limited reliability in this deployment.
        </div>
      )}
      {rejected && (
        <div className="panel muted small">
          No clinical findings were generated because the quality gate failed. Detected artifacts:{" "}
          {a.quality.artifacts.join(", ") || "none recorded"}.
        </div>
      )}
      {a.findings.map((f) => (
        <div key={f.id} className="finding-card">
          <h3>
            {f.type.replaceAll("_", " ").toUpperCase()}
            <span className="demo-tag">SYNTHETIC DEMO FINDING</span>
          </h3>
          <dl className="kv">
            <dt>Location</dt><dd>{f.location.replaceAll("_", " ")}</dd>
            <dt>Severity</dt><dd>{f.severity}</dd>
            <dt>Confidence</dt><dd>{confidenceBadge(f.confidence_category)} <span className="muted small">({f.confidence})</span></dd>
            <dt>Produced by</dt><dd className="muted">{f.model_id} (placeholder component)</dd>
          </dl>
          <p className="small" style={{ marginTop: 10 }}>{f.explanation}</p>
        </div>
      ))}

      <h2>Uncertainty</h2>
      <div className="panel">
        <p><strong>Overall uncertainty: {(a.uncertainty.overall * 100).toFixed(0)}%</strong></p>
        <ul className="small muted">
          {a.uncertainty.reasons.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
        <p className="small muted">Ensemble: {a.ensemble.note}</p>
      </div>

      <h2>What this result means</h2>
      <div className="grid-2">
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>OBSERVED FINDING</h3>
          <p className="small muted">What the automated analysis detected in the image, with location and confidence.</p>
          <h3>POSSIBLE ASSOCIATIONS</h3>
          <p className="small muted">
            A finding <em>can be associated with</em> one or more conditions. Association is not proof. This platform
            never asserts &ldquo;this proves you have&hellip;&rdquo;.
          </p>
          <h3>CONFIRMED DIAGNOSIS</h3>
          <p className="small muted">
            Can only be established by a qualified clinician. This software is not authorized to diagnose.
          </p>
        </div>
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Limitations of this analysis</h3>
          <ul className="small muted">
            <li>All detection/segmentation components are unvalidated placeholders.</li>
            <li>Findings are synthetic demo outputs exercising the pipeline.</li>
            <li>No validated measurements or population references are installed.</li>
            <li>Per-device validation and calibration have not been performed.</li>
          </ul>
        </div>
      </div>

      <details className="tech panel">
        <summary>Advanced technical information</summary>
        <div className="kv">
          <dt>Pipeline version</dt><dd>{a.provenance.pipeline_version}</dd>
          <dt>Ruleset version</dt><dd>{a.provenance.ruleset_version}</dd>
          <dt>Analyzed at</dt><dd>{a.provenance.analyzed_at}</dd>
          <dt>Quality score</dt><dd>{a.quality.score} ({a.quality.status})</dd>
          <dt>Quality artifacts</dt><dd>{a.quality.artifacts.join(", ") || "none"}</dd>
          <dt>Ensemble agreement</dt><dd>{String(a.uncertainty.ensemble_agreement)}</dd>
          <dt>Original SHA-256</dt><dd className="code" style={{ display: "inline-block" }}>{data.study?.original_sha256}</dd>
        </div>
      </details>

      <div style={{ display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
        <a className="btn" href={`/report?study=${encodeURIComponent(study)}`}>Open full report</a>
        <a className="btn secondary" href="/analyze">Analyze another scan</a>
        <a className="btn secondary" href={`/compare?current=${encodeURIComponent(study)}`}>Compare with previous scan</a>
      </div>
    </div>
  );
}

export default function ResultPage() {
  return (
    <Suspense fallback={<div className="spinner" />}>
      <ResultInner />
    </Suspense>
  );
}
