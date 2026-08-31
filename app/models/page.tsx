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

function ModelRow({ m }: { m: ModelData["models"][number] }) {
  const [open, setOpen] = useState(false);
  const statusTone = m.status === "DEMO" ? "demo" : m.status === "RESEARCH" ? "warn" : m.status === "RETIRED" ? "bad" : "info";
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
      <button className="btn ghost sm" style={{ marginTop: 10 }} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {open ? "Hide" : "View"} model card
      </button>
      {open && <pre className="code-block" style={{ whiteSpace: "pre-wrap", marginTop: 10 }}>{m.model_card}</pre>}
    </div>
  );
}

export default function ModelsPage() {
  const [data, setData] = useState<ModelData | null>(null);

  useEffect(() => {
    fetch("/api/models").then((r) => r.json()).then(setData).catch(() => {});
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

      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-title"><h3>Status ladder &amp; evidence requirements</h3></div>
        <div className="table-wrap">
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
