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

interface Phase6Response {
  schema_version?: string;
  phi_included?: boolean;
  notice?: string;
  classifications?: {
    software?: string;
    model?: string;
    performance?: string;
    data?: string;
    demo?: string;
    clinical?: string[];
  };
  candidate?: {
    model_id?: string;
    model_version?: string;
    lifecycle_status?: string;
    rights_state?: string;
    validation_state?: string;
    runtime_state?: string;
    artifact?: { format?: string; size_bytes?: number; sha256_masked?: string | null; integrity_state?: string };
    parity?: { state?: string; max_logit_difference?: number; declared_tolerance?: number; samples?: number };
    promotion?: string;
  };
  competition?: {
    state?: string;
    comparison_status?: string;
    baseline?: { cases?: number; patients?: number; referable?: { confusion?: { fn?: number; fp?: number; tp?: number; tn?: number } | null } | null; grade_3_sensitivity?: number; grade_4_sensitivity?: number };
    candidate?: { measurement_state?: string; metrics?: unknown };
    paired?: unknown;
    reasons?: string[];
  };
  lesion_safety_net?: {
    measurement_state?: string;
    scope?: { selected_cases?: number; frozen_validation_cases?: number; baseline_fn_cases_selected?: number; baseline_fn_cases_expected?: number; all_cases_processed_serially?: boolean } | null;
    aggregate?: { signal_cases?: number; no_signal_cases?: number; inference_completed?: number; inference_failed?: number; service_ms?: { p50?: number | null; p95?: number | null; max?: number | null } | null } | null;
    baseline_fn?: { input_cases?: number; signal_cases?: number; review_escalation_coverage?: number | null; class_signals?: Record<string, number> } | null;
    nonreferable?: { input_cases?: number; signal_cases?: number; extra_review_escalations_per_100?: number | null } | null;
  };
  runtime?: {
    load_points?: Record<string, string>;
    resident_worker?: string;
    crash_matrix?: string;
    model_benchmark?: { status?: string; models?: Array<{ model_id?: string; status?: string; cold?: { wall_time?: { p50_ms?: number | null; p95_ms?: number | null } | null; resources?: { peak_rss_bytes?: number | null } | null } | null; warm?: { wall_time?: { p50_ms?: number | null; p95_ms?: number | null } | null; resources?: { peak_rss_bytes?: number | null } | null } | null }> };
  };
}

interface Phase7Response {
  schema_version?: string;
  phi_included?: boolean;
  notice?: string;
  classifications?: { software?: string; dr?: string; lesion?: string; performance?: string; data?: string; clinical?: string[] };
  candidate_search?: { decision?: string; candidates?: Array<{ candidate_id?: string; task?: string; artifact_state?: string; rights_state?: string; decision?: string; blockers?: string[] }> };
  retguard_parity?: { status?: string; publisher_observation?: { max_logit_difference?: number; max_probability_difference?: number; declared_logit_tolerance?: number; verification_samples?: number; logit_parity?: string }; comparison?: { publisher_framework_logits_available?: boolean; absolute_differences_available?: boolean; reason?: string }; final_decision?: string };
  lesion_calibration?: { measurement_state?: string; selection?: { selected_rule_id?: string | null; selection_state?: string; calibration_selected_measurement?: { fn_review_escalation_coverage?: number | null; review_escalations_per_100_path_cases?: number | null } | null; held_out_evaluation_measurement?: { fn_review_escalation_coverage?: number | null; review_escalations_per_100_path_cases?: number | null } | null }; question_two_answer?: { answer?: string; label?: string; forbidden_label?: string } };
  runtime?: { resource_race?: { status?: string; admission?: { admitted_count?: number; model_launch_count?: number; no_double_launch?: boolean }; ownership_fencing?: { old_release_blocked?: boolean } }; real_load?: { status?: string; points?: Array<{ requested?: number; completed_jobs?: number; throughput_jobs_per_second?: number; queue_wait_ms?: { p50?: number | null; p95?: number | null; max?: number | null }; service_latency_ms?: { p50?: number | null; p95?: number | null; max?: number | null } }> }; resident?: { status?: string; resident_decision?: string; initial_load_ms?: number | null; warm_inference_ms?: { p50?: number | null; p95?: number | null } }; crash_matrix?: { status?: string } };
}

