/**
 * Research-only dataset management.
 *
 * Enforces:
 *  - patient-level separation across train / validation / locked_test / external_test
 *  - locked test sets are READ-ONLY (mutations rejected; documented override only)
 *  - de-identification: patient_key must be a salted hash, never raw identifiers
 *  - versioned datasets with provenance
 *
 * Same-patient scans across splits are rejected unless an explicit, audited
 * exception is recorded (documented_exemption with reason).
 */

import { dbPut, dbGet, dbAll } from "../storage/db";
import { newId } from "../storage/files";
import { audit } from "../audit";
import { createHash } from "crypto";

export type SplitPurpose = "train" | "validation" | "locked_test" | "external_test";

export interface DatasetRecord {
  dataset_id: string;
  name: string;
  version: string;
  purpose: SplitPurpose;
  locked: boolean;                    // true for locked_test (read-only)
  modality: string;
  created_at: string;
  provenance_note: string;            // source, population, labeling methodology
}

export interface DatasetSample {
  sample_id: string;
  dataset_id: string;
  study_id: string;                   // study-level id
  patient_key: string;                // DE-IDENTIFIED: salted hash, never a raw identifier
  modality: string;
  device: { manufacturer?: string; model?: string; scan_protocol?: string } | null;
  split: SplitPurpose;
  reference_label: string | null;     // set only via adjudication workflow
  label_provenance: string | null;    // grader/agreement/adjudication record id
  added_at: string;
}

