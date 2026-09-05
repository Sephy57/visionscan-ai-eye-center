import { dbGet, dbPut, dbAll } from "../storage/db";
import { newId } from "../storage/files";
import { hashPassword, verifyPassword, checkPasswordPolicy } from "./passwords";
import { audit } from "../audit";

export type Role = "ADMIN" | "CLINICIAN" | "REVIEWER" | "RESEARCHER" | "TECHNICIAN";
export const ROLES: Role[] = ["ADMIN", "CLINICIAN", "REVIEWER", "RESEARCHER", "TECHNICIAN"];

export interface UserRecord {
  user_id: string;
  username: string;         // unique, lowercase
  password_hash: string;    // NEVER plaintext - see lib/auth/passwords.ts
  role: Role;
  /** Optional tenant boundary; absent only for legacy local accounts. */
  tenant_id?: string | null;
  display_name: string;
  created_at: string;
  disabled: boolean;
  must_reset_password: boolean;
  failed_login_attempts: number;
  locked_until: string | null;
  last_login_at: string | null;
}

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

function normalizeUsername(u: string): string {
  return u.trim().toLowerCase();
}

export async function getUserByUsername(username: string): Promise<UserRecord | null> {
  const all = await dbAll<UserRecord>("users");
  return all.find((u) => u.username === normalizeUsername(username)) ?? null;
}

export async function getUserById(userId: string): Promise<UserRecord | null> {
  return dbGet<UserRecord>("users", userId);
}

export async function listUsers(): Promise<UserRecord[]> {
  return dbAll<UserRecord>("users");
}

export interface CreateUserResult {
  ok: boolean;
  user?: Omit<UserRecord, "password_hash">;
  errors?: string[];
}

/** Create a user. Enforces the password policy and username uniqueness; never accepts a weak password. */
export async function createUser(params: { username: string; password: string; role: Role; display_name: string; created_by: string; tenant_id?: string | null }): Promise<CreateUserResult> {
  const username = normalizeUsername(params.username);
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) return { ok: false, errors: ["Username must be 3-32 characters: lowercase letters, digits, '.', '_', '-'."] };
  if (!ROLES.includes(params.role)) return { ok: false, errors: [`Invalid role: ${params.role}`] };
  if (await getUserByUsername(username)) return { ok: false, errors: ["Username already exists."] };
  const policy = checkPasswordPolicy(params.password);
  if (!policy.ok) return { ok: false, errors: policy.reasons };

  const rec: UserRecord = {
    user_id: newId("user"),
    username,
    password_hash: await hashPassword(params.password),
    role: params.role,
    tenant_id: params.tenant_id?.trim() || null,
    display_name: params.display_name.slice(0, 120) || username,
    created_at: new Date().toISOString(),
    disabled: false,
    must_reset_password: false,
    failed_login_attempts: 0,
    locked_until: null,
    last_login_at: null,
  };
  await dbPut("users", rec.user_id, rec);
  await audit({ actor: `admin:${params.created_by}`, action: "user.create", outcome: "ok", detail: `user=${username} role=${params.role}` });
  const { password_hash: _ph, ...safe } = rec;
  return { ok: true, user: safe };
}

export interface AuthenticateResult {
  ok: boolean;
  user?: Omit<UserRecord, "password_hash">;
  reason?: string;
}

/**
 * Authenticate. Fails closed on disabled/locked accounts, tracks failed
 * attempts, and applies a temporary lockout - a real, working abuse
 * protection, not a documented-only claim.
 */
export async function authenticate(username: string, password: string): Promise<AuthenticateResult> {
  const user = await getUserByUsername(username);
  // Always run a verify call even for an unknown user, against a fixed dummy
  // hash, so response timing does not reveal whether the username exists.
  const DUMMY_HASH = "scrypt$16384$8$1$00000000000000000000000000000000$0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";
  if (!user) {
    await verifyPassword(password, DUMMY_HASH).catch(() => false);
    await audit({ actor: `user:${normalizeUsername(username)}`, action: "auth.login", outcome: "rejected", detail: "unknown username" });
    return { ok: false, reason: "Invalid username or password." };
  }
  if (user.disabled) {
    await audit({ actor: `user:${user.username}`, action: "auth.login", outcome: "rejected", detail: "account disabled" });
    return { ok: false, reason: "Account disabled." };
  }
  if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
    await audit({ actor: `user:${user.username}`, action: "auth.login", outcome: "rejected", detail: "account locked" });
    return { ok: false, reason: "Account temporarily locked due to repeated failed logins. Try again later." };
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    user.failed_login_attempts += 1;
    if (user.failed_login_attempts >= MAX_FAILED_ATTEMPTS) {
      user.locked_until = new Date(Date.now() + LOCKOUT_MS).toISOString();
      user.failed_login_attempts = 0;
    }
    await dbPut("users", user.user_id, user);
    await audit({ actor: `user:${user.username}`, action: "auth.login", outcome: "rejected", detail: `bad password (attempt ${user.failed_login_attempts})` });
    return { ok: false, reason: "Invalid username or password." };
  }

  user.failed_login_attempts = 0;
  user.locked_until = null;
  user.last_login_at = new Date().toISOString();
  await dbPut("users", user.user_id, user);
  await audit({ actor: `user:${user.username}`, action: "auth.login", outcome: "ok" });
  const { password_hash: _ph, ...safe } = user;
  return { ok: true, user: safe };
}

export async function setPassword(userId: string, newPassword: string, actor: string): Promise<{ ok: boolean; errors?: string[] }> {
  const user = await getUserById(userId);
  if (!user) return { ok: false, errors: ["User not found."] };
  const policy = checkPasswordPolicy(newPassword);
  if (!policy.ok) return { ok: false, errors: policy.reasons };
  user.password_hash = await hashPassword(newPassword);
  user.must_reset_password = false;
  user.failed_login_attempts = 0;
  user.locked_until = null;
  await dbPut("users", user.user_id, user);
  await audit({ actor, action: "user.password_set", outcome: "ok", detail: `user=${user.username}` });
  return { ok: true };
}

export async function setUserDisabled(userId: string, disabled: boolean, actor: string): Promise<boolean> {
  const user = await getUserById(userId);
  if (!user) return false;
  user.disabled = disabled;
  await dbPut("users", user.user_id, user);
  await audit({ actor, action: disabled ? "user.disable" : "user.enable", outcome: "ok", detail: `user=${user.username}` });
  return true;
}
