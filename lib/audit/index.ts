import fs from "fs/promises";
import path from "path";
import { createHash } from "crypto";
import { LOG_ROOT, ensureDirs } from "../config";
import { incrementMetric } from "../observability/metrics";

/**
 * Audit logging. NDJSON, one file per day, stored on D: under data/logs.
 *
 * Privacy rules enforced here:
 *  - NEVER log raw images, image bytes, or image URLs
 *  - NEVER log full medical reports or raw finding payloads
 *  - NEVER log secrets, tokens, or credentials
 * Only event metadata: who/what/when/which study id/which action.
 *
 * TAMPER EVIDENCE: every event is hash-chained (prev_hash + this event's
 * canonical JSON -> sha256 -> hash). verifyAuditChain() replays the chain
 * chronologically across all files and reports the first break, so a
 * modified or deleted line downstream of it is detectable. This is
 * detection, not prevention - the process account that writes these files
 * can still edit them at the OS level; genuine write-once storage requires
 * external infrastructure (see docs/PHASE5B_SECURITY.md).
 */

export interface AuditEvent {
  ts: string;
  actor: string;         // role or user id (never credentials)
  action: string;        // e.g. "upload", "analyze", "review.finalize", "delete"
  role?: string;          // the actor's role at the time of the action, when known
  resource?: string;      // resource type, e.g. "study", "model", "user"
  resourceId?: string;    // opaque id of the resource acted on
  studyId?: string;      // opaque id only (kept for backward compatibility with existing callers)
  outcome: "ok" | "error" | "rejected";
  detail?: string;       // short, non-sensitive summary only
  sessionId?: string;     // opaque session identifier (never the raw token)
  prev_hash?: string;
  hash?: string;
}

const FORBIDDEN = [
  /data:image/i,
  /base64/i,
  /BEGIN (RSA |EC )?PRIVATE/,
  /authorization/i,
  /bearer /i,
  /password/i,
  // Raw document / OCR content must never reach the audit log (S0.4).
  /%PDF-/,
  /\bextractedText\b/i,
  /\brawDocument\b/i,
  /\bocrText\b/i,
  /\bdocumentText\b/i,
];
const GENESIS_HASH = "0".repeat(64);

/**
 * PHI label patterns for document/OCR-era audit safety (S0.4). A value that
 * FOLLOWS one of these labels is redacted individually while the rest of the
 * metadata string survives - the objective is "no PHI in audit logs", not
 * "replace every string with [REDACTED]".
 */
const PHI_LABELS = [
  "patient name", "patient", "dob", "date of birth", "mrn", "medical record number",
  "accession", "address", "phone", "telephone", "email", "e-mail",
  "diagnosis", "medication", "medications", "clinical notes", "clinical note",
  "ssn", "social security", "insurance",
];
const PHI_LABEL_RX = new RegExp(
  `\\b(${PHI_LABELS.join("|")})\\b\\s*[:=]\\s*([^;\\n,]*?)(?=\\s\\w+=|[;\\n,]|$)`,
  "gi",
);
const EMAIL_RX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHI_VALUE_PLACEHOLDER = "[redacted]";

function redactLabeledPhi(d: string): string {
  return d.replace(PHI_LABEL_RX, (_m, label: string) => `${label.trim()}: ${PHI_VALUE_PLACEHOLDER}`).replace(EMAIL_RX, PHI_VALUE_PLACEHOLDER);
}

export function sanitizeDetail(detail?: string): string | undefined {
  if (!detail) return undefined;
  let d = detail.slice(0, 300);
  d = redactLabeledPhi(d);
  for (const rx of FORBIDDEN) {
    if (rx.test(d)) return "[redacted - potential sensitive content]";
  }
  return d;
}

function chainFileNames(): Promise<string[]> {
  return fs.readdir(LOG_ROOT).then(
    (names) => names.filter((f) => f.startsWith("audit-") && f.endsWith(".ndjson")).sort(),
    () => []
  );
}

let lastHashCache: string | null = null;

async function getLastHash(): Promise<string> {
  if (lastHashCache) return lastHashCache;
  ensureDirs();
  const names = await chainFileNames();
  for (const name of names.slice().reverse()) {
    const raw = await fs.readFile(path.join(LOG_ROOT, name), "utf8").catch(() => "");
    const lines = raw.trim().length ? raw.trim().split("\n") : [];
    for (const line of lines.reverse()) {
      try {
        const e = JSON.parse(line) as AuditEvent;
        if (e.hash) { lastHashCache = e.hash; return e.hash; }
      } catch { /* skip malformed line */ }
    }
  }
  lastHashCache = GENESIS_HASH;
  return GENESIS_HASH;
}

function computeHash(prevHash: string, event: Omit<AuditEvent, "hash">): string {
  return createHash("sha256").update(prevHash + JSON.stringify(event)).digest("hex");
}

// Serializes all audit() calls within this process, exactly like
// lib/storage/db.ts's writeChain - without this, two audit() calls that
// overlap in-flight (e.g. two concurrent requests) can both read the same
// "last hash" before either has written, forking the chain. This makes the
// chain correct WITHIN one process. A separate OS process (e.g. running the
// dev server and the test suite at the same time against the same log
// files) is a different writer entirely and is NOT covered by this queue -
// see docs/PHASE5B_SECURITY.md for the documented single-process assumption.
let auditWriteChain: Promise<void> = Promise.resolve();

