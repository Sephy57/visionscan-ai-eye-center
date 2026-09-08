import { newId } from "../storage/files";
import type { EvidenceConflict, EvidenceItem } from "./types";

/**
 * Cross-source conflict detection (S5.6). Deterministic, presence-based -
 * no automatic winner is ever chosen. REJECTED evidence never participates.
 *
 * IMPORTANT SAFETY BOUNDARY (S5.4/S5.22): this function never associates two
 * evidence items just because they mention different eyes or the same
 * category - "IOP OD elevated" and "blurred vision OS" are NOT a conflict,
 * they are two separate, unrelated pieces of evidence. A conflict is only
 * raised when items disagree about the SAME laterality (VALUE_CONFLICT),
 * or when a single source already recorded contradictory laterality tokens
 * for the same match (LATERALITY_CONFLICT, propagated from S3's
 * `contradictory_laterality` flag - never inferred across sources).
 */
export function detectConflicts(items: EvidenceItem[]): EvidenceConflict[] {
  const trusted = items.filter((i) => i.trust_level !== "REJECTED");
  const conflicts: EvidenceConflict[] = [];

  // VALUE_CONFLICT: same category + metric subtype + same known laterality,
  // distinct numeric values. A subtype is part of the identity because a
  // visual-field MD and PSD (or OCT RNFL and GCC) are not competing values.
  const byValueKey = new Map<string, EvidenceItem[]>();
  for (const it of trusted) {
    if (it.value === undefined || it.laterality === "UNKNOWN") continue;
    const key = `${it.category}|${it.metric_subtype ?? ""}|${it.laterality}`;
    byValueKey.set(key, [...(byValueKey.get(key) ?? []), it]);
  }
  for (const group of byValueKey.values()) {
    const distinct = new Set(group.map((g) => g.value));
    if (group.length > 1 && distinct.size > 1) {
      const category = group[0].category;
      const metricLabel = group[0].metric_subtype ? ` ${group[0].metric_subtype}` : "";
      const laterality = group[0].laterality;
      conflicts.push({
        id: newId("conf"),
        conflict_type: "VALUE_CONFLICT",
        category,
        laterality: [laterality],
        evidence_ids: group.map((g) => g.id),
        severity: "medium",
        resolution_state: "UNRESOLVED",
        note: `${group.length} evidence item(s) disagree on ${category}${metricLabel} (${laterality}); no value was chosen automatically - human resolution required.`,
      });
    }
  }

  // LATERALITY_CONFLICT: propagate a source's own internal contradiction
  // (S3 `contradictory_laterality`) - never a cross-source inference.
  for (const it of trusted) {
    if (it.uncertainty?.includes("contradictory_laterality")) {
      conflicts.push({
        id: newId("conf"),
        conflict_type: "LATERALITY_CONFLICT",
        category: it.category,
        laterality: ["UNKNOWN"],
        evidence_ids: [it.id],
        severity: "high",
        resolution_state: "UNRESOLVED",
        note: `Source text for this ${it.category} result contains contradictory laterality tokens; laterality was kept UNKNOWN rather than guessed - human resolution required.`,
      });
    }
  }

  // QUALITATIVE_CONFLICT: same category + same known laterality, different
  // source types, opposing qualitative findings (both present, distinct labels).
  const byQualKey = new Map<string, EvidenceItem[]>();
  for (const it of trusted) {
    if (!it.qualitative_finding || it.laterality === "UNKNOWN") continue;
    const key = `${it.category}|${it.metric_subtype ?? ""}|${it.laterality}`;
    byQualKey.set(key, [...(byQualKey.get(key) ?? []), it]);
  }
  for (const group of byQualKey.values()) {
    const distinctSources = new Set(group.map((g) => g.source_type));
    const distinctLabels = new Set(group.map((g) => g.qualitative_finding));
    if (distinctSources.size > 1 && distinctLabels.size > 1) {
      const category = group[0].category;
      const metricLabel = group[0].metric_subtype ? ` ${group[0].metric_subtype}` : "";
      const laterality = group[0].laterality;
      conflicts.push({
        id: newId("conf"),
        conflict_type: "QUALITATIVE_CONFLICT",
        category,
        laterality: [laterality],
        evidence_ids: group.map((g) => g.id),
        severity: "low",
        resolution_state: "UNRESOLVED",
        note: `Different sources reported different qualitative findings for ${category}${metricLabel} (${laterality}); no finding was preferred automatically.`,
      });
    }
  }

  return conflicts;
}

/** Stamps each evidence item's conflict_ids from the detected conflicts (additive, called once per synthesis). */
export function attachConflictIds(items: EvidenceItem[], conflicts: EvidenceConflict[]): void {
  const byId = new Map(items.map((i) => [i.id, i]));
  for (const c of conflicts) {
    for (const id of c.evidence_ids) {
      const item = byId.get(id);
      if (item && !item.conflict_ids.includes(c.id)) item.conflict_ids.push(c.id);
    }
  }
}
