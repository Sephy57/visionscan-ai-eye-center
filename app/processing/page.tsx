"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { authFetch } from "@/lib/auth/clientFetch";

const EXPECTED_STAGES = [
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
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  attempts: number; error?: string;
}

function ProcessingInner() {
  const router = useRouter();
  const params = useSearchParams();
  const study = params.get("study") ?? "";
  const [jobStatus, setJobStatus] = useState<"requesting" | "queued" | "running">("requesting");
  const [jobId, setJobId] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (!study) { setFailed("No study id supplied. Start from the Analyze page."); return; }
    let cancelled = false;
    (async () => {
      try {
        // Async mode: enqueue a job and poll — keeps inference off the UI request path.
        const res = await authFetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ study_id: study, async: true }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error ?? "Could not start analysis");
        setJobId(data.job_id);
        setJobStatus("queued");

        // Poll job status, with a bound so a stuck job surfaces an error instead of spinning forever.
        const pollDeadline = Date.now() + 120_000;
        for (;;) {
          if (cancelled) return;
          if (Date.now() > pollDeadline) throw new Error("Analysis is taking longer than expected. The job may be stuck — please retry.");
          await new Promise((r) => setTimeout(r, 900));
          const jr = await fetch(`/api/jobs/${encodeURIComponent(data.job_id)}`);
          if (!jr.ok) throw new Error("Lost contact with the analysis job.");
          const job: Job = await jr.json();
          if (job.status === "running") setJobStatus("running");
          if (job.status === "completed") {
            if (cancelled) return;
            setTimeout(() => router.replace(`/result?study=${encodeURIComponent(study)}`), 400);
            return;
          }
          if (job.status === "failed") {
            if (cancelled) return;
            setFailed(job.error ?? "Model inference could not be completed.");
            return;
          }
          if (job.status === "cancelled") {
            if (cancelled) return;
            setFailed("Analysis was cancelled before a result was generated.");
            return;
          }
        }
      } catch (e) {
        if (!cancelled) {
          setFailed(e instanceof Error ? e.message : String(e));
        }
      }
    })();

    return () => { cancelled = true; };
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
                setJobStatus("queued");
                await authFetch(`/api/jobs/${encodeURIComponent(jobId)}`, {
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
            {jobStatus === "requesting" ? "Requesting analysis job" : jobStatus === "queued" ? "Analysis job queued" : "Analysis job running"}
          </span>
        </div>
        <ul className="state-steps" aria-label="Expected analysis pipeline sequence">
          {EXPECTED_STAGES.map((s, i) => (
            <li key={s}>
              <span className="step-dot-2" aria-hidden="true">{i + 1}</span>
              {s}
            </li>
          ))}
        </ul>
        <p className="tiny muted" style={{ marginBottom: 0 }}>
          The server currently reports job-level queued/running/completed status, not per-stage completion. The list
          above is the expected pipeline sequence and no checkmark or percentage is shown until the server confirms a result.
          Analysis runs as a background job so the interface stays responsive.
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
