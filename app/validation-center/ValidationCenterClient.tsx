"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./ValidationCenter.module.css";

type Status = "ok" | "warn" | "bad" | "neutral";

interface Run {
  run_id: string;
  model_id: string;
  model_version: string;
  split: string;
  cases: number;
  patient_count: number | null;
  device_count: number | null;
  modality: string | null;
  metrics: {
    sensitivity: number | null;
    specificity: number | null;
    ppv: number | null;
    npv: number | null;
    auroc: number | null;
    auprc: number | null;
    ece: number | null;
  };
  errors: {
    false_negatives: number;
    false_positives: number;
    missed_urgent_cases: number;
    quality_blocked: number;
    out_of_distribution: number;
    urgent_fn_rate: number | null;
  };
  created_at: string;
}

interface DashboardResponse {
  schema_version?: string;
  phi_included?: boolean;
  notice?: string;
  runs?: Run[];
  totals?: {
    cases: number;
    false_negatives: number;
    false_positives: number;
    missed_urgent_cases: number;
    quality_blocked: number;
    out_of_distribution: number;
  };
}

interface ModelRecord {
  model_id: string;
  model_name: string;
  version: string;
  status: string;
  format: string | null;
  modalities: string[];
  input_schema: string;
  intended_use: string;
  limitations: string[];
  sha256_masked: string | null;
  regulatory_status: string;
  gate?: { allowed: boolean; label: string | null; findings_use: string };
  integrity?: { trusted: boolean; checks: Array<{ check: string; passed: boolean; detail?: string }> };
}

interface ModelsResponse {
  models?: ModelRecord[];
  model_store_status?: { populated: boolean; note: string };
}

interface ValidationDataset {
  name: string;
  split: string;
  license: string;
  n_images: number | null;
  n_patients: number | null;
  patient_separation: "VERIFIED_DISJOINT" | "NOT_VERIFIABLE" | "OVERLAP_DISCLOSED";
  external_to_training: boolean;
  overlap_note: string;
  evidence_doc: string;
}

interface ValidationEntry {
  model_id: string;
  model_version: string;
  artifact_sha256: string;
  status: string;
  datasets: ValidationDataset[];
  metrics_summary: string;
  calibration: string;
  device_scope: string;
  population_scope: string;
  limitations: string[];
  last_review_date: string;
}

interface ValidationRegistryResponse {
  registry_version?: string;
  notice?: string;
  entries?: ValidationEntry[];
}

interface HealthResponse {
  model_id: string;
  healthy: boolean;
  checked_at: string;
  steps: Array<{ step: string; passed: boolean; detail?: string }>;
}

interface ReadyResponse {
  status?: string;
  inference?: string;
  checks?: Record<string, { ok?: boolean; backend?: string; models?: number; consistency_problems?: number; path_configured?: boolean }>;
}

interface LiveResponse {
  status?: string;
  service?: string;
  inference?: string;
  timestamp?: string;
}

interface AdminMetricsResponse {
  scope?: string;
  phi_included?: boolean;
  persistence?: {
    jobs_total: number;
    jobs_active: number;
    stale_leases: number;
    failed_jobs: number;
    reconciliation_errors: number;
    validation_errors: { total: number; status: string; phi_included?: boolean };
    migration: { backend: string; database_schema_version: number; migration_version: number; status: string; phi_included?: boolean };
    backup: { status: string; age_seconds: number | null; usable_count: number; phi_included?: boolean };
  };
}

interface AdminResponse {
  audit_chain_integrity?: { valid?: boolean; events_checked?: number; first_break?: string | null };
  audit_tail?: Array<{ ts: string; action: string; outcome: string; role?: string; resource?: string }>;
}

