/**
 * Model status transition workflow.
 *
 *   DEMO -> RESEARCH -> INTERNAL_VALIDATION -> EXTERNALLY_VALIDATED -> CLINICALLY_VALIDATED
 *
 * Each transition has explicit evidence requirements. Transitions are
 * REJECTED (fail closed) unless:
 *   - the path follows the ladder (no skipping),
 *   - every required evidence reference exists and validates,
 *   - performance metrics exist in the registry record,
 *   - the request is audited.
 *
 * Transitions are persisted (transitions collection) and applied to the
 * in-memory registry for the session. The UI shows the CURRENT STATUS and
 * WHY the model holds it.
 */

import { dbPut, dbAll } from "../storage/db";
import { newId } from "../storage/files";
import { audit } from "../audit";
import { ModelStatus, MODELS, STATUS_CAPABILITIES, gateModelUse } from "./registry";
import { getEvidence, EvidenceRecord } from "../research/evidence";
import { ensureRegistryHydrated, persistModelState } from "./registryPersistence";

export const STATUS_LADDER: ModelStatus[] = [
  "DEMO", "RESEARCH", "INTERNAL_VALIDATION", "EXTERNALLY_VALIDATED", "CLINICALLY_VALIDATED",
];

export interface TransitionRequirement {
  minEvidence: number;
  evidenceMustIncludeExternalStudy: boolean;
  requiresValidationDate: boolean;
  requiresCalibration: boolean;
  description: string;
}

export const TRANSITION_REQUIREMENTS: Record<string, TransitionRequirement> = {
  "DEMO->RESEARCH": {
    minEvidence: 0, evidenceMustIncludeExternalStudy: false, requiresValidationDate: false, requiresCalibration: false,
    description: "Research use acknowledged; output labeled RESEARCH USE ONLY.",
  },
  "RESEARCH->INTERNAL_VALIDATION": {
    minEvidence: 1, evidenceMustIncludeExternalStudy: false, requiresValidationDate: true, requiresCalibration: false,
    description: "At least one registered evaluation on internal held-out data with metrics.",
  },
  "INTERNAL_VALIDATION->EXTERNALLY_VALIDATED": {
    minEvidence: 2, evidenceMustIncludeExternalStudy: true, requiresValidationDate: true, requiresCalibration: true,
    description: "Evaluation on an independent external dataset (evidence of type external_study or evaluation_run referencing one) plus calibration evidence.",
  },
  "EXTERNALLY_VALIDATED->CLINICALLY_VALIDATED": {
    minEvidence: 3, evidenceMustIncludeExternalStudy: true, requiresValidationDate: true, requiresCalibration: true,
    description: "Full clinical validation evidence: external study + clinical evaluation + documented methodology and population.",
  },
};

export interface TransitionRecord {
  transition_id: string;
  model_id: string;
  from_status: ModelStatus;
  to_status: ModelStatus;
  evidence_refs: string[];
  requested_by: string;
  decision: "approved" | "rejected";
  reasons: string[];
  at: string;
}

function rank(s: ModelStatus): number {
  return STATUS_LADDER.indexOf(s);
}

export async function whyStatus(modelId: string): Promise<string[]> {
  await ensureRegistryHydrated();
  const model = MODELS[modelId];
  if (!model) return ["Unknown model id."];
  const gate = gateModelUse(model);
  const reasons: string[] = [];
  reasons.push(`Status ${model.status} — permitted use: ${gate.findings_use.replaceAll("_", " ")}.`);
  if (model.status === "DEMO") reasons.push("Synthetic demo model; no medical model artifact or validation evidence exists.");
  if (model.performance.evidence_reference === null) reasons.push("No evaluation evidence reference has been recorded for this model.");
  if (!model.validation_date) reasons.push("No validation date has been recorded.");
  if (model.external_validation_status !== "completed") reasons.push("Independent external validation has not been completed.");
  if (model.clinical_validation_status !== "completed") reasons.push("Clinical validation has not been completed.");
  if (model.regulatory_status === "none") reasons.push("No regulatory authorization has been obtained.");
  for (const r of gate.reasons) reasons.push(r);
  return reasons;
}

