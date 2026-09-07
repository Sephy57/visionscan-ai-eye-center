"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui";
import { Icon } from "@/components/icons";

interface ModelData {
  models: Array<{
    model_id: string; model_name: string; version: string; status: string;
    input_schema: string; uses_symptoms: boolean; supported_conditions: string[];
    sha256_masked: string | null; format: string | null; regulatory_status: string;
    gate: { allowed: boolean; label: string | null; findings_use: string };
    integrity: { trusted: boolean; checks: Array<{ check: string; passed: boolean; detail: string }> };
    performance: Record<string, number | string | null>;
    validation_date: string | null;
    external_validation_status: string;
    devices: Array<{ manufacturer: string; model: string }>;
    model_card: string;
  }>;
  consistency_problems: Array<{ model_id: string; problems: string[] }>;
  model_store_status: { path: string; populated: boolean; note: string };
}

interface HealthResult {
  healthy: boolean;
  checked_at: string;
  steps: Array<{ step: string; passed: boolean; detail?: string }>;
}

interface CoverageData {
  coverage_version: string;
  production_coverage_count: number;
  global_notice: string;
  entries: Array<{
    target_id: string; display_name: string; modality: string; task: string; state: string;
    model_id: string | null; production_available: boolean; pipeline_enabled: boolean;
    localization: string; calibration: string; result_semantics: string;
  }>;
}

interface CandidateDossier {
  candidate_id: string;
  model_name: string;
  source: string;
  license: string;
  license_compatible_for_commercial_clinical_use: boolean | "UNKNOWN";
  modality: string[];
  intended_task: string;
  evidence_quality: string;
  unresolved_blockers: string[];
  status: string;
}

function CandidateRow({ c }: { c: CandidateDossier }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card" style={{ margin: 0 }}>
      <div className="card-title">
        <div>
          <h3 style={{ marginBottom: 1 }}>{c.model_name}</h3>
          <span className="tiny muted">{c.candidate_id} · {c.modality.join(", ")}</span>
        </div>
        <Badge tone="warn">{c.status}</Badge>
      </div>
      <dl className="kv" style={{ gridTemplateColumns: "150px 1fr" }}>
        <dt>License</dt><dd className="tiny">{c.license}</dd>
        <dt>Commercial/clinical use</dt>
        <dd>
          {c.license_compatible_for_commercial_clinical_use === true
            ? <Badge tone="ok">compatible</Badge>
            : c.license_compatible_for_commercial_clinical_use === false
              ? <Badge tone="bad">incompatible</Badge>
              : <Badge tone="warn">UNKNOWN</Badge>}
        </dd>
        <dt>Intended task</dt><dd className="tiny">{c.intended_task}</dd>
        <dt>Evidence quality</dt><dd className="tiny">{c.evidence_quality.replaceAll("_", " ")}</dd>
        <dt>Source</dt><dd className="tiny" style={{ wordBreak: "break-all" }}>{c.source}</dd>
      </dl>
      <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {open ? "Hide" : "View"} unresolved blockers ({c.unresolved_blockers.length})
      </button>
      {open && (
        <ul className="tiny" style={{ marginTop: 8, paddingLeft: 18 }}>
          {c.unresolved_blockers.map((b, i) => <li key={i}>{b}</li>)}
        </ul>
      )}
    </div>
  );
}

