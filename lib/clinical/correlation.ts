/**
 * Symptom <-> imaging correlation engine (transparent, rules-based).
 *
 * Separates four distinct concepts:
 *   SYMPTOM             - what the patient reports
 *   IMAGING FINDING     - what the model actually detected
 *   POSSIBLE ASSOCIATION - controlled knowledge-base wording
 *   DIAGNOSIS           - never produced here
 *
 * HARD RULES:
 *  - Symptoms NEVER create findings.
 *  - Symptoms NEVER produce diagnoses.
 *  - Correlation is wording about plausible relevance, never causation.
 *  - Disagreement is displayed, never hidden, never force-resolved.
 *
 * Correlation is marked RESEARCH CORRELATION until clinically validated.
 */

import { PatientSymptom, SYMPTOM_MAP, SymptomTypeDef } from "./symptoms";
import { Finding } from "../analysis/schema";
import { QUALITY_ACCEPTABLE } from "./correlationConstants";

export type CorrelationState =
  | "correlated"       // symptoms and imaging may be clinically related
  | "not_explained"    // imaging does not explain reported symptoms
  | "inconclusive"     // insufficient evidence
  | "conflicting"      // symptoms and imaging suggest different possibilities
  | "urgent";          // configured safety escalation criteria met

export interface SymptomCorrelationItem {
  symptom_type: string;
  symptom_label: string;
  state: CorrelationState;
  matched_finding_types: string[];
  note: string;
}

export interface SymptomCorrelation {
  state: CorrelationState;                 // worst-case overall state
  urgency: "emergency" | "urgent" | "prompt" | "routine";
  items: SymptomCorrelationItem[];
  notes: string[];
  model_input: "IMAGE_ONLY" | "IMAGE_AND_SYMPTOMS";
  label: string;                           // mandatory display label
}

const STATE_RANK: Record<CorrelationState, number> = {
  inconclusive: 0, correlated: 1, not_explained: 2, conflicting: 3, urgent: 4,
};

const URGENT_REVIEW_TEXT = "Urgent ophthalmic assessment is recommended.";

export function correlateSymptoms(params: {
  symptoms: PatientSymptom[];
  findings: Finding[];
  qualityAcceptable: boolean;
  modelStatus: string;
  modelUsesSymptoms: boolean;
  qualityScore: number;
}): SymptomCorrelation {
  const notes: string[] = [];
  const items: SymptomCorrelationItem[] = [];

  // Model input honesty: the installed model is image-only; symptoms are
  // correlated AFTER the model output, never inside it.
  const model_input = params.modelUsesSymptoms ? "IMAGE_AND_SYMPTOMS" : "IMAGE_ONLY";
  if (!params.modelUsesSymptoms) {
    notes.push(
      "MODEL INPUT: IMAGE ONLY. The current model does not use symptom information; symptoms were correlated " +
      "separately after the model output."
    );
  }

  let worst: CorrelationState = params.symptoms.length === 0 ? "inconclusive" : "inconclusive";
  let urgency: SymptomCorrelation["urgency"] = "routine";

  for (const s of params.symptoms) {
    const def: SymptomTypeDef | undefined = SYMPTOM_MAP[s.type];
    if (!def) continue;

    // Red-flag symptoms escalate immediately - the system does not wait for a
    // model diagnosis before surfacing a safety escalation.
    if (def.red_flag) {
      const u = def.urgency === "emergency" ? "emergency" : "urgent";
      if (u === "emergency") urgency = "emergency";
      else if (urgency !== "emergency") urgency = "urgent";
      items.push({
        symptom_type: s.type,
        symptom_label: def.label,
        state: "urgent",
        matched_finding_types: [],
        note:
          `This symptom meets the configured safety escalation criteria. ${URGENT_REVIEW_TEXT} ` +
          `No specific condition is implied by this escalation.`,
      });
      worst = "urgent";
      continue;
    }

    // Non-red-flag symptoms: correlate against ACTUAL detected findings only.
    const detectedTypes = new Set(params.findings.map((f) => f.type));
    const matched = def.related_finding_types.filter((t) => detectedTypes.has(t));

    if (!params.qualityAcceptable) {
      items.push({
        symptom_type: s.type, symptom_label: def.label, state: "inconclusive", matched_finding_types: [],
        note: "Image quality was insufficient for reliable automated analysis; symptom correlation is inconclusive.",
      });
      continue;
    }

    if (matched.length > 0) {
      items.push({
        symptom_type: s.type, symptom_label: def.label, state: "correlated", matched_finding_types: matched,
        note:
          "The imaging finding may be relevant to the reported visual symptom. Automated imaging analysis cannot " +
          "establish whether the finding is responsible for the symptom.",
      });
      if (STATE_RANK[worst] < STATE_RANK.correlated) worst = "correlated";
      if (urgency === "routine") urgency = "prompt";
      continue;
    }

    if (params.findings.length > 0) {
      items.push({
        symptom_type: s.type, symptom_label: def.label, state: "not_explained", matched_finding_types: [],
        note:
          "Symptom is not explained by the current automated imaging result: findings were detected, but none of " +
          "them is a validated match for this symptom. Clinical evaluation may still be warranted.",
      });
      if (STATE_RANK[worst] < STATE_RANK.not_explained) worst = "not_explained";
      if (urgency === "routine") urgency = "prompt";
      continue;
    }

    // No findings at all - honest wording; normality is NOT claimed.
    if (params.modelStatus === "DEMO" || params.modelStatus === "RESEARCH") {
      items.push({
        symptom_type: s.type, symptom_label: def.label, state: "inconclusive", matched_finding_types: [],
        note:
          "Patient reports this symptom, but the current automated analysis is unvalidated (demo/synthetic " +
          "detector) and cannot confirm or exclude a cause. Clinical evaluation may still be warranted.",
      });
      if (STATE_RANK[worst] < STATE_RANK.inconclusive) worst = "inconclusive";
      if (urgency === "routine") urgency = "prompt";
    } else {
      items.push({
        symptom_type: s.type, symptom_label: def.label, state: "not_explained", matched_finding_types: [],
        note:
          `Patient reports ${def.label.toLowerCase()}, but the current imaging does not demonstrate a validated ` +
          "finding explaining this symptom. Clinical evaluation may still be warranted.",
      });
      if (STATE_RANK[worst] < STATE_RANK.not_explained) worst = "not_explained";
      if (urgency === "routine") urgency = "prompt";
    }
  }

  // Overall urgency from symptoms themselves.
  notes.push("CORRELATION STATUS: RESEARCH CORRELATION - not clinically validated.");

  return { state: worst, urgency, items, notes, model_input, label: "RESEARCH CORRELATION - NOT CLINICALLY VALIDATED" };
}

export { URGENT_REVIEW_TEXT, QUALITY_ACCEPTABLE };
