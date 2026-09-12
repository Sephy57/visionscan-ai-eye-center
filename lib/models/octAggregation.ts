/**
 * Deterministic multi-scan OCT aggregation for research output.
 *
 * This module aggregates categorical outputs from the same explicitly linked
 * scan set. It never averages logits, invents a confidence, or picks a winner
 * when scan-level classes disagree. A NORMAL class remains a model class, not
 * a healthy-eye claim.
 */

import type { OctRetinalClass } from "./octContract";

export type OctAggregationState =
  | "CONSISTENT_TARGET_CLASS"
  | "CONSISTENT_NO_TARGET_CLASS"
  | "MIXED_OCT_CLASS_RESULTS"
  | "INSUFFICIENT_SCAN_QUALITY"
  | "NOT_COMPARABLE";

export interface OctAggregationInput {
  scan_id: string;
  status: "EXECUTED" | "FAILED" | "SKIPPED";
  predicted_class: OctRetinalClass | null;
  laterality?: "OD" | "OS" | "unknown";
}

export interface OctAggregationResult {
  state: OctAggregationState;
  considered_scan_ids: string[];
  excluded_scan_ids: string[];
  class_counts: Partial<Record<OctRetinalClass, number>>;
  selected_class: OctRetinalClass | null;
  disagreement: boolean;
  requires_clinician_review: true;
  note: string;
}

/** Aggregate only completed, class-bearing scans; skipped/failed scans remain auditable. */
export function aggregateOctScans(scans: readonly OctAggregationInput[]): OctAggregationResult {
  const usable = scans.filter((scan) => scan.status === "EXECUTED" && scan.predicted_class !== null);
  const excluded = scans.filter((scan) => !usable.includes(scan)).map((scan) => scan.scan_id);
  const classCounts: Partial<Record<OctRetinalClass, number>> = {};
  for (const scan of usable) classCounts[scan.predicted_class!] = (classCounts[scan.predicted_class!] ?? 0) + 1;
  const classes = Object.keys(classCounts) as OctRetinalClass[];

  if (usable.length === 0) {
    return {
      state: "INSUFFICIENT_SCAN_QUALITY",
      considered_scan_ids: [],
      excluded_scan_ids: excluded,
      class_counts: classCounts,
      selected_class: null,
      disagreement: false,
      requires_clinician_review: true,
      note: "No completed OCT scan produced a usable class estimate; this is not evidence of a normal OCT or absent disease.",
    };
  }
  if (usable.length === 1) {
    return {
      state: "NOT_COMPARABLE",
      considered_scan_ids: usable.map((scan) => scan.scan_id),
      excluded_scan_ids: excluded,
      class_counts: classCounts,
      selected_class: usable[0].predicted_class,
      disagreement: false,
      requires_clinician_review: true,
      note: "Only one completed OCT scan was available; no multi-scan agreement was established.",
    };
  }
  const lateralities = new Set(usable.map((scan) => scan.laterality ?? "unknown"));
  if (lateralities.has("unknown") || lateralities.size > 1) {
    return {
      state: "NOT_COMPARABLE",
      considered_scan_ids: usable.map((scan) => scan.scan_id),
      excluded_scan_ids: excluded,
      class_counts: classCounts,
      selected_class: null,
      disagreement: false,
      requires_clinician_review: true,
      note: `Completed OCT scans do not carry one explicit same-eye laterality (${[...lateralities].join(", ")}); scans were not pooled and no cross-eye agreement was established.`,
    };
  }
  if (classes.length === 1) {
    const selected = classes[0];
    return {
      state: selected === "NORMAL" ? "CONSISTENT_NO_TARGET_CLASS" : "CONSISTENT_TARGET_CLASS",
      considered_scan_ids: usable.map((scan) => scan.scan_id),
      excluded_scan_ids: excluded,
      class_counts: classCounts,
      selected_class: selected,
      disagreement: false,
      requires_clinician_review: true,
      note: selected === "NORMAL"
        ? "All compared scans produced the model's NORMAL class. This is not a healthy-macula or disease-absence claim."
        : `All compared scans produced ${selected}. This is concordant uncalibrated research output, not a diagnosis.`,
    };
  }
  return {
    state: "MIXED_OCT_CLASS_RESULTS",
    considered_scan_ids: usable.map((scan) => scan.scan_id),
    excluded_scan_ids: excluded,
    class_counts: classCounts,
    selected_class: null,
    disagreement: true,
    requires_clinician_review: true,
    note: `Compared OCT scans produced multiple classes (${classes.join(", ")}); no automatic winner or score average was selected. Clinician reconciliation is required.`,
  };
}
