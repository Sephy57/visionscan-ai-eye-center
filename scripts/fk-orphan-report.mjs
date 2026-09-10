#!/usr/bin/env node
/**
 * Emit a PHI-minimizing, machine-readable report for unresolved typed
 * references.  This is deliberately read-only: imported legacy rows are not
 * rewritten, attached to a guessed parent, or deleted by this command.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Database from "better-sqlite3";

const RELATIONS = [
  ["studies", "patient_id", "patients"],
  ["studies", "encounter_id", "encounters"],
  ["documents", "patient_id", "patients"],
  ["documents", "study_id", "studies"],
  ["analyses", "study_id", "studies"],
  ["reports", "analysis_id", "analyses"],
  ["clinician_reviews", "report_id", "reports"],
  ["reasoning_records", "analysis_id", "analyses"],
  ["model_executions", "analysis_id", "analyses"],
  ["jobs", "study_id", "studies"],
  ["evidence", "analysis_id", "analyses"],
];

const EXTRA_EVIDENCE_COLLECTIONS = ["reports"];

function parsePayload(payload) {
  try { return JSON.parse(payload); } catch { return {}; }
}

function valueOf(row, field) {
  const payload = row?.payload_object ?? parsePayload(row?.payload);
  const camel = field.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  const value = row?.[field] ?? payload?.[field] ?? payload?.[camel];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function lifecycleOf(row) {
  const payload = row?.payload_object ?? parsePayload(row?.payload);
  const value = String(payload?.lifecycle ?? payload?.archive_state ?? "").toUpperCase();
  if (value === "DELETED" || String(payload?.status ?? "").toUpperCase() === "DELETED") return "DELETED";
  if (value === "ARCHIVED") return "ARCHIVED";
  return "ACTIVE";
}

function statusOf(row) {
  const payload = row?.payload_object ?? parsePayload(row?.payload);
  const status = payload?.status;
  return typeof status === "string" && status.trim() ? status.trim().toUpperCase() : null;
}

function originClass(row) {
  const payload = row?.payload_object ?? parsePayload(row?.payload);
  const actor = [payload?.uploaded_by, payload?.created_by, payload?.owner_username]
    .find((value) => typeof value === "string" && value.trim());
  if (typeof actor === "string" && /(?:tester|synth|fixture|smoke-admin|test)/i.test(actor)) return "TEST_DEV_DATA";
  if (lifecycleOf(row) === "DELETED") return "DELETED_RECORD";
  if (statusOf(row) === "COMPLETED") return "TERMINAL_RECORD";
  return "UNCLASSIFIED";
}

function readRows(db, collection) {
  return db.prepare(`SELECT id, payload, created_at, updated_at, patient_id, encounter_id, study_id, document_id, analysis_id, report_id, tenant_id, job_id FROM "${collection}"`)
    .all()
    .map((row) => ({ ...row, payload_object: parsePayload(row.payload) }));
}

function currentId(row) {
  // SQLite's id is the durable key.  Payload ids are intentionally not used
  // to avoid turning a payload mismatch into a guessed relationship.
  return String(row.id);
}

function classify({ source, column, row, parentRows, referenceId, evidence }) {
  const status = statusOf(row);
  const lifecycle = lifecycleOf(row);
  const origin = originClass(row);

  if (source === "documents" && (status === "DELETED" || origin === "TEST_DEV_DATA")) {
    return {
      classification: "LEGACY_DETACHED_DOCUMENT",
      repairable: false,
      repair_strategy: "authorized_reassociation_only",
      result: "LEGACY_ISOLATED",
      evidence: {
        ...evidence,
        reason_codes: ["PARENT_ABSENT", "CHILD_LOGICALLY_DELETED", "NO_DETERMINISTIC_ID_MAPPING"],
        child_status: status,
        child_lifecycle: lifecycle,
        origin_class: origin,
      },
    };
  }

  // An analysis/report pair with no study parent is a detached historical
  // derivative.  It is not reachable from an active study and is never used
  // for synthesis unless an authorized operator explicitly re-associates it.
  if (source === "analyses" && column === "study_id" && parentRows.some((report) => valueOf(report, "study_id") === referenceId)) {
    return {
      classification: "LEGACY_DETACHED_ANALYSIS",
      repairable: false,
      repair_strategy: "authorized_reassociation_only",
      result: "LEGACY_ISOLATED",
      evidence: {
        ...evidence,
        reason_codes: ["PARENT_ABSENT", "DETACHED_DERIVATIVE_PAIR", "NO_DETERMINISTIC_ID_MAPPING"],
        child_status: status,
        child_lifecycle: lifecycle,
        origin_class: origin,
        paired_report_present: true,
      },
    };
  }

  if (source === "jobs" && status === "COMPLETED") {
    return {
      classification: "LEGACY_DETACHED_JOB",
      repairable: false,
      repair_strategy: "none_terminal_history_only",
      result: "LEGACY_ISOLATED",
      evidence: {
        ...evidence,
        reason_codes: ["PARENT_ABSENT", "TERMINAL_JOB", "NO_DETERMINISTIC_ID_MAPPING"],
        child_status: status,
        child_lifecycle: lifecycle,
        origin_class: origin,
      },
    };
  }

  return {
    classification: "ACTIVE_UNRESOLVED_REFERENCE",
    repairable: false,
    repair_strategy: "manual_review_required",
    result: "ACTIVE_RELEASE_BLOCKER",
    evidence: {
      ...evidence,
      reason_codes: ["PARENT_ABSENT", "NO_DETERMINISTIC_ID_MAPPING"],
      child_status: status,
      child_lifecycle: lifecycle,
      origin_class: origin,
    },
  };
}

/** Build the report without writing anything. `database` may be overridden by
 * isolated tests or a maintenance invocation. */