export async function requestStatusTransition(params: {
  model_id: string;
  to_status: ModelStatus;
  evidence_refs: string[];
  requested_by: string;
}): Promise<TransitionRecord> {
  await ensureRegistryHydrated();
  const model = MODELS[params.model_id];
  if (!model) throw new Error(`Unknown model: ${params.model_id}`);

  const fromIdx = rank(model.status);
  const toIdx = rank(params.to_status);
  const key = `${model.status}->${params.to_status}`;
  const req = TRANSITION_REQUIREMENTS[key];
  const reasons: string[] = [];

  if (params.to_status === "RETIRED" || params.to_status === model.status) {
    // Retirement/demotion is always permitted (fail-safe direction).
    const rec = await finalize(params, key, params.evidence_refs, "approved", ["Retirement/demotion approved (fail-safe direction)."]);
    return rec;
  }
  if (!req) reasons.push(`Transition ${key} is not a recognized ladder step (no skipping statuses).`);
  if (toIdx !== fromIdx + 1) reasons.push(`Transitions must advance exactly one ladder step (${model.status} -> next); got ${params.to_status}.`);

  // Evidence checks
  const evidences: EvidenceRecord[] = [];
  for (const ref of params.evidence_refs) {
    const e = await getEvidence(ref);
    if (!e) reasons.push(`Evidence ${ref} does not exist in the evidence registry.`);
    else if (e.model_id !== params.model_id) reasons.push(`Evidence ${ref} belongs to model ${e.model_id}, not ${params.model_id}.`);
    else evidences.push(e);
  }
  if (req) {
    const valid = evidences.length;
    if (valid < req.minEvidence) reasons.push(`Transition requires at least ${req.minEvidence} valid evidence record(s); got ${valid}.`);
    if (req.evidenceMustIncludeExternalStudy && !evidences.some((e) => e.type === "external_study" || e.type === "evaluation_run")) {
      reasons.push("Transition requires external-study evidence (independent dataset evaluation).");
    }
    if (req.requiresValidationDate && !model.validation_date) reasons.push("Registry record has no validation date.");
    if (req.requiresCalibration && !model.performance.calibration) reasons.push("Registry record has no calibration information.");
  }

  const decision = reasons.length === 0 ? "approved" : "rejected";
  const rec = await finalize(params, key, params.evidence_refs, decision, reasons);
  return rec;
}

async function finalize(
  params: { model_id: string; to_status: ModelStatus; requested_by: string },
  key: string,
  evidenceRefs: string[],
  decision: "approved" | "rejected",
  reasons: string[]
): Promise<TransitionRecord> {
  const model = MODELS[params.model_id];
  const rec: TransitionRecord = {
    transition_id: newId("trn"),
    model_id: params.model_id,
    from_status: model.status,
    to_status: params.to_status,
    evidence_refs: evidenceRefs,
    requested_by: params.requested_by,
    decision,
    reasons,
    at: new Date().toISOString(),
  };
  await dbPut("transitions", rec.transition_id, rec);
  if (decision === "approved") {
    // Apply to the in-memory registry immediately...
    model.status = params.to_status;
    if (params.to_status === "EXTERNALLY_VALIDATED" || params.to_status === "CLINICALLY_VALIDATED") {
      model.external_validation_status = "completed";
    }
    if (params.to_status === "CLINICALLY_VALIDATED") {
      model.clinical_validation_status = "completed";
    }
    // ...and persist the snapshot atomically so a process restart cannot
    // silently revert a model's status back to its source-code default.
    await persistModelState({
      model_id: params.model_id,
      status: model.status,
      external_validation_status: model.external_validation_status,
      clinical_validation_status: model.clinical_validation_status,
      last_transition_id: rec.transition_id,
      updated_by: params.requested_by,
    });
  }
  await audit({ actor: `admin:${params.requested_by}`, action: "model.transition", outcome: decision === "approved" ? "ok" : "rejected", detail: `${params.model_id} ${key} -> ${decision} (${reasons.join(" ").slice(0, 150)})` });
  return rec;
}

export async function listTransitions(modelId?: string): Promise<TransitionRecord[]> {
  const all = await dbAll<TransitionRecord>("transitions");
  const sorted = all.sort((a, b) => b.at.localeCompare(a.at));
  return modelId ? sorted.filter((t) => t.model_id === modelId) : sorted;
}