interface OperationsResponse {
  schema_version?: string;
  phi_included?: boolean;
  queue?: {
    counts?: Record<string, number>;
    running_deadline_overdue?: number;
    active_processes?: number;
    has_more?: boolean;
  };
  worker?: { mode?: string; crash_recovery?: string; termination?: string };
  resource_governor?: {
    configured?: boolean;
    reserved?: { memoryBytes: number; threads: number };
    available?: { memoryBytes: number; threads: number };
    budget?: { memoryBytes: number; threads: number } | null;
    activeReservations?: number;
  };
  deadline?: { default_ms?: number; enforced_from_claim?: boolean; no_unbounded_jobs?: boolean };
}

interface Source<T> {
  data: T | null;
  error: string | null;
}

interface CenterData {
  dashboard: Source<DashboardResponse>;
  models: Source<ModelsResponse>;
  registry: Source<ValidationRegistryResponse>;
  live: Source<LiveResponse>;
  ready: Source<ReadyResponse>;
  metrics: Source<AdminMetricsResponse>;
  admin: Source<AdminResponse>;
  operations: Source<OperationsResponse>;
  health: Record<string, Source<HealthResponse>>;
}

const emptySource = <T,>(): Source<T> => ({ data: null, error: null });

const initialData: CenterData = {
  dashboard: emptySource(),
  models: emptySource(),
  registry: emptySource(),
  live: emptySource(),
  ready: emptySource(),
  metrics: emptySource(),
  admin: emptySource(),
  operations: emptySource(),
  health: {},
};

async function readJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText || "request failed"}`);
  return response.json() as Promise<T>;
}

async function readSource<T>(path: string): Promise<Source<T>> {
  try {
    return { data: await readJson<T>(path), error: null };
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : "Unavailable" };
  }
}

function percent(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "Not recorded";
}

function decimal(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(3) : "Not recorded";
}

function integer(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString() : "Not recorded";
}

function bytes(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "Not recorded";
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(0)} MB`;
  return `${Math.round(value / 1024)} KB`;
}

