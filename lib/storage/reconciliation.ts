import fs from "fs/promises";
import path from "path";
import { dbAll, dbGet, dbPut, type Collection } from "./db";
import { audit } from "../audit";
import {
  DATABASE_FILE,
  REPORT_ROOT,
  UPLOAD_ROOT,
  PROCESSED_ROOT,
  ensureDirs,
  safeJoin,
} from "../config";
import { sha256 } from "./files";

export type RecoveryJournalState =
  | "PREPARED"
  | "DB_COMMITTED"
  | "FILES_COMMITTED"
  | "COMPLETE"
  | "FAILED_RECONCILIATION";

export interface RecoveryJournalEntry {
  journal_id: string;
  operation: string;
  state: RecoveryJournalState;
  resources: Array<{ kind: string; id: string; path?: string; sha256?: string }>;
  created_at: string;
  updated_at: string;
  error?: string;
  attempts?: number;
}

export type ReconciliationIssueKind =
  | "DB_ROW_WITHOUT_FILE"
  | "FILE_WITHOUT_DB_ROW"
  | "HASH_MISMATCH"
  | "STALE_DERIVED_ROI"
  | "MISSING_REPORT_EXPORT"
  | "DUPLICATE_IMMUTABLE_ASSET";

export interface ReconciliationIssue {
  issue_id: string;
  kind: ReconciliationIssueKind;
  resource: string;
  resource_id: string;
  path?: string;
  detail: string;
  repair_actions: string[];
}

export interface ReconciliationPlan {
  generated_at: string;
  database_file: string;
  issues: ReconciliationIssue[];
  counts: Record<ReconciliationIssueKind, number>;
  auto_repair: false;
}

function clone<T>(value: T): T {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value)) as T;
}