export function buildFkOrphanReport({ database = path.join(process.cwd(), "data", "database", "eye-ai.db") } = {}) {
  const databasePath = path.resolve(database);
  if (!fs.existsSync(databasePath)) throw new Error(`Database not found: ${databasePath}`);
  const db = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const collections = new Set(RELATIONS.flatMap(([source, , target]) => [source, target]).concat(EXTRA_EVIDENCE_COLLECTIONS));
    const rows = new Map();
    for (const collection of collections) rows.set(collection, readRows(db, collection));
    const byId = new Map([...rows.entries()].map(([collection, values]) => [collection, new Map(values.map((row) => [currentId(row), row]))]));
    const reports = rows.get("reports") ?? [];
    const records = [];
    let crossTenantCount = 0;

    for (const [source, column, target] of RELATIONS) {
      const sourceRows = rows.get(source) ?? [];
      const targetRows = byId.get(target) ?? new Map();
      for (const row of sourceRows) {
        const referenceId = valueOf(row, column);
        if (!referenceId) continue;
        const parent = targetRows.get(referenceId) ?? null;
        const childTenant = valueOf(row, "tenant_id");
        const parentTenant = parent ? valueOf(parent, "tenant_id") : null;
        if (childTenant && parentTenant && childTenant !== parentTenant) crossTenantCount += 1;
        if (parent) continue;

        const classification = classify({
          source,
          column,
          row,
          parentRows: reports,
          referenceId,
          evidence: {
            relation: `${source}.${column}->${target}`,
            parent_exists: false,
            source_bytes_checked: false,
            child_created_at: valueOf(row, "created_at") ?? row.created_at ?? null,
            child_hash_present: Boolean(valueOf(row, "sha256")),
          },
        });
        records.push({
          relation: `${source}.${column}->${target}`,
          child_id: currentId(row),
          child_tenant: childTenant,
          parent_id: referenceId,
          parent_exists: false,
          ...classification,
        });
      }
    }

    const classificationCounts = Object.fromEntries(records.reduce((counts, row) => {
      counts.set(row.classification, (counts.get(row.classification) ?? 0) + 1);
      return counts;
    }, new Map()));
    const relationCounts = Object.fromEntries(records.reduce((counts, row) => {
      counts.set(row.relation, (counts.get(row.relation) ?? 0) + 1);
      return counts;
    }, new Map()));
    return {
      format: "visionscan-fk-orphan-report-v1",
      generated_at: new Date().toISOString(),
      database_file: "<configured-database>",
      relation_count: RELATIONS.length,
      orphan_count: records.length,
      active_orphan_count: records.filter((row) => row.result === "ACTIVE_RELEASE_BLOCKER").length,
      legacy_orphan_count: records.filter((row) => row.result === "LEGACY_ISOLATED").length,
      cross_tenant_count: crossTenantCount,
      classification_counts: classificationCounts,
      relation_counts: relationCounts,
      direct_fk_migration_safe: records.length === 0 && crossTenantCount === 0,
      phi_included: false,
      records,
    };
  } finally {
    db.close();
  }
}

async function main() {
  const outputIndex = process.argv.indexOf("--output");
  const outputArg = outputIndex >= 0 ? process.argv[outputIndex + 1] : "docs/generated/fk-orphan-report.json";
  const report = buildFkOrphanReport({ database: process.env.DATABASE_FILE ?? path.join(process.cwd(), "data", "database", "eye-ai.db") });
  const output = path.resolve(process.cwd(), outputArg);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ output, orphan_count: report.orphan_count, active_orphan_count: report.active_orphan_count, legacy_orphan_count: report.legacy_orphan_count, cross_tenant_count: report.cross_tenant_count }, null, 2));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) await main();
