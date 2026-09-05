import { Finding } from "../analysis/schema";

/**
 * Clinical Triage Engine - deterministic, conservative rules.
 *
 * Outputs (most to least urgent):
 *   emergency_evaluation | urgent_eye_care_review |
 *   prompt_professional_review | specialist_review_required |
 *   routine_follow_up
 *
 * Conservative principles enforced:
 *  - Suspected serious findings are never downgraded because confidence is imperfect.
 *  - Uncertainty itself can create risk => professional review.
 *  - A failed quality gate blocks routine triage.
 *  - Red-flag symptoms (when supplied) override imaging triage upward.
 * AI output can NEVER lower a triage level set by these deterministic rules.
 */

export type TriagePriority =
  | "emergency_evaluation"
  | "urgent_eye_care_review"
  | "prompt_professional_review"
  | "specialist_review_required"
  | "routine_follow_up";

export interface TriageOutcome {
  priority: TriagePriority;
  action: string;
  rationale: string;
  triggered_rules: string[];
}

export interface TriageInput {
  findings: Finding[];
  qualityAcceptable: boolean;
  qualityScore: number;
  uncertainty: number;
  modality: string;
  redFlagSymptoms?: string[]; // symptom vocabulary types that are configured red flags
  /**
   * Candidate red flags quoted from a source document. These are not
   * clinician-verified symptoms, but must still raise a pre-review safety
   * signal; ignoring them until review could conceal an urgent presentation.
   */
  documentExtractedRedFlagSymptoms?: string[];
  ood?: { detected: boolean; message?: string }; // out-of-distribution / unsupported operating conditions
  symptomUrgency?: "emergency" | "urgent" | "prompt" | "routine"; // from correlation engine
}

const HIGH_RISK = new Set([
  "possible_retinal_hemorrhage",
  "retinal_hemorrhage",
  "preretinal_hemorrhage",
  "possible_retinal_detachment",
  "disc_edema_like",
  "neovascularization_like",
  "possible_occlusive_change",
]);

// Phase 3: maps symptom vocabulary types to triage priorities.
// Escalation is conservative and NEVER names a condition.
const RED_FLAG_MAP: Record<string, TriagePriority> = {
  // Phase 3 symptom vocabulary
  sudden_vision_loss: "emergency_evaluation",
  curtain_shadow: "emergency_evaluation",
  trauma_with_vision_loss: "emergency_evaluation",
  severe_eye_pain_with_visual_disturbance: "emergency_evaluation",
  new_floaters: "urgent_eye_care_review",
  flashes_with_field_loss: "urgent_eye_care_review",
  recent_eye_trauma: "urgent_eye_care_review",
  // Legacy keys kept for compatibility with existing tests
  curtain_in_vision: "emergency_evaluation",
  flashes_with_floaters: "urgent_eye_care_review",
  severe_eye_pain: "emergency_evaluation",
  trauma: "emergency_evaluation",
  sudden_double_vision: "urgent_eye_care_review",
};

