"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui";
import { Icon } from "@/components/icons";

// Mirrors lib/clinical/symptoms.ts vocabulary (validated server-side).
const GROUPS: Array<{ title: string; items: Array<[string, string]> }> = [
  {
    title: "Visual",
    items: [
      ["blurred_vision", "Blurred Vision"], ["sudden_vision_loss", "Vision Loss"],
      ["gradual_vision_loss", "Gradual Loss"], ["reduced_central_vision", "Central Vision"],
      ["reduced_peripheral_vision", "Peripheral Vision"], ["distorted_vision", "Distorted Vision"],
      ["double_vision", "Double Vision"], ["night_vision_difficulty", "Night Vision"],
      ["reduced_contrast", "Reduced Contrast"], ["transient_vision_changes", "Transient Changes"],
    ],
  },
  {
    title: "Retinal / vitreous",
    items: [
      ["floaters", "Floaters"], ["new_floaters", "New Floaters"], ["flashes", "Flashes"],
      ["flashes_with_field_loss", "Flashes + Field Loss"], ["curtain_shadow", "Curtain / Shadow"],
      ["spots_in_vision", "Spots"], ["wavy_lines", "Wavy Lines"], ["missing_vision_areas", "Missing Areas"],
    ],
  },
  {
    title: "Discomfort",
    items: [
      ["eye_pain", "Eye Pain"], ["severe_eye_pain_with_visual_disturbance", "Severe Pain + Vision"],
      ["redness", "Redness"], ["burning", "Burning"], ["itching", "Itching"],
      ["light_sensitivity", "Light Sensitivity"], ["foreign_body_sensation", "Foreign Body"],
      ["pressure_sensation", "Pressure"],
    ],
  },
  {
    title: "Other",
    items: [
      ["headache_with_visual_symptoms", "Headache + Visual"], ["recent_eye_trauma", "Eye Trauma"],
      ["trauma_with_vision_loss", "Trauma + Vision Loss"], ["recent_eye_procedure", "Recent Procedure"],
    ],
  },
];

const RED_FLAG_TYPES = new Set([
  "sudden_vision_loss", "new_floaters", "flashes_with_field_loss", "curtain_shadow",
  "severe_eye_pain_with_visual_disturbance", "recent_eye_trauma", "trauma_with_vision_loss",
]);

const RED_FLAG_MESSAGES: Record<string, string> = {
  sudden_vision_loss: "Sudden vision loss was reported.",
  curtain_shadow: "A curtain/shadow over vision was reported.",
  trauma_with_vision_loss: "Eye trauma with vision loss was reported.",
  severe_eye_pain_with_visual_disturbance: "Severe eye pain with visual disturbance was reported.",
  new_floaters: "New floaters were reported.",
  flashes_with_field_loss: "Flashes with visual field loss were reported.",
  recent_eye_trauma: "Recent eye trauma was reported.",
};

const DURATIONS = ["less_than_1_hour", "hours", "1_day", "days", "1_week", "weeks", "1_month", "months", "chronic", "unknown"];

interface SymptomDraft {
  type: string;
  onset: "sudden" | "gradual" | "unknown";
  duration: string;
  severity: "mild" | "moderate" | "severe";
  laterality: "right" | "left" | "both" | "unknown";
  progression: string;
  frequency: string;
  free_text: string;
}

