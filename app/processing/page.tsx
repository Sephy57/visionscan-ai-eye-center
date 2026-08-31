"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const STEPS = [
  "Upload received - preserving original scan",
  "Device & image identification",
  "Image quality / artifact check",
  "Anatomical structure detection",
  "Abnormality detection",
  "Measurement & quantification",
  "Differential / possible findings",
  "Severity & risk assessment",
  "Confidence & uncertainty check",
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
    const tick = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 2)), 450);

    (async () => {
      try {
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ study_id: study }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error ?? "Analysis failed");
        setStep(STEPS.length - 1);
        setTimeout(() => router.replace(`/result?study=${encodeURIComponent(study)}`), 500);
      } catch (e) {
        if (!cancelled) { setError(e instanceof Error ? e.message : String(e)); clearInterval(tick); }
      }
    })();

    return () => { cancelled = true; clearInterval(tick); };
  }, [study, router]);

  if (error) {
    return (
      <div>
        <h1>Analysis could not complete</h1>
        <div className="callout danger">{error}</div>
        <a className="btn" href="/analyze">Return to upload</a>
      </div>
    );
  }

  return (
    <div>
      <h1>Analyzing scan</h1>
      <p className="muted">Study <code>{study}</code></p>
      <div className="spinner" />
      <ul className="steps">
        {STEPS.map((s, i) => (
          <li key={s} className={i < step ? "done" : i === step ? "active" : ""}>
            {i < step ? "✓ " : ""}{s}
          </li>
        ))}
      </ul>
      <p className="small muted">
        Note: analysis runs synchronously for this development build; the step display is indicative.
      </p>
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
