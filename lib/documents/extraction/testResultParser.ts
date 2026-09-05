import { newId } from "../../storage/files";
import {
  AmbiguityFlag, CanonicalUnit, Laterality, ReferenceRange, TestResult, TestType,
  UNIT_REGISTRY, TEST_RESULTS_VERSION,
} from "./testResults";
import type { ExtractionArtifact } from "./types";

/**
 * Rules-based, deterministic test-result parsing (S3). Every match keeps:
 *  - the raw value string exactly as extracted
 *  - a source-text snippet for provenance
 * Ambiguity is FLAGGED, never resolved. See docs/TEST_RESULT_EXTRACTION.md.
 */

export interface ParsedResultDraft {
  test_type: TestType;
  value_raw: string;
  value?: number;
  unit_raw?: string;
  unit_normalized?: string;
  value_normalized?: number;
  conversion?: TestResult["conversion"];
  reference_range?: ReferenceRange;
  laterality: Laterality;
  timestamp?: string;
  date_raw?: string;
  page: number;
  source_text: string;
  extraction_method: "text_layer" | "ocr";
  extraction_confidence?: number;
  ambiguity_flags: AmbiguityFlag[];
}

interface TypePattern {
  test_type: TestType;
  /** One regex per value grammar; capture group 1 = raw value, group 2 = unit (optional). */
  patterns: RegExp[];
  unit_kind: "pressure" | "thickness" | "ratio" | "acuity" | "visual_field" | "signed_number" | "none";
  /** The value grammar used by this pattern. Positive-only is deliberate for
   * legacy measurements; visual-field/refraction values may be signed. */
  number_grammar?: "positive" | "signed";
}

const LATERALITY_RX = /\b(OD|OS|OU)\b/; // explicit tokens only; never inferred
const STRICT_NUMBER = /^\d+(?:\.\d+)?$/;
const SIGNED_NUMBER = /^[+-]?\d+(?:\.\d+)?$/;

/**
 * Tokens that look word-like but are not units. Deterministic stoplist so a
 * value followed by prose ("21 today") is treated as MISSING a unit rather
 * than gaining a nonsense "unknown unit". The list is intentionally short
 * and only ever REDUCES false unit flags - it never creates conversions.
 */
const NON_UNIT_WORDS = new Set([
  "today", "was", "and", "with", "via", "per", "both", "hour", "days", "week",
  "note", "exam", "seen", "when", "then", "goal", "prior", "right", "left",
  "eye", "each", "this", "that", "from", "been", "were", "have", "has",
  "iops", "scan", "slit", "lamp",
]);

