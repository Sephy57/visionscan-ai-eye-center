"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge, EmptyState, Metric, SectionHeader, TRIAGE_META, shortId } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";
import SpecialistBoard, { SPECIALIST_LANE_COUNT, SPECIALIST_EXECUTABLE_LANE_COUNT } from "@/components/SpecialistBoard";
import { DASHBOARD_STATUS_META } from "@/lib/reports/terminology";
import { OPHTHALMIC_COVERAGE_REGISTRY } from "@/lib/models/ophthalmicCoverage";

interface StudyRow {
  study_id: string; created_at: string; modality: string; eye: string; status: string;
  patient_ref?: string | null;
  dashboard_status?: string;
  triage_priority?: string;
}

interface Readiness {
  status?: string;
  checks?: Record<string, { ok?: boolean; models?: number; consistency_problems?: number }>;
}

interface ModelSummary { models: Array<{ model_id: string; status: string; integrity: { trusted: boolean } }> }

const STUDY_PAGE = 100;
const AWAITING = new Set(["URGENT_REVIEW", "CLINICAL_CORRELATION_REQUIRED", "REVIEW_REQUIRED"]);
const ATTENTION = new Set(["MODEL_FAILED", "IMAGE_NOT_SUITABLE", "UNSUPPORTED_MODALITY", "OUT_OF_DISTRIBUTION"]);
const STATUS_RANK: Record<string, number> = { URGENT_REVIEW: 0, CLINICAL_CORRELATION_REQUIRED: 1, REVIEW_REQUIRED: 2 };

/* AI research coverage, grouped from the static coverage registry (same source as /models). */
const COVERAGE = (() => {
  const lesions = OPHTHALMIC_COVERAGE_REGISTRY.filter((e) => e.task === "LESION_SEGMENTATION");
  const rows: Array<{ name: string; modality: string; state: string; detail: string }> = [];
  if (lesions.length) rows.push({ name: "Fundus lesion detection", modality: "FUNDUS", state: lesions[0].state, detail: `${lesions.length} research targets · bounding-box localization · uncalibrated` });
  for (const e of OPHTHALMIC_COVERAGE_REGISTRY) {
    if (e.task === "LESION_SEGMENTATION" || e.task === "DISEASE_SCREENING") continue;
    rows.push({ name: titleCase(e.display_name), modality: e.modality, state: e.state, detail: `${e.localization.replaceAll("_", " ").toLowerCase()} · ${e.calibration.replaceAll("_", " ").toLowerCase()}` });
  }
  const screening = OPHTHALMIC_COVERAGE_REGISTRY.filter((e) => e.task === "DISEASE_SCREENING");
  if (screening.length) rows.push({ name: "Disease screening targets", modality: "FUNDUS", state: screening[0].state, detail: `${screening.length} targets without a validated model` });
  return rows;
})();

function titleCase(name: string): string {
  return name.split(" ").map((w, i) => /^(dr|oct|dicom|octa)$/i.test(w) ? w.toUpperCase() : i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w).join(" ");
}

