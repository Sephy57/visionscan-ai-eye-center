import { NextRequest, NextResponse } from "next/server";
import { getJob, retryJob } from "@/lib/jobs/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const job = await getJob(params.id);
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(job);
}

/** POST = retry a failed job (failure-handling contract: Retry action). */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json().catch(() => ({}));
    const job = await retryJob(params.id, String(body?.requested_by ?? "user"));
    if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(job);
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 400 });
  }
}