interface Phase8Response {
  notice?: string;
  classifications?: { retinal_intelligence?: string; runtime?: string; software?: string; data?: string; clinical?: string[] };
  high_grade_miss_registry?: { cohort?: { exact_high_grade_miss_cases?: number; grade_3_exact_miss_cases?: number; grade_4_exact_miss_cases?: number }; aggregate?: Record<string, { escalated_cases?: number; non_escalated_cases?: number; review_escalation_coverage?: number }>; combined?: { review_escalation_coverage?: number } };
  lesion_rule_freeze?: { rule_id?: string; rule?: { feature?: string; threshold?: number }; measured_evidence?: { held_out?: { fn_review_escalation_coverage?: number; review_escalations_per_100_path_cases?: number } } };
  external_validation?: { decision?: string; attempts?: Array<{ dataset?: string; decision?: string; inference_run?: boolean }> };
  fusion?: { engine?: string; diagnostic_ensemble?: boolean; score_averaging?: boolean; normality_claim_allowed?: boolean; urgent_symptoms_independent?: boolean };
  runtime?: { persistence?: { exactly_once?: string; graceful_shutdown?: string; restart_recovery?: string } };
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
  phase6: Source<Phase6Response>;
  phase7: Source<Phase7Response>;
  phase8: Source<Phase8Response>;
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
  phase6: emptySource(),
  phase7: emptySource(),
  phase8: emptySource(),
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
    const [dashboard, models, registry, live, ready, metrics, admin, operations, phase6, phase7, phase8] = await Promise.all([
      readSource<DashboardResponse>("/api/validation/dashboard"),
      readSource<ModelsResponse>("/api/models"),
      readSource<ValidationRegistryResponse>("/api/models/validation"),
      readSource<LiveResponse>("/api/health/live"),
      readSource<ReadyResponse>("/api/health/ready"),
      readSource<AdminMetricsResponse>("/api/admin/metrics"),
      readSource<AdminResponse>("/api/admin"),
      readSource<OperationsResponse>("/api/admin/operations"),
      readSource<Phase6Response>("/api/validation/phase6"),
      readSource<Phase7Response>("/api/validation/phase7"),
      readSource<Phase8Response>("/api/validation/phase8"),
    ]);

    const modelsForHealth = models.data?.models ?? [];
    const healthEntries = await Promise.all(modelsForHealth.map(async (model) => [
      model.model_id,
      await readSource<HealthResponse>(`/api/models/${encodeURIComponent(model.model_id)}/health`),
    ] as const));

    setData({ dashboard, models, registry, live, ready, metrics, admin, operations, phase6, phase7, phase8, health: Object.fromEntries(healthEntries) });
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

