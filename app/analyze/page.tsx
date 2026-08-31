"use client";

import { useRef, useState } from "react";
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
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [scanType, setScanType] = useState("unknown");
  const [eye, setEye] = useState("unknown");
  const [manufacturer, setManufacturer] = useState("");
  const [deviceModel, setDeviceModel] = useState("");
  const [scanDateTime, setScanDateTime] = useState("");
  const [state, setState] = useState<"idle" | "uploading" | "validating">("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function pick(f: File | null) {
    setFile(f);
    setPreviewUrl(f && f.type.startsWith("image/") ? URL.createObjectURL(f) : null);
    setError(null);
  }

  async function submit() {
    if (!file) { setError("Please choose an image file (JPEG, PNG, WEBP)."); return; }
    setState("uploading");
    setProgress(8);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("scanType", scanType);
      fd.set("eye", eye);
      if (manufacturer) fd.set("manufacturer", manufacturer);
      if (deviceModel) fd.set("deviceModel", deviceModel);
      if (scanDateTime) fd.set("scanDateTime", scanDateTime);

      const xhr = new XMLHttpRequest();
      const done = new Promise<void>((resolve, reject) => {
        xhr.upload.onprogress = (e) => { if (e.lengthComputable) setProgress(8 + (e.loaded / e.total) * 72); };
        xhr.onload = () => {
          setProgress(88);
          try {
            const data = JSON.parse(xhr.responseText);
            if (xhr.status >= 200 && xhr.status < 300) { setProgress(100); setState("validating"); resolve(); (window as unknown as { __studyId?: string }).__studyId = data.study_id; router.push(`/processing?study=${encodeURIComponent(data.study_id)}`); }
            else reject(new Error(data.error ?? "Upload failed"));
          } catch { reject(new Error("Unexpected server response")); }
        };
        xhr.onerror = () => reject(new Error("Network error during upload"));
      });
      xhr.open("POST", "/api/upload");
      xhr.send(fd);
      await done;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState("idle");
    }
  }

  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      <h1>New analysis</h1>
      <p className="muted">
        Upload a single eye image to obtain a preliminary automated screening result. No long questionnaire is
        required. Additional information is requested only when it improves interpretation.
      </p>

      <div className="card" style={{ padding: 24 }}>
        {!file && (
          <div
            className={`dropzone${drag ? " active" : ""}`}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }}
            role="button"
            tabIndex={0}
            aria-label="Upload scan: drag and drop or browse files"
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files?.[0] ?? null); }}
          >
            <div className="dz-icon" aria-hidden="true">◉</div>
            <strong style={{ fontSize: "1.05rem" }}>Upload Scan</strong>
            <p style={{ margin: "4px 0" }}>Drag &amp; drop your image here</p>
            <button className="btn secondary sm" type="button" onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}>Browse Files</button>
            <p className="tiny" style={{ marginTop: 14, color: "var(--text-3)" }}>Fundus • OCT • OCT-A • DICOM detected • JPEG, PNG, WEBP • max 25 MB</p>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".jpg,.jpeg,.png,.webp,.dcm,image/jpeg,image/png,image/webp"
          hidden
          onChange={(e) => pick(e.target.files?.[0] ?? null)}
        />

        {file && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 16, alignItems: "center" }}>
              {previewUrl
                ? // eslint-disable-next-line @next/next/no-img-element
                <img src={previewUrl} alt="Selected scan preview" style={{ width: 140, height: 105, objectFit: "cover", borderRadius: 10, border: "1px solid var(--border)" }} />
                : <div style={{ width: 140, height: 105, borderRadius: 10, background: "var(--surface-3)", display: "flex", alignItems: "center", justifyContent: "center" }} className="muted small">DICOM detected</div>}
              <div>
                <strong style={{ wordBreak: "break-all" }}>{file.name}</strong>
                <p className="small muted" style={{ margin: "2px 0 10px" }}>{(file.size / 1024).toFixed(0)} KB • {file.type || "unknown type"}</p>
                <button className="btn ghost sm" onClick={() => pick(null)}>Remove</button>
              </div>
            </div>

            {(state === "uploading" || state === "validating") && (
              <div style={{ marginTop: 18 }} aria-live="polite">
                <div className="meter"><div style={{ width: `${progress}%` }} /></div>
                <p className="small muted" style={{ marginBottom: 0 }}>
                  {state === "uploading" ? "UPLOADING…" : "VALIDATING…"}
                </p>
              </div>
            )}

            <div className="grid grid-2">
              <div className="field">
                <label htmlFor="scanType">Scan type (optional)</label>
                <select id="scanType" value={scanType} onChange={(e) => setScanType(e.target.value)} disabled={state !== "idle"}>
                  {SCAN_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="eye">Eye laterality (optional)</label>
                <select id="eye" value={eye} onChange={(e) => setEye(e.target.value)} disabled={state !== "idle"}>
                  <option value="unknown">Unknown</option>
                  <option value="OD">OD (right)</option>
                  <option value="OS">OS (left)</option>
                </select>
              </div>
            </div>

            <details className="tech">
              <summary>Optional device information — only metadata you provide is stored; nothing is invented</summary>
              <div className="grid grid-3">
                <div className="field">
                  <label htmlFor="manufacturer">Device manufacturer</label>
                  <input id="manufacturer" value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} placeholder="e.g. Zeiss" disabled={state !== "idle"} />
                </div>
                <div className="field">
                  <label htmlFor="deviceModel">Device model</label>
                  <input id="deviceModel" value={deviceModel} onChange={(e) => setDeviceModel(e.target.value)} placeholder="e.g. Visucam 524" disabled={state !== "idle"} />
                </div>
                <div className="field">
                  <label htmlFor="scanDateTime">Scan date/time</label>
                  <input id="scanDateTime" type="datetime-local" value={scanDateTime} onChange={(e) => setScanDateTime(e.target.value)} disabled={state !== "idle"} />
                </div>
              </div>
            </details>
          </>
        )}

        {error && <div className="alert danger" style={{ marginTop: 12 }}><span className="alert-icon" aria-hidden="true">⚠</span><div className="alert-body"><strong>Upload failed</strong>{error}</div></div>}

        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 18, flexWrap: "wrap" }}>
          <button className="btn" onClick={submit} disabled={!file || state !== "idle"}>
            {state === "idle" ? "Analyze scan" : state === "uploading" ? "Uploading…" : "Validating…"}
          </button>
          <span className="tiny muted">The original file is preserved unchanged (SHA-256) and stored locally on drive D:.</span>
        </div>
      </div>
    </div>
  );
}
