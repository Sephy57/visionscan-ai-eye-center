#!/usr/bin/env node
/**
 * Evidence-bound active-source forensics and closure planner.
 *
 * The default operation is read-only.  It builds a PHI-minimising ledger for
 * every active source dependency which the release scanner cannot resolve and
 * writes a dry-run plan.  Apply mode is deliberately narrow: it verifies the
 * exact plan, database hash, encrypted-backup manifest, independent review,
 * administrator role and confirmation, then records that there were no
 * approved actions.  No source bytes, application rows or clinical history
 * are changed by this command.  A future recovery/retirement implementation
 * must be copy-on-write and use the same evidence gates.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { buildFkOrphanReport } from "./fk-orphan-report.mjs";

const REPO = process.cwd();
const DATA_ROOT = path.resolve(process.env.DATA_ROOT ?? path.join(REPO, "data"));
const DATABASE_DEFAULT = path.join(DATA_ROOT, "database", "eye-ai.db");
const UPLOAD_ROOT = path.resolve(process.env.UPLOAD_ROOT ?? path.join(DATA_ROOT, "uploads"));
const REPORT_ROOT = path.resolve(process.env.REPORT_ROOT ?? path.join(DATA_ROOT, "reports"));
const LEDGER_DEFAULT = path.join(REPO, "docs", "generated", "active-source-forensics.json");
const PLAN_DEFAULT = path.join(REPO, "docs", "generated", "data-closure-dry-run.json");
const PLAN_FORMAT = "visionscan-data-closure-dry-run-v1";
const LEDGER_FORMAT = "visionscan-active-source-forensics-v1";
const SOURCE_TABLES = ["studies", "analyses", "reports"];
const REF_TABLES = [
  "access_grants", "adjudications", "analyses", "audit_events", "calibration_records",
  "clinician_reviews", "comparisons", "condition_assessments", "consent", "dataset_samples",
  "datasets", "derived_assets", "devices", "document_pages", "documents", "encounters",
  "evidence", "evidence_dependencies", "evaluation_runs", "jobs", "model_error_adjudications",
  "model_errors", "model_executions", "oct_rois", "patients", "reasoning_records",
  "record_extractions", "reconciliation_journal", "reports", "reviews", "sessions",
  "specialist_packages", "studies", "test_results", "transitions", "users", "validation_cases",
];
const RELATIONAL_COLUMNS = ["patient_id", "encounter_id", "study_id", "document_id", "analysis_id", "report_id", "tenant_id", "job_id"];

function arg(flag, fallback = undefined) {
  const exact = process.argv.indexOf(flag);
  if (exact >= 0) return process.argv[exact + 1] ?? fallback;
  const prefix = process.argv.find((value) => value.startsWith(`${flag}=`));
  return prefix === undefined ? fallback : prefix.slice(flag.length + 1);
}

function has(flag) {
  return process.argv.includes(flag) || process.argv.some((value) => value.startsWith(`${flag}=`));
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256File(file) {
  return sha256(fs.readFileSync(file));
}

function parsePayload(value) {
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function safeOpaque(value) {
  return sha256(String(value)).slice(0, 24);
}

function scopeHash(kind, value) {
  return typeof value === "string" && value.trim() ? sha256(`${kind}:${value.trim()}`) : null;
}

function camel(field) {
  return field.replace(/_([a-z])/g, (_, character) => character.toUpperCase());
}

function valueOf(row, field) {
  const payload = row?.payload_object ?? parsePayload(row?.payload);
  const value = row?.[field] ?? payload?.[field] ?? payload?.[camel(field)];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function statusOf(row) {
  const value = valueOf(row, "status");
  return value ? value.toUpperCase() : null;
}

function lifecycleOf(row) {
  const value = String(valueOf(row, "lifecycle") ?? valueOf(row, "archive_state") ?? "").toUpperCase();
  const status = statusOf(row);
  if (value === "DELETED" || status === "DELETED") return "DELETED";
  if (value === "ARCHIVED") return "ARCHIVED";
  return "ACTIVE";
}

function originOf(row) {
  const payload = row?.payload_object ?? parsePayload(row?.payload);
  const source = valueOf(row, "source");
  const actor = [payload.uploaded_by, payload.created_by, payload.owner_username]
    .find((value) => typeof value === "string" && value.trim());
  if (payload.synthetic === true || payload.demo === true || /synthetic|fixture|test/i.test(String(payload.origin ?? ""))) return "SYNTHETIC_MARKER";
  if (typeof actor === "string" && /synthetic|fixture|smoke-admin|test/i.test(actor)) return "TEST_ACTOR_MARKER";
  if (lifecycleOf(row) === "DELETED") return "DELETED_RECORD";
  if (source) return source.toUpperCase();
  return "UNCLASSIFIED";
}

function identifier(value) {
  if (typeof value !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error(`Unsafe SQL identifier: ${value}`);
  return `"${value}"`;
}

function existingTables(db) {
  return new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((row) => String(row.name)));
}

function readRows(db, table) {
  const available = new Set(db.prepare(`PRAGMA table_info(${identifier(table)})`).all().map((row) => String(row.name)));
  const selected = ["id", "payload", "created_at", "updated_at", ...RELATIONAL_COLUMNS].filter((column) => available.has(column));
  if (!selected.includes("id")) return [];
  return db.prepare(`SELECT ${selected.map(identifier).join(", ")} FROM ${identifier(table)}`).all()
    .map((row) => ({ ...row, payload_object: parsePayload(row.payload) }));
}

function allRows(db) {
  const tables = existingTables(db);
  const values = new Map();
  for (const table of REF_TABLES) if (tables.has(table)) values.set(table, readRows(db, table));
  return values;
}

function resolveWithin(root, relative) {
  if (typeof relative !== "string" || relative.length === 0 || relative.includes("\u0000")) return null;
  const normalized = relative.replaceAll("\\", "/");
  if (normalized.startsWith("/") || normalized.startsWith("//") || /^[A-Za-z]:\//.test(normalized)) return null;
  const candidate = path.resolve(root, normalized);
  const rel = path.relative(path.resolve(root), candidate);
  if (rel === "" || rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null;
  return candidate;
}

function isRegularFile(file) {
  try {
    const stat = fs.lstatSync(file);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

function sourceFileStatus(file) {
  const candidate = resolveWithin(UPLOAD_ROOT, file?.relativePath);
  if (!candidate || !isRegularFile(candidate)) return { available: false, path: null, reason: candidate ? "MISSING_OR_UNSAFE" : "INVALID_PATH" };
  const stat = fs.statSync(candidate);
  const actual = sha256File(candidate);
  const expected = typeof file?.sha256 === "string" ? file.sha256.toLowerCase() : null;
  return { available: true, path: candidate, bytes: stat.size, actual_hash: actual, expected_hash: expected, hash_match: !expected || expected === actual };
}

function recursiveFiles(root, rootLabel, output) {
  if (!fs.existsSync(root)) return;
  let rootStat;
  try { rootStat = fs.lstatSync(root); } catch { return; }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return;
  const visit = (dir, relative) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = relative ? path.join(relative, entry.name) : entry.name;
      let stat;
      try { stat = fs.lstatSync(full); } catch { continue; }
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) visit(full, rel);
      else if (stat.isFile()) output.push({ root: rootLabel, absolute: full, relative: rel.replaceAll("\\", "/"), bytes: stat.size });
    }
  };
  visit(root, "");
}

function trustedAssetFiles() {
  const files = [];
  const roots = [
    [path.join(DATA_ROOT, "uploads"), "uploads"],
    [path.join(DATA_ROOT, "documents"), "documents"],
    [path.join(DATA_ROOT, "processed"), "processed"],
    [path.join(DATA_ROOT, "reports"), "reports"],
    [path.join(DATA_ROOT, "quarantine"), "quarantine"],
  ];
  for (const [root, label] of roots) recursiveFiles(root, label, files);
  // Only verified isolated restores under the application data root are
  // searched; arbitrary personal directories are never traversed.
  const restoreRoot = path.join(DATA_ROOT, "restores");
  if (fs.existsSync(restoreRoot)) {
    for (const entry of fs.readdirSync(restoreRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      for (const label of ["uploads", "documents", "processed", "reports", "quarantine"]) {
        recursiveFiles(path.join(restoreRoot, entry.name, "assets", label), `verified_restore:${label}`, files);
      }
    }
  }
  return files;
}

function valueContains(value, target) {
  if (value === target) return true;
  if (Array.isArray(value)) return value.some((item) => valueContains(item, target));
  if (value && typeof value === "object") return Object.values(value).some((item) => valueContains(item, target));
  return false;
}

function dependencySummary(rowsByTable, targetId, entityType, selfId) {
  const summary = {
    downstream_reference_count: 0,
    report_reference_count: 0,
    reasoning_reference_count: 0,
    review_reference_count: 0,
    model_execution_reference_count: 0,
    evidence_reference_count: 0,
    test_result_reference_count: 0,
    record_extraction_reference_count: 0,
    dependency_graph: {
      source: { available: false, replay: "SOURCE_UNAVAILABLE_FOR_REPLAY" },
      document_or_page: 0,
      roi_or_derived_asset: 0,
      analysis: 0,
      model_execution: 0,
      evidence: 0,
      specialist_package: 0,
      reasoning: 0,
      condition_assessment: 0,
      test_result: 0,
      record_extraction: 0,
      report: 0,
      clinician_review: 0,
    },
  };
  const idFields = entityType === "STUDY" ? new Set(["study_id", "studyId"]) : new Set(["analysis_id", "analysisId"]);
  for (const [table, rows] of rowsByTable.entries()) {
    for (const row of rows) {
      if (table === entityType.toLowerCase() && String(row.id) === String(selfId)) continue;
      const payload = row.payload_object ?? parsePayload(row.payload);
      const hit = [...idFields].some((field) => valueContains(payload?.[field], targetId)) || RELATIONAL_COLUMNS.some((field) => row[field] === targetId);
      if (!hit) continue;
      summary.downstream_reference_count += 1;
      if (table === "reports") { summary.report_reference_count += 1; summary.dependency_graph.report += 1; }
      if (table === "reasoning_records" || table === "specialist_packages") { summary.reasoning_reference_count += 1; summary.dependency_graph.reasoning += 1; }
      if (table === "clinician_reviews" || table === "reviews") { summary.review_reference_count += 1; summary.dependency_graph.clinician_review += 1; }
      if (table === "model_executions") { summary.model_execution_reference_count += 1; summary.dependency_graph.model_execution += 1; }
      if (table === "evidence" || table === "evidence_dependencies") { summary.evidence_reference_count += 1; summary.dependency_graph.evidence += 1; }
      if (table === "test_results") { summary.test_result_reference_count += 1; summary.dependency_graph.test_result += 1; }
      if (table === "record_extractions") { summary.record_extraction_reference_count += 1; summary.dependency_graph.record_extraction += 1; }
      if (table === "documents" || table === "document_pages") summary.dependency_graph.document_or_page += 1;
      if (table === "derived_assets" || table === "oct_rois") summary.dependency_graph.roi_or_derived_asset += 1;
      if (table === "analyses") summary.dependency_graph.analysis += 1;
      if (table === "condition_assessments") summary.dependency_graph.condition_assessment += 1;
    }
  }
  return summary;
}

function auditHistory(studyIds) {
  const byStudy = new Map([...studyIds].map((id) => [id, { matching_event_count: 0, upload_ok: 0, delete_events: 0, analyze_events: 0, hash_valid_events: 0 }]));
  const files = fs.existsSync(path.join(DATA_ROOT, "logs"))
    ? fs.readdirSync(path.join(DATA_ROOT, "logs")).filter((name) => /^audit-.*\.ndjson$/i.test(name)).sort()
    : [];
  const brokenBranches = [];
  let total = 0;
  for (const name of files) {
    const file = path.join(DATA_ROOT, "logs", name);
    let previousHash = null;
    let lineNumber = 0;
    let lines = [];
    try { lines = fs.readFileSync(file, "utf8").split(/\r?\n/); } catch { continue; }
    for (const line of lines) {
      if (!line.trim()) continue;
      lineNumber += 1;
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      total += 1;
      if (previousHash && event.prev_hash && event.prev_hash !== previousHash) brokenBranches.push(`${name}:${lineNumber}`);
      if (typeof event.hash === "string" && /^[a-f0-9]{64}$/i.test(event.hash)) previousHash = event.hash;
      const studyId = typeof event.studyId === "string" ? event.studyId : (typeof event.study_id === "string" ? event.study_id : null);
      if (!studyId || !byStudy.has(studyId)) continue;
      const summary = byStudy.get(studyId);
      summary.matching_event_count += 1;
      if (typeof event.hash === "string" && /^[a-f0-9]{64}$/i.test(event.hash) && typeof event.prev_hash === "string" && /^[a-f0-9]{64}$/i.test(event.prev_hash)) summary.hash_valid_events += 1;
      const action = String(event.action ?? "").toLowerCase();
      if (action === "upload" || action.includes("upload")) summary.upload_ok += event.outcome === "ok" ? 1 : 0;
      // Count the study-level deletion event only.  Child `document.deleted`
      // cleanup events are downstream evidence, not proof that the study
      // itself was retired.
      if (action === "delete") summary.delete_events += 1;
      if (action === "analyze" || action.includes("analy")) summary.analyze_events += 1;
    }
  }
  // A broken branch means event hashes are useful evidence only for the
  // individual event; it is not treated as proof of a complete history.
  return {
    total_events: total,
    matched_study_count: [...byStudy.values()].filter((value) => value.matching_event_count > 0).length,
    matching_event_count: [...byStudy.values()].reduce((sum, value) => sum + value.matching_event_count, 0),
    upload_ok_study_count: [...byStudy.values()].filter((value) => value.upload_ok > 0).length,
    delete_event_study_count: [...byStudy.values()].filter((value) => value.delete_events > 0).length,
    broken_branch_count: brokenBranches.length,
    broken_branches: brokenBranches.slice(0, 20),
    chain_status: brokenBranches.length > 0 ? "BROKEN_BRANCH" : "CONTINUOUS_WITHIN_FILES",
    by_study: byStudy,
  };
}

function classifyMissingStudy(row, file, dependency) {
  const payload = row.payload_object ?? parsePayload(row.payload);
  const status = statusOf(row);
  const origin = originOf(row);
  const explicitIncomplete = ["UPLOADING", "PROCESSING", "INCOMPLETE", "FAILED_UPLOAD", "FAILED"].includes(status);
  if (origin === "SYNTHETIC_MARKER") return { classification: "SYNTHETIC_TEST_RECORD", allowed_action: "RETIRE_ONLY_WITH_EVIDENCE" };
  if (explicitIncomplete) return { classification: "ACTIVE_INCOMPLETE_UPLOAD", allowed_action: dependency.downstream_reference_count === 0 ? "MANUAL_REVIEW_REQUIRED" : "KEEP_BLOCKED" };
  // A missing byte plus an old delete event is not enough to prove a modern
  // lifecycle transition.  Keep the finding blocked and explicitly require
  // manual adjudication rather than relabelling it to improve a metric.
  return { classification: "UNKNOWN_REQUIRES_REVIEW", allowed_action: "KEEP_BLOCKED" };
}

function expectedHashOf(row, file) {
  const payload = row.payload_object ?? parsePayload(row.payload);
  const value = file?.sha256 ?? payload.original_sha256;
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : null;
}

function makeFindingId(kind, entityId, sourceHash, ordinal = "0") {
  return `finding_${sha256(`${kind}\u0000${entityId}\u0000${sourceHash ?? "none"}\u0000${ordinal}`).slice(0, 24)}`;
}

function buildFindings(db) {
  const rowsByTable = allRows(db);
  const studies = rowsByTable.get("studies") ?? [];
  const analyses = rowsByTable.get("analyses") ?? [];
  const studyIds = new Set(studies.map((row) => String(row.id)));
  const missingStudyIds = new Set();
  let audit = null;
  const findings = [];
  for (const row of studies) {
    if (lifecycleOf(row) !== "ACTIVE") continue;
    const payload = row.payload_object ?? parsePayload(row.payload);
    const files = Array.isArray(payload.files) ? payload.files : [];
    files.forEach((file, index) => {
      const source = sourceFileStatus(file);
      if (source.available && source.hash_match !== false) return;
      const studyId = String(row.id);
      const expectedHash = expectedHashOf(row, file);
      const dependency = dependencySummary(rowsByTable, studyId, "STUDY", studyId);
      const classification = classifyMissingStudy(row, file, dependency);
      missingStudyIds.add(studyId);
      findings.push({
        finding_id: makeFindingId("study", studyId, expectedHash, String(index)),
        entity_type: "STUDY_SOURCE",
        entity_id: studyId,
        tenant_scope_hash_or_safe_id: scopeHash("tenant", valueOf(row, "tenant_id")),
        patient_scope_hash_or_safe_id: scopeHash("patient", valueOf(row, "patient_id")),
        study_id: studyId,
        document_id: null,
        analysis_id: null,
        expected_source_hash: expectedHash,
        expected_source_path_class: "UPLOAD_ORIGINAL",
        source_created_at: file?.storedAt ?? payload.created_at ?? row.created_at ?? null,
        record_created_at: row.created_at ?? payload.created_at ?? null,
        record_updated_at: row.updated_at ?? payload.updated_at ?? null,
        origin: originOf(row),
        current_lifecycle_state: "ACTIVE_REQUIRED_SOURCE",
        ...dependency,
        candidate_recovery_count: 0,
        classification: classification.classification,
        classification_evidence: {
          source_record_exists: true,
          source_expected: true,
          source_bytes_available_at_canonical_path: source.available,
          canonical_path_metadata_present: Boolean(file?.relativePath),
          expected_hash_present: Boolean(expectedHash),
          status: statusOf(row),
          lifecycle: lifecycleOf(row),
          origin: originOf(row),
          synthetic_marker: originOf(row) === "SYNTHETIC_MARKER",
          deletion_marker: lifecycleOf(row) === "DELETED",
          exact_hash_checked: false,
          tenant_scope_verified: Boolean(valueOf(row, "tenant_id")),
          patient_scope_verified: Boolean(valueOf(row, "patient_id")),
          filename_only_recovery_allowed: false,
          date_only_recovery_allowed: false,
          replay_status: "SOURCE_UNAVAILABLE_FOR_REPLAY",
          new_reasoning_eligible: false,
          audit_history: null,
          evidence_gaps: ["source_bytes_not_at_canonical_path", "no_provenance_consistent_candidate_observed"],
        },
        allowed_action: classification.allowed_action,
        action_result: "UNCHANGED",
        review_status: "UNREVIEWED",
      });
    });
  }
  for (const row of analyses) {
    if (lifecycleOf(row) !== "ACTIVE") continue;
    const studyId = valueOf(row, "study_id");
    if (!studyId || studyIds.has(studyId)) continue;
    const analysisId = String(row.id);
    const dependency = dependencySummary(rowsByTable, analysisId, "ANALYSIS", analysisId);
    const payload = row.payload_object ?? parsePayload(row.payload);
    findings.push({
      finding_id: makeFindingId("analysis", analysisId, null),
      entity_type: "ANALYSIS_PARENT",
      entity_id: analysisId,
      tenant_scope_hash_or_safe_id: scopeHash("tenant", valueOf(row, "tenant_id")),
      patient_scope_hash_or_safe_id: scopeHash("patient", valueOf(row, "patient_id")),
      study_id: studyId,
      document_id: null,
      analysis_id: analysisId,
      expected_source_hash: null,
      expected_source_path_class: "REQUIRED_PARENT_STUDY_SOURCE",
      source_created_at: payload.created_at ?? row.created_at ?? null,
      record_created_at: row.created_at ?? payload.created_at ?? null,
      record_updated_at: row.updated_at ?? payload.updated_at ?? null,
      origin: originOf(row),
      current_lifecycle_state: "ACTIVE_REQUIRED_SOURCE",
      ...dependency,
      candidate_recovery_count: 0,
      classification: "DERIVATIVE_WITHOUT_REQUIRED_PARENT",
      classification_evidence: {
        source_record_exists: false,
        source_expected: true,
        source_bytes_available_at_canonical_path: false,
        canonical_path_metadata_present: false,
        expected_hash_present: false,
        status: statusOf(row),
        lifecycle: lifecycleOf(row),
        origin: originOf(row),
        parent_study_id: studyId,
        parent_exists: false,
        exact_hash_checked: false,
        filename_only_recovery_allowed: false,
        date_only_recovery_allowed: false,
        replay_status: "SOURCE_UNAVAILABLE_FOR_REPLAY",
        new_reasoning_eligible: false,
        evidence_gaps: ["required_parent_study_missing", "analysis_is_derivative_and_cannot_be_promoted_to_source"],
      },
      allowed_action: "KEEP_BLOCKED",
      action_result: "UNCHANGED",
      review_status: "UNREVIEWED",
    });
  }
  audit = auditHistory(missingStudyIds);
  for (const finding of findings) {
    if (finding.entity_type !== "STUDY_SOURCE") continue;
    const history = audit.by_study.get(finding.study_id) ?? { matching_event_count: 0, upload_ok: 0, delete_events: 0, analyze_events: 0, hash_valid_events: 0 };
    finding.classification_evidence.audit_history = { ...history, chain_status: audit.chain_status };
    if (history.delete_events > 0) finding.classification_evidence.evidence_gaps.push("legacy_delete_event_has_no_matching_modern_lifecycle_state");
  }
  findings.sort((left, right) => left.finding_id.localeCompare(right.finding_id));
  return { findings, rowsByTable, audit };
}

function candidateMatches(finding, file, actualHash) {
  if (!finding.expected_source_hash) return { match: false, reason: "NO_EXPECTED_HASH" };
  if (file.bytes === undefined) return { match: false, reason: "UNREADABLE_SIZE" };
  if (actualHash === null) return { match: false, reason: "UNREADABLE_FILE" };
  if (actualHash !== finding.expected_source_hash) return { match: false, reason: "HASH_MISMATCH" };
  // A matching digest is necessary but not sufficient.  For originals, the
  // candidate path must carry the exact study scope; a bare filename match is
  // explicitly rejected.  Quarantine and derived roots have no such proof.
  const scoped = (file.root === "uploads" || file.root === "verified_restore:uploads") && file.relative.split("/")[0] === finding.study_id;
  if (!scoped) return { match: false, reason: "SCOPE_OR_PROVENANCE_UNPROVEN" };
  const ext = path.extname(file.relative).toLowerCase();
  if (finding.expected_source_path_class === "UPLOAD_ORIGINAL" && ![".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".dcm"].includes(ext)) return { match: false, reason: "INCOMPATIBLE_ASSET_TYPE" };
  return { match: true, reason: "EXACT_HASH_SCOPE_AND_TYPE" };
}

function searchCandidates(findings) {
  const files = trustedAssetFiles();
  const hashes = new Map();
  for (const file of files) {
    try { hashes.set(file.absolute, sha256File(file.absolute)); } catch { hashes.set(file.absolute, null); }
  }
  const rejected = new Map();
  let exactHashMatches = 0;
  let exactHashMatchesRejected = 0;
  for (const finding of findings) {
    if (!finding.expected_source_hash) continue;
    let count = 0;
    let hashMatches = 0;
    let rejectedExact = 0;
    for (const file of files) {
      const result = candidateMatches(finding, file, hashes.get(file.absolute));
      if (result.match) count += 1;
      if (hashes.get(file.absolute) === finding.expected_source_hash) {
        hashMatches += 1;
        exactHashMatches += 1;
        if (!result.match) rejectedExact += 1;
        if (!result.match) exactHashMatchesRejected += 1;
      }
      else if (result.reason !== "HASH_MISMATCH") rejected.set(result.reason, (rejected.get(result.reason) ?? 0) + 1);
    }
    finding.candidate_recovery_count = count;
    finding.classification_evidence.exact_hash_checked = true;
    finding.classification_evidence.exact_hash_candidates = count;
    finding.classification_evidence.exact_hash_matches_rejected_for_scope_or_provenance = rejectedExact;
    finding.classification_evidence.exact_hash_matches_total = hashMatches;
    if (count > 0) {
      finding.classification_evidence.evidence_gaps = ["two_person_review_required_before_copy_on_write_recovery"];
      finding.allowed_action = "RECOVER_ONLY_AFTER_TWO_PERSON_REVIEW";
      finding.classification = "ACTIVE_REQUIRED_SOURCE";
    }
  }
  return { files_scanned: files.length, exact_hash_matches: exactHashMatches, exact_hash_matches_rejected_for_scope_or_provenance: exactHashMatchesRejected, rejected_candidate_reasons: Object.fromEntries(rejected), trusted_roots: ["uploads", "documents", "processed", "reports", "quarantine", "verified isolated restores"] };
}

function rowCounts(db) {
  const counts = {};
  for (const table of existingTables(db)) {
    try { counts[table] = Number(db.prepare(`SELECT COUNT(*) AS count FROM ${identifier(table)}`).get().count); } catch { /* ignore a concurrently removed table */ }
  }
  return counts;
}

