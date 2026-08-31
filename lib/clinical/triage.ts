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
  redFlagSymptoms?: string[]; // e.g. ["sudden_vision_loss", "flashes_with_floaters", "curtain_in_vision", "severe_eye_pain"]
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

const RED_FLAG_MAP: Record<string, TriagePriority> = {
  sudden_vision_loss: "emergency_evaluation",
  curtain_in_vision: "emergency_evaluation",
  flashes_with_floaters: "urgent_eye_care_review",
  severe_eye_pain: "emergency_evaluation",
  trauma: "emergency_evaluation",
  sudden_double_vision: "urgent_eye_care_review",
};

export function runTriage(input: TriageInput): TriageOutcome {
  const rules: string[] = [];

  // Rule 1: red-flag symptoms always dominate.
  if (input.redFlagSymptoms?.length) {
    let worst: TriagePriority = "routine_follow_up";
    for (const s of input.redFlagSymptoms) {
      const p = RED_FLAG_MAP[s];
      if (p && priorityRank(p) > priorityRank(worst)) worst = p;
    }
    if (worst !== "routine_follow_up") {
      rules.push("red_flag_symptoms_override");
      return {
        priority: worst,
        action: triageAction(worst),
        rationale: "Reported red-flag symptoms take priority over automated imaging assessment.",
        triggered_rules: rules,
      };
    }
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
