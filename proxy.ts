import { NextRequest, NextResponse } from "next/server";

/**
 * Page-route gatekeeper. This is a UX convenience ONLY (redirect to /login
 * when there is obviously no session cookie) - it is NOT the security
 * boundary. Proxy runs on the Edge runtime, which cannot safely read the
 * Node-based session store, so it only checks cookie PRESENCE. Every
 * protected API route independently validates the session and role server-
 * side via lib/auth/rbac.ts requireRole() - that is the real enforcement
 * point, and it still applies even if a request reaches a page with a stale
 * or forged cookie.
 */

const PUBLIC_PATHS = ["/login", "/access-denied"];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    pathname === "/icon.svg" ||
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))
  ) {
    return NextResponse.next();
  }

  const hasSession = req.cookies.has("vsa_session");
  if (!hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
