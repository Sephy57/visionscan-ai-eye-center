import Link from "next/link";

export default function LandingPage() {
  return (
    <div>
      <section className="panel" style={{ padding: "34px 34px" }}>
        <h1>AI Eye Scan Analysis &amp; Clinical Decision-Support Platform</h1>
        <p className="muted" style={{ maxWidth: 720 }}>
          Upload an eye photograph or ophthalmic scan. The platform checks image quality, runs a structured AI
          analysis pipeline, and produces a screening report with calibrated confidence, explicit uncertainty, and a
          recommended next action &mdash; designed for review by an eye-care professional.
        </p>
        <div style={{ marginTop: 18, display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Link className="btn" href="/analyze">Analyze an eye scan</Link>
          <Link className="btn secondary" href="/history">View scan history</Link>
          <Link className="btn secondary" href="/clinician">Clinician review</Link>
        </div>
        <div className="callout warn" style={{ marginTop: 20 }}>
          <strong>Important limitations.</strong> This deployment is a development architecture. Every detection and
          segmentation component is an <strong>unvalidated placeholder</strong>. Analyses run in demo mode with
          synthetic findings and are labeled{" "}
          <span className="demo-tag">DEMO / SYNTHETIC RESULT — NOT FOR CLINICAL USE</span>. The system is not a
          medical device, has not been clinically validated, and must never be used for diagnosis.
        </div>
      </section>

      <div className="grid-3">
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Quality gate first</h3>
          <p className="muted small">
            Real deterministic image metrics (sharpness, illumination, clipping, resolution) run before any
            interpretation. Poor-quality scans are rejected &mdash; no clinical finding is ever generated from an
            inadequate image.
          </p>
        </div>
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Structured, auditable output</h3>
          <p className="muted small">
            Every analysis produces a machine-readable, schema-validated result: findings, locations, confidence
            categories, uncertainty, model versions, and ruleset. Originals are preserved byte-for-byte with SHA-256.
          </p>
        </div>
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Conservative triage</h3>
          <p className="muted small">
            Deterministic safety rules escalate red flags and high-risk findings regardless of AI confidence.
            Uncertainty itself can trigger professional review. AI output can never lower a triage level.
          </p>
        </div>
      </div>

      <h2>The pipeline</h2>
      <div className="panel">
        <ol>
          <li>Upload / connect scan (device-adapter abstraction)</li>
          <li>Device &amp; image identification (DICOM detection; metadata preserved, never invented)</li>
          <li>Image quality / artifact check (real metrics; unvalidated thresholds)</li>
          <li>Anatomical structure detection <span className="badge neutral">placeholder</span></li>
          <li>Abnormality detection <span className="badge warn">demo/synthetic</span></li>
          <li>Measurement &amp; quantification <span className="badge neutral">not yet validated</span></li>
          <li>Differential / possible findings (careful, non-diagnostic wording)</li>
          <li>Severity &amp; risk assessment (deterministic rules)</li>
          <li>Confidence / uncertainty check (calibrated methodology; capped without ensemble)</li>
          <li>Clinical report (JSON export; FHIR-ready architecture)</li>
          <li>Recommended next action (triage engine)</li>
          <li>Specialist review when required (clinician workflow)</li>
        </ol>
      </div>

      <h2>Safety commitments</h2>
      <div className="panel">
        <ul className="small">
          <li>No fabricated findings, confidence, or measurements.</li>
          <li>Poor-quality, corrupted, or unsupported scans are never silently analyzed.</li>
          <li>Red-flag symptoms override automated assessment.</li>
          <li>A negative result never means &ldquo;your eyes are definitely healthy.&rdquo;</li>
          <li>A general-purpose language model is never used as the diagnostic engine; it may only explain existing structured results.</li>
          <li>Original scans are preserved unchanged; every analysis records model versions and ruleset for auditability.</li>
        </ul>
      </div>
    </div>
  );
}