      <section aria-labelledby="phase6-title">
        <SectionHeading eyebrow="02 / Phase 6 evidence" title="Candidate, FN recovery, and runtime gates" detail="Candidate-only research evidence is shown separately from the live registry. Missing measurements remain missing; no result here promotes a model." />
        <div className={styles.boundary} role="note" id="phase6-title">
          <span className={styles.boundaryMark} aria-hidden="true">!</span>
          <div><strong>{data.phase6.data?.classifications?.model ?? "DR CANDIDATE EVALUATED — IMPROVEMENT NOT ESTABLISHED"}</strong><br />{data.phase6.data?.notice ?? "Phase 6 evidence is unavailable or role-restricted. No candidate claim is inferred."}</div>
        </div>
        <div className={styles.statusGrid}>
          <article className={styles.statusCard}>
            <div className={styles.cardTop}><span className={styles.cardLabel}>RetGuard lifecycle</span><StatusPill status="warn">Candidate only</StatusPill></div>
            <strong className={styles.statusValue}>{label(data.phase6.data?.candidate?.lifecycle_status)}</strong>
            <span className={styles.cardNote}>{data.phase6.data?.candidate?.model_id ?? "retguard-dr-v1.0.0"} · {data.phase6.data?.candidate?.model_version ?? "v1.0.0"}</span>
          </article>
          <article className={styles.statusCard}>
            <div className={styles.cardTop}><span className={styles.cardLabel}>Candidate gate</span><StatusPill status="bad">Blocked</StatusPill></div>
            <strong className={styles.statusValue}>{label(data.phase6.data?.candidate?.validation_state)}</strong>
            <span className={styles.cardNote}>Rights: {label(data.phase6.data?.candidate?.rights_state)} · runtime: {label(data.phase6.data?.candidate?.runtime_state)}</span>
          </article>
          <article className={styles.statusCard}>
            <div className={styles.cardTop}><span className={styles.cardLabel}>Frozen head-to-head</span><StatusPill status="bad">Not comparable</StatusPill></div>
            <strong className={styles.statusValue}>{label(data.phase6.data?.competition?.candidate?.measurement_state)}</strong>
            <span className={styles.cardNote}>Baseline FN {integer(data.phase6.data?.competition?.baseline?.referable?.confusion?.fn)} · FP {integer(data.phase6.data?.competition?.baseline?.referable?.confusion?.fp)}</span>
          </article>
          <article className={styles.statusCard}>
            <div className={styles.cardTop}><span className={styles.cardLabel}>Clinical boundary</span><StatusPill status="bad">No clinical claim</StatusPill></div>
            <strong className={styles.statusValue}>Not validated</strong>
            <span className={styles.cardNote}>{(data.phase6.data?.classifications?.clinical ?? ["NOT CLINICALLY VALIDATED", "NOT A MEDICAL DEVICE"]).join(" · ")}</span>
          </article>
        </div>
        <div className={styles.evidenceGrid}>
          <article className={styles.evidenceCard}>
            <div className={styles.cardTop}><div><span className={styles.cardLabel}>DR candidate</span><h3>Integrity and parity</h3></div><StatusPill status="bad">{label(data.phase6.data?.candidate?.parity?.state)}</StatusPill></div>
            <dl className={styles.definitionList}>
              <dt>Artifact</dt><dd>{data.phase6.data?.candidate?.artifact?.format ?? "ONNX"} · {bytes(data.phase6.data?.candidate?.artifact?.size_bytes)} · <code>{data.phase6.data?.candidate?.artifact?.sha256_masked ?? "Not recorded"}</code></dd>
              <dt>Acquisition</dt><dd>{label(data.phase6.data?.candidate?.artifact?.integrity_state)}</dd>
              <dt>ONNX parity</dt><dd>Max logit difference {decimal(data.phase6.data?.candidate?.parity?.max_logit_difference)} vs tolerance {decimal(data.phase6.data?.candidate?.parity?.declared_tolerance)} on {integer(data.phase6.data?.candidate?.parity?.samples)} samples.</dd>
              <dt>Promotion</dt><dd>{label(data.phase6.data?.candidate?.promotion)}</dd>
            </dl>
          </article>
          <article className={styles.evidenceCard}>
            <div className={styles.cardTop}><div><span className={styles.cardLabel}>Lesion safety-net</span><h3>Review escalation coverage</h3></div><StatusPill status={data.phase6.data?.lesion_safety_net?.measurement_state?.includes("MEASURED") ? "warn" : "neutral"}>{label(data.phase6.data?.lesion_safety_net?.measurement_state)}</StatusPill></div>
            <div className={styles.metricStrip}>
              <div><span>FN cases selected</span><strong>{integer(data.phase6.data?.lesion_safety_net?.scope?.baseline_fn_cases_selected)}</strong></div>
              <div><span>FN with signal</span><strong>{integer(data.phase6.data?.lesion_safety_net?.baseline_fn?.signal_cases)}</strong></div>
              <div><span>Coverage</span><strong>{percent(data.phase6.data?.lesion_safety_net?.baseline_fn?.review_escalation_coverage)}</strong></div>
            </div>
            <p className={styles.evidenceText}>This is REVIEW ESCALATION COVERAGE, not disease recovery. Extra review escalations on nonreferable cases: {data.phase6.data?.lesion_safety_net?.nonreferable?.extra_review_escalations_per_100 == null ? "Not recorded" : `${data.phase6.data.lesion_safety_net.nonreferable.extra_review_escalations_per_100.toFixed(1)} per 100`}.</p>
          </article>
        </div>
        <div className={styles.resourceGrid} aria-label="Phase 6 runtime evidence">
          <div className={styles.resourceRow}><span>One-worker model load</span><strong>{label(data.phase6.data?.runtime?.model_benchmark?.status)}</strong></div>
          <div className={styles.resourceRow}><span>Load points 1 / 5 / 10 / 25</span><strong>{data.phase6.data?.runtime?.load_points ? `${label(data.phase6.data.runtime.load_points["1"])} / ${label(data.phase6.data.runtime.load_points["5"])} / ${label(data.phase6.data.runtime.load_points["10"])} / ${label(data.phase6.data.runtime.load_points["25"])}` : "Not recorded"}</strong></div>
          <div className={styles.resourceRow}><span>Resident worker</span><strong>{label(data.phase6.data?.runtime?.resident_worker)}</strong></div>
          <div className={styles.resourceRow}><span>Crash matrix</span><strong>{label(data.phase6.data?.runtime?.crash_matrix)}</strong></div>
        </div>
      </section>

