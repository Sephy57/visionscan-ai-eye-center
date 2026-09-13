import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { requireStudyScope } from "@/lib/auth/scope";
import { listClinicianReviewEvents } from "@/lib/clinical/reviewEvents";
import { dbGet } from "@/lib/storage/db";
import type { StudyRecord } from "@/lib/studies/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: NextRequest, context: { params: { id: string } }): Promise<NextResponse>;
export function GET(req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse>;
export async function GET(req: NextRequest, { params }: { params: { id: string } | Promise<{ id: string }> }) {
  params = await params;
  const denied = await requireRole(req, ["ADMIN", "CLINICIAN", "REVIEWER"]);
  if (denied) return denied;
  const scoped = await requireStudyScope(req, params.id);
  if (scoped.response) return scoped.response;
  if (!scoped.resource) return NextResponse.json({ error: "Report not found" }, { status: 404 });
  const study = await dbGet<StudyRecord>("studies", params.id);
  const reportId = study?.latest_report_id ?? `rep_${params.id}`;
  const events = await listClinicianReviewEvents(reportId);
  return NextResponse.json({
    schema_version: "visionscan-clinician-review-events-v1",
    study_id: params.id,
    report_id: reportId,
    immutable: true,
    events,
    notice: "Review events are append-only audit records. The current report projection does not overwrite the source AI snapshot.",
  });
}
