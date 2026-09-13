/**
 * Phase 8 retinal evidence fusion.
 *
 * This is a deterministic review-routing layer, not a diagnostic ensemble.
 * It keeps evidence from different modalities and model executions separate,
 * records shared-pixel dependency groups, and emits explicit missing/conflict
 * states. It never averages scores, chooses a model winner, or turns an
 * empty/normal-looking output into a normal-eye claim.
 */

import type { EvidenceConflict, EvidenceItem } from "./types";
import { SYMPTOM_MAP } from "../clinical/symptoms";

export const RETINAL_EVIDENCE_FUSION_VERSION = "phase8-retinal-evidence-fusion-1.0.0";

export type RetinalFusionPriority = "EMERGENCY" | "URGENT" | "HIGH" | "ROUTINE" | "UNABLE_TO_ASSESS";
export type RetinalRoutingLane = "RETINA" | "GLAUCOMA" | "MACULA_OCT" | "COMPREHENSIVE";

export interface RetinalFusionDependencyGroup {
  dependency_group_id: string;
  evidence_ids: string[];
  source_types: string[];
  modalities: string[];
  model_ids: string[];
  shared_pixel_lineage: boolean;
}

export interface RetinalFusionConflict {
  conflict_id: string;
  kind: "EXISTING_EVIDENCE_CONFLICT" | "CROSS_MODALITY_REVIEW_CONFLICT";
  evidence_ids: string[];
  note: string;
  automatic_resolution: "NONE";
}

export interface RetinalFusionModalityState {
  modality: "FUNDUS" | "OCT" | "OPTIC_DISC";
  state: "EVIDENCE_PRESENT" | "NO_SIGNAL_NOT_NORMAL" | "NORMAL_ESTIMATE_NOT_HEALTHY" | "BLOCKED_QUALITY" | "BLOCKED_OOD" | "NOT_RECORDED";
  evidence_ids: string[];
  note: string;
  normality_claim_allowed: false;
}

export interface RetinalEvidenceFusionResult {
  schema_version: string;
  evidence_ids: string[];
  rejected_evidence_ids: string[];
  active_evidence_ids: string[];
  dependency_groups: RetinalFusionDependencyGroup[];
  independent_source_group_count: number;
  trust_hierarchy: {
    order: string[];
    resolution_policy: string;
  };
  modalities: {
    FUNDUS: RetinalFusionModalityState;
    OCT: RetinalFusionModalityState;
    OPTIC_DISC: RetinalFusionModalityState;
  };
  missing_evidence: string[];
  conflicts: RetinalFusionConflict[];
  review_priority: RetinalFusionPriority;
  routing_lanes: RetinalRoutingLane[];
  urgent_flags: Array<{
    symptom_type: string;
    label: string;
    urgency: "emergency" | "urgent";
    independent_of_ai_findings: true;
    evidence_ids: string[];
  }>;
  claims: Array<{
    claim_id: string;
    text: string;
    evidence_ids: string[];
    dependency_group_ids: string[];
    release_status: "RESEARCH_REVIEW_ONLY" | "CLINICIAN_REVIEW_REQUIRED" | "BLOCKED_NO_EVIDENCE";
  }>;
  safety: {
    diagnostic_ensemble: false;
    score_averaging: false;
    normality_claim_allowed: false;
    no_false_normal: true;
    urgent_symptoms_independent: true;
    note: string;
  };
}

const TRUST_RANK: Record<string, number> = {
  CLINICIAN_ENTERED: 5,
  HUMAN_VERIFIED: 4,
  VALIDATED_AI_FINDING: 3,
  AUTO_EXTRACTED: 2,
  UNVERIFIED: 1,
  REJECTED: 0,
};

function textOf(item: EvidenceItem): string {
  return [item.category, item.concept, item.qualitative_finding, item.raw_value, item.normalized_value]
    .filter((value) => value !== undefined && value !== null)
    .map(String)
    .join(" ")
    .toLowerCase();
}