function label(value: string | null | undefined): string {
  return (value ?? "Not recorded").replaceAll("_", " ");
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function sourceLabel<T>(source: Source<T>, ready = "Available"): string {
  return source.data ? ready : source.error ? "Unavailable" : "Loading";
}

function toneForBoolean(value: boolean | undefined): Status {
  return value === true ? "ok" : value === false ? "bad" : "neutral";
}

function StatusPill({ status, children }: { status: Status; children: React.ReactNode }) {
  return <span className={`${styles.pill} ${styles[`pill_${status}`]}`}>{children}</span>;
}

function SectionHeading({ eyebrow, title, detail }: { eyebrow: string; title: string; detail?: string }) {
  return (
    <div className={styles.sectionHeading}>
      <div>
        <div className={styles.eyebrow}>{eyebrow}</div>
        <h2>{title}</h2>
      </div>
      {detail && <p className={styles.sectionDetail}>{detail}</p>}
    </div>
  );
}

function EmptySource({ source, children }: { source: Source<unknown>; children: React.ReactNode }) {
  if (!source.error) return <>{children}</>;
  return <p className={styles.unavailable} role="status">{children} Source unavailable ({source.error}).</p>;
}

export default function ValidationCenterClient() {
  const [data, setData] = useState<CenterData>(initialData);
  const [loading, setLoading] = useState(true);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [dashboard, models, registry, live, ready, metrics, admin, operations] = await Promise.all([
      readSource<DashboardResponse>("/api/validation/dashboard"),
      readSource<ModelsResponse>("/api/models"),
      readSource<ValidationRegistryResponse>("/api/models/validation"),
      readSource<LiveResponse>("/api/health/live"),
      readSource<ReadyResponse>("/api/health/ready"),
      readSource<AdminMetricsResponse>("/api/admin/metrics"),
      readSource<AdminResponse>("/api/admin"),
      readSource<OperationsResponse>("/api/admin/operations"),
    ]);

    const modelsForHealth = models.data?.models ?? [];
    const healthEntries = await Promise.all(modelsForHealth.map(async (model) => [
      model.model_id,
      await readSource<HealthResponse>(`/api/models/${encodeURIComponent(model.model_id)}/health`),
    ] as const));

    setData({ dashboard, models, registry, live, ready, metrics, admin, operations, health: Object.fromEntries(healthEntries) });
    setRefreshedAt(new Date().toISOString());
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runs = data.dashboard.data?.runs ?? [];
  const models = data.models.data?.models ?? [];
  const registryEntries = data.registry.data?.entries ?? [];
  const registryByModel = useMemo(() => new Map(registryEntries.map((entry) => [entry.model_id, entry])), [registryEntries]);
  const modelById = useMemo(() => new Map(models.map((model) => [model.model_id, model])), [models]);
  const drRuns = runs.filter((run) => run.model_id === "fundus-dr-grading-effb0");
  const octRuns = runs.filter((run) => run.model_id === "oct-retinal-weights-fp32");
  const drEntry = registryByModel.get("fundus-dr-grading-effb0");
  const octEntry = registryByModel.get("oct-retinal-weights-fp32");
  const readyChecks = data.ready.data?.checks ?? {};
  const metrics = data.metrics.data?.persistence;
  const auditIntegrity = data.admin.data?.audit_chain_integrity;
  const operations = data.operations.data;

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <div>
          <div className={styles.eyebrow}>INTERNAL / RESEARCH REVIEW</div>
          <h1>Validation Center</h1>
          <p className={styles.lede}>A bounded operating view of model identity, failure evidence, runtime state, and provenance.</p>
        </div>
        <div className={styles.heroMeta}>
          <StatusPill status={loading ? "neutral" : "warn"}>Research only</StatusPill>
          <button className={styles.refreshButton} onClick={() => void load()} disabled={loading} type="button">
            {loading ? "Refreshing…" : "Refresh evidence"}
          </button>
          <span className={styles.timestamp}>Last read: {formatDate(refreshedAt)}</span>
        </div>
      </header>

      <div className={styles.boundary} role="note">
        <span className={styles.boundaryMark} aria-hidden="true">!</span>
        <div><strong>Interpretation boundary</strong><br />{data.dashboard.data?.notice ?? "Only explicitly returned research evidence is shown. No clinical validation, normality, diagnosis, or safety claim is inferred."}</div>
      </div>

      <section aria-labelledby="runtime-title">
        <SectionHeading eyebrow="01 / Runtime" title="Worker and resource state" detail="Process-local health signals; model health checks load, validate, and unload without running inference." />
        <div className={styles.statusGrid} id="runtime-title">
          <article className={styles.statusCard}>
            <div className={styles.cardTop}><span className={styles.cardLabel}>Service liveness</span><StatusPill status={data.live.data?.status === "alive" ? "ok" : "neutral"}>{sourceLabel(data.live, data.live.data?.status ?? "Unavailable")}</StatusPill></div>
            <strong className={styles.statusValue}>{data.live.data?.service ?? "Not recorded"}</strong>
            <span className={styles.cardNote}>Inference: {data.live.data?.inference ?? "not checked"}</span>
          </article>
          <article className={styles.statusCard}>
            <div className={styles.cardTop}><span className={styles.cardLabel}>Dependency readiness</span><StatusPill status={data.ready.data?.status === "ready" ? "ok" : data.ready.data?.status === "not_ready" ? "bad" : "neutral"}>{data.ready.data?.status ?? sourceLabel(data.ready)}</StatusPill></div>
            <strong className={styles.statusValue}>{data.ready.data?.status === "ready" ? "Ready" : data.ready.data?.status === "not_ready" ? "Attention" : "Not recorded"}</strong>
            <span className={styles.cardNote}>Inference: {data.ready.data?.inference ?? "not checked"}</span>
          </article>
          <article className={styles.statusCard}>
            <div className={styles.cardTop}><span className={styles.cardLabel}>Queued worker state</span><StatusPill status={toneForBoolean(metrics ? metrics.stale_leases === 0 && metrics.failed_jobs === 0 : undefined)}>{metrics ? metrics.failed_jobs === 0 && metrics.stale_leases === 0 ? "No recorded failures" : "Review required" : sourceLabel(data.metrics)}</StatusPill></div>
            <strong className={styles.statusValue}>{metrics ? `${integer(metrics.jobs_active)} active` : "Not recorded"}</strong>
            <span className={styles.cardNote}>{metrics ? `${integer(metrics.jobs_total)} total · ${integer(metrics.failed_jobs)} failed · ${integer(metrics.stale_leases)} stale lease(s)` : "Admin operational snapshot required"}</span>
          </article>
          <article className={styles.statusCard}>
            <div className={styles.cardTop}><span className={styles.cardLabel}>Model store</span><StatusPill status={toneForBoolean(data.models.data?.model_store_status?.populated)}>{data.models.data?.model_store_status ? data.models.data.model_store_status.populated ? "Artifacts present" : "Demo path" : sourceLabel(data.models)}</StatusPill></div>
            <strong className={styles.statusValue}>{data.models.data?.model_store_status ? data.models.data.model_store_status.populated ? "Populated" : "Empty" : "Not recorded"}</strong>
            <span className={styles.cardNote}>{data.models.data?.model_store_status?.note ?? "Registry state unavailable"}</span>
          </article>
        </div>
        <div className={styles.resourceGrid}>
          {Object.entries(readyChecks).filter(([name]) => name !== "model_registry").map(([name, check]) => (
            <div className={styles.resourceRow} key={name}>
              <span>{label(name)}</span>
              <StatusPill status={toneForBoolean(check.ok)}>{check.ok === true ? "OK" : check.ok === false ? "Blocked" : "Not recorded"}</StatusPill>
            </div>
          ))}
          {Object.keys(readyChecks).length === 0 && <p className={styles.unavailable}>Readiness resource details are unavailable.</p>}
        </div>
        <div className={styles.resourceGrid} aria-label="Worker operations snapshot">
          {operations ? <>
            <div className={styles.resourceRow}><span>Queue depth</span><strong>{integer(operations.queue?.counts?.queued)} queued · {integer(operations.queue?.counts?.running)} running</strong></div>
            <div className={styles.resourceRow}><span>Tracked subprocesses</span><strong>{integer(operations.queue?.active_processes)}</strong></div>
            <div className={styles.resourceRow}><span>Resource governor</span><StatusPill status={operations.resource_governor?.configured ? "ok" : "bad"}>{operations.resource_governor?.configured ? "Configured" : "Not configured"}</StatusPill></div>
            <div className={styles.resourceRow}><span>Reserved budget</span><strong>{bytes(operations.resource_governor?.reserved?.memoryBytes)} · {integer(operations.resource_governor?.reserved?.threads)} threads</strong></div>
            <div className={styles.resourceRow}><span>Overall deadline</span><strong>{operations.deadline?.enforced_from_claim ? `${Math.round((operations.deadline.default_ms ?? 0) / 60000)} min · enforced` : "Not recorded"}</strong></div>
            <div className={styles.resourceRow}><span>Worker mode</span><strong>{label(operations.worker?.mode)}</strong></div>
          </> : <p className={styles.unavailable}>Operations snapshot is role-restricted or unavailable; no runtime state is guessed.</p>}
        </div>
      </section>

      <section aria-labelledby="identity-title">
        <SectionHeading eyebrow="02 / Model identity" title="Declared capability and limitation" detail="Registry metadata is displayed as authored; a model cannot self-declare clinical validation." />
        <div className={styles.modelGrid} id="identity-title">
          {models.map((model) => {
            const entry = registryByModel.get(model.model_id);
            const health = data.health[model.model_id];
            return (
              <article className={styles.modelCard} key={model.model_id}>
                <div className={styles.cardTop}>
                  <div><span className={styles.modelStatus}>{model.status}</span><h3>{model.model_name}</h3></div>
                  <StatusPill status={model.integrity?.trusted === true ? "ok" : model.integrity?.trusted === false ? "bad" : "neutral"}>{model.integrity?.trusted === true ? "Hash trusted" : model.integrity?.trusted === false ? "Integrity failed" : "Integrity not recorded"}</StatusPill>
                </div>
                <dl className={styles.definitionList}>
                  <dt>Model ID / version</dt><dd><code>{model.model_id}</code> · <code>{model.version}</code></dd>
                  <dt>Modality / input</dt><dd>{model.modalities.join(" · ") || "Not recorded"} · {label(model.input_schema)}</dd>
                  <dt>Artifact</dt><dd><code>{model.sha256_masked ?? "No artifact hash"}</code> · {model.format ?? "format not recorded"}</dd>
                  <dt>Use gate</dt><dd>{model.gate?.label ?? "Not recorded"} · {model.gate?.findings_use ?? "No gate statement returned"}</dd>
                  <dt>Intended use</dt><dd>{model.intended_use}</dd>
                </dl>
                <div className={styles.limitations}>
                  <div className={styles.cardLabel}>Declared limitations</div>
                  <ul>{(entry?.limitations ?? model.limitations).map((item) => <li key={item}>{item}</li>)}</ul>
                </div>
                <div className={styles.healthLine}>
                  <span>Load / validate / unload</span>
                  <StatusPill status={health?.data?.healthy === true ? "ok" : health?.data?.healthy === false ? "bad" : "neutral"}>{health?.data ? health.data.healthy ? "Healthy at check" : "Unhealthy at check" : health?.error ? "Unavailable" : "Not checked"}</StatusPill>
                </div>
              </article>
            );
          })}
          {models.length === 0 && <EmptySource source={data.models}><span>Model identity is unavailable.</span></EmptySource>}
        </div>
      </section>

      <section aria-labelledby="failure-title">
        <SectionHeading eyebrow="03 / Failure evidence" title="DR false-negative / false-positive evidence" detail="Run-level counts stay separate from registry summaries. Empty or unavailable evidence is not treated as a zero." />
        <div className={styles.evidenceGrid} id="failure-title">
          <article className={styles.evidenceCard}>
            <div className={styles.cardTop}><div><span className={styles.cardLabel}>Fundus DR grader</span><h3>Missed and overcalled outcomes</h3></div><StatusPill status={drRuns.length ? "warn" : "neutral"}>{drRuns.length ? `${drRuns.length} run(s)` : "No persisted runs"}</StatusPill></div>
            <div className={styles.metricStrip}>
              <div><span>Sensitivity ≥2</span><strong>{drEntry ? "43.9%" : "Not recorded"}</strong></div>
              <div><span>Specificity ≥2</span><strong>{drEntry ? "99.1%" : "Not recorded"}</strong></div>
              <div><span>FN / FP counts</span><strong>{drRuns.length ? `${integer(drRuns.reduce((n, run) => n + run.errors.false_negatives, 0))} / ${integer(drRuns.reduce((n, run) => n + run.errors.false_positives, 0))}` : "Not recorded"}</strong></div>
            </div>
            <p className={styles.evidenceText}>{drEntry?.metrics_summary ?? "The validation registry is unavailable for the DR grader."}</p>
            <p className={styles.annotation}>The registry documents weak referable-DR sensitivity and a specificity estimate; it does not expose case-level examples or a universal FN/FP count. Counts below are shown only when returned by aggregate evaluation runs.</p>
            <RunTable runs={drRuns} empty="No aggregate DR evaluation run is currently available." />
          </article>

          <article className={styles.evidenceCard}>
            <div className={styles.cardTop}><div><span className={styles.cardLabel}>Aggregate safety totals</span><h3>All recorded validation runs</h3></div><StatusPill status={data.dashboard.data ? "warn" : "neutral"}>{data.dashboard.data ? "Aggregate only" : "Unavailable"}</StatusPill></div>
            <div className={styles.metricStrip}>
              <div><span>Cases</span><strong>{integer(data.dashboard.data?.totals?.cases)}</strong></div>
              <div><span>False negatives</span><strong>{integer(data.dashboard.data?.totals?.false_negatives)}</strong></div>
              <div><span>False positives</span><strong>{integer(data.dashboard.data?.totals?.false_positives)}</strong></div>
            </div>
            <dl className={styles.definitionList}>
              <dt>Urgent misses</dt><dd>{integer(data.dashboard.data?.totals?.missed_urgent_cases)}</dd>
              <dt>Quality blocked</dt><dd>{integer(data.dashboard.data?.totals?.quality_blocked)}</dd>
              <dt>OOD rejected</dt><dd>{integer(data.dashboard.data?.totals?.out_of_distribution)}</dd>
              <dt>Privacy</dt><dd>Case IDs, patient IDs, dataset references, subgroup labels, notes, and free text are withheld by the API projection.</dd>
            </dl>
          </article>
        </div>
      </section>

      <section aria-labelledby="oct-title">
        <SectionHeading eyebrow="04 / Modality split" title="OCT split evidence" detail="Comparability and independent cohorts remain visibly distinct; overlap and patient-separation statements are preserved." />
        <article className={styles.evidenceCard} id="oct-title">
          <div className={styles.cardTop}><div><span className={styles.cardLabel}>OCT retinal classifier</span><h3>Dataset and split ledger</h3></div><StatusPill status={octRuns.length ? "warn" : "neutral"}>{octRuns.length ? `${octRuns.length} recorded run(s)` : "Registry evidence"}</StatusPill></div>
          <p className={styles.evidenceText}>{octEntry?.metrics_summary ?? "The OCT validation registry is unavailable."}</p>
          <div className={styles.tableWrap} role="region" tabIndex={0} aria-label="OCT validation evidence table">
            <table className={styles.table}>
              <thead><tr><th>Dataset</th><th>Split / scale</th><th>Separation</th><th>Training relation</th><th>Trace</th></tr></thead>
              <tbody>
                {(octEntry?.datasets ?? []).map((dataset) => (
                  <tr key={`${dataset.name}-${dataset.split}`}>
                    <td><strong>{dataset.name}</strong><br /><span className={styles.muted}>{dataset.license}</span></td>
                    <td>{dataset.split}<br /><span className={styles.muted}>{integer(dataset.n_images)} images · {integer(dataset.n_patients)} patients</span></td>
                    <td><StatusPill status={dataset.patient_separation === "VERIFIED_DISJOINT" ? "ok" : dataset.patient_separation === "OVERLAP_DISCLOSED" ? "warn" : "bad"}>{label(dataset.patient_separation)}</StatusPill></td>
                    <td>{dataset.external_to_training ? "External to reported training" : "Not external / comparability"}<br /><span className={styles.muted}>{dataset.overlap_note}</span></td>
                    <td><code className={styles.traceCode}>{dataset.evidence_doc}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <RunTable runs={octRuns} empty="No aggregate OCT evaluation run is currently available." />
        </article>
      </section>

      <section aria-labelledby="trace-title">
        <SectionHeading eyebrow="05 / Traceability" title="Evidence chain and review state" detail="Opaque run IDs, artifact hashes, source documents, and audit integrity are shown without resource content." />
        <div className={styles.traceGrid} id="trace-title">
          <article className={styles.traceCard}>
            <div className={styles.cardTop}><div><span className={styles.cardLabel}>Validation registry</span><h3>Declared evidence references</h3></div><StatusPill status={data.registry.data ? "ok" : "neutral"}>{data.registry.data?.registry_version ?? sourceLabel(data.registry)}</StatusPill></div>
            <div className={styles.tableWrap} role="region" tabIndex={0} aria-label="Validation registry evidence table">
              <table className={styles.table}><thead><tr><th>Model</th><th>Artifact SHA-256</th><th>Last review</th><th>Source documents</th></tr></thead><tbody>
                {registryEntries.map((entry) => <tr key={entry.model_id}><td><strong>{modelById.get(entry.model_id)?.model_name ?? entry.model_id}</strong><br /><span className={styles.muted}>{entry.model_id} · {entry.model_version}</span></td><td><code className={styles.traceCode}>{entry.artifact_sha256}</code></td><td>{entry.last_review_date}</td><td><ul className={styles.compactList}>{entry.datasets.map((dataset) => <li key={dataset.evidence_doc}><code>{dataset.evidence_doc}</code></li>)}</ul></td></tr>)}
              </tbody></table>
            </div>
            {!data.registry.data && <p className={styles.unavailable}>The validation registry is role-restricted or unavailable; no references are substituted.</p>}
          </article>
          <article className={styles.traceCard}>
            <div className={styles.cardTop}><div><span className={styles.cardLabel}>Audit integrity</span><h3>Review activity signal</h3></div><StatusPill status={auditIntegrity?.valid === true ? "ok" : auditIntegrity?.valid === false ? "bad" : "neutral"}>{auditIntegrity ? auditIntegrity.valid ? "Chain valid" : "Chain break" : sourceLabel(data.admin)}</StatusPill></div>
            <dl className={styles.definitionList}>
              <dt>Events checked</dt><dd>{integer(auditIntegrity?.events_checked)}</dd>
              <dt>Scope</dt><dd>{data.metrics.data?.scope ?? "Process-local admin snapshot"}</dd>
              <dt>Recent activity</dt><dd>{data.admin.data?.audit_tail?.length ? `${data.admin.data.audit_tail.length} metadata event(s)` : "Not recorded"}</dd>
              <dt>Resource content</dt><dd>Not displayed. Resource identifiers, study identifiers, images, documents, and free text are omitted from this view.</dd>
            </dl>
            {data.admin.data?.audit_tail && data.admin.data.audit_tail.length > 0 && <div className={styles.activityList}>{data.admin.data.audit_tail.slice(0, 8).map((event, index) => <div className={styles.activityRow} key={`${event.ts}-${event.action}-${index}`}><span>{formatDate(event.ts)}</span><strong>{label(event.action)}</strong><span>{event.role ?? "role not recorded"} · {event.outcome}</span></div>)}</div>}
            {!data.admin.data && <p className={styles.unavailable}>Audit detail is admin-only or unavailable; no activity is guessed.</p>}
          </article>
        </div>
      </section>

      <footer className={styles.footerNote}>Research evidence is fallible, uncalibrated unless explicitly documented, and not a substitute for clinician review. A negative or unavailable result does not establish normality.</footer>
    </div>
  );
}

function RunTable({ runs, empty }: { runs: Run[]; empty: string }) {
  if (runs.length === 0) return <p className={styles.unavailable}>{empty}</p>;
  return (
    <div className={styles.tableWrap} role="region" tabIndex={0} aria-label="Recorded validation runs table">
      <table className={styles.table}>
        <thead><tr><th>Split</th><th>Cases</th><th>Sensitivity</th><th>Specificity</th><th>FN / FP</th><th>Run</th></tr></thead>
        <tbody>{runs.map((run) => <tr key={run.run_id}><td>{label(run.split)}<br /><span className={styles.muted}>{run.modality ?? "modality not recorded"}</span></td><td>{integer(run.cases)}</td><td>{percent(run.metrics.sensitivity)}</td><td>{percent(run.metrics.specificity)}</td><td><strong>{integer(run.errors.false_negatives)} / {integer(run.errors.false_positives)}</strong><br /><span className={styles.muted}>urgent FN {percent(run.errors.urgent_fn_rate)}</span></td><td><code>{run.run_id}</code><br /><span className={styles.muted}>{formatDate(run.created_at)}</span></td></tr>)}</tbody>
      </table>
    </div>
  );
}
