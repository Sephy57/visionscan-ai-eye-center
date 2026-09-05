import { createHash } from "crypto";
import { dbGet, dbPut, dbDelete, dbAll } from "../storage/db";
import { randomToken } from "./passwords";
import { Role } from "./users";
import { audit } from "../audit";

/**
 * Server-side session store + CSRF tokens (double-submit cookie pattern).
 *
 * The raw session token is given to the browser ONLY inside an httpOnly,
 * SameSite=Lax (Strict for the CSRF cookie) cookie. The server never stores
 * the raw token - only its SHA-256 hash - so a leak of the persisted JSON
 * store does not itself hand out live, usable sessions.
 */

export const SESSION_COOKIE = "vsa_session";
export const CSRF_COOKIE = "vsa_csrf";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;       // 12 hours sliding
const SESSION_ABSOLUTE_MAX_MS = 7 * 24 * 60 * 60 * 1000; // 7 days absolute cap

export interface SessionRecord {
  session_hash: string;      // sha256(raw token) - never the raw token
  user_id: string;
  username: string;
  role: Role;
  /** Optional organization/tenant boundary. Missing means legacy local data. */
  tenant_id: string | null;
  csrf_token: string;
  created_at: string;
  expires_at: string;
  absolute_expires_at: string;
  last_seen_at: string;
  ip_hint: string | null;    // coarse only (e.g. "unknown"); never used as sole identity
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(params: { user_id: string; username: string; role: Role; tenant_id?: string | null; ip_hint?: string | null }): Promise<{ token: string; csrf: string; expires_at: string }> {
  const token = randomToken(32);
  const csrf = randomToken(24);
  const now = Date.now();
  const rec: SessionRecord = {
    session_hash: hashToken(token),
    user_id: params.user_id,
    username: params.username,
    role: params.role,
    tenant_id: params.tenant_id ?? null,
    csrf_token: csrf,
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + SESSION_TTL_MS).toISOString(),
    absolute_expires_at: new Date(now + SESSION_ABSOLUTE_MAX_MS).toISOString(),
    last_seen_at: new Date(now).toISOString(),
    ip_hint: params.ip_hint ?? null,
  };
  await dbPut("sessions", rec.session_hash, rec);
  await audit({ actor: `user:${params.username}`, action: "auth.session_create", outcome: "ok" });
  return { token, csrf, expires_at: rec.expires_at };
}

export interface SessionCheck {
  valid: boolean;
  session?: SessionRecord;
  reason?: "no_token" | "not_found" | "expired" | "absolute_expired";
}

/** Validate a raw session token from the cookie. Sliding-renews expires_at on success, capped by the absolute max. */
export async function validateSession(token: string | undefined | null): Promise<SessionCheck> {
  if (!token) return { valid: false, reason: "no_token" };
  const rec = await dbGet<SessionRecord>("sessions", hashToken(token));
  if (!rec) return { valid: false, reason: "not_found" };
  const now = Date.now();
  if (new Date(rec.absolute_expires_at).getTime() < now) {
    await dbDelete("sessions", rec.session_hash);
    return { valid: false, reason: "absolute_expired" };
  }
  if (new Date(rec.expires_at).getTime() < now) {
    await dbDelete("sessions", rec.session_hash);
    return { valid: false, reason: "expired" };
  }
  rec.expires_at = new Date(Math.min(now + SESSION_TTL_MS, new Date(rec.absolute_expires_at).getTime())).toISOString();
  rec.last_seen_at = new Date(now).toISOString();
  await dbPut("sessions", rec.session_hash, rec);
  return { valid: true, session: rec };
}

export async function destroySession(token: string | undefined | null): Promise<void> {
  if (!token) return;
  const hash = hashToken(token);
  const rec = await dbGet<SessionRecord>("sessions", hash);
  await dbDelete("sessions", hash);
  if (rec) await audit({ actor: `user:${rec.username}`, action: "auth.logout", outcome: "ok" });
}

/** Destroy every session for a user (e.g. after a password reset or account disable). */
export async function destroyAllSessionsForUser(userId: string): Promise<number> {
  const all = await dbAll<SessionRecord>("sessions");
  const mine = all.filter((s) => s.user_id === userId);
  for (const s of mine) await dbDelete("sessions", s.session_hash);
  return mine.length;
}

/** Constant-time-ish comparison for CSRF token check (values are random hex of fixed length). */
export function csrfMatches(sessionCsrf: string, headerCsrf: string | undefined | null): boolean {
  if (!headerCsrf || headerCsrf.length !== sessionCsrf.length) return false;
  let diff = 0;
  for (let i = 0; i < sessionCsrf.length; i++) diff |= sessionCsrf.charCodeAt(i) ^ headerCsrf.charCodeAt(i);
  return diff === 0;
}