export function deidentifyPatientKey(rawIdentifier: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${rawIdentifier}`).digest("hex").slice(0, 24);
}

export async function createDataset(params: {
  name: string;
  version: string;
  purpose: SplitPurpose;
  modality: string;
  provenance_note: string;
}): Promise<DatasetRecord> {
  const rec: DatasetRecord = {
    dataset_id: newId("ds"),
    name: params.name,
    version: params.version,
    purpose: params.purpose,
    locked: params.purpose === "locked_test",
    modality: params.modality,
    created_at: new Date().toISOString(),
    provenance_note: params.provenance_note,
  };
  await dbPut("datasets", rec.dataset_id, rec);
  await audit({ actor: "research", action: "dataset.create", outcome: "ok", detail: `${rec.dataset_id} ${rec.purpose}${rec.locked ? " LOCKED" : ""}` });
  return rec;
}

export interface AddSampleResult {
  ok: boolean;
  reason?: string;
  sample?: DatasetSample;
}

export async function addSample(params: {
  dataset_id: string;
  study_id: string;
  patient_key: string;
  modality: string;
  device?: DatasetSample["device"];
  documented_exemption?: string;      // required to override cross-split patient leakage
}): Promise<AddSampleResult> {
  const ds = await dbGet<DatasetRecord>("datasets", params.dataset_id);
  if (!ds) return { ok: false, reason: "Dataset not found." };

  // Locked test sets are read-only: no samples may be added, even by admins,
  // without a documented exemption (which itself is audited).
  if (ds.locked && !params.documented_exemption) {
    await audit({ actor: "research", action: "dataset.add_sample", studyId: params.study_id, outcome: "rejected", detail: "locked test set is read-only" });
    return { ok: false, reason: "Locked test set is read-only. Modifying membership is forbidden; a documented exemption with reason is required and will be audited." };
  }

  // Patient-level leakage guard across ALL splits.
  const allSamples = await dbAll<DatasetSample>("dataset_samples");
  const clash = allSamples.find(
    (s) => s.patient_key === params.patient_key && s.split !== ds.purpose && s.dataset_id !== ds.dataset_id
  );
  if (clash && !params.documented_exemption) {
    await audit({ actor: "research", action: "dataset.add_sample", studyId: params.study_id, outcome: "rejected", detail: `patient-level leakage: same patient exists in split ${clash.split}` });
    return { ok: false, reason: `Patient-level leakage rejected: this patient already appears in split "${clash.split}". Same-patient scans must never span train/validation/locked-test/external-test without a documented exemption.` };
  }

  const sample: DatasetSample = {
    sample_id: newId("smp"),
    dataset_id: ds.dataset_id,
    study_id: params.study_id,
    patient_key: params.patient_key,
    modality: params.modality,
    device: params.device ?? null,
    split: ds.purpose,
    reference_label: null,
    label_provenance: null,
    added_at: new Date().toISOString(),
  };
  await dbPut("dataset_samples", sample.sample_id, sample);
  if (params.documented_exemption) {
    await audit({ actor: "research", action: "dataset.add_sample.exemption", studyId: params.study_id, outcome: "ok", detail: `documented exemption: ${params.documented_exemption.slice(0, 150)}` });
  }
  return { ok: true, sample };
}

/** Reference standard labels can only be set through the adjudication workflow. */
export async function setReferenceLabel(
  sampleId: string,
  label: string,
  labelProvenanceId: string
): Promise<AddSampleResult> {
  const sample = await dbGet<DatasetSample>("dataset_samples", sampleId);
  if (!sample) return { ok: false, reason: "Sample not found." };
  const ds = await dbGet<DatasetRecord>("datasets", sample.dataset_id);
  if (ds?.locked) {
    return { ok: false, reason: "Locked test set labels are immutable." };
  }
  const adj = await dbGet<AdjudicationRecord>("adjudications", labelProvenanceId);
  if (!adj || adj.sample_id !== sampleId) {
    return { ok: false, reason: "Label provenance must reference a completed multi-grader adjudication (or unanimous agreement) record." };
  }
  sample.reference_label = adj.final_label;
  sample.label_provenance = adj.adjudication_id;
  await dbPut("dataset_samples", sampleId, sample);
  await audit({ actor: "research", action: "dataset.set_reference_label", outcome: "ok", detail: `${sampleId} <- ${adj.final_label} via ${adj.adjudication_id}` });
  return { ok: true, sample };
}

// ---------------------------------------------------------------------------
// Multi-grader labeling + adjudication
// ---------------------------------------------------------------------------

export interface GraderAnnotation {
  grader_id: string;
  annotation: string;
  timestamp: string;
}

export interface AdjudicationRecord {
  adjudication_id: string;
  sample_id: string;
  annotations: GraderAnnotation[];
  agreement: "unanimous" | "majority" | "disagreement" | "insufficient";
  adjudicator_id: string | null;
  final_label: string | null;
  reason: string | null;
  created_at: string;
}

/**
 * Record expert annotations and compute agreement. If graders disagree, a
 * reference standard CANNOT be finalized until an adjudicator resolves it.
 * One expert's label is never silently selected as truth.
 */
export async function recordAnnotations(
  sampleId: string,
  annotations: Array<{ grader_id: string; annotation: string }>
): Promise<AdjudicationRecord> {
  const anns: GraderAnnotation[] = annotations.map((a) => ({ ...a, timestamp: new Date().toISOString() }));
  const unique = [...new Set(anns.map((a) => a.annotation))];
  let agreement: AdjudicationRecord["agreement"];
  if (anns.length < 2) agreement = "insufficient";
  else if (unique.length === 1) agreement = "unanimous";
  else agreement = "disagreement";

  const rec: AdjudicationRecord = {
    adjudication_id: newId("adj"),
    sample_id: sampleId,
    annotations: anns,
    agreement,
    adjudicator_id: null,
    final_label: agreement === "unanimous" ? unique[0] : null,
    reason: agreement === "unanimous" ? "Unanimous expert agreement." : null,
    created_at: new Date().toISOString(),
  };
  await dbPut("adjudications", rec.adjudication_id, rec);
  await audit({ actor: "research", action: "adjudication.record", outcome: "ok", detail: `${sampleId} agreement=${agreement} graders=${anns.length}` });
  return rec;
}

export async function adjudicate(
  adjudicationId: string,
  adjudicatorId: string,
  finalLabel: string,
  reason: string
): Promise<AdjudicationRecord | null> {
  const rec = await dbGet<AdjudicationRecord>("adjudications", adjudicationId);
  if (!rec) return null;
  if (rec.agreement === "unanimous") return rec; // already resolved
  if (rec.agreement === "insufficient") {
    throw new Error("Insufficient graders: at least two independent annotations are required before adjudication.");
  }
  const annotated = rec.annotations.some((a) => a.annotation === finalLabel);
  if (!annotated) {
    throw new Error("Adjudicator must select one of the recorded expert annotations, not invent a new label.");
  }
  rec.adjudicator_id = adjudicatorId;
  rec.final_label = finalLabel;
  rec.reason = reason;
  await dbPut("adjudications", adjudicationId, rec);
  await audit({ actor: `adjudicator:${adjudicatorId}`, action: "adjudication.resolve", outcome: "ok", detail: `${rec.sample_id} -> ${finalLabel}` });
  return rec;
}

export { dbAll as allDatasetSamples };
