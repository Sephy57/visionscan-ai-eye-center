import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { analyzeRecord } from "@/lib/analysis/recordPipeline";
import { requireStudyScope } from "@/lib/auth/scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * RecordAnalysisPipeline for one study (eye-center workspace).
 * Read-only composition of extraction, test results, image analysis status,
 * evidence synthesis, medication safety, longitudinal comparison, and
 * urgency - with per-stage failure isolation. Never executes models and
 * never writes anything.
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

  const result = await analyzeRecord(params.id);
  if ("not_found" in result) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(result);
}
