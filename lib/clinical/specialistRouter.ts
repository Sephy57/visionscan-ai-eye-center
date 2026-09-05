/**
 * Deterministic Specialist Router (Phase 3, §8-11).
 *
 * HARD RULE: this module ROUTES. It never diagnoses, never runs inference,
 * and never claims a specialist analyzed anything. Given structured
 * evidence (modality, symptoms, quality), it answers exactly one question
 * per specialty: "would this specialty's capabilities conceptually be
 * relevant here, and if so, is anything actually executable?" The answer to
 * the second half is "no" for every specialty except RETINA today (see
 * lib/clinical/specialistCapabilities.ts).
 *
 * Symptom routing (§9) is additive to modality routing (from Phase 1's
 * routeToSpecialties()) - a symptom pattern can make a specialty relevant
 * even when the study's own modality alone would not have. It NEVER
 * suppresses or downgrades anything: urgent-symptom triage
 * (lib/clinical/triage.ts) is computed completely independently and this
 * router has no ability to read, or influence, its output (§10).
 */

import type { PatientSymptom } from "./symptoms";
import { SYMPTOM_MAP } from "./symptoms";
import type { SpecialtyId } from "./specialistRegistry";
import { SPECIALTY_REGISTRY, SPECIALTY_MAP } from "./specialistRegistry";
import { getCapabilitiesForSpecialty, type SpecialistCapability } from "./specialistCapabilities";
import type { QualityResult } from "../imaging/quality";
import { canonicalModality } from "../models/modalities";

/**
 * Symptom-type -> specialty relevance map (§9's own worked examples).
 * Documentation-grade routing signal only - never a clinical claim. A
 * symptom appearing here means "this symptom pattern makes X specialty's
 * capabilities worth considering", never "this symptom means X condition".
 */
const SYMPTOM_SPECIALTY_HINTS: Record<string, SpecialtyId[]> = {
  sudden_vision_loss: ["RETINA", "COMPREHENSIVE_OPHTHALMOLOGY", "NEURO_OPHTHALMOLOGY"],
  curtain_shadow: ["RETINA"],
  flashes_with_field_loss: ["RETINA"],
  new_floaters: ["RETINA"],
  floaters: ["RETINA"],
  flashes: ["RETINA"],
  eye_pain: ["CORNEA_EXTERNAL_DISEASE"],
  light_sensitivity: ["CORNEA_EXTERNAL_DISEASE", "UVEITIS_INFLAMMATION"],
  redness: ["CORNEA_EXTERNAL_DISEASE", "UVEITIS_INFLAMMATION"],
  foreign_body_sensation: ["CORNEA_EXTERNAL_DISEASE"],
  severe_pain_with_nausea: ["GLAUCOMA", "COMPREHENSIVE_OPHTHALMOLOGY"],
  chemical_exposure: ["CORNEA_EXTERNAL_DISEASE", "COMPREHENSIVE_OPHTHALMOLOGY"],
  double_vision: ["NEURO_OPHTHALMOLOGY"],
  headache_with_visual_symptoms: ["NEURO_OPHTHALMOLOGY"],
  night_vision_difficulty: ["RETINA"],
  reduced_peripheral_vision: ["GLAUCOMA", "NEURO_OPHTHALMOLOGY"],
  recent_eye_trauma: ["COMPREHENSIVE_OPHTHALMOLOGY", "RETINA"],
  trauma_with_vision_loss: ["COMPREHENSIVE_OPHTHALMOLOGY", "RETINA"],
};

export type RoutingRelevanceSource = "MODALITY" | "SYMPTOM" | "MODALITY_AND_SYMPTOM" | "NONE";

export interface SpecialistRoutingDecision {
  specialty_id: SpecialtyId;
  label: string;
  relevant: boolean;
  relevance_source: RoutingRelevanceSource;
  relevance_reasons: string[]; // human-readable, e.g. "modality FUNDUS matches" / "symptom 'curtain_shadow' reported"
  capabilities: SpecialistCapability[];
  any_capability_executable: boolean;
  quality_gate_status: "PASS" | "BLOCKED_QUALITY" | "NOT_EVALUATED";
  status_summary: string; // e.g. "NO_VALIDATED_MODEL_AVAILABLE" or "1 executable capability, subject to quality/OOD/diagnosis gates"
}

