import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { createUser, listUsers, ROLES } from "@/lib/auth/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ADMIN-only: list users (never returns password_hash) and create new accounts. */
export async function GET(req: NextRequest) {
  const denied = await requireRole(req, ["ADMIN"]);
  if (denied) return denied;
  const users = (await listUsers()).map(({ password_hash: _ph, ...safe }) => safe);
  return NextResponse.json({ users, roles: ROLES });
}

export async function POST(req: NextRequest) {
  const denied = await requireRole(req, ["ADMIN"]);
  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as { username?: string; password?: string; role?: string; display_name?: string; tenant_id?: string | null } | null;
  if (!body?.username || !body?.password || !body?.role) {
    return NextResponse.json({ error: "username, password, and role are required" }, { status: 400 });
  }
  const token = req.cookies.get("vsa_session")?.value;
  const { validateSession } = await import("@/lib/auth/sessions");
  const check = await validateSession(token);
  const createdBy = check.session?.username ?? "unknown";

  const result = await createUser({
    username: body.username, password: body.password,
    role: body.role as (typeof ROLES)[number], display_name: body.display_name ?? body.username,
    created_by: createdBy, tenant_id: body.tenant_id ?? null,
  });
  if (!result.ok) return NextResponse.json({ error: result.errors?.join(" ") ?? "Invalid user" }, { status: 400 });
  return NextResponse.json({ user: result.user }, { status: 201 });
}