const TYPE_PATTERNS: TypePattern[] = [
  {
    test_type: "IOP",
    unit_kind: "pressure",
    patterns: [
      // NOTE: the OCR-noise alternative ([0-9]+[a-zA-Z][0-9]*) MUST come
      // first, or "2l" silently matches as a clean "2" (false precision).
      /\bIOP\b[^0-9.]{0,40}?([0-9]+[a-zA-Z][0-9]*|\d+(?:[.,]\d+)?)(?:\s*(mmHg|mm\s?Hg|kPa|[A-Za-zµμ]{1,5})\b)?/i,
      /\bintraocular pressure\b[^0-9.]{0,40}?([0-9]+[a-zA-Z][0-9]*|\d+(?:[.,]\d+)?)(?:\s*(mmHg|mm\s?Hg|kPa|[A-Za-zµμ]{1,5})\b)?/i,
    ],
  },
  {
    test_type: "CENTRAL_SUBFIELD_THICKNESS",
    unit_kind: "thickness",
    patterns: [
      // Same ordering rule as IOP: noise-tolerant alternative first.
      /\bCST\b[^0-9.]{0,40}?([0-9]+[a-zA-Z][0-9]*|\d+(?:[.,]\d+)?)(?:\s*(µm|μm|um|microns?|mm|[A-Za-zµμ]{1,5})\b)?/i,
      /\bcentral (?:subfield|macular) thickness\b[^0-9.]{0,40}?([0-9]+[a-zA-Z][0-9]*|\d+(?:[.,]\d+)?)(?:\s*(µm|μm|um|microns?|mm|[A-Za-zµμ]{1,5})\b)?/i,
    ],
  },
  {
    test_type: "CUP_TO_DISC_RATIO",
    unit_kind: "ratio",
    patterns: [
      /\bCDR\b[^0-9.]{0,30}?(0?[.,]\d{1,2})\b(?!\/)/i,
      /\bcup[- ]to[- ]disc(?: ratio)?\b[^0-9.]{0,30}?(0?[.,]\d{1,2})\b(?!\/)/i,
    ],
  },
  {
    test_type: "VISUAL_ACUITY",
    unit_kind: "acuity",
    patterns: [
      /\b(?:BCVA|UCVA|VA)\b[^0-9/]{0,25}?\b((?:20|6)\s*\/\s*(?:\d{1,3}))\b/i,          // Snellen 20/20, 6/6
      /\bvisual acuity\b[^0-9/]{0,25}?\b((?:20|6)\s*\/\s*(?:\d{1,3}))\b/i,
      /\b(?:BCVA|UCVA|VA)\b[^0-9.-]{0,25}?(\d\.\d{1,2})\s*logMAR\b/i,                   // logMAR
    ],
  },
  {
    test_type: "PACHYMETRY",
    unit_kind: "thickness",
    patterns: [
      /\b(?:pachymetry|pachy|CCT|central corneal thickness)\b[^0-9.]{0,40}?([0-9]+[a-zA-Z][0-9]*|\d+(?:[.,]\d+)?)(?:\s*(µm|μm|um|microns?|mm|[A-Za-zµμ]{1,5})\b)?/i,
    ],
  },
  {
    test_type: "VISUAL_FIELD",
    unit_kind: "visual_field",
    number_grammar: "signed",
    patterns: [
      /\b(?:visual field|VF|MD|PSD|VFI)\b[^0-9.+-]{0,35}?([+-]?\d+(?:[.,]\d+)?)(?:\s*(dB|%))?/i,
    ],
  },
  {
    test_type: "REFRACTION",
    unit_kind: "signed_number",
    number_grammar: "signed",
    patterns: [
      /\b(?:refraction|sphere|cylinder|axis|Rx)\b[^0-9.+-]{0,30}?([+-]?\d+(?:[.,]\d+)?)(?:\s*(D|diopters?|deg|degrees?))?/i,
    ],
  },
  {
    test_type: "OCT_MEASUREMENT",
    unit_kind: "thickness",
    patterns: [
      /\b(?:OCT|RNFL|GCC|ganglion cell(?: complex)?|retinal nerve fiber layer)\b[^0-9.]{0,40}?([0-9]+[a-zA-Z][0-9]*|\d+(?:[.,]\d+)?)(?:\s*(µm|μm|um|microns?|mm|[A-Za-zµμ]{1,5})\b)?/i,
    ],
  },
];

const LATERALITY_CANDIDATES: Array<[RegExp, Laterality]> = [
  [/\bOD\b/, "OD"],
  [/\bOS\b/, "OS"],
  [/\bOU\b/, "OU"],
];

/** ISO dates only are unambiguous; everything else is kept raw + flagged. */
const ISO_DATE_RX = /\b((?:19|20)\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01]))\b/;
const LOOSE_DATE_RX = /\b((?:19|20)\d{2}[/.](?:0?[1-9]|1[0-2])[/.](?:0?[1-9]|[12]\d|3[01])|\d{1,2}[/.]\d{1,2}[/.](?:19|20)\d{2})\b/;

function unitKindToExpected(unitKind: TypePattern["unit_kind"]): Array<{ token: string; canonical: CanonicalUnit }> {
  switch (unitKind) {
    case "pressure": return [{ token: "mmHg", canonical: "mmHg" }, { token: "kPa", canonical: "kPa" }];
    case "thickness": return [{ token: "um", canonical: "um" }, { token: "mm", canonical: "mm" }];
    case "ratio": return [{ token: "ratio", canonical: "ratio" }];
    case "acuity": return [{ token: "snellen", canonical: "snellen" }, { token: "logMAR", canonical: "logMAR" }];
    default: return [];
  }
}

function normalizeUnitToken(raw: string): { unit_raw?: string; registry_key?: string } {
  const trimmed = raw.trim();
  // Prose words are NOT units: treat them as "no unit present" (deterministic stoplist).
  if (NON_UNIT_WORDS.has(trimmed.toLowerCase())) return {};
  const candidates = [trimmed, trimmed.replace(/\s+/g, ""), trimmed.toLowerCase()];
  for (const c of candidates) {
    if (UNIT_REGISTRY[c]) return { unit_raw: trimmed, registry_key: c };
  }
  // case-insensitive scan (e.g. "mmhg", "MMHG")
  for (const key of Object.keys(UNIT_REGISTRY)) {
    if (key.toLowerCase() === trimmed.toLowerCase()) return { unit_raw: trimmed, registry_key: key };
  }
  return { unit_raw: trimmed };
}

