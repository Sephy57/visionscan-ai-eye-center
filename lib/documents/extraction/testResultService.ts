import { dbAll, dbDelete, dbGet, dbPut } from "../../storage/db";
import { audit } from "../../audit";
import { getDocument } from "../repository";
import { TestResult, VerificationEntry, VerificationStatus, TEST_RESULTS_VERSION, Laterality } from "./testResults";
import { buildTestResults, materializeResults } from "./testResultParser";
import type { ExtractionArtifact } from "./types";
import { readExtractionArtifact } from "./artifacts";

const VALID_LATERALITY: ReadonlySet<string> = new Set(["OD", "OS", "OU", "UNKNOWN"]);

/**
 * Conservative physical sanity bounds for human-entered corrections (S4.8).
 * These are NOT clinical reference ranges (S4.10 forbids inventing those) -
 * they only reject values that cannot exist for the measurement type, so a
 * fat-fingered "2100" mmHg or a negative thickness cannot be recorded.
 */
const VALUE_BOUNDS: Partial<Record<TestResult["test_type"], { min: number; max: number }>> = {
  IOP: { min: 0, max: 200 },
  CENTRAL_SUBFIELD_THICKNESS: { min: 0, max: 5000 },
  CUP_TO_DISC_RATIO: { min: 0, max: 1 },
};

/**
 * Test-result persistence + human verification (S3).
 *
 * - Results are generated ONLY from S2 extraction artifacts and are stored in
 *   their own collection ("test_results") — never merged into analyses.
 * - Every result starts AUTO_EXTRACTED. Verification status changes happen
 *   ONLY through verifyTestResult() (human actions, audited, additive history;
 *   the original extraction is always preserved).
 * - NOTHING here is read by the analysis pipeline, triage, or reports.
 */

export async function persistTestResults(documentId: string, studyId: string, artifact: ExtractionArtifact, actor: string): Promise<number> {
  // Replace any previous generation for this document (re-extraction supersedes).
  const previous = await dbAll<TestResult>("test_results");
  for (const old of previous) {
    if (old.document_id === documentId) await dbDelete("test_results", old.result_id);
  }

  const drafts = buildTestResults(artifact);
  const results = materializeResults(documentId, studyId, drafts);
  for (const r of results) await dbPut("test_results", r.result_id, r);

  await audit({
    actor: `user:${actor}`,
    action: "document.results_generated",
    resource: "document",
    resourceId: documentId,
    studyId,
    outcome: "ok",
    detail: `results=${results.length} flagged=${results.filter((r) => r.ambiguity_flags.length > 0).length} conflicts=${results.filter((r) => r.conflicts.length > 0).length} parser=${TEST_RESULTS_VERSION}`,
  });
  return results.length;
}

export async function listTestResultsForDocument(documentId: string): Promise<TestResult[]> {
  const all = await dbAll<TestResult>("test_results");
  return all
    .filter((r) => r.document_id === documentId)
    .sort((a, b) => a.page - b.page || a.test_type.localeCompare(b.test_type));
}

export async function listTestResultsForStudy(studyId: string): Promise<TestResult[]> {
  const all = await dbAll<TestResult>("test_results");
  return all
    .filter((r) => r.study_id === studyId)
    .sort((a, b) => a.page - b.page || a.test_type.localeCompare(b.test_type));
}

export async function getTestResult(resultId: string): Promise<TestResult | null> {
  return dbGet<TestResult>("test_results", resultId);
}

/** Deletes results bound to a document (used when its study is deleted). */
export async function deleteTestResultsForDocument(documentId: string): Promise<number> {
  const all = await dbAll<TestResult>("test_results");
  let n = 0;
  for (const r of all) {
    if (r.document_id === documentId) {
      await dbDelete("test_results", r.result_id);
      n++;
    }
  }
  return n;
}

export interface VerificationInput {
  action: "verify" | "correct" | "reject" | "unreview";
  actor: string;
  note?: string;
  correction?: Partial<{ value: number; unit: string; laterality: Laterality; note: string }>;
}

export interface VerificationOutcome {
  ok: boolean;
  httpStatus: 200 | 400 | 404 | 409;
  result?: TestResult;
  error?: string;
}

/**
 * Human verification (the S4 workflow's server core). Rules:
 *  - only humans act here; the actor is recorded in every history entry
 *  - corrections NEVER overwrite the original extraction: value_raw,
 *    source_text and the auto-extracted value remain intact; corrected
 *    values live in `correction` + history with status CORRECTED
 *  - VERIFIED results keep their recorded value (no silent mutation)
 *  - every action is audited (metadata only)
 */
