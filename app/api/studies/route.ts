import { NextRequest, NextResponse } from "next/server";
import { listStudiesPage, listStudiesWithStatusPage } from "@/lib/studies/service";
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
  const params = new URL(req.url).searchParams;
  const withStatus = params.get("with_status") === "1";
  const rawLimit = Number(params.get("limit"));
  const limit = Number.isFinite(rawLimit) ? rawLimit : undefined;
  const cursor = params.get("cursor") ?? undefined;
  try {
    if (withStatus) {
      const page = await listStudiesWithStatusPage({ limit, cursor });
      const studies = await filterScopedResources(user, page.items);
      return NextResponse.json({
        studies,
        next_cursor: page.next_cursor,
        has_more: page.has_more,
        limit: page.limit,
      });
    }
    const page = await listStudiesPage({ limit, cursor });
    const visible = await filterScopedResources(user, page.items);
    return NextResponse.json({
      studies: visible.map((s) => ({
        study_id: s.study_id,
        created_at: s.created_at,
        modality: s.modality,
        eye: s.eye,
        status: s.status,
        sha256: s.original_sha256,
      })),
      next_cursor: page.next_cursor,
      has_more: page.has_more,
      limit: page.limit,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid pagination request";
    if (/pagination (cursor|scan)/i.test(message)) return NextResponse.json({ error: message }, { status: 400 });
    throw error;
  }
}
