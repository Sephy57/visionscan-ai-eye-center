import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Liveness is deliberately independent of the database and ML providers. */
export async function GET() {
  return NextResponse.json({
    status: "alive",
    service: "visionscan",
    timestamp: new Date().toISOString(),
    inference: "not_checked",
  }, { status: 200, headers: { "cache-control": "no-store" } });
}

