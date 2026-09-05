/**
 * Measurement Trend Engine (Phase 5, §10-12).
 *
 * HARD RULE: compares two EvidenceItem[] pools (prior vs. current) for
 * numeric TEST_RESULT evidence, strictly scoped by category AND laterality
 * - an OD value is NEVER compared against an OS value (§9's own hard rule).
 * Never converts units (§10 - "never fabricate conversions"); a unit
 * mismatch is reported as INSUFFICIENT_DATA, not silently normalized.
 * Never classifies a numeric change as clinically significant - only
 * OBSERVED_NUMERIC_CHANGE, never CLINICALLY_SIGNIFICANT_PROGRESSION (§12 -
 * that state does not exist anywhere in this codebase, deliberately).
 */

import type { EvidenceItem, EvidenceLaterality } from "./types";

export type MeasurementChangeState =
  | "NO_PRIOR_COMPARISON"
  | "STABLE"
  | "INCREASED"
  | "DECREASED"
  | "NEW"
  | "RESOLVED"
  | "CONFLICTED"
  | "INSUFFICIENT_DATA"
  | "UNKNOWN";

export interface MeasurementComparison {
  category: string;
  laterality: EvidenceLaterality;
  state: MeasurementChangeState;
  prior_value: number | null;
  prior_unit: string | null;
  prior_timestamp: string | null;
  prior_evidence_id: string | null;
  current_value: number | null;
  current_unit: string | null;
  current_timestamp: string | null;
  current_evidence_id: string | null;
  /** Always false from this engine - see file header. A future validated methodology would need its own, explicit gate to ever set this true. */
  clinically_significant_progression: boolean;
  note: string;
}

function trustedNumeric(items: EvidenceItem[]): EvidenceItem[] {
  return items.filter((i) => i.trust_level !== "REJECTED" && i.source_type === "TEST_RESULT" && typeof i.value === "number" && Number.isFinite(i.value));
}

function key(i: EvidenceItem): string {
  return `${i.category}|${i.laterality}`;
}

/**
 * Deterministic: same two evidence pools always produce the same
 * comparisons in the same order (sorted by category then laterality).
 */
export function compareMeasurements(prior: EvidenceItem[], current: EvidenceItem[]): MeasurementComparison[] {
  const priorByKey = new Map<string, EvidenceItem[]>();
  for (const i of trustedNumeric(prior)) {
    priorByKey.set(key(i), [...(priorByKey.get(key(i)) ?? []), i]);
  }
  const currentByKey = new Map<string, EvidenceItem[]>();
  for (const i of trustedNumeric(current)) {
    currentByKey.set(key(i), [...(currentByKey.get(key(i)) ?? []), i]);
  }

  const allKeys = [...new Set([...priorByKey.keys(), ...currentByKey.keys()])].sort();
  const results: MeasurementComparison[] = [];

  for (const k of allKeys) {
    const [category, laterality] = k.split("|") as [string, EvidenceLaterality];
    const priorItems = priorByKey.get(k) ?? [];
    const currentItems = currentByKey.get(k) ?? [];

    const base = { category, laterality, clinically_significant_progression: false as const };

    if (priorItems.length === 0 && currentItems.length > 0) {
      const c = currentItems[0];
      results.push({
        ...base, state: "NEW",
        prior_value: null, prior_unit: null, prior_timestamp: null, prior_evidence_id: null,
        current_value: c.value ?? null, current_unit: c.unit ?? null, current_timestamp: c.timestamp ?? null, current_evidence_id: c.id,
        note: `${category} (${laterality}) has no prior comparison - this is the first recorded measurement.`,
      });
      continue;
    }
    if (priorItems.length > 0 && currentItems.length === 0) {
      const p = priorItems[0];
      results.push({
        ...base, state: "RESOLVED",
        prior_value: p.value ?? null, prior_unit: p.unit ?? null, prior_timestamp: p.timestamp ?? null, prior_evidence_id: p.id,
        current_value: null, current_unit: null, current_timestamp: null, current_evidence_id: null,
        note: `${category} (${laterality}) was previously recorded but has no current measurement - this does NOT mean the value returned to normal; it may simply not have been re-measured.`,
      });
      continue;
    }

    // Same-side conflicting duplicate values on either side - never silently
    // pick one (mirrors lib/evidence/conflicts.ts's own VALUE_CONFLICT rule).
    const priorDistinct = new Set(priorItems.map((i) => i.value));
    const currentDistinct = new Set(currentItems.map((i) => i.value));
    if (priorDistinct.size > 1 || currentDistinct.size > 1) {
      results.push({
        ...base, state: "CONFLICTED",
        prior_value: null, prior_unit: priorItems[0].unit ?? null, prior_timestamp: null, prior_evidence_id: null,
        current_value: null, current_unit: currentItems[0].unit ?? null, current_timestamp: null, current_evidence_id: null,
        note: `${category} (${laterality}) has conflicting values within the same visit on one or both sides of the comparison - no value was chosen automatically.`,
      });
      continue;
    }

    const p = priorItems[0], c = currentItems[0];
    if ((p.unit ?? null) !== (c.unit ?? null)) {
      results.push({
        ...base, state: "INSUFFICIENT_DATA",
        prior_value: p.value ?? null, prior_unit: p.unit ?? null, prior_timestamp: p.timestamp ?? null, prior_evidence_id: p.id,
        current_value: c.value ?? null, current_unit: c.unit ?? null, current_timestamp: c.timestamp ?? null, current_evidence_id: c.id,
        note: `${category} (${laterality}) was recorded in different units ('${p.unit}' vs '${c.unit}') - no conversion was performed; the values are not directly comparable.`,
      });
      continue;
    }

    const pv = p.value!, cv = c.value!;
    const state: MeasurementChangeState = pv === cv ? "STABLE" : cv > pv ? "INCREASED" : "DECREASED";
    results.push({
      ...base, state,
      prior_value: pv, prior_unit: p.unit ?? null, prior_timestamp: p.timestamp ?? null, prior_evidence_id: p.id,
      current_value: cv, current_unit: c.unit ?? null, current_timestamp: c.timestamp ?? null, current_evidence_id: c.id,
      note: state === "STABLE"
        ? `${category} (${laterality}) is unchanged between the two evidence sets.`
        : `${category} (${laterality}) shows an observed numeric change (${pv} -> ${cv}${p.unit ? ` ${p.unit}` : ""}). This is a raw numeric observation only - it does not by itself establish clinically significant progression.`,
    });
  }

  return results;
}
