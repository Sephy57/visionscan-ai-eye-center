import Link from "next/link";
import { Icon, IconName } from "@/components/icons";
import { Badge } from "@/components/ui";
import { listModels } from "@/lib/models/registry";

const LOCAL_RESEARCH_MODELS = listModels().filter((model) => model.status !== "DEMO");

const FEATURES: Array<[IconName, string, string]> = [
  ["status", "Quality gate first", "Real deterministic image metrics run before any interpretation. Poor-quality scans are rejected — no clinical finding is ever generated from an inadequate image."],
  ["reports", "Structured & auditable", "Every analysis produces schema-validated JSON: findings, locations, confidence, uncertainty, model versions, checksums, ruleset. Originals preserved with SHA-256."],
  ["warning", "Conservative triage", "Deterministic safety rules escalate red flags and red-flag symptoms regardless of AI confidence. Uncertainty itself triggers professional review. AI can never lower a triage level."],
  ["devices", "Model registry", "Strict registry with statuses, checksums, and evidence references. Models cannot self-declare validation. Only registered, verified models may run."],
  ["review", "Human in the loop", "Dedicated clinician workspace: confirm, reject, correct, mark indeterminate, or request a new scan. AI output, clinician interpretation, and final report are stored separately."],
  ["settings", "Explicit capabilities", "Every capability is documented as IMPLEMENTED, DEMO, RESEARCH, NOT IMPLEMENTED, or NOT VALIDATED. Nothing pretends to be a medical device."],
];

const PIPELINE: Array<[string, string, string]> = [
  ["1", "Upload & identify", "Device-adapter ingestion; DICOM detected and safely refused until a parser exists; metadata preserved, never invented."],
  ["2", "Quality & OOD gates", "Sharpness, illumination, glare, resolution, field of view — plus out-of-distribution checks for unsupported devices and atypical inputs."],
  ["3", "Registered model analysis", "Modality-matched models only, gated by registry status and integrity verification. Image-only models say so explicitly."],
  ["4", "Symptom correlation", "Structured patient symptoms correlated post-hoc — context only. Symptoms never create findings and never produce diagnoses."],
  ["5", "Ensemble & uncertainty", "Cross-model agreement when available; confidence capped without it. Indeterminate results stay indeterminate."],
  ["6", "Triage & clinical review", "Deterministic conservative triage; schema-validated report; specialist confirmation with a complete audit trail."],
];

