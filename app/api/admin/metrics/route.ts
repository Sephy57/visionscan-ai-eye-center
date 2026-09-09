import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { snapshotMetrics } from "@/lib/observability/metrics";
import { dbAll, dbCount, persistenceInfo } from "@/lib/storage/db";
import { DATABASE_FILE, DATA_ROOT } from "@/lib/config";
import fs from "fs/promises";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function latestBackupStatus() {
  const root = path.join(DATA_ROOT, "backups");
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => [] as import("fs").Dirent[]);
  const candidates: Array<{ name: string; mtimeMs: number }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !/^backup-[A-Za-z0-9_-]+$/.test(entry.name)) continue;
    const manifest = path.join(root, entry.name, "manifest.json");
    const stat = await fs.lstat(manifest).catch(() => null);
    if (!stat?.isFile() || stat.isSymbolicLink()) continue;
    const raw = await fs.readFile(manifest, "utf8").catch(() => "");
    try {
      const value = JSON.parse(raw) as { format?: string; created_at?: string; encryption?: { version?: number; algorithm?: string } };
      if (value.format !== "visionscan-data-backup-v1") continue;
      candidates.push({ name: entry.name, mtimeMs: stat.mtimeMs });
    } catch {
      // Ignore malformed/partial backup directories; they are not reported as usable.
    }
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const latest = candidates[0];
  return {
    status: latest ? "available" : "missing",
    latest_directory: latest?.name ?? null,
    latest_at: latest ? new Date(latest.mtimeMs).toISOString() : null,
    age_seconds: latest ? Math.max(0, Math.round((Date.now() - latest.mtimeMs) / 1000)) : null,
    usable_count: candidates.length,
    root_configured: root,
    phi_included: false,
  };
}

/** Admin-only operational snapshot. It contains counters and timings only. */
export async function GET(req: NextRequest) {
  const denied = await requireRole(req, ["ADMIN"]);
  if (denied) return denied;
  const jobs = await dbAll<Record<string, unknown>>("jobs");
  const journal = await dbAll<Record<string, unknown>>("reconciliation_journal");
  const stat = await fs.stat(DATABASE_FILE).catch(() => null);
  const info = persistenceInfo();
  const [backup, validationErrors] = await Promise.all([
    latestBackupStatus(),
    dbCount("model_errors"),
  ]);
  const now = Date.now();
  const staleLeases = jobs.filter((job) => {
    const state = String(job.state ?? job.status ?? "").toUpperCase();
    const lease = Date.parse(String(job.lease_expires_at ?? ""));
    return (state === "RUNNING" || state === "CLAIMED") && Number.isFinite(lease) && lease < now;
  }).length;
  return NextResponse.json({
    scope: "process_local",
    phi_included: false,
    persistence: {
      database_file: DATABASE_FILE,
      database_bytes: stat?.size ?? 0,
      jobs_total: jobs.length,
      jobs_active: jobs.filter((job) => ["RUNNING", "CLAIMED"].includes(String(job.state ?? job.status ?? "").toUpperCase())).length,
      stale_leases: staleLeases,
      failed_jobs: jobs.filter((job) => ["FAILED", "ERROR"].includes(String(job.state ?? job.status ?? "").toUpperCase())).length,
      reconciliation_errors: journal.filter((entry) => entry.state === "FAILED_RECONCILIATION").length,
      backup,
      migration: {
        backend: info.backend,
        database_schema_version: info.database_schema_version,
        migration_version: info.migration_version,
        status: info.backend === "sqlite" ? "current" : "legacy_json",
        phi_included: false,
      },
      validation_errors: {
        total: validationErrors,
        status: validationErrors > 0 ? "review_required" : "clear",
        phi_included: false,
      },
    },
    metrics: snapshotMetrics(),
  });
}
