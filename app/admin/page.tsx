"use client";

import { useEffect, useState } from "react";
import { Badge, StatusCard } from "@/components/ui";

interface AdminData {
  audit_tail: Array<{ ts: string; actor: string; action: string; studyId?: string; outcome: string; detail?: string }>;
  components: Array<{ id: string; name: string; version: string; implementation: string; validationStatus: string; notes?: string }>;
}
interface ModelsData {
  models: Array<{
    model_id: string; model_name: string; version: string; status: string;
    gate: { allowed: boolean; label: string | null; findings_use: string };
    integrity: { trusted: boolean; checks: Array<{ check: string; passed: boolean; detail: string }> };
    performance: Record<string, number | string | null>;
    model_card: string;
    sha256_masked: string | null;
  }>;
  consistency_problems: Array<{ model_id: string; problems: string[] }>;
  model_store_status: { path: string; populated: boolean; note: string };
}
interface SelfTest {
  total: number; passed: number; all_passed: boolean;
  checks: Array<{ name: string; passed: boolean; detail?: string }>;
}

export default function AdminPage() {
  const [data, setData] = useState<AdminData | null>(null);
  const [models, setModels] = useState<ModelsData | null>(null);
  const [selftest, setSelftest] = useState<SelfTest | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    fetch("/api/admin").then((r) => r.json()).then(setData).catch(() => {});
    fetch("/api/models").then((r) => r.json()).then(setModels).catch(() => {});
  }, []);

  async function runSelfTest() {
    setRunning(true);
    const r = await fetch("/api/selftest");
    setSelftest(await r.json());
    setRunning(false);
  }

  return (
    <div>
      <h1>System status</h1>
      <p className="muted">Software health, model registry, and audit trail. Operational ≠ validated: each is reported separately and honestly.</p>

      <div className="grid grid-4" style={{ marginTop: 18 }}>
        <StatusCard label="Application" value="Operational" tone="ok" />
        <StatusCard label="Database" value="Operational" tone="ok" detail="JSON store on D: (SQLite-ready interface)" />
        <StatusCard label="Storage" value="Operational" tone="ok" detail="uploads / processed / reports on D:" />
        <StatusCard label="Image Quality Engine" value="Operational" tone="ok" detail="Thresholds not clinically validated" />
        <StatusCard label="AI Model" value="NOT VALIDATED" tone="warn" detail="Demo/synthetic only — data\models is empty" />
        <StatusCard label="Safety Engine" value="Operational" tone="ok" detail="Triage rules, safety validator" />
        <StatusCard label="Audit Logging" value="Operational" tone="ok" detail="Append-only NDJSON on D:" />
        <StatusCard label="Auth / RBAC" value="NOT IMPLEMENTED" tone="bad" detail="Do not expose to untrusted networks" />
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <div className="card-title">
          <h3>Model registry</h3>
          {models?.model_store_status && <Badge tone={models.model_store_status.populated ? "ok" : "neutral"}>data\models: {models.model_store_status.populated ? "populated" : "empty by design"}</Badge>}
        </div>
        {models?.consistency_problems && models.consistency_problems.length > 0 && (
          <div className="alert danger"><span className="alert-icon" aria-hidden="true">⚠</span><div className="alert-body"><strong>Registry consistency problems</strong>{JSON.stringify(models.consistency_problems)}</div></div>
        )}
        <div className="grid grid-2">
          {(models?.models ?? []).map((m) => (
            <div key={m.model_id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <strong className="small">{m.model_name}</strong>
                <Badge tone="warn">{m.status}</Badge>
              </div>
              <p className="tiny muted" style={{ margin: "4px 0 8px" }}>
                {m.model_id} v{m.version} • checksum {m.sha256_masked ?? "none (placeholder)"}
              </p>
              <dl className="kv" style={{ gridTemplateColumns: "130px 1fr" }}>
                <dt>Use permitted</dt><dd>{m.gate.allowed ? `yes — ${m.gate.findings_use.replaceAll("_", " ")}` : "no"}</dd>
                <dt>Mandatory label</dt><dd className="tiny">{m.gate.label ?? "none"}</dd>
                <dt>Sensitivity</dt><dd>{m.performance.sensitivity === null ? "Not measured" : String(m.performance.sensitivity)}</dd>
                <dt>AUROC</dt><dd>{m.performance.auroc === null ? "Not measured" : String(m.performance.auroc)}</dd>
                <dt>Integrity</dt><dd>{m.integrity.trusted ? "✓ verified" : "✕ rejected"}</dd>
              </dl>
              <details className="tech" style={{ marginTop: 8 }}>
                <summary>Model card</summary>
                <pre className="code-block" style={{ whiteSpace: "pre-wrap" }}>{m.model_card}</pre>
              </details>
            </div>
          ))}
        </div>
        {models?.model_store_status && <p className="tiny muted" style={{ marginTop: 10, marginBottom: 0 }}>{models.model_store_status.note}</p>}
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <div className="card-title"><h3>Pipeline component registry</h3></div>
        <div style={{ overflowX: "auto" }} tabIndex={0}>
          <table className="table">
            <thead><tr><th>Component</th><th>Version</th><th>Implementation</th><th>Validation status</th><th>Notes</th></tr></thead>
            <tbody>
              {(data?.components ?? []).map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td><td>{c.version}</td><td>{c.implementation}</td>
                  <td><Badge tone="warn">{c.validationStatus}</Badge></td>
                  <td className="tiny muted">{c.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <div className="card-title">
          <h3>System self-test</h3>
          <button className="btn sm" onClick={runSelfTest} disabled={running}>{running ? "Running…" : "Run self-test"}</button>
        </div>
        <p className="tiny muted" style={{ marginTop: 0 }}>
          End-to-end safety verification with synthetic images (never patient data): upload, quality gate, schema
          validation, safety checks, synthetic labeling, red-flag triage escalation, deletion.
        </p>
        {selftest && (
          <>
            <p>
              <strong>{selftest.passed}/{selftest.total} checks passed</strong>{" "}
              {selftest.all_passed ? <Badge tone="ok">ALL PASSED</Badge> : <Badge tone="bad">FAILURES DETECTED</Badge>}
            </p>
            <div style={{ overflowX: "auto" }} tabIndex={0}>
              <table className="table">
                <thead><tr><th>Check</th><th>Result</th><th>Detail</th></tr></thead>
                <tbody>
                  {selftest.checks.map((c) => (
                    <tr key={c.name}>
                      <td><code className="tiny">{c.name}</code></td>
                      <td>{c.passed ? <Badge tone="ok">pass</Badge> : <Badge tone="bad">fail</Badge>}</td>
                      <td className="tiny muted">{c.detail ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <div className="card-title"><h3>Audit trail</h3><Badge tone="neutral">append-only, metadata only</Badge></div>
        <div style={{ overflowX: "auto", maxHeight: 420, overflowY: "auto" }} tabIndex={0}>
          <table className="table">
            <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Study</th><th>Outcome</th><th>Detail</th></tr></thead>
            <tbody>
              {(data?.audit_tail ?? []).map((e, i) => (
                <tr key={i}>
                  <td className="tiny">{new Date(e.ts).toLocaleString()}</td>
                  <td className="small">{e.actor}</td>
                  <td className="small">{e.action}</td>
                  <td className="tiny"><code>{e.studyId ? e.studyId.slice(0, 16) + "…" : "—"}</code></td>
                  <td>
                    {e.outcome === "ok" ? <Badge tone="ok">ok</Badge> : e.outcome === "rejected" ? <Badge tone="warn">rejected</Badge> : <Badge tone="bad">error</Badge>}
                  </td>
                  <td className="tiny muted">{e.detail ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {(data?.audit_tail ?? []).length === 0 && <p className="muted small">No audit events yet.</p>}
      </div>
    </div>
  );
}
