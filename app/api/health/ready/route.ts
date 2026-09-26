import fs from "fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { initializeDatabase } from "@/lib/storage/db";
import { MODEL_ROOT, UPLOAD_ROOT, REPORT_ROOT } from "@/lib/config";
import { auditRegistryConsistency, listModels } from "@/lib/models/registry";
import { validateSession, SESSION_COOKIE } from "@/lib/auth/sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Check = { ok: boolean; models?: number; consistency_problems?: number };

/**
 * Readiness checks durable dependencies only; it never runs model inference.
 *
 * Anonymous callers (load balancers, uptime monitors) receive only the
 * overall status and the matching HTTP code. A signed-in session also sees
 * which dependency failed. Neither response includes the database backend,
 * schema/migration versions, pragmas, paths or error text; schema metadata is
 * available to administrators from /api/admin/operations.
 */
export async function GET(req: NextRequest) {
  const checks: Record<string, Check> = {};
  try {
    await initializeDatabase();
    checks.database = { ok: true };
  } catch {
    checks.database = { ok: false };
  }
  for (const [name, root] of [["storage_uploads", UPLOAD_ROOT], ["storage_reports", REPORT_ROOT], ["model_registry", MODEL_ROOT]] as const) {
    const stat = await fs.stat(root).catch(() => null);
    checks[name] = { ok: !!stat?.isDirectory() };
  }
  const consistency = auditRegistryConsistency();
  checks.model_registry = { ok: checks.model_registry.ok && consistency.length === 0, models: listModels().length, consistency_problems: consistency.length };

  const ready = Object.values(checks).every((check) => check.ok);
  const status = ready ? "ready" : "not_ready";
  const headers = { "cache-control": "no-store" };
  const session = await validateSession(req.cookies.get(SESSION_COOKIE)?.value).catch(() => null);
  const body = session?.valid ? { status, checks, inference: "not_checked" } : { status };
  return NextResponse.json(body, { status: ready ? 200 : 503, headers });
}
