import fs from "fs/promises";
import { NextResponse } from "next/server";
import { initializeDatabase, persistenceInfo } from "@/lib/storage/db";
import { DATABASE_FILE, MODEL_ROOT, UPLOAD_ROOT, REPORT_ROOT } from "@/lib/config";
import { auditRegistryConsistency, listModels } from "@/lib/models/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Readiness checks durable dependencies only; it never runs model inference. */
export async function GET() {
  const checks: Record<string, unknown> = {};
  let ready = true;
  try {
    const info = await initializeDatabase();
    checks.database = { ok: true, backend: info.backend, schema_version: info.database_schema_version, migration_version: info.migration_version, pragmas: info.pragmas };
  } catch (error) {
    ready = false;
    checks.database = { ok: false, error: error instanceof Error ? error.message : "database unavailable" };
  }
  for (const [name, root] of [["storage_uploads", UPLOAD_ROOT], ["storage_reports", REPORT_ROOT], ["model_registry", MODEL_ROOT]] as const) {
    const stat = await fs.stat(root).catch(() => null);
    const ok = !!stat?.isDirectory();
    checks[name] = { ok, path_configured: true };
    if (!ok) ready = false;
  }
  const consistency = auditRegistryConsistency();
  checks.model_registry = { ...(checks.model_registry as Record<string, unknown>), ok: (checks.model_registry as { ok: boolean }).ok && consistency.length === 0, models: listModels().length, consistency_problems: consistency.length };
  if (consistency.length > 0) ready = false;
  return NextResponse.json({ status: ready ? "ready" : "not_ready", checks, database_file: DATABASE_FILE, inference: "not_checked" }, { status: ready ? 200 : 503, headers: { "cache-control": "no-store" } });
}

