import Link from "next/link";

export default function SettingsPage() {
  return (
    <div>
      <h1>Settings, privacy &amp; data control</h1>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Where your data lives</h2>
        <p className="small">
          This development deployment stores everything locally on drive <code>D:\AI EYE ANALYSIS PLATFORM\data\</code>:
        </p>
        <ul className="small">
          <li><strong>Original scans:</strong> <code>data\uploads\&lt;study_id&gt;\</code> — preserved byte-for-byte, SHA-256 recorded</li>
          <li><strong>Analyses:</strong> <code>data\processed\</code></li>
          <li><strong>Reports:</strong> <code>data\reports\</code></li>
          <li><strong>Database:</strong> <code>data\database\</code></li>
          <li><strong>Logs:</strong> <code>data\logs\</code> — audit events only; images and full reports are never logged</li>
        </ul>
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Privacy commitments</h2>
        <ul className="small">
          <li>Eye scans are sensitive medical information and are treated accordingly.</li>
          <li>No public image URLs are generated; images are served only through this local application.</li>
          <li>Raw images are never written to application logs.</li>
          <li>Uploaded scans are <strong>never</strong> used for model training in this deployment.</li>
          <li>Device metadata is stored only when you actually provide it; nothing is invented.</li>
        </ul>
        <div className="callout warn small">
          <strong>Planned, not yet implemented:</strong> user accounts with authentication, encryption at rest,
          role-based access control, consent capture, and retention schedules. This development build has no
          authentication and must not be exposed to untrusted networks. Storing real patient data in this build
          is strongly discouraged.
        </div>
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Data deletion</h2>
        <p className="small">
          You can delete any study (original image, analysis, and report) permanently from the{" "}
          <Link href="/history">history page</Link>. Deletion is immediate and logged in the audit trail (event
          metadata only).
        </p>
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Analysis behavior</h2>
        <p className="small">
          The platform runs in <strong>demo mode</strong>: detection components are placeholders and findings are
          synthetic. This is deliberately honest behavior — the platform refuses to fake medical capability. See{" "}
          <code>docs/VALIDATION.md</code> for the pathway to validated models.
        </p>
      </div>
    </div>
  );
}
