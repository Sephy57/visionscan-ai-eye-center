/**
 * StructuredClinicalEvidence (Phase 4, §4-9).
 *
 * HARD RULE: this is an AGGREGATOR, not a new evidence source. It combines
 * references to evidence already computed by existing, unmodified systems -
 * lib/evidence/synthesize.ts's buildEvidenceWorkspace() (symptoms, test
 * results, source-document claims, encounter context, AI findings, conflicts,
 * condition assessments), Phase 1's encounter evidence adapters, and
 * Phase 3's orchestrateSpecialistAnalysis() (specialist evidence bundles).
 * It NEVER invents a new evidence item and NEVER duplicates the underlying
 * EvidenceItem records - every reference is by id back into the one real
 * evidence array.
 */

import { dbGet } from "../storage/db";
import type { StudyRecord } from "../studies/service";
import { buildEvidenceWorkspace } from "./synthesize";
import { detectConflicts, attachConflictIds } from "./conflicts";
import { assessConditions } from "./synthesize";
import { evidenceFromOcularHistory, evidenceFromMedications, evidenceFromAllergies } from "./adapters";
import type { PatientEncounter } from "../patients/encounter";
import type { EvidenceItem, EvidenceConflict, ConditionAssessment } from "./types";
import { orchestrateSpecialistAnalysis } from "../clinical/specialistOrchestrator";
import type { SpecialistAnalysisResult } from "../models/specialistOutputTypes";
import { canonicalModality } from "../models/modalities";
import { buildSpecialistConsensus, type SpecialistConsensus } from "../clinical/specialistConsensus";
import type { PatientSymptom } from "../clinical/symptoms";
import { buildSpecialistEvidencePackages, type SpecialistEvidencePackage } from "../clinical/specialistPackages";
import { enrichEvidenceGraph } from "./canonical";
import { fuseRetinalEvidence, type RetinalEvidenceFusionResult } from "./retinalEvidenceFusion";

export interface SpecialistEvidenceBundle {
  specialty_id: SpecialistAnalysisResult["specialty_id"];
  capability_id: string | null;
  finding_evidence_ids: string[];
  quality_status: SpecialistAnalysisResult["quality_status"];
  ood_status: SpecialistAnalysisResult["ood_status"];
  validation_status: SpecialistAnalysisResult["validation_status"];
  limitations: string[];
  failure_state: SpecialistAnalysisResult["failure_state"];
}

export interface StructuredClinicalEvidence {
  study_id: string;
  encounter_id: string | null;
  generated_at: string;
  evidence: EvidenceItem[]; // the ONE real evidence array - every id referenced elsewhere in this object points back here
  conflicts: EvidenceConflict[];
  possible_conditions: ConditionAssessment[];
  specialist_bundles: SpecialistEvidenceBundle[];
  /** Deterministic clinician hand-off views over the same evidence array. */
  specialist_packages?: SpecialistEvidencePackage[];
  /** Present on newly-built packages; optional for compatibility with older
   * persisted/test fixtures created before the consensus layer existed. */
  specialist_consensus?: SpecialistConsensus;
  /** Deterministic Phase 8 review routing over the same evidence array. */
  retinal_evidence_fusion?: RetinalEvidenceFusionResult;
  safety_banner: string;
}

export interface StructuredEvidenceOptions {
  encounter?: PatientEncounter | null;
  /** Skip specialist orchestration (e.g. for a pure history/symptom-only synthesis, or to avoid a real inference call in a fast test). */
  includeSpecialists?: boolean;
  /** Opt into the exact nine Phase 2 specialty lanes; legacy callers retain four packages by default. */
  allSpecialties?: boolean;
}

const SAFETY_BANNER =
  "STRUCTURED CLINICAL EVIDENCE — NOT A DIAGNOSIS. NOT CLINICALLY VALIDATED. " +
  "Aggregates references to existing evidence only; introduces no new medical claims.";

/**
 * Document-extracted symptoms are allowed to inform specialist *relevance*
 * only. They remain AUTO_EXTRACTED/UNREVIEWED EvidenceItems and are never
 * promoted into the study's patient-reported symptom list or into a clinical
 * condition claim. The router needs only the controlled type today; the
 * remaining fields are deliberately unknown rather than guessed.
 */
