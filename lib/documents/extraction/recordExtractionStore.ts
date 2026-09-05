import { dbGet, dbPut, dbDelete } from "../../storage/db";
import { audit } from "../../audit";
import {
  RecordExtraction,
  ExtractedSymptom,
  ExtractedMedication,
  ExtractedAllergy,
  SystemicCandidate,
  ExplicitNegation,
  SourceDocumentDiagnosis,
  ExtractedHistoryCandidate,
} from "./clinicalExtraction";
import { SYMPTOM_MAP } from "../../clinical/symptoms";

/**
 * Persistence + clinician annotation for record extractions.
 *
 * HARD RULES:
 *  - The ORIGINAL extracted item is never mutated. Clinician actions append
 *    an annotation entry and update ONLY the `verification` field of the
 *    item (plus optional correction metadata). The raw document text,
 *    extraction values, and provenance stay intact.
 *  - Verification provenance records WHO verified/corrected and WHEN.
 *    CORRECTED/VERIFIED states are reachable only through this API - never
 *    by writing AI data with clinician provenance.
 *  - A REJECTED item is kept (for audit) but flagged; consumers must filter
 *    rejected items out of any downstream use.
 */

export type ExtractionItemCategory = "symptoms" | "medications" | "allergies" | "systemic_candidates" | "explicit_negations" | "source_document_diagnoses" | "ocular_history_candidates" | "family_history_candidates" | "exam_findings";

export type AnnotationAction = "VERIFY" | "CORRECT" | "REJECT";

export interface ExtractionAnnotation {
  action: AnnotationAction;
  by: string;                 // username of the clinician
  at: string;                 // ISO
  note?: string | null;
  corrected_value?: Record<string, unknown> | null; // CORRECT only - typed per category at the route layer
}

export interface StoredRecordExtraction extends RecordExtraction {
  annotations: Record<string, ExtractionAnnotation[]>; // keyed by item_id
}

export async function saveRecordExtraction(record: RecordExtraction): Promise<StoredRecordExtraction> {
  const stored: StoredRecordExtraction = { ...record, annotations: {} };
  await dbPut("record_extractions", record.document_id, stored);
  return stored;
}

export async function getRecordExtraction(documentId: string): Promise<StoredRecordExtraction | null> {
  return dbGet<StoredRecordExtraction>("record_extractions", documentId);
}

export async function deleteRecordExtraction(documentId: string): Promise<void> {
  await dbDelete("record_extractions", documentId);
}

const VERIFICATION_BY_ACTION: Record<AnnotationAction, string> = {
  VERIFY: "VERIFIED_BY_CLINICIAN",
  CORRECT: "CORRECTED_BY_CLINICIAN",
  REJECT: "REJECTED_BY_CLINICIAN",
};

/**
 * Applies a clinician annotation to one extracted item.
 * Fail-closed: unknown document/item/category returns null; caller maps to 404.
 * The corrected value is applied ONLY for CORRECT actions and ONLY to the
 * mutable fields of that category (see MUTABLE_FIELDS); provenance stays
 * DOCUMENT_EXTRACTED with a clinician correction annotation appended.
 */
const MUTABLE_FIELDS: Record<ExtractionItemCategory, string[]> = {
  symptoms: ["type", "laterality", "onset", "duration", "severity", "certainty", "free_text"],
  medications: ["name_raw", "form_hint", "dose_raw"],
  allergies: ["allergen_raw", "reaction_raw"],
  systemic_candidates: ["condition"],
  explicit_negations: ["type"],
  source_document_diagnoses: ["diagnosis_raw"],
  ocular_history_candidates: ["value_raw", "laterality", "date_raw"],
  family_history_candidates: ["value_raw", "laterality", "date_raw"],
  exam_findings: ["value_raw", "laterality", "date_raw"],
};

const LATERALITIES = new Set(["right", "left", "both", "unknown"]);
const ONSETS = new Set(["sudden", "gradual", "unknown"]);
const DURATIONS = new Set(["less_than_1_hour", "hours", "1_day", "days", "1_week", "weeks", "1_month", "months", "chronic", "unknown"]);
const SEVERITIES = new Set(["mild", "moderate", "severe"]);
const CERTAINTIES = new Set(["EXPLICIT", "UNCERTAIN"]);
const FORM_HINTS = new Set(["eye_drops", "oral", "injection", "unknown"]);

/**
 * Validate the fields that a clinician may correct before mutating the
 * in-memory copy. API-level `typeof value === "object"` checks are not
 * sufficient here: without this guard a caller could persist an unknown
 * symptom type or invalid laterality and later consumers would have to guess
 * how to interpret it.
 */