export function audit(event: Omit<AuditEvent, "ts" | "prev_hash" | "hash">): Promise<void> {
  // Metrics use only bounded, allow-listed labels; audit detail never enters
  // the operational snapshot. Security events are counted without identifiers.
  if (event.action.startsWith("authz.") || event.action.startsWith("auth.")) {
    incrementMetric("security_events", { outcome: event.outcome, stage: "authz" });
  }
  const task = auditWriteChain.then(async () => {
    ensureDirs();
    const base: Omit<AuditEvent, "hash"> = { ts: new Date().toISOString(), ...event, prev_hash: await getLastHash() };
    base.detail = sanitizeDetail(base.detail);
    const hash = computeHash(base.prev_hash!, base);
    const e: AuditEvent = { ...base, hash };
    lastHashCache = hash;
    const name = `audit-${e.ts.slice(0, 10)}.ndjson`;
    const file = path.join(LOG_ROOT, name);
    await fs.appendFile(file, JSON.stringify(e) + "\n", "utf8");
  });
  auditWriteChain = task.catch(() => {}); // one failed write must not wedge the queue for later events
  return task;
}

export interface AuditChainVerification {
  valid: boolean;
  events_checked: number;
  legacy_unchained_entries?: number;
  broken_at?: { file: string; line: number; reason: string };
}

/**
 * Replay the hash chain chronologically and report the first break, if any.
 * Lines written before hash-chaining was introduced have no `hash` field -
 * they are honestly skipped as unverifiable legacy entries (not treated as
 * tampering), and the chain is validated starting from the first hashed
 * entry onward.
 */
export async function verifyAuditChain(): Promise<AuditChainVerification> {
  ensureDirs();
  const names = await chainFileNames();
  let prev: string | null = null;
  let count = 0;
  let legacyUnchained = 0;
  for (const name of names) {
    const raw = await fs.readFile(path.join(LOG_ROOT, name), "utf8").catch(() => "");
    const lines = raw.trim().length ? raw.trim().split("\n") : [];
    for (let i = 0; i < lines.length; i++) {
      let e: AuditEvent;
      try {
        e = JSON.parse(lines[i]);
      } catch {
        return { valid: false, events_checked: count, broken_at: { file: name, line: i + 1, reason: "malformed JSON line" } };
      }
      if (!e.hash) { legacyUnchained++; continue; } // pre-hash-chain entry - not part of the verifiable chain
      const expectedPrev = prev ?? GENESIS_HASH;
      if (e.prev_hash !== expectedPrev) {
        return { valid: false, events_checked: count, broken_at: { file: name, line: i + 1, reason: "prev_hash does not match the running chain" } };
      }
      const { hash: storedHash, ...withoutHash } = e;
      const recomputed = computeHash(e.prev_hash ?? GENESIS_HASH, withoutHash);
      if (recomputed !== storedHash) {
        return { valid: false, events_checked: count, broken_at: { file: name, line: i + 1, reason: "stored hash does not match recomputed hash - event was modified" } };
      }
      prev = storedHash!;
      count++;
    }
  }
  return { valid: true, events_checked: count, legacy_unchained_entries: legacyUnchained || undefined };
}

export async function recentAudit(limit = 100): Promise<AuditEvent[]> {
  ensureDirs();
  const out: AuditEvent[] = [];
  let names: string[] = [];
  try {
    names = (await fs.readdir(LOG_ROOT)).filter((f) => f.startsWith("audit-")).sort().reverse();
  } catch {
    return [];
  }
  for (const name of names) {
    if (out.length >= limit) break;
    const raw = await fs.readFile(path.join(LOG_ROOT, name), "utf8");
    const lines = raw.trim().length ? raw.trim().split("\n") : [];
    for (const line of lines.reverse()) {
      if (out.length >= limit) break;
      try {
        out.push(JSON.parse(line) as AuditEvent);
      } catch {
        /* skip malformed line */
      }
    }
  }
  return out.slice(0, limit);
}

/**
 * Immutable / append-only analysis audit records (Phase 2).
 * One NDJSON line per analysis with full provenance. Records are never
 * updated or deleted by the application; corrections appear as new events.
 */
export interface AnalysisAuditRecord {
  study_id: string;
  image_sha256: string;
  model_id: string;
  model_version: string;
  model_checksum: string;
  device: string;
  modality: string;
  quality_score: number;
  findings_count: number;
  uncertainty: number;
  ruleset_version: string;
  triage_priority: string;
  symptoms_reported?: boolean;
  red_flags?: string[];
  ts: string;
}

export async function appendAnalysisAudit(rec: Omit<AnalysisAuditRecord, "ts">): Promise<void> {
  ensureDirs();
  const full: AnalysisAuditRecord = { ...rec, ts: new Date().toISOString() };
  const file = path.join(LOG_ROOT, "analyses.ndjson");
  await fs.appendFile(file, JSON.stringify(full) + "\n", "utf8");
}

export async function readAnalysisAudit(limit = 200): Promise<AnalysisAuditRecord[]> {
  ensureDirs();
  try {
    const raw = await fs.readFile(path.join(LOG_ROOT, "analyses.ndjson"), "utf8");
    const lines = raw.trim().length ? raw.trim().split("\n") : [];
    return lines.slice(-limit).map((l) => JSON.parse(l) as AnalysisAuditRecord);
  } catch {
    return [];
  }
}
