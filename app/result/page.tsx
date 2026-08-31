"use client";

import { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import ScanViewer from "@/components/ScanViewer";
import { Badge, ConfidenceIndicator, EmptyState, TriageBadge } from "@/components/ui";
import { Icon } from "@/components/icons";

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
      model_input?: "IMAGE_ONLY" | "IMAGE_AND_SYMPTOMS";
    };
    patient_context?: {
      reported: boolean;
      symptoms: Array<{ type: string; label?: string; onset: string; duration: string; severity: string; laterality: string; progression: string; frequency: string; free_text?: string | null }>;
      red_flags: string[];
      note: string;
    };
    symptom_correlation?: {
      state: "correlated" | "not_explained" | "inconclusive" | "conflicting" | "urgent";
      urgency: "emergency" | "urgent" | "prompt" | "routine";
      items: Array<{ symptom_type: string; symptom_label: string; state: string; matched_finding_types: string[]; note: string }>;
      notes: string[];
      label: string;
    };
    possible_conditions?: {
      conditions: Array<{ id: string; label: string; matched_findings: string[]; note: string }>;
      note: string;
    };
    demo: { synthetic_result: boolean; label: string };
    provenance: { analyzed_at: string; pipeline_version: string; ruleset_version: string };
    safety: { disclaimers: string[] };
  };
  report?: { report_id: string; overall_result: string };
  error?: string;
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
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        <h1>Unable to open result</h1>
        <div className="alert danger"><span className="alert-icon" aria-hidden="true">⚠</span><div className="alert-body"><strong>We were unable to display this result</strong>{err}</div></div>
        <div style={{ display: "flex", gap: 10 }}>
          <Link className="btn" href="/analyze">Upload Another Scan</Link>
          <Link className="btn secondary" href="/dashboard">Return to Dashboard</Link>
        </div>
      </div>
    );
  }
  if (!data?.analysis) return <div style={{ display: "flex", justifyContent: "center", padding: 60 }}><div className="spinner" /></div>;

  const a = data.analysis;
  const rejected = !a.quality.acceptable;
  const abnormal = a.findings.length > 0;
  const ood = a.ood?.detected === true;
  const hasImage = !!data.study;
  const redFlag = (a.patient_context?.red_flags.length ?? 0) > 0;

  const heroClass = rejected ? "reject" : abnormal || ood ? "abnormal" : "normal";
  const headline = rejected
    ? "Automated interpretation inconclusive — image quality insufficient"
    : abnormal
      ? "Potential abnormal finding detected"
      : ood
        ? "Automated interpretation inconclusive"
        : "No significant abnormality detected by automated screening";

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10, marginBottom: 4 }}>
        <div>
          <div className="stat-label">Analysis complete</div>
          <h1 style={{ marginBottom: 2 }}>Result</h1>
          <p className="small muted" style={{ margin: 0 }}>
            {data.study?.study_id} • {a.study?.eye} • {a.study?.modality} • {new Date(a.provenance.analyzed_at).toLocaleString()}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link className="btn secondary sm" href={`/report?study=${encodeURIComponent(study)}`}>Report</Link>
          <Link className="btn sm" href={`/clinician?study=${encodeURIComponent(study)}`}>Clinical Review</Link>
        </div>
      </div>

      <div className={`result-hero ${heroClass}`} role="status">
        <div className="eyebrow">SCREENING RESULT</div>
        <h2>{headline}</h2>
        <p className="small" style={{ margin: 0, maxWidth: 640 }}>
          {rejected
            ? "Image quality is insufficient for reliable automated analysis. Please acquire another scan or have the image reviewed by an eye-care professional."
            : abnormal
              ? "The automated analysis identified the findings below. These are screening signals, not diagnoses, and require interpretation by a qualified eye-care professional."
              : ood
                ? "Input is outside the validated operating conditions of this model. Automated interpretation is inconclusive — normality is not claimed."
                : "This result means the system did not identify a significant abnormality in the supplied image under the conditions of this analysis. It does not guarantee that no eye disease is present."}
        </p>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1.45fr 1fr", alignItems: "start" }}>
        {/* ---- Scan viewer (prominent) ---- */}
        <div className="card" style={{ margin: 0, padding: 12 }}>
          <div className="card-title" style={{ padding: "0 4px", marginBottom: 8 }}>
            <h3 style={{ fontSize: "0.88rem" }}>Scan viewer</h3>
            <Badge tone="neutral">{a.study?.modality} • {a.study?.eye}</Badge>
          </div>
          {hasImage ? (
            <ScanViewer
              src={`/api/studies/${encodeURIComponent(study)}/image`}
              alt={`Original scan ${data.study?.study_id}`}
              region={activeRegion}
              overlayAvailable={activeRegion != null}
              overlayUnavailableNote="AI localization is not available for this model."
            />
          ) : (
            <EmptyState icon={<Icon name="eye" size={26} />} title="Original image unavailable" />
          )}
        </div>

        {/* ---- Analysis summary sidebar ---- */}
        <div style={{ display: "grid", gap: 14 }}>
          <div className="card" style={{ margin: 0 }}>
            <div className="card-title"><h3 style={{ fontSize: "0.88rem" }}>Analysis summary</h3></div>
            <dl className="kv" style={{ gridTemplateColumns: "120px 1fr" }}>
              <dt>Status</dt>
              <dd><Badge tone="warn">{a.model_registry?.model_status ?? "DEMO"}</Badge> <span className="tiny muted">research only</span></dd>
              <dt>Image quality</dt>
              <dd><Badge tone={a.quality.acceptable ? "ok" : "bad"}>{a.quality.status === "pass" ? "Good" : a.quality.status === "borderline" ? "Borderline" : "Insufficient"}</Badge> <span className="tiny muted">{a.quality.score}</span></dd>
              <dt>Findings</dt>
              <dd className="small">{abnormal ? `${a.findings.length} signal${a.findings.length > 1 ? "s" : ""} (synthetic demo)` : "No validated findings"}</dd>
              <dt>Uncertainty</dt>
              <dd className="small">{(a.uncertainty.overall * 100).toFixed(0)}%</dd>
              <dt>Symptom correlation</dt>
              <dd className="small">
                {a.symptom_correlation && a.patient_context?.reported
                  ? `${a.symptom_correlation.state.replaceAll("_", " ")} (research)`
                  : a.patient_context?.reported ? "inconclusive" : "no symptoms reported"}
              </dd>
              <dt>Model input</dt>
              <dd className="small">{a.model_registry?.model_input ?? "IMAGE_ONLY"}</dd>
            </dl>
          </div>

          <div className="card" style={{ margin: 0 }}>
            <div className="card-title"><h3 style={{ fontSize: "0.88rem" }}>Urgency</h3></div>
            <TriageBadge priority={a.recommendation.priority} />
            <p className="small" style={{ margin: "8px 0 0" }}>{a.recommendation.action}</p>
            <p className="tiny muted" style={{ margin: "4px 0 0" }}>{a.recommendation.rationale}</p>
          </div>

          <div className="card" style={{ margin: 0 }}>
            <div className="card-title"><h3 style={{ fontSize: "0.88rem" }}>Image quality detail</h3></div>
            <dl className="kv" style={{ gridTemplateColumns: "1fr auto" }}>
              {[
                ["Sharpness", !a.quality.artifacts.includes("blur")],
                ["Lighting", !a.quality.artifacts.includes("poor_illumination") && !a.quality.artifacts.includes("overexposure")],
                ["Glare", !a.quality.artifacts.includes("glare")],
                ["Resolution", !a.quality.artifacts.includes("insufficient_resolution")],
                ["Field of view", !a.quality.artifacts.includes("incorrect_field_of_view")],
              ].map(([label, ok]) => (
                <dt key={String(label)} style={{ display: "flex", justifyContent: "space-between", gridColumn: "1 / -1", borderBottom: "1px solid var(--border)", paddingBottom: 4 }}>
                  <span>{String(label)}</span>
                  <span className="qc-check" style={{ color: ok ? "var(--ok)" : "var(--danger)", fontWeight: 700 }}>{ok ? "●" : "✕"}</span>
                </dt>
              ))}
            </dl>
            {rejected && (
              <p className="tiny" style={{ color: "var(--danger)", marginBottom: 0 }}>
                Detected artifacts: {a.quality.artifacts.join(", ")}. No clinical findings are generated when quality is insufficient.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ---- Patient context ---- */}
      {a.patient_context?.reported && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="card-title">
            <h3>Patient context</h3>
            {a.patient_context.red_flags.length > 0 && <Badge tone="bad">⚠ RED FLAG</Badge>}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
            {a.patient_context.symptoms.map((s, i) => (
              <span key={i} className={`badge ${a.patient_context!.red_flags.includes(s.type) ? "bad" : "neutral"}`} title={`${s.onset} onset • ${s.duration.replaceAll("_", " ")} • ${s.severity} • ${s.laterality}`}>
                {s.label ?? s.type.replaceAll("_", " ")} • {s.severity} • {s.laterality === "right" ? "OD" : s.laterality === "left" ? "OS" : s.laterality}
              </span>
            ))}
          </div>
          <p className="tiny muted" style={{ marginBottom: 0 }}>{a.patient_context.note}</p>
        </div>
      )}

      {/* ---- Symptom correlation ---- */}
      {a.symptom_correlation && a.patient_context?.reported && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="card-title">
            <h3>Symptom / imaging correlation</h3>
            <Badge tone={a.symptom_correlation.state === "urgent" ? "bad" : a.symptom_correlation.state === "correlated" ? "info" : "warn"}>
              {a.symptom_correlation.state.replaceAll("_", " ").toUpperCase()}
            </Badge>
          </div>
          <div className="grid grid-2">
            <div>
              <div className="stat-label" style={{ marginBottom: 6 }}>Reported</div>
              {a.patient_context.symptoms.map((s, i) => (
                <div key={i} className="small" style={{ padding: "4px 0", borderBottom: "1px solid var(--border)" }}>{s.label ?? s.type}</div>
              ))}
            </div>
            <div>
              <div className="stat-label" style={{ marginBottom: 6 }}>Automated imaging</div>
              {abnormal
                ? a.findings.map((f) => <div key={f.id} className="small" style={{ padding: "4px 0", borderBottom: "1px solid var(--border)" }}>{f.type.replaceAll("_", " ")}</div>)
                : <div className="small muted" style={{ padding: "4px 0" }}>No validated findings are available from the current model.</div>}
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            {a.symptom_correlation.items.map((item, i) => (
              <p key={i} className="small" style={{ margin: "6px 0" }}>
                <strong>{item.symptom_label}</strong> — <Badge tone={item.state === "urgent" ? "bad" : item.state === "correlated" ? "info" : "warn"}>{item.state.replaceAll("_", " ")}</Badge>{" "}
                <span className="muted">{item.note}</span>
              </p>
            ))}
          </div>
          <p className="tiny muted" style={{ margin: "8px 0 0" }}>
            Status: {a.symptom_correlation.label}. {a.symptom_correlation.notes.join(" ")} Model input: {a.model_registry?.model_input ?? "IMAGE_ONLY"} —
            symptom correlation is never converted into model confidence.
          </p>
        </div>
      )}

      {/* ---- Findings ---- */}
      <h2>Findings</h2>
      {!abnormal && (
        <EmptyState icon={<Icon name="check" size={24} />} title={rejected ? "No findings — quality gate failed" : "No validated findings are available from the current model."}>
          {rejected
            ? "No clinical findings are generated when image quality is insufficient. This protects against unreliable interpretation."
            : "This does not mean the eye is healthy. It means the current model — an unvalidated research placeholder — produced no findings for this image. A negative result never guarantees absence of eye disease."}
        </EmptyState>
      )}
      {a.findings.map((f) => (
        <div key={f.id} className="finding-card" style={{ marginBottom: 10 }}>
          <div className="finding-head">
            <h3>POTENTIAL RETINAL FINDING — {f.type.replaceAll("_", " ").toUpperCase()}</h3>
            <span className="badge demo">Synthetic demo finding</span>
          </div>
          <dl className="kv" style={{ gridTemplateColumns: "130px 1fr", marginBottom: 10 }}>
            <dt>Location</dt><dd className="small">{f.location.replaceAll("_", " ")}</dd>
            <dt>Model</dt><dd className="small">{f.model_id}</dd>
            <dt>Model status</dt><dd className="small"><Badge tone="warn">{f.model_status ?? "DEMO"}</Badge> <span className="tiny muted">research only</span></dd>
            <dt>Validation</dt><dd className="small">Not clinically validated</dd>
          </dl>
          <ConfidenceIndicator finding={f} />
          <p className="small" style={{ marginTop: 8 }}>{f.explanation}</p>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            {f.region && hasImage
              ? <button className="btn secondary sm" onClick={() => setActiveRegion(f.region ?? null)}>View on scan</button>
              : <span className="tiny muted">AI localization is not available for this model.</span>}
          </div>
        </div>
      ))}

      {/* ---- Uncertainty / associations / conditions ---- */}
      <div className="grid grid-2" style={{ marginTop: 14 }}>
        <div className="card" style={{ margin: 0 }}>
          <div className="card-title"><h3>Uncertainty</h3><Badge tone="warn">{(a.uncertainty.overall * 100).toFixed(0)}%</Badge></div>
          <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
            {a.uncertainty.reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </div>
        <div className="card" style={{ margin: 0 }}>
          <div className="card-title"><h3>Possible conditions to consider</h3></div>
          {a.possible_conditions && a.possible_conditions.conditions.length > 0 ? (
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
              {a.possible_conditions.conditions.map((c) => <li key={c.id}>{c.label} — {c.note}</li>)}
            </ul>
          ) : (
            <p className="small muted" style={{ margin: 0 }}>
              No conditions are displayed: the current model is not validated, and condition inference requires
              documented validation evidence for the specific intended use. These would be associations, never an
              automated diagnosis.
            </p>
          )}
        </div>
      </div>

      <details className="tech card" style={{ marginTop: 14 }}>
        <summary>Advanced technical information</summary>
        <dl className="kv">
          <dt>Pipeline version</dt><dd>{a.provenance.pipeline_version}</dd>
          <dt>Ruleset version</dt><dd>{a.provenance.ruleset_version}</dd>
          <dt>Quality score</dt><dd>{a.quality.score} ({a.quality.status})</dd>
          <dt>Quality artifacts</dt><dd>{a.quality.artifacts.join(", ") || "none"}</dd>
          <dt>Ensemble agreement</dt><dd>{String(a.uncertainty.ensemble_agreement)}</dd>
          <dt>Device compatibility</dt><dd className="small">{a.model_registry?.device_compatibility.note}</dd>
          <dt>Model integrity</dt>
          <dd>
            <ul className="small" style={{ margin: 0, paddingLeft: 16 }}>
              {(a.model_registry?.integrity_checks ?? []).map((c, i) => (
                <li key={i}>{c.check}: {c.passed ? "✓" : "✕"} — {c.detail}</li>
              ))}
            </ul>
          </dd>
          <dt>Original SHA-256</dt><dd style={{ wordBreak: "break-all", fontFamily: "var(--mono)", fontSize: "0.76rem" }}>{data.study?.original_sha256}</dd>
        </dl>
      </details>

      <div style={{ display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
        <Link className="btn" href={`/report?study=${encodeURIComponent(study)}`}>Open full report</Link>
        <Link className="btn secondary" href="/analyze">Analyze another scan</Link>
        <Link className="btn secondary" href={`/compare?current=${encodeURIComponent(study)}`}>Compare with previous scan</Link>
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