function metaValue(db, key) {
  try { return db.prepare("SELECT value FROM persistence_meta WHERE key=?").get(key)?.value ?? null; } catch { return null; }
}

function sourceCounts(db) {
  const rowsByTable = allRows(db);
  const studies = rowsByTable.get("studies") ?? [];
  const analyses = rowsByTable.get("analyses") ?? [];
  const reports = rowsByTable.get("reports") ?? [];
  let active = 0;
  let legacy = 0;
  let hashMismatch = 0;
  const reasons = {};
  const add = (bucket, reason) => { const key = `${bucket}:${reason}`; reasons[key] = (reasons[key] ?? 0) + 1; if (bucket === "active") active += 1; else legacy += 1; };
  const studyIds = new Set(studies.map((row) => String(row.id)));
  for (const row of studies) {
    const payload = row.payload_object ?? parsePayload(row.payload);
    const files = Array.isArray(payload.files) ? payload.files : [];
    for (const file of files) {
      const status = sourceFileStatus(file);
      if (!status.available) add(lifecycleOf(row) === "DELETED" ? "legacy" : "active", "MISSING_REQUIRED_ARTIFACT");
      else if (status.hash_match === false) hashMismatch += 1;
    }
  }
  for (const row of analyses) if (valueOf(row, "study_id") && !studyIds.has(valueOf(row, "study_id"))) add(lifecycleOf(row) === "DELETED" ? "legacy" : "active", "DETACHED_ANALYSIS_PARENT");
  for (const row of reports) {
    const reportId = String(row.id);
    const reportPath = path.join(REPORT_ROOT, `${reportId}.json`);
    if (!isRegularFile(reportPath)) add(lifecycleOf(row) === "DELETED" ? "legacy" : "active", "MISSING_REPORT_EXPORT");
  }
  return { active_unresolved_sources: active, legacy_unresolved_sources: legacy, hash_mismatch_count: hashMismatch, source_reason_counts: reasons };
}