function routingSymptomsFromEvidence(evidence: EvidenceItem[]): PatientSymptom[] {
  return evidence
    .filter((item) =>
      item.source_type === "SYMPTOM" &&
      item.presence === "PRESENT" &&
      item.uncertainty?.includes("document_extracted") &&
      item.trust_level !== "REJECTED"
    )
    .map((item) => ({
      type: item.category,
      onset: "unknown" as const,
      duration: "unknown" as const,
      severity: "moderate" as const,
      laterality: item.laterality === "OD" ? "right" as const : item.laterality === "OS" ? "left" as const : item.laterality === "OU" ? "both" as const : "unknown" as const,
      progression: "unknown" as const,
      frequency: "unknown" as const,
      free_text: null,
    }));
}

export async function buildStructuredClinicalEvidence(
  studyId: string,
  options: StructuredEvidenceOptions = {},
): Promise<StructuredClinicalEvidence | { study_id: string; not_found: true }> {
  const study = await dbGet<StudyRecord>("studies", studyId);
  if (!study) return { study_id: studyId, not_found: true };

  const workspace = await buildEvidenceWorkspace(studyId);
  if ("not_found" in workspace) return { study_id: studyId, not_found: true };

  let evidence: EvidenceItem[] = [...workspace.evidence];
  const encounter = options.encounter ?? null;

  if (encounter) {
    evidence = [
      ...evidence,
      ...evidenceFromOcularHistory(studyId, encounter.ocular_history, encounter.encounter_id),
      ...evidenceFromOcularHistory(studyId, encounter.ocular_surgery_history, encounter.encounter_id),
      ...evidenceFromMedications(studyId, encounter.medications, encounter.encounter_id),
      ...evidenceFromAllergies(studyId, encounter.allergies, encounter.encounter_id),
    ].filter((e) => e.study_id === studyId); // defense-in-depth, mirrors buildEvidenceWorkspace's own cross-study guard
  }

  // Re-run conflict detection / condition assessment on the MERGED set -
  // reusing the exact same, unmodified functions the base workspace used,
  // never a parallel implementation.
  evidence = enrichEvidenceGraph(evidence, {
    studyId,
    patientId: study.patient_ref ?? null,
    encounterId: encounter?.encounter_id ?? null,
    modality: study.modality,
    referenceTimestamp: study.metadata.scanDateTime ?? study.created_at,
  });
  const conflicts = detectConflicts(evidence);
  attachConflictIds(evidence, conflicts);
  const possibleConditions = assessConditions(evidence);
  const retinalEvidenceFusion = fuseRetinalEvidence(evidence, conflicts);
  const analysisRecord = await dbGet<{ result?: import("../analysis/schema").AnalysisResult }>("analyses", `anl_${studyId}`);
  const specialistPackages = buildSpecialistEvidencePackages({
    analysis: analysisRecord?.result ?? null,
    evidence,
    possible_conditions: possibleConditions,
    allSpecialties: options.allSpecialties === true,
  });

  const specialistBundles: SpecialistEvidenceBundle[] = [];
  let specialistConsensus: SpecialistConsensus;
  if (options.includeSpecialists !== false) {
    const canonical = canonicalModality(study.modality);
    // Structured symptoms are the authoritative patient-context input; a
    // document candidate may add routing relevance but is explicitly kept
    // separate and unreviewed. De-duplicate by type/laterality so repeated
    // extraction across documents cannot inflate the routing signal.
    const routingSymptoms = [...(study.symptoms ?? []), ...routingSymptomsFromEvidence(evidence)];
    const seen = new Set<string>();
    const dedupedRoutingSymptoms = routingSymptoms.filter((symptom) => {
      const key = `${symptom.type}:${symptom.laterality}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const results = await orchestrateSpecialistAnalysis(studyId, canonical, dedupedRoutingSymptoms);
    specialistConsensus = buildSpecialistConsensus(results);
    for (const r of results) {
      if (r.findings.length === 0 && r.failure_state === "NO_VALIDATED_MODEL_AVAILABLE") continue; // don't pad the bundle list with 8 identical "nothing here" entries
      specialistBundles.push({
        specialty_id: r.specialty_id,
        capability_id: r.capability_id,
        finding_evidence_ids: r.input_evidence_ids,
        quality_status: r.quality_status,
        ood_status: r.ood_status,
        validation_status: r.validation_status,
        limitations: r.limitations,
        failure_state: r.failure_state,
      });
    }
  } else {
    specialistConsensus = buildSpecialistConsensus([]);
  }

  return {
    study_id: studyId,
    encounter_id: encounter?.encounter_id ?? null,
    generated_at: new Date().toISOString(),
    evidence,
    conflicts,
    possible_conditions: possibleConditions,
    specialist_bundles: specialistBundles,
    specialist_packages: specialistPackages,
    specialist_consensus: specialistConsensus,
    retinal_evidence_fusion: retinalEvidenceFusion,
    safety_banner: SAFETY_BANNER,
  };
}