export function runTriage(input: TriageInput): TriageOutcome {
  const rules: string[] = [];

  // Rule 0: a source document can contain an urgent presentation. Keep its
  // provenance separate from patient/clinician-entered symptoms, but do not
  // make an unreviewed extraction a reason to delay an urgent safety signal.
  let documentWorst: TriagePriority = "routine_follow_up";
  if (input.documentExtractedRedFlagSymptoms?.length) {
    for (const symptom of input.documentExtractedRedFlagSymptoms) {
      const priority = RED_FLAG_MAP[symptom];
      if (priority && priorityRank(priority) > priorityRank(documentWorst)) documentWorst = priority;
    }
    if (documentWorst !== "routine_follow_up") {
      rules.push("document_extracted_red_flag_pre_review_signal");
    }
  }

  // Rule 1: red-flag symptoms always dominate.
  let reportedWorst: TriagePriority = "routine_follow_up";
  if (input.redFlagSymptoms?.length) {
    for (const s of input.redFlagSymptoms) {
      const p = RED_FLAG_MAP[s];
      if (p && priorityRank(p) > priorityRank(reportedWorst)) reportedWorst = p;
    }
    // Symptom-engine urgency escalates even when the specific type is not mapped.
    if (input.symptomUrgency === "emergency") reportedWorst = "emergency_evaluation";
    else if (input.symptomUrgency === "urgent" && priorityRank(reportedWorst) < priorityRank("urgent_eye_care_review")) {
      reportedWorst = "urgent_eye_care_review";
    }
    if (reportedWorst !== "routine_follow_up") {
      rules.push("red_flag_symptoms_override");
    }
  }

  // Both channels are independent, but neither may downgrade the other. A
  // lower-priority document candidate must never mask a higher-priority
  // structured symptom (or vice versa); choose the worst signal and retain
  // both provenance rules in the output for review.
  const redFlagWorst = priorityRank(reportedWorst) >= priorityRank(documentWorst) ? reportedWorst : documentWorst;
  if (redFlagWorst !== "routine_follow_up") {
    if (reportedWorst !== "routine_follow_up" && priorityRank(reportedWorst) >= priorityRank(documentWorst)) {
      return {
        priority: redFlagWorst,
        action:
          redFlagWorst === "emergency_evaluation"
            ? "Urgent review recommended. Your reported symptoms may require prompt professional evaluation - seek ophthalmic assessment now."
            : "Urgent ophthalmic assessment is recommended based on the reported symptoms.",
        rationale:
          documentWorst !== "routine_follow_up"
            ? "Reported red-flag symptoms and an independent document-derived safety signal are present. Reported symptoms take priority over automated imaging assessment; the document signal remains UNREVIEWED. This escalation does NOT name or imply any specific condition."
            : "Reported red-flag symptoms take priority over automated imaging assessment. This escalation does NOT name or imply any specific condition.",
        triggered_rules: rules,
      };
    }
    return {
      priority: redFlagWorst,
      action: "An urgent symptom candidate was extracted from a source document. Prompt clinician confirmation and ophthalmic assessment are recommended.",
      rationale: "This is a document-derived, UNREVIEWED safety signal, not a diagnosis or verified patient report. It is escalated conservatively so review cannot suppress a potentially urgent presentation.",
      triggered_rules: rules,
    };
  }

  // Rule 2: unsupported format / failed quality gate blocks routine triage.
  if (!input.qualityAcceptable) {
    rules.push("quality_gate_block");
    return {
      priority: "prompt_professional_review",
      action:
        "Image quality is insufficient for reliable automated analysis. Please acquire another scan or have the image reviewed by an eye-care professional.",
      rationale: "Quality gate failed; no clinical interpretation is generated.",
      triggered_rules: rules,
    };
  }

  // Rule 3: high-risk finding types escalate regardless of confidence.
  const highRisk = input.findings.filter((f) => HIGH_RISK.has(f.type));
  if (highRisk.length > 0) {
    rules.push("high_risk_finding_escalation");
    return {
      priority: "prompt_professional_review",
      action: "Recommended action: Prompt review by an eye-care professional.",
      rationale:
        "A potentially vision-threatening finding pattern was detected. Escalation is conservative and is not reduced by imperfect confidence.",
      triggered_rules: rules,
    };
  }

  // Rule 3.5: out-of-distribution input must never yield a normality claim.
  if (input.ood?.detected) {
    rules.push("ood_prevents_normality_claim");
    return {
      priority: "prompt_professional_review",
      action:
        (input.ood.message ?? "Input is outside the validated operating conditions of this model.") +
        " Automated interpretation is inconclusive. Professional review is recommended.",
      rationale:
        "The input falls outside the model's declared operating conditions (unsupported modality/device, missing metadata, or atypical image characteristics). Normality must not be claimed.",
      triggered_rules: rules,
    };
  }

  // Rule 4: significant uncertainty itself warrants review.
  if (input.uncertainty >= 0.5 || input.findings.some((f) => f.confidence_category === "INDETERMINATE")) {
    rules.push("uncertainty_requires_review");
    return {
      priority: "prompt_professional_review",
      action: "Indeterminate - additional imaging or specialist interpretation is recommended.",
      rationale: "Analysis uncertainty is high; when uncertainty creates meaningful risk, professional review is recommended.",
      triggered_rules: rules,
    };
  }

  // Rule 5: any finding at all => prompt review (screening posture).
  if (input.findings.length > 0) {
    rules.push("any_finding_review");
    return {
      priority: "prompt_professional_review",
      action: "Recommended action: review by an eye-care professional.",
      rationale: "Automated screening detected a finding that should be professionally evaluated.",
      triggered_rules: rules,
    };
  }

  // Rule 6: all components unvalidated => even normal results get routine review language.
  rules.push("unvalidated_system_routine");
  return {
    priority: "routine_follow_up",
    action:
      "No significant abnormality detected by automated screening. Continue routine eye-care follow-up. " +
      "This does not guarantee that no eye disease is present.",
    rationale: "No findings detected; routine follow-up recommended given the system's unvalidated status.",
    triggered_rules: rules,
  };
}

export function triageAction(p: TriagePriority): string {
  switch (p) {
    case "emergency_evaluation":
      return "Seek emergency evaluation immediately.";
    case "urgent_eye_care_review":
      return "Urgent eye-care review recommended (within days).";
    case "prompt_professional_review":
      return "Prompt review by an eye-care professional is recommended.";
    case "specialist_review_required":
      return "Specialist interpretation required; automated analysis cannot proceed.";
    case "routine_follow_up":
      return "Routine follow-up with an eye-care professional.";
  }
}

function priorityRank(p: TriagePriority): number {
  const order: TriagePriority[] = [
    "routine_follow_up",
    "specialist_review_required",
    "prompt_professional_review",
    "urgent_eye_care_review",
    "emergency_evaluation",
  ];
  return order.indexOf(p);
}

/** Guard used everywhere: AI output may never lower a triage level. */
export function assertNotDowngraded(final: TriagePriority, proposed: TriagePriority): boolean {
  return priorityRank(proposed) <= priorityRank(final);
}
