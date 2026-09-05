import { NextRequest, NextResponse } from "next/server";
import { validateSession, SESSION_COOKIE, csrfMatches } from "./sessions";
import { Role } from "./users";
import { audit } from "../audit";

/**
 * Server-side RBAC enforcement. Every protected API route calls
 * requireRole() FIRST, before touching any data. The UI hiding a button is
 * never the security boundary - this function is.
 *
 * Least-privilege role responsibilities (see docs/AUTH_RBAC.md for the full
 * matrix):
 *   ADMIN       - system configuration, model lifecycle, user management, audit access
 *   CLINICIAN   - patient studies, clinical review, finalization, treatment review
 *   REVIEWER    - clinical/research review per assigned permissions
 *   RESEARCHER  - de-identified research datasets, evaluation metrics (never raw studies)
 *   TECHNICIAN  - device/upload/system operations
 */

export interface AuthedRequest {
  user_id: string;
  username: string;
  role: Role;
  tenant_id?: string | null;
}

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Returns null (request may proceed) with the session attached via the
 * second return slot, or a NextResponse to send back immediately (401/403).
 * CSRF (double-submit cookie) is enforced automatically for mutating methods.
 */
export async function requireRole(req: NextRequest, allowedRoles: Role[]): Promise<NextResponse | null> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const check = await validateSession(token);
  if (!check.valid || !check.session) {
    await audit({ actor: "anonymous", action: "authz.denied", outcome: "rejected", detail: `no valid session (${check.reason ?? "unknown"}) for ${req.method} ${req.nextUrl.pathname}` });
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  const { session } = check;

  if (MUTATING_METHODS.has(req.method)) {
    const header = req.headers.get("x-csrf-token");
    if (!csrfMatches(session.csrf_token, header)) {
      await audit({ actor: `user:${session.username}`, action: "authz.csrf_denied", outcome: "rejected", detail: `${req.method} ${req.nextUrl.pathname}` });
      return NextResponse.json({ error: "CSRF token missing or invalid." }, { status: 403 });
    }
  }

  if (!allowedRoles.includes(session.role)) {
    await audit({ actor: `user:${session.username}`, action: "authz.denied", outcome: "rejected", detail: `role=${session.role} required=${allowedRoles.join(",")} path=${req.nextUrl.pathname}` });
    return NextResponse.json({ error: "You do not have permission to perform this action." }, { status: 403 });
  }
  return null;
}

/** For routes that need the authenticated user's identity without a hard role check (still requires a valid session). */
export async function requireSession(req: NextRequest): Promise<{ response: NextResponse | null; user: AuthedRequest | null }> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const check = await validateSession(token);
  if (!check.valid || !check.session) {
    return { response: NextResponse.json({ error: "Authentication required." }, { status: 401 }), user: null };
  }
  return {
    response: null,
    user: {
      user_id: check.session.user_id,
      username: check.session.username,
      role: check.session.role,
      tenant_id: check.session.tenant_id ?? null,
    },
  };
}
