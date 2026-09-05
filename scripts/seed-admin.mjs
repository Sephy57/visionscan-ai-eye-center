// First-run bootstrap: create the initial ADMIN account against a running
// server. Refuses (via the API) if any user already exists. Prints the
// generated password ONCE - it is never stored or logged anywhere.
import { randomBytes } from "crypto";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const username = process.env.ADMIN_BOOTSTRAP_USERNAME || "admin";
const password = process.env.ADMIN_BOOTSTRAP_PASSWORD || randomBytes(12).toString("base64url") + "Aa1!";

const res = await fetch(`${BASE}/api/auth/bootstrap-admin`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username, password, display_name: "System Administrator" }),
});
const json = await res.json().catch(() => ({}));

if (!res.ok) {
  console.error(`[bootstrap failed] ${res.status}: ${json.error ?? "unknown error"}`);
  process.exit(1);
}

console.log("=".repeat(70));
console.log("ADMIN ACCOUNT CREATED - record these credentials now, they will");
console.log("NEVER be shown again and are not stored anywhere in plaintext.");
console.log("=".repeat(70));
console.log(`  username: ${username}`);
console.log(`  password: ${password}`);
console.log("=".repeat(70));