export default function LandingPage() {
  return (
    <div className="landing-page">
      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-copy">
          <div className="eyebrow eyebrow-warn"><span aria-hidden="true">⚠</span> Research environment</div>
          <h1 id="landing-title">Ophthalmic imaging, with a clearer path to review.</h1>
          <p className="landing-lede">
            Analyze ophthalmic imaging, identify potentially significant findings, and organize clinical review in
            one workspace. Built validation-first: every result is structured, auditable, and reviewed by professionals.
          </p>
          <div className="landing-actions">
            <Link className="btn landing-primary" href="/analyze"><Icon name="analysis" size={15} /> Start Analysis</Link>
            <Link className="btn secondary" href="/dashboard"><Icon name="dashboard" size={15} /> View Demo</Link>
          </div>
          <div className="landing-signals" aria-label="Workspace principles">
            <span><Icon name="status" size={14} /> Quality gates first</span>
            <span><Icon name="reports" size={14} /> Auditable output</span>
            <span><Icon name="review" size={14} /> Human review required</span>
          </div>
        </div>

        <div className="landing-visual" aria-label="Illustrative product surface">
          <div className="visual-chrome">
            <span className="visual-kicker"><span className="visual-live-dot" aria-hidden="true" /> Workspace preview</span>
            <Badge tone="demo">Synthetic visual</Badge>
          </div>
          <div className="visual-canvas">
            {/* Abstract interface illustration — not a medical image and not a model output. */}
            <svg viewBox="0 0 560 360" role="img" aria-label="Abstract eye-shaped review surface illustration">
              <defs>
                <radialGradient id="landing-orbit" cx="50%" cy="50%" r="70%">
                  <stop offset="0%" stopColor="#1b5680" />
                  <stop offset="52%" stopColor="#102e4c" />
                  <stop offset="100%" stopColor="#091522" />
                </radialGradient>
                <linearGradient id="landing-sweep" x1="0" x2="1">
                  <stop offset="0%" stopColor="#75d4dc" stopOpacity="0" />
                  <stop offset="50%" stopColor="#75d4dc" stopOpacity="0.9" />
                  <stop offset="100%" stopColor="#75d4dc" stopOpacity="0" />
                </linearGradient>
              </defs>
              <rect width="560" height="360" fill="#07111e" />
              <path d="M0 288H560M0 72H560M96 0V360M464 0V360" stroke="#17405e" strokeWidth="1" opacity="0.44" />
              <ellipse cx="280" cy="182" rx="174" ry="102" fill="url(#landing-orbit)" stroke="#4fadc5" strokeOpacity="0.35" />
              <ellipse cx="280" cy="182" rx="126" ry="72" fill="none" stroke="#75d4dc" strokeOpacity="0.32" strokeDasharray="3 8" />
              <ellipse cx="280" cy="182" rx="78" ry="44" fill="none" stroke="#75d4dc" strokeOpacity="0.28" />
              <path d="M146 182C205 117 354 117 414 182C354 247 205 247 146 182Z" fill="none" stroke="#c8f4f4" strokeOpacity="0.62" strokeWidth="2" />
              <circle cx="280" cy="182" r="31" fill="#0d1c2c" stroke="#91e0e0" strokeWidth="2" />
              <circle cx="280" cy="182" r="12" fill="#c9f5ef" opacity="0.88" />
              <path d="M96 292H464" stroke="url(#landing-sweep)" strokeWidth="2" />
              <path d="M178 142L216 156M344 207L386 222M212 229L244 214" stroke="#7dd3fc" strokeWidth="2" strokeLinecap="round" opacity="0.8" />
              <circle cx="178" cy="142" r="4" fill="#7dd3fc" /><circle cx="386" cy="222" r="4" fill="#7dd3fc" />
              <g fill="#a9e6df" fontFamily="monospace" fontSize="10" opacity="0.72">
                <text x="28" y="32">REVIEW SURFACE / SYNTHETIC</text>
                <text x="28" y="338">QUALITY GATE</text><text x="432" y="338">AUDIT TRAIL</text>
              </g>
            </svg>
          </div>
          <div className="visual-footer">
            <div><span className="stat-label">Illustrative workflow</span><strong>Structured image review</strong></div>
            <span className="visual-note">Not a medical image</span>
          </div>
        </div>
      </section>

      <section className="landing-section" aria-labelledby="principles-title">
        <div className="section-intro">
          <div>
            <div className="eyebrow">01 / Operating principles</div>
            <h2 id="principles-title">Validation-first by design</h2>
          </div>
          <p className="muted">Infrastructure for real clinical AI — not a chatbot that guesses diseases from photographs.</p>
        </div>
        <div className="grid grid-3 landing-feature-grid">
          {FEATURES.map(([icon, title, body], index) => (
            <div className="card feature-card" key={title}>
              <div className="feature-topline"><span className="feature-index">0{index + 1}</span><Icon name={icon} size={18} /></div>
              <h3>{title}</h3>
              <p className="muted small" style={{ marginBottom: 0 }}>{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-section" aria-labelledby="pipeline-title">
        <div className="pipeline-panel card">
          <div className="section-intro pipeline-intro">
            <div>
              <div className="eyebrow">02 / Traceable flow</div>
              <h2 id="pipeline-title">The analysis pipeline</h2>
            </div>
            <p className="muted">Each stage keeps its own gate, provenance, and review boundary.</p>
          </div>
          <div className="pipeline-grid">
            {PIPELINE.map(([n, title, body]) => (
              <div className="pipeline-step" key={n}>
                <span className="pipeline-number">{n}</span>
                <div><h3>{title}</h3><p className="muted tiny">{body}</p></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-section landing-model-fabric" aria-labelledby="model-fabric-title">
        <div className="section-intro">
          <div>
            <div className="eyebrow">03 / Local model fabric</div>
            <h2 id="model-fabric-title">Research models with visible boundaries</h2>
          </div>
          <p className="muted">The registry exposes what is loaded, what it can observe, and what it cannot prove.</p>
        </div>
        <div className="model-fabric-grid">
          {LOCAL_RESEARCH_MODELS.map((model) => (
            <article className="card model-fabric-card" key={model.model_id}>
              <div className="model-fabric-topline"><span className="research-pill">{model.status}</span><span className="tiny muted">{model.format?.toUpperCase() ?? "NO ARTIFACT"}</span></div>
              <h3>{model.model_name}</h3>
              <p className="tiny muted">Task: {model.supported_findings.join(", ") || "No declared target"}</p>
              <dl className="model-fabric-meta">
                <dt>Runtime</dt><dd>Local CPU research</dd>
                <dt>Version</dt><dd>{model.version}</dd>
                <dt>Integrity</dt><dd>{model.sha256 ? `SHA-256 ${model.sha256.slice(0, 12)}…` : "Unavailable"}</dd>
              </dl>
              <p className="tiny model-fabric-limit">{model.notes ?? "Research output requires clinician review."}</p>
            </article>
          ))}
        </div>
        <div className="phase2-callout"><strong>Research state is explicit.</strong> Local inference can produce technical observations only. It does not establish a diagnosis, normality, treatment, or clinical validity.</div>
      </section>

      <section className="landing-section landing-disclaimer" aria-labelledby="disclaimer-title">
        <div className="alert warn" style={{ alignItems: "center", marginBottom: 0 }}>
          <span className="alert-icon" aria-hidden="true">⚠</span>
          <div className="alert-body">
            <strong id="disclaimer-title">What this platform is not</strong>
            It is not a medical device, it has not been clinically validated, and no accuracy claims are made.
            Local research models may execute for technical observation; demo/synthetic output remains a clearly-labeled
            fallback. A negative result never means &ldquo;definitely healthy.&rdquo;
          </div>
        </div>
      </section>
    </div>
  );
}