/** Laterality from the match itself first; a narrow lookbehind second; never a wide window. */
function lateralityOf(matchText: string, lookbehind: string): { laterality: Laterality; flags: AmbiguityFlag[] } {
  for (const scope of [matchText, lookbehind]) {
    const found = new Set<Laterality>();
    for (const [rx, lat] of LATERALITY_CANDIDATES) {
      if (rx.test(scope)) found.add(lat);
    }
    if (found.size === 1) return { laterality: [...found][0], flags: [] };
    if (found.size > 1) return { laterality: "UNKNOWN", flags: ["contradictory_laterality"] };
  }
  return { laterality: "UNKNOWN", flags: ["missing_laterality"] };
}

/**
 * Deterministic normalization; never guesses. Acuity scales are labeled but
 * NEVER converted; ratios carry no unit; only registry conversions apply.
 */
function normalizeValue(
  value: number | undefined,
  unitKind: TypePattern["unit_kind"],
  rawValue: string,
  unitInfo: { unit_raw?: string; registry_key?: string },
  flags: AmbiguityFlag[],
): { unit_normalized?: string; value_normalized?: number; conversion?: TestResult["conversion"] } {
  if (unitKind === "acuity") {
    // Snellen fractions and logMAR measure different scales; conversion is
    // NOT deterministic, so values are only labeled.
    flags.push("unconvertible_scale");
    return { unit_normalized: rawValue.includes("/") ? "snellen" : "logMAR" };
  }
  if (unitKind === "visual_field" || unitKind === "signed_number") {
    // dB, %, diopters, and axis degrees are labels, not interchangeable
    // scales. Preserve the numeric value only when the signed grammar parsed
    // it and never invent a unit or a conversion.
    return { unit_normalized: unitInfo.registry_key ? UNIT_REGISTRY[unitInfo.registry_key]?.canonical : unitInfo.unit_raw };
  }
  if (value === undefined) return {};
  if (unitKind === "ratio") return { unit_normalized: "ratio" };
  if (!unitInfo.registry_key) {
    if (unitInfo.unit_raw) flags.push("unknown_unit");
    return {};
  }
  const entry = UNIT_REGISTRY[unitInfo.registry_key];
  const conv = entry.conversion;
  if (!conv) return { unit_normalized: entry.canonical };
  return {
    unit_normalized: conv.to,
    value_normalized: Number((value * conv.factor).toFixed(6)),
    conversion: conv,
  };
}

function referenceRangeOf(snippet: string, page: number): ReferenceRange | undefined {
  const rx = /\b(?:normal|reference(?:\s+range)?|NR)\b\s*[:=]?\s*(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)\s*([A-Za-zµμ]{1,6})?/i;
  const m = rx.exec(snippet);
  if (!m) return undefined;
  const range: ReferenceRange = { raw: m[0].trim(), source: "document_text", page };
  if (STRICT_NUMBER.test(m[1]) && STRICT_NUMBER.test(m[2])) {
    range.low = Number(m[1]);
    range.high = Number(m[2]);
  }
  if (m[3]) range.unit = m[3]; // as found; never assumed
  return range;
}

