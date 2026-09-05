import { NextRequest, NextResponse } from "next/server";
import { listUsers, createUser } from "@/lib/auth/users";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * First-run bootstrap ONLY. Creates the very first ADMIN account with no
 * authentication required - but ONLY while the user store is completely
 * empty. The instant one user exists, this route permanently refuses,
 * closing the bootstrap window for good (checked freshly on every call,
 * never cached).
 */
export async function POST(req: NextRequest) {
  const existing = await listUsers();
  if (existing.length > 0) {
    await audit({ actor: "anonymous", action: "auth.bootstrap_denied", outcome: "rejected", detail: "users already exist" });
    return NextResponse.json({ error: "Bootstrap is closed: at least one user account already exists. Ask an existing ADMIN to create your account." }, { status: 403 });
  }
  const body = (await req.json().catch(() => null)) as { username?: string; password?: string; display_name?: string } | null;
  if (!body?.username || !body?.password) {
    return NextResponse.json({ error: "username and password are required" }, { status: 400 });
  }
  const result = await createUser({
    username: body.username, password: body.password, role: "ADMIN",
    display_name: body.display_name ?? body.username, created_by: "bootstrap",
  });
  if (!result.ok) return NextResponse.json({ error: result.errors?.join(" ") ?? "Invalid user" }, { status: 400 });
  await audit({ actor: "anonymous", action: "auth.bootstrap_admin_created", outcome: "ok", detail: `user=${body.username}` });
  return NextResponse.json({ user: result.user }, { status: 201 });
}
