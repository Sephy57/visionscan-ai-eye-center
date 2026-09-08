import { NextRequest, NextResponse } from "next/server";
import { getJob, retryJob, cancelJob } from "@/lib/jobs/queue";
import { requireRole, requireSession } from "@/lib/auth/rbac";
import { requireJobScope } from "@/lib/auth/scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: NextRequest, context: { params: { id: string } }): Promise<NextResponse>;
export function GET(req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse>;
export async function GET(req: NextRequest, { params }: { params: { id: string } | Promise<{ id: string }> }) {
  params = await params;
  const denied = await requireRole(req, ["ADMIN", "CLINICIAN", "TECHNICIAN", "REVIEWER"]);
  if (denied) return denied;
  const scoped = await requireJobScope(req, params.id);
  if (scoped.response) return scoped.response;
  if (!scoped.resource) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const job = await getJob(params.id);
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(job);
}

/** POST = retry a failed job, or { action: "cancel" } to cancel queued/running (S2). */
export function POST(req: NextRequest, context: { params: { id: string } }): Promise<NextResponse>;
export function POST(req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse>;
export async function POST(req: NextRequest, { params }: { params: { id: string } | Promise<{ id: string }> }) {
  params = await params;
  const denied = await requireRole(req, ["ADMIN", "CLINICIAN", "TECHNICIAN", "REVIEWER"]);
  if (denied) return denied;
  const scoped = await requireJobScope(req, params.id);
  if (scoped.response) return scoped.response;
  if (!scoped.resource) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { user } = await requireSession(req);
  try {
    const body = await req.json().catch(() => ({}));
    if (body?.action === "cancel") {
      const job = await cancelJob(params.id, user?.username ?? "unknown");
      if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
      return NextResponse.json(job);
    }
    const job = await retryJob(params.id, String(body?.requested_by ?? "user"));
    if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(job);
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 400 });
  }
}