      <section aria-labelledby="phase7-title">
        <SectionHeading eyebrow="03 / Phase 7 evidence" title="Candidate search, lesion calibration, and real runtime checks" detail="Phase 7 is an internal research ledger. Candidate rights, held-out selection, worker evidence, and missing measurements remain visibly separate." />
        <div className={styles.boundary} role="note" id="phase7-title">
          <span className={styles.boundaryMark} aria-hidden="true">!</span>
          <div><strong>{data.phase7.data?.classifications?.dr ?? "DR CANDIDATE EVALUATED — IMPROVEMENT NOT ESTABLISHED"}</strong><br />{data.phase7.data?.notice ?? "Phase 7 evidence is unavailable or role-restricted; no model or clinical claim is inferred."}</div>
        </div>
        <div className={styles.statusGrid}>
          <article className={styles.statusCard}>
            <div className={styles.cardTop}><span className={styles.cardLabel}>Second candidate</span><StatusPill status="bad">Blocked</StatusPill></div>
            <strong className={styles.statusValue}>{label(data.phase7.data?.candidate_search?.decision)}</strong>
            <span className={styles.cardNote}>{integer(data.phase7.data?.candidate_search?.candidates?.length)} candidates screened; no unknown weights loaded.</span>
          </article>
          <article className={styles.statusCard}>
            <div className={styles.cardTop}><span className={styles.cardLabel}>RetGuard parity</span><StatusPill status="bad">Stop preserved</StatusPill></div>
            <strong className={styles.statusValue}>{label(data.phase7.data?.retguard_parity?.publisher_observation?.logit_parity)}</strong>
            <span className={styles.cardNote}>Max logit {decimal(data.phase7.data?.retguard_parity?.publisher_observation?.max_logit_difference)} vs {decimal(data.phase7.data?.retguard_parity?.publisher_observation?.declared_logit_tolerance)}.</span>
          </article>
          <article className={styles.statusCard}>
            <div className={styles.cardTop}><span className={styles.cardLabel}>Lesion rule</span><StatusPill status={data.phase7.data?.lesion_calibration?.selection?.selected_rule_id ? "warn" : "bad"}>{data.phase7.data?.lesion_calibration?.selection?.selected_rule_id ? "Held-out" : "No rule"}</StatusPill></div>
            <strong className={styles.statusValue}>{label(data.phase7.data?.lesion_calibration?.selection?.selected_rule_id)}</strong>
            <span className={styles.cardNote}>{label(data.phase7.data?.lesion_calibration?.selection?.selection_state)}</span>
          </article>
          <article className={styles.statusCard}>
            <div className={styles.cardTop}><span className={styles.cardLabel}>Clinical boundary</span><StatusPill status="bad">No claim</StatusPill></div>
            <strong className={styles.statusValue}>Not validated</strong>
            <span className={styles.cardNote}>Review escalation coverage is not disease recovery.</span>
          </article>
        </div>
        <div className={styles.evidenceGrid}>
          <article className={styles.evidenceCard}>
            <div className={styles.cardTop}><div><span className={styles.cardLabel}>Held-out lesion evaluation</span><h3>Calibration split and burden</h3></div><StatusPill status={data.phase7.data?.lesion_calibration?.selection?.held_out_evaluation_measurement ? "warn" : "neutral"}>{label(data.phase7.data?.lesion_calibration?.measurement_state)}</StatusPill></div>
            <dl className={styles.definitionList}>
              <dt>Selected rule</dt><dd>{label(data.phase7.data?.lesion_calibration?.selection?.selected_rule_id)}</dd>
              <dt>FN coverage</dt><dd>{percent(data.phase7.data?.lesion_calibration?.selection?.held_out_evaluation_measurement?.fn_review_escalation_coverage)}</dd>
              <dt>Review burden</dt><dd>{data.phase7.data?.lesion_calibration?.selection?.held_out_evaluation_measurement?.review_escalations_per_100_path_cases == null ? "Not recorded" : `${data.phase7.data.lesion_calibration.selection.held_out_evaluation_measurement.review_escalations_per_100_path_cases.toFixed(1)} per 100`}</dd>
              <dt>Language</dt><dd>REVIEW ESCALATION COVERAGE only; not disease recovery.</dd>
            </dl>
          </article>
          <article className={styles.evidenceCard}>
            <div className={styles.cardTop}><div><span className={styles.cardLabel}>Real worker evidence</span><h3>Admission and resident checks</h3></div><StatusPill status="warn">Research only</StatusPill></div>
            <dl className={styles.definitionList}>
              <dt>Cross-process race</dt><dd>{label(data.phase7.data?.runtime?.resource_race?.status)} · {integer(data.phase7.data?.runtime?.resource_race?.admission?.admitted_count)} admitted · {integer(data.phase7.data?.runtime?.resource_race?.admission?.model_launch_count)} model launch(es)</dd>
              <dt>Single-worker load</dt><dd>{label(data.phase7.data?.runtime?.real_load?.status)}</dd>
              <dt>Resident lesion</dt><dd>{label(data.phase7.data?.runtime?.resident?.resident_decision)}</dd>
              <dt>Crash matrix</dt><dd>{label(data.phase7.data?.runtime?.crash_matrix?.status)}</dd>
            </dl>
          </article>
        </div>
        <div className={styles.resourceGrid} aria-label="Phase 7 runtime evidence">
          {(data.phase7.data?.runtime?.real_load?.points ?? []).map((point) => <div className={styles.resourceRow} key={String(point.requested)}><span>{integer(point.requested)} queued jobs</span><strong>{integer(point.completed_jobs)} complete · queue p50 {decimal(point.queue_wait_ms?.p50)} ms · service p50 {decimal(point.service_latency_ms?.p50)} ms</strong></div>)}
          {!data.phase7.data?.runtime?.real_load?.points?.length && <p className={styles.unavailable}>Real load evidence is unavailable; no capacity is inferred.</p>}
        </div>
      </section>

