import { NextRequest, NextResponse } from "next/server";
import { listStudies, listStudiesWithStatus } from "@/lib/studies/service";
import { requireRole } from "@/lib/auth/rbac";
import { requireSession } from "@/lib/auth/rbac";
import { filterScopedResources } from "@/lib/auth/scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = await requireRole(req, ["ADMIN", "CLINICIAN", "REVIEWER"]);
  if (denied) return denied;
  const { user } = await requireSession(req);
  if (!user) return new NextResponse(JSON.stringify({ error: "Authentication required." }), { status: 401 });
  const withStatus = new URL(req.url).searchParams.get("with_status") === "1";
  if (withStatus) {
    const studies = await listStudiesWithStatus();
    return NextResponse.json({ studies: await filterScopedResources(user, studies) });
  }
  const studies = await listStudies();
  const visible = await filterScopedResources(user, studies);
  return NextResponse.json({
    studies: visible.map((s) => ({
      study_id: s.study_id,
      created_at: s.created_at,
      modality: s.modality,
      eye: s.eye,
      status: s.status,
      sha256: s.original_sha256,
    })),
  });
}
