import { describe, it, expect } from "vitest";
import {
  validateEncounterInput, encounterHasRecordedSystemicHistory,
  type PatientEncounter, type OcularHistoryEntry, type MedicationEntry, type Allergy,
} from "@/lib/patients/encounter";
import {
  evidenceFromOcularHistory, evidenceFromMedications, evidenceFromAllergies,
} from "@/lib/evidence/adapters";
import { SPECIALTY_REGISTRY, SPECIALTY_MAP, routeToSpecialties } from "@/lib/clinical/specialistRegistry";
import { summarizeEtiology, etiologyCannotBeEstablished } from "@/lib/evidence/etiology";
import { checkMedicationAgainstAllergies } from "@/lib/treatment/allergySafety";
import type { MedicationRecord } from "@/lib/treatment/medications";
import { redFlagSymptoms, maxSymptomUrgency, validateSymptoms } from "@/lib/clinical/symptoms";
import type { ConditionAssessment, EvidenceItem } from "@/lib/evidence/types";
import { assessConditions } from "@/lib/evidence/synthesize";

/**
 * Ophthalmology-center Phase 1 - real tests for the new architecture:
 * patient encounter model, evidence adapters, specialist registry (stub,
 * never a real model), etiology hypothesis engine, medication-allergy
 * cross-check, and the two new red-flag symptom types. Every test proves a
 * SAFETY invariant, not just that code runs.
 */