function quarantineCount() {
  const root = path.join(DATA_ROOT, "quarantine", "reconciliation");
  const files = [];
  recursiveFiles(root, "quarantine", files);
  return files.length;
}

function canonical(value) {
  return JSON.stringify(value, Object.keys(value).sort());
}

function planDigest(plan) {
  const copy = JSON.parse(JSON.stringify(plan));
  delete copy.generated_at;
  delete copy.plan_digest;
  if (copy.ledger && typeof copy.ledger === "object") delete copy.ledger.generated_at;
  return sha256(JSON.stringify(copy));
}

function buildPlan(database, ledger, search) {
  const integrity = ledger.database.integrity_check;
  const counts = {
    total_findings: ledger.records.length,
    recoverable: ledger.records.filter((row) => row.candidate_recovery_count > 0).length,
    retireable: ledger.records.filter((row) => ["SYNTHETIC_TEST_RECORD", "ACTIVE_INCOMPLETE_UPLOAD", "DELETED_USER_RECORD_RESIDUE"].includes(row.classification) && row.allowed_action !== "KEEP_BLOCKED").length,
    active_lost: ledger.records.filter((row) => row.classification === "ACTIVE_SOURCE_LOST" || row.classification === "DERIVATIVE_WITHOUT_REQUIRED_PARENT").length,
    ambiguous: ledger.records.filter((row) => row.classification === "UNKNOWN_REQUIRES_REVIEW").length,
    legacy: 0,
    unchanged: ledger.records.filter((row) => row.action_result === "UNCHANGED").length,
  };
  const plan = {
    format: PLAN_FORMAT,
    generated_at: new Date().toISOString(),
    database: { file: "<configured-database>", sha256: ledger.database.sha256, content_sha256: ledger.database.sha256, integrity_check: integrity, schema_version: ledger.database.schema_version, migration_version: ledger.database.migration_version },
    ledger: { file: "docs/generated/active-source-forensics.json", sha256: sha256(JSON.stringify({ ...ledger, generated_at: undefined })) },
    counts,
    actions: ledger.records.map((record) => ({ finding_id: record.finding_id, action: record.action_result === "UNCHANGED" ? "KEEP_BLOCKED" : record.action_result, classification: record.classification })),
    search,
    mutation: { performed: false, source_rows_changed: 0, source_files_changed: 0, audit_events_written: 0 },
    preconditions: { verified_backup_required: true, backup_id_required: true, expected_database_sha256_required: true, independent_review_artifact_required: true, admin_role_required: true, confirmation_required: true },
    phi_included: false,
    credentials_included: false,
  };
  plan.plan_digest = planDigest(plan);
  return plan;
}

