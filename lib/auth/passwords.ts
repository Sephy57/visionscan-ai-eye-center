import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "crypto";

/**
 * Password hashing - Node's built-in scrypt (no external dependency, no
 * network call). NEVER store or log a plaintext password.
 *
 * Format: scrypt$<N>$<r>$<p>$<saltHex>$<hashHex>
 * Parameters are embedded so they can be upgraded later without breaking
 * verification of previously-hashed passwords.
 */

function scrypt(password: string, salt: Buffer, keylen: number, options: { N: number; r: number; p: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

const N = 16384; // CPU/memory cost
const r = 8;
const p = 1;
const KEYLEN = 64;

export interface PasswordPolicyResult {
  ok: boolean;
  reasons: string[];
}

/** Minimum, non-negotiable password policy. Rejects weak passwords before they are ever hashed. */
export function checkPasswordPolicy(password: string): PasswordPolicyResult {
  const reasons: string[] = [];
  if (typeof password !== "string" || password.length < 12) reasons.push("Password must be at least 12 characters.");
  if (!/[a-z]/.test(password)) reasons.push("Password must contain a lowercase letter.");
  if (!/[A-Z]/.test(password)) reasons.push("Password must contain an uppercase letter.");
  if (!/[0-9]/.test(password)) reasons.push("Password must contain a digit.");
  if (/^(password|12345678901|admin123456|qwertyuiop12)/i.test(password)) reasons.push("Password is too common/predictable.");
  return { ok: reasons.length === 0, reasons };
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEYLEN, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

/** Constant-time verification - never short-circuits on the first differing byte. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, nStr, rStr, pStr, saltHex, hashHex] = parts;
  const n = Number(nStr), rr = Number(rStr), pp = Number(pStr);
  if (!Number.isFinite(n) || !Number.isFinite(rr) || !Number.isFinite(pp)) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  try {
    const derived = await scrypt(password, salt, expected.length, { N: n, r: rr, p: pp });
    if (derived.length !== expected.length) return false;
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/** Cryptographically random opaque token (session ids, CSRF tokens, reset tokens). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}