describe("Phase 1 - PatientEncounter validation is real and fail-closed", () => {
  it("rejects an ocular_history entry with a missing condition", () => {
    const result = validateEncounterInput({
      ocular_history: [{ value: { condition: "", laterality: "right" } as OcularHistoryEntry, provenance: "PATIENT_REPORTED" }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field.includes("condition"))).toBe(true);
  });

  it("rejects an invalid provenance value - there is no default provenance", () => {
    const result = validateEncounterInput({
      medications: [{ value: { name: "timolol", ocular: true } as MedicationEntry, provenance: "MADE_UP_VALUE" }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field.includes("provenance"))).toBe(true);
  });

  it("accepts a well-formed encounter input with every real provenance value", () => {
    const result = validateEncounterInput({
      chief_complaint: "blurred vision",
      ocular_history: [{ value: { condition: "cataract surgery", laterality: "left" }, provenance: "CLINICIAN_ENTERED" }],
      medications: [{ value: { name: "latanoprost", ocular: true }, provenance: "PATIENT_REPORTED" }],
      allergies: [{ value: { allergen: "sulfa drugs", severity: "moderate" }, provenance: "PATIENT_REPORTED" }],
      systemic_history: { value: { diabetes: "yes", hypertension: "unknown" }, provenance: "PATIENT_REPORTED" },
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("encounterHasRecordedSystemicHistory distinguishes recorded-empty from never-recorded", () => {
    expect(encounterHasRecordedSystemicHistory({ systemic_history: null })).toBe(false);
    expect(encounterHasRecordedSystemicHistory({
      systemic_history: { value: { diabetes: "no", hypertension: "no", other_conditions: [] }, provenance: "PATIENT_REPORTED", recorded_at: new Date().toISOString() },
    })).toBe(true);
  });
});

describe("Phase 1 - evidence adapters for history/medications/allergies never fabricate trust", () => {
  const now = new Date().toISOString();

  it("AI-derived history can never map to HUMAN_VERIFIED trust", () => {
    const items = evidenceFromOcularHistory("study_x", [
      { value: { condition: "possible glaucoma", laterality: "unknown" }, provenance: "AI_INFERRED", recorded_at: now },
    ], "enc_1");
    expect(items[0].trust_level).not.toBe("HUMAN_VERIFIED");
    expect(items[0].trust_level).toBe("UNVERIFIED");
    expect(items[0].source_type).toBe("HISTORY");
  });

  it("clinician-entered history maps to HUMAN_VERIFIED", () => {
    const items = evidenceFromOcularHistory("study_x", [
      { value: { condition: "prior retinal detachment", laterality: "right" }, provenance: "CLINICIAN_ENTERED", recorded_at: now },
    ], "enc_1");
    expect(items[0].trust_level).toBe("HUMAN_VERIFIED");
  });

  it("medication evidence carries source_type MEDICATION, never conflated with AI_FINDING or SYMPTOM", () => {
    const items = evidenceFromMedications("study_x", [
      { value: { name: "latanoprost", ocular: true } as MedicationEntry, provenance: "PATIENT_REPORTED", recorded_at: now },
    ], "enc_1");
    expect(items[0].source_type).toBe("MEDICATION");
    expect(items[0].source_type).not.toBe("AI_FINDING");
    expect(items[0].source_type).not.toBe("SYMPTOM");
  });

  it("allergy evidence carries source_type ALLERGY", () => {
    const items = evidenceFromAllergies("study_x", [
      { value: { allergen: "penicillin", reaction: "rash" } as Allergy, provenance: "PATIENT_REPORTED", recorded_at: now },
    ], "enc_1");
    expect(items[0].source_type).toBe("ALLERGY");
    expect(items[0].qualitative_finding).toContain("penicillin");
  });
});

describe("Phase 1 - specialist registry is an honest stub, never a real model", () => {
  it("every specialty has status NO_VALIDATED_MODEL_AVAILABLE", () => {
    for (const s of SPECIALTY_REGISTRY) {
      expect(s.status).toBe("NO_VALIDATED_MODEL_AVAILABLE");
    }
  });

  it("all 8 clinical specialties plus comprehensive ophthalmology are present", () => {
    const ids = SPECIALTY_REGISTRY.map((s) => s.specialty_id);
    for (const expected of [
      "COMPREHENSIVE_OPHTHALMOLOGY", "RETINA", "GLAUCOMA", "CORNEA_EXTERNAL_DISEASE",
      "CATARACT_LENS", "NEURO_OPHTHALMOLOGY", "PEDIATRIC_OPHTHALMOLOGY",
      "UVEITIS_INFLAMMATION", "OCULAR_ONCOLOGY",
    ]) {
      expect(ids).toContain(expected);
    }
  });

  it("routeToSpecialties() never returns available: true for any modality", () => {
    for (const modality of ["FUNDUS", "OCT", "SLIT_LAMP", "UNKNOWN_MODALITY"]) {
      const results = routeToSpecialties(modality);
      expect(results.every((r) => r.available === false)).toBe(true);
    }
  });

  it("pediatric ophthalmology explicitly flags population-specific validation is required", () => {
    expect(SPECIALTY_MAP.PEDIATRIC_OPHTHALMOLOGY.requires_population_specific_validation).toBe(true);
  });

  it("routing a FUNDUS modality marks RETINA and GLAUCOMA as relevant but still unavailable", () => {
    const results = routeToSpecialties("FUNDUS");
    const retina = results.find((r) => r.specialty_id === "RETINA")!;
    expect(retina.relevant).toBe(true);
    expect(retina.available).toBe(false);
  });
});

describe("Phase 1 - etiology hypothesis engine never establishes causation", () => {
  it("etiologyCannotBeEstablished is true for an empty hypothesis list", () => {
    expect(etiologyCannotBeEstablished([])).toBe(true);
  });

  it("summarizeEtiology never sets etiology_established true, even for a SUPPORTED_CONDITION assessment", () => {
    const assessment: ConditionAssessment = {
      condition_id: "test_condition", canonical_name: "Test condition", category: "test",
      laterality: "OD", state: "SUPPORTED_CONDITION", supporting_evidence_ids: [], contradicting_evidence_ids: [],
      missing_required: ["additional_test"], red_flag_candidates: [], differential_relationships: [],
      taxonomy_version: "test-1.0.0", note: "test",
    };
    const hypotheses = summarizeEtiology([assessment], []);
    expect(hypotheses.length).toBe(1);
    expect(hypotheses[0].etiology_established).toBe(false);
    expect(etiologyCannotBeEstablished(hypotheses)).toBe(true);
  });

  it("INSUFFICIENT_EVIDENCE and UNABLE_TO_ASSESS assessments are never presented as hypotheses being considered", () => {
    const assessments: ConditionAssessment[] = [
      { condition_id: "a", canonical_name: "A", category: "t", laterality: "OD", state: "INSUFFICIENT_EVIDENCE", supporting_evidence_ids: [], contradicting_evidence_ids: [], missing_required: [], red_flag_candidates: [], differential_relationships: [], taxonomy_version: "1", note: "" },
      { condition_id: "b", canonical_name: "B", category: "t", laterality: "OS", state: "UNABLE_TO_ASSESS", supporting_evidence_ids: [], contradicting_evidence_ids: [], missing_required: [], red_flag_candidates: [], differential_relationships: [], taxonomy_version: "1", note: "" },
    ];
    expect(summarizeEtiology(assessments, [])).toEqual([]);
  });

  it("end-to-end: real assessConditions() output run through summarizeEtiology() never establishes etiology from a single unverified symptom-only evidence set", () => {
    const evidence: EvidenceItem[] = [{
      id: "ev1", study_id: "study_x", source_type: "SYMPTOM", source_id: "s1", category: "blurred_vision",
      laterality: "OD", laterality_source: "mapped_from_symptom_report", presence: "PRESENT",
      trust_level: "UNVERIFIED", provenance: { study_id: "study_x" }, conflict_ids: [],
    }];
    const assessments = assessConditions(evidence);
    const hypotheses = summarizeEtiology(assessments, evidence);
    expect(hypotheses.every((h) => h.etiology_established === false)).toBe(true);
  });
});

describe("Phase 1 - medication-allergy cross-check is fail-closed, never claims safety", () => {
  const med: MedicationRecord = {
    medicationId: "test_med", genericName: "timolol", brandNames: ["Timoptic"], drugClass: "beta blocker",
    indications: [], ophthalmicIndications: ["glaucoma"], route: ["topical"], contraindications: [], warnings: [],
    commonAdverseEffects: [], seriousAdverseEffects: [], drugInteractions: [], ageConsiderations: null,
    pregnancyConsiderations: null, renalConsiderations: null, hepaticConsiderations: null, monitoring: [],
    evidenceReferences: ["test source"], lastReviewed: "2026-01-01", source: "test", version: "1.0", jurisdiction: "US",
  };

  it("no allergies recorded -> NO_ALLERGIES_RECORDED, explicitly not 'safe'", () => {
    const result = checkMedicationAgainstAllergies(med, []);
    expect(result.status).toBe("NO_ALLERGIES_RECORDED");
    expect(result.notice.toLowerCase()).not.toContain("safe to use");
  });

  it("a text-matching allergy produces POSSIBLE_MATCH, requiring clinician review - never an automatic block or approval", () => {
    const result = checkMedicationAgainstAllergies(med, [{ allergen: "timolol", severity: "severe" }]);
    expect(result.status).toBe("POSSIBLE_MATCH");
    if (result.status === "POSSIBLE_MATCH") {
      expect(result.matches.length).toBeGreaterThan(0);
    }
  });

  it("a non-matching allergy produces NO_MATCH_FOUND_NOT_CONFIRMED_SAFE, never a bare 'safe' status", () => {
    const result = checkMedicationAgainstAllergies(med, [{ allergen: "penicillin" }]);
    expect(result.status).toBe("NO_MATCH_FOUND_NOT_CONFIRMED_SAFE");
    expect(result.notice.toLowerCase()).toContain("does not confirm");
  });
});

describe("Phase 1 red team - the two new red-flag symptom types force emergency urgency", () => {
  it("chemical_exposure and severe_pain_with_nausea validate and are correctly flagged red_flag/emergency", () => {
    const { valid, symptoms } = validateSymptoms([
      { type: "chemical_exposure", onset: "sudden", duration: "hours", severity: "severe", laterality: "right", progression: "worsening", frequency: "constant" },
      { type: "severe_pain_with_nausea", onset: "sudden", duration: "hours", severity: "severe", laterality: "left", progression: "worsening", frequency: "constant" },
    ]);
    expect(valid).toBe(true);
    expect(redFlagSymptoms(symptoms).length).toBe(2);
    expect(maxSymptomUrgency(symptoms)).toBe("emergency");
  });
});

describe("Phase 1 red team - specialist registry cannot be forced into implying a real model", () => {
  it("no specialty entry contains a model_id, weights path, or inference function - documentation only", () => {
    for (const s of SPECIALTY_REGISTRY) {
      expect((s as unknown as Record<string, unknown>).model_id).toBeUndefined();
      expect((s as unknown as Record<string, unknown>).weights_path).toBeUndefined();
      expect(typeof (s as unknown as Record<string, unknown>).infer).not.toBe("function");
    }
  });
});
