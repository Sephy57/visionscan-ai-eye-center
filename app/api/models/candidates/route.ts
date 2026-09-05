import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { CANDIDATE_MODEL_DOSSIERS } from "@/lib/models/candidateDossiers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * S6-A/S6-B — read-only listing of real-model CANDIDATE dossiers (research/
 * due-diligence records only). Every entry is `status: "CANDIDATE_ONLY"`;
 * none are registered in lib/models/registry.ts, none have an installed
 * artifact, and nothing here is reachable by the analysis pipeline.
 * ADMIN-only: this is governance/licensing information, not a clinical view.
 */
export async function GET(req: NextRequest) {
  const denied = await requireRole(req, ["ADMIN"]);
  if (denied) return denied;
  return NextResponse.json({
    candidates: CANDIDATE_MODEL_DOSSIERS,
    note: "Research dossiers only. No candidate has been installed, registered, or authorized for use. Gate A remains CLOSED.",
  });
}
