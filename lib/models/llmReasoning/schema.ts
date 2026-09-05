/**
 * Phase 9 - strict schema validation for LLM reasoning output (handoff §21).
 *
 * The LLM may return ONLY a strict JSON object with string fields. Every
 * field is validated; anything missing, mistyped (numbers/objects/nested
 * arrays), oversized, or extra beyond tolerance causes rejection - the
 * deterministic result stands alone. There is deliberately NO numeric
 * field: an LLM can never introduce a confidence/probability/score (§32 -
 * no fabricated certainty), only plain-language statements.
 */

export interface LLMInterpretationValue {
  summary: string;
  key_findings: string[];
  possible_conditions: string[];
  possible_etiologies: string[];
  supporting_evidence: string[];
  conflicting_evidence: string[];
  missing_evidence: string[];
  recommended_confirmation: string[];
  urgency: string;
  limitations: string[];
}

export interface SchemaValidationResult {
  ok: boolean;
  errors: string[];
  value?: LLMInterpretationValue;
}

const LIMITS = {
  summaryMax: 2000,
  urgencyMax: 200,
  listMax: 12,
  itemMax: 400,
};

const REQUIRED_LISTS: Array<{ key: keyof LLMInterpretationValue; minItems: number }> = [
  { key: "key_findings", minItems: 0 },
  { key: "possible_conditions", minItems: 0 },
  { key: "possible_etiologies", minItems: 0 },
  { key: "supporting_evidence", minItems: 0 },
  { key: "conflicting_evidence", minItems: 0 },
  { key: "missing_evidence", minItems: 0 },
  { key: "recommended_confirmation", minItems: 1 },
  { key: "limitations", minItems: 1 }, // the LLM must always state limitations
];

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function cleanItem(s: string): string {
  return s.trim().slice(0, LIMITS.itemMax);
}

/**
 * Accepts the parsed JSON value (or a string to parse). Strips optional
 * markdown code fences, then validates every field. Returns all errors,
 * not just the first - the rejection reason is auditable.
 */
export function validateLLMInterpretation(input: unknown): SchemaValidationResult {
  const errors: string[] = [];
  let obj: unknown = input;

  if (typeof obj === "string") {
    let text = obj.trim();
    const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(text);
    if (fence) text = fence[1].trim();
    try {
      obj = JSON.parse(text);
    } catch {
      return { ok: false, errors: ["response is not valid JSON"] };
    }
  }

  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    return { ok: false, errors: ["response must be a JSON object"] };
  }
  const o = obj as Record<string, unknown>;

  // summary
  if (typeof o.summary !== "string" || o.summary.trim().length < 10) {
    errors.push("summary must be a non-empty string (>=10 chars)");
  } else if (o.summary.length > LIMITS.summaryMax) {
    errors.push(`summary exceeds ${LIMITS.summaryMax} chars`);
  }

  // urgency
  if (typeof o.urgency !== "string" || o.urgency.trim().length === 0) {
    errors.push("urgency must be a non-empty string");
  } else if (o.urgency.length > LIMITS.urgencyMax) {
    errors.push(`urgency exceeds ${LIMITS.urgencyMax} chars`);
  }

  // string lists
  for (const { key, minItems } of REQUIRED_LISTS) {
    const v = o[key];
    if (!isStringArray(v)) {
      errors.push(`${key} must be an array of strings`);
      continue;
    }
    if (v.length > LIMITS.listMax) {
      errors.push(`${key} exceeds ${LIMITS.listMax} items`);
      continue;
    }
    if (v.length < minItems) {
      errors.push(`${key} must contain at least ${minItems} item(s)`);
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  const value: LLMInterpretationValue = {
    summary: (o.summary as string).trim().slice(0, LIMITS.summaryMax),
    urgency: (o.urgency as string).trim().slice(0, LIMITS.urgencyMax),
    key_findings: (o.key_findings as string[]).map(cleanItem),
    possible_conditions: (o.possible_conditions as string[]).map(cleanItem),
    possible_etiologies: (o.possible_etiologies as string[]).map(cleanItem),
    supporting_evidence: (o.supporting_evidence as string[]).map(cleanItem),
    conflicting_evidence: (o.conflicting_evidence as string[]).map(cleanItem),
    missing_evidence: (o.missing_evidence as string[]).map(cleanItem),
    recommended_confirmation: (o.recommended_confirmation as string[]).map(cleanItem),
    limitations: (o.limitations as string[]).map(cleanItem),
  };
  return { ok: true, errors: [], value };
}
