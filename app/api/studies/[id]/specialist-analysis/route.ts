import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { requireStudyScope } from "@/lib/auth/scope";
import { buildStructuredClinicalEvidence } from "@/lib/evidence/structuredClinicalEvidence";
import { DeterministicReasoningEngine } from "@/lib/models/reasoningEngine";
import type { AnalysisResult } from "@/lib/analysis/schema";
import { dbGet } from "@/lib/storage/db";
import { getReasoningRecordForAnalysis, persistReasoningRecord } from "@/lib/reports/reasoningRecord";
import type { ClinicalReport } from "@/lib/reports/generator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Opt-in specialist routing/consensus view. This endpoint may execute the
 * isolated research capability when its own quality, OOD, and artifact gates
 * allow it; it never writes an analysis record and never turns research
 * output into a diagnosis. The independent triage result remains the urgency
 * authority.
 */
export function GET(req: NextRequest, context: { params: { id: string } }): Promise<NextResponse>;
export function GET(req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse>;
export async function GET(req: NextRequest, { params }: { params: { id: string } | Promise<{ id: string }> }) {
  params = await params;
  const denied = await requireRole(req, ["ADMIN", "CLINICIAN", "REVIEWER"]);
  if (denied) return denied;
  const scoped = await requireStudyScope(req, params.id);
  if (scoped.response) return scoped.response;
  if (!scoped.resource) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const analysisRecord = await dbGet<{ result: AnalysisResult }>("analyses", `anl_${params.id}`);
  if (analysisRecord?.result) {
    const persisted = await getReasoningRecordForAnalysis(params.id, analysisRecord.result);
    if (persisted) {
      const report = await dbGet<ClinicalReport>("reports", `rep_${params.id}`);
      return NextResponse.json({
        study_id: params.id,
        reasoning_record_id: persisted.reasoning_record_id,
        reasoning_record_sha256: persisted.payload_sha256,
        version_freeze: persisted.version_freeze,
        specialist_consensus: persisted.specialist_consensus,
        specialist_bundles: persisted.specialist_bundles,
        specialist_packages: persisted.specialist_packages,
        reasoning: persisted.reasoning,
        safety_banner: "PERSISTED IMMUTABLE SPECIALIST/REASONING SNAPSHOT — NOT A DIAGNOSIS. NOT CLINICALLY VALIDATED.",
        requires_clinician_review: true,
      });
    }
  }

  const evidence = await buildStructuredClinicalEvidence(params.id, { includeSpecialists: true });
  if ("not_found" in evidence) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const reasoning = new DeterministicReasoningEngine().analyze(evidence);
  const persisted = analysisRecord?.result
    ? await persistReasoningRecord({
        report_id: `rep_${params.id}`,
        analysis: analysisRecord.result,
        evidence,
        reasoning,
      })
    : null;
  if (persisted) {
    // GET is deliberately read/persist-reasoning only; it never mutates a
    // legacy report or fabricates a version seal. A reviewed workflow may
    // attach a snapshot through an explicit write action.
  }
  return NextResponse.json({
    study_id: params.id,
    reasoning_record_id: persisted?.reasoning_record_id ?? null,
    reasoning_record_sha256: persisted?.payload_sha256 ?? null,
    version_freeze: persisted?.version_freeze ?? null,
    specialist_consensus: evidence.specialist_consensus ?? null,
    specialist_bundles: evidence.specialist_bundles,
    specialist_packages: evidence.specialist_packages ?? [],
    reasoning,
    safety_banner: evidence.safety_banner,
    requires_clinician_review: true,
  });
}
