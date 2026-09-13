import { NextRequest, NextResponse } from "next/server";
import { analyzeStudy } from "@/lib/studies/service";
import { enqueueAnalysis } from "@/lib/jobs/queue";
import { requireRole } from "@/lib/auth/rbac";
import { requireStudyScope } from "@/lib/auth/scope";
import { checkProcessingConsent, consentRequiredPayload, PROCESSING_CONSENT_PURPOSES } from "@/lib/consent/policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST { study_id, async?: true }
 *  - async: enqueue a job and return { job_id } immediately (UI polls /api/jobs/:id).
 *  - default: synchronous execution (used by tests/smoke).
 */
export async function POST(req: NextRequest) {
  const denied = await requireRole(req, ["ADMIN", "CLINICIAN", "TECHNICIAN"]);
  if (denied) return denied;
  try {
    const body = await req.json();
    const study_id = body?.study_id;
    if (typeof study_id !== "string" || study_id.length === 0) {
      return NextResponse.json({ error: "study_id required" }, { status: 400 });
    }
    const scoped = await requireStudyScope(req, study_id);
    if (scoped.response) return scoped.response;
    if (!scoped.resource) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const consent = await checkProcessingConsent(study_id, PROCESSING_CONSENT_PURPOSES.imageModelAnalysis);
    if (!consent.ok) return NextResponse.json(consentRequiredPayload(consent), { status: 403 });
    if (body?.async === true) {
      const job = await enqueueAnalysis(study_id);
      return NextResponse.json({ study_id, job_id: job.job_id, status: job.status });
    }
    const { analysis, report } = await analyzeStudy(study_id);
    return NextResponse.json({
      study_id,
      analysis_id: report.analysis_id,
      report_id: report.report_id,
      overall_result: report.overall_result,
      triage_priority: report.triage_priority,
      quality: analysis.quality,
      findings_count: analysis.findings.length,
      // Keep the summary endpoint honest and machine-auditable; consumers do
      // not have to infer DEMO/RESEARCH state from a prose result string.
      analysis_mode: analysis.analysis_mode,
      model_execution: analysis.model_execution,
      asset_routing: analysis.asset_routing,
    });
  } catch (err) {
    // Do not expose exception messages, filesystem paths, model details, or
    // persistence internals to a caller. The persisted research result and
    // server-side diagnostics remain the source of truth for investigation.
    void err;
    return NextResponse.json({ error: "ANALYSIS_FAILED", message: "Analysis could not be completed." }, { status: 500 });
  }
}
