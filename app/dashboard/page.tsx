"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge, StatusCard, EmptyState, TriageBadge } from "@/components/ui";

interface StudyRow {
  study_id: string; created_at: string; modality: string; eye: string; status: string;
}
interface ReportInfo {
  overall_result: string; triage_priority: string; findings_count: number;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export default function DashboardPage() {
  const [studies, setStudies] = useState<StudyRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/studies").then((r) => r.json())
      .then((j) => setStudies(j.studies ?? []))
      .catch(() => setError("Could not load studies."));
  }, []);

  const recent = (studies ?? []).slice(0, 5);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 14 }}>
        <div>
          <h1 style={{ marginBottom: 2 }}>{greeting()}</h1>
          <p className="muted" style={{ margin: 0 }}>Eye Analysis Workspace</p>
        </div>
        <Link className="btn" href="/analyze">＋ New Analysis</Link>
      </div>

      <h2>Recent studies</h2>
      {error && <div className="alert danger"><span className="alert-icon" aria-hidden="true">⚠</span><div className="alert-body">{error}</div></div>}
      {studies && recent.length === 0 && (
        <EmptyState icon="◉" title="No scans yet"
          action={<Link className="btn" href="/analyze">Start Analysis</Link>}>
          Upload your first ophthalmic image to begin analysis. Fundus photographs, retinal photos, and external
          eye images are supported (JPEG, PNG, WEBP).
        </EmptyState>
      )}
      {studies && recent.length > 0 && (
        <div style={{ display: "grid", gap: 10 }}>
          {recent.map((s) => (
            <Link key={s.study_id} href={`/result?study=${s.study_id}`} className="card hover" style={{ display: "flex", alignItems: "center", gap: 16, textDecoration: "none", color: "inherit", flexWrap: "wrap" }}>
              <span style={{ width: 44, height: 44, borderRadius: 11, background: "var(--accent-soft)", color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.1rem" }} aria-hidden="true">◉</span>
              <span style={{ flex: 1, minWidth: 200 }}>
                <span style={{ fontWeight: 650, display: "block" }}>{s.study_id.slice(0, 18)}…</span>
                <span className="small muted">{s.modality} • {s.eye} • {new Date(s.created_at).toLocaleString()}</span>
              </span>
              {s.status === "analyzed" ? <Badge tone="info">Analyzed</Badge>
                : s.status === "rejected" ? <Badge tone="bad">Quality rejected</Badge>
                : <Badge tone="neutral">Uploaded</Badge>}
            </Link>
          ))}
          <div>
            <Link className="btn ghost sm" href="/history">View all history →</Link>
          </div>
        </div>
      )}

      <h2>Quick actions</h2>
      <div className="grid grid-4">
        {[
          ["＋", "New Analysis", "/analyze", "Upload a scan for AI-assisted screening"],
          ["⇄", "Compare Scans", "/compare", "Compare a scan with a previous study"],
          ["▤", "Reports", "/report", "Open clinical screening reports"],
          ["◎", "Device Manager", "/devices", "Manage device integrations"],
        ].map(([icon, label, href, desc]) => (
          <Link key={label} href={href} className="card hover" style={{ textDecoration: "none", color: "inherit" }}>
            <div className="feature-icon" aria-hidden="true">{icon}</div>
            <h3 style={{ marginBottom: 2 }}>{label}</h3>
            <p className="tiny muted" style={{ margin: 0 }}>{desc}</p>
          </Link>
        ))}
      </div>

      <h2>System status</h2>
      <div className="grid grid-4">
        <StatusCard label="AI Model" value="NOT VALIDATED" tone="warn" detail="Demo/synthetic detector only — no validated medical model installed" />
        <StatusCard label="Image Engine" value="Operational" tone="ok" detail="Quality metrics & DICOM detection" />
        <StatusCard label="Safety Engine" value="Operational" tone="ok" detail="Triage rules, safety validator, audit trail" />
        <StatusCard label="Storage" value="Healthy" tone="ok" detail="Local data on D:" />
      </div>
      <p className="tiny muted" style={{ marginTop: 10 }}>
        &ldquo;Operational&rdquo; describes software components running correctly. It is completely separate from
        medical validation: the AI model above is <strong>not validated</strong> and must not be used clinically.
      </p>
    </div>
  );
}