function newDraft(type: string): SymptomDraft {
  return { type, onset: "unknown", duration: "unknown", severity: "moderate", laterality: "unknown", progression: "unknown", frequency: "unknown", free_text: "" };
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default function AnalyzePage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [drafts, setDrafts] = useState<SymptomDraft[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewDims, setPreviewDims] = useState<{ w: number; h: number } | null>(null);
  const [fileHash, setFileHash] = useState<string | null>(null);
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

  const flagged = drafts.filter((d) => RED_FLAG_TYPES.has(d.type));
  const allLabels = GROUPS.flatMap((g) => g.items);
  const labelOf = (type: string) => allLabels.find(([t]) => t === type)?.[1] ?? type;

  function toggleSymptom(type: string) {
    setDrafts((d) => d.some((x) => x.type === type) ? d.filter((x) => x.type !== type) : [...d, newDraft(type)]);
  }
  function updateDraft(type: string, patch: Partial<SymptomDraft>) {
    setDrafts((d) => d.map((x) => x.type === type ? { ...x, ...patch } : x));
  }

  async function pick(f: File | null) {
    setFile(f);
    setError(null);
    setFileHash(null);
    setPreviewDims(null);
    if (f && f.type.startsWith("image/")) {
      setPreviewUrl(URL.createObjectURL(f));
      // Client-side quality pre-checks (research signal only; the server re-checks everything).
      const url = URL.createObjectURL(f);
      const img = new Image();
      img.onload = () => { setPreviewDims({ w: img.naturalWidth, h: img.naturalHeight }); URL.revokeObjectURL(url); };
      img.src = url;
      try { setFileHash(await sha256Hex(await f.arrayBuffer())); } catch {}
    } else {
      setPreviewUrl(null);
    }
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
      const studyId = await new Promise<string>((resolve, reject) => {
        xhr.upload.onprogress = (e) => { if (e.lengthComputable) setProgress(8 + (e.loaded / e.total) * 72); };
        xhr.onload = () => {
          setProgress(88);
          try {
            const data = JSON.parse(xhr.responseText);
            if (xhr.status >= 200 && xhr.status < 300) resolve(data.study_id);
            else reject(new Error(data.error ?? "Upload failed"));
          } catch { reject(new Error("Unexpected server response")); }
        };
        xhr.onerror = () => reject(new Error("Network error during upload"));
      });
      xhr.open("POST", "/api/upload");
      xhr.send(fd);

      if (drafts.length > 0) {
        setState("validating");
        const symRes = await fetch(`/api/studies/${encodeURIComponent(studyId)}/symptoms`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symptoms: drafts.map((d) => ({ ...d, free_text: d.free_text || null })) }),
        });
        if (!symRes.ok) {
          const j = await symRes.json().catch(() => ({}));
          throw new Error(j.error === "Invalid symptoms" ? "One or more symptoms were invalid." : "Failed to save symptoms");
        }
      }

      setProgress(100);
      router.push(`/processing?study=${encodeURIComponent(studyId)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState("idle");
    }
  }

  const qc = [
    { label: "Format", ok: !!file && /\.(jpe?g|png|webp)$/i.test(file.name), pending: !file, detail: file ? (file.type || "unknown") : "—" },
    { label: "Resolution", ok: !!previewDims && previewDims.w >= 512 && previewDims.h >= 512, pending: !previewDims, detail: previewDims ? `${previewDims.w}×${previewDims.h}` : "—" },
    { label: "File size", ok: !!file && file.size <= 25 * 1024 * 1024, pending: !file, detail: file ? `${(file.size / 1024).toFixed(0)} KB` : "—" },
  ];

  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      {/* Horizontal workflow indicator */}
      <div className="stepper" aria-label="Workflow progress">
        <div className={`step ${step >= 1 ? (step > 1 ? "done" : "current") : ""}`} aria-current={step === 1 ? "step" : undefined}>
          <span className="step-dot">{step > 1 ? "✓" : "1"}</span>
          <span className="step-label">Patient Context</span>
        </div>
        <div className={`step-line ${step > 1 ? "done" : ""}`} aria-hidden="true" />
        <div className={`step ${step === 2 ? "current" : ""}`} aria-current={step === 2 ? "step" : undefined}>
          <span className="step-dot">2</span>
          <span className="step-label">Scan Upload</span>
        </div>
        <div className="step-line" aria-hidden="true" />
        <div className="step">
          <span className="step-dot">3</span>
          <span className="step-label">Analysis</span>
        </div>
      </div>

      {step === 1 && (
        <div>
          <h1>Patient Context</h1>
          <p className="muted small" style={{ marginTop: 0 }}>
            Capture symptoms before reviewing the scan. Symptoms provide <strong>context only</strong> — they never
            create imaging findings and never produce diagnoses. Optional.
          </p>

          {flagged.length > 0 && (
            <div className="alert danger" role="alert">
              <span className="alert-icon" aria-hidden="true">⚠</span>
              <div className="alert-body">
                <strong>URGENT SYMPTOM</strong>
                {flagged.map((f) => <div key={f.type}>{RED_FLAG_MESSAGES[f.type] ?? labelOf(f.type)}</div>)}
                Prompt ophthalmic assessment is recommended. If vision loss is sudden or severe, seek immediate
                professional care — do not wait for this analysis. No diagnosis is implied.
              </div>
            </div>
          )}

          <div className="card" style={{ marginTop: 12 }}>
            {GROUPS.map((g) => (
              <div key={g.title} style={{ marginBottom: 14 }}>
                <div className="stat-label" style={{ marginBottom: 7 }}>{g.title}</div>
                <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                  {g.items.map(([type, label]) => {
                    const selected = drafts.some((d) => d.type === type);
                    return (
                      <button key={type} className={`chip${selected ? " selected" : ""}`} onClick={() => toggleSymptom(type)} aria-pressed={selected}>
                        {RED_FLAG_TYPES.has(type) && <span className="chip-flag" aria-hidden="true">⚠</span>}
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {drafts.length > 0 && (
            <div className="card" style={{ marginTop: 14 }}>
              <h3>Selected symptoms ({drafts.length})</h3>
              {drafts.map((d) => (
                <div key={d.type} style={{ borderTop: "1px solid var(--border)", paddingTop: 10, marginTop: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <strong className="small">{labelOf(d.type)}{RED_FLAG_TYPES.has(d.type) && <span style={{ color: "var(--danger)" }}> ⚠</span>}</strong>
                    <span style={{ display: "flex", gap: 6 }}>
                      <button className="btn ghost sm" onClick={() => setExpanded(expanded === d.type ? null : d.type)}>
                        {expanded === d.type ? "Collapse" : "Details"}
                      </button>
                      <button className="btn ghost sm" onClick={() => toggleSymptom(d.type)} aria-label={`Remove ${labelOf(d.type)}`}>Remove</button>
                    </span>
                  </div>
                  {expanded === d.type ? (
                    <div className="grid grid-2" style={{ marginTop: 10 }}>
                      <div className="field"><label>Onset</label>
                        <select value={d.onset} onChange={(e) => updateDraft(d.type, { onset: e.target.value as SymptomDraft["onset"] })}>
                          <option value="sudden">Suddenly</option>
                          <option value="gradual">Gradually</option>
                          <option value="unknown">Unknown</option>
                        </select>
                      </div>
                      <div className="field"><label>Duration</label>
                        <select value={d.duration} onChange={(e) => updateDraft(d.type, { duration: e.target.value })}>
                          {DURATIONS.map((v) => <option key={v} value={v}>{v.replaceAll("_", " ")}</option>)}
                        </select>
                      </div>
                      <div className="field"><label>Eye</label>
                        <select value={d.laterality} onChange={(e) => updateDraft(d.type, { laterality: e.target.value as SymptomDraft["laterality"] })}>
                          <option value="right">Right</option>
                          <option value="left">Left</option>
                          <option value="both">Both</option>
                          <option value="unknown">Unknown</option>
                        </select>
                      </div>
                      <div className="field"><label>Severity</label>
                        <select value={d.severity} onChange={(e) => updateDraft(d.type, { severity: e.target.value as SymptomDraft["severity"] })}>
                          <option value="mild">Mild</option>
                          <option value="moderate">Moderate</option>
                          <option value="severe">Severe</option>
                        </select>
                      </div>
                      <div className="field"><label>Progression</label>
                        <select value={d.progression} onChange={(e) => updateDraft(d.type, { progression: e.target.value })}>
                          {["stable", "worsening", "improving", "unknown"].map((v) => <option key={v} value={v}>{v}</option>)}
                        </select>
                      </div>
                      <div className="field"><label>Frequency</label>
                        <select value={d.frequency} onChange={(e) => updateDraft(d.type, { frequency: e.target.value })}>
                          {["constant", "intermittent", "unknown"].map((v) => <option key={v} value={v}>{v}</option>)}
                        </select>
                      </div>
                      <div className="field" style={{ gridColumn: "1 / -1" }}>
                        <label>Description (optional)</label>
                        <textarea rows={2} value={d.free_text} onChange={(e) => updateDraft(d.type, { free_text: e.target.value })} placeholder="Free-text description (stored with the study record)" />
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 5 }}>
                      <Badge tone="neutral">{d.onset}</Badge>
                      <Badge tone="neutral">{d.duration.replaceAll("_", " ")}</Badge>
                      <Badge tone={d.severity === "severe" ? "warn" : "neutral"}>{d.severity}</Badge>
                      <Badge tone="neutral">{d.laterality === "right" ? "OD" : d.laterality === "left" ? "OS" : d.laterality}</Badge>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
            <button className="btn" onClick={() => setStep(2)}>Continue to Scan Upload →</button>
            <button className="btn ghost" onClick={() => { setDrafts([]); setStep(2); }}>Skip symptoms</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div>
          <h1>Scan Upload</h1>
          <p className="muted small" style={{ marginTop: 0 }}>Upload an ophthalmic image.</p>

          {drafts.length > 0 && (
            <div className="card" style={{ marginBottom: 14, padding: "12px 16px" }}>
              <div className="card-title" style={{ marginBottom: 8 }}>
                <h3 style={{ fontSize: "0.88rem" }}>Patient context</h3>
                <button className="btn ghost sm" onClick={() => setStep(1)}>Edit Symptoms</button>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {drafts.map((d) => (
                  <span key={d.type} className={`badge ${RED_FLAG_TYPES.has(d.type) ? "bad" : "neutral"}`}>
                    {labelOf(d.type)} • {d.onset} • {d.laterality === "right" ? "OD" : d.laterality === "left" ? "OS" : d.laterality}
                  </span>
                ))}
              </div>
            </div>
          )}

          {!file ? (
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
              <div className="dz-icon"><Icon name="upload" size={26} /></div>
              <strong>Drag &amp; drop scan here</strong>
              <p style={{ margin: "6px 0 10px" }} className="small">or</p>
              <button className="btn secondary sm" type="button" onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}>Browse Files</button>
              <p className="tiny" style={{ marginTop: 14, color: "var(--text-3)", marginBottom: 0 }}>
                Fundus · OCT · Supported image formats (JPEG, PNG, WEBP) · max 25 MB · DICOM detected but not analyzable
              </p>
            </div>
          ) : (
            <div className="card">
              <div className="card-title"><h3>Scan preview</h3><button className="btn ghost sm" onClick={() => pick(null)}>Remove</button></div>
              <div style={{ display: "grid", gridTemplateColumns: "150px 1fr", gap: 16, alignItems: "start" }}>
                {previewUrl
                  ? // eslint-disable-next-line @next/next/no-img-element
                  <img src={previewUrl} alt="Selected scan preview" style={{ width: 150, height: 112, objectFit: "cover", borderRadius: 8, border: "1px solid var(--border)", background: "#000" }} />
                  : <div style={{ width: 150, height: 112, borderRadius: 8, background: "#000", display: "flex", alignItems: "center", justifyContent: "center", color: "#8b95a1" }} className="tiny">DICOM detected</div>}
                <div className="kv" style={{ gridTemplateColumns: "90px 1fr" }}>
                  <dt>Filename</dt><dd className="small" style={{ wordBreak: "break-all" }}>{file.name}</dd>
                  <dt>Resolution</dt><dd className="small">{previewDims ? `${previewDims.w}×${previewDims.h}` : "—"}</dd>
                  <dt>File type</dt><dd className="small">{file.type || "unknown"}</dd>
                  <dt>SHA-256</dt><dd className="tiny muted" style={{ wordBreak: "break-all", fontFamily: "var(--mono)" }}>{fileHash ? fileHash.slice(0, 24) + "…" : "computing…"}</dd>
                </div>
              </div>
              <div style={{ marginTop: 14 }}>
                <div className="stat-label" style={{ marginBottom: 5 }}>Quality check (pre-upload, research signal)</div>
                {qc.map((q) => (
                  <div className="qc-row" key={q.label}>
                    <span>{q.label} <span className="tiny muted">{q.detail}</span></span>
                    <span className={`qc-check ${q.pending ? "pending" : q.ok ? "pass" : "fail"}`}>{q.pending ? "—" : q.ok ? "● OK" : "● Check"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <input
            ref={inputRef} type="file" hidden
            accept=".jpg,.jpeg,.png,.webp,.dcm,image/jpeg,image/png,image/webp"
            onChange={(e) => pick(e.target.files?.[0] ?? null)}
          />

          {file && (
            <div className="card" style={{ marginTop: 14 }}>
              <div className="grid grid-2">
                <div className="field" style={{ margin: 0 }}>
                  <label htmlFor="scanType">Scan type</label>
                  <select id="scanType" value={scanType} onChange={(e) => setScanType(e.target.value)} disabled={state !== "idle"}>
                    {[["unknown", "Auto-detect"], ["fundus", "Fundus photograph"], ["retinal_photo", "Retinal photograph"], ["oct", "OCT"], ["octa", "OCT-A"], ["faf", "Fundus autofluorescence"], ["ffa", "Fluorescein angiography"], ["icg", "ICG angiography"], ["slit_lamp", "Slit-lamp image"], ["external_eye", "External eye photograph"], ["optic_nerve", "Optic nerve image"], ["macula", "Macula image"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Eye</label>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {[["OD", "Right"], ["OS", "Left"], ["both", "Both"], ["unknown", "Unknown"]].map(([v, l]) => (
                      <button key={v} className={`chip${eye === v ? " selected" : ""}`} onClick={() => setEye(v)} aria-pressed={eye === v} disabled={state !== "idle"}>{l}</button>
                    ))}
                  </div>
                </div>
              </div>
              <details className="tech" style={{ marginTop: 8 }}>
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
            </div>
          )}

          {error && <div className="alert danger" style={{ marginTop: 12 }}><span className="alert-icon" aria-hidden="true">⚠</span><div className="alert-body"><strong>Upload failed</strong>{error}</div></div>}

          {(state === "uploading" || state === "validating") && (
            <div style={{ marginTop: 14 }} aria-live="polite">
              <div className="meter"><div style={{ width: `${progress}%` }} /></div>
              <p className="small muted" style={{ marginBottom: 0 }}>{state === "uploading" ? "UPLOADING…" : "VALIDATING…"}</p>
            </div>
          )}

          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 18, flexWrap: "wrap" }}>
            <button className="btn" onClick={submit} disabled={!file || state !== "idle"}>
              {state === "idle" ? "Continue to Analysis →" : state === "uploading" ? "Uploading…" : "Validating…"}
            </button>
            <button className="btn ghost" onClick={() => setStep(1)} disabled={state !== "idle"}>← Back to Patient Context</button>
            <span className="tiny muted">Original preserved unchanged (SHA-256) on D:.</span>
          </div>
        </div>
      )}
    </div>
  );
}
