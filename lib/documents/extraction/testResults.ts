/**
 * S3 — structured ophthalmic test-result extraction.
 *
 * HARD RULES (docs/TEST_RESULT_EXTRACTION.md):
 *  1. Rules-based, deterministic parsing ONLY. No LLM "cleanup" of
 *     ambiguous OCR: "IOP OS 2l mmHg" stays ambiguous (value_raw="2l",
 *     value=undefined, flagged for verification) — never becomes 21.
 *  2. Units are NEVER guessed. Unknown/missing unit => no normalization,
 *     no mmHg assumption, explicit ambiguity flag.
 *  3. Unit conversion ONLY when deterministic and documented (kPa->mmHg,
 *     mm->um). The original value is always preserved alongside.
 *  4. Reference ranges are NEVER invented: attached only when found in the
 *     source text, with provenance; otherwise absent (= UNKNOWN).
 *  5. Laterality (OD|OS|OU|UNKNOWN) is taken only from explicit tokens;
 *     OU is never merged into a single eye; contradictions are flagged.
 *  6. Conflicting values are surfaced, never silently chosen.
 *  7. NOTHING here reaches triage, diagnosis, treatment, or the analysis
 *     pipeline. Every result is AUTO_EXTRACTED / UNREVIEWED until a
 *     clinician says otherwise (S4 workflow).
 */

export type TestType =
  | "IOP"                          // intraocular pressure
  | "VISUAL_ACUITY"                // Snellen / logMAR (NOT cross-convertible)
  | "CENTRAL_SUBFIELD_THICKNESS"   // OCT CST
  | "CUP_TO_DISC_RATIO"
  | "PACHYMETRY"                   // central corneal thickness / pachymetry
  | "VISUAL_FIELD"                 // visual-field summary values (MD/PSD/VFI)
  | "REFRACTION"                   // sphere/cylinder/axis values, kept raw
  | "OCT_MEASUREMENT"              // explicitly labelled OCT/RNFL/GCC measurement
  | "UNKNOWN";

export type Laterality = "OD" | "OS" | "OU" | "UNKNOWN";

export type VerificationStatus =
  | "AUTO_EXTRACTED"  // machine-extracted, never seen by a human
  | "UNREVIEWED"      // queued for human review
  | "VERIFIED"        // a clinician confirmed the value as correct
  | "CORRECTED"       // a clinician corrected the value (original preserved)
  | "REJECTED";       // a clinician rejected the extraction

export type AmbiguityFlag =
  | "unparseable_value"     // value present but not strict numeric grammar (e.g. "2l")
  | "ambiguous_value"       // e.g. comma decimal, multiple candidate values
  | "unknown_unit"          // unit present but not in the registry -> never converted
  | "missing_unit"          // no unit token -> never assumed
  | "missing_laterality"
  | "contradictory_laterality" // snippet contains more than one distinct laterality
  | "unconvertible_scale"   // e.g. Snellen vs logMAR - intentionally not converted
  | "ambiguous_date";

export interface UnitConversion {
  from: string;     // canonical raw unit
  to: string;       // canonical normalized unit
  factor: number;   // value_normalized = value * factor
  method: string;   // documented conversion identity
}

export interface ReferenceRange {
  raw: string;                  // exactly as found in the document
  low?: number;                 // only when strict numeric grammar
  high?: number;
  unit?: string;                // unit_raw as found; never assumed
  source: "document_text";
  page: number;
}

export interface VerificationEntry {
  at: string;
  actor: string;
  action: "verify" | "correct" | "reject" | "generate" | "unreview";
  note?: string;
  changes?: Partial<{ value: number; unit: string; laterality: Laterality; note: string }>;
}

export interface TestResult {
  result_id: string;
  document_id: string;
  study_id: string;
  test_type: TestType;
  // --- value (original ALWAYS preserved alongside normalized) ---
  value_raw: string;             // exactly as extracted (e.g. "2l", "21", "0,4")
  value?: number;                // ONLY when strict numeric grammar passes
  unit_raw?: string;             // as written in the document
  unit_normalized?: string;      // canonical unit code, only when recognized
  value_normalized?: number;     // only when a deterministic conversion applies
  conversion?: UnitConversion;
  // --- context ---
  reference_range?: ReferenceRange;  // absent => UNKNOWN (never invented)
  laterality: Laterality;
  timestamp?: string;            // ISO, only when unambiguously parsed from the document
  date_raw?: string;
  // --- provenance (traceable to document/page/text) ---
  page: number;
  source_text: string;           // snippet of the exact source text around the match
  extraction_method: "text_layer" | "ocr";
  extraction_confidence?: number; // OCR page confidence where available
  // --- uncertainty ---
  ambiguity_flags: AmbiguityFlag[];
  conflicts: string[];           // result_ids of conflicting values (same type+laterality)
  // --- verification ---
  verification: {
    status: VerificationStatus;
    at: string;
    actor?: string;              // set once a human acts (S4)
  };
  /** Clinician correction (S4). The ORIGINAL extraction above is never overwritten. */
  correction?: {
    value: number;
    unit?: string;
    laterality?: Laterality;
    note?: string;
    by: string;
    at: string;
  };
  verification_history: VerificationEntry[];
  created_at: string;
  parser_version: string;
}

export const TEST_RESULTS_VERSION = "test-results-1.0.0";

/** Canonical unit codes (never guessed at parse time). */
export type CanonicalUnit = "mmHg" | "kPa" | "um" | "mm" | "ratio" | "snellen" | "logMAR" | "unknown";

/**
 * Deterministic, documented conversions ONLY. Anything not listed here is
 * never converted (flagged unknown_unit / missing_unit instead).
 */
export const UNIT_REGISTRY: Record<string, { canonical: CanonicalUnit; conversion?: UnitConversion }> = {
  "mmHg": { canonical: "mmHg" },
  "mm Hg": { canonical: "mmHg" },
  "kPa": { canonical: "kPa", conversion: { from: "kPa", to: "mmHg", factor: 7.5006168307, method: "1 kPa = 7.5006168307 mmHg (exact definition of mmHg via 133.322387415 Pa)" } },
  "µm": { canonical: "um" },
  "μm": { canonical: "um" },
  "um": { canonical: "um" },
  "micron": { canonical: "um" },
  "microns": { canonical: "um" },
  "mm": { canonical: "mm", conversion: { from: "mm", to: "um", factor: 1000, method: "1 mm = 1000 um (SI)" } },
  "ratio": { canonical: "ratio" },
  "Snellen": { canonical: "snellen" },   // 20/20-style fractions: NOT converted across scales
  "logMAR": { canonical: "logMAR" },
};