function ModelRow({ m }: { m: ModelData["models"][number] }) {
  const [open, setOpen] = useState(false);
  const [health, setHealth] = useState<HealthResult | null>(null);
  const [checkingHealth, setCheckingHealth] = useState(false);
  const statusTone = m.status === "DEMO" ? "demo" : m.status === "RESEARCH" ? "warn" : m.status === "RETIRED" ? "bad" : "info";

  async function checkHealth() {
    setCheckingHealth(true);
    try {
      const res = await fetch(`/api/models/${encodeURIComponent(m.model_id)}/health`);
      setHealth(await res.json());
    } catch {
      setHealth(null);
    } finally {
      setCheckingHealth(false);
    }
  }

  return (
    <div className="card" style={{ margin: 0 }}>
      <div className="card-title">
        <div>
          <h3 style={{ marginBottom: 1 }}>{m.model_name}</h3>
          <span className="tiny muted">{m.model_id} · v{m.version} · {m.format ?? "no artifact"}</span>
        </div>
        <Badge tone={statusTone as "demo" | "warn" | "bad" | "info"}>{m.status}</Badge>
      </div>
      <dl className="kv" style={{ gridTemplateColumns: "150px 1fr" }}>
        <dt>Current status</dt><dd><Badge tone={statusTone as "demo" | "warn" | "bad" | "info"}>{m.status}</Badge></dd>
        <dt>Why this status</dt><dd className="tiny">{m.gate.label ?? "—"}{!m.gate.allowed && " · use currently rejected by the registry gate"}</dd>
        <dt>Clinical validation</dt><dd><Badge tone="warn">NOT VALIDATED</Badge></dd>
        <dt>External validation</dt><dd className="tiny">{m.external_validation_status.replaceAll("_", " ")}</dd>
        <dt>Input type</dt><dd>{m.input_schema} · uses symptoms: {m.uses_symptoms ? "YES" : "NO"}</dd>
        <dt>Supported conditions</dt><dd>{m.supported_conditions.length === 0 ? "None" : m.supported_conditions.join(", ")}</dd>
        <dt>Validated devices</dt><dd>{m.devices.length === 0 ? "None — device compatibility has not been validated" : m.devices.map((d) => `${d.manufacturer} ${d.model}`).join(", ")}</dd>
        <dt>Checksum</dt><dd className="tiny" style={{ fontFamily: "var(--mono)" }}>{m.sha256_masked ?? "no artifact (placeholder)"}</dd>
        <dt>Regulatory status</dt><dd className="tiny">{m.regulatory_status === "none" ? "None — regulatory review required before clinical use" : m.regulatory_status}</dd>
        <dt>Integrity</dt><dd>{m.integrity.trusted ? <Badge tone="ok">verified</Badge> : <Badge tone="bad">rejected</Badge>}</dd>
        <dt>Metrics</dt><dd className="tiny">Not measured (no evaluation evidence)</dd>
      </dl>
      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <button className="btn ghost sm" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? "Hide" : "View"} model card
        </button>
        <button className="btn secondary sm" onClick={checkHealth} disabled={checkingHealth}>
          {checkingHealth ? "Checking…" : "Check health"}
        </button>
      </div>
      {open && <pre className="code-block" style={{ whiteSpace: "pre-wrap", marginTop: 10 }}>{m.model_card}</pre>}
      {health && (
        <div className="tiny" style={{ marginTop: 10, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
          <Badge tone={health.healthy ? "ok" : "bad"}>{health.healthy ? "HEALTHY" : "UNHEALTHY"}</Badge>{" "}
          <span className="muted">checked {new Date(health.checked_at).toLocaleTimeString()}</span>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {health.steps.map((s, i) => (
              <li key={i}>{s.step}: {s.passed ? "ok" : `failed${s.detail ? ` — ${s.detail}` : ""}`}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function ModelsPage() {
  const [data, setData] = useState<ModelData | null>(null);
  const [candidates, setCandidates] = useState<CandidateDossier[] | null>(null);
  const [coverage, setCoverage] = useState<CoverageData | null>(null);

  useEffect(() => {
    fetch("/api/models").then((r) => r.json()).then(setData).catch(() => {});
    fetch("/api/models/candidates").then((r) => (r.ok ? r.json() : null)).then((j) => setCandidates(j?.candidates ?? null)).catch(() => {});
    fetch("/api/models/coverage").then((r) => (r.ok ? r.json() : null)).then(setCoverage).catch(() => {});
  }, []);

  return (
    <div>
      <div className="stat-label">Model management</div>
      <h1 style={{ marginBottom: 2 }}>Models</h1>
      <p className="muted small">
        Registered models, their status and <strong>why</strong> they hold it. Status transitions require
        registered evidence — a typed &ldquo;validated: true&rdquo; is never accepted.
      </p>

      {data?.consistency_problems && data.consistency_problems.length > 0 && (
        <div className="alert danger" style={{ marginTop: 14 }}>
          <span className="alert-icon" aria-hidden="true">⚠</span>
          <div className="alert-body"><strong>Registry consistency problems</strong>{JSON.stringify(data.consistency_problems)}</div>
        </div>
      )}

      <div className="alert info" style={{ marginTop: 16 }}>
        <span className="alert-icon" aria-hidden="true">◈</span>
        <div className="alert-body">
          <strong>Model store</strong>
          {data?.model_store_status.note ?? "data\\models is intentionally empty. No validated medical model is installed."}
          <div className="tiny" style={{ marginTop: 4 }}>Packages are installed under <code>data\models\&lt;model_id&gt;\manifest.json</code> + artifact, verified by SHA-256 on every load (fail-closed).</div>
        </div>
      </div>

      <div style={{ display: "grid", gap: 14, marginTop: 16 }}>
        {(data?.models ?? []).map((m) => <ModelRow key={m.model_id} m={m} />)}
      </div>

      {coverage && (
        <div className="card" style={{ marginTop: 18 }}>
          <div className="card-title">
            <h3>Imaging capability coverage</h3>
            <Badge tone={coverage.production_coverage_count === 0 ? "warn" : "ok"}>{coverage.production_coverage_count} production targets</Badge>
          </div>
          <p className="small" style={{ marginTop: 0 }}>{coverage.global_notice}</p>
          <div className="table-wrap" tabIndex={0}>
            <table className="table">
              <caption className="sr-only">Ophthalmic imaging targets, model availability, calibration, and pipeline status</caption>
              <thead><tr><th scope="col">Target</th><th scope="col">Modality / task</th><th scope="col">Coverage state</th><th scope="col">Model</th><th scope="col">Localization / calibration</th></tr></thead>
              <tbody>
                {coverage.entries.map((entry) => (
                  <tr key={`${entry.modality}-${entry.target_id}`}>
                    <td>{entry.display_name}</td>
                    <td className="tiny">{entry.modality} · {entry.task.replaceAll("_", " ")}</td>
                    <td><Badge tone={entry.state === "RESEARCH_ANATOMY_ONLY" ? "warn" : "bad"}>{entry.state.replaceAll("_", " ")}</Badge></td>
                    <td className="tiny">{entry.model_id ?? "none"}<br />Pipeline: {entry.pipeline_enabled ? "enabled" : "disabled"}</td>
                    <td className="tiny">{entry.localization.replaceAll("_", " ")}<br />{entry.calibration.replaceAll("_", " ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="tiny muted" style={{ marginBottom: 0 }}>Registry version {coverage.coverage_version}. This is explicit negative-space disclosure, not a performance claim.</p>
        </div>
      )}

      {candidates && candidates.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: "1rem", marginBottom: 4 }}>Candidate models (research dossiers only)</h2>
          <p className="tiny muted" style={{ marginTop: 0 }}>
            Real-world models researched for a possible future S6+ installation. None are installed, registered, or
            reachable by the analysis pipeline — <code>data\models\</code> remains empty and Gate A remains CLOSED.
            Every entry lists unresolved blockers that must be cleared by a human before installation could even be
            considered.
          </p>
          <div style={{ display: "grid", gap: 14 }}>
            {candidates.map((c) => <CandidateRow key={c.candidate_id} c={c} />)}
          </div>
        </div>
      )}

      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-title"><h3>Status ladder &amp; evidence requirements</h3></div>
        <div className="table-wrap" tabIndex={0}>
          <table className="table">
            <thead><tr><th>Transition</th><th>Required evidence</th></tr></thead>
            <tbody>
              <tr><td><code>DEMO → RESEARCH</code></td><td className="tiny">Research-use acknowledgement; output labeled RESEARCH USE ONLY.</td></tr>
              <tr><td><code>RESEARCH → INTERNAL_VALIDATION</code></td><td className="tiny">≥1 registered evaluation on internal held-out data + validation date.</td></tr>
              <tr><td><code>INTERNAL_VALIDATION → EXTERNALLY_VALIDATED</code></td><td className="tiny">≥2 evidence records incl. independent external dataset + calibration evidence + validation date.</td></tr>
              <tr><td><code>EXTERNALLY_VALIDATED → CLINICALLY_VALIDATED</code></td><td className="tiny">≥3 evidence records incl. external study + clinical evaluation + calibration.</td></tr>
            </tbody>
          </table>
        </div>
        <p className="tiny muted" style={{ marginBottom: 0 }}>
          Skipping ladder steps is rejected. Every transition decision is audited. See <code>/evaluations</code> for the
          research evaluation dashboard and <code>/admin</code> for the audit trail.
        </p>
      </div>
    </div>
  );
}