function idFor(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function iso(): string { return new Date().toISOString(); }

export async function prepareRecoveryJournal(input: {
  operation: string;
  resources: RecoveryJournalEntry["resources"];
}): Promise<RecoveryJournalEntry> {
  const at = iso();
  const entry: RecoveryJournalEntry = {
    journal_id: idFor("journal"),
    operation: input.operation,
    state: "PREPARED",
    resources: clone(input.resources),
    created_at: at,
    updated_at: at,
    attempts: 0,
  };
  await dbPut("reconciliation_journal", entry.journal_id, entry);
  return clone(entry);
}

export async function updateRecoveryJournal(
  journalId: string,
  state: RecoveryJournalState,
  error?: string,
): Promise<RecoveryJournalEntry> {
  const current = await dbGet<RecoveryJournalEntry>("reconciliation_journal", journalId);
  if (!current) throw new Error("Recovery journal entry not found");
  if (current.state === "COMPLETE" && state !== "COMPLETE") throw new Error("Completed recovery journal is immutable");
  const next: RecoveryJournalEntry = {
    ...current,
    state,
    updated_at: iso(),
    attempts: (current.attempts ?? 0) + (state === "FAILED_RECONCILIATION" ? 1 : 0),
    ...(error ? { error: error.slice(0, 300) } : {}),
  };
  await dbPut("reconciliation_journal", journalId, next);
  return clone(next);
}

/** Startup-safe recovery: no bytes are deleted or rewritten automatically.
 * Pending entries are marked for operator reconciliation and surfaced by the
 * admin endpoint. This makes restart state durable without claiming a file
 * commit that was never observed. */
export async function recoverPendingReconciliations(): Promise<RecoveryJournalEntry[]> {
  const entries = await dbAll<RecoveryJournalEntry>("reconciliation_journal");
  const pending = entries.filter((entry) => entry.state !== "COMPLETE" && entry.state !== "FAILED_RECONCILIATION");
  const recovered: RecoveryJournalEntry[] = [];
  for (const entry of pending) {
    recovered.push(await updateRecoveryJournal(
      entry.journal_id,
      "FAILED_RECONCILIATION",
      "Restart observed an incomplete multi-resource operation; explicit reconciliation required",
    ));
  }
  return recovered;
}

async function listFilesRecursive(root: string): Promise<string[]> {
  const result: string[] = [];
  async function visit(dir: string): Promise<void> {
    let names: string[];
    try { names = await fs.readdir(dir); } catch { return; }
    for (const name of names) {
      let absolute: string;
      try { absolute = safeJoin(root, path.relative(root, path.join(dir, name))); } catch { continue; }
      const stat = await fs.stat(absolute).catch(() => null);
      if (!stat) continue;
      if (stat.isDirectory()) await visit(absolute);
      else if (stat.isFile()) result.push(absolute);
    }
  }
  await visit(root);
  return result;
}

function emptyCounts(): Record<ReconciliationIssueKind, number> {
  return {
    DB_ROW_WITHOUT_FILE: 0,
    FILE_WITHOUT_DB_ROW: 0,
    HASH_MISMATCH: 0,
    STALE_DERIVED_ROI: 0,
    MISSING_REPORT_EXPORT: 0,
    DUPLICATE_IMMUTABLE_ASSET: 0,
  };
}

/**
 * Read-only, admin-facing scanner. It produces a repair plan and deliberately
 * never deletes or overwrites originals. Hashes are recomputed from bytes.
 */
export async function scanReconciliation(): Promise<ReconciliationPlan> {
  ensureDirs();
  const issues: ReconciliationIssue[] = [];
  const counts = emptyCounts();
  const add = (issue: Omit<ReconciliationIssue, "issue_id">) => {
    const full = { ...issue, issue_id: idFor("issue") };
    issues.push(full);
    counts[full.kind] += 1;
  };

  const studies = await dbAll<Record<string, unknown>>("studies");
  const studyIds = new Set(studies.map((s) => String(s.study_id ?? "")));
  for (const study of studies) {
    const id = String(study.study_id ?? "");
    const files = Array.isArray(study.files) ? study.files as Array<Record<string, unknown>> : [];
    for (const file of files) {
      const relative = typeof file.relativePath === "string" ? file.relativePath : null;
      const target = relative ? safeJoin(UPLOAD_ROOT, relative) : null;
      if (!target || !(await fs.stat(target).catch(() => null))) {
        add({ kind: "DB_ROW_WITHOUT_FILE", resource: "study", resource_id: id, path: target ?? undefined, detail: "study file metadata has no corresponding original bytes", repair_actions: ["mark_unavailable", "reattach_immutable_file"] });
        continue;
      }
      const expected = typeof file.sha256 === "string" ? file.sha256 : null;
      if (expected) {
        const actual = sha256(await fs.readFile(target));
        if (actual !== expected) add({ kind: "HASH_MISMATCH", resource: "study_file", resource_id: id, path: target, detail: "stored original hash differs from recomputed bytes", repair_actions: ["mark_unavailable", "quarantine_orphan"] });
      }
    }
  }

  const uploadFiles = await listFilesRecursive(UPLOAD_ROOT);
  const knownPaths = new Set(studies.flatMap((s) => (Array.isArray(s.files) ? s.files : []).map((f) => {
    const relative = f && typeof f === "object" && typeof (f as Record<string, unknown>).relativePath === "string" ? (f as Record<string, unknown>).relativePath as string : "";
    try { return safeJoin(UPLOAD_ROOT, relative); } catch { return ""; }
  })));
  for (const file of uploadFiles) {
    if (!knownPaths.has(file)) {
      add({ kind: "FILE_WITHOUT_DB_ROW", resource: "upload", resource_id: path.basename(file), path: file, detail: "original bytes are not referenced by a study row", repair_actions: ["quarantine_orphan", "reattach_immutable_file"] });
    }
  }

  const reports = await dbAll<Record<string, unknown>>("reports");
  for (const report of reports) {
    const id = String(report.report_id ?? "");
    const reportPath = safeJoin(REPORT_ROOT, `${id}.json`);
    if (!(await fs.stat(reportPath).catch(() => null))) add({ kind: "MISSING_REPORT_EXPORT", resource: "report", resource_id: id, path: reportPath, detail: "report database row has no derived JSON export", repair_actions: ["rebuild_derivative", "mark_unavailable"] });
  }

  const roiRows = await dbAll<Record<string, unknown>>("oct_rois");
  for (const roi of roiRows) {
    const status = String(roi.status ?? "").toUpperCase();
    const sourceHash = typeof roi.source_page_hash === "string" ? roi.source_page_hash : null;
    if (status === "STALE" || status === "INVALID" || !sourceHash) add({ kind: "STALE_DERIVED_ROI", resource: "oct_roi", resource_id: String(roi.roi_id ?? roi.id ?? "unknown"), detail: "ROI is stale or lacks a source-page hash", repair_actions: ["rebuild_derivative", "mark_unavailable"] });
  }

  const processedFiles = await listFilesRecursive(PROCESSED_ROOT);
  const processedHashes = new Map<string, string>();
  for (const file of processedFiles) {
    const hash = sha256(await fs.readFile(file));
    const previous = processedHashes.get(hash);
    if (previous) add({ kind: "DUPLICATE_IMMUTABLE_ASSET", resource: "processed_asset", resource_id: path.basename(file), path: file, detail: `same immutable bytes as ${path.basename(previous)}`, repair_actions: ["review_duplicate", "quarantine_orphan"] });
    else processedHashes.set(hash, file);
  }

  // Keep an explicit, machine-readable note when a dangling study id is
  // found in a derived collection. This does not delete the row.
  const analyses = await dbAll<Record<string, unknown>>("analyses");
  for (const analysis of analyses) {
    const result = analysis.result && typeof analysis.result === "object" ? analysis.result as Record<string, unknown> : null;
    const resultStudy = result?.study && typeof result.study === "object" ? (result.study as Record<string, unknown>).study_id : null;
    const studyId = String(analysis.study_id ?? resultStudy ?? "");
    if (studyId && !studyIds.has(studyId)) add({ kind: "DB_ROW_WITHOUT_FILE", resource: "analysis", resource_id: String(analysis.analysis_id ?? "unknown"), detail: "analysis references a study absent from the database", repair_actions: ["mark_unavailable", "manual_review"] });
  }

  return { generated_at: iso(), database_file: DATABASE_FILE, issues, counts, auto_repair: false };
}

/** Explicit repair is intentionally narrow and non-destructive. */
export async function applyReconciliationRepair(
  issue: ReconciliationIssue,
  action: "mark_unavailable" | "rebuild_derivative" | "reattach_immutable_file" | "quarantine_orphan" | "manual_review",
  actor: string,
): Promise<{ ok: true; issue_id: string; action: string; state: "REVIEW_REQUIRED" }> {
  if (!issue.repair_actions.includes(action)) throw new Error("Repair action is not allowed for this issue");
  await audit({ actor, action: "reconciliation.repair_requested", resource: issue.resource, resourceId: issue.resource_id, outcome: "ok", detail: `${issue.kind}:${action}` });
  return { ok: true, issue_id: issue.issue_id, action, state: "REVIEW_REQUIRED" };
}

export const reconciliationCollections: Collection[] = ["reconciliation_journal"];