function buildLedger(database, findings, search, audit = null) {
  const db = new Database(database, { readonly: true, fileMustExist: true });
  try {
    const integrity = db.pragma("integrity_check", { simple: true });
    const source = sourceCounts(db);
    const ledger = {
      format: LEDGER_FORMAT,
      generated_at: new Date().toISOString(),
      database: { file: "<configured-database>", sha256: sha256File(database), integrity_check: integrity, schema_version: metaValue(db, "schema_version"), migration_version: metaValue(db, "migration_version") },
      records: findings,
      counts: { total: findings.length, classification_counts: Object.fromEntries(findings.reduce((m, row) => m.set(row.classification, (m.get(row.classification) ?? 0) + 1), new Map())), source_summary: source },
      trusted_storage_search: search,
      creation_history: audit ? { total_audit_events: audit.total_events, matching_event_count: audit.matching_event_count, upload_ok_study_count: audit.upload_ok_study_count, delete_event_study_count: audit.delete_event_study_count, chain_status: audit.chain_status, broken_branches: audit.broken_branches } : null,
      policy: { exact_sha256_and_scope_required: true, filename_only_recovery: false, date_only_recovery: false, derivative_as_source: false, copy_on_write: true, two_person_review: true, no_active_relabel_without_evidence: true, missing_source_excluded_from_new_reasoning: true },
      phi_included: false,
    };
    return ledger;
  } finally { db.close(); }
}

