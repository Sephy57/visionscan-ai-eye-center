import { NextRequest, NextResponse } from "next/server";
import { destroySession, validateSession, csrfMatches, SESSION_COOKIE, CSRF_COOKIE } from "@/lib/auth/sessions";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * True only for a request the browser itself marks as coming from this
 * origin (Fetch Metadata), or, for browsers without it, whose Origin header
 * exactly matches the request origin. Page script cannot forge either header.
 */
function isSameOriginRequest(req: NextRequest): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === req.nextUrl.origin;
  } catch {
    return false;
  }
}

/**
 * Ends the current session. A live session requires proof the request came
 * from this application, so another origin cannot force a logout: the
 * double-submit CSRF header, or, if that cookie was lost or is out of sync,
 * a verifiable same-origin request (so a user can always sign out from the
 * app itself). With no valid session there is nothing to protect: the
 * request only clears the (already useless) cookies, so it stays idempotent.
 */
export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const check = await validateSession(token);
  if (check.valid && check.session) {
    if (!csrfMatches(check.session.csrf_token, req.headers.get("x-csrf-token")) && !isSameOriginRequest(req)) {
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
