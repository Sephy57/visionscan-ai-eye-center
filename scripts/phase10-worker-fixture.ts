/**
 * PHI-free fixture/inspection helper for the Phase 10 real worker harness.
 * The parent process supplies all storage roots, so this helper never touches
 * the developer's configured D: data store.
 */

import fs from "node:fs";
import { createStudy } from "../lib/studies/service";
import { recordConsent } from "../lib/consent/consent";
import { enqueueAnalysis } from "../lib/jobs/queue";
import { dbAll, closeDatabase } from "../lib/storage/db";
import { readJson } from "../lib/storage/files";
import { inspectResourceLeases, reapExpiredResourceLeases, resourceLeaseConfigFromEnv } from "../lib/runtime";

const mode = process.argv[2] ?? "";
const sourceImage = process.env.PHASE10_SOURCE_IMAGE;
const targetStudyId = process.env.PHASE10_STUDY_ID;

try {
  if (mode === "seed") {
    if (!sourceImage) throw new Error("PHASE10_SOURCE_IMAGE is required");
    const bytes = fs.readFileSync(sourceImage);
    const study = await createStudy(
      "phase10-synthetic-fundus.jpg",
      "image/jpeg",
      bytes,
      { scanType: "fundus", eye: "OD", providedBy: "none" },
      "phase10-synthetic-subject",
      "phase10-harness",
      false,
    );
    await recordConsent({
      studyId: study.study_id,
      purpose: "IMAGE_MODEL_ANALYSIS",
      consentType: "specific",
      status: "GRANTED",
      actor: "phase10-harness",
    });
    const job = await enqueueAnalysis(study.study_id);
    console.log(JSON.stringify({ study_id: study.study_id, job_id: job.job_id }));
  } else if (mode === "inspect") {
    if (!targetStudyId) throw new Error("PHASE10_STUDY_ID is required");
    const jobs = (await dbAll<any>("jobs")).filter((job) => job.study_id === targetStudyId);
    const effects = (await dbAll<any>("job_effects")).filter((effect) => effect.study_id === targetStudyId);
    const analyses = (await dbAll<any>("analyses")).filter((analysis) => analysis.study_id === targetStudyId);
    const evidence = (await dbAll<any>("evidence")).filter((row) => row.study_id === targetStudyId);
    const reasoning = (await dbAll<any>("reasoning_records")).filter((row) => row.study_id === targetStudyId);
    const reports = (await dbAll<any>("reports")).filter((row) => row.study_id === targetStudyId);
    const latestJob = jobs.sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))[0] ?? null;
    const report = reports.find((row) => row.report_id === latestJob?.report_id) ?? reports[0] ?? null;
    const reportExport = report?.report_id ? await readJson("reports", report.report_id) : null;
    const resourceLeases = await inspectResourceLeases({ config: resourceLeaseConfigFromEnv() }).catch(() => null);
    const effectCounts = Object.fromEntries(
      ["MODEL_RESULT", "STRUCTURED_EVIDENCE", "REASONING_RECORD", "REPORT", "JOB_COMPLETION"].map((type) => [
        type,
        effects.filter((effect) => effect.effect_type === type).length,
      ]),
    );
    console.log(JSON.stringify({
      study_id: targetStudyId,
      job: latestJob ? {
        job_id: latestJob.job_id,
        status: latestJob.status,
        attempts: latestJob.attempts,
        retry_count: latestJob.retry_count ?? null,
        error: latestJob.error ?? null,
        progress: latestJob.progress ?? null,
        deadline_outcome: latestJob.deadline_outcome ?? null,
        resource_reservation_state: latestJob.resource_reservation_state ?? null,
        resource_rejection_reason: latestJob.resource_rejection_reason ?? null,
      } : null,
      counts: {
        jobs: jobs.length,
        analyses: analyses.length,
        evidence: evidence.length,
        reasoning_records: reasoning.length,
        reports: reports.length,
        effects: effects.length,
      },
      effect_counts: effectCounts,
      effect_records: effects.map((effect) => ({
        effect_id: effect.effect_id,
        effect_type: effect.effect_type,
        canonical_id: effect.canonical_id,
        job_id: effect.job_id ?? null,
        attempt_id: effect.attempt_id ?? null,
        payload_sha256: effect.payload_sha256 ?? null,
      })),
      resource_leases: resourceLeases ? {
        active_leases: resourceLeases.activeLeases,
        reserved_memory_bytes: resourceLeases.reserved.memoryBytes,
        reserved_threads: resourceLeases.reserved.threads,
        max_active_leases: resourceLeases.maxActiveLeases,
      } : null,
      report_sealed: Boolean(report?.version_freeze && report?.reasoning_snapshot),
      report_export_present: Boolean(reportExport),
      analysis_ledger_rows: analyses.reduce((sum, row) => sum + (Array.isArray(row.result?.model_execution_ledger) ? row.result.model_execution_ledger.length : 0), 0),
      phi_included: false,
    }));
  } else if (mode === "reap") {
    const result = await reapExpiredResourceLeases({ config: resourceLeaseConfigFromEnv() });
    console.log(JSON.stringify({ expired: result.expired, active_leases: result.snapshot.activeLeases, phi_included: false }));
  } else {
    throw new Error(`Unknown fixture mode: ${mode}`);
  }
} finally {
  await closeDatabase();
}
