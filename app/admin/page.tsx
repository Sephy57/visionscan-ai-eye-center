"use client";

import { useEffect, useState } from "react";
import { Badge, PageHeader, StatusCard } from "@/components/ui";

interface AdminData {
  audit_tail: Array<{ ts: string; actor: string; action: string; studyId?: string; outcome: string; detail?: string }>;
  next_cursor?: string | null;
  has_more?: boolean;
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
interface OperationsData {
  status: string;
  checks?: Record<string, { ok?: boolean; models?: number; consistency_problems?: number } | undefined>;
  persistence?: {
    database_bytes?: number; jobs_total?: number; jobs_active?: number; stale_leases?: number; failed_jobs?: number; reconciliation_errors?: number;
    backup?: { status?: string; latest_at?: string | null; age_seconds?: number | null; usable_count?: number; phi_included?: boolean };
    migration?: { status?: string; backend?: string; database_schema_version?: number; migration_version?: number; phi_included?: boolean };
    validation_errors?: { status?: string; total?: number; phi_included?: boolean };
  };
}
interface ReconciliationData {
  issues?: Array<{ issue_id: string; kind: string; resource: string; detail: string }>;
  counts?: Record<string, number>;
}

export default function AdminPage() {
  const [data, setData] = useState<AdminData | null>(null);
  const [models, setModels] = useState<ModelsData | null>(null);
  const [selftest, setSelftest] = useState<SelfTest | null>(null);
  const [operations, setOperations] = useState<OperationsData | null>(null);
  const [reconciliation, setReconciliation] = useState<ReconciliationData | null>(null);
  const [running, setRunning] = useState(false);
  const [live, setLive] = useState<boolean | null>(null);
  const [auditAuthorized, setAuditAuthorized] = useState<boolean | null>(null);
  const [auditCursor, setAuditCursor] = useState<string | null>(null);
  const [auditHasMore, setAuditHasMore] = useState(false);
  const [loadingAudit, setLoadingAudit] = useState(false);

  async function loadAudit(cursor?: string, append = false) {
    if (append) setLoadingAudit(true);
    try {
      const query = new URLSearchParams({ limit: "50" });
      if (cursor) query.set("cursor", cursor);
      const response = await fetch(`/api/admin?${query.toString()}`);
      setAuditAuthorized(response.ok);
      if (!response.ok) throw new Error("audit unavailable");
      const payload = await response.json() as AdminData;
      setData((previous) => append && previous
        ? { ...previous, audit_tail: [...previous.audit_tail, ...(payload.audit_tail ?? [])] }
        : payload);
      setAuditCursor(typeof payload.next_cursor === "string" ? payload.next_cursor : null);
      setAuditHasMore(payload.has_more === true);
    } finally {
      setLoadingAudit(false);
    }
  }

  useEffect(() => {
    loadAudit().catch(() => {});
    fetch("/api/health/live").then((r) => setLive(r.ok)).catch(() => setLive(false));
    fetch("/api/models").then((r) => r.json()).then(setModels).catch(() => {});
    fetch("/api/health/ready").then((r) => r.json()).then(setOperations).catch(() => {});
    fetch("/api/admin/metrics").then((r) => r.json()).then((r) => setOperations((previous) => ({ ...(previous ?? {}), ...r }))).catch(() => {});
    fetch("/api/admin/reconciliation").then((r) => r.json()).then(setReconciliation).catch(() => {});
  }, []);

  async function runSelfTest() {
    setRunning(true);
    const r = await fetch("/api/selftest");
    setSelftest(await r.json());
    setRunning(false);
  }

  return (
    <div>
      <PageHeader eyebrow="System" title="System status" lede="Software health, model registry, and audit trail. Operational ≠ validated: each is probed and reported separately. Nothing on this page is assumed healthy without a check." />

      {(() => {
        const check = (key: string) => operations?.checks?.[key]?.ok;
        const probe = (ok: boolean | undefined | null, yes: string, no: string, pending = "Checking…"): { value: string; tone: "ok" | "bad" | "neutral" } =>
          ok === undefined || ok === null ? { value: operations || live !== null ? pending : "Checking…", tone: "neutral" } : ok ? { value: yes, tone: "ok" } : { value: no, tone: "bad" };
        const storageOk = check("storage_uploads") === undefined ? undefined : Boolean(check("storage_uploads") && check("storage_reports"));
        const selftestState = selftest ? (selftest.all_passed ? { value: "Self-test passed", tone: "ok" as const } : { value: "Self-test failures", tone: "bad" as const }) : { value: "Not probed", tone: "neutral" as const };
        const research = (models?.models ?? []).filter((m) => m.status === "RESEARCH").length;
        const cards: Array<{ label: string; value: string; tone: "ok" | "warn" | "bad" | "neutral"; detail: string }> = [
          { label: "Application", ...probe(live, "Responding", "Unreachable"), detail: "Liveness probe /api/health/live" },
          { label: "Database", ...probe(check("database"), "Ready", "Not ready", "Not reported"), detail: "Readiness check: connection + schema" },
          { label: "Storage", ...probe(storageOk, "Ready", "Missing root", "Not reported"), detail: "Upload and report roots present on local disk" },
          { label: "Model registry", ...probe(check("model_registry"), "Consistent", "Inconsistent", "Not reported"), detail: `${operations?.checks?.model_registry?.models ?? "—"} registered · inference not probed` },
          { label: "AI models", value: models ? `${research} RESEARCH ONLY` : "—", tone: models ? "warn" : "neutral", detail: "Hash-verified research artifacts; no clinical validation" },
          { label: "Quality & safety engines", ...selftestState, detail: selftest ? `${selftest.passed}/${selftest.total} self-test checks` : "Run the self-test below to verify with synthetic images" },
          { label: "Audit logging", value: data ? `${data.audit_tail.length} event(s) readable` : auditAuthorized === false ? "Unavailable" : "Checking…", tone: data ? "ok" : auditAuthorized === false ? "bad" : "neutral", detail: "Append-only, metadata only" },
          { label: "Auth / RBAC", value: auditAuthorized === null ? "Checking…" : auditAuthorized ? "Enforced" : "Denied", tone: auditAuthorized === null ? "neutral" : auditAuthorized ? "ok" : "warn", detail: auditAuthorized ? "This ADMIN-only request passed session, role, and scope checks" : "Session, role, CSRF, and resource-scope checks are server-side" },
        ];
        return (
          <div className="grid grid-4">
            {cards.map((c) => <StatusCard key={c.label} label={c.label} value={c.value} tone={c.tone} detail={c.detail} />)}
          </div>
        );
      })()}

      <div className="card" style={{ marginTop: 20 }}>
        <div className="card-title"><h3>Durable operations</h3><Badge tone={operations?.status === "ready" ? "ok" : "warn"}>{operations?.status ?? "loading"}</Badge></div>
        <div className="grid grid-4">
          <StatusCard label="Queued jobs" value={String(operations?.persistence?.jobs_total ?? "—")} tone="neutral" />
          <StatusCard label="Active leases" value={String(operations?.persistence?.jobs_active ?? "—")} tone="neutral" />
          <StatusCard label="Stale leases" value={String(operations?.persistence?.stale_leases ?? "—")} tone={(operations?.persistence?.stale_leases ?? 0) > 0 ? "warn" : "ok"} />
          <StatusCard label="Reconciliation errors" value={String(operations?.persistence?.reconciliation_errors ?? "—")} tone={(operations?.persistence?.reconciliation_errors ?? 0) > 0 ? "warn" : "ok"} />
        </div>
        <p className="tiny muted" style={{ marginBottom: 0 }}>Aggregate metadata only; no patient identifiers, source bytes, or model inference are exposed.</p>
        <div className="grid grid-3" style={{ marginTop: 14 }}>
          <StatusCard
            label="Backup status"
            value={operations?.persistence?.backup?.status === "available" ? "Available" : operations?.persistence?.backup?.status === "missing" ? "Missing" : "—"}
            tone={operations?.persistence?.backup?.status === "available" ? "ok" : "warn"}
            detail={operations?.persistence?.backup?.latest_at ? `Latest ${new Date(operations.persistence.backup.latest_at).toLocaleString()}` : "No verified data backup found"}
          />
          <StatusCard
            label="Migration status"
            value={operations?.persistence?.migration?.status === "current" ? "Current" : operations?.persistence?.migration?.status === "legacy_json" ? "Legacy JSON" : "—"}
            tone={operations?.persistence?.migration?.status === "current" ? "ok" : "warn"}
            detail={operations?.persistence?.migration ? `${operations.persistence.migration.backend} schema ${operations.persistence.migration.database_schema_version} / migration ${operations.persistence.migration.migration_version}` : "Loading schema metadata"}
          />
          <StatusCard
            label="Validation errors"
            value={String(operations?.persistence?.validation_errors?.total ?? "—")}
            tone={(operations?.persistence?.validation_errors?.total ?? 0) > 0 ? "warn" : "ok"}
            detail={(operations?.persistence?.validation_errors?.total ?? 0) > 0 ? "Aggregate records awaiting review" : "No recorded model-validation errors"}
          />
        </div>
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <div className="card-title"><h3>Reconciliation plan</h3><Badge tone={(reconciliation?.issues?.length ?? 0) > 0 ? "warn" : "ok"}>{reconciliation ? `${reconciliation.issues?.length ?? 0} issue(s)` : "loading"}</Badge></div>
        <p className="tiny muted">Read-only scan. Repairs require a separate, explicit administrator action; originals are never auto-deleted.</p>
        {(reconciliation?.issues ?? []).length > 0 && <div className="table-wrap" tabIndex={0} role="region" aria-label="Table"><table className="table"><thead><tr><th>Kind</th><th>Resource</th><th>Detail</th></tr></thead><tbody>{(reconciliation?.issues ?? []).slice(0, 100).map((issue) => <tr key={issue.issue_id}><td><code className="tiny">{issue.kind}</code></td><td className="small">{issue.resource}</td><td className="tiny muted">{issue.detail}</td></tr>)}</tbody></table></div>}
        {(reconciliation?.issues ?? []).length === 0 && <p className="muted small">No reconciliation issues found.</p>}
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <div className="card-title">
          <h3>Model registry</h3>
          {models?.model_store_status && <Badge tone={models.model_store_status.populated ? "ok" : "neutral"}>Model store: {models.model_store_status.populated ? "research artifacts" : "empty"}</Badge>}
        </div>
        {models?.consistency_problems && models.consistency_problems.length > 0 && (
          <div className="alert danger"><span className="alert-icon" aria-hidden="true">!</span><div className="alert-body"><strong>Registry consistency problems</strong>{JSON.stringify(models.consistency_problems)}</div></div>
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
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Table">
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
            <div className="table-wrap" tabIndex={0} role="region" aria-label="Table">
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
        <div className="table-wrap" style={{ maxHeight: 420, overflowY: "auto" }} tabIndex={0} role="region" aria-label="Audit trail">
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
        {auditHasMore && auditCursor && (
          <button className="btn secondary sm" style={{ marginTop: 10 }} onClick={() => loadAudit(auditCursor, true)} disabled={loadingAudit}>
            {loadingAudit ? "Loading…" : "Load more audit events"}
          </button>
        )}
      </div>
    </div>
  );
}
