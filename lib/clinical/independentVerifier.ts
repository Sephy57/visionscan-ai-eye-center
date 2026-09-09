/**
 * Independent verification of the deterministic reasoning chain.
 *
 * The verifier does not repeat condition rules.  It checks referential
 * integrity and safety invariants at the boundary where a reasoning result
 * becomes presentation-facing, and reports disagreement instead of repairing
 * data silently.
 */

import type { ConditionAssessment, EvidenceConflict, EvidenceItem } from "../evidence/types";
import type { ModelExecutionLedgerEntry } from "../analysis/schema";

export interface VerificationUrgentFlag {
  symptom_type: string;
  urgency: string;
  independent_of_ai_findings: true;
}

export interface IndependentReasoningVerification {
  status: "VERIFIED" | "FINAL_REASONING_DISAGREEMENT";
  discrepancies: string[];
  checked_evidence_ids: string[];
  checked_condition_ids: string[];
  requires_clinician_review: true;
}

export function verifyReasoningChain(input: {
  evidence: EvidenceItem[];
  conditions: ConditionAssessment[];
  urgentFlags: VerificationUrgentFlag[];
  conflicts?: EvidenceConflict[];
  ledger?: ModelExecutionLedgerEntry[];
}): IndependentReasoningVerification {
  const discrepancies: string[] = [];
  const byId = new Map(input.evidence.map((item) => [item.id, item]));
  const conflictById = new Map((input.conflicts ?? []).map((conflict) => [conflict.id, conflict]));

  for (const condition of input.conditions) {
    for (const id of [...condition.supporting_evidence_ids, ...condition.contradicting_evidence_ids]) {
      if (!byId.has(id)) discrepancies.push(`Condition ${condition.condition_id} references missing evidence ${id}.`);
    }
    for (const id of condition.supporting_evidence_ids) {
      const item = byId.get(id);
      if (item && condition.laterality !== "OU" && item.laterality !== "OU" && item.laterality !== condition.laterality) {
        discrepancies.push(`Condition ${condition.condition_id} combines ${condition.laterality} with ${item.laterality} evidence ${id}.`);
      }
    }
    for (const id of condition.contradicting_evidence_ids) {
      const item = byId.get(id);
      if (item && item.conflict_ids.some((conflictId) => !conflictById.has(conflictId))) {
        discrepancies.push(`Condition ${condition.condition_id} carries an unresolved conflict reference for ${id}.`);
      }
    }
  }

  for (const flag of input.urgentFlags) {
    if (flag.independent_of_ai_findings !== true) discrepancies.push(`Urgent flag ${flag.symptom_type} is not marked independent of AI findings.`);
    if (flag.urgency !== "urgent" && flag.urgency !== "emergency") discrepancies.push(`Urgent flag ${flag.symptom_type} has invalid urgency '${flag.urgency}'.`);
  }

  const validLedgerStatuses = new Set(["EXECUTED", "SKIPPED", "UNAVAILABLE", "FAILED", "BLOCKED_QUALITY", "BLOCKED_OOD", "UNSUPPORTED_MODALITY"]);
  for (const row of input.ledger ?? []) {
    if (!validLedgerStatuses.has(row.execution_status)) discrepancies.push(`Ledger row ${row.model_id}/${row.input_asset_id} has invalid execution status.`);
    if (!Number.isFinite(row.runtime_ms) || row.runtime_ms < 0) discrepancies.push(`Ledger row ${row.model_id}/${row.input_asset_id} has invalid runtime.`);
  }

  return {
    status: discrepancies.length === 0 ? "VERIFIED" : "FINAL_REASONING_DISAGREEMENT",
    discrepancies,
    checked_evidence_ids: input.evidence.map((item) => item.id),
    checked_condition_ids: input.conditions.map((condition) => condition.condition_id),
    requires_clinician_review: true,
  };
}