function modalityOf(item: EvidenceItem): "FUNDUS" | "OCT" | "OPTIC_DISC" | "OTHER" {
  const text = `${item.modality ?? ""} ${item.category} ${item.concept ?? ""}`.toLowerCase();
  if (/oct|macula|rnfl|gcc|b[- ]?scan/.test(text)) return "OCT";
  if (/optic.?disc|optic.?cup|cup.?disc|rnfl|glaucoma/.test(text)) return "OPTIC_DISC";
  if (item.source_type === "AI_FINDING" || /fundus|retina|retinal|lesion|hemorrhage|exudate|microaneurysm/.test(text)) return "FUNDUS";
  return "OTHER";
}

function isBlockedQuality(item: EvidenceItem): boolean {
  const quality = String((item as EvidenceItem & { quality_status?: string }).quality_status ?? "").toLowerCase();
  return quality === "fail" || quality === "failed" || quality === "poor" || item.uncertainty?.some((v) => /quality[_ -]?fail|poor[_ -]?quality/i.test(v)) === true;
}

function isBlockedOod(item: EvidenceItem): boolean {
  const ood = String((item as EvidenceItem & { ood_status?: string }).ood_status ?? "").toLowerCase();
  return ood === "out_of_distribution" || ood === "ood" || item.uncertainty?.some((v) => /out[_ -]?of[_ -]?distribution|\bood\b/i.test(v)) === true;
}

function isOctNormal(item: EvidenceItem): boolean {
  return modalityOf(item) === "OCT" && /\bnormal\b/.test(textOf(item)) && item.presence !== "ABSENT";
}

function isPositive(item: EvidenceItem): boolean {
  return item.presence === "PRESENT" || (item.presence === "UNKNOWN" && Boolean(item.qualitative_finding));
}

function stableUnique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function existingConflict(conflict: EvidenceConflict): RetinalFusionConflict {
  return {
    conflict_id: conflict.id,
    kind: "EXISTING_EVIDENCE_CONFLICT",
    evidence_ids: [...conflict.evidence_ids],
    note: conflict.note,
    automatic_resolution: "NONE",
  };
}

function modalityState(
  modality: "FUNDUS" | "OCT" | "OPTIC_DISC",
  items: EvidenceItem[],
): RetinalFusionModalityState {
  const evidence = items.filter((item) => modalityOf(item) === modality);
  const ids = evidence.map((item) => item.id);
  if (evidence.length === 0) {
    return { modality, state: "NOT_RECORDED", evidence_ids: [], note: "No evidence for this modality was supplied; this is not a negative result.", normality_claim_allowed: false };
  }
  if (evidence.some(isBlockedQuality)) {
    return { modality, state: "BLOCKED_QUALITY", evidence_ids: ids, note: "Research inference is blocked by an explicit quality failure; no normality is inferred.", normality_claim_allowed: false };
  }
  if (evidence.some(isBlockedOod)) {
    return { modality, state: "BLOCKED_OOD", evidence_ids: ids, note: "Research inference is blocked by an out-of-distribution flag; no normality is inferred.", normality_claim_allowed: false };
  }
  if (modality === "OCT" && evidence.every(isOctNormal)) {
    return { modality, state: "NORMAL_ESTIMATE_NOT_HEALTHY", evidence_ids: ids, note: "OCT NORMAL is a model class estimate and does not establish a healthy eye or exclude disease.", normality_claim_allowed: false };
  }
  if (evidence.some(isPositive)) {
    return { modality, state: "EVIDENCE_PRESENT", evidence_ids: ids, note: "Evidence is present and remains research-only until clinician review.", normality_claim_allowed: false };
  }
  return { modality, state: "NO_SIGNAL_NOT_NORMAL", evidence_ids: ids, note: "No signal was recorded in this modality; no disease exclusion or normality claim is allowed.", normality_claim_allowed: false };
}

