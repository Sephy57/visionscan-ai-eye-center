import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/auth/users";
import { createSession, SESSION_COOKIE, CSRF_COOKIE } from "@/lib/auth/sessions";
import { inspectRateLimit, recordRateLimitFailure } from "@/lib/auth/rateLimit";
import { cookieTransportPolicy } from "@/lib/auth/cookieSecurity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LOGIN_LIMIT = 10;
const LOGIN_WINDOW_MS = 5 * 60 * 1000;

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { username?: string; password?: string } | null;
  if (!body?.username || !body?.password) {
    return NextResponse.json({ error: "username and password are required" }, { status: 400 });
  }

  const transport = cookieTransportPolicy({
    protocol: req.nextUrl.protocol,
    hostname: req.nextUrl.hostname,
    forwardedProto: req.headers.get("x-forwarded-proto"),
  });
  if (!transport.allowed) {
    return NextResponse.json(
      { error: "Secure login requires HTTPS. For an isolated local demo only, an administrator may explicitly enable the local insecure-auth setting." },
      { status: 426 },
    );
  }

  // Rate limit by username (prevents credential stuffing against one account)
  // independent of source IP, which this deployment cannot reliably determine
  // behind arbitrary reverse proxies without production infrastructure.
  const rateLimitKey = `login:${body.username.toLowerCase()}`;
  const rl = inspectRateLimit(rateLimitKey, LOGIN_LIMIT, LOGIN_WINDOW_MS);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many login attempts. Try again later." }, { status: 429 });
  }

  const result = await authenticate(body.username, body.password);
  if (!result.ok || !result.user) {
    // Rate-limit failed attempts only. Account-level lockout remains active
    // independently, so this does not reduce brute-force protection.
    recordRateLimitFailure(rateLimitKey, LOGIN_LIMIT, LOGIN_WINDOW_MS);
    return NextResponse.json({ error: result.reason ?? "Invalid credentials." }, { status: 401 });
  }

  const { token, csrf, expires_at } = await createSession({
    user_id: result.user.user_id, username: result.user.username, role: result.user.role,
    tenant_id: result.user.tenant_id ?? null,
  });

  const res = NextResponse.json({
    user: { user_id: result.user.user_id, username: result.user.username, role: result.user.role, tenant_id: result.user.tenant_id ?? null, display_name: result.user.display_name, must_reset_password: result.user.must_reset_password },
  });
  const secure = transport.secure;
  const maxAge = Math.max(0, Math.floor((new Date(expires_at).getTime() - Date.now()) / 1000));
  res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge });
  res.cookies.set(CSRF_COOKIE, csrf, { httpOnly: false, secure, sameSite: "strict", path: "/", maxAge });
  return res;
}
