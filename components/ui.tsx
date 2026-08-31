import Link from "next/link";

export function Badge({ tone = "neutral", children }: { tone?: "ok" | "warn" | "bad" | "info" | "neutral" | "demo"; children: React.ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function ConfidenceIndicator({ finding }: { finding: { confidence: number; confidence_category: string; confidence_calibrated?: number | null; synthetic?: boolean } }) {
  const cat = finding.confidence_category;
  const tone = cat === "HIGH CONFIDENCE" ? "ok" : cat === "MODERATE CONFIDENCE" ? "info" : cat === "LOW CONFIDENCE" ? "warn" : "bad";
  // Calibration honesty: show a percentage meter only when calibrated confidence exists.
  const calibrated = finding.confidence_calibrated ?? null;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Badge tone={tone}>{cat}</Badge>
        <span className="tiny muted">
          {calibrated !== null
            ? `Calibrated model confidence: ${(calibrated * 100).toFixed(0)}%`
            : `Model output: ${finding.confidence} (uncalibrated)`}
        </span>
      </div>
      {calibrated !== null && (
        <div className="meter" aria-hidden="true"><div style={{ width: `${Math.round(calibrated * 100)}%` }} /></div>
      )}
      <p className="tiny muted" style={{ marginTop: 4 }}>
        Model confidence reflects the model&apos;s output. It is not a medical diagnosis and does not represent clinical certainty.
        {calibrated === null && " A calibrated percentage is not shown because no calibration evidence exists for this model."}
      </p>
    </div>
  );
}

export function QualityPanel({ quality }: { quality: { score: number; status: string; acceptable: boolean; artifacts: string[]; metrics?: Record<string, unknown> } }) {
  const m = (quality.metrics ?? {}) as Record<string, number | boolean>;
  const rows: Array<{ label: string; pass: boolean; detail: string }> = [
    { label: "Sharpness", pass: !quality.artifacts.includes("blur"), detail: `score ${m.sharpness_score ?? "n/a"}` },
    { label: "Lighting", pass: !quality.artifacts.includes("poor_illumination") && !quality.artifacts.includes("overexposure"), detail: `mean ${m.illumination_mean ?? "n/a"}` },
    { label: "Glare", pass: !quality.artifacts.includes("glare"), detail: `highlight clip ${(Number(m.highlight_clip_ratio ?? 0) * 100).toFixed(1)}%` },
    { label: "Resolution", pass: !quality.artifacts.includes("insufficient_resolution"), detail: `${m.width ?? "?"}×${m.height ?? "?"}` },
    { label: "Field of view", pass: !quality.artifacts.includes("incorrect_field_of_view"), detail: "frame check" },
  ];
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <Badge tone={quality.acceptable ? "ok" : quality.status === "borderline" ? "warn" : "bad"}>
          {quality.status === "pass" ? "Excellent" : quality.status === "borderline" ? "Borderline" : "Insufficient"}
        </Badge>
        <span className="tiny muted">Quality score {quality.score}</span>
      </div>
      {rows.map((r) => (
        <div className="quality-row" key={r.label}>
          <span>{r.label}</span>
          <span style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <span className="tiny muted">{r.detail}</span>
            <span className={`q-check ${r.pass ? "pass" : "fail"}`} aria-label={`${r.label}: ${r.pass ? "pass" : "fail"}`}>{r.pass ? "✓" : "✕"}</span>
          </span>
        </div>
      ))}
      {!quality.acceptable && (
        <div className="alert danger" style={{ marginTop: 12 }}>
          <span className="alert-icon" aria-hidden="true">⚠</span>
          <div className="alert-body">
            <strong>Image quality is insufficient for reliable automated analysis</strong>
            Detected artifacts: {quality.artifacts.join(", ") || "unspecified"}. Please acquire another scan or have the image reviewed by an eye-care professional.
          </div>
        </div>
      )}
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon: React.ReactNode; title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="empty-state">
      <div className="es-icon" aria-hidden="true">{icon}</div>
      <h3>{title}</h3>
      {children && <p className="muted small" style={{ maxWidth: 420, margin: "4px auto 16px" }}>{children}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ title, causes, onRetryHref }: { title: string; causes: string[]; onRetryHref: string }) {
  return (
    <div className="card" style={{ textAlign: "center", padding: 40 }}>
      <div className="es-icon" style={{ fontSize: "2rem" }} aria-hidden="true">⚠</div>
      <h2>{title}</h2>
      <p className="muted small">Possible causes:</p>
      <ul className="small muted" style={{ listStyle: "none", padding: 0, margin: "4px 0 20px" }}>
        {causes.map((c) => <li key={c}>• {c}</li>)}
      </ul>
      <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
        <a className="btn" href={onRetryHref}>Try Again</a>
        <Link className="btn secondary" href="/dashboard">Return to Dashboard</Link>
      </div>
    </div>
  );
}

export function StatusCard({ label, value, tone = "neutral", detail }: { label: string; value: string; tone?: "ok" | "warn" | "bad" | "neutral"; detail?: string }) {
  return (
    <div className="card stat-card">
      <span className="stat-label">{label}</span>
      <span className="stat-value" style={{ color: tone === "ok" ? "var(--ok)" : tone === "warn" ? "var(--warn)" : tone === "bad" ? "var(--danger)" : "var(--text)" }}>{value}</span>
      {detail && <span className="tiny muted">{detail}</span>}
    </div>
  );
}

export function TriageBadge({ priority }: { priority: string }) {
  const map: Record<string, { tone: "ok" | "warn" | "bad" | "info"; label: string }> = {
    routine_follow_up: { tone: "ok", label: "ROUTINE FOLLOW-UP" },
    prompt_professional_review: { tone: "warn", label: "PROMPT EYE-CARE REVIEW" },
    urgent_eye_care_review: { tone: "bad", label: "URGENT EYE-CARE REVIEW" },
    emergency_evaluation: { tone: "bad", label: "EMERGENCY EVALUATION" },
    specialist_review_required: { tone: "warn", label: "SPECIALIST REVIEW REQUIRED" },
  };
  const t = map[priority] ?? { tone: "info" as const, label: priority };
  return <Badge tone={t.tone}>{t.label}</Badge>;
}
