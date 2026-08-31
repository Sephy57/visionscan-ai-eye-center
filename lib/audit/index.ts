import fs from "fs/promises";
import path from "path";
import { LOG_ROOT, ensureDirs } from "../config";

/**
 * Audit logging. NDJSON, one file per day, stored on D: under data/logs.
 *
 * Privacy rules enforced here:
 *  - NEVER log raw images, image bytes, or image URLs
 *  - NEVER log full medical reports or raw finding payloads
 *  - NEVER log secrets, tokens, or credentials
 * Only event metadata: who/what/when/which study id/which action.
 */

export interface AuditEvent {
  ts: string;
  actor: string;         // role or user id (never credentials)
  action: string;        // e.g. "upload", "analyze", "review.finalize", "delete"
  studyId?: string;      // opaque id only
  outcome: "ok" | "error" | "rejected";
  detail?: string;       // short, non-sensitive summary only
}

const FORBIDDEN = [/data:image/i, /base64/i, /BEGIN (RSA |EC )?PRIVATE/, /authorization/i, /bearer /i, /password/i];

export function sanitizeDetail(detail?: string): string | undefined {
  if (!detail) return undefined;
  let d = detail.slice(0, 300);
  for (const rx of FORBIDDEN) {
    if (rx.test(d)) return "[redacted - potential sensitive content]";
  }
  return d;
}

export async function audit(event: Omit<AuditEvent, "ts">): Promise<void> {
  ensureDirs();
  const e: AuditEvent = { ts: new Date().toISOString(), ...event };
  e.detail = sanitizeDetail(e.detail);
  const name = `audit-${e.ts.slice(0, 10)}.ndjson`;
  const file = path.join(LOG_ROOT, name);
  await fs.appendFile(file, JSON.stringify(e) + "\n", "utf8");
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
