import { NextRequest, NextResponse } from "next/server";
import { destroySession, validateSession, csrfMatches, SESSION_COOKIE, CSRF_COOKIE } from "@/lib/auth/sessions";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ends the current session. Like every other state-changing route, a live
 * session requires the double-submit CSRF header, so another origin cannot
 * force a logout. With no valid session there is nothing to protect: the
 * request only clears the (already useless) cookies, so it stays idempotent.
 */
export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const check = await validateSession(token);
  if (check.valid && check.session) {
    if (!csrfMatches(check.session.csrf_token, req.headers.get("x-csrf-token"))) {
      await audit({ actor: `user:${check.session.username}`, action: "authz.csrf_denied", outcome: "rejected", detail: `${req.method} ${req.nextUrl.pathname}` });
      return NextResponse.json({ error: "CSRF token missing or invalid." }, { status: 403 });
    }
    await destroySession(token);
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  res.cookies.set(CSRF_COOKIE, "", { httpOnly: false, path: "/", maxAge: 0 });
  return res;
}