function priorityFor(
  urgentFlags: RetinalEvidenceFusionResult["urgent_flags"],
  conflicts: RetinalFusionConflict[],
  active: EvidenceItem[],
): RetinalFusionPriority {
  if (urgentFlags.some((flag) => flag.urgency === "emergency")) return "EMERGENCY";
  if (urgentFlags.length > 0) return "URGENT";
  if (conflicts.length > 0 || active.some((item) => isBlockedQuality(item) || isBlockedOod(item))) return "HIGH";
  if (active.length === 0) return "UNABLE_TO_ASSESS";
  return "ROUTINE";
}

function lanesFor(items: EvidenceItem[]): RetinalRoutingLane[] {
  const modalities = new Set(items.map(modalityOf));
  const text = items.map(textOf).join(" ");
  const lanes: RetinalRoutingLane[] = [];
  if (modalities.has("FUNDUS")) lanes.push("RETINA");
  if (modalities.has("OPTIC_DISC") || /glaucoma|optic.?disc|optic.?cup/.test(text)) lanes.push("GLAUCOMA");
  if (modalities.has("OCT")) lanes.push("MACULA_OCT");
  if (lanes.length === 0) lanes.push("COMPREHENSIVE");
  return lanes;
}

/**
 * Fuse the existing evidence array. This function is pure and deterministic;
 * the same input is enough to reproduce the review view and audit output.
 */
