"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Icon } from "@/components/icons";

const STAGES = [
  "File integrity verified (SHA-256)",
  "Image quality assessed",
  "Modality & device compatibility checked",
  "Out-of-distribution screening",
  "Model inference",
  "Output schema & safety validation",
  "Symptom correlation",
  "Triage & report preparation",
];

interface Job {
  job_id: string; study_id: string;
  status: "queued" | "running" | "completed" | "failed";
  attempts: number; error?: string;
}

function ProcessingInner() {
  const router = useRouter();
  const params = useSearchParams();
  const study = params.get("study") ?? "";
  const [step, setStep] = useState(0);
  const [jobId, setJobId] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (!study) { setFailed("No study id supplied. Start from the Analyze page."); return; }
    let cancelled = false;
    const tick = setInterval(() => setStep((s) => Math.min(s + 1, STAGES.length - 2)), 700);

    (async () => {
      try {
        // Async mode: enqueue a job and poll — keeps inference off the UI request path.
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ study_id: study, async: true }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error ?? "Could not start analysis");
        setJobId(data.job_id);

        // Poll job status
        for (;;) {
          if (cancelled) return;
          await new Promise((r) => setTimeout(r, 900));
          const jr = await fetch(`/api/jobs/${encodeURIComponent(data.job_id)}`);
          if (!jr.ok) throw new Error("Lost contact with the analysis job.");
          const job: Job = await jr.json();
          if (job.status === "completed") {
            if (cancelled) return;
            clearInterval(tick);
            setStep(STAGES.length);
            setTimeout(() => router.replace(`/result?study=${encodeURIComponent(study)}`), 400);
            return;
          }
          if (job.status === "failed") {
            if (cancelled) return;
            clearInterval(tick);
            setFailed(job.error ?? "Model inference could not be completed.");
            return;
          }
        }
      } catch (e) {
        if (!cancelled) {
          clearInterval(tick);
          setFailed(e instanceof Error ? e.message : String(e));
        }
      }
    })();

    return () => { cancelled = true; clearInterval(tick); };
  }, [study, router]);

  if (failed) {
    return (
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        <h1>Analysis failed</h1>
        <div className="alert danger">
          <span className="alert-icon" aria-hidden="true">⚠</span>
          <div className="alert-body">
            <strong>The analysis could not be completed</strong>
            Reason: {failed}
            <div className="small muted" style={{ marginTop: 6 }}>
              No result has been generated. Nothing partial or synthetic is shown after a failure.
            </div>
          </div>
        </div>
        <p className="small muted">Possible causes: unsupported format, image quality below threshold, study not found, or the analysis service is unavailable.</p>
        <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
          {jobId && (
            <button
              className="btn"
              onClick={async () => {
                setFailed(null);
                setStep(0);
                await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, {
                  method: "POST", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ requested_by: "user" }),
                });
                // Retry re-triggers polling via page refresh of job state
                router.refresh();
                window.location.reload();
              }}
            >
              <Icon name="reset" size={13} /> Retry
            </button>
          )}
          <Link className="btn secondary" href="/analyze">Request New Scan</Link>
          <Link className="btn secondary" href="/dashboard">Return to Dashboard</Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 640, margin: "0 auto" }}>
      <div className="stat-label">VisionScan Analysis</div>
      <h1 style={{ marginBottom: 2 }}>Analyzing scan</h1>
      <p className="muted small">Study <code>{study}</code>{jobId ? <> · Job <code>{jobId}</code></> : null}</p>
      <div className="card" style={{ padding: 24, marginTop: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
          <span className="pulse-dot" aria-hidden="true" />
          <span className="small" style={{ fontWeight: 650 }} aria-live="polite">
            {step < STAGES.length ? STAGES[step] : "Complete — opening result"}
          </span>
        </div>
        <ul className="state-steps">
          {STAGES.map((s, i) => (
            <li key={s} className={i < step ? "done" : i === step ? "active" : ""}>
              <span className="step-dot-2" aria-hidden="true">{i < step ? "✓" : i + 1}</span>
              {s}
            </li>
          ))}
        </ul>
        <p className="tiny muted" style={{ marginBottom: 0 }}>
          Stage-based progress — no fake percentages. The stages reflect the real pipeline; the analysis runs as a
          background job so the interface stays responsive.
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
