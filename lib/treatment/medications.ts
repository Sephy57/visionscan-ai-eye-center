/**
 * Medication Knowledge Registry (Phase 5).
 *
 * HONESTY RULES (non-negotiable, mirrors lib/models/registry.ts):
 *  - This deployment has NO connected licensed drug/formulary data source
 *    (no openFDA/RxNorm/DailyMed integration, no clinical guideline feed).
 *  - A medication record is NEVER invented from an LLM's memory. Every field
 *    must trace to an authoritative source (official labeling, a regulatory
 *    drug database, or a recognized clinical practice guideline) recorded in
 *    `evidenceReferences`.
 *  - Because no source is connected, MEDICATIONS is intentionally EMPTY.
 *    The registry, versioning, and gating logic are real and ready to accept
 *    records the moment a real source is integrated - nothing here is
 *    fabricated to make the UI look populated.
 */

export interface MedicationRecord {
  medicationId: string;
  genericName: string;
  brandNames: string[];
  drugClass: string;
  indications: string[];
  ophthalmicIndications: string[];
  route: string[];
  contraindications: string[];
  warnings: string[];
  commonAdverseEffects: string[];
  seriousAdverseEffects: string[];
  drugInteractions: Array<{ withMedicationOrClass: string; severity: "minor" | "moderate" | "major"; note: string }>;
  ageConsiderations: string | null;
  pregnancyConsiderations: string | null;
  renalConsiderations: string | null;
  hepaticConsiderations: string | null;
  monitoring: string[];
  evidenceReferences: string[];   // REQUIRED, non-empty - source citations only, never invented
  lastReviewed: string;           // ISO date
  source: string;                 // e.g. "FDA label", "AAO Preferred Practice Pattern"
  version: string;
  jurisdiction: string;           // e.g. "US", "EU" - regulatory content is jurisdiction-specific
}

/**
 * The medication registry proper. Intentionally empty - see file header.
 * Do not add entries here from memory. Add an ingestion path from a real,
 * citable source instead, then register validated records through
 * `registerMedication`.
 */
export const MEDICATIONS: Record<string, MedicationRecord> = {};

export interface MedicationValidationError {
  field: string;
  message: string;
}

/** Fail-closed validation: a record missing evidence or a source can never be registered. */
export function validateMedicationRecord(r: Partial<MedicationRecord>): { valid: boolean; errors: MedicationValidationError[] } {
  const errors: MedicationValidationError[] = [];
  const need = (cond: boolean, field: string, message: string) => { if (!cond) errors.push({ field, message }); };

  need(typeof r.medicationId === "string" && r.medicationId.length > 0, "medicationId", "required");
  need(typeof r.genericName === "string" && r.genericName.length > 0, "genericName", "required");
  need(Array.isArray(r.brandNames), "brandNames", "must be array (may be empty)");
  need(typeof r.drugClass === "string" && r.drugClass.length > 0, "drugClass", "required");
  need(Array.isArray(r.ophthalmicIndications), "ophthalmicIndications", "must be array");
  need(Array.isArray(r.contraindications), "contraindications", "must be array");
  need(Array.isArray(r.warnings), "warnings", "must be array");
  need(Array.isArray(r.evidenceReferences) && r.evidenceReferences.length > 0, "evidenceReferences", "at least one source citation is required - a medication record cannot be registered without evidence");
  need(typeof r.source === "string" && r.source.length > 0, "source", "required - the authoritative source name must be recorded");
  need(typeof r.lastReviewed === "string" && r.lastReviewed.length > 0, "lastReviewed", "required");
  need(typeof r.version === "string" && r.version.length > 0, "version", "required");
  need(typeof r.jurisdiction === "string" && r.jurisdiction.length > 0, "jurisdiction", "required - regulatory/labeling content is jurisdiction-specific");

  return { valid: errors.length === 0, errors };
}

/**
 * Register a medication record. Fails closed: throws rather than silently
 * accepting an unevidenced or malformed record (never call this with
 * memory-derived content - see file header).
 */
export function registerMedication(r: MedicationRecord): void {
  const v = validateMedicationRecord(r);
  if (!v.valid) {
    throw new Error(`Medication record rejected: ${v.errors.map((e) => `${e.field}: ${e.message}`).join("; ")}`);
  }
  MEDICATIONS[r.medicationId] = r;
}

export function getMedication(id: string): MedicationRecord | null {
  return MEDICATIONS[id] ?? null;
}

export function listMedications(): MedicationRecord[] {
  return Object.values(MEDICATIONS);
}

// ---------------------------------------------------------------------------
// Medication knowledge versioning (Step 31): every change to the knowledge
// base is recorded, never silently applied.
// ---------------------------------------------------------------------------

export interface MedicationKnowledgeChange {
  change_id: string;
  old_version: string | null;
  new_version: string;
  source: string;
  reviewer: string;
  date: string;               // ISO date
  reason: string;
  affected_medications: string[];
  affected_conditions: string[];
}

const KNOWLEDGE_CHANGES: MedicationKnowledgeChange[] = [];

/** Record a medication-knowledge update. Does not itself mutate MEDICATIONS - callers apply the change and log it here for traceability. */
export function recordMedicationKnowledgeChange(c: Omit<MedicationKnowledgeChange, "change_id">): MedicationKnowledgeChange {
  const entry: MedicationKnowledgeChange = { ...c, change_id: `medchg_${Date.now()}_${KNOWLEDGE_CHANGES.length}` };
  KNOWLEDGE_CHANGES.push(entry);
  return entry;
}

export function listMedicationKnowledgeChanges(): MedicationKnowledgeChange[] {
  return [...KNOWLEDGE_CHANGES];
}
