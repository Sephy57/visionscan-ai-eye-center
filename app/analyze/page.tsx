"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Badge, PageHeader } from "@/components/ui";
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
  // Single staged workspace (01 study → 05 analyze). Symptom context stays
  // optional: patients are never blocked on it.
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
  const [imageAnalysisConsent, setImageAnalysisConsent] = useState(false);
  const [clinicalResearchConsent, setClinicalResearchConsent] = useState(false);
  const [documentExtractionConsent, setDocumentExtractionConsent] = useState(false);
  const [state, setState] = useState<"idle" | "uploading" | "validating">("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Optional clinical record attachment. It is extracted automatically after
  // upload; the clinician review workspace preserves UNREVIEWED provenance.
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfStatus, setPdfStatus] = useState<"idle" | "uploading" | "uploaded" | "duplicate" | "rejected" | "error">("idle");
  const [pdfMessage, setPdfMessageState] = useState<string | null>(null);
  const pdfMessageRef = useRef<string | null>(null);
  const setPdfMessage = (m: string | null) => { pdfMessageRef.current = m; setPdfMessageState(m); };
  const pdfInputRef = useRef<HTMLInputElement>(null);
  // Set when the image study was created but the attached PDF was rejected, so
  // the user can continue without re-uploading (avoids a duplicate study).
  const [createdStudyId, setCreatedStudyId] = useState<string | null>(null);

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

  async function grantProcessingConsent(studyId: string, purpose: "IMAGE_MODEL_ANALYSIS" | "CLINICAL_RESEARCH_ANALYSIS" | "DOCUMENT_EXTRACTION") {
    const response = await authFetch(`/api/studies/${encodeURIComponent(studyId)}/consent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ purpose, consentType: "explicit", subjectRef: patientRef || undefined }),
    });
    const payload = await response.json().catch(() => ({} as Record<string, unknown>));
    if (!response.ok) {
      const code = String(payload.error ?? "CONSENT_RECORD_FAILED");
      throw new Error(code === "CONSENT_SUBJECT_MISMATCH"
        ? "Consent could not be bound to this study identifier. Check the pseudonymous reference and try again."
        : `Could not record ${purpose === "IMAGE_MODEL_ANALYSIS" ? "image analysis" : purpose === "CLINICAL_RESEARCH_ANALYSIS" ? "specialist research" : "document extraction"} consent (${code}).`);
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
    // A different image means a new study; the earlier one stays in history.
    setCreatedStudyId(null);
    setFileHash(null);
    setPreviewDims(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
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

  /** Retry only the attachment on the study that was already created (no duplicate study). */
  async function retryPdf() {
    if (!createdStudyId || !pdfFile) return;
    if (!documentExtractionConsent) { setError("Explicit DOCUMENT_EXTRACTION consent is required when a PDF is attached."); return; }
    setState("validating");
    setError(null);
    try {
      // DOCUMENT_EXTRACTION consent was recorded for this study by the first submit.
      if (await uploadPdf(createdStudyId)) {
        router.push(`/processing?study=${encodeURIComponent(createdStudyId)}`);
        return;
      }
      setError(`The PDF document was rejected: ${pdfMessageRef.current ?? "validation failed"}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setState("idle");
  }

  async function submit() {
    if (!file) { setError("Please choose an image file (JPEG, PNG, WEBP)."); return; }
    if (!imageAnalysisConsent) {
      setError("Explicit IMAGE_MODEL_ANALYSIS consent is required before local processing can start.");
      return;
    }
    if (!clinicalResearchConsent) {
      setError("Explicit CLINICAL_RESEARCH_ANALYSIS consent is required before specialist evidence synthesis can start.");
      return;
    }
    if (pdfFile && !documentExtractionConsent) {
      setError("Explicit DOCUMENT_EXTRACTION consent is required when a PDF is attached.");
      return;
    }
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

      // Record purpose-specific consent after the study is server-bound, so
      // the API can verify the canonical subject identity before any durable
      // processing job is enqueued.
      await grantProcessingConsent(studyId, "IMAGE_MODEL_ANALYSIS");
      await grantProcessingConsent(studyId, "CLINICAL_RESEARCH_ANALYSIS");
      if (pdfFile) await grantProcessingConsent(studyId, "DOCUMENT_EXTRACTION");

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
        setError(`Image uploaded, but the PDF document was rejected: ${pdfMessageRef.current ?? "validation failed"}`);
        setCreatedStudyId(studyId);
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
  const busy = state !== "idle";
  const consentsReady = imageAnalysisConsent && clinicalResearchConsent && (!pdfFile || documentExtractionConsent);
  const pdfBlocked = pdfStatus === "rejected";
  const SCAN_TYPES: Array<[string, string]> = [["unknown", "Auto-detect (server routing)"], ["fundus", "Fundus photograph"], ["retinal_photo", "Retinal photograph"], ["oct", "OCT"], ["octa", "OCT-A"], ["faf", "Fundus autofluorescence"], ["ffa", "Fluorescein angiography"], ["icg", "ICG angiography"], ["slit_lamp", "Slit-lamp image"], ["external_eye", "External eye photograph"], ["optic_nerve", "Optic nerve image"], ["macula", "Macula image"]];
  const scanTypeLabel = SCAN_TYPES.find(([v]) => v === scanType)?.[1] ?? scanType;
  const eyeText = eye === "OD" ? "Right (OD)" : eye === "OS" ? "Left (OS)" : eye === "both" ? "Both (OU)" : "Not specified";

  const rail: Array<{ id: string; n: string; label: string; state: "done" | "attention" | "pending"; text: string }> = [
    { id: "intake-study", n: "01", label: "Patient / study", state: patientRef ? "done" : "pending", text: patientRef ? "Linked" : "Optional" },
    { id: "intake-input", n: "02", label: "Input data", state: file ? (qc.some((q) => !q.pending && !q.ok) || pdfBlocked ? "attention" : "done") : "pending", text: file ? (pdfBlocked ? "PDF rejected" : qc.some((q) => !q.pending && !q.ok) ? "Check" : "Ready") : "Required" },
    { id: "intake-context", n: "03", label: "Clinical context", state: flagged.length ? "attention" : drafts.length ? "done" : "pending", text: flagged.length ? "Red flag" : drafts.length ? `${drafts.length} symptom(s)` : "Optional" },
    { id: "intake-review", n: "04", label: "Review & consent", state: consentsReady ? "done" : "pending", text: consentsReady ? "Authorized" : "Required" },
    { id: "intake-analyze", n: "05", label: "Analyze", state: busy ? "attention" : "pending", text: busy ? (state === "uploading" ? "Uploading" : "Validating") : "Not started" },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="New analysis · Intake"
        title="Prepare a research analysis"
        lede="Attach imaging and optional records, add clinical context, authorize processing, then hand off to the analysis pipeline. Quality and provenance stay visible at every step."
        actions={<><Badge tone="demo">Research only</Badge><Badge tone="warn">Clinician review required</Badge></>}
      />

      <div className="analyze-layout">
        <div className="analyze-form">
          {/* 01 — Patient / study */}
          <section className="card intake-section" id="intake-study" aria-labelledby="intake-study-title">
            <div className="intake-head">
              <span className="intake-num">01</span>
              <div><h2 id="intake-study-title">Patient / study</h2><p>Link the study to a pseudonymous patient reference. Never use real names.</p></div>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="patientRef">Patient / study identifier (optional — pseudonymous code only)</label>
              <input id="patientRef" value={patientRef} onChange={(e) => setPatientRef(e.target.value)} placeholder="e.g. VS-2026-0001" maxLength={64} disabled={busy} />
              <div className="field-hint">Consent is bound to this reference server-side. Manage registered patients in <Link href="/patients">Patients</Link>.</div>
            </div>
          </section>

          {/* 02 — Input data */}
          <section className="card intake-section" id="intake-input" aria-labelledby="intake-input-title">
            <div className="intake-head">
              <span className="intake-num">02</span>
              <div><h2 id="intake-input-title">Upload records and scan</h2><p>One ophthalmic image (required) and an optional PDF record. The server re-validates everything.</p></div>
            </div>

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
                <div className="dz-icon" aria-hidden="true"><Icon name="scan" size={24} /></div>
                <strong>Drop an ophthalmic image here</strong>
                <p className="small" style={{ margin: "2px 0 12px" }}>Fundus, retinal, or OCT B-scan exported as an image</p>
                <button className="btn secondary sm" type="button" onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}><Icon name="upload" size={14} /> Browse files</button>
                <div className="dz-formats" id="scan-upload-formats">
                  <span>JPEG</span><span>PNG</span><span>WEBP</span><span>≤ 25 MB</span><span>DICOM detected · not analyzable</span>
                </div>
              </div>
            ) : (
              <div>
                <div className="card-title">
                  <span className="card-kicker"><Icon name="eye" size={13} /> Imaging input</span>
                  <button className="btn ghost sm" onClick={() => pick(null)} disabled={busy}>Remove</button>
                </div>
                <div className="file-card">
                  {previewUrl
                    ? <img className="file-thumb" src={previewUrl} alt="Selected scan preview" />
                    : <div className="file-thumb"><span>DICOM detected</span></div>}
                  <dl className="file-meta">
                    <div><dt>File</dt><dd>{file.name}</dd></div>
                    <div><dt>Type</dt><dd>{file.type || "unknown"}</dd></div>
                    <div><dt>Size</dt><dd className="num">{(file.size / 1024).toFixed(0)} KB</dd></div>
                    <div><dt>Resolution</dt><dd className="num">{previewDims ? `${previewDims.w}×${previewDims.h}` : "—"}</dd></div>
                    <div><dt>Modality</dt><dd>{scanType === "unknown" ? "Not declared — routed server-side" : `${scanTypeLabel} (declared)`}</dd></div>
                    <div><dt>Laterality</dt><dd>{eyeText}</dd></div>
                    <div style={{ gridColumn: "1 / -1" }}><dt>SHA-256 (client)</dt><dd className="mono">{fileHash ? fileHash.slice(0, 32) + "…" : "computing…"}</dd></div>
                  </dl>
                </div>
                <div className="qc-list" aria-label="Pre-upload checks">
                  {qc.map((q) => (
                    <div className="qc-row" key={q.label}>
                      <span>{q.label} <span className="tiny muted">{q.detail}</span></span>
                      <span className={`qc-check ${q.pending ? "pending" : q.ok ? "pass" : "fail"}`}>{q.pending ? "Pending" : q.ok ? <><Icon name="check" size={12} /> OK</> : <><Icon name="warning" size={12} /> Check</>}</span>
                    </div>
                  ))}
                </div>
                <p className="tiny muted" style={{ margin: "8px 0 0" }}>Pre-upload checks are a research signal only. The server repeats integrity, modality, quality, and out-of-distribution gates.</p>

                <div className="grid grid-2" style={{ marginTop: 16 }}>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="scanType">Scan type</label>
                    <select id="scanType" value={scanType} onChange={(e) => setScanType(e.target.value)} disabled={busy}>
                      {SCAN_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <span className="field-label" id="eye-label">Eye</span>
                    <div role="group" aria-labelledby="eye-label" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {[["OD", "Right (OD)"], ["OS", "Left (OS)"], ["both", "Both"], ["unknown", "Unknown"]].map(([v, l]) => (
                        <button key={v} type="button" className={`chip${eye === v ? " selected" : ""}`} onClick={() => setEye(v)} aria-pressed={eye === v} disabled={busy}>{l}</button>
                      ))}
                    </div>
                  </div>
                </div>
                <details className="disclosure" style={{ marginTop: 14 }}>
                  <summary>Optional device information — only metadata you provide is stored; nothing is invented</summary>
                  <div className="grid grid-3">
                    <div className="field">
                      <label htmlFor="manufacturer">Device manufacturer</label>
                      <input id="manufacturer" value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} placeholder="e.g. Zeiss" disabled={busy} />
                    </div>
                    <div className="field">
                      <label htmlFor="deviceModel">Device model</label>
                      <input id="deviceModel" value={deviceModel} onChange={(e) => setDeviceModel(e.target.value)} placeholder="e.g. Visucam 524" disabled={busy} />
                    </div>
                    <div className="field">
                      <label htmlFor="scanDateTime">Scan date/time</label>
                      <input id="scanDateTime" type="datetime-local" value={scanDateTime} onChange={(e) => setScanDateTime(e.target.value)} disabled={busy} />
                    </div>
                  </div>
                </details>
              </div>
            )}
            <input
              ref={inputRef} type="file" hidden
              accept=".jpg,.jpeg,.png,.webp,.dcm,image/jpeg,image/png,image/webp"
              onChange={(e) => pick(e.target.files?.[0] ?? null)}
            />

            <div className="divider" />
            {/* Optional PDF record (ingestion + security validation; extraction is automatic). */}
            <div className="card-title">
              <span className="card-kicker"><Icon name="document" size={13} /> Clinical record (optional PDF)</span>
              {pdfFile && <button className="btn ghost sm" onClick={() => pickPdf(null)} disabled={busy}>Remove</button>}
            </div>
            {!pdfFile ? (
              <div className="dropzone compact">
                <button className="btn secondary sm" type="button" onClick={() => pdfInputRef.current?.click()} disabled={busy}>
                  <Icon name="upload" size={14} /> Attach PDF
                </button>
                <p className="tiny muted" style={{ margin: "8px 0 0", maxWidth: 520 }}>
                  Ophthalmic report or test result (PDF, max 25 MB). Validated for dangerous content, stored immutably, and
                  extracted automatically. Extracted facts remain unreviewed until a clinician verifies them.
                </p>
              </div>
            ) : (
              <dl className="file-meta">
                <div><dt>File</dt><dd>{pdfFile.name}</dd></div>
                <div><dt>Size</dt><dd className="num">{(pdfFile.size / 1024).toFixed(0)} KB</dd></div>
                <div><dt>Validation</dt><dd>
                  <span className={`badge ${pdfStatus === "uploaded" ? "ok" : pdfStatus === "duplicate" ? "info" : pdfStatus === "idle" || pdfStatus === "uploading" ? "neutral" : "bad"}`}>
                    {pdfStatus === "idle" ? "Pending upload" : pdfStatus === "uploading" ? "Uploading…" : pdfStatus.toUpperCase()}
                  </span>
                </dd></div>
                {pdfMessage && <div style={{ gridColumn: "1 / -1" }}><dt>Detail</dt><dd className="small muted">{pdfMessage}</dd></div>}
              </dl>
            )}
            <input
              ref={pdfInputRef} type="file" hidden
              accept=".pdf,application/pdf"
              onChange={(e) => pickPdf(e.target.files?.[0] ?? null)}
            />
          </section>

          {/* 03 — Clinical context */}
          <section className="card intake-section" id="intake-context" aria-labelledby="intake-context-title">
            <div className="intake-head">
              <span className="intake-num">03</span>
              <div><h2 id="intake-context-title">Optional patient context</h2><p>Structured symptoms are correlated with imaging <strong>after</strong> the model runs. They never create findings or diagnoses.</p></div>
              <Badge tone="neutral">Optional</Badge>
            </div>

            {flagged.length > 0 && (
              <div className="alert danger" role="alert">
                <span className="alert-icon" aria-hidden="true"><Icon name="warning" size={16} /></span>
                <div className="alert-body">
                  <strong>URGENT SYMPTOM</strong>
                  {flagged.map((f) => <div key={f.type}>{RED_FLAG_MESSAGES[f.type] ?? labelOf(f.type)}</div>)}
                  Prompt ophthalmic assessment is recommended. If vision loss is sudden or severe, seek immediate
                  professional care — do not wait for this analysis. No diagnosis is implied.
                </div>
              </div>
            )}

            {GROUPS.map((g) => (
              <div key={g.title} style={{ marginBottom: 14 }}>
                <div className="stat-label" style={{ marginBottom: 7 }} id={`group-${g.title}`}>{g.title}</div>
                <div role="group" aria-labelledby={`group-${g.title}`} style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {g.items.map(([type, label]) => {
                    const selected = drafts.some((d) => d.type === type);
                    return (
                      <button key={type} type="button" className={`chip${selected ? " selected" : ""}`} onClick={() => toggleSymptom(type)} aria-pressed={selected} disabled={busy}>
                        {RED_FLAG_TYPES.has(type) && <span className="chip-flag" aria-label="red-flag symptom">⚠</span>}
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            {drafts.length > 0 && (
              <div style={{ marginTop: 6 }}>
                <div className="stat-label" style={{ marginBottom: 4 }}>Selected symptoms ({drafts.length})</div>
                {drafts.map((d) => (
                  <div key={d.type} style={{ borderTop: "1px solid var(--border)", paddingTop: 10, marginTop: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <strong className="small">{labelOf(d.type)}{RED_FLAG_TYPES.has(d.type) && <span style={{ color: "var(--danger)" }}> ⚠ red flag</span>}</strong>
                      <span style={{ display: "flex", gap: 6 }}>
                        <button type="button" className="btn ghost sm" onClick={() => setExpanded(expanded === d.type ? null : d.type)} aria-expanded={expanded === d.type}>
                          {expanded === d.type ? "Collapse" : "Details"}
                        </button>
                        <button type="button" className="btn ghost sm" onClick={() => toggleSymptom(d.type)} aria-label={`Remove ${labelOf(d.type)}`}>Remove</button>
                      </span>
                    </div>
                    {expanded === d.type ? (
                      <div className="grid grid-3" style={{ marginTop: 10 }}>
                        <div className="field"><label htmlFor={`${d.type}-onset`}>Onset</label>
                          <select id={`${d.type}-onset`} value={d.onset} onChange={(e) => updateDraft(d.type, { onset: e.target.value as SymptomDraft["onset"] })}>
                            <option value="sudden">Suddenly</option>
                            <option value="gradual">Gradually</option>
                            <option value="unknown">Unknown</option>
                          </select>
                        </div>
                        <div className="field"><label htmlFor={`${d.type}-duration`}>Duration</label>
                          <select id={`${d.type}-duration`} value={d.duration} onChange={(e) => updateDraft(d.type, { duration: e.target.value })}>
                            {DURATIONS.map((v) => <option key={v} value={v}>{v.replaceAll("_", " ")}</option>)}
                          </select>
                        </div>
                        <div className="field"><label htmlFor={`${d.type}-eye`}>Eye</label>
                          <select id={`${d.type}-eye`} value={d.laterality} onChange={(e) => updateDraft(d.type, { laterality: e.target.value as SymptomDraft["laterality"] })}>
                            <option value="right">Right</option>
                            <option value="left">Left</option>
                            <option value="both">Both</option>
                            <option value="unknown">Unknown</option>
                          </select>
                        </div>
                        <div className="field"><label htmlFor={`${d.type}-severity`}>Severity</label>
                          <select id={`${d.type}-severity`} value={d.severity} onChange={(e) => updateDraft(d.type, { severity: e.target.value as SymptomDraft["severity"] })}>
                            <option value="mild">Mild</option>
                            <option value="moderate">Moderate</option>
                            <option value="severe">Severe</option>
                          </select>
                        </div>
                        <div className="field"><label htmlFor={`${d.type}-progression`}>Progression</label>
                          <select id={`${d.type}-progression`} value={d.progression} onChange={(e) => updateDraft(d.type, { progression: e.target.value })}>
                            {["stable", "worsening", "improving", "unknown"].map((v) => <option key={v} value={v}>{v}</option>)}
                          </select>
                        </div>
                        <div className="field"><label htmlFor={`${d.type}-frequency`}>Frequency</label>
                          <select id={`${d.type}-frequency`} value={d.frequency} onChange={(e) => updateDraft(d.type, { frequency: e.target.value })}>
                            {["constant", "intermittent", "unknown"].map((v) => <option key={v} value={v}>{v}</option>)}
                          </select>
                        </div>
                        <div className="field" style={{ gridColumn: "1 / -1" }}>
                          <label htmlFor={`${d.type}-text`}>Description (optional)</label>
                          <textarea id={`${d.type}-text`} rows={2} value={d.free_text} onChange={(e) => updateDraft(d.type, { free_text: e.target.value })} placeholder="Free-text description (stored with the study record)" />
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
          </section>

          {/* 04 — Review & consent */}
          <section className="card intake-section" id="intake-review" aria-labelledby="intake-review-title">
            <div className="intake-head">
              <span className="intake-num">04</span>
              <div><h2 id="intake-review-title">Review &amp; purpose-specific consent</h2><p>Confirm what will be submitted. Each processing purpose is authorized explicitly for this study only.</p></div>
            </div>
            <dl className="file-meta" style={{ marginBottom: 16 }}>
              <div><dt>Patient reference</dt><dd>{patientRef || "None (unlinked study)"}</dd></div>
              <div><dt>Image</dt><dd>{file ? file.name : <span style={{ color: "var(--warning)" }}>Not selected</span>}</dd></div>
              <div><dt>Declared modality · eye</dt><dd>{scanTypeLabel} · {eyeText}</dd></div>
              <div><dt>PDF record</dt><dd>{pdfFile ? pdfFile.name : "None"}</dd></div>
              <div><dt>Symptoms</dt><dd>{drafts.length ? `${drafts.length} structured${flagged.length ? ` · ${flagged.length} red flag` : ""}` : "None reported"}</dd></div>
            </dl>
            <label className="consent-choice">
              <input type="checkbox" checked={imageAnalysisConsent} onChange={(e) => setImageAnalysisConsent(e.target.checked)} disabled={busy} />
              <span>
                <strong>Authorize IMAGE_MODEL_ANALYSIS for this study</strong>
                <span className="tiny muted">Required to run the local research model. This is explicit consent for this study only; results remain unvalidated and require clinician review.</span>
              </span>
            </label>
            <label className="consent-choice">
              <input type="checkbox" checked={clinicalResearchConsent} onChange={(e) => setClinicalResearchConsent(e.target.checked)} disabled={busy} />
              <span>
                <strong>Authorize CLINICAL_RESEARCH_ANALYSIS for specialist review</strong>
                <span className="tiny muted">Required for multi-specialist evidence synthesis and condition-gating surfaces. It produces research hand-offs only; it never confirms a diagnosis.</span>
              </span>
            </label>
            {pdfFile && (
              <label className="consent-choice">
                <input type="checkbox" checked={documentExtractionConsent} onChange={(e) => setDocumentExtractionConsent(e.target.checked)} disabled={busy} />
                <span>
                  <strong>Authorize DOCUMENT_EXTRACTION for the attached PDF</strong>
                  <span className="tiny muted">Required to extract candidate facts. Extracted text remains unreviewed until a clinician verifies it.</span>
                </span>
              </label>
            )}
          </section>

          {/* 05 — Analyze */}
          <section className="card intake-section" id="intake-analyze" aria-labelledby="intake-analyze-title">
            <div className="intake-head">
              <span className="intake-num">05</span>
              <div><h2 id="intake-analyze-title">Analyze</h2><p>Uploads the original unchanged (SHA-256 recorded), records consent, and starts the server-side pipeline.</p></div>
            </div>

            {error && (
              <div className="alert danger" role="alert">
                <span className="alert-icon" aria-hidden="true"><Icon name="warning" size={16} /></span>
                <div className="alert-body">
                  <strong>{createdStudyId ? "Study created — attachment rejected" : "Upload could not start"}</strong>{error}
                  {createdStudyId && (
                    <div className="state-actions">
                      <button type="button" className="btn sm" onClick={() => router.push(`/processing?study=${encodeURIComponent(createdStudyId)}`)}>Continue analysis without the PDF</button>
                      {pdfFile && pdfStatus === "idle" && (
                        <button type="button" className="btn secondary sm" onClick={retryPdf} disabled={busy}>Attach “{pdfFile.name}” to this study</button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {busy && (
              <div style={{ marginBottom: 14 }} aria-live="polite">
                <div className="meter" role="progressbar" aria-label={state === "uploading" ? "Scan upload progress" : "Upload validation progress"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)} aria-valuetext={`${Math.round(progress)}% ${state}`}><div style={{ width: `${progress}%` }} /></div>
                <p className="small muted" style={{ marginBottom: 0 }}>{state === "uploading" ? "Uploading original scan (byte progress reported by the browser)…" : "Recording consent, symptoms, and attachments…"}</p>
              </div>
            )}

            <div className="analyze-actions" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button className="btn lg" onClick={submit} disabled={!file || busy || !!createdStudyId}>
                {state === "idle" ? <>Continue to Analysis <Icon name="arrowRight" size={15} /></> : state === "uploading" ? "Uploading…" : "Validating…"}
              </button>
              <span className="tiny muted">{!file ? "Select an image in step 02 to continue." : !consentsReady ? "Consent in step 04 is required before processing." : "Ready — the pipeline runs as a background job."}</span>
            </div>
          </section>
        </div>

        <aside className="analyze-rail" aria-label="Intake progress and guardrails">
          <nav className="card" aria-label="Intake steps">
            <div className="card-kicker" style={{ marginBottom: 10 }}><Icon name="clipboard" size={13} /> Intake progress</div>
            <ol className="workflow-rail">
              {rail.map((r) => (
                <li key={r.id} className={r.state === "pending" ? undefined : r.state}>
                  <a href={`#${r.id}`}>
                    <span className="wf-num">{r.state === "done" ? <Icon name="check" size={12} /> : r.n}</span>
                    <span>{r.label}</span>
                    <span className="wf-state">{r.text}</span>
                  </a>
                </li>
              ))}
            </ol>
          </nav>
          <div className="card">
            <div className="card-kicker" style={{ marginBottom: 10 }}><Icon name="shield" size={13} /> Guardrails</div>
            <ul className="tiny muted" style={{ margin: 0, paddingLeft: 16, display: "grid", gap: 6 }}>
              <li>Server re-checks integrity, modality, quality, and domain before any model runs.</li>
              <li>Original files are preserved unchanged.</li>
              <li>Symptoms and records stay separate from image evidence.</li>
              <li>Output is research-only and requires clinician review.</li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
