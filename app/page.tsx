import Link from "next/link";
import { Icon, IconName } from "@/components/icons";
import { Badge } from "@/components/ui";

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
    <div>
      <section style={{ textAlign: "center", padding: "46px 10px 34px" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--warn)", background: "var(--warn-soft)", border: "1px solid var(--warn-border)", padding: "4px 14px", borderRadius: 999, marginBottom: 18 }}>
          <span aria-hidden="true">⚠</span> Research environment — not validated for clinical use
        </div>
        <h1 style={{ fontSize: "clamp(1.7rem, 4.4vw, 2.5rem)", fontWeight: 700, maxWidth: 720, margin: "0 auto 12px", letterSpacing: "-0.02em" }}>
          AI-assisted eye and retinal scan analysis.
        </h1>
        <p className="muted" style={{ fontSize: "1rem", maxWidth: 560, margin: "0 auto 24px" }}>
          Analyze ophthalmic imaging, identify potentially significant findings, and organize clinical review in
          one workspace. Built validation-first: every result is structured, auditable, and reviewed by professionals.
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
          <Link className="btn" href="/analyze" style={{ padding: "10px 22px" }}>Start Analysis</Link>
          <Link className="btn secondary" href="/dashboard" style={{ padding: "10px 22px" }}>View Demo</Link>
        </div>
      </section>

      <section className="card" style={{ maxWidth: 880, margin: "0 auto 40px", padding: 0, overflow: "hidden" }} aria-label="Product illustration">
        <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", minHeight: 280 }} className="landing-split">
          <div style={{ background: "#05070c", position: "relative" }}>
            {/* Stylized fundus illustration (not a medical image) */}
            <svg viewBox="0 0 400 280" style={{ width: "100%", height: "100%", display: "block" }} aria-hidden="true">
              <defs>
                <radialGradient id="fundus" cx="50%" cy="50%" r="65%">
                  <stop offset="0%" stopColor="#b03a28" />
                  <stop offset="55%" stopColor="#7e251c" />
                  <stop offset="100%" stopColor="#400f0b" />
                </radialGradient>
              </defs>
              <rect width="400" height="280" fill="#05070c" />
              <circle cx="200" cy="140" r="100" fill="url(#fundus)" />
              <circle cx="250" cy="140" r="25" fill="#c98343" opacity="0.9" />
              <circle cx="254" cy="140" r="10" fill="#eeddb8" />
              <path d="M 230 140 Q 180 102 122 84" stroke="#d05a2c" strokeWidth="5.5" fill="none" strokeLinecap="round" opacity="0.85" />
              <path d="M 230 140 Q 180 178 122 196" stroke="#d05a2c" strokeWidth="4.5" fill="none" strokeLinecap="round" opacity="0.85" />
              <path d="M 230 140 Q 190 140 132 140" stroke="#d05a2c" strokeWidth="3.5" fill="none" strokeLinecap="round" opacity="0.65" />
              <rect x="226" y="118" width="52" height="46" rx="5" fill="none" stroke="#38bdf8" strokeWidth="1.8" strokeDasharray="6 4" />
              <rect x="230" y="105" width="120" height="16" rx="4" fill="rgba(2,40,60,0.85)" />
              <text x="236" y="116" fontSize="8.5" fill="#7dd3fc" fontFamily="monospace">AI-highlighted region (demo)</text>
            </svg>
          </div>
          <div style={{ padding: "20px 20px", display: "flex", flexDirection: "column", gap: 12, justifyContent: "center", textAlign: "left" }}>
            <div>
              <div className="stat-label">Screening result</div>
              <div style={{ color: "var(--warn)", fontWeight: 700, fontSize: "0.92rem" }}>Potential abnormal finding detected</div>
            </div>
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}>
              <div className="stat-label">Image quality</div>
              <div style={{ color: "var(--ok)", fontWeight: 650, fontSize: "0.86rem" }}>Good — all checks passed</div>
            </div>
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}>
              <div className="stat-label">Recommended next step</div>
              <div style={{ fontSize: "0.86rem" }}>Prompt review by an eye-care professional</div>
            </div>
            <div><Badge tone="demo">Demo / synthetic — not for clinical use</Badge></div>
          </div>
        </div>
      </section>

      <section style={{ maxWidth: 1040, margin: "0 auto", padding: "8px 10px 36px" }}>
        <h2 style={{ textAlign: "center", fontSize: "1.3rem" }}>Validation-first by design</h2>
        <p className="muted" style={{ textAlign: "center", marginBottom: 24 }}>
          Infrastructure for real clinical AI — not a chatbot that guesses diseases from photographs.
        </p>
        <div className="grid grid-3">
          {FEATURES.map(([icon, title, body]) => (
            <div className="card" key={title}>
              <div style={{ color: "var(--accent)", marginBottom: 8 }}><Icon name={icon} size={18} /></div>
              <h3>{title}</h3>
              <p className="muted small" style={{ marginBottom: 0 }}>{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section style={{ maxWidth: 1040, margin: "0 auto", padding: "0 10px 36px" }}>
        <div className="card" style={{ padding: 24 }}>
          <h2 style={{ marginTop: 0, textAlign: "center", fontSize: "1.15rem" }}>The analysis pipeline</h2>
          <div className="grid grid-3" style={{ marginTop: 16 }}>
            {PIPELINE.map(([n, title, body]) => (
              <div key={n} style={{ display: "flex", gap: 11 }}>
                <span style={{ flexShrink: 0, width: 24, height: 24, borderRadius: 999, background: "var(--accent-soft)", color: "var(--accent)", fontWeight: 700, fontSize: "0.76rem", display: "flex", alignItems: "center", justifyContent: "center" }}>{n}</span>
                <div>
                  <h3 style={{ marginBottom: 2 }}>{title}</h3>
                  <p className="muted tiny" style={{ marginTop: 0 }}>{body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section style={{ maxWidth: 1040, margin: "0 auto", padding: "0 10px 44px" }}>
        <div className="alert warn" style={{ alignItems: "center", marginBottom: 0 }}>
          <span className="alert-icon" aria-hidden="true">⚠</span>
          <div className="alert-body">
            <strong>What this platform is not</strong>
            It is not a medical device, it has not been clinically validated, and no accuracy claims are made.
            Current analysis runs in demo mode with clearly-labeled synthetic findings while validation
            infrastructure is being built. A negative result never means &ldquo;definitely healthy.&rdquo;
          </div>
        </div>
      </section>
    </div>
  );
}
