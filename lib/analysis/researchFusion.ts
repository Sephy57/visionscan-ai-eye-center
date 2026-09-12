/**
 * Cross-model research signal fusion.
 *
 * Only categorical, same-study signals are compared here. Scores and logits
 * are intentionally not combined. A disagreement is a first-class result so
 * a low DR grade cannot erase a lesion signal (and a lesion-negative result
 * cannot erase a referable-grade signal).
 */

export type ResearchFusionAgreement =
  | "CORROBORATED_RESEARCH_EVIDENCE"
  | "MODEL_DISAGREEMENT"
  | "CONSISTENT_RESEARCH_NEGATIVE"
  | "SINGLE_RESEARCH_MODEL"
  | "NO_RESEARCH_MODEL_OUTPUT";

export interface ResearchFusionInput {
  lesion_completed: boolean;
  lesion_positive: boolean;
  lesion_count: number;
  dr_completed: boolean;
  dr_grade: number | null;
  dr_referable: boolean | null;
  oct_completed?: boolean;
  oct_class?: string | null;
}

export interface ResearchFusionResult {
  agreement: ResearchFusionAgreement;
  notes: string[];
  contradiction_flags: string[];
}

/** Compare model outputs without score averaging or automatic winner selection. */
export function fuseResearchSignals(input: ResearchFusionInput): ResearchFusionResult {
  const notes: string[] = [];
  const contradiction_flags: string[] = [];

  if (input.oct_completed && input.oct_class) {
    notes.push(
      `OCT modality signal ${input.oct_class} was retained as a separate uncalibrated research observation; no cross-modality equivalence or clinical conclusion was asserted.`,
    );
  }

  if (input.lesion_completed && input.dr_completed) {
    if (input.dr_referable === true && input.lesion_positive) {
      notes.push(
        `CORROBORATED_RESEARCH_EVIDENCE (not a confirmed diagnosis): the DR grader estimated grade ${input.dr_grade}/4 (referable threshold met) and the lesion detector localized ${input.lesion_count} lesion-like region(s). Two uncalibrated research outputs agree; ophthalmic review is still required.`,
      );
      return { agreement: "CORROBORATED_RESEARCH_EVIDENCE", notes, contradiction_flags };
    }
    if (input.dr_referable !== input.lesion_positive) {
      if (input.dr_referable === false && input.lesion_positive) contradiction_flags.push("DR_BELOW_REFERABLE_THRESHOLD_BUT_LESION_SIGNAL");
      if (input.dr_referable === true && !input.lesion_positive) contradiction_flags.push("DR_REFERABLE_WITHOUT_SUPPORTED_LESION_SIGNAL");
      notes.push(
        `MODEL_DISAGREEMENT (no automatic winner): DR grader ${input.dr_referable ? `estimated grade ${input.dr_grade}/4 (referable)` : "did not reach the referable threshold"} while the lesion detector ${input.lesion_positive ? `localized ${input.lesion_count} region(s)` : "found no target regions"}. Both outputs are uncalibrated research evidence; a clinician must reconcile them.`,
      );
      return { agreement: "MODEL_DISAGREEMENT", notes, contradiction_flags };
    }
    notes.push(
      "CONSISTENT_RESEARCH_NEGATIVE: DR grader below the referable threshold and no target lesion regions. Other ocular abnormalities may still be present; this is not a normal-fundus result.",
    );
    return { agreement: "CONSISTENT_RESEARCH_NEGATIVE", notes, contradiction_flags };
  }

  const usedResearch = input.lesion_completed || input.dr_completed || input.oct_completed === true;
  if (usedResearch) {
    const onlyModel = input.lesion_completed ? "lesion detector" : input.dr_completed ? "DR grader" : "OCT classifier";
    notes.push(`Only one research model completed (${onlyModel}); no cross-model agreement statement is possible.`);
    return { agreement: "SINGLE_RESEARCH_MODEL", notes, contradiction_flags };
  }

  notes.push("No research imaging model completed for this study.");
  return { agreement: "NO_RESEARCH_MODEL_OUTPUT", notes, contradiction_flags };
}