function coverageTone(state: string): "warn" | "neutral" | "bad" {
  if (state === "RESEARCH_PIPELINE" || state === "RESEARCH_ANATOMY_ONLY") return "warn";
  if (state === "UNSUPPORTED_IMAGE_ANALYSIS") return "bad";
  return "neutral";
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function Reticle() {
  return (
    <svg className="hero-reticle" viewBox="0 0 200 200" fill="none" stroke="currentColor" aria-hidden="true">
      <circle cx="100" cy="100" r="96" strokeWidth="0.8" />
      <circle cx="100" cy="100" r="70" strokeWidth="0.8" strokeDasharray="2 6" />
      <circle cx="100" cy="100" r="42" strokeWidth="1" />
      <circle cx="100" cy="100" r="16" strokeWidth="1.2" />
      <path d="M100 0v40M100 160v40M0 100h40M160 100h40" strokeWidth="0.8" />
    </svg>
  );
}

export default function DashboardPage() {
  const [studies, setStudies] = useState<StudyRow[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [studyError, setStudyError] = useState(false);
  const [ready, setReady] = useState<Readiness | null | "error">(null);
  const [live, setLive] = useState<boolean | null>(null);
  const [models, setModels] = useState<ModelSummary | null | "denied">(null);
  const [today, setToday] = useState<string>("");
  const [hello, setHello] = useState<string>("Good morning");

  useEffect(() => {
    setHello(greeting());
    setToday(new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }));
    fetch(`/api/studies?with_status=1&limit=${STUDY_PAGE}`)
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((j) => { setStudies(j.studies ?? []); setHasMore(j.has_more === true); })
      .catch(() => { setStudies([]); setStudyError(true); });
    fetch("/api/health/ready").then((r) => r.json()).then(setReady).catch(() => setReady("error"));
    fetch("/api/health/live").then((r) => setLive(r.ok)).catch(() => setLive(false));
    fetch("/api/models").then((r) => (r.ok ? r.json() : "denied")).then(setModels).catch(() => setModels("denied"));
  }, []);

  const rows = studies ?? [];
  const count = (pred: (s: StudyRow) => boolean) => (studies ? rows.filter(pred).length : null);
  const awaiting = count((s) => AWAITING.has(s.dashboard_status ?? ""));
  const urgent = count((s) => s.dashboard_status === "URGENT_REVIEW");
  const reviewed = count((s) => s.dashboard_status === "REVIEWED");
  const attention = count((s) => ATTENTION.has(s.dashboard_status ?? ""));
  const todayCount = count((s) => new Date(s.created_at).toDateString() === new Date().toDateString());

  const queue = rows
    .filter((s) => AWAITING.has(s.dashboard_status ?? ""))
    .sort((a, b) =>
      (STATUS_RANK[a.dashboard_status ?? ""] ?? 9) - (STATUS_RANK[b.dashboard_status ?? ""] ?? 9) ||
      (TRIAGE_META[a.triage_priority ?? ""]?.rank ?? 9) - (TRIAGE_META[b.triage_priority ?? ""]?.rank ?? 9) ||
      b.created_at.localeCompare(a.created_at))
    .slice(0, 8);
  const recent = rows.slice(0, 6);
  const scopeNote = hasMore ? `Counts cover the ${STUDY_PAGE} most recent studies visible to you.` : "Counts cover all studies visible to your account.";

  const readiness = ready && ready !== "error" ? ready : null;
  const check = (key: string) => readiness?.checks?.[key]?.ok;
  const modelList = models && models !== "denied" ? models.models : null;
  const research = modelList?.filter((m) => m.status === "RESEARCH").length ?? null;
  const trusted = modelList?.filter((m) => m.status !== "DEMO" && m.integrity.trusted).length ?? null;

  const systemRows: Array<{ icon: IconName; label: string; detail: string; tone: "ok" | "warn" | "bad" | "neutral"; value: string }> = [
    { icon: "server", label: "Application service", detail: "Liveness probe (/api/health/live)", tone: live === null ? "neutral" : live ? "ok" : "bad", value: live === null ? "Checking…" : live ? "Responding" : "Unreachable" },
    { icon: "database", label: "Database", detail: "Readiness check — schema and connection", tone: check("database") === undefined ? "neutral" : check("database") ? "ok" : "bad", value: check("database") === undefined ? (ready === "error" ? "Unavailable" : "Checking…") : check("database") ? "Ready" : "Not ready" },
    { icon: "file", label: "Local storage", detail: "Upload and report roots present", tone: check("storage_uploads") === undefined ? "neutral" : check("storage_uploads") && check("storage_reports") ? "ok" : "bad", value: check("storage_uploads") === undefined ? "Checking…" : check("storage_uploads") && check("storage_reports") ? "Ready" : "Missing" },
    { icon: "model", label: "Model registry", detail: modelList ? `${research ?? 0} research model(s) · ${trusted ?? 0} integrity-verified · inference not probed` : models === "denied" ? "Model details are restricted for your role" : "Registry consistency check", tone: check("model_registry") === undefined ? "neutral" : check("model_registry") ? "warn" : "bad", value: check("model_registry") === undefined ? "Checking…" : check("model_registry") ? "Research only" : "Inconsistent" },
  ];

  return (
    <div>
      <section className="command-hero" aria-labelledby="dashboard-title">
        <Reticle />
        <div>
          <div className="eyebrow">VisionScan AI Eye Center · Multimodal ophthalmic intelligence</div>
          <h1 id="dashboard-title" suppressHydrationWarning>{hello}.</h1>
          <p>{today ? `${today} — ` : ""}scan intake, research analysis, and clinician review in one workspace.</p>
          <div className="hero-state">
            <span><span className="dot dot-amber" aria-hidden="true" /> Research environment</span>
            <span><span className={`dot ${readiness?.status === "ready" ? "dot-ok" : readiness ? "dot-bad" : "dot-off"}`} aria-hidden="true" /> {readiness ? (readiness.status === "ready" ? "Dependencies ready" : "Dependencies need attention") : ready === "error" ? "Readiness unavailable" : "Checking readiness…"}</span>
            <span><span className="dot dot-off" aria-hidden="true" /> Every AI output requires clinician review</span>
          </div>
        </div>
        <div className="page-actions">
          <Link className="btn lg" href="/analyze"><Icon name="plus" size={15} /> New Analysis</Link>
          <Link className="btn secondary lg" href="/clinician"><Icon name="review" size={15} /> Review queue</Link>
        </div>
      </section>

      <section aria-labelledby="workspace-title">
        <SectionHeader title="Today's workspace" id="workspace-title" caption={studies && !studyError ? scopeNote : undefined} />
        {studyError && (
          <div className="alert danger" role="alert"><span className="alert-icon" aria-hidden="true"><Icon name="warning" size={16} /></span>
            <div className="alert-body"><strong>Study list unavailable</strong>The study service did not respond or your role cannot list studies. Counts below are not shown rather than guessed.</div></div>
        )}
        <div className="metric-row">
          <Metric label="Studies" value={studyError ? null : count(() => true)} icon="layers" tone="info" href="/history" detail={studyError ? "Unavailable" : todayCount !== null ? `${todayCount} added today` : "Loading…"} />
          <Metric label="Awaiting review" value={studyError ? null : awaiting} icon="review" tone={awaiting ? "warn" : undefined} href="/history?filter=awaiting" detail={urgent ? `${urgent} flagged urgent` : "Analyzed, no clinician decision yet"} />
          <Metric label="Reviewed" value={studyError ? null : reviewed} icon="check" tone={reviewed ? "ok" : undefined} href="/history" detail="Clinician review recorded" />
          <Metric label="Needs attention" value={studyError ? null : attention} icon="warning" tone={attention ? "bad" : undefined} href="/history?filter=attention" detail="Model failed, quality blocked, unsupported, or out of distribution" />
        </div>
      </section>

      <div className="dash-grid">
        <section aria-labelledby="queue-title">
          <SectionHeader title="Review queue" id="queue-title" action={<Link className="btn ghost sm" href="/history">All studies <Icon name="arrowRight" size={13} /></Link>} />
          {!studies && <div className="loading-row" role="status" aria-live="polite"><span className="pulse-dot" aria-hidden="true" /> Loading review queue…</div>}
          {studyError && <p className="small muted">Review queue unavailable — the study list could not be loaded, so no queue is shown rather than an empty one.</p>}
          {studies && !studyError && queue.length === 0 && (
            <EmptyState icon={<Icon name="review" size={22} />} title={rows.length === 0 ? "No studies yet" : "Review queue is clear"}
              action={<Link className="btn" href="/analyze"><Icon name="plus" size={14} /> Start a new analysis</Link>}>
              {rows.length === 0
                ? "Upload a fundus or OCT image to create the first study. Results appear here once analysis completes and await clinician review."
                : "No analyzed study is currently waiting for a clinician decision. New analyses will appear here."}
            </EmptyState>
          )}
          {queue.length > 0 && (
            <div className="card flush">
              <div className="table-wrap" tabIndex={0} role="region" aria-label="Review queue table">
                <table className="table">
                  <caption className="sr-only">Studies awaiting clinician review, most urgent first</caption>
                  <thead><tr><th scope="col">Priority</th><th scope="col">Study</th><th scope="col">Modality</th><th scope="col">Created</th><th scope="col" className="actions">Action</th></tr></thead>
                  <tbody>
                    {queue.map((s) => {
                      const meta = DASHBOARD_STATUS_META[s.dashboard_status ?? "UPLOADED"];
                      return (
                        <tr key={s.study_id}>
                          <td>
                            <div style={{ display: "grid", gap: 4, justifyItems: "start" }}>
                              <Badge tone={meta?.tone ?? "neutral"}>{meta?.label ?? "Uploaded"}</Badge>
                              {s.triage_priority && s.triage_priority !== "routine_follow_up" && (
                                <span className="tiny muted">Triage: {TRIAGE_META[s.triage_priority]?.label.toLowerCase() ?? s.triage_priority.replaceAll("_", " ")}</span>
                              )}
                            </div>
                          </td>
                          <td>{s.patient_ref ? <strong>{s.patient_ref}</strong> : null}<div className="id-cell">{shortId(s.study_id, 18)}</div></td>
                          <td>{s.modality.replaceAll("_", " ")} <span className="tiny muted">· {s.eye}</span></td>
                          <td className="small muted num" style={{ whiteSpace: "nowrap" }}>{new Date(s.created_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</td>
                          <td className="actions">
                            <Link className="btn sm" href={`/clinician?study=${encodeURIComponent(s.study_id)}`}>Review</Link>{" "}
                            <Link className="btn ghost sm" href={`/result?study=${encodeURIComponent(s.study_id)}`}>Result</Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="section" style={{ marginTop: 28 }}>
            <SectionHeader title="Recent activity" id="recent-title" level={2} />
            {studies && !studyError && recent.length === 0 && <p className="small muted">No study activity recorded yet.</p>}
            {recent.length > 0 && (
              <div className="card">
                <div className="status-list">
                  {recent.map((s) => {
                    const meta = DASHBOARD_STATUS_META[s.dashboard_status ?? "UPLOADED"];
                    return (
                      <div className="status-item" key={s.study_id}>
                        <span className="si-icon" aria-hidden="true"><Icon name={s.modality.toLowerCase().includes("oct") ? "layers" : "eye"} size={15} /></span>
                        <span>
                          <Link href={`/result?study=${encodeURIComponent(s.study_id)}`}>{s.patient_ref ?? shortId(s.study_id, 18)}</Link>
                          <span className="si-detail">{s.modality.replaceAll("_", " ")} · {s.eye} · {new Date(s.created_at).toLocaleString()}</span>
                        </span>
                        <Badge tone={meta?.tone ?? "neutral"}>{meta?.label ?? "Uploaded"}</Badge>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </section>

        <aside className="card-stack" aria-label="System and model status">
          <section className="card" aria-labelledby="system-title">
            <div className="card-title"><h2 id="system-title" style={{ fontSize: "0.95rem" }}>System & model status</h2>
              <Badge tone={readiness?.status === "ready" ? "ok" : readiness ? "bad" : "neutral"}>{readiness ? (readiness.status === "ready" ? "Ready" : "Not ready") : ready === "error" ? "Unavailable" : "Checking"}</Badge></div>
            <div className="status-list">
              {systemRows.map((row) => (
                <div className="status-item" key={row.label}>
                  <span className="si-icon" aria-hidden="true"><Icon name={row.icon} size={15} /></span>
                  <span>{row.label}<span className="si-detail">{row.detail}</span></span>
                  <Badge tone={row.tone}>{row.value}</Badge>
                </div>
              ))}
            </div>
            <p className="card-foot" style={{ marginBottom: 0 }}>Readiness checks dependencies only; it never runs model inference. <Link href="/admin">System status</Link></p>
          </section>

          <section className="card" aria-labelledby="coverage-title">
            <div className="card-title"><h2 id="coverage-title" style={{ fontSize: "0.95rem" }}>AI research coverage</h2><Badge tone="warn">No clinical validation</Badge></div>
            {COVERAGE.map((row) => (
              <div className="coverage-row" key={row.name}>
                <span>{row.name} <span className="tiny">{row.modality} · {row.detail}</span></span>
                <Badge tone={coverageTone(row.state)}>{row.state.replaceAll("_", " ")}</Badge>
              </div>
            ))}
            <p className="card-foot" style={{ marginBottom: 0 }}>Missing or disabled coverage is never evidence of a normal eye. <Link href="/models">Model registry</Link></p>
          </section>
        </aside>
      </div>

      <section className="section" aria-labelledby="specialist-board-title">
        <SectionHeader eyebrow="Specialist routing" title="Specialist review board" id="specialist-board-title"
          caption={`${SPECIALIST_LANE_COUNT} documented lanes · ${SPECIALIST_EXECUTABLE_LANE_COUNT} with an executable research probe · routing only, never a diagnosis`} />
        <SpecialistBoard />
      </section>

      <section className="section" aria-labelledby="quick-actions-title">
        <SectionHeader title="Quick actions" id="quick-actions-title" />
        <div className="quick-grid">
          {([
            ["analysis", "New analysis", "/analyze", "Upload fundus, OCT, or a PDF record"],
            ["patients", "Patients", "/patients", "Registry, encounters, and linked studies"],
            ["compare", "Compare scans", "/compare", "Same-patient prior/current comparison"],
            ["reports", "Reports", "/report", "Research review reports"],
          ] as Array<[IconName, string, string, string]>).map(([icon, label, href, desc]) => (
            <Link key={label} href={href} className="card hover quick-action-card">
              <span className="quick-icon" aria-hidden="true"><Icon name={icon} size={17} /></span>
              <div><h3>{label}</h3><p>{desc}</p></div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