export async function verifyTestResult(resultId: string, input: VerificationInput): Promise<VerificationOutcome> {
  const result = await getTestResult(resultId);
  if (!result) return { ok: false, httpStatus: 404, error: "NOT_FOUND" };

  const now = new Date().toISOString();
  const entry: VerificationEntry = { at: now, actor: input.actor, action: input.action, note: input.note };

  switch (input.action) {
    case "verify": {
      if (result.verification.status === "REJECTED") {
        return { ok: false, httpStatus: 409, error: "Result was rejected; re-verify via correction." };
      }
      if (result.value === undefined) {
        return { ok: false, httpStatus: 409, error: "Cannot verify a result whose value failed strict parsing." };
      }
      result.verification = { status: "VERIFIED", at: now, actor: input.actor };
      break;
    }
    case "correct": {
      if (result.verification.status === "REJECTED") {
        return { ok: false, httpStatus: 409, error: "Result was rejected; return it to review before correcting." };
      }
      if (!input.correction || input.correction.value === undefined) {
        return { ok: false, httpStatus: 400, error: "Correction requires a corrected value." };
      }
      if (typeof input.correction.value !== "number" || !Number.isFinite(input.correction.value)) {
        return { ok: false, httpStatus: 400, error: "Corrected value must be a finite number." };
      }
      const bounds = VALUE_BOUNDS[result.test_type];
      if (bounds && (input.correction.value < bounds.min || input.correction.value > bounds.max)) {
        return { ok: false, httpStatus: 400, error: `Corrected value out of range for ${result.test_type} (${bounds.min}-${bounds.max}).` };
      }
      if (input.correction.laterality !== undefined && !VALID_LATERALITY.has(input.correction.laterality)) {
        return { ok: false, httpStatus: 400, error: "Corrected laterality must be OD, OS, OU, or UNKNOWN." };
      }
      if (input.correction.unit !== undefined && (typeof input.correction.unit !== "string" || input.correction.unit.trim().length === 0 || input.correction.unit.length > 32)) {
        return { ok: false, httpStatus: 400, error: "Corrected unit must be a short non-empty string." };
      }
      result.correction = {
        value: input.correction.value,
        unit: input.correction.unit ?? result.unit_normalized ?? result.unit_raw,
        laterality: input.correction.laterality ?? result.laterality,
        note: input.correction.note,
        by: input.actor,
        at: now,
      };
      result.verification = { status: "CORRECTED", at: now, actor: input.actor };
      entry.changes = {
        value: input.correction.value,
        unit: input.correction.unit,
        laterality: input.correction.laterality,
        note: input.correction.note,
      };
      break;
    }
    case "reject":
      result.verification = { status: "REJECTED", at: now, actor: input.actor };
      break;
    case "unreview":
      // Returns a verified/corrected/rejected result to the review queue
      // (additive history; nothing is erased).
      result.verification = { status: "UNREVIEWED", at: now, actor: input.actor };
      break;
    default:
      return { ok: false, httpStatus: 400, error: "Unknown verification action" };
  }

  result.verification_history = [...result.verification_history, entry];
  await dbPut("test_results", result.result_id, result);
  await audit({
    actor: `user:${input.actor}`,
    action: `test_result.${input.action === "unreview" ? "returned_to_review" : input.action}`,
    resource: "test_result",
    resourceId: result.result_id,
    studyId: result.study_id,
    outcome: "ok",
    // Metadata only (S4.5): test type, page, and status transition. Never the
    // extracted value/unit/source text - those may carry document-derived PHI.
    detail: `${result.test_type} page=${result.page} status=${result.verification.status}`,
  });
  return { ok: true, httpStatus: 200, result };
}

/** Convenience: generate + persist from an artifact read by documentId. */
export async function generateResultsForDocument(documentId: string, actor: string): Promise<{ ok: boolean; count?: number; error?: string }> {
  const doc = await getDocument(documentId);
  if (!doc || doc.status === "DELETED" || doc.status === "REJECTED") return { ok: false, error: "NOT_FOUND" };
  const artifact = await readExtractionArtifact(documentId);
  if (!artifact) return { ok: false, error: "NOT_EXTRACTED" };
  const count = await persistTestResults(documentId, doc.study_id, artifact, actor);
  return { ok: true, count };
}
