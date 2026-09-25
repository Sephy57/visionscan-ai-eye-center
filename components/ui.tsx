import Link from "next/link";
import { Icon, type IconName } from "./icons";

export type Tone = "ok" | "warn" | "bad" | "info" | "neutral" | "demo";

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: React.ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

/* ---------------------------------------------------------------------------
   Page scaffolding
   ------------------------------------------------------------------------- */

export function PageHeader({ eyebrow, eyebrowTone, title, titleId, lede, actions, children }: {
  eyebrow?: React.ReactNode; eyebrowTone?: "warn" | "muted"; title: React.ReactNode; titleId?: string;
  lede?: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-header-copy">
        {eyebrow && <div className={`eyebrow${eyebrowTone ? ` eyebrow-${eyebrowTone}` : ""}`}>{eyebrow}</div>}
        <h1 id={titleId}>{title}</h1>
        {lede && <p className="page-lede">{lede}</p>}
        {children}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function SectionHeader({ eyebrow, title, id, caption, action, level = 2 }: {
  eyebrow?: React.ReactNode; title: React.ReactNode; id?: string; caption?: React.ReactNode; action?: React.ReactNode; level?: 2 | 3;
}) {
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <div className="section-header">
      <div>
        {eyebrow && <div className="eyebrow eyebrow-muted">{eyebrow}</div>}
        <Heading id={id}>{title}</Heading>
      </div>
      {action ?? (caption ? <span className="section-caption">{caption}</span> : null)}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Evidence semantics — every state carries a text label and a glyph so
   colour is never the only cue. These labels are presentation only: they
   describe WHERE a statement came from, never upgrade its certainty.
   ------------------------------------------------------------------------- */

export type ProvenanceKind = "observed" | "inferred" | "model" | "clinician" | "unavailable" | "not-assessed";

export const PROVENANCE_META: Record<ProvenanceKind, { label: string; glyph: string; description: string }> = {
  observed: { label: "Observed", glyph: "●", description: "Reported or documented input (patient-reported symptom, uploaded document) — not verified by AI." },
  inferred: { label: "Inferred", glyph: "◇", description: "Derived by deterministic rules from other evidence. Never a diagnosis." },
  model: { label: "Model output", glyph: "◆", description: "Produced by a research model. Uncalibrated and not clinically validated." },
  clinician: { label: "Clinician confirmed", glyph: "✓", description: "Recorded by a signed-in clinician/reviewer. The only authoritative layer." },
  unavailable: { label: "Unavailable", glyph: "○", description: "The capability could not run or produced no usable output." },
  "not-assessed": { label: "Not assessed", glyph: "◌", description: "No input of this kind was provided for this study." },
};

export function Provenance({ kind, label }: { kind: ProvenanceKind; label?: string }) {
  const meta = PROVENANCE_META[kind];
  return (
    <span className={`prov ${kind}`} title={meta.description}>
      <span className="prov-glyph" aria-hidden="true">{meta.glyph}</span>
      {label ?? meta.label}
    </span>
  );
}

export function ProvenanceLegend({ kinds = ["observed", "inferred", "model", "clinician", "unavailable", "not-assessed"] }: { kinds?: ProvenanceKind[] }) {
  return (
    <div className="prov-legend" aria-label="Evidence provenance legend">
      {kinds.map((kind) => <Provenance key={kind} kind={kind} />)}
    </div>
  );
}

export type EvidenceStateKind = "corroborated" | "disagreement" | "single" | "insufficient" | "unavailable" | "ood" | "review" | "blocked";

const EVIDENCE_STATE_LABEL: Record<EvidenceStateKind, [string, string]> = {
  corroborated: ["Corroborated", "⇄"],
  disagreement: ["Disagreement", "≠"],
  single: ["Single source", "1"],
  insufficient: ["Insufficient evidence", "…"],
  unavailable: ["Model unavailable", "○"],
  ood: ["Out of distribution", "⊘"],
  review: ["Review required", "!"],
  blocked: ["Quality blocked", "⊘"],
};

export function EvidenceState({ state, label }: { state: EvidenceStateKind; label?: string }) {
  const [text, glyph] = EVIDENCE_STATE_LABEL[state];
  return <span className={`ev-state ${state}`}><span aria-hidden="true">{glyph}</span>{label ?? text}</span>;
}

/* ---------------------------------------------------------------------------
   Metrics — callers pass real values only; null renders an explicit "—".
   ------------------------------------------------------------------------- */

export function Metric({ label, value, detail, tone, icon, href }: {
  label: string; value: number | string | null; detail?: React.ReactNode; tone?: "ok" | "warn" | "bad" | "info"; icon?: IconName; href?: string;
}) {
  const body = (
    <>
      <div className="metric-top"><span className="stat-label">{label}</span>{icon && <Icon name={icon} size={16} />}</div>
      <span className={`metric-value${value === null ? " is-empty" : ""}`}>{value ?? "—"}</span>
      {detail && <span className="metric-detail">{detail}</span>}
    </>
  );
  const className = `metric${tone ? ` tone-${tone}` : ""}`;
  return href ? <Link href={href} className={className}>{body}</Link> : <div className={className}>{body}</div>;
}

/* ---------------------------------------------------------------------------
   States: empty / error / blocked. Each explains what happened, why, and
   what the user can do next.
   ------------------------------------------------------------------------- */

export function EmptyState({ icon, title, children, action }: { icon: React.ReactNode; title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="empty-state">
      <div className="es-icon" aria-hidden="true">{icon}</div>
      <h3>{title}</h3>
      {children && <div className="es-body">{children}</div>}
      {action}
    </div>
  );
}

export function StatePanel({ tone = "neutral", icon = "info", title, what, why, next, actions, role, headingLevel = 2 }: {
  tone?: "neutral" | "warn" | "danger"; icon?: IconName; title: string;
  what?: React.ReactNode; why?: React.ReactNode; next?: React.ReactNode; actions?: React.ReactNode;
  role?: "alert" | "status"; headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <div className={`state-panel tone-${tone}`} role={role}>
      <span className="es-icon" aria-hidden="true"><Icon name={icon} size={20} /></span>
      <div>
        <Heading>{title}</Heading>
        {(what || why || next) && (
          <dl>
            {what && <><dt>What happened</dt><dd>{what}</dd></>}
            {why && <><dt>Why</dt><dd>{why}</dd></>}
            {next && <><dt>Next step</dt><dd>{next}</dd></>}
          </dl>
        )}
        {actions && <div className="state-actions">{actions}</div>}
      </div>
    </div>
  );
}

export function ErrorState({ title, causes, onRetryHref }: { title: string; causes: string[]; onRetryHref: string }) {
  return (
    <StatePanel
      tone="danger" icon="warning" title={title} role="alert"
      what="The requested data could not be loaded."
      why={<ul style={{ margin: 0, paddingLeft: 18 }}>{causes.map((c) => <li key={c}>{c}</li>)}</ul>}
      next="Retry, or return to the dashboard. No partial or synthetic data is shown."
      actions={<><a className="btn" href={onRetryHref}><Icon name="reset" size={14} /> Try again</a><Link className="btn secondary" href="/dashboard">Return to Dashboard</Link></>}
    />
  );
}

export function SafetyBoundary({ title = "Research safety boundary", children }: { title?: string; children: React.ReactNode }) {
  return (
    <aside className="safety-boundary" aria-label={title}>
      <Icon name="shield" size={20} />
      <div><strong>{title}</strong>{children}</div>
    </aside>
  );
}

export function PageLoading({ label }: { label: string }) {
  return <div className="page-loading" role="status" aria-live="polite"><span className="spinner" aria-hidden="true" />{label}</div>;
}

/* ---------------------------------------------------------------------------
   Clinical presentation helpers (behaviour unchanged from v1)
   ------------------------------------------------------------------------- */

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
  // A check is only shown as passed when its metric was actually recorded;
  // a missing metric is "not measured", never an implicit pass.
  const has = (k: string) => m[k] !== undefined && m[k] !== null;
  const rows: Array<{ label: string; pass: boolean; measured: boolean; detail: string }> = [
    { label: "Sharpness", pass: !quality.artifacts.includes("blur"), measured: has("sharpness_score") || quality.artifacts.includes("blur"), detail: has("sharpness_score") ? `score ${m.sharpness_score}` : "not measured" },
    { label: "Lighting", pass: !quality.artifacts.includes("poor_illumination") && !quality.artifacts.includes("overexposure"), measured: has("illumination_mean") || quality.artifacts.includes("poor_illumination") || quality.artifacts.includes("overexposure"), detail: has("illumination_mean") ? `mean ${m.illumination_mean}` : "not measured" },
    { label: "Glare", pass: !quality.artifacts.includes("glare"), measured: has("highlight_clip_ratio") || quality.artifacts.includes("glare"), detail: has("highlight_clip_ratio") ? `highlight clip ${(Number(m.highlight_clip_ratio) * 100).toFixed(1)}%` : "not measured" },
    { label: "Resolution", pass: !quality.artifacts.includes("insufficient_resolution"), measured: (has("width") && has("height")) || quality.artifacts.includes("insufficient_resolution"), detail: has("width") && has("height") ? `${m.width}×${m.height}` : "not measured" },
    { label: "Field of view", pass: !quality.artifacts.includes("incorrect_field_of_view"), measured: true, detail: "frame check" },
  ];
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <Badge tone={quality.acceptable ? "ok" : quality.status === "borderline" ? "warn" : "bad"}>
          {quality.status === "pass" ? "Quality gate passed" : quality.status === "borderline" ? "Borderline" : "Insufficient"}
        </Badge>
        <span className="tiny muted">Quality score {quality.score}</span>
      </div>
      {rows.map((r) => (
        <div className="quality-row" key={r.label}>
          <span>{r.label}</span>
          <span style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <span className="tiny muted">{r.detail}</span>
            {r.measured
              ? <span className={`q-check ${r.pass ? "pass" : "fail"}`} aria-label={`${r.label}: ${r.pass ? "pass" : "fail"}`}>{r.pass ? "✓" : "✕"}</span>
              : <span className="q-check" aria-label={`${r.label}: not measured`}>—</span>}
          </span>
        </div>
      ))}
      {!quality.acceptable && (
        <div className="alert danger" role="alert" style={{ marginTop: 12 }}>
          <span className="alert-icon" aria-hidden="true"><Icon name="warning" size={16} /></span>
          <div className="alert-body">
            <strong>Image quality is insufficient for reliable automated analysis</strong>
            Detected artifacts: {quality.artifacts.join(", ") || "unspecified"}. Please acquire another scan or have the image reviewed by an eye-care professional.
          </div>
        </div>
      )}
    </div>
  );
}

export function StatusCard({ label, value, tone = "neutral", detail }: { label: string; value: string; tone?: "ok" | "warn" | "bad" | "neutral"; detail?: string }) {
  return (
    <div className="card stat-card">
      <span className="stat-label">{label}</span>
      <span className="stat-value" style={{ color: tone === "ok" ? "var(--success)" : tone === "warn" ? "var(--warning)" : tone === "bad" ? "var(--danger)" : "var(--text-primary)" }}>{value}</span>
      {detail && <span className="stat-detail">{detail}</span>}
    </div>
  );
}

export const TRIAGE_META: Record<string, { tone: "ok" | "warn" | "bad" | "info"; label: string; rank: number }> = {
  emergency_evaluation: { tone: "bad", label: "EMERGENCY EVALUATION", rank: 0 },
  urgent_eye_care_review: { tone: "bad", label: "URGENT EYE-CARE REVIEW", rank: 1 },
  specialist_review_required: { tone: "warn", label: "SPECIALIST REVIEW REQUIRED", rank: 2 },
  prompt_professional_review: { tone: "warn", label: "PROMPT EYE-CARE REVIEW", rank: 3 },
  routine_follow_up: { tone: "ok", label: "ROUTINE FOLLOW-UP", rank: 4 },
};

export function TriageBadge({ priority }: { priority: string }) {
  const t = TRIAGE_META[priority] ?? { tone: "info" as const, label: priority };
  return <Badge tone={t.tone}>{t.label}</Badge>;
}

/** Friendly eye / modality labels used across result, review and report surfaces. */
export function eyeLabel(l?: string | null): string {
  return l === "OD" || l === "right" ? "Right eye (OD)" : l === "OS" || l === "left" ? "Left eye (OS)" : l === "both" || l === "OU" ? "Both eyes (OU)" : "Eye not specified";
}
export function modalityLabel(m?: string | null): string {
  return m ? m.replaceAll("_", " ").toUpperCase() : "UNKNOWN MODALITY";
}
export function shortId(id?: string | null, n = 14): string {
  if (!id) return "—";
  return id.length > n ? `${id.slice(0, n)}…` : id;
}
