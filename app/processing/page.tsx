"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { PageHeader, StatePanel, shortId } from "@/components/ui";
import { authFetch } from "@/lib/auth/clientFetch";

/**
 * The analysis job's real server stages, in order (lib/studies/service.ts
 * analyzeStudy checkpoints). A stage is shown as passed ONLY if the server
 * reported it or a later stage; the conditional linked-record routing stage
 * is shown as "not observed" unless it was actually reported.
 */
const PIPELINE_STAGES: Array<{ stage: string; title: string; desc: string }> = [
  { stage: "queued", title: "Queued", desc: "Durable job created; waiting for a worker lease" },
  { stage: "preparing", title: "Study preparation", desc: "Worker claimed the job and loaded study metadata" },
  { stage: "validating_source", title: "Input validation", desc: "Immutable original loaded and bound to its SHA-256" },
  { stage: "routing_assets", title: "Linked record routing", desc: "Only when PDF records are linked: bounded OCT regions re-hashed before admission" },
  { stage: "running_inference", title: "Quality / domain gates & local model execution", desc: "Quality, modality, and out-of-distribution gates, then eligible research models" },
  { stage: "persisting_analysis", title: "Evidence assembly", desc: "Schema-validated analysis and provenance persisted" },
  { stage: "generating_report", title: "Report generation", desc: "Specialist/condition reasoning and a version-frozen research report" },
];
const STAGE_INDEX: Record<string, number> = Object.fromEntries(PIPELINE_STAGES.map((s, i) => [s.stage, i]));

interface Job {
  job_id: string; study_id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  attempts: number; error?: string;
  progress?: { stage: string; percent: number; completed_units: number; total_units: number; message: string; updated_at: string };
}

