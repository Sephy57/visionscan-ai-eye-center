import { NextRequest, NextResponse } from "next/server";
import { destroySession, SESSION_COOKIE, CSRF_COOKIE } from "@/lib/auth/sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  await destroySession(token);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  res.cookies.set(CSRF_COOKIE, "", { httpOnly: false, path: "/", maxAge: 0 });
  return res;
}