function validCorrection(category: ExtractionItemCategory, value: Record<string, unknown>): boolean {
  if (Array.isArray(value)) return false;
  const stringIfPresent = (key: string, max: number): boolean => {
    if (!(key in value)) return true;
    return typeof value[key] === "string" && (value[key] as string).trim().length > 0 && (value[key] as string).length <= max;
  };
  switch (category) {
    case "symptoms":
      if ("type" in value && (typeof value.type !== "string" || !SYMPTOM_MAP[value.type])) return false;
      if ("laterality" in value && (typeof value.laterality !== "string" || !LATERALITIES.has(value.laterality))) return false;
      if ("onset" in value && (typeof value.onset !== "string" || !ONSETS.has(value.onset))) return false;
      if ("duration" in value && (typeof value.duration !== "string" || !DURATIONS.has(value.duration))) return false;
      if ("severity" in value && (typeof value.severity !== "string" || !SEVERITIES.has(value.severity))) return false;
      if ("certainty" in value && (typeof value.certainty !== "string" || !CERTAINTIES.has(value.certainty))) return false;
      if ("free_text" in value && value.free_text !== null && !stringIfPresent("free_text", 1000)) return false;
      return true;
    case "medications":
      if (!stringIfPresent("name_raw", 160)) return false;
      if ("form_hint" in value && (typeof value.form_hint !== "string" || !FORM_HINTS.has(value.form_hint))) return false;
      if ("dose_raw" in value && value.dose_raw !== null && !stringIfPresent("dose_raw", 80)) return false;
      return true;
    case "allergies":
      if (!stringIfPresent("allergen_raw", 160)) return false;
      if ("reaction_raw" in value && value.reaction_raw !== null && !stringIfPresent("reaction_raw", 160)) return false;
      return true;
    case "systemic_candidates":
      return !(
        "condition" in value &&
        (typeof value.condition !== "string" || !new Set(["diabetes", "hypertension"]).has(value.condition))
      );
    case "explicit_negations":
      return !("type" in value && (typeof value.type !== "string" || !SYMPTOM_MAP[value.type]));
    case "source_document_diagnoses":
      return stringIfPresent("diagnosis_raw", 160);
    case "ocular_history_candidates":
    case "family_history_candidates":
    case "exam_findings":
      if (!stringIfPresent("value_raw", 160)) return false;
      if ("laterality" in value && (typeof value.laterality !== "string" || !LATERALITIES.has(value.laterality))) return false;
      if ("date_raw" in value && value.date_raw !== null && !stringIfPresent("date_raw", 80)) return false;
      return true;
    default:
      return false;
  }
}

export async function annotateExtractionItem(
  documentId: string,
  input: {
    category: ExtractionItemCategory;
    item_id: string;
    action: AnnotationAction;
    by: string;
    note?: string | null;
    corrected_value?: Record<string, unknown> | null;
  }
): Promise<StoredRecordExtraction | null> {
  const stored = await getRecordExtraction(documentId);
  if (!stored) return null;

  const collection = stored[input.category] as Array<ExtractedSymptom | ExtractedMedication | ExtractedAllergy | SystemicCandidate | ExplicitNegation | SourceDocumentDiagnosis | ExtractedHistoryCandidate> | undefined;
  if (!Array.isArray(collection)) return null;
  const item = collection.find((i) => i && (i as { item_id?: string }).item_id === input.item_id);
  if (!item) return null;

  const mutable = MUTABLE_FIELDS[input.category];
  if (input.action === "CORRECT") {
    if (!input.corrected_value || typeof input.corrected_value !== "object" || !validCorrection(input.category, input.corrected_value)) return null;
    for (const [k, v] of Object.entries(input.corrected_value)) {
      if (!mutable.includes(k)) continue; // silently ignore immutable fields - originals stay intact
      (item as unknown as Record<string, unknown>)[k] = v;
    }
  }

  const annotation: ExtractionAnnotation = {
    action: input.action,
    by: input.by,
    at: new Date().toISOString(),
    note: input.note ?? null,
    corrected_value: input.action === "CORRECT" ? input.corrected_value ?? null : null,
  };
  stored.annotations[input.item_id] = [...(stored.annotations[input.item_id] ?? []), annotation];
  (item as unknown as { verification?: string }).verification = VERIFICATION_BY_ACTION[input.action];

  await dbPut("record_extractions", documentId, stored);
  await audit({
    actor: input.by,
    action: `extraction.${input.action.toLowerCase()}`,
    resource: "document",
    resourceId: documentId,
    outcome: "ok",
    detail: `item=${input.item_id} category=${input.category}`,
  });
  return stored;
}
