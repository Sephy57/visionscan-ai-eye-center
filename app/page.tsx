import Link from "next/link";

export default function LandingPage() {
  return (
    <div style={{ margin: "-26px -28px -64px" }}>
      <section className="hero">
        <span className="hero-eyebrow">AI-assisted ophthalmic screening architecture</span>
        <h1>AI-assisted eye and retinal scan analysis.</h1>
        <p className="sub">
          Analyze ophthalmic imaging, identify potentially significant findings, and organize clinical review
          in one workspace. Built for validation-first medical AI — every result is structured, auditable, and
          reviewed by professionals.
        </p>
        <div className="hero-ctas">
          <Link className="btn" href="/analyze" style={{ padding: "12px 26px" }}>Start Analysis →</Link>
          <Link className="btn secondary" href="/dashboard" style={{ padding: "12px 26px" }}>View Demo</Link>
        </div>

        <div className="hero-visual" aria-hidden="true">
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", minHeight: 320 }}>
            <div style={{ background: "#05070c", position: "relative", minHeight: 280 }}>
              {/* Stylized fundus illustration (not a medical image) */}
              <svg viewBox="0 0 400 280" style={{ width: "100%", height: "100%", display: "block" }}>
                <defs>
                  <radialGradient id="fundus" cx="50%" cy="50%" r="65%">
                    <stop offset="0%" stopColor="#c2412e" />
                    <stop offset="55%" stopColor="#8e2a1f" />
                    <stop offset="100%" stopColor="#4a120d" />
                  </radialGradient>
                </defs>
                <rect width="400" height="280" fill="#05070c" />
                <circle cx="200" cy="140" r="105" fill="url(#fundus)" />
                <circle cx="252" cy="140" r="26" fill="#d98e4a" opacity="0.9" />
                <circle cx="256" cy="140" r="11" fill="#f3e3c2" />
                <path d="M 232 140 Q 180 100 120 82" stroke="#e0632f" strokeWidth="6" fill="none" strokeLinecap="round" opacity="0.85" />
                <path d="M 232 140 Q 180 180 120 200" stroke="#e0632f" strokeWidth="5" fill="none" strokeLinecap="round" opacity="0.85" />
                <path d="M 232 140 Q 190 140 130 140" stroke="#e0632f" strokeWidth="4" fill="none" strokeLinecap="round" opacity="0.7" />
                <rect x="228" y="118" width="52" height="46" rx="6" fill="none" stroke="#38bdf8" strokeWidth="2" strokeDasharray="6 4" />
                <rect x="232" y="106" width="86" height="17" rx="4" fill="rgba(2,40,60,0.85)" />
                <text x="240" y="118" fontSize="9" fill="#7dd3fc" fontFamily="monospace">AI-highlighted region (demo)</text>
              </svg>
            </div>
            <div style={{ padding: "26px 22px", display: "flex", flexDirection: "column", gap: 14, justifyContent: "center" }}>
              <div>
                <div className="tiny" style={{ color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>Screening result</div>
                <div style={{ color: "#fbbf24", fontWeight: 700, fontSize: "0.98rem" }}>Potential abnormal finding detected</div>
              </div>
              <div style={{ borderTop: "1px solid #1e293b", paddingTop: 12 }}>
                <div className="tiny" style={{ color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>Image quality</div>
                <div style={{ color: "#4ade80", fontWeight: 650, fontSize: "0.9rem" }}>Excellent — all checks passed</div>
              </div>
              <div style={{ borderTop: "1px solid #1e293b", paddingTop: 12 }}>
                <div className="tiny" style={{ color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>Recommended next step</div>
                <div style={{ color: "#e2e8f0", fontSize: "0.9rem" }}>Prompt review by an eye-care professional</div>
              </div>
              <div style={{ borderTop: "1px solid #1e293b", paddingTop: 12 }}>
                <span style={{ color: "#f472b6", fontSize: "0.68rem", border: "1px solid #57173a", borderRadius: 999, padding: "2px 10px", fontWeight: 700 }}>DEMO / SYNTHETIC RESULT — NOT FOR CLINICAL USE</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">Validation-first by design</h2>
        <p className="section-sub">Infrastructure for real clinical AI — not a chatbot that guesses diseases from photographs.</p>
        <div className="grid grid-3">
          {[
            ["◎", "Quality gate first", "Real deterministic image metrics run before any interpretation. Poor-quality scans are rejected — no clinical finding is ever generated from an inadequate image."],
            ["⊞", "Structured & auditable", "Every analysis produces schema-validated JSON: findings, locations, confidence, uncertainty, model versions, checksums, and ruleset. Originals preserved with SHA-256."],
            ["⚠", "Conservative triage", "Deterministic safety rules escalate red flags regardless of AI confidence. Uncertainty itself triggers professional review. AI can never lower a triage level."],
            ["◈", "Model registry", "Strict registry with statuses, checksums, and evidence references. Models cannot self-declare validation. Only registered, verified models may run."],
            ["✓", "Human in the loop", "Dedicated clinician workspace: confirm, reject, correct, mark indeterminate, or request a new scan. AI output, clinician interpretation, and final report are stored separately."],
            ["☂", "Explicit capabilities", "Every capability is documented as IMPLEMENTED, DEMO, RESEARCH, NOT IMPLEMENTED, or NOT VALIDATED. Nothing pretends to be a medical device."],
          ].map(([icon, title, body]) => (
            <div className="card hover" key={title as string}>
              <div className="feature-icon" aria-hidden="true">{icon}</div>
              <h3>{title}</h3>
              <p className="muted small">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="card" style={{ padding: 28 }}>
          <h2 style={{ marginTop: 0, textAlign: "center" }}>The analysis pipeline</h2>
          <div className="grid grid-3" style={{ marginTop: 18 }}>
            {[
              ["1", "Upload & identify", "Device-adapter ingestion; DICOM detected and safely refused until a parser exists; metadata preserved, never invented."],
              ["2", "Quality & OOD gates", "Sharpness, illumination, glare, resolution, field of view — plus out-of-distribution checks for unsupported devices and atypical inputs."],
              ["3", "Registered model analysis", "Modality-matched models only, gated by registry status and integrity verification."],
              ["4", "Ensemble & uncertainty", "Cross-model agreement when available; confidence capped without it. Indeterminate results stay indeterminate."],
              ["5", "Triage & report", "Deterministic conservative triage; schema-validated report with limitations and model provenance."],
              ["6", "Clinical review", "Specialist confirmation, correction, or rejection — with a complete audit trail."],
            ].map(([n, title, body]) => (
              <div key={n as string} style={{ display: "flex", gap: 12 }}>
                <span style={{ flexShrink: 0, width: 28, height: 28, borderRadius: 999, background: "var(--accent-soft)", color: "var(--accent)", fontWeight: 700, fontSize: "0.82rem", display: "flex", alignItems: "center", justifyContent: "center" }}>{n}</span>
                <div>
                  <h3 style={{ marginBottom: 2 }}>{title}</h3>
                  <p className="muted small" style={{ marginTop: 0 }}>{body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="alert warn" style={{ alignItems: "center" }}>
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
