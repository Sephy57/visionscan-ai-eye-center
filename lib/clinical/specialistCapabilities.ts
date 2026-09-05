/**
 * Specialist Capability Registry (Phase 3 - Multi-Specialist Orchestration, §3-4).
 *
 * Extends lib/clinical/specialistRegistry.ts's specialty-level registry with
 * per-CAPABILITY metadata (a capability = one specific task within a
 * specialty, e.g. "diabetic retinopathy screening" within RETINA).
 *
 * HARD RULES:
 *  - Reuses `ModelStatus` from lib/models/registry.ts (DEMO|RESEARCH|
 *    INTERNAL_VALIDATION|EXTERNALLY_VALIDATED|CLINICALLY_VALIDATED|RETIRED)
 *    rather than inventing a parallel lifecycle vocabulary - one lifecycle
 *    system, not two competing ones.
 *  - A capability whose model is not registered in lib/models/registry.ts's
 *    MODELS (the SegFormer research model, deliberately isolated since S9)
 *    is represented honestly with `registered_in_model_registry: false` and
 *    `production_approved: false` - it is NEVER treated as equivalent to a
 *    registered, gate-checked model.
 *  - `may_execute` is computed, never hand-set to true: it requires BOTH a
 *    real model_id AND model_status in {RESEARCH, INTERNAL_VALIDATION,
 *    EXTERNALLY_VALIDATED, CLINICALLY_VALIDATED} (never DEMO/RETIRED/absent).
 *    Even when true, execution still goes through quality/OOD/diagnosis
 *    gates unchanged - this flag only means "there is something to try",
 *    never "this is safe to trust".
 */

import type { ModelStatus } from "../models/registry";
import type { SpecialtyId } from "./specialistRegistry";
import { SPECIALTY_MAP } from "./specialistRegistry";

export type CalibrationStatus = "NOT_CALIBRATED" | "CALIBRATION_RECORDED" | "UNKNOWN";
export type OodSupport = "SUPPORTED" | "NOT_SUPPORTED";
export type DeviceScopeStatus = "DEVICE_SUPPORTED" | "DEVICE_UNKNOWN" | "DEVICE_UNSUPPORTED";
export type ResearchOrProduction = "RESEARCH" | "PRODUCTION";

export interface SpecialistCapability {
  specialty_id: SpecialtyId;
  capability_id: string;
  label: string;
  supported_modalities: string[];
  intended_use: string;
  population_scope: string; // e.g. "adult" - free text, documentation only, never inferred
  device_scope: string[]; // known-compatible device identifiers, if any are documented; empty = none documented
  model_id: string | null; // null = no model exists for this capability at all
  model_version: string | null;
  model_status: ModelStatus | null;
  registered_in_model_registry: boolean; // true only if getModel(model_id) would find it in lib/models/registry.ts
  calibration_status: CalibrationStatus;
  ood_support: OodSupport;
  required_quality_level: "pass" | "pass_or_borderline";
  research_or_production: ResearchOrProduction;
  license: string | null;
  source: string | null;
  known_limitations: string[];
  /** Computed, never hand-authored true for a capability with no real model. */
  may_execute: boolean;
}

const EXECUTABLE_STATUSES: ModelStatus[] = ["RESEARCH", "INTERNAL_VALIDATION", "EXTERNALLY_VALIDATED", "CLINICALLY_VALIDATED"];

function computeMayExecute(model_id: string | null, model_status: ModelStatus | null): boolean {
  return model_id !== null && model_status !== null && EXECUTABLE_STATUSES.includes(model_status);
}

/**
 * The capability registry. Every specialty from SPECIALTY_MAP gets at least
 * one capability entry so §3's "extend the specialist registry with
 * capability metadata" is genuinely satisfied for all 9 specialties - not
 * just the one with a real model. Only RETINA/GLAUCOMA's optic-disc/cup
 * capability has a real model_id (the SegFormer research model, isolated,
 * never registered in the production model registry).
 */
