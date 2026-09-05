/**
 * Structured Medication Safety Result (Phase 6, §19-21).
 *
 * Ties together medication normalization, allergy safety, interaction
 * checking, and contraindication checking into one structured result per
 * patient/encounter. NEVER produces a treatment instruction - see
 * FORBIDDEN_PHRASES below, scanned against every free-text field this
 * engine produces before it is returned (defense-in-depth, mirrors
 * lib/models/reasoningEngine.ts's forbidden-claims reuse pattern from
 * Phase 4).
 */

import { resolveMedication } from "../treatment/medicationNormalization";
import { evaluateMedicationAllergySafety, type MedicationAllergySafetyResult } from "../treatment/allergySafety";
import { checkInteractions, type InteractionCheckResult } from "../treatment/interactionCheck";
import { checkContraindications, type ContraindicationCheckResult } from "../treatment/contraindicationCheck";
import type { Allergy, SystemicHistory, MedicationEntry } from "../patients/encounter";

export const MEDICATION_SAFETY_ENGINE_VERSION = "1.0.0";
export const MEDICATION_KNOWLEDGE_VERSION = "medication-knowledge-0.0.0-empty-by-design"; // matches lib/treatment/medications.ts's intentionally-empty registry

export type MedicationSafetySeverity = "INFO" | "LOW" | "MODERATE" | "HIGH" | "UNKNOWN";

export interface MedicationSafetyFinding {
  medication_name: string;
  kind: "ALLERGY" | "INTERACTION" | "CONTRAINDICATION";
  severity: MedicationSafetySeverity;
  detail: string;
  requires_clinician_review: true;
}

export interface StructuredMedicationSafetyResult {
  patient_ref: string | null;
  encounter_id: string | null;
  medications_evaluated: string[];
  unknown_medications: string[];
  ambiguous_medications: string[];
  allergy_findings: MedicationAllergySafetyResult[];
  interaction_findings: InteractionCheckResult[];
  contraindication_findings: ContraindicationCheckResult[];
  safety_findings: MedicationSafetyFinding[];
  missing_information: string[];
  provenance: { generated_at: string };
  knowledge_version: string;
  engine_version: string;
  requires_clinician_review: true;
  limitations: string[];
  blocked_claims: string[];
}

// Every phrase here would represent this engine crossing from "safety
// intelligence" into "autonomous treatment" - §21's explicit list, checked
// against every free-text notice this engine assembles.
const FORBIDDEN_MEDICATION_PHRASES: Array<[RegExp, string]> = [
  [/\bstart\s+\w+/i, "treatment-start instruction"],
  [/\bstop taking\b/i, "treatment-stop instruction"],
  [/\bswitch to\b/i, "treatment-switch instruction"],
  [/\bincrease (the )?dose\b/i, "dose-change instruction"],
  [/\bdecrease (the )?dose\b/i, "dose-change instruction"],
  [/\btake \d/i, "dosing instruction"],
  [/\bprescribe/i, "prescribing claim"],
  [/\bis (the best|safe for this patient)\b/i, "unsupported treatment-appropriateness claim"],
  [/\bshould use\b/i, "treatment-selection instruction"],
];

function scanForbidden(texts: string[]): string[] {
  const blocked: string[] = [];
  for (const t of texts) {
    for (const [rx, label] of FORBIDDEN_MEDICATION_PHRASES) {
      if (rx.test(t) && !blocked.includes(label)) blocked.push(label);
    }
  }
  return blocked;
}

function severityFor(kind: MedicationSafetyFinding["kind"], status: string): MedicationSafetySeverity {
  if (status === "KNOWN_ALLERGY_MATCH") return "HIGH";
  if (status === "POSSIBLE_ALLERGY_MATCH" || status === "POSSIBLE_CONCERN") return "MODERATE";
  if (status === "KNOWN_CONCERN") return "MODERATE";
  if (status === "UNKNOWN_ALLERGY_STATUS" || status === "INSUFFICIENT_INFORMATION" || status === "KNOWLEDGE_UNAVAILABLE" || status === "INTERACTION_KNOWLEDGE_UNAVAILABLE") return "UNKNOWN";
  return "INFO";
}

export interface MedicationSafetyEvaluationInput {
  patient_ref: string | null;
  encounter_id: string | null;
  medications: MedicationEntry[];
  allergies: Allergy[];
  systemic_history: SystemicHistory | null;
}

