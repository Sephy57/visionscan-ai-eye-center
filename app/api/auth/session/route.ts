import { NextRequest, NextResponse } from "next/server";
import { validateSession, SESSION_COOKIE } from "@/lib/auth/sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const check = await validateSession(token);
  if (!check.valid || !check.session) {
    return NextResponse.json({ authenticated: false, reason: check.reason ?? null }, { status: 200 });
  }
  return NextResponse.json({
    authenticated: true,
    user: { user_id: check.session.user_id, username: check.session.username, role: check.session.role, tenant_id: check.session.tenant_id ?? null },
    expires_at: check.session.expires_at,
  });
}