export const SPECIALIST_CAPABILITIES: SpecialistCapability[] = [
  {
    specialty_id: "RETINA",
    capability_id: "optic_disc_cup_segmentation",
    label: "Optic disc / cup area segmentation (research)",
    supported_modalities: ["FUNDUS"],
    intended_use: "Research-only segmentation of optic disc and cup regions for architecture/pipeline exercise - not diabetic retinopathy screening or any specific disease classification.",
    population_scope: "unknown - no documented population validation",
    device_scope: [],
    model_id: "segformer-optic-disc-cup-refuge",
    model_version: "1",
    model_status: "RESEARCH",
    registered_in_model_registry: false,
    calibration_status: "NOT_CALIBRATED",
    ood_support: "SUPPORTED", // wired via lib/analysis/imageSuitability.ts in S13
    required_quality_level: "pass",
    research_or_production: "RESEARCH",
    license: "Apache-2.0",
    source: "REFUGE challenge derivative (see docs/S8_MODEL_DISCOVERY.md, docs/S9_REAL_MODEL_INTEGRATION.md)",
    known_limitations: [
      "Zero published external clinical validation.",
      "Not attached to any specific disease diagnosis - segmentation only.",
      "Never registered in the production model registry by design (clinical isolation).",
    ],
    may_execute: computeMayExecute("segformer-optic-disc-cup-refuge", "RESEARCH"),
  },
  {
    specialty_id: "RETINA",
    capability_id: "diabetic_retinopathy_screening",
    label: "Diabetic retinopathy screening",
    supported_modalities: ["FUNDUS"],
    intended_use: "Diabetic retinopathy grading/screening.",
    population_scope: "unknown", device_scope: [],
    model_id: null, model_version: null, model_status: null, registered_in_model_registry: false,
    calibration_status: "UNKNOWN", ood_support: "NOT_SUPPORTED", required_quality_level: "pass",
    research_or_production: "RESEARCH", license: null, source: null,
    known_limitations: ["No model of any kind is integrated for this capability."],
    may_execute: false,
  },
  {
    specialty_id: "GLAUCOMA",
    capability_id: "cup_disc_ratio_assessment",
    label: "Cup-to-disc ratio assessment",
    supported_modalities: ["FUNDUS"],
    intended_use: "Glaucoma-relevant optic-nerve morphology assessment.",
    population_scope: "unknown", device_scope: [],
    model_id: null, model_version: null, model_status: null, registered_in_model_registry: false,
    calibration_status: "UNKNOWN", ood_support: "NOT_SUPPORTED", required_quality_level: "pass",
    research_or_production: "RESEARCH", license: null, source: null,
    known_limitations: ["No validated glaucoma-specific model is integrated. The optic-disc/cup segmentation capability under RETINA produces raw segmented areas only, with no calibrated cup-to-disc ratio or glaucoma risk output."],
    may_execute: false,
  },
  ...(["COMPREHENSIVE_OPHTHALMOLOGY", "CORNEA_EXTERNAL_DISEASE", "CATARACT_LENS", "NEURO_OPHTHALMOLOGY", "PEDIATRIC_OPHTHALMOLOGY", "UVEITIS_INFLAMMATION", "OCULAR_ONCOLOGY"] as SpecialtyId[]).map((specialty_id): SpecialistCapability => ({
    specialty_id,
    capability_id: `${specialty_id.toLowerCase()}_general`,
    label: `${SPECIALTY_MAP[specialty_id].label} — general assessment`,
    supported_modalities: SPECIALTY_MAP[specialty_id].relevant_modalities,
    intended_use: "No specific capability has been scoped or integrated for this specialty.",
    population_scope: "unknown", device_scope: [],
    model_id: null, model_version: null, model_status: null, registered_in_model_registry: false,
    calibration_status: "UNKNOWN", ood_support: "NOT_SUPPORTED", required_quality_level: "pass",
    research_or_production: "RESEARCH", license: null, source: null,
    known_limitations: ["No model of any kind is integrated for this specialty."],
    may_execute: false,
  })),
];

export function getCapabilitiesForSpecialty(specialty_id: SpecialtyId): SpecialistCapability[] {
  return SPECIALIST_CAPABILITIES.filter((c) => c.specialty_id === specialty_id);
}

export function getCapability(specialty_id: SpecialtyId, capability_id: string): SpecialistCapability | null {
  return SPECIALIST_CAPABILITIES.find((c) => c.specialty_id === specialty_id && c.capability_id === capability_id) ?? null;
}

/** True for exactly one capability in this deployment - see file header. Used by tests/red-team to assert the boundary stays narrow. */
export function executableCapabilities(): SpecialistCapability[] {
  return SPECIALIST_CAPABILITIES.filter((c) => c.may_execute);
}