function writeJsonExclusiveOrReplace(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(file, label) {
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!value || typeof value !== "object") throw new Error("not an object");
    return value;
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${String(error)}`);
  }
}

function validateBackup(manifestPath, expectedHash) {
  const manifest = readJson(manifestPath, "Backup manifest");
  if (!manifest || !["visionscan-data-backup-v1", "visionscan-closure-backup-v1"].includes(manifest.format)) throw new Error("Unsupported backup manifest");
  if (manifest.credentials_included !== false) throw new Error("Backup credentials_included must be false");
  if (manifest.database?.sha256 !== expectedHash || manifest.database?.integrity_check !== "ok") throw new Error("Backup database hash/integrity does not match expected precondition");
  const payload = path.resolve(path.dirname(manifestPath), manifest.database.backup_file ?? manifest.database.file_name ?? "eye-ai.db");
  if (manifest.database.backup_sha256 && (!isRegularFile(payload) || sha256File(payload) !== manifest.database.backup_sha256)) throw new Error("Backup database payload hash mismatch");
  return { backup_id: manifest.backup_id ?? path.basename(path.dirname(path.resolve(manifestPath))), manifest_sha256: sha256File(manifestPath), created_at: manifest.created_at ?? null, asset_count: manifest.assets?.asset_count ?? null, database_sha256: manifest.database.sha256, integrity_check: manifest.database.integrity_check };
}

function validateReview(file, digest) {
  const review = readJson(file, "Review artifact");
  if (review.format !== "visionscan-data-closure-review-v1" || review.plan_digest !== digest || review.decision !== "APPROVED" || review.reviewer_role !== "INDEPENDENT_DATA_REVIEWER") throw new Error("Review artifact is not an approval for this plan");
  const safety = review.safety_findings;
  if (!safety || safety.fabricated_bytes !== false || safety.guessed_relationships !== false || safety.gate_weakened !== false || safety.active_records_relabelled !== false) throw new Error("Review artifact does not establish required safety findings");
  if (review.implementation_reviewer && review.implementation_reviewer === review.independent_verifier) throw new Error("Implementation reviewer and independent verifier must be distinct");
  return { sha256: sha256File(file), reviewer_role: review.reviewer_role };
}

function applyPlan(database, planFile) {
  const plan = readJson(planFile, "Closure plan");
  if (plan.format !== PLAN_FORMAT || typeof plan.plan_digest !== "string" || planDigest(plan) !== plan.plan_digest) throw new Error("Closure plan digest mismatch; refuse tampered plan");
  const expectedHash = String(arg("--expected-db-sha256", ""));
  if (!/^[a-f0-9]{64}$/i.test(expectedHash) || expectedHash !== plan.database?.sha256) throw new Error("--expected-db-sha256 must exactly match the plan database hash");
  const role = String(arg("--actor-role", process.env.VISIONSCAN_MIGRATION_ACTOR_ROLE ?? "")).toUpperCase();
  if (role !== "ADMIN") throw new Error("Data closure apply requires actor role ADMIN");
  if (arg("--confirm") !== "APPLY_DATA_CLOSURE") throw new Error("Explicit confirmation required: APPLY_DATA_CLOSURE");
  const backupArg = arg("--backup-id") ?? arg("--backup-manifest");
  if (!backupArg) throw new Error("--backup-id <verified backup directory or id> is required");
  const backupPath = path.resolve(backupArg);
  const manifestPath = backupPath.toLowerCase().endsWith("manifest.json") ? backupPath : path.join(backupPath, "manifest.json");
  if (!isRegularFile(manifestPath)) throw new Error("Verified backup manifest is missing");
  const backup = validateBackup(manifestPath, expectedHash);
  const reviewFile = arg("--review-artifact");
  if (!reviewFile) throw new Error("--review-artifact <json> is required");
  const review = validateReview(path.resolve(reviewFile), plan.plan_digest);
  if (!isRegularFile(database) || sha256File(database) !== expectedHash) throw new Error("Database changed since dry run; refuse stale plan");
  const actions = Array.isArray(plan.actions) ? plan.actions : [];
  const nonNoop = actions.filter((action) => action?.action !== "KEEP_BLOCKED" && action?.action !== "UNCHANGED");
  if (nonNoop.length > 0) throw new Error("This release-closure apply contains actions requiring a separately reviewed recovery/retirement transaction");
  const result = { status: "NO_ACTIONS_APPLIED", plan_digest: plan.plan_digest, database_sha256: expectedHash, backup_id: backup.backup_id, review_artifact_sha256: review.sha256, actor_role: role, actions_considered: actions.length, actions_applied: 0, source_rows_changed: 0, source_files_changed: 0, credentials_included: false, phi_included: false };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function buildSnapshot(database, outputFile, backupDir) {
  const db = new Database(database, { readonly: true, fileMustExist: true });
  try {
    const fk = buildFkOrphanReport({ database });
    const source = sourceCounts(db);
    const manifestPath = backupDir ? path.resolve(backupDir, "manifest.json") : null;
    const manifest = manifestPath && isRegularFile(manifestPath) ? readJson(manifestPath, "Backup manifest") : null;
    const snapshot = {
      format: "visionscan-pre-migration-snapshot-v1",
      generated_at: new Date().toISOString(),
      repository: { branch: "main", starting_head: process.env.CLOSURE_STARTING_HEAD ?? "d1d17d6ff451bc5d945976db3d37c6015701eee3" },
      database: { file: "<configured-database>", sha256: sha256File(database), integrity_check: db.pragma("integrity_check", { simple: true }), schema_version: metaValue(db, "schema_version"), migration_version: metaValue(db, "migration_version"), row_counts: rowCounts(db) },
      source_counts: source,
      fk_counts: { active_orphan_count: fk.active_orphan_count, legacy_orphan_count: fk.legacy_orphan_count, cross_tenant_count: fk.cross_tenant_count, classification_counts: fk.classification_counts },
      quarantine_count: quarantineCount(),
      release_status: "BLOCKERS_REMAIN",
      verified_backup: manifest ? { backup_id: manifest.backup_id ?? path.basename(path.dirname(manifestPath)), manifest_sha256: sha256File(manifestPath), created_at: manifest.created_at ?? null, source_database_sha256: manifest.database?.sha256 ?? null, schema_version: manifest.database?.schema_version ?? null, migration_version: manifest.database?.migration_version ?? null, integrity_check: manifest.database?.integrity_check ?? null, asset_count: manifest.assets?.asset_count ?? null, credentials_included: manifest.credentials_included ?? false } : null,
      phi_included: false,
    };
    writeJsonExclusiveOrReplace(outputFile, snapshot);
    process.stdout.write(`${JSON.stringify({ output: outputFile, ...snapshot }, null, 2)}\n`);
  } finally { db.close(); }
}

const database = path.resolve(arg("--database", process.env.DATABASE_FILE ?? DATABASE_DEFAULT));
if (!isRegularFile(database)) throw new Error(`Database not found: ${database}`);
if (has("--snapshot")) {
  buildSnapshot(database, path.resolve(arg("--snapshot-output", path.join(REPO, "docs", "generated", `pre-migration-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}.json`))), arg("--backup-id"));
  process.exit(0);
}
if (has("--apply")) {
  applyPlan(database, path.resolve(arg("--plan", PLAN_DEFAULT)));
  process.exit(0);
}

const outputLedger = path.resolve(arg("--ledger-output", LEDGER_DEFAULT));
const outputPlan = path.resolve(arg("--output", PLAN_DEFAULT));
const db = new Database(database, { readonly: true, fileMustExist: true });
let built;
try {
  built = buildFindings(db);
} finally { db.close(); }
const search = searchCandidates(built.findings);
const ledger = buildLedger(database, built.findings, search, built.audit);
if (ledger.records.length !== 235 && !process.env.CLOSURE_ALLOW_FIXTURE_COUNT) throw new Error(`Expected 235 active findings; observed ${ledger.records.length}`);
writeJsonExclusiveOrReplace(outputLedger, ledger);
const plan = buildPlan(database, ledger, search);
writeJsonExclusiveOrReplace(outputPlan, plan);
process.stdout.write(`${JSON.stringify({ status: "dry_run", dry_run: true, ledger: outputLedger, output: outputPlan, plan_digest: plan.plan_digest, counts: plan.counts, search: plan.search, mutation: plan.mutation, credentials_included: false, phi_included: false }, null, 2)}\n`);