export function buildTestResults(artifact: ExtractionArtifact): ParsedResultDraft[] {
  const drafts: ParsedResultDraft[] = [];
  for (const page of artifact.pages) {
    if (!page.text || page.text.length < 3) continue;
    const method = page.method === "ocr" ? "ocr" : "text_layer";
    for (const pattern of TYPE_PATTERNS) {
      for (const baseRx of pattern.patterns) {
        const rx = new RegExp(baseRx.source, baseRx.flags.includes("g") ? baseRx.flags : baseRx.flags + "g");
        let m: RegExpExecArray | null;
      while ((m = rx.exec(page.text)) !== null) {
        const rawValue = m[1];
        const rawUnit = pattern.unit_kind === "none" ? undefined : m[2];
        const snippetStart = Math.max(0, m.index - 40);
        const snippet = page.text.slice(snippetStart, Math.min(page.text.length, m.index + m[0].length + 40)).trim();
        const flags: AmbiguityFlag[] = [];

        // VALUE: strict numeric grammar only. "2l" stays unparseable.
        let value: number | undefined;
        const numericGrammar = pattern.number_grammar === "signed" ? SIGNED_NUMBER : STRICT_NUMBER;
        if (numericGrammar.test(rawValue)) {
          value = Number(rawValue);
        } else if (/^\d+,\d+$/.test(rawValue)) {
          flags.push("ambiguous_value"); // comma decimal vs separator - never guessed
        } else {
          flags.push("unparseable_value");
        }

        // UNIT: never assumed; prose words in the unit slot are not units.
        const unitInfo = rawUnit ? normalizeUnitToken(rawUnit) : {};
        if (!rawUnit || !unitInfo.unit_raw) {
          if (pattern.unit_kind !== "ratio" && pattern.unit_kind !== "acuity") flags.push("missing_unit");
        }

        const lat = lateralityOf(m[0], page.text.slice(Math.max(0, m.index - 24), m.index));
        flags.push(...lat.flags);

        const norm = normalizeValue(value, pattern.unit_kind, rawValue, unitInfo, flags);

        // DATE: ISO accepted; loose formats kept raw + flagged.
        let timestamp: string | undefined;
        let date_raw: string | undefined;
        const iso = ISO_DATE_RX.exec(snippet);
        if (iso) {
          timestamp = iso[1];
          date_raw = iso[1];
        } else {
          const loose = LOOSE_DATE_RX.exec(snippet);
          if (loose) {
            date_raw = loose[1];
            flags.push("ambiguous_date");
          }
        }

        drafts.push({
          test_type: pattern.test_type,
          value_raw: rawValue,
          value,
          unit_raw: unitInfo.unit_raw,
          ...norm,
          reference_range: referenceRangeOf(snippet, page.page),
          laterality: lat.laterality,
          timestamp,
          date_raw,
          page: page.page,
          source_text: snippet,
          extraction_method: method,
          extraction_confidence: page.confidence,
          ambiguity_flags: [...new Set(flags)],
        });
        }
      }
    }
  }
  return drafts;
}

/** Detects conflicting values (same test_type + laterality, distinct parsed values). */
export function flagConflicts(drafts: ParsedResultDraft[]): void {
  const groups = new Map<string, ParsedResultDraft[]>();
  for (const d of drafts) {
    if (d.value === undefined) continue;
    const key = `${d.test_type}|${d.laterality}`;
    groups.set(key, [...(groups.get(key) ?? []), d]);
  }
  for (const group of groups.values()) {
    const distinct = new Set(group.map((d) => d.value));
    if (group.length > 1 && distinct.size > 1) {
      for (const d of group) {
        if (!d.ambiguity_flags.includes("ambiguous_value")) d.ambiguity_flags.push("ambiguous_value");
      }
    }
  }
}

export function materializeResults(
  documentId: string,
  studyId: string,
  drafts: ParsedResultDraft[],
): TestResult[] {
  // Conflicts need result_ids, so assign ids first, then cross-reference.
  const results: TestResult[] = drafts.map((d) => ({
    result_id: newId("res"),
    document_id: documentId,
    study_id: studyId,
    test_type: d.test_type,
    value_raw: d.value_raw,
    value: d.value,
    unit_raw: d.unit_raw,
    unit_normalized: d.unit_normalized,
    value_normalized: d.value_normalized,
    conversion: d.conversion,
    reference_range: d.reference_range,
    laterality: d.laterality,
    timestamp: d.timestamp,
    date_raw: d.date_raw,
    page: d.page,
    source_text: d.source_text,
    extraction_method: d.extraction_method,
    extraction_confidence: d.extraction_confidence,
    ambiguity_flags: d.ambiguity_flags,
    conflicts: [],
    verification: { status: "AUTO_EXTRACTED", at: new Date().toISOString() },
    verification_history: [
      { at: new Date().toISOString(), actor: "system", action: "generate", note: `parser=${TEST_RESULTS_VERSION}` },
    ],
    created_at: new Date().toISOString(),
    parser_version: TEST_RESULTS_VERSION,
  }));

  // Conflict detection on the materialized records.
  const groups = new Map<string, TestResult[]>();
  for (const r of results) {
    if (r.value === undefined) continue;
    const key = `${r.test_type}|${r.laterality}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  for (const group of groups.values()) {
    const distinct = new Set(group.map((r) => r.value));
    if (group.length > 1 && distinct.size > 1) {
      for (const r of group) {
        r.conflicts = group.filter((o) => o.result_id !== r.result_id && o.value !== r.value).map((o) => o.result_id);
      }
    }
  }
  return results;
}
