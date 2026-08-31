"use client";

import { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import ScanViewer from "@/components/ScanViewer";
import { Badge, ConfidenceIndicator, QualityPanel, TriageBadge, EmptyState } from "@/components/ui";

interface Finding {
  id: string; type: string; location: string; severity: string;
  confidence: number; confidence_category: string; confidence_calibrated?: number | null;
  taxonomy_level?: string; model_status?: string;
  explanation: string; synthetic: boolean; model_id: string;
  region?: { x: number; y: number; w: number; h: number } | null;
}

interface Bundle {
  study?: { study_id: string; modality: string; eye: string; status: string; created_at: string; original_sha256: string };
  analysis?: {
    study: { eye: string; modality: string };
    quality: { score: number; status: string; acceptable: boolean; artifacts: string[]; metrics: Record<string, number | boolean> };
    findings: Finding[];
    uncertainty: { overall: number; reasons: string[]; ensemble_agreement?: string };
    recommendation: { priority: string; action: string; rationale: string };
    ood?: { detected: boolean; reasons: string[]; message: string };
    model_registry?: {
      model_id: string; model_version: string; model_status: string; display_label: string | null;
      integrity_checks: Array<{ check: string; passed: boolean; detail: string }>;
      device_compatibility: { compatible: boolean; note: string };
    };
    demo: { synthetic_result: boolean; label: string };
    provenance: { analyzed_at: string; pipeline_version: string; ruleset_version: string };
    safety: { disclaimers: string[] };
  };
  report?: { report_id: string; overall_result: string };
  error?: string;
}

function findingTitle(f: Finding): string {
  // Only use the taxonomy label the actual model supports; synthetic findings carry their own honest titles.
  return f.type.replaceAll("_", " ").toUpperCase();
}

function ResultInner() {
  const params = useSearchParams();
  const study = params.get("study") ?? "";
  const [data, setData] = useState<Bundle | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [activeRegion, setActiveRegion] = useState<Finding["region"]>(null);

  useEffect(() => {
    if (!study) { setErr("No study id supplied."); return; }
    (async () => {
      const res = await fetch(`/api/studies/${encodeURIComponent(study)}`);
      const json = await res.json();
      if (!res.ok) setErr(json.error ?? "Not found");
      else setData(json);
    })();
  }, [study]);

  if (err) {
    return (
      <ErrorBox title="Analysis could not be opened" message={err} />
    );
  }
  if (!data?.analysis) return <div style={{ display: "flex", justifyContent: "center", padding: 60 }}><div className="spinner" /></div>;

  const a = data.analysis;
  const rejected = !a.quality.acceptable;
  const abnormal = a.findings.length > 0;
  const ood = a.ood?.detected === true;
  const hasImage = !!data.study;

  const heroClass = rejected ? "reject" : abnormal ? "abnormal" : ood ? "abnormal" : "normal";
  const eyebrow = rejected ? "QUALITY GATE FAILED" : abnormal ? "SCREENING RESULT" : ood ? "SCREENING RESULT — INCONCLUSIVE" : "SCREENING RESULT";
  const headline = rejected
    ? "Automated interpretation inconclusive — image quality insufficient"
    : abnormal
      ? "Potential abnormal finding detected"
      : ood
        ? "Automated interpretation inconclusive"
        : "No significant abnormality detected by automated screening";

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
        <div>
          <div className="tiny" style={{ color: "var(--text-3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>Analysis complete</div>
          <h1 style={{ marginBottom: 2 }}>Result</h1>
          <p className="small muted" style={{ margin: 0 }}>
            {data.study?.study_id} • {a.study?.eye} • {a.study?.modality} • {new Date(a.provenance.analyzed_at).toLocaleString()}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link className="btn secondary sm" href={`/report?study=${encodeURIComponent(study)}`}>Open Report</Link>
          <Link className="btn sm" href={`/clinician?study=${encodeURIComponent(study)}`}>Clinical Review</Link>
        </div>
      </div>

      <span className="badge demo" style={{ marginTop: 12 }}>{a.demo.label}</span>

      <div className={`result-hero ${heroClass}`} role="status">
        <div className="eyebrow">{eyebrow}</div>
        <h2>{headline}</h2>
        <p style={{ margin: 0, maxWidth: 640 }}>
          {rejected
            ? "Image quality is insufficient for reliable automated analysis. Please acquire another scan or have the image reviewed by an eye-care professional."
            : abnormal
              ? "The automated analysis identified the findings below. These are screening signals, not diagnoses, and require interpretation by a qualified eye-care professional."
              : ood
                ? "Input is outside the validated operating conditions of this model. Automated interpretation is inconclusive — normality is not claimed."
                : "This result means the system did not identify a significant abnormality in the supplied image under the conditions of this analysis. It does not guarantee that no eye disease is present."}
        </p>
        <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
          <TriageBadge priority={a.recommendation.priority} />
          <Badge tone={a.quality.acceptable ? "ok" : "bad"}>Quality: {a.quality.status}</Badge>
          <Badge tone="neutral">Uncertainty: {(a.uncertainty.overall * 100).toFixed(0)}%</Badge>
          {ood && <Badge tone="warn">Outside operating conditions</Badge>}
        </div>
      </div>

      <div className="alert warn">
        <span className="alert-icon" aria-hidden="true">→</span>
        <div className="alert-body">
          <strong>Recommended next step</strong>
          {a.recommendation.action}
          <div className="tiny muted" style={{ marginTop: 4 }}>{a.recommendation.rationale}</div>
        </div>
      </div>

      <div className="grid grid-2" style={{ alignItems: "start" }}>
        <div className="card">
          <div className="card-title"><h3>Study image</h3><Badge tone="neutral">{data.study?.modality} • {data.study?.eye}</Badge></div>
          {hasImage ? (
            <ScanViewer
              src={`/api/studies/${encodeURIComponent(study)}/image`}
              alt={`Original scan ${data.study?.study_id}`}
              region={activeRegion}
              overlayAvailable={activeRegion != null}
              overlayUnavailableNote="AI localization is not available for this model."
            />
          ) : (
            <EmptyState icon="◉" title="Original image unavailable" />
          )}
        </div>

        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-title"><h3>Image quality</h3></div>
            <QualityPanel quality={a.quality} />
          </div>

          <div className="card">
            <div className="card-title"><h3>AI model information</h3></div>
            {a.model_registry && (
              <dl className="kv">
                <dt>Model</dt><dd>{a.model_registry.model_id} v{a.model_registry.model_version}</dd>
                <dt>Validation status</dt>
                <dd><Badge tone="warn">{a.model_registry.model_status}</Badge></dd>
                <dt>Device compatibility</dt>
                <dd className="small">{a.model_registry.device_compatibility.note}</dd>
              </dl>
            )}
          </div>
        </div>
      </div>

      <h2>Findings {abnormal ? `(${a.findings.length})` : ""}</h2>
      {!abnormal && (
        <EmptyState icon="✓" title={rejected ? "No findings — quality gate failed" : "No findings recorded"}>
          {rejected
            ? "No clinical findings are generated when image quality is insufficient. This protects against unreliable interpretation."
            : "No findings were emitted by this analysis. Note that all detection components are unvalidated placeholders; a negative result has very limited reliability in this deployment."}
        </EmptyState>
      )}
      {a.findings.map((f) => (
        <div key={f.id} className="finding-card" style={{ marginBottom: 12 }}>
          <div className="finding-head">
            <h3>{findingTitle(f)}</h3>
            <span className="badge demo">Synthetic demo finding</span>
          </div>
          <dl className="kv" style={{ marginBottom: 12 }}>
            <dt>Location</dt><dd>{f.location.replaceAll("_", " ")}</dd>
            <dt>Severity</dt><dd style={{ textTransform: "capitalize" }}>{f.severity}</dd>
            <dt>Taxonomy level</dt><dd className="small">{f.taxonomy_level ?? "observation"} — possible associations only; not a diagnosis</dd>
          </dl>
          <ConfidenceIndicator finding={f} />
          <p className="small" style={{ marginTop: 10 }}>{f.explanation}</p>
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            {f.region && hasImage ? (
              <button className="btn secondary sm" onClick={() => setActiveRegion(f.region ?? null)}>View on scan</button>
            ) : (
              <span className="tiny muted">AI localization is not available for this model.</span>
            )}
          </div>
        </div>
      ))}

      <div className="grid grid-2">
        <div className="card">
          <div className="card-title"><h3>Uncertainty</h3><Badge tone="warn">{(a.uncertainty.overall * 100).toFixed(0)}%</Badge></div>
          <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
            {a.uncertainty.reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </div>
        <div className="card">
          <div className="card-title"><h3>OBSERVED / ASSOCIATIONS / DIAGNOSIS</h3></div>
          <p className="small"><strong>OBSERVED FINDING</strong> — what the analysis detected, with location and confidence.</p>
          <p className="small"><strong>POSSIBLE ASSOCIATIONS</strong> — a finding can be <em>associated with</em> conditions. Association is not proof.</p>
          <p className="small"><strong>CONFIRMED DIAGNOSIS</strong> — only a qualified clinician can establish a diagnosis. This software is not authorized to diagnose.</p>
        </div>
      </div>

      <details className="tech card" style={{ marginTop: 16 }}>
        <summary>Advanced technical information</summary>
        <dl className="kv">
          <dt>Pipeline version</dt><dd>{a.provenance.pipeline_version}</dd>
          <dt>Ruleset version</dt><dd>{a.provenance.ruleset_version}</dd>
          <dt>Quality score</dt><dd>{a.quality.score} ({a.quality.status})</dd>
          <dt>Quality artifacts</dt><dd>{a.quality.artifacts.join(", ") || "none"}</dd>
          <dt>Ensemble agreement</dt><dd>{String(a.uncertainty.ensemble_agreement)}</dd>
          <dt>Model integrity</dt>
          <dd>
            <ul className="small" style={{ margin: 0, paddingLeft: 16 }}>
              {(a.model_registry?.integrity_checks ?? []).map((c, i) => (
                <li key={i}>{c.check}: {c.passed ? "✓" : "✕"} — {c.detail}</li>
              ))}
            </ul>
          </dd>
          <dt>Original SHA-256</dt><dd style={{ wordBreak: "break-all", fontFamily: "var(--mono)", fontSize: "0.78rem" }}>{data.study?.original_sha256}</dd>
        </dl>
      </details>

      <div style={{ display: "flex", gap: 10, marginTop: 20, flexWrap: "wrap" }}>
        <Link className="btn" href={`/report?study=${encodeURIComponent(study)}`}>Open full report</Link>
        <Link className="btn secondary" href="/analyze">Analyze another scan</Link>
        <Link className="btn secondary" href={`/compare?current=${encodeURIComponent(study)}`}>Compare with previous scan</Link>
      </div>
    </div>
  );
}

function ErrorBox({ title, message }: { title: string; message: string }) {
  return (
    <div style={{ maxWidth: 640, margin: "0 auto" }}>
      <h1>{title}</h1>
      <div className="alert danger"><span className="alert-icon" aria-hidden="true">⚠</span><div className="alert-body"><strong>We were unable to display this result</strong>{message}</div></div>
      <div style={{ display: "flex", gap: 10 }}>
        <a className="btn" href="/analyze">Try Again</a>
        <a className="btn secondary" href="/dashboard">Return to Dashboard</a>
      </div>
    </div>
  );
}

export default function ResultPage() {
  return (
    <Suspense fallback={<div style={{ display: "flex", justifyContent: "center", padding: 60 }}><div className="spinner" /></div>}>
      <ResultInner />
    </Suspense>
  );
}