export interface RoutingInput {
  modality: string;
  symptoms: PatientSymptom[];
  quality?: QualityResult | null;
}

/**
 * The one and only routing entry point (§8). Deterministic: same input
 * always produces the same output, no randomness, no external calls.
 */
export function routeSpecialists(input: RoutingInput): SpecialistRoutingDecision[] {
  // Canonicalize once so a raw/lowercase/aliased modality string (e.g. a
  // StudyRecord's uncanonicalized `modality` field) still matches the
  // registry's canonical uppercase vocabulary - the same canonicalization
  // every other consumer of lib/models/modalities.ts already relies on.
  const modality = canonicalModality(input.modality);
  const symptomTypes = input.symptoms.map((s) => s.type);

  return SPECIALTY_REGISTRY.map((specialty) => {
    const modalityMatch = specialty.relevant_modalities.includes(modality);
    const symptomMatches = symptomTypes.filter((t) => (SYMPTOM_SPECIALTY_HINTS[t] ?? []).includes(specialty.specialty_id));

    let relevance_source: RoutingRelevanceSource = "NONE";
    if (modalityMatch && symptomMatches.length > 0) relevance_source = "MODALITY_AND_SYMPTOM";
    else if (modalityMatch) relevance_source = "MODALITY";
    else if (symptomMatches.length > 0) relevance_source = "SYMPTOM";

    const relevant = relevance_source !== "NONE";
    const reasons: string[] = [];
    if (modalityMatch) reasons.push(`modality ${modality} is within this specialty's relevant modalities`);
    for (const t of symptomMatches) reasons.push(`reported symptom '${SYMPTOM_MAP[t]?.label ?? t}' is associated with this specialty`);
    if (!relevant) reasons.push("no modality or symptom match found");

    const capabilities = getCapabilitiesForSpecialty(specialty.specialty_id);
    // A capability is only genuinely executable FOR THIS INPUT if its own
    // declared supported_modalities includes the actual (canonicalized)
    // input modality - a symptom-only relevance match (e.g. "curtain_shadow"
    // routing to RETINA for a SLIT_LAMP study) must never make a
    // FUNDUS-only capability look executable for a non-FUNDUS input.
    const anyExecutable = capabilities.some((c) => c.may_execute && c.supported_modalities.includes(modality));

    let quality_gate_status: SpecialistRoutingDecision["quality_gate_status"] = "NOT_EVALUATED";
    if (input.quality) {
      quality_gate_status = input.quality.quality_status === "pass" ? "PASS" : "BLOCKED_QUALITY";
    }

    const statusSummary = !relevant
      ? "NOT_RELEVANT"
      : !anyExecutable
        ? "NO_VALIDATED_MODEL_AVAILABLE"
        : quality_gate_status === "BLOCKED_QUALITY"
          ? "EXECUTABLE_CAPABILITY_EXISTS_BUT_QUALITY_GATE_NOT_PASSED"
          : `${capabilities.filter((c) => c.may_execute && c.supported_modalities.includes(modality)).length} executable capability(ies) - subject to quality/OOD/diagnosis gates, never a diagnosis by itself`;

    return {
      specialty_id: specialty.specialty_id,
      label: specialty.label,
      relevant,
      relevance_source,
      relevance_reasons: reasons,
      capabilities,
      any_capability_executable: anyExecutable,
      quality_gate_status,
      status_summary: statusSummary,
    };
  });
}

/** Convenience: only the specialties this routing call found relevant, sorted by whether they have anything executable (informational ordering only). */
export function relevantSpecialists(input: RoutingInput): SpecialistRoutingDecision[] {
  return routeSpecialists(input).filter((d) => d.relevant);
}
