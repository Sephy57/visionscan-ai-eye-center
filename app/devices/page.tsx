import { ADAPTER_REGISTRY } from "@/lib/devices/adapter";
import { SUPPORTED_MODALITIES } from "@/lib/models/modalities";
import { Badge, EmptyState } from "@/components/ui";

const SUPPORTED_INPUTS: Array<[string, string, "ok" | "warn" | "neutral"]> = [
  ["JPEG / JPG / PNG / WEBP", "Ingestion + quality analysis fully supported.", "ok"],
  ["Fundus photographs", "Ingestion supported; lesion detection is a DEMO placeholder.", "warn"],
  ["Retinal / optic nerve / macula photographs", "Ingestion supported; analysis placeholder.", "warn"],
  ["OCT / OCT-A", "Architecture supports; no parser, segmentation, or analysis implemented yet.", "neutral"],
  ["Fundus autofluorescence", "Architecture supports; analysis placeholder.", "neutral"],
  ["Fluorescein / ICG angiography", "Architecture supports; analysis placeholder.", "neutral"],
  ["Slit-lamp / external eye photographs", "Ingestion supported; analysis placeholder.", "warn"],
  ["DICOM", "Detected (Part 10 magic) and safely refused for analysis — parser is an integration placeholder.", "neutral"],
  ["Device-specific proprietary formats", "Via device adapters — none implemented yet.", "neutral"],
];

export default function DevicesPage() {
  return (
    <div>
      <h1>Device manager</h1>
      <p className="muted">Device → Device Adapter → Normalized Imaging Format → AI Analysis Pipeline. Deliberately not hard-coded to any manufacturer.</p>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-title"><h3>Connected devices</h3><Badge tone="neutral">0 connected</Badge></div>
        <EmptyState icon="◎" title="No devices connected"
          action={<button className="btn" disabled title="Device connections are an integration placeholder">Add Device</button>}>
          Device connectivity (USB, local network, DICOM servers, PACS, vendor APIs) is architected but not yet
          implemented. Connectivity will not be faked — adapters appear here only when they actually work.
        </EmptyState>
      </div>

      <h2>Adapter architecture</h2>
      <div className="code-block" style={{ marginBottom: 16 }}>{`interface EyeScanner {
  connect(): Promise<void>
  authenticate(): Promise<void>
  acquireScan(): Promise<NormalizedStudy>
  retrieveStudy(ref): Promise<NormalizedStudy>
  retrieveMetadata(ref): Promise<DeviceMetadata>
  disconnect(): Promise<void>
}`}</div>

      <h2>Adapter registry</h2>
      <div className="grid grid-3">
        {ADAPTER_REGISTRY.map((a) => (
          <div className="card hover" key={a.id}>
            <div className="card-title">
              <h3 style={{ fontSize: "0.95rem" }}>{a.displayName}</h3>
              {a.status === "available"
                ? <Badge tone="ok">AVAILABLE</Badge>
                : <Badge tone="neutral">NOT IMPLEMENTED</Badge>}
            </div>
            <p className="tiny muted" style={{ margin: 0 }}>{a.transport} — {a.note}</p>
          </div>
        ))}
      </div>

      <h2>Supported modalities</h2>
      <p className="small muted">Canonical modality vocabulary — models must explicitly declare which of these they support.</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {SUPPORTED_MODALITIES.map((m) => <Badge key={m} tone="info">{m}</Badge>)}
      </div>

      <h2>Supported input types</h2>
      <div className="card">
        <table className="table">
          <thead><tr><th>Input</th><th>Support level</th></tr></thead>
          <tbody>
            {SUPPORTED_INPUTS.map(([k, v, tone]) => (
              <tr key={k}>
                <td>{k}</td>
                <td className="small muted" style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <Badge tone={tone}>{tone === "ok" ? "IMPLEMENTED" : tone === "warn" ? "DEMO" : "NOT IMPLEMENTED"}</Badge>
                  {v}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="alert warn" style={{ marginTop: 16 }}>
        <span className="alert-icon" aria-hidden="true">⚠</span>
        <div className="alert-body">
          <strong>Device calibration &amp; validation policy</strong>
          A model validated on device A must never be assumed to work on device B. Per-device validation (model,
          firmware, scan protocol, resolution, field of view, calibration, laterality, acquisition conditions) is
          required before any validated use. Unsupported inputs receive: &ldquo;Device compatibility has not been
          validated.&rdquo;
        </div>
      </div>
    </div>
  );
}
