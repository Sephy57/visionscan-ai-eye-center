import { NextRequest, NextResponse } from "next/server";
import { analyzeStudy } from "@/lib/studies/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { study_id } = await req.json();
    if (typeof study_id !== "string" || study_id.length === 0) {
      return NextResponse.json({ error: "study_id required" }, { status: 400 });
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
