"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui";

// Mirrors lib/clinical/symptoms.ts vocabulary (kept in sync; validated server-side).
const GROUPS: Array<{ title: string; items: Array<[string, string]> }> = [
  {
    title: "Visual symptoms",
    items: [
      ["blurred_vision", "Blurred Vision"], ["sudden_vision_loss", "Vision Loss"],
      ["reduced_central_vision", "Central Vision"], ["reduced_peripheral_vision", "Peripheral Vision"],
      ["distorted_vision", "Distorted Vision"], ["double_vision", "Double Vision"],
      ["night_vision_difficulty", "Night Vision"], ["reduced_contrast", "Reduced Contrast"],
      ["transient_vision_changes", "Transient Changes"], ["gradual_vision_loss", "Gradual Loss"],
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
    title: "Eye discomfort",
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

export default function AnalyzePage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [drafts, setDrafts] = useState<SymptomDraft[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
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

  const hasRedFlag = drafts.some((d) => RED_FLAG_TYPES.has(d.type));

  function toggleSymptom(type: string) {
    setDrafts((d) => d.some((x) => x.type === type) ? d.filter((x) => x.type !== type) : [...d, newDraft(type)]);
  }
  function updateDraft(type: string, patch: Partial<SymptomDraft>) {
    setDrafts((d) => d.map((x) => x.type === type ? { ...x, ...patch } : x));
  }
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

      // Attach structured symptoms (context only - validated and stored server-side).
      if (drafts.length > 0) {
        setState("validating");
        const symRes = await fetch(`/api/studies/${encodeURIComponent(studyId)}/symptoms`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symptoms: drafts.map((d) => ({ ...d, free_text: d.free_text || null })) }),
        });
        if (!symRes.ok) {
          const j = await symRes.json().catch(() => ({}));
          throw new Error(j.error === "Invalid symptoms" ? "One or more symptoms were invalid: " + JSON.stringify(j.errors) : "Failed to save symptoms");
        }
      }

      setProgress(100);
      setState("validating");
      router.push(`/processing?study=${encodeURIComponent(studyId)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState("idle");
    }
  }

  return (
    <div style={{ maxWidth: 780, margin: "0 auto" }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 18 }} aria-label="Progress">
        {(["Patient Context", "Scan Upload", "Analyze"] as const).map((label, i) => (
          <div key={label} style={{ flex: 1 }}>
            <div style={{ height: 4, borderRadius: 999, background: step > i ? "var(--accent)" : "var(--border)" }} />
            <div className="tiny" style={{ marginTop: 6, fontWeight: 650, color: step > i ? "var(--accent)" : "var(--text-3)" }}>
              {i + 1}. {label}
            </div>
          </div>
        ))}
      </div>

      {step === 1 && (
        <div>
          <h1>What is the patient experiencing?</h1>
          <p className="muted">
            Structured symptoms provide <strong>context</strong> for correlation and safety escalation. Symptoms
            never create imaging findings and never produce diagnoses. This step is optional — you can skip it.
          </p>

          {hasRedFlag && (
            <div className="alert danger" role="alert">
              <span className="alert-icon" aria-hidden="true">⚠</span>
              <div className="alert-body">
                <strong>Urgent review recommended</strong>
                One or more selected symptoms meet safety escalation criteria. The analysis will recommend urgent
                ophthalmic assessment regardless of the imaging result. If vision loss is sudden or severe, seek
                immediate professional care — do not wait for this analysis.
              </div>
            </div>
          )}

          <div className="card" style={{ marginTop: 14 }}>
            {GROUPS.map((g) => (
              <div key={g.title} style={{ marginBottom: 18 }}>
                <div className="nav-section" style={{ padding: "0 0 8px" }}>{g.title}</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {g.items.map(([type, label]) => {
                    const selected = drafts.some((d) => d.type === type);
                    return (
                      <button
                        key={type}
                        className={`btn ${selected ? "" : "secondary"} sm`}
                        onClick={() => toggleSymptom(type)}
                        aria-pressed={selected}
                      >
                        {RED_FLAG_TYPES.has(type) && <span aria-hidden="true">⚠ </span>}{label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {drafts.length > 0 && (
            <div className="card" style={{ marginTop: 16 }}>
              <h3>Selected symptoms ({drafts.length}) — details</h3>
              {drafts.map((d) => (
                <div key={d.type} style={{ borderTop: "1px solid var(--border)", paddingTop: 12, marginTop: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <strong className="small">{GROUPS.flatMap((g) => g.items).find(([t]) => t === d.type)?.[1] ?? d.type}</strong>
                    <button className="btn ghost sm" onClick={() => toggleSymptom(d.type)} aria-label={`Remove ${d.type}`}>Remove</button>
                  </div>
                  {expanded === d.type ? (
                    <div className="grid grid-2" style={{ marginTop: 10 }}>
                      <div className="field"><label>When did it start?</label>
                        <select value={d.onset} onChange={(e) => updateDraft(d.type, { onset: e.target.value as SymptomDraft["onset"] })}>
                          <option value="suddenly_coded" hidden disabled>—</option>
                          <option value="sudden">Suddenly</option>
                          <option value="gradual">Gradually</option>
                          <option value="unknown">Unknown</option>
                        </select>
                      </div>
                      <div className="field"><label>Duration</label>
                        <select value={d.duration} onChange={(e) => updateDraft(d.type, { duration: e.target.value })}>
                          {["less_than_1_hour", "hours", "1_day", "days", "1_week", "weeks", "1_month", "months", "chronic", "unknown"].map((v) => <option key={v} value={v}>{v.replaceAll("_", " ")}</option>)}
                        </select>
                      </div>
                      <div className="field"><label>Which eye?</label>
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
                      <div style={{ gridColumn: "1 / -1" }}>
                        <button className="btn ghost sm" onClick={() => setExpanded(null)}>Collapse</button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 6 }}>
                      <Badge tone="neutral">{d.onset}</Badge>
                      <Badge tone="neutral">{d.duration.replaceAll("_", " ")}</Badge>
                      <Badge tone={d.severity === "severe" ? "warn" : "neutral"}>{d.severity}</Badge>
                      <Badge tone="neutral">{d.laterality === "right" ? "right eye" : d.laterality === "left" ? "left eye" : d.laterality}</Badge>
                      <button className="btn ghost sm" onClick={() => setExpanded(d.type)}>Edit details</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <button className="btn" onClick={() => setStep(2)}>Continue to Scan Analysis →</button>
            <button className="btn ghost" onClick={() => { setDrafts([]); setStep(2); }}>Skip symptoms</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div>
          <h1>Scan upload</h1>

          {drafts.length > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-title">
                <h3>Patient context</h3>
                <button className="btn ghost sm" onClick={() => setStep(1)}>Edit Symptoms</button>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {drafts.map((d) => (
                  <span key={d.type} className={`badge ${RED_FLAG_TYPES.has(d.type) ? "bad" : "neutral"}`}>
                    {GROUPS.flatMap((g) => g.items).find(([t]) => t === d.type)?.[1]} • {d.onset} • {d.laterality === "right" ? "OD" : d.laterality === "left" ? "OS" : d.laterality}
                  </span>
                ))}
              </div>
              {hasRedFlag && <p className="tiny" style={{ color: "var(--danger)", marginBottom: 0 }}>⚠ Contains red-flag symptom(s) — urgent assessment will be recommended.</p>}
            </div>
          )}

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
              ref={inputRef} type="file" hidden
              accept=".jpg,.jpeg,.png,.webp,.dcm,image/jpeg,image/png,image/webp"
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
                      {[["unknown", "Auto / unknown"], ["fundus", "Fundus photograph"], ["retinal_photo", "Retinal photograph"], ["oct", "OCT"], ["octa", "OCT-A"], ["faf", "Fundus autofluorescence"], ["ffa", "Fluorescein angiography"], ["icg", "ICG angiography"], ["slit_lamp", "Slit-lamp image"], ["external_eye", "External eye photograph"], ["optic_nerve", "Optic nerve image"], ["macula", "Macula image"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
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
              <button className="btn ghost" onClick={() => setStep(1)} disabled={state !== "idle"}>← Back to symptoms</button>
              <span className="tiny muted">Original file preserved unchanged (SHA-256) on D:.</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
