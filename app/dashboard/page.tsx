"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge, EmptyState } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";
import { DASHBOARD_STATUS_META } from "@/lib/reports/terminology";
import { SPECIALTY_REGISTRY } from "@/lib/clinical/specialistRegistry";
import { getCapabilitiesForSpecialty } from "@/lib/clinical/specialistCapabilities";

const SPECIALIST_LANES = SPECIALTY_REGISTRY.map((specialty) => {
  const capabilities = getCapabilitiesForSpecialty(specialty.specialty_id);
  const researchProbe = capabilities.find((capability) => capability.may_execute);
  return {
    ...specialty,
    state: researchProbe ? "RESEARCH PROBE" : "NO COMPATIBLE IMAGE MODEL",
    stateTone: researchProbe ? "warn" : "neutral",
    task: researchProbe?.label ?? "Evidence organization and clinician review",
  };
});

interface StudyRow {
  study_id: string; created_at: string; modality: string; eye: string; status: string;
  dashboard_status?: string;
  triage_priority?: string;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export default function DashboardPage() {
  const [studies, setStudies] = useState<StudyRow[] | null>(null);

  useEffect(() => {
    fetch("/api/studies?with_status=1").then((r) => r.json())
      .then((j) => setStudies(j.studies ?? []))
      .catch(() => setStudies([]));
  }, []);

  const recent = (studies ?? []).slice(0, 6);
  const urgentCount = (studies ?? []).filter((s) => s.dashboard_status === "URGENT_REVIEW").length;
  const correlationCount = (studies ?? []).filter((s) => s.dashboard_status === "CLINICAL_CORRELATION_REQUIRED").length;
  const reviewCount = (studies ?? []).filter((s) => s.dashboard_status === "REVIEW_REQUIRED").length;
  const modelFailedCount = (studies ?? []).filter((s) => s.dashboard_status === "MODEL_FAILED").length;
  const unsupportedCount = (studies ?? []).filter((s) => s.dashboard_status === "UNSUPPORTED_MODALITY").length;
  const qualityBlockedCount = (studies ?? []).filter((s) => s.dashboard_status === "IMAGE_NOT_SUITABLE").length;
  const oodCount = (studies ?? []).filter((s) => s.dashboard_status === "OUT_OF_DISTRIBUTION").length;

  const attentionItems: Array<{ href: string; label: string; count: number; detail: string; tone: "danger" | "warn" | "neutral"; icon: IconName }> = [
    { href: "/history?filter=urgent", label: "Urgent review", count: urgentCount, tone: "danger", icon: "warning", detail: "Symptom- or rule-driven urgent/emergency triage — review promptly" },
    { href: "/history?filter=correlation", label: "Clinical correlation required", count: correlationCount, tone: "warn", icon: "review", detail: "Research findings present — not a diagnosis, human correlation needed" },
    { href: "/history?filter=review", label: "Review required", count: reviewCount, tone: "neutral", icon: "review", detail: "Analyzed, not yet reviewed by a clinician/reviewer" },
    { href: "/history?filter=model-failed", label: "Model failure", count: modelFailedCount, tone: "danger", icon: "x", detail: "No finding inferred; review the image with a qualified professional" },
    { href: "/history?filter=unsupported", label: "Unsupported image type", count: unsupportedCount, tone: "neutral", icon: "devices", detail: "No compatible model executed for this input" },
    { href: "/history?filter=quality-blocked", label: "Quality blocked", count: qualityBlockedCount, tone: "neutral", icon: "status", detail: "Image quality gate prevented finding inference" },
    { href: "/history?filter=out-of-distribution", label: "Outside model conditions", count: oodCount, tone: "neutral", icon: "status", detail: "No automated finding produced outside documented domain" },
  ];

  return (
    <div className="dashboard-page">
      <section className="dashboard-hero" aria-labelledby="dashboard-title">
        <div>
          <div className="eyebrow">Ophthalmic imaging analysis workspace</div>
          <h1 id="dashboard-title">{greeting()}<span className="title-period">.</span></h1>
          <p className="dashboard-subtitle">A calm starting point for scan intake, research analysis, and clinician review.</p>
          <div className="dashboard-state-row">
            <span><span className="dot dot-amber" aria-hidden="true" /> Research environment</span>
            <span><span className="dot dot-off" aria-hidden="true" /> Research models require clinician review</span>
          </div>
        </div>
        <div className="dashboard-hero-actions">
          <Link className="btn" href="/analyze"><Icon name="plus" size={14} /> New Analysis</Link>
          <Link className="btn secondary" href="/history"><Icon name="history" size={14} /> History</Link>
        </div>
      </section>

      <section aria-labelledby="workspace-status-title">
        <div className="section-heading dashboard-section-heading">
          <div><div className="eyebrow">Workspace readout</div><h2 id="workspace-status-title">Current status</h2></div>
          <span className="section-rule" aria-hidden="true" />
        </div>
        <div className="grid grid-3 dashboard-status-grid">
          <div className="card stat-card dashboard-status-card status-accent-warn">
            <div className="status-card-top"><span className="stat-label">Model status</span><Icon name="devices" size={16} /></div>
            <span className="stat-value">RESEARCH</span>
            <span className="stat-detail">Fundus/OCT research routing; DEMO fallback only for unsupported modalities</span>
          </div>
          <div className="card stat-card dashboard-status-card status-accent-ok">
            <div className="status-card-top"><span className="stat-label">System status</span><Icon name="status" size={16} /></div>
            <span className="stat-value">Operational</span>
            <span className="stat-detail">Quality engine · safety engine · audit logging</span>
          </div>
          <div className="card stat-card dashboard-status-card status-accent-blue">
            <div className="status-card-top"><span className="stat-label">Studies</span><Icon name="reports" size={16} /></div>
            <span className="stat-value">{studies?.length ?? "—"}</span>
            <span className="stat-detail">Stored locally on D: with SHA-256 integrity</span>
          </div>
        </div>
      </section>

      {studies && studies.length > 0 && attentionItems.some((item) => item.count > 0) && (
        <section className="attention-section" aria-labelledby="attention-title">
          <div className="section-heading dashboard-section-heading">
            <div><div className="eyebrow eyebrow-warn">Triage-aware queue</div><h2 id="attention-title">Studies needing attention</h2></div>
            <span className="section-caption">{attentionItems.filter((item) => item.count > 0).length} active categories</span>
          </div>
          <div className="grid grid-3 attention-grid" role="status" aria-label="Studies needing attention">
            {attentionItems.filter((item) => item.count > 0).map((item) => (
              <Link key={item.label} href={item.href} className={`card hover attention-card ${item.tone}`}>
                <div className="attention-card-top"><span className="attention-icon"><Icon name={item.icon} size={16} /></span><span className="attention-arrow" aria-hidden="true">↗</span></div>
                <span className="stat-label">{item.label}</span>
                <span className="stat-value">{item.count}</span>
                <span className="stat-detail">{item.detail}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="dashboard-section" aria-labelledby="recent-title">
        <div className="section-heading dashboard-section-heading">
          <div><div className="eyebrow">Activity</div><h2 id="recent-title">Recent analyses</h2></div>
          <Link className="btn ghost sm" href="/history">View all history <span aria-hidden="true">→</span></Link>
        </div>
        {!studies && (
          <div className="dashboard-loading" role="status" aria-live="polite">
            <span className="pulse-dot" aria-hidden="true" /> Loading study list…
          </div>
        )}
        {studies && recent.length === 0 && (
          <EmptyState icon={<Icon name="eye" size={26} />} title="No analyses yet"
            action={<Link className="btn" href="/analyze"><Icon name="plus" size={14} /> New Analysis</Link>}>
            Start a new ophthalmic imaging analysis to begin. Fundus photographs, retinal photos, and external eye
            images are supported (JPEG, PNG, WEBP).
          </EmptyState>
        )}
        {studies && recent.length > 0 && (
          <div className="card dashboard-table-card">
            <div className="table-wrap" tabIndex={0}>
              <table className="table">
                <thead>
                  <tr><th scope="col">Study</th><th scope="col">Date</th><th scope="col">Modality</th><th scope="col">Eye</th><th scope="col">Status</th><th scope="col" style={{ textAlign: "right" }}>Actions</th></tr>
                </thead>
                <tbody>
                  {recent.map((s) => (
                    <tr key={s.study_id}>
                      <td><code className="tiny">{s.study_id.slice(0, 18)}…</code></td>
                      <td className="small">{new Date(s.created_at).toLocaleString()}</td>
                      <td>{s.modality}</td>
                      <td>{s.eye}</td>
                      <td>
                        <Badge tone={DASHBOARD_STATUS_META[s.dashboard_status ?? "UPLOADED"]?.tone ?? "neutral"}>
                          {DASHBOARD_STATUS_META[s.dashboard_status ?? "UPLOADED"]?.label ?? "Uploaded"}
                        </Badge>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <Link className="btn ghost sm" href={`/result?study=${s.study_id}`}>Open</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <section className="dashboard-section" aria-labelledby="quick-actions-title">
        <div className="section-heading dashboard-section-heading">
          <div><div className="eyebrow">Shortcuts</div><h2 id="quick-actions-title">Quick actions</h2></div>
        </div>
        <div className="grid grid-4 quick-actions-grid">
          {[
            ["analysis", "New Analysis", "/analyze", "Upload a scan for research analysis"],
            ["compare", "Compare Scans", "/compare", "Compare a scan with a previous study"],
            ["reports", "Reports", "/report", "Open research review reports"],
            ["devices", "Device Manager", "/devices", "Device compatibility & adapters"],
          ].map(([icon, label, href, desc]) => (
            <Link key={label} href={href} className="card hover quick-action-card">
              <div className="quick-icon"><Icon name={icon as IconName} size={18} /></div>
              <div className="quick-copy"><h3>{label}</h3><p className="tiny muted">{desc}</p></div>
              <span className="quick-arrow" aria-hidden="true">↗</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="dashboard-section" aria-labelledby="specialist-board-title">
        <div className="section-heading dashboard-section-heading">
          <div><div className="eyebrow">Specialist routing</div><h2 id="specialist-board-title">Nine-lane review board</h2></div>
          <span className="section-caption">Routing and evidence organization; never a diagnosis</span>
        </div>
        <div className="specialist-board">
          {SPECIALIST_LANES.map((lane) => (
            <article className="card specialist-lane" key={lane.specialty_id}>
              <div className="specialist-lane-top"><span className={`specialist-lane-status ${lane.stateTone}`}>{lane.state}</span><span className="tiny muted">{lane.relevant_modalities.join(" · ")}</span></div>
              <h3>{lane.label}</h3>
              <p className="tiny muted">{lane.task}</p>
              <p className="tiny specialist-lane-note">{lane.requires_population_specific_validation ? "Population-specific validation required before any model use." : "Clinician review required for every evidence package."}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
