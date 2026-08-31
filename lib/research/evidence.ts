/**
 * Evidence registry.
 *
 * Model status transitions (e.g. RESEARCH -> EXTERNALLY_VALIDATED) require
 * registered evidence records. A manually typed "validated: true" is never
 * accepted as evidence — an evidence record must reference a concrete
 * evaluation run, study, or document with dataset, population, methodology,
 * and metrics.
 */

import { dbPut, dbGet, dbAll } from "../storage/db";
import { newId } from "../storage/files";
import { audit } from "../audit";

export type EvidenceType = "evaluation_run" | "external_study" | "peer_reviewed_document" | "regulatory_submission";

export interface EvidenceRecord {
  evidence_id: string;
  type: EvidenceType;
  title: string;
  model_id: string;
  dataset_ref: string;              // dataset registry id or external dataset identifier
  population: string;               // documented population description
  methodology: string;              // how the evaluation was performed
  metrics_summary: string;          // key metrics (sens/spec/AUROC etc.), no headline accuracy
  evaluation_date: string;          // ISO date
  document_uri?: string;            // local document reference; never a public URL of patient data
  created_at: string;
}

export function validateEvidence(e: EvidenceRecord): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!e.title) reasons.push("title required");
  if (!e.model_id) reasons.push("model_id required");
  if (!e.dataset_ref) reasons.push("dataset_ref required — evidence must name its dataset");
  if (!e.population) reasons.push("population required");
  if (!e.methodology) reasons.push("methodology required");
  if (!e.metrics_summary) reasons.push("metrics_summary required");
  if (!e.evaluation_date) reasons.push("evaluation_date required");
  return { ok: reasons.length === 0, reasons };
}

export async function registerEvidence(input: Omit<EvidenceRecord, "evidence_id" | "created_at">): Promise<EvidenceRecord> {
  const rec: EvidenceRecord = { ...input, evidence_id: newId("evd"), created_at: new Date().toISOString() };
  const v = validateEvidence(rec);
  if (!v.ok) throw new Error("Invalid evidence record: " + v.reasons.join("; "));
  await dbPut("evidence", rec.evidence_id, rec);
  await audit({ actor: "research", action: "evidence.register", outcome: "ok", detail: `${rec.evidence_id} ${rec.type} for ${rec.model_id}` });
  return rec;
}

export async function getEvidence(evidenceId: string): Promise<EvidenceRecord | null> {
  return dbGet<EvidenceRecord>("evidence", evidenceId);
}

export async function listEvidence(modelId?: string): Promise<EvidenceRecord[]> {
  const all = await dbAll<EvidenceRecord>("evidence");
  const sorted = all.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return modelId ? sorted.filter((e) => e.model_id === modelId) : sorted;
}
