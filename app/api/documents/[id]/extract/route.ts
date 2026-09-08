import { NextRequest, NextResponse } from "next/server";
import { requireRole, requireSession } from "@/lib/auth/rbac";
import { getDocument } from "@/lib/documents/repository";
import { enqueueExtraction, AnalysisJob } from "@/lib/jobs/queue";
import { dbAll } from "@/lib/storage/db";
import { audit } from "@/lib/audit";
import { requireDocumentScope } from "@/lib/auth/scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Starts async text/OCR extraction for a VALID document (S2).
 * Roles: ADMIN, CLINICIAN, TECHNICIAN (technical processing).
 * Extraction output is UNCERTAIN, UNVERIFIED data. It is surfaced in the
 * record evidence workspace and may raise a distinct pre-review urgency
 * signal, but is never treated as verified image evidence or a diagnosis.
 * Response: { job_id, status: "queued" } - poll /api/jobs/[id] or
 * /api/documents/[id]/status.
 */
export function POST(req: NextRequest, context: { params: { id: string } }): Promise<NextResponse>;
export function POST(req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse>;
export async function POST(req: NextRequest, { params }: { params: { id: string } | Promise<{ id: string }> }) {
  params = await params;
  const denied = await requireRole(req, ["ADMIN", "CLINICIAN", "TECHNICIAN"]);
  if (denied) return denied;
  const scoped = await requireDocumentScope(req, params.id);
  if (scoped.response) return scoped.response;
  if (!scoped.resource) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const { user } = await requireSession(req);

  const doc = await getDocument(params.id);
  if (!doc || doc.status === "DELETED" || doc.status === "REJECTED") {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  if (doc.status === "PROCESSING") {
    return NextResponse.json({ error: "ALREADY_PROCESSING" }, { status: 409 });
  }
  const job = await enqueueExtraction(doc.document_id, doc.study_id);
  await audit({
    actor: `user:${user?.username ?? "unknown"}`,
    action: "document.extract_requested",
    resource: "document",
    resourceId: doc.document_id,
    studyId: doc.study_id,
    outcome: "ok",
    detail: `job=${job.job_id}`,
  });
  return NextResponse.json({ job_id: job.job_id, status: job.status }, { status: 202 });
}

/** GET = convenience: recent extraction jobs for this document (metadata only, no text). */
export function GET(req: NextRequest, context: { params: { id: string } }): Promise<NextResponse>;
export function GET(req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse>;
export async function GET(req: NextRequest, { params }: { params: { id: string } | Promise<{ id: string }> }) {
  params = await params;
  const denied = await requireRole(req, ["ADMIN", "CLINICIAN", "TECHNICIAN", "REVIEWER"]);
  if (denied) return denied;
  const scoped = await requireDocumentScope(req, params.id);
  if (scoped.response) return scoped.response;
  if (!scoped.resource) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const doc = await getDocument(params.id);
  if (!doc) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const jobs = (await dbAll<AnalysisJob>("jobs"))
    .filter((j) => j.document_id === params.id && j.kind === "extraction")
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return NextResponse.json({
    latest_job: jobs[0]
      ? { job_id: jobs[0].job_id, status: jobs[0].status, created_at: jobs[0].created_at, completed_at: jobs[0].completed_at, error: jobs[0].error }
      : null,
    jobs: jobs.slice(0, 5).map(({ job_id, status, created_at, completed_at }) => ({ job_id, status, created_at, completed_at })),
  });
}
