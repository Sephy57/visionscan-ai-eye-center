import Link from "next/link";
import { Badge } from "@/components/ui";

const CAPABILITIES: Array<[string, "IMPLEMENTED" | "DEMO" | "RESEARCH" | "NOT IMPLEMENTED" | "NOT VALIDATED", string]> = [
  ["Upload & immutable scan storage (SHA-256)", "IMPLEMENTED", "Originals written once, never modified"],
  ["Image quality gate (real metrics)", "NOT VALIDATED", "Deterministic heuristics; thresholds not clinically validated"],
  ["DICOM detection", "IMPLEMENTED", "Part 10 detection; parsing NOT implemented — safely refused"],
  ["DICOM parsing / PACS / device connectivity", "NOT IMPLEMENTED", "Integration placeholders"],
  ["Anatomical segmentation", "NOT IMPLEMENTED", "Placeholder component; emits nothing"],
  ["Lesion / vascular detection", "DEMO", "Synthetic findings only, always labeled"],
  ["OCT analysis & measurements", "NOT IMPLEMENTED", "Schema prepared (taxonomy); no detection"],
  ["Structured schema-validated output", "IMPLEMENTED", "Strict validator; invalid results are rejected"],
  ["Uncertainty & OOD layer", "IMPLEMENTED", "Honest uncertainty; normality never claimed on OOD"],
  ["Model registry, integrity & gates", "IMPLEMENTED", "Checksums, statuses, evidence references required"],
  ["Conservative triage & red-flag escalation", "IMPLEMENTED", "Deterministic; AI can never lower a level"],
  ["Clinician review workflow", "IMPLEMENTED", "AI output / clinician interpretation / final report kept separate"],
  ["Reports (JSON export, print/PDF)", "IMPLEMENTED", "FHIR export NOT implemented (planned)"],
  ["Temporal comparison", "IMPLEMENTED", "Finding-type counts only; no fabricated quantitative claims"],
  ["Dataset management & multi-grader labeling", "RESEARCH", "Patient-level split enforcement; locked test sets read-only"],
  ["Performance evaluation tooling", "RESEARCH", "Sens/spec/PPV/NPV/AUROC/AUPRC/calibration — research-only"],
  ["Authentication / RBAC / encryption-at-rest", "NOT IMPLEMENTED", "Documented honestly; do not expose to untrusted networks"],
  ["Consent capture / retention schedules", "NOT IMPLEMENTED", "Planned"],
];

export default function SettingsPage() {
  return (
    <div style={{ maxWidth: 860, margin: "0 auto" }}>
      <h1>Settings, privacy &amp; data control</h1>

      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>Where your data lives</h3>
        <p className="small">Everything this application creates stays local on drive <code>D:\AI EYE ANALYSIS PLATFORM\data\</code>:</p>
        <dl className="kv">
          <dt>Original scans</dt><dd><code>data\uploads\&lt;study_id&gt;\</code> — byte-for-byte, SHA-256 recorded</dd>
          <dt>Analyses</dt><dd><code>data\processed\</code></dd>
          <dt>Reports</dt><dd><code>data\reports\</code></dd>
          <dt>Database</dt><dd><code>data\database\</code></dd>
          <dt>Logs</dt><dd><code>data\logs\</code> — audit events only; images and full reports never logged</dd>
          <dt>Models</dt><dd><code>data\models\</code> — intentionally empty</dd>
        </dl>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Privacy commitments</h3>
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          <li>Eye scans are sensitive medical information and are treated accordingly.</li>
          <li>No public image URLs; images served only through this local application.</li>
          <li>Raw images are never written to application logs.</li>
          <li>Uploaded scans are <strong>never</strong> used for model training in this deployment.</li>
          <li>Device metadata is stored only when you provide it; nothing is invented.</li>
        </ul>
        <div className="alert warn" style={{ marginBottom: 0 }}>
          <span className="alert-icon" aria-hidden="true">☂</span>
          <div className="alert-body">
            <strong>Encryption at rest: NOT IMPLEMENTED. Authentication: NOT IMPLEMENTED.</strong>
            These are documented honestly rather than faked. This build has no authentication and must not be
            exposed to untrusted networks. Storing real patient data in this build is strongly discouraged.
          </div>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Data deletion</h3>
        <p className="small" style={{ marginBottom: 0 }}>
          Delete any study (original image, analysis, and report) permanently from the{" "}
          <Link href="/history">history page</Link>. Deletion is immediate and logged in the audit trail
          (event metadata only).
        </p>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Capability status</h3>
        <p className="small muted" style={{ marginTop: 0 }}>Explicit, honest capability levels for every subsystem.</p>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Capability</th><th>Status</th><th>Note</th></tr></thead>
            <tbody>
              {CAPABILITIES.map(([cap, status, note]) => (
                <tr key={cap}>
                  <td className="small">{cap}</td>
                  <td><Badge tone={status === "IMPLEMENTED" ? "ok" : status === "DEMO" ? "demo" : status === "RESEARCH" ? "info" : status === "NOT VALIDATED" ? "warn" : "neutral"}>{status}</Badge></td>
                  <td className="tiny muted">{note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Analysis behavior</h3>
        <p className="small" style={{ marginBottom: 0 }}>
          The platform runs in <strong>demo mode</strong>: detection components are placeholders and findings are
          synthetic. This is deliberately honest — the platform refuses to fake medical capability. The validation
          pathway is documented in <code>docs/VALIDATION.md</code>.
        </p>
      </div>
    </div>
  );
}
