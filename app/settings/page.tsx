import Link from "next/link";
import { Badge, PageHeader, SectionHeader } from "@/components/ui";
import { Icon } from "@/components/icons";

const CAPABILITIES: Array<[string, "IMPLEMENTED" | "DEMO" | "RESEARCH" | "NOT IMPLEMENTED" | "NOT VALIDATED", string]> = [
  ["Upload & immutable scan storage (SHA-256)", "IMPLEMENTED", "Originals written once, never modified"],
  ["Image quality gate (real metrics)", "NOT VALIDATED", "Deterministic heuristics; thresholds not clinically validated"],
  ["DICOM detection", "IMPLEMENTED", "Part 10 detection; parsing NOT implemented — safely refused"],
  ["DICOM parsing / PACS / device connectivity", "NOT IMPLEMENTED", "Integration placeholders"],
  ["Anatomical segmentation", "NOT IMPLEMENTED", "Placeholder component; emits nothing"],
  ["Lesion / vascular detection", "RESEARCH", "Real local lesion/DR research inference; uncalibrated and not clinically validated"],
  ["OCT analysis & measurements", "RESEARCH", "Real local OCT class research inference; no pixel measurements or clinical validation"],
  ["Structured schema-validated output", "IMPLEMENTED", "Strict validator; invalid results are rejected"],
  ["Uncertainty & OOD layer", "IMPLEMENTED", "Honest uncertainty; normality never claimed on OOD"],
  ["Model registry, integrity & gates", "IMPLEMENTED", "Checksums, statuses, evidence references required"],
  ["Conservative triage & red-flag escalation", "IMPLEMENTED", "Deterministic; AI can never lower a level"],
  ["Clinician review workflow", "IMPLEMENTED", "AI output / clinician interpretation / final report kept separate"],
  ["Reports (JSON export, print/PDF)", "IMPLEMENTED", "FHIR export NOT implemented (planned)"],
  ["Temporal comparison", "IMPLEMENTED", "Finding-type counts only; no fabricated quantitative claims"],
  ["Dataset management & multi-grader labeling", "RESEARCH", "Patient-level split enforcement; locked test sets read-only"],
  ["Performance evaluation tooling", "RESEARCH", "Sens/spec/PPV/NPV/AUROC/AUPRC/calibration — research-only"],
  ["Authentication / RBAC / encryption-at-rest", "IMPLEMENTED", "Authentication/RBAC is implemented; encryption at rest is still not implemented"],
  ["Purpose-specific consent capture", "IMPLEMENTED", "Required before image-model analysis; bound to the study"],
  ["Retention scheduling", "NOT IMPLEMENTED", "No automated expiry scheduler; manual governance is required"],
];

export default function SettingsPage() {
  return (
    <div style={{ maxWidth: 960, margin: "0 auto" }}>
      <PageHeader eyebrow="System" title="Settings, privacy & data control" lede="Where data lives, what this deployment commits to, and an honest status for every capability." />

      <div className="card">
        <h3 style={{ marginTop: 0, display: "flex", gap: 8, alignItems: "center" }}><Icon name="database" size={16} /> Where your data lives</h3>
        <p className="small">Application data stays on this machine under the configured local data root (set by <code>DATA_ROOT</code>); build caches and source-controlled code remain outside it. Relative locations:</p>
        <dl className="kv">
          <dt>Original scans</dt><dd><code>data\uploads\&lt;study_id&gt;\</code> — byte-for-byte, SHA-256 recorded</dd>
          <dt>Analyses</dt><dd><code>data\processed\</code></dd>
          <dt>Reports</dt><dd><code>data\reports\</code></dd>
          <dt>Database</dt><dd><code>data\database\</code></dd>
          <dt>Logs</dt><dd><code>data\logs\</code> — audit events only; images and full reports never logged</dd>
          <dt>Models</dt><dd><code>data\models\</code> — hash-verified RESEARCH packages; no clinical model</dd>
        </dl>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0, display: "flex", gap: 8, alignItems: "center" }}><Icon name="lock" size={16} /> Privacy commitments</h3>
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          <li>Eye scans are sensitive medical information and are treated accordingly.</li>
          <li>No public image URLs; images served only through this local application.</li>
          <li>Raw images are never written to application logs.</li>
          <li>Uploaded scans are <strong>never</strong> used for model training in this deployment.</li>
          <li>Device metadata is stored only when you provide it; nothing is invented.</li>
        </ul>
        <div className="alert warn" style={{ marginBottom: 0 }}>
          <span className="alert-icon" aria-hidden="true"><Icon name="warning" size={16} /></span>
          <div className="alert-body">
            <strong>Encryption at rest: NOT IMPLEMENTED.</strong>
            Authentication and role-based access control are implemented for this local workspace, but the build
            must still not be exposed to untrusted networks. Storing real patient data remains strongly discouraged.
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
        <SectionHeader title="Capability status" caption="Explicit, honest capability levels for every subsystem" level={3} />
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Capability status">
          <table className="table">
            <thead><tr><th scope="col">Capability</th><th scope="col">Status</th><th scope="col">Note</th></tr></thead>
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
          The equipped local deployment runs hash-verified <strong>RESEARCH-only fundus, DR, and OCT models</strong>
          when image quality and model gates permit; outputs remain uncalibrated observations and can fail closed to
          an unavailable state. The synthetic DEMO path remains available only as a labeled fallback for pipeline
          exercises. The validation pathway is documented in <code>docs/VALIDATION.md</code>.
        </p>
      </div>
    </div>
  );
}
