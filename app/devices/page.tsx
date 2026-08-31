import { ADAPTER_REGISTRY } from "@/lib/devices/adapter";

const SUPPORTED_INPUTS = [
  ["Standard images", "JPEG, JPG, PNG, WEBP — fully supported for ingestion and quality analysis."],
  ["Fundus photographs", "Ingestion supported; lesion detection is a demo placeholder."],
  ["Retinal / optic nerve / macula photographs", "Ingestion supported; analysis placeholder."],
  ["OCT / OCT-A", "Architecture supports; no parser, segmentation, or analysis implemented yet."],
  ["Fundus autofluorescence", "Architecture supports; analysis placeholder."],
  ["Fluorescein / ICG angiography", "Architecture supports; analysis placeholder."],
  ["Slit-lamp / external eye photographs", "Ingestion supported; analysis placeholder."],
  ["DICOM", "Detected (Part 10 magic) and safely refused for analysis — parser is an integration placeholder."],
  ["Device-specific proprietary formats", "Via device adapters — none implemented yet."],
];

export default function DevicesPage() {
  return (
    <div>
      <h1>Devices &amp; integrations</h1>
      <p className="muted">
        Device → Device Adapter → Normalized Imaging Format → AI Analysis Pipeline. The platform is deliberately
        not hard-coded to any manufacturer.
      </p>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>The EyeScanner abstraction</h2>
        <div className="code">{`interface DeviceAdapter {
  connect(): Promise<void>
  authenticate(): Promise<void>
  acquireScan(): Promise<NormalizedStudy>
  retrieveStudy(ref): Promise<NormalizedStudy>
  retrieveMetadata(ref): Promise<DeviceMetadata>
  disconnect(): Promise<void>
}`}</div>
        <p className="small muted">
          Metadata preserved when provided: manufacturer, model, software version, scan type, eye (OD/OS),
          scan date/time, resolution, scan protocol, acquisition parameters. The system never invents metadata
          the device did not provide.
        </p>
      </div>

      <h2>Adapter registry</h2>
      <table className="table">
        <thead>
          <tr><th>Adapter</th><th>Transport</th><th>Status</th><th>Note</th></tr>
        </thead>
        <tbody>
          {ADAPTER_REGISTRY.map((a) => (
            <tr key={a.id}>
              <td>{a.displayName}</td>
              <td>{a.transport}</td>
              <td>
                {a.status === "available"
                  ? <span className="badge ok">available</span>
                  : <span className="badge neutral">integration placeholder</span>}
              </td>
              <td className="small muted">{a.note}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Supported input types</h2>
      <table className="table">
        <thead><tr><th>Input</th><th>Support level</th></tr></thead>
        <tbody>
          {SUPPORTED_INPUTS.map(([k, v]) => (
            <tr key={k}><td>{k}</td><td className="small muted">{v}</td></tr>
          ))}
        </tbody>
      </table>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Device calibration &amp; validation policy</h2>
        <ul className="small">
          <li>A model validated on one device must not be assumed to perform equivalently on another.</li>
          <li>Per-device validation (device model, firmware, scan protocol, resolution, field of view, calibration, laterality, acquisition conditions) is required before any validated use.</li>
          <li>Until per-device validation exists, the platform reports <span className="badge warn">not validated</span> for every component.</li>
        </ul>
      </div>
    </div>
  );
}