/**
 * The one deterministic composition function (§5's architecture: patient/
 * encounter evidence -> normalization -> knowledge -> allergy safety ->
 * interaction/concern rules -> safety evaluation -> structured result ->
 * clinician review).
 */
export function evaluateMedicationSafety(input: MedicationSafetyEvaluationInput): StructuredMedicationSafetyResult {
  const now = new Date().toISOString();
  const names = input.medications.map((m) => m.name);
  const otherNamesFor = (name: string) => names.filter((n) => n !== name);

  const unknownMedications: string[] = [];
  const ambiguousMedications: string[] = [];
  const allergyFindings: MedicationAllergySafetyResult[] = [];
  const interactionFindings: InteractionCheckResult[] = [];
  const contraindicationFindings: ContraindicationCheckResult[] = [];
  const safetyFindings: MedicationSafetyFinding[] = [];

  for (const med of input.medications) {
    const resolution = resolveMedication(med.name);
    if (resolution.status === "UNKNOWN_MEDICATION") unknownMedications.push(med.name);
    if (resolution.status === "AMBIGUOUS_MEDICATION") ambiguousMedications.push(med.name);

    const allergyResult = evaluateMedicationAllergySafety(med.name, input.allergies);
    allergyFindings.push(allergyResult);
    if (allergyResult.status === "KNOWN_ALLERGY_MATCH" || allergyResult.status === "POSSIBLE_ALLERGY_MATCH") {
      safetyFindings.push({
        medication_name: med.name, kind: "ALLERGY", severity: severityFor("ALLERGY", allergyResult.status),
        detail: allergyResult.notice, requires_clinician_review: true,
      });
    }

    const interactionResult = checkInteractions(med.name, otherNamesFor(med.name));
    interactionFindings.push(interactionResult);
    if (interactionResult.status === "KNOWN_CONCERN") {
      safetyFindings.push({
        medication_name: med.name, kind: "INTERACTION", severity: severityFor("INTERACTION", interactionResult.status),
        detail: interactionResult.notice, requires_clinician_review: true,
      });
    }

    const contraindicationResult = checkContraindications(med.name, input.systemic_history);
    contraindicationFindings.push(contraindicationResult);
    if (contraindicationResult.status === "POSSIBLE_CONCERN") {
      safetyFindings.push({
        medication_name: med.name, kind: "CONTRAINDICATION", severity: severityFor("CONTRAINDICATION", contraindicationResult.status),
        detail: contraindicationResult.notice, requires_clinician_review: true,
      });
    }
  }

  const missingInformation: string[] = [];
  if (input.allergies.length === 0) missingInformation.push("No allergies are recorded for this patient.");
  if (input.systemic_history === null) missingInformation.push("No systemic history is recorded for this patient.");
  if (unknownMedications.length > 0) missingInformation.push(`${unknownMedications.length} medication(s) could not be resolved against the registered medication knowledge base.`);

  const limitations = [
    "This is medication knowledge and safety intelligence only - it does not establish treatment appropriateness, does not issue a prescription, and does not authorize a medication change.",
    "This deployment's medication registry is intentionally empty (no connected drug/formulary source) - most medications will resolve as unknown, which is the correct, safe outcome.",
    "No allergy/interaction/contraindication match found does NOT confirm medication safety for this patient.",
  ];

  const allNotices = [
    ...allergyFindings.map((f) => f.notice), ...interactionFindings.map((f) => f.notice),
    ...contraindicationFindings.map((f) => f.notice), ...safetyFindings.map((f) => f.detail),
    ...limitations,
  ];
  const blockedClaims = scanForbidden(allNotices);

  return {
    patient_ref: input.patient_ref, encounter_id: input.encounter_id,
    medications_evaluated: names, unknown_medications: unknownMedications, ambiguous_medications: ambiguousMedications,
    allergy_findings: allergyFindings, interaction_findings: interactionFindings, contraindication_findings: contraindicationFindings,
    safety_findings: safetyFindings, missing_information: missingInformation,
    provenance: { generated_at: now }, knowledge_version: MEDICATION_KNOWLEDGE_VERSION, engine_version: MEDICATION_SAFETY_ENGINE_VERSION,
    requires_clinician_review: true, limitations, blocked_claims: blockedClaims,
  };
}
