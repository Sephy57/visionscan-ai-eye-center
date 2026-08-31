"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";

const SCAN_TYPES = [
  ["unknown", "Auto / unknown"],
  ["fundus", "Fundus photograph"],
  ["retinal_photo", "Retinal photograph"],
  ["oct", "OCT"],
  ["octa", "OCT-A"],
  ["faf", "Fundus autofluorescence"],
  ["ffa", "Fluorescein angiography"],
  ["icg", "Indocyanine green angiography"],
  ["slit_lamp", "Slit-lamp image"],
  ["external_eye", "External eye photograph"],
  ["optic_nerve", "Optic nerve image"],
  ["macula", "Macula image"],
];

export default function AnalyzePage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [scanType, setScanType] = useState("unknown");
  const [eye, setEye] = useState("unknown");
  const [manufacturer, setManufacturer] = useState("");
  const [deviceModel, setDeviceModel] = useState("");
  const [scanDateTime, setScanDateTime] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function submit() {
    if (!file) { setError("Please choose an image file (JPEG, PNG, WEBP)."); return; }
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("scanType", scanType);
      fd.set("eye", eye);
      if (manufacturer) fd.set("manufacturer", manufacturer);
      if (deviceModel) fd.set("deviceModel", deviceModel);
      if (scanDateTime) fd.set("scanDateTime", scanDateTime);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      router.push(`/processing?study=${encodeURIComponent(data.study_id)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div>
      <h1>Analyze an eye scan</h1>
      <p className="muted">
        Upload a single eye image to obtain a preliminary automated screening result. No long questionnaire is
        required; additional information is requested only when it materially improves interpretation.
      </p>

      <div className="panel">
        <div
          className={`dropzone${drag ? " active" : ""}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            if (e.dataTransfer.files?.[0]) setFile(e.dataTransfer.files[0]);
          }}
        >
          {file ? (
            <div>
              <strong>{file.name}</strong>
              <div className="small muted">{(file.size / 1024).toFixed(0)} KB &middot; click to change</div>
            </div>
          ) : (
            <div>
              <strong>Click to choose an image</strong>
              <div className="small">or drag &amp; drop &middot; JPEG, PNG, WEBP &middot; max 25 MB</div>
              <div className="small">DICOM files are detected but not yet analyzable (integration placeholder).</div>
            </div>
          )}
          <input
            ref={inputRef}
            type="file"
            accept=".jpg,.jpeg,.png,.webp,.dcm,image/jpeg,image/png,image/webp"
            hidden
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>

        <div className="grid-2" style={{ marginTop: 14 }}>
          <div className="field">
            <label htmlFor="scanType">Scan type (optional)</label>
            <select id="scanType" value={scanType} onChange={(e) => setScanType(e.target.value)}>
              {SCAN_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="eye">Eye (optional)</label>
            <select id="eye" value={eye} onChange={(e) => setEye(e.target.value)}>
              <option value="unknown">Unknown</option>
              <option value="OD">OD (right)</option>
              <option value="OS">OS (left)</option>
            </select>
          </div>
        </div>

        <details className="tech">
          <summary>Optional device information (only metadata you provide is stored; nothing is invented)</summary>
          <div className="grid-3">
            <div className="field">
              <label htmlFor="manufacturer">Device manufacturer</label>
              <input id="manufacturer" value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} placeholder="e.g. Zeiss" />
            </div>
            <div className="field">
              <label htmlFor="deviceModel">Device model</label>
              <input id="deviceModel" value={deviceModel} onChange={(e) => setDeviceModel(e.target.value)} placeholder="e.g. Visucam 524" />
            </div>
            <div className="field">
              <label htmlFor="scanDateTime">Scan date/time</label>
              <input id="scanDateTime" type="datetime-local" value={scanDateTime} onChange={(e) => setScanDateTime(e.target.value)} />
            </div>
          </div>
        </details>

        {error && <div className="callout danger"><strong>Error:</strong> {error}</div>}

        <div style={{ marginTop: 16, display: "flex", gap: 10, alignItems: "center" }}>
          <button className="btn" onClick={submit} disabled={busy}>
            {busy ? "Uploading…" : "Upload and analyze"}
          </button>
          <span className="small muted">
            The original file is preserved unchanged (SHA-256 recorded) and stored locally on drive D:.
          </span>
        </div>
      </div>
    </div>
  );
}
