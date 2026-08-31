"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const STAGES = [
  "Validating upload & preserving original scan",
  "Device & image identification",
  "Image quality / artifact check",
  "Out-of-distribution & operating-condition check",
  "Anatomical structure detection",
  "Registered model analysis",
  "Ensemble & consistency check",
  "Uncertainty estimation",
  "Clinical rule engine & triage",
  "Safety validation",
  "Report generation",
];

function ProcessingInner() {
  const router = useRouter();
  const params = useSearchParams();
  const study = params.get("study") ?? "";
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!study) { setError("No study id supplied. Start from the Analyze page."); return; }
    let cancelled = false;
    const tick = setInterval(() => setStep((s) => Math.min(s + 1, STAGES.length - 2)), 420);

    (async () => {
      try {
        // Timeout guard: if the server is unreachable or the request hangs,
        // fail visibly instead of spinning forever.
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 60000);
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ study_id: study }),
          signal: controller.signal,
        });
        clearTimeout(timer);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error ?? "Analysis failed");
        setStep(STAGES.length);
        setTimeout(() => router.replace(`/result?study=${encodeURIComponent(study)}`), 450);
      } catch (e) {
        if (!cancelled) {
          clearInterval(tick);
          setError(
            e instanceof DOMException && e.name === "AbortError"
              ? "The analysis request timed out. The server may not be running or is unreachable."
              : e instanceof Error ? e.message : String(e)
          );
        }
      }
    })();

    return () => { cancelled = true; clearInterval(tick); };
  }, [study, router]);

  if (error) {
    return (
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        <h1>Analysis could not be completed</h1>
        <div className="alert danger"><span className="alert-icon" aria-hidden="true">⚠</span><div className="alert-body"><strong>We were unable to process this scan</strong>{error}. No results are shown after an error — never partial or fake medical output.</div></div>
        <p className="small muted">Possible causes:</p>
        <ul className="small muted">
          <li>Unsupported format (only JPEG, PNG, WEBP are analyzable; DICOM is detected but not yet analyzable)</li>
          <li>Image quality below the analysis threshold</li>
          <li>Processing error</li>
          <li>Study not found</li>
        </ul>
        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <a className="btn" href="/analyze">Try Again</a>
          <a className="btn secondary" href="/dashboard">Return to Dashboard</a>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 640, margin: "0 auto" }}>
      <h1>Analyzing your scan</h1>
      <p className="muted small">Study <code>{study}</code></p>
      <div className="card" style={{ padding: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
          <span className="pulse-dot" aria-hidden="true" />
          <span className="small" style={{ fontWeight: 650 }} aria-live="polite">
            {step < STAGES.length ? STAGES[step] : "Complete — opening result"}
          </span>
        </div>
        <ul className="state-steps">
          {STAGES.map((s, i) => (
            <li key={s} className={i < step ? "done" : i === step ? "active" : ""}>
              <span className="step-dot" aria-hidden="true">{i < step ? "✓" : i + 1}</span>
              {s}
            </li>
          ))}
        </ul>
        <p className="tiny muted" style={{ marginBottom: 0 }}>
          The progress display reflects the real pipeline stages. It does not imply that a validated medical model
          is processing this image — current analysis runs in demo mode with labeled synthetic output.
        </p>
      </div>
    </div>
  );
}

export default function ProcessingPage() {
  return (
    <Suspense fallback={<div className="spinner" />}>
      <ProcessingInner />
    </Suspense>
  );
}
