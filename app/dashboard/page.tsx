"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge, EmptyState } from "@/components/ui";
import { Icon } from "@/components/icons";
import { DASHBOARD_STATUS_META } from "@/lib/reports/terminology";

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

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="stat-label">Ophthalmic imaging analysis workspace</div>
          <h1 style={{ marginBottom: 2 }}>{greeting()}</h1>
          <p className="small muted" style={{ margin: 0, display: "flex", gap: 14, flexWrap: "wrap" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span className="dot dot-amber" aria-hidden="true" />Research environment</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span className="dot dot-off" aria-hidden="true" />Research models require clinician review</span>
          </p>
        </div>
        <Link className="btn" href="/analyze"><Icon name="plus" size={14} /> New Analysis</Link>
      </div>

      <div className="grid grid-3" style={{ marginTop: 20 }}>
        <div className="card stat-card">
          <span className="stat-label">Model status</span>
          <span className="stat-value" style={{ color: "var(--warn)" }}>RESEARCH</span>
          <span className="stat-detail">Fundus/OCT research routing; DEMO fallback only for unsupported modalities</span>
        </div>
        <div className="card stat-card">
          <span className="stat-label">System status</span>
          <span className="stat-value" style={{ color: "var(--ok)" }}>Operational</span>
          <span className="stat-detail">Quality engine · safety engine · audit logging</span>
        </div>
        <div className="card stat-card">
          <span className="stat-label">Studies</span>
          <span className="stat-value">{studies?.length ?? "—"}</span>
          <span className="stat-detail">Stored locally on D: with SHA-256 integrity</span>
        </div>
      </div>

      {studies && studies.length > 0 && (urgentCount > 0 || correlationCount > 0 || reviewCount > 0) && (
        <div className="grid grid-3" style={{ marginTop: 14 }} role="status" aria-label="Studies needing attention">
          {urgentCount > 0 && (
            <Link href="/history?filter=urgent" className="card hover" style={{ textDecoration: "none", color: "inherit", borderColor: "var(--danger, #b3261e)" }}>
              <span className="stat-label">Urgent review</span>
              <span className="stat-value" style={{ color: "var(--danger, #b3261e)" }}>{urgentCount}</span>
              <span className="stat-detail">Symptom- or rule-driven urgent/emergency triage — review promptly</span>
            </Link>
          )}
          {correlationCount > 0 && (
            <Link href="/history?filter=correlation" className="card hover" style={{ textDecoration: "none", color: "inherit" }}>
              <span className="stat-label">Clinical correlation required</span>
              <span className="stat-value" style={{ color: "var(--warn)" }}>{correlationCount}</span>
              <span className="stat-detail">Research findings present — not a diagnosis, human correlation needed</span>
            </Link>
          )}
          {reviewCount > 0 && (
            <Link href="/history?filter=review" className="card hover" style={{ textDecoration: "none", color: "inherit" }}>
              <span className="stat-label">Review required</span>
              <span className="stat-value">{reviewCount}</span>
              <span className="stat-detail">Analyzed, not yet reviewed by a clinician/reviewer</span>
            </Link>
          )}
        </div>
      )}

      <h2>Recent analyses</h2>
      {studies && recent.length === 0 && (
        <EmptyState icon={<Icon name="eye" size={26} />} title="No analyses yet"
          action={<Link className="btn" href="/analyze">+ New Analysis</Link>}>
          Start a new ophthalmic imaging analysis to begin. Fundus photographs, retinal photos, and external eye
          images are supported (JPEG, PNG, WEBP).
        </EmptyState>
      )}
      {studies && recent.length > 0 && (
        <div className="card" style={{ padding: "4px 14px" }}>
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
          <div style={{ padding: "8px 0 10px" }}>
            <Link className="btn ghost sm" href="/history">View all history →</Link>
          </div>
        </div>
      )}

      <h2>Quick actions</h2>
      <div className="grid grid-4">
        {[
          ["analysis", "New Analysis", "/analyze", "Upload a scan for AI-assisted screening"],
          ["compare", "Compare Scans", "/compare", "Compare a scan with a previous study"],
          ["reports", "Reports", "/report", "Open clinical screening reports"],
          ["devices", "Device Manager", "/devices", "Device compatibility & adapters"],
        ].map(([icon, label, href, desc]) => (
          <Link key={label} href={href} className="card hover" style={{ textDecoration: "none", color: "inherit" }}>
            <div style={{ color: "var(--accent)", marginBottom: 8 }}><Icon name={icon as never} size={18} /></div>
            <h3 style={{ marginBottom: 2 }}>{label}</h3>
            <p className="tiny muted" style={{ margin: 0 }}>{desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
