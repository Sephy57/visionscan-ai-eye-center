"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui";
import { Icon } from "@/components/icons";
import { authFetch, csrfHeader } from "@/lib/auth/clientFetch";

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
      ["chemical_exposure", "Chemical Exposure"], ["severe_pain_with_nausea", "Severe Pain + Nausea"],
    ],
  },
];

const RED_FLAG_TYPES = new Set([
  "sudden_vision_loss", "new_floaters", "flashes_with_field_loss", "curtain_shadow",
  "severe_eye_pain_with_visual_disturbance", "recent_eye_trauma", "trauma_with_vision_loss",
  "chemical_exposure", "severe_pain_with_nausea",
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
  // Upload is the primary workflow. Symptom entry remains available as an
  // optional correction/context step, but patients are never blocked on it.
  const [step, setStep] = useState<1 | 2>(2);
  const [patientRef, setPatientRef] = useState("");
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

  // Optional clinical record attachment. It is extracted automatically after
  // upload; the clinician review workspace preserves UNREVIEWED provenance.
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfStatus, setPdfStatus] = useState<"idle" | "uploading" | "uploaded" | "duplicate" | "rejected" | "error">("idle");
  const [pdfMessage, setPdfMessage] = useState<string | null>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  const flagged = drafts.filter((d) => RED_FLAG_TYPES.has(d.type));
  const allLabels = GROUPS.flatMap((g) => g.items);
  const labelOf = (type: string) => allLabels.find(([t]) => t === type)?.[1] ?? type;

  function pickPdf(f: File | null) {
    setPdfFile(f);
    setPdfStatus("idle");
    setPdfMessage(null);
    if (f) {
      const isPdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name);
      if (!isPdf) {
        setPdfStatus("rejected");
        setPdfMessage("Not a PDF file. Only PDF documents are accepted.");
      } else if (f.size > 25 * 1024 * 1024) {
        setPdfStatus("rejected");
        setPdfMessage("PDF exceeds the 25 MB limit.");
      }
    }
  }

  async function uploadPdf(studyId: string): Promise<boolean> {
    if (!pdfFile) return true;
    setPdfStatus("uploading");
    try {
      const fd = new FormData();
      fd.set("file", pdfFile);
      const res = await authFetch(`/api/studies/${encodeURIComponent(studyId)}/documents`, { method: "POST", body: fd });
      const j = await res.json().catch(() => ({} as Record<string, unknown>));
      if (res.status === 201) {
        const doc = j.document as { page_count?: number; document_id?: string } | undefined;
        setPdfStatus("uploaded");
        if (!doc?.document_id) {
          setPdfStatus("error");
          setPdfMessage("Document was stored, but no extraction target was returned. Review it from the clinician workspace.");
          return true;
        }

        // The upload route queues S2 extraction server-side. Keep a fallback
        // request for older deployments that accepted the document without
        // returning a queue id. Extracted facts remain document-derived and
        // unreviewed; this only removes the manual trigger.
        let extractionJobId = String(j.extraction_job_id ?? "");
        if (!extractionJobId) {
          const extractRes = await authFetch(`/api/documents/${encodeURIComponent(doc.document_id)}/extract`, { method: "POST" });
          const extractJson = await extractRes.json().catch(() => ({} as Record<string, unknown>));
          if (!extractRes.ok && extractRes.status !== 409) {
            setPdfStatus("error");
            setPdfMessage("Document stored, but automatic extraction could not be started. A clinician can retry it from the workspace.");
            return true;
          }
          extractionJobId = String(extractJson.job_id ?? "");
        }
        if (extractionJobId) {
          const deadline = Date.now() + 120_000;
          for (;;) {
            if (Date.now() > deadline) {
              setPdfStatus("error");
              setPdfMessage("Document stored; extraction is still running. Review the extracted evidence when the job completes.");
              return true;
            }
            await new Promise((resolve) => setTimeout(resolve, 700));
            const jr = await authFetch(`/api/jobs/${encodeURIComponent(extractionJobId)}`);
            const job = await jr.json().catch(() => ({} as Record<string, unknown>));
            if (!jr.ok) {
              setPdfStatus("error");
              setPdfMessage("Document stored; extraction status is unavailable. Review the workspace for retry options.");
              return true;
            }
            if (job.status === "completed") break;
            if (job.status === "failed" || job.status === "cancelled") {
              setPdfStatus("error");
              setPdfMessage("Document stored, but automatic extraction failed. No extracted facts were treated as verified.");
              return true;
            }
          }
        }
        setPdfStatus("uploaded");
        setPdfMessage(`Validated and extracted: ${doc.page_count ?? "?"} page(s). Candidate facts are stored with DOCUMENT_EXTRACTED / UNREVIEWED provenance.`);
        return true;
      }
      if (res.status === 200 && j.duplicate) {
        setPdfStatus("duplicate");
        setPdfMessage("An identical document (same SHA-256) already exists for this study; no duplicate was created.");
        return true;
      }
      const errCode = String(j.error ?? "REJECTED");
      setPdfStatus("rejected");
      setPdfMessage(
        errCode === "TOO_LARGE" ? "PDF exceeds the server-side size limit." :
        errCode === "TOO_MANY_PAGES" ? "PDF exceeds the maximum page count." :
        errCode === "UNSAFE_DOCUMENT" ? "Rejected: dangerous embedded content (JavaScript, launch actions, or embedded files) was detected." :
        errCode === "INVALID_DOCUMENT" ? "Rejected: the file is not a valid, unencrypted PDF." :
        "Document was rejected during validation."
      );
      return false;
    } catch {
      setPdfStatus("error");
      setPdfMessage("PDF upload failed (network error).");
      return false;
    }
  }

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
      if (patientRef) fd.set("patientRef", patientRef);
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
        xhr.open("POST", "/api/upload");
        for (const [k, v] of Object.entries(csrfHeader())) xhr.setRequestHeader(k, v);
        xhr.send(fd);
      });

      if (drafts.length > 0) {
        setState("validating");
        const symRes = await authFetch(`/api/studies/${encodeURIComponent(studyId)}/symptoms`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symptoms: drafts.map((d) => ({ ...d, free_text: d.free_text || null })) }),
        });
        if (!symRes.ok) {
          const j = await symRes.json().catch(() => ({}));
          throw new Error(j.error === "Invalid symptoms" ? "One or more symptoms were invalid." : "Failed to save symptoms");
        }
      }

      // S1: attach the optional PDF test result to the created study. A
      // rejected document does NOT block the image analysis, but the user
      // sees the rejection and can retry or continue without it.
      let pdfFailed = false;
      if (pdfFile) {
        setState("validating");
        pdfFailed = !(await uploadPdf(studyId));
      }

      setProgress(100);
      if (pdfFailed) {
        setError(`Image uploaded, but the PDF document was rejected: ${pdfMessage}`);
        setState("idle");
        return;
      }
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
        <span className="sr-only">Step {step} of 3: {step === 1 ? "Patient context" : "Scan upload"}</span>
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
          <h1>Optional Patient Context</h1>
          <p className="muted small" style={{ marginTop: 0 }}>
            Add or correct structured symptoms if you already have them. This step is optional: uploaded records are
            analyzed automatically and their symptoms are extracted for clinician review.
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

          <div className="card" style={{ marginTop: 14, padding: "12px 16px" }}>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="patientRef">Patient / study identifier (optional — use a pseudonymous code, never real names)</label>
              <input id="patientRef" value={patientRef} onChange={(e) => setPatientRef(e.target.value)} placeholder="e.g. VS-2026-0001" maxLength={64} />
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
            <button className="btn" onClick={() => setStep(2)}>Continue to Scan Upload →</button>
            <button className="btn ghost" onClick={() => { setDrafts([]); setStep(2); }}>Skip optional context</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div>
          <h1>Upload records and scan</h1>
          <p className="muted small" style={{ marginTop: 0 }}>Upload an ophthalmic image and, optionally, a clinical record. Record extraction starts automatically after upload.</p>

          <div className="card" style={{ marginBottom: 14, padding: "12px 16px" }}>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="patientRefPrimary">Patient / study identifier (optional — use a pseudonymous code, never real names)</label>
              <input id="patientRefPrimary" value={patientRef} onChange={(e) => setPatientRef(e.target.value)} placeholder="e.g. VS-2026-0001" maxLength={64} />
            </div>
            <p className="tiny muted" style={{ margin: "8px 0 0" }}>
              <button className="btn ghost sm" type="button" onClick={() => setStep(1)}>Add optional symptom context</button>
            </p>
          </div>

          {drafts.length > 0 && (
            <div className="card" style={{ marginBottom: 14, padding: "12px 16px" }}>
              <div className="card-title" style={{ marginBottom: 8 }}>
                <h3 style={{ fontSize: "0.88rem" }}>Patient context</h3>
                <button className="btn ghost sm" onClick={() => setStep(1)}>Edit Symptoms</button>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {patientRef && <span className="badge info">{patientRef}</span>}
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
              role="group"
              aria-label="Scan upload drop area"
              aria-describedby="scan-upload-formats"
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files?.[0] ?? null); }}
            >
              <div className="dz-icon"><Icon name="upload" size={26} /></div>
              <strong>Drag &amp; drop scan here</strong>
              <p style={{ margin: "6px 0 10px" }} className="small">or</p>
              <button className="btn secondary sm" type="button" onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}>Browse Files</button>
              <p id="scan-upload-formats" className="tiny" style={{ marginTop: 14, color: "var(--text-3)", marginBottom: 0 }}>
                Fundus · OCT · Supported image formats (JPEG, PNG, WEBP) · max 25 MB · DICOM detected but not analyzable
              </p>
            </div>
          ) : (
            <div className="card">
              <div className="card-title"><h3>Scan preview</h3><button className="btn ghost sm" onClick={() => pick(null)}>Remove</button></div>
              <div className="stack-mobile" style={{ display: "grid", gridTemplateColumns: "150px 1fr", gap: 16, alignItems: "start" }}>
                {previewUrl
                  ?
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

          {/* S1: optional PDF test-result attachment (ingestion + security validation only). */}
          <div className="card" style={{ marginTop: 14 }}>
            <div className="card-title">
              <h3 style={{ fontSize: "0.88rem" }}>PDF test result (optional)</h3>
              {pdfFile && <button className="btn ghost sm" onClick={() => pickPdf(null)} disabled={state !== "idle"}>Remove</button>}
            </div>
            {!pdfFile ? (
              <>
                <button className="btn secondary sm" type="button" onClick={() => pdfInputRef.current?.click()} disabled={state !== "idle"}>
                  <Icon name="upload" size={14} /> Upload PDF
                </button>
                <p className="tiny muted" style={{ margin: "8px 0 0" }}>
                  Attach an ophthalmic report or test result (PDF, max 25 MB). It is validated, stored immutably,
                  and analyzed automatically. Extracted facts remain unreviewed until a clinician verifies them.
                </p>
              </>
            ) : (
              <div className="kv" style={{ gridTemplateColumns: "110px 1fr" }}>
                <dt>Filename</dt><dd className="small" style={{ wordBreak: "break-all" }}>{pdfFile.name}</dd>
                <dt>Size</dt><dd className="small">{(pdfFile.size / 1024).toFixed(0)} KB</dd>
                <dt>Status</dt>
                <dd className="small">
                  <span className={`badge ${pdfStatus === "uploaded" ? "ok" : pdfStatus === "duplicate" ? "info" : pdfStatus === "idle" || pdfStatus === "uploading" ? "neutral" : "bad"}`}>
                    {pdfStatus === "idle" ? "Pending upload" : pdfStatus === "uploading" ? "Uploading…" : pdfStatus.toUpperCase()}
                  </span>
                </dd>
                {pdfMessage && <dt>Detail</dt>}
                {pdfMessage && <dd className="tiny muted">{pdfMessage}</dd>}
              </div>
            )}
            <input
              ref={pdfInputRef} type="file" hidden
              accept=".pdf,application/pdf"
              onChange={(e) => pickPdf(e.target.files?.[0] ?? null)}
            />
          </div>

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
              <div className="meter" role="progressbar" aria-label={state === "uploading" ? "Scan upload progress" : "Upload validation progress"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-valuetext={`${progress}% ${state}`}><div style={{ width: `${progress}%` }} /></div>
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
