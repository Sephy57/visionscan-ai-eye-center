import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { getUserByUsername } from "@/lib/auth/users";
import { randomToken } from "@/lib/auth/passwords";
import { dbPut } from "@/lib/storage/db";
import { createHash } from "crypto";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ADMIN-INITIATED password reset. Self-service "forgot password" email
 * delivery is REQUIRES EXTERNAL INFRASTRUCTURE (no email service is
 * connected in this deployment - see docs/AUTH_RBAC.md) and is therefore
 * NOT implemented as an unauthenticated endpoint, which would otherwise be
 * a user-enumeration / account-takeover risk with no real delivery channel
 * to verify the requester owns the account.
 *
 * An admin generates a one-time reset token here and relays it to the user
 * through a separate, already-trusted channel (this is the honest stand-in
 * until real email/SMS delivery is integrated).
 */
export async function POST(req: NextRequest) {
  const denied = await requireRole(req, ["ADMIN"]);
  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as { username?: string } | null;
  if (!body?.username) return NextResponse.json({ error: "username is required" }, { status: 400 });

  const user = await getUserByUsername(body.username);
  if (!user) return NextResponse.json({ error: "No such user." }, { status: 404 });

  const token = randomToken(32);
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
  await dbPut("reset_tokens", tokenHash, { token_hash: tokenHash, user_id: user.user_id, expires_at: expiresAt, used: false });
  await audit({ actor: "admin", action: "user.reset_token_issued", outcome: "ok", detail: `user=${user.username}` });

  return NextResponse.json({
    token, // relay this to the user via a trusted out-of-band channel - never logged, never emailed by this deployment
    expires_at: expiresAt,
    note: "Email delivery is not configured in this deployment. Relay this token to the user through an already-trusted channel.",
  });
}
