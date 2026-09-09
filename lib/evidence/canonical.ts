/**
 * Canonical evidence-graph enrichment.
 *
 * Existing adapters intentionally expose a small, backwards-compatible S5
 * shape.  This module adds the explicit fields required by the clinician
 * review contract without creating a second source of truth.  It is pure,
 * deterministic, and never infers a symptom or a diagnosis.
 */

import { createHash } from "crypto";
import type {
  CanonicalEvidenceSourceType,
  EvidenceCertainty,
  EvidenceItem,
  EvidenceNegation,
  EvidenceTemporalState,
} from "./types";

export interface EvidenceGraphContext {
  studyId: string;
  patientId?: string | null;
  encounterId?: string | null;
  modality?: string;
  referenceTimestamp?: string | null;
}

function stableId(parts: string[]): string {
  return `ev_${createHash("sha256").update(parts.join("\u001f")).digest("hex").slice(0, 24)}`;
}

function canonicalSource(item: EvidenceItem): CanonicalEvidenceSourceType {
  switch (item.source_type) {
    case "SYMPTOM": return "PATIENT_REPORTED";
    case "CLINICIAN_OBSERVATION": return "CLINICIAN_VERIFIED";
    case "SOURCE_DOCUMENT_DIAGNOSIS": return "SOURCE_DOCUMENT";
    case "TEST_RESULT": return "DEVICE_MEASUREMENT";
    case "AI_FINDING":
      return /classification|grade|class/i.test(item.category) ? "AI_RESEARCH_CLASSIFICATION" : "AI_RESEARCH_FINDING";
    case "PDF": return "SOURCE_DOCUMENT";
    case "HISTORY":
    case "MEDICATION":
    case "ALLERGY":
    case "IMAGE":
    default: return "DOCUMENT_EXTRACTED";
  }
}

function certaintyFor(item: EvidenceItem): EvidenceCertainty {
  if (item.presence === "UNKNOWN") return "UNKNOWN";
  return item.uncertainty?.includes("explicit_uncertainty") || item.uncertainty?.includes("historical_context")
    ? "UNCERTAIN"
    : "CERTAIN";
}

function negationFor(item: EvidenceItem): EvidenceNegation {
  return item.presence;
}

function parseTimestamp(value?: string | null): number | null {
  if (!value) return null;
  const n = Date.parse(value);
  return Number.isFinite(n) ? n : null;
}

export function temporalStateForEvidence(item: EvidenceItem, referenceTimestamp?: string | null, encounterId?: string | null): EvidenceTemporalState {
  if (encounterId && item.provenance.encounter_id && encounterId === item.provenance.encounter_id) return "SAME_ENCOUNTER";
  const observed = parseTimestamp(item.timestamp);
  const reference = parseTimestamp(referenceTimestamp);
  if (observed === null || reference === null) return "TEMPORALLY_UNCERTAIN";
  const days = Math.abs(observed - reference) / (24 * 60 * 60 * 1000);
  if (days < 1) return "SAME_ENCOUNTER";
  if (days <= 30) return "NEARBY_ENCOUNTER";
  return "HISTORICAL";
}

/**
 * Models reading one immutable image share a dependency group.  Separate
 * document pages, measurements, and encounters retain independent groups.
 * This is deliberately lineage-based rather than a claim about statistical
 * independence.
 */
export function dependencyGroupForEvidence(item: EvidenceItem): string {
  if (item.dependency_group_id) return item.dependency_group_id;
  const p = item.provenance;
  if (item.source_type === "AI_FINDING") {
    return `image:${p.study_id}:${p.source_asset_id ?? p.analysis_id ?? "primary"}`;
  }
  if (item.source_type === "TEST_RESULT") return `measurement:${p.document_id ?? p.study_id}:${item.source_id}`;
  if (p.document_id) return `document:${p.document_id}:page:${p.page ?? "unknown"}`;
  if (p.encounter_id) return `encounter:${p.encounter_id}`;
  return `${item.source_type.toLowerCase()}:${item.source_id}`;
}

export function enrichEvidenceItem(item: EvidenceItem, context: EvidenceGraphContext): EvidenceItem {
  const sourceType = canonicalSource(item);
  const raw = item.raw_value ?? item.qualitative_finding ?? item.value ?? null;
  const normalized = item.normalized_value ?? item.value ?? null;
  const stableEvidenceId = item.evidence_id ?? stableId([
    context.studyId,
    item.source_type,
    item.source_id,
    item.category,
    item.laterality,
    String(item.provenance.page ?? ""),
  ]);
  const modelId = item.model_id ?? (item.source_type === "AI_FINDING" ? (item.provenance.finding_id ? undefined : null) : null);
  return {
    ...item,
    id: stableEvidenceId,
    evidence_id: stableEvidenceId,
    patient_id: item.patient_id ?? context.patientId ?? null,
    encounter_id: item.encounter_id ?? item.provenance.encounter_id ?? context.encounterId ?? null,
    modality: item.modality ?? context.modality,
    concept: item.concept ?? item.category,
    raw_value: raw,
    normalized_value: normalized,
    unit: item.unit,
    negation: item.negation ?? negationFor(item),
    certainty: item.certainty ?? certaintyFor(item),
    verification_status: item.verification_status ?? item.trust_level,
    canonical_source_type: item.canonical_source_type ?? sourceType,
    model_id: modelId,
    model_version: item.model_version ?? null,
    document_page: item.document_page ?? item.provenance.page ?? null,
    roi_id: item.roi_id ?? item.provenance.roi_id ?? null,
    dependency_group_id: dependencyGroupForEvidence(item),
    temporal_state: item.temporal_state ?? temporalStateForEvidence(item, context.referenceTimestamp, context.encounterId),
  };
}

export function enrichEvidenceGraph(items: EvidenceItem[], context: EvidenceGraphContext): EvidenceItem[] {
  return items.map((item) => enrichEvidenceItem(item, context));
}
