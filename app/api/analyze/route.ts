import { NextRequest, NextResponse } from "next/server";
import { analyzeStudy } from "@/lib/studies/service";
import { enqueueAnalysis } from "@/lib/jobs/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST { study_id, async?: true }
 *  - async: enqueue a job and return { job_id } immediately (UI polls /api/jobs/:id).
 *  - default: synchronous execution (used by tests/smoke).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const study_id = body?.study_id;
    if (typeof study_id !== "string" || study_id.length === 0) {
      return NextResponse.json({ error: "study_id required" }, { status: 400 });
    }
    if (body?.async === true) {
      const job = await enqueueAnalysis(study_id);
      return NextResponse.json({ study_id, job_id: job.job_id, status: job.status });
    }
    const { analysis, report } = await analyzeStudy(study_id);
    return NextResponse.json({
      study_id,
      analysis_id: `anl_${study_id}`,
      report_id: report.report_id,
      overall_result: report.overall_result,
      triage_priority: report.triage_priority,
      quality: analysis.quality,
      findings_count: analysis.findings.length,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 400 });
  }
}
