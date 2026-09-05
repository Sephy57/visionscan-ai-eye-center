import { Finding } from "./schema";
import { COMPONENTS } from "../models/registry";

/**
 * Ensemble / consistency check and uncertainty estimation.
 *
 * Honest behavior: with only ONE detector component installed, the ensemble
 * can never claim cross-model agreement. It therefore reports single_model
 * and caps confidence. When multiple independent detectors are added later,
 * agreement raises confidence; disagreement forces "inconclusive" without
 * picking the more alarming result (safety rule).
 */

export interface EnsembleOutcome {
  performed: boolean;
  agreement: "agree" | "disagree" | "single_model" | "not_applicable";
  checks: Array<{ component_id: string; result: string }>;
  note: string;
  cappedFindings: Finding[];
}

const HIGH_RISK_TYPES = new Set([
  "possible_retinal_hemorrhage",
  "retinal_hemorrhage",
  "possible_retinal_detachment",
  "disc_edema_like",
  "neovascularization_like",
]);

export function runEnsemble(findings: Finding[]): EnsembleOutcome {
  const detectors = Object.values(COMPONENTS).filter((c) => c.role === "detector" && c.implementation !== "placeholder");
  const checks: Array<{ component_id: string; result: string }> = [];

  const capped = findings.map((f) => {
    if (HIGH_RISK_TYPES.has(f.type) && detectors.length < 2) {
      // High-risk finding from a single non-ensemble source: cap to moderate.
      return { ...f, confidence: Math.min(f.confidence, 0.75), confidence_category: capCategory(f.confidence) };
    }
    return f;
  });

  if (detectors.length < 2) {
    for (const f of capped) checks.push({ component_id: f.model_id, result: "single detector - no independent corroboration" });
    return {
      performed: true,
      agreement: "single_model",
      checks,
      note:
        "Ensemble verification requires at least two independent detector models. Only one detector component is " +
        "currently installed (integration placeholder), so no cross-model agreement could be established. " +
        "Confidence is capped accordingly.",
      cappedFindings: capped,
    };
  }

  // Future: true multi-model voting. Disagreement on high-risk findings must
  // yield "inconclusive", never the more alarming answer.
  return {
    performed: true,
    agreement: "not_applicable",
    checks,
    note: "Multi-model ensemble logic is scaffolded but not yet exercised.",
    cappedFindings: capped,
  };
}

export function capCategory(c: number): Finding["confidence_category"] {
  if (c >= 0.85) return "HIGH CONFIDENCE";
  if (c >= 0.65) return "MODERATE CONFIDENCE";
  if (c >= 0.4) return "LOW CONFIDENCE";
  return "INDETERMINATE";
}

export function estimateUncertainty(
  qualityScore: number,
  findings: Finding[],
  ensemble: EnsembleOutcome
): { overall: number; reasons: string[] } {
  const reasons: string[] = [];
  let u = 0.1;

  if (qualityScore < 0.7) {
    u += 0.2;
    reasons.push("Image quality below ideal; metric reliability reduced.");
  }
  if (ensemble.agreement === "single_model") {
    u += 0.25;
    reasons.push("No independent second model corroborated the findings.");
  }
  for (const f of findings) {
    if (f.confidence_category === "LOW CONFIDENCE" || f.confidence_category === "INDETERMINATE") {
      u += 0.15;
      reasons.push(`Finding "${f.type}" has low model confidence.`);
    }
  }
  const seg = COMPONENTS.anatomySegmentation;
  if (seg.implementation === "placeholder") {
    u += 0.1;
    reasons.push("Anatomical segmentation is a placeholder; localization precision is unverified.");
  }
  reasons.push("All detection components are unvalidated placeholders; overall uncertainty is inherently high.");

  return { overall: Math.min(0.99, Math.round(u * 100) / 100), reasons };
}
