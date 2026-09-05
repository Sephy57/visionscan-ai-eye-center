import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { dbGet, dbPut } from "@/lib/storage/db";
import { setPassword } from "@/lib/auth/users";
import { destroyAllSessionsForUser } from "@/lib/auth/sessions";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ResetTokenRecord { token_hash: string; user_id: string; expires_at: string; used: boolean }

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { token?: string; new_password?: string } | null;
  if (!body?.token || !body?.new_password) {
    return NextResponse.json({ error: "token and new_password are required" }, { status: 400 });
  }
  const tokenHash = createHash("sha256").update(body.token).digest("hex");
  const rec = await dbGet<ResetTokenRecord>("reset_tokens", tokenHash);
  if (!rec || rec.used || new Date(rec.expires_at).getTime() < Date.now()) {
    await audit({ actor: "anonymous", action: "user.reset_confirm", outcome: "rejected", detail: "invalid, used, or expired token" });
    return NextResponse.json({ error: "Reset token is invalid, already used, or expired." }, { status: 400 });
  }

  const result = await setPassword(rec.user_id, body.new_password, "self-service-reset");
  if (!result.ok) return NextResponse.json({ error: result.errors?.join(" ") ?? "Invalid password" }, { status: 400 });

  rec.used = true;
  await dbPut("reset_tokens", tokenHash, rec);
  const revoked = await destroyAllSessionsForUser(rec.user_id);
  await audit({ actor: `user_id:${rec.user_id}`, action: "user.reset_confirm", outcome: "ok", detail: `sessions_revoked=${revoked}` });

  return NextResponse.json({ ok: true });
}
