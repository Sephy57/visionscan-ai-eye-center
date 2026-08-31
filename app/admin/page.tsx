"use client";

import { useEffect, useState } from "react";

interface AdminData {
  validation_banner: string;
  audit_tail: Array<{ ts: string; actor: string; action: string; studyId?: string; outcome: string; detail?: string }>;
  components: Array<{ id: string; name: string; version: string; implementation: string; validationStatus: string; notes?: string }>;
  adapters: Array<{ id: string; displayName: string; status: string }>;
}

interface SelfTest {
  total: number; passed: number; all_passed: boolean;
  checks: Array<{ name: string; passed: boolean; detail?: string }>;
}

export default function AdminPage() {
  const [data, setData] = useState<AdminData | null>(null);
  const [selftest, setSelftest] = useState<SelfTest | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    fetch("/api/admin").then((r) => r.json()).then(setData).catch(() => {});
  }, []);

  async function runSelfTest() {
    setRunning(true);
    const r = await fetch("/api/selftest");
    setSelftest(await r.json());
    setRunning(false);
  }

  return (
    <div>
      <h1>System administration</h1>
      <p className="muted">System status, component registry, and audit trail.</p>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>System self-test</h2>
        <p className="small muted">
          Runs an end-to-end safety check with synthetic images (never patient data): upload, quality gate
          enforcement, schema validation, safety checks, synthetic labeling, red-flag triage escalation, deletion.
        </p>
        <button className="btn" onClick={runSelfTest} disabled={running}>
          {running ? "Running…" : "Run self-test"}
        </button>
        {selftest && (
          <div style={{ marginTop: 12 }}>
            <p>
              <strong>{selftest.passed}/{selftest.total} checks passed</strong>{" "}
              {selftest.all_passed
                ? <span className="badge ok">ALL PASSED</span>
                : <span className="badge bad">FAILURES DETECTED</span>}
            </p>
            <table className="table">
              <thead><tr><th>Check</th><th>Result</th><th>Detail</th></tr></thead>
              <tbody>
                {selftest.checks.map((c) => (
                  <tr key={c.name}>
                    <td><code className="small">{c.name}</code></td>
                    <td>{c.passed ? <span className="badge ok">pass</span> : <span className="badge bad">fail</span>}</td>
                    <td className="small muted">{c.detail ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Component registry (model versioning)</h2>
        <table className="table">
          <thead><tr><th>Component</th><th>Version</th><th>Implementation</th><th>Validation status</th><th>Notes</th></tr></thead>
          <tbody>
            {(data?.components ?? []).map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>{c.version}</td>
                <td>{c.implementation}</td>
                <td><span className="badge warn">{c.validationStatus}</span></td>
                <td className="small muted">{c.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="small muted">
          Every analysis records model name, version, checksum, timestamp, device, modality, input dimensions,
          quality score, outputs, confidence, and ruleset version for reproducibility.
        </p>
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Audit trail (most recent events)</h2>
        <p className="small muted">
          Audit logs contain event metadata only — never raw images, full reports, credentials, or tokens.
        </p>
        <table className="table">
          <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Study</th><th>Outcome</th><th>Detail</th></tr></thead>
          <tbody>
            {(data?.audit_tail ?? []).map((e, i) => (
              <tr key={i}>
                <td className="small">{e.ts}</td>
                <td>{e.actor}</td>
                <td>{e.action}</td>
                <td className="small"><code>{e.studyId ?? "—"}</code></td>
                <td>
                  {e.outcome === "ok" ? <span className="badge ok">ok</span> :
                   e.outcome === "rejected" ? <span className="badge warn">rejected</span> :
                   <span className="badge bad">error</span>}
                </td>
                <td className="small muted">{e.detail ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {(data?.audit_tail ?? []).length === 0 && <p className="muted small">No audit events yet.</p>}
      </div>
    </div>
  );
}