function ProcessingInner() {
  const router = useRouter();
  const params = useSearchParams();
  const study = params.get("study") ?? "";
  const resumeJobId = params.get("job");
  const [jobStatus, setJobStatus] = useState<"requesting" | "queued" | "running">("requesting");
  const [jobId, setJobId] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [progress, setProgressState] = useState<Job["progress"] | null>(null);
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const [completed, setCompleted] = useState(false);
  function setProgress(p: Job["progress"] | undefined) {
    if (!p) return;
    setProgressState(p);
    setSeen((prev) => (prev.has(p.stage) ? prev : new Set(prev).add(p.stage)));
  }

  useEffect(() => {
    if (!study) { setFailed("No study id supplied. Start from the Analyze page."); return; }
    let cancelled = false;
    (async () => {
      try {
        // A retry resumes its existing job id. Only a brand-new visit creates
        // a job, preventing refresh/retry from duplicating work or audit rows.
        let activeJobId = resumeJobId;
        if (!activeJobId) {
          const res = await authFetch("/api/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ study_id: study, async: true }),
          });
          const data = await res.json();
          if (cancelled) return;
          if (!res.ok) throw new Error(data.error ?? "Could not start analysis");
          if (typeof data.job_id !== "string" || data.job_id.length === 0) throw new Error("Analysis job response did not include a job id");
          activeJobId = data.job_id;
          window.history.replaceState({}, "", `/processing?study=${encodeURIComponent(study)}&job=${encodeURIComponent(data.job_id)}`);
        }
        if (!activeJobId) throw new Error("Analysis job id is unavailable");
        const polledJobId = activeJobId;
        setJobId(activeJobId);
        setJobStatus("queued");

        // Poll job status, with a bound so a stuck job surfaces an error instead of spinning forever.
        const pollDeadline = Date.now() + 120_000;
        for (;;) {
          if (cancelled) return;
          if (Date.now() > pollDeadline) throw new Error("Analysis is taking longer than expected. The job may be stuck — please retry.");
          await new Promise((r) => setTimeout(r, 900));
          const jr = await fetch(`/api/jobs/${encodeURIComponent(polledJobId)}`);
          if (!jr.ok) throw new Error("Lost contact with the analysis job.");
          const job: Job = await jr.json();
          if (job.progress) setProgress(job.progress);
          if (job.status === "running") setJobStatus("running");
          if (job.status === "completed") {
            if (cancelled) return;
            setCompleted(true);
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
  }, [study, resumeJobId, router]);

  // Non-pipeline stages (cancellation_requested, stale, retryable) keep the last known position.
  const lastSeenIndex = Math.max(0, ...Array.from(seen).map((st) => STAGE_INDEX[st] ?? 0));
  const currentIndex = completed ? PIPELINE_STAGES.length
    : progress ? (STAGE_INDEX[progress.stage] ?? lastSeenIndex)
    : jobStatus === "requesting" ? -1 : 0;
  const failedIndex = failed ? Math.max(0, currentIndex) : -1;
  const stageState = (i: number): "done" | "current" | "failed" | "unreported" | "pending" => {
    const stage = PIPELINE_STAGES[i].stage;
    if (failed && i === failedIndex) return "failed";
    // The server checkpoints every stage in order, but a 900 ms poll can miss
    // short ones: a later reported stage proves they passed. Only record
    // routing is conditional (skipped when no PDF is linked), so it alone is
    // left as "not observed" unless it was actually seen.
    if (i < currentIndex) return seen.has(stage) || stage !== "routing_assets" ? "done" : "unreported";
    if (i === currentIndex && !failed) return "current";
    return "pending";
  };
  const STATE_TEXT = { done: "Passed", current: "In progress", failed: "Stopped", unreported: "Not observed", pending: "Pending" } as const;

  const pipeline = (
    <ol className="pipeline" aria-label="Analysis pipeline stages reported by the server">
      {PIPELINE_STAGES.map((s, i) => {
        const st = stageState(i);
        return (
          <li key={s.stage} className={st} aria-current={st === "current" ? "step" : undefined}>
            <span className="pl-node" aria-hidden="true">{st === "done" ? <Icon name="check" size={14} /> : st === "failed" ? <Icon name="x" size={14} /> : String(i + 1).padStart(2, "0")}</span>
            <div>
              <div className="pl-title">{s.title}</div>
              <div className="pl-desc">{st === "current" && progress?.message ? progress.message : s.desc}</div>
            </div>
            <span className="pl-state">{STATE_TEXT[st]}</span>
          </li>
        );
      })}
    </ol>
  );

  if (failed) {
    return (
      <div style={{ maxWidth: 820, margin: "0 auto" }}>
        <PageHeader eyebrow="Analysis pipeline" eyebrowTone="warn" title="Analysis failed" lede={<>Study <code>{shortId(study, 24)}</code>{jobId ? <> · Job <code>{shortId(jobId, 24)}</code></> : null}</>} />
        <StatePanel
          tone="danger" icon="warning" title="The analysis could not be completed" role="alert"
          what={failed}
          why="Possible causes: unsupported format, image quality below the gate, missing consent, study not found, or the analysis service is unavailable."
          next="No result was generated — nothing partial or synthetic is shown after a failure. Retry the same job, or acquire a new scan."
          actions={<>
            {jobId && (
              <button
                className="btn"
                onClick={async () => {
                  setFailed(null);
                  setJobStatus("queued");
                  const idempotencyKey = crypto.randomUUID();
                  const retryResponse = await authFetch(`/api/jobs/${encodeURIComponent(jobId)}`, {
                    method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
                    body: JSON.stringify({ idempotency_key: idempotencyKey }),
                  });
                  const retryBody = await retryResponse.json().catch(() => ({}));
                  if (!retryResponse.ok) { setFailed(retryBody.error ?? "Retry could not be started"); return; }
                  window.location.assign(`/processing?study=${encodeURIComponent(study)}&job=${encodeURIComponent(jobId)}`);
                }}
              >
                <Icon name="reset" size={14} /> Retry job
              </button>
            )}
            <Link className="btn secondary" href="/analyze">Request new scan</Link>
            <Link className="btn ghost" href="/dashboard">Return to Dashboard</Link>
          </>}
        />
        {progress && <div className="card" style={{ marginTop: 16 }}><div className="card-kicker" style={{ marginBottom: 8 }}>Last reported pipeline state</div>{pipeline}</div>}
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 820, margin: "0 auto" }}>
      <PageHeader
        eyebrow="Analysis pipeline"
        title={completed ? "Analysis complete" : "Analyzing study"}
        lede={<>Study <code>{shortId(study, 24)}</code>{jobId ? <> · Job <code>{shortId(jobId, 24)}</code></> : null}</>}
      />
      <div className="card" style={{ padding: 24 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
          <span className="small" style={{ fontWeight: 650, display: "inline-flex", alignItems: "center", gap: 10 }} aria-live="polite">
            {completed ? <Icon name="check" size={16} /> : <span className="pulse-dot" aria-hidden="true" />}
            {completed ? "Result ready — opening the results workspace" : jobStatus === "requesting" ? "Requesting analysis job" : jobStatus === "queued" ? "Analysis job queued" : "Analysis job running"}
          </span>
          <span className="tiny muted num" aria-live="polite">{progress ? `${progress.percent}% of workflow reported by server` : "Waiting for first server progress report"}</span>
        </div>
        <div className="meter" aria-hidden="true"><div style={{ width: `${progress?.percent ?? 0}%` }} /></div>
        <div style={{ marginTop: 18 }}>{pipeline}</div>
        <p className="tiny muted" style={{ margin: "14px 0 0" }}>
          Stage states come from server-side job checkpoints. The percentage describes workflow completion, never model
          confidence. Linked record routing runs only when a PDF is attached; if this view never observed it, it is marked “Not observed”.
        </p>
        {jobId && (jobStatus === "queued" || jobStatus === "running") && !completed && (
          <button className="btn secondary" style={{ marginTop: 16 }} onClick={async () => {
            const response = await authFetch(`/api/jobs/${encodeURIComponent(jobId)}`, {
              method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cancel" }),
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) { setFailed(body.error ?? "Cancellation could not be requested"); return; }
            setProgress(body.progress);
          }}>Cancel analysis</button>
        )}
      </div>
    </div>
  );
}

export default function ProcessingPage() {
  return (
    <Suspense fallback={<div className="page-loading" role="status"><span className="spinner" aria-hidden="true" />Loading analysis job…</div>}>
      <ProcessingInner />
    </Suspense>
  );
}