      <section aria-labelledby="identity-title">
        <SectionHeading eyebrow="04 / Model identity" title="Declared capability and limitation" detail="Registry metadata is displayed as authored; a model cannot self-declare clinical validation." />
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
        <SectionHeading eyebrow="04 / Failure evidence" title="DR false-negative / false-positive evidence" detail="Run-level counts stay separate from registry summaries. Empty or unavailable evidence is not treated as a zero." />
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
        <SectionHeading eyebrow="05 / Modality split" title="OCT split evidence" detail="Comparability and independent cohorts remain visibly distinct; overlap and patient-separation statements are preserved." />
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
        <SectionHeading eyebrow="06 / Traceability" title="Evidence chain and review state" detail="Opaque run IDs, artifact hashes, source documents, and audit integrity are shown without resource content." />
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

      <section aria-labelledby="phase8-title">
        <SectionHeading eyebrow="07 / Phase 8 evidence" title="High-grade safety net and evidence fusion" detail="Aggregate research evidence only. Hashed case keys and explicit NOT_RECORDED states prevent false precision or patient disclosure." />
        <div className={styles.boundary} role="note" id="phase8-title">
          <span className={styles.boundaryMark} aria-hidden="true">!</span>
          <div><strong>{data.phase8.data?.classifications?.retinal_intelligence ?? "RETINAL REVIEW INTELLIGENCE PARTIAL — INTERNAL HELD-OUT EVIDENCE ONLY"}</strong><br />{data.phase8.data?.notice ?? "Phase 8 evidence is unavailable or role-restricted; no clinical or normality claim is inferred."}</div>
        </div>
        <div className={styles.statusGrid}>
          <article className={styles.statusCard}>
            <div className={styles.cardTop}><span className={styles.cardLabel}>High-grade registry</span><StatusPill status="warn">Research</StatusPill></div>
            <strong className={styles.statusValue}>{integer(data.phase8.data?.high_grade_miss_registry?.cohort?.exact_high_grade_miss_cases)} cases</strong>
            <span className={styles.cardNote}>Grade 3: {integer(data.phase8.data?.high_grade_miss_registry?.cohort?.grade_3_exact_miss_cases)} · grade 4: {integer(data.phase8.data?.high_grade_miss_registry?.cohort?.grade_4_exact_miss_cases)}</span>
          </article>
          <article className={styles.statusCard}>
            <div className={styles.cardTop}><span className={styles.cardLabel}>Frozen escalation rule</span><StatusPill status="warn">Held out</StatusPill></div>
            <strong className={styles.statusValue}>{label(data.phase8.data?.lesion_rule_freeze?.rule_id)}</strong>
            <span className={styles.cardNote}>{data.phase8.data?.lesion_rule_freeze?.rule ? `${data.phase8.data.lesion_rule_freeze.rule.feature} ≥ ${data.phase8.data.lesion_rule_freeze.rule.threshold}` : "Not recorded"} · review routing only</span>
          </article>
          <article className={styles.statusCard}>
            <div className={styles.cardTop}><span className={styles.cardLabel}>External validation</span><StatusPill status="bad">Blocked</StatusPill></div>
            <strong className={styles.statusValue}>Not established</strong>
            <span className={styles.cardNote}>{integer(data.phase8.data?.external_validation?.attempts?.length)} dataset attempt(s); no external inference run</span>
          </article>
          <article className={styles.statusCard}>
            <div className={styles.cardTop}><span className={styles.cardLabel}>Fusion safety</span><StatusPill status={data.phase8.data?.fusion?.normality_claim_allowed === false ? "ok" : "neutral"}>{data.phase8.data?.fusion?.engine ?? "Not recorded"}</StatusPill></div>
            <strong className={styles.statusValue}>{data.phase8.data?.fusion?.normality_claim_allowed === false ? "No false normal" : "Not recorded"}</strong>
            <span className={styles.cardNote}>Urgent symptoms independent · no score averaging</span>
          </article>
        </div>
        <div className={styles.evidenceGrid}>
          <article className={styles.evidenceCard}>
            <div className={styles.cardTop}><div><span className={styles.cardLabel}>Grade-specific review coverage</span><h3>Escalation, not disease recovery</h3></div><StatusPill status="warn">Internal holdout</StatusPill></div>
            <div className={styles.metricStrip}>
              <div><span>Grade 3 coverage</span><strong>{percent(data.phase8.data?.high_grade_miss_registry?.aggregate?.["3"]?.review_escalation_coverage)}</strong></div>
              <div><span>Grade 4 coverage</span><strong>{percent(data.phase8.data?.high_grade_miss_registry?.aggregate?.["4"]?.review_escalation_coverage)}</strong></div>
              <div><span>Held-out rule coverage</span><strong>{percent(data.phase8.data?.lesion_rule_freeze?.measured_evidence?.held_out?.fn_review_escalation_coverage)}</strong></div>
            </div>
            <p className={styles.evidenceText}>Every high-grade non-escalated case remains represented by a hashed case key in the scoped artifact. Source OCT, document, OOD, and clinician evidence are displayed as not recorded when absent.</p>
          </article>
          <article className={styles.evidenceCard}>
            <div className={styles.cardTop}><div><span className={styles.cardLabel}>Runtime closure</span><h3>Persistence boundary</h3></div><StatusPill status="bad">Partial</StatusPill></div>
            <dl className={styles.definitionList}>
              <dt>Exactly once</dt><dd>{label(data.phase8.data?.runtime?.persistence?.exactly_once)}</dd>
              <dt>Graceful shutdown</dt><dd>{label(data.phase8.data?.runtime?.persistence?.graceful_shutdown)}</dd>
              <dt>Restart recovery</dt><dd>{label(data.phase8.data?.runtime?.persistence?.restart_recovery)}</dd>
              <dt>Clinical state</dt><dd>NOT CLINICALLY VALIDATED · NOT A MEDICAL DEVICE · NOT FOR AUTONOMOUS DIAGNOSIS</dd>
            </dl>
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