export function fuseRetinalEvidence(
  evidence: EvidenceItem[],
  existingConflicts: EvidenceConflict[] = [],
): RetinalEvidenceFusionResult {
  const rejected = evidence.filter((item) => item.trust_level === "REJECTED");
  const active = evidence.filter((item) => item.trust_level !== "REJECTED");
  const groups = new Map<string, RetinalFusionDependencyGroup>();
  for (const item of active) {
    const dependencyGroupId = item.dependency_group_id ?? `unrecorded:${item.id}`;
    const group = groups.get(dependencyGroupId) ?? {
      dependency_group_id: dependencyGroupId,
      evidence_ids: [],
      source_types: [],
      modalities: [],
      model_ids: [],
      shared_pixel_lineage: item.source_type === "AI_FINDING" || modalityOf(item) === "FUNDUS" || modalityOf(item) === "OCT",
    };
    group.evidence_ids.push(item.id);
    group.source_types = stableUnique([...group.source_types, item.source_type]);
    group.modalities = stableUnique([...group.modalities, modalityOf(item)]);
    if (item.model_id) group.model_ids = stableUnique([...group.model_ids, item.model_id]);
    group.shared_pixel_lineage = group.shared_pixel_lineage || item.source_type === "AI_FINDING";
    groups.set(dependencyGroupId, group);
  }

  const urgentFlags = active.flatMap((item) => {
    if (item.source_type !== "SYMPTOM" || item.presence !== "PRESENT") return [];
    const definition = SYMPTOM_MAP[item.category];
    if (!definition?.red_flag) return [];
    return [{
      symptom_type: item.category,
      label: definition.label,
      urgency: definition.urgency as "emergency" | "urgent",
      independent_of_ai_findings: true as const,
      evidence_ids: [item.id],
    }];
  });

  const conflicts = existingConflicts.map(existingConflict);
  const fundusItems = active.filter((item) => modalityOf(item) === "FUNDUS");
  const octItems = active.filter((item) => modalityOf(item) === "OCT");
  if (fundusItems.some(isPositive) && octItems.some(isOctNormal)) {
    conflicts.push({
      conflict_id: "fusion:fundus-oct-review",
      kind: "CROSS_MODALITY_REVIEW_CONFLICT",
      evidence_ids: stableUnique([...fundusItems.map((item) => item.id), ...octItems.map((item) => item.id)]),
      note: "Fundus evidence and an OCT NORMAL estimate are not equivalent measurements; the cross-modality relationship requires clinician review and has no automatic winner.",
      automatic_resolution: "NONE",
    });
  }

  const modalities = {
    FUNDUS: modalityState("FUNDUS", active),
    OCT: modalityState("OCT", active),
    OPTIC_DISC: modalityState("OPTIC_DISC", active),
  };
  const missingEvidence: string[] = [];
  if (modalities.FUNDUS.state === "NOT_RECORDED") missingEvidence.push("FUNDUS_EVIDENCE");
  if (modalities.OCT.state === "NOT_RECORDED") missingEvidence.push("OCT_EVIDENCE");
  if (modalities.OPTIC_DISC.state === "NOT_RECORDED") missingEvidence.push("OPTIC_DISC_EVIDENCE");
  if (!active.some((item) => item.source_type === "CLINICIAN_OBSERVATION" || item.trust_level === "CLINICIAN_ENTERED")) {
    missingEvidence.push("CLINICIAN_VERIFIED_OBSERVATION");
  }
  if (!active.some((item) => item.source_type === "SYMPTOM")) missingEvidence.push("PATIENT_REPORTED_SYMPTOMS");

  const priority = priorityFor(urgentFlags, conflicts, active);
  const claims = active.length === 0
    ? [{ claim_id: "fusion:no-evidence", text: "No retinal evidence was supplied; automated interpretation is unavailable.", evidence_ids: [], dependency_group_ids: [], release_status: "BLOCKED_NO_EVIDENCE" as const }]
    : [{
      claim_id: "fusion:review-summary",
      text: "Retinal evidence has been organized for research review; it is not a diagnosis and does not establish normality.",
      evidence_ids: active.map((item) => item.id),
      dependency_group_ids: [...groups.keys()],
      release_status: "RESEARCH_REVIEW_ONLY" as const,
    }];

  return {
    schema_version: RETINAL_EVIDENCE_FUSION_VERSION,
    evidence_ids: evidence.map((item) => item.id),
    rejected_evidence_ids: rejected.map((item) => item.id),
    active_evidence_ids: active.map((item) => item.id),
    dependency_groups: [...groups.values()].map((group) => ({
      ...group,
      evidence_ids: stableUnique(group.evidence_ids),
      source_types: stableUnique(group.source_types),
      modalities: stableUnique(group.modalities),
      model_ids: stableUnique(group.model_ids),
    })),
    independent_source_group_count: groups.size,
    trust_hierarchy: {
      order: ["CLINICIAN_ENTERED", "HUMAN_VERIFIED", "VALIDATED_AI_FINDING", "AUTO_EXTRACTED", "UNVERIFIED", "REJECTED"],
      resolution_policy: "Trust ranks review priority only. Conflicts are never auto-resolved and model outputs sharing pixels are not independent evidence.",
    },
    modalities,
    missing_evidence: missingEvidence,
    conflicts,
    review_priority: priority,
    routing_lanes: lanesFor(active),
    urgent_flags: urgentFlags,
    claims,
    safety: {
      diagnostic_ensemble: false,
      score_averaging: false,
      normality_claim_allowed: false,
      no_false_normal: true,
      urgent_symptoms_independent: true,
      note: "Research findings, source documents, symptoms, tests, and clinician observations remain provenance-bearing layers. A negative, unavailable, OOD, poor-quality, or OCT NORMAL result does not establish a normal eye.",
    },
  };
}

export class RetinalEvidenceFusionEngine {
  static readonly version = RETINAL_EVIDENCE_FUSION_VERSION;

  fuse(evidence: EvidenceItem[], existingConflicts: EvidenceConflict[] = []): RetinalEvidenceFusionResult {
    return fuseRetinalEvidence(evidence, existingConflicts);
  }
}

/** Exported for contract tests and audit tooling without exposing internal ranking semantics. */
export function trustRank(trustLevel: string): number {
  return TRUST_RANK[trustLevel] ?? -1;
}
