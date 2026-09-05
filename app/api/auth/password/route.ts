import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/rbac";
import { getUserById, setPassword } from "@/lib/auth/users";
import { verifyPassword } from "@/lib/auth/passwords";
import { csrfMatches } from "@/lib/auth/sessions";
import { validateSession, SESSION_COOKIE } from "@/lib/auth/sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { response, user } = await requireSession(req);
  if (response) return response;

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const check = await validateSession(token);
  if (!check.session || !csrfMatches(check.session.csrf_token, req.headers.get("x-csrf-token"))) {
    return NextResponse.json({ error: "CSRF token missing or invalid." }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as { current_password?: string; new_password?: string } | null;
  if (!body?.current_password || !body?.new_password) {
    return NextResponse.json({ error: "current_password and new_password are required" }, { status: 400 });
  }
  const full = await getUserById(user!.user_id);
  if (!full || !(await verifyPassword(body.current_password, full.password_hash))) {
    return NextResponse.json({ error: "Current password is incorrect." }, { status: 401 });
  }
  const result = await setPassword(user!.user_id, body.new_password, `user:${user!.username}`);
  if (!result.ok) return NextResponse.json({ error: result.errors?.join(" ") ?? "Invalid password" }, { status: 400 });
  return NextResponse.json({ ok: true });
}
