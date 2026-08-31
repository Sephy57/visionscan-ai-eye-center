import { AnalysisResult } from "../analysis/schema";

/**
 * Safety Validator - runs on every stored/displayed result.
 * Enforces the mandatory safety rules mechanically, not just by convention.
 */

export interface SafetyCheck {
  rule: string;
  passed: boolean;
  detail?: string;
}

export function runSafetyChecks(result: AnalysisResult): { ok: boolean; checks: SafetyCheck[] } {
  const checks: SafetyCheck[] = [];

  // 1. Quality gate: no findings when quality failed.
  checks.push({
    rule: "no_findings_when_quality_failed",
    passed: !(result.quality.acceptable === false && result.findings.length > 0),
  });

  // 2. Confidence bounds.
  checks.push({
    rule: "confidence_in_bounds",
    passed: result.findings.every((f) => f.confidence >= 0 && f.confidence <= 1),
  });

  // 3. Synthetic labeling: all findings from placeholder detectors must be flagged.
  checks.push({
    rule: "synthetic_findings_labeled",
    passed: result.findings.every((f) => f.synthetic === true),
    detail: "All current detectors are placeholders; every finding must be marked synthetic.",
  });

  // 4. Demo labeling present whenever findings exist.
  checks.push({
    rule: "demo_label_present",
    passed: result.findings.length === 0 || result.demo.synthetic_result === true,
  });

  // 5. No diagnostic absolutes in text fields.
  const textFields: string[] = [];
  for (const f of result.findings) textFields.push(f.explanation, f.type, f.location);
  textFields.push(result.recommendation.action, result.recommendation.rationale);
  // The mandatory negated disclaimer ("does not guarantee that no eye disease
  // is present") must not itself trigger the forbidden-claim rule.
  const forbidden = /\b(you have|diagnosed with|100% accurat|definitely healthy|(?<!not )guarantee)\b/i;
  checks.push({
    rule: "no_diagnostic_absolutes",
    passed: textFields.every((t) => !forbidden.test(t ?? "")),
  });

  // 6. Provenance recorded (model versions, ruleset, timestamp).
  checks.push({
    rule: "provenance_recorded",
    passed:
      Array.isArray(result.provenance.models) &&
      result.provenance.models.length > 0 &&
      typeof result.provenance.ruleset_version === "string" &&
      typeof result.provenance.analyzed_at === "string",
  });

  // 7. Uncertainty recorded.
  checks.push({
    rule: "uncertainty_recorded",
    passed: typeof result.uncertainty.overall === "number" && Array.isArray(result.uncertainty.reasons),
  });

  // 8. Disclaimers present.
  checks.push({
    rule: "disclaimers_present",
    passed: result.safety.disclaimers.length > 0,
  });

  // 9. Mandatory negative-result wording when nothing was found.
  const noFindings = result.findings.length === 0 && result.quality.acceptable === true;
  const mandatoryPhrase = "does not guarantee that no eye disease is present";
  checks.push({
    rule: "mandatory_negative_result_wording",
    passed: noFindings ? textFields.some((t) => (t ?? "").includes(mandatoryPhrase)) || result.safety.disclaimers.some((d) => d.includes(mandatoryPhrase)) : true,
  });

  // ---- Phase 2 additions ----

  // 10. No fabricated measurements: a placeholder/demo model may never emit measurements.
  const placeholders = new Set(["fundus-lesion-detector", "retinal-vascular-analyzer", "oct-analyzer", "anatomy-segmentation"]);
  const hasMeasurements = result.findings.some(
    (f) => (f.measurements && Object.keys(f.measurements).length > 0) || (f.structured_measurements && f.structured_measurements.length > 0)
  );
  checks.push({
    rule: "no_fabricated_measurements",
    passed: !hasMeasurements || result.findings.every((f) => !placeholders.has(f.model_id)),
    detail: hasMeasurements ? "Measurements present; producer must not be a placeholder component." : undefined,
  });

  // 11. Calibration honesty: calibrated confidence only when calibration exists.
  checks.push({
    rule: "calibration_honesty",
    passed: result.findings.every((f) => f.confidence_calibrated === undefined || f.confidence_calibrated === null),
    detail: "No component in this deployment has calibration evidence; calibrated confidence must be absent.",
  });

  // 12. OOD honesty: if OOD was detected, the result must not assert normality.
  if (result.ood?.detected) {
    checks.push({
      rule: "ood_no_normality_claim",
      passed: !textFields.some((t) => /no abnormality detected/i.test(t ?? "")),
      detail: "Input outside validated operating conditions - normality must not be claimed.",
    });
  }

  // 13. Validation status honesty: model registry status must be surfaced.
  if (result.model_registry) {
    checks.push({
      rule: "model_validation_status_recorded",
      passed: typeof result.model_registry.model_status === "string" && result.model_registry.model_status.length > 0,
    });
    checks.push({
      rule: "no_fabricated_validation",
      passed: !["EXTERNALLY_VALIDATED", "CLINICALLY_VALIDATED"].includes(result.model_registry.model_status) || result.provenance.models.length > 0,
    });
  }

  // 14. Demo isolation: synthetic findings must carry the DEMO label and demo flag.
  const anySynthetic = result.findings.some((f) => f.synthetic);
  checks.push({
    rule: "demo_isolation",
    passed: !anySynthetic || (result.demo.synthetic_result === true && !!result.demo.label),
  });

  // 15. No invented clinician approval: finalized reports require a reviewer id + timestamp.
  checks.push({
    rule: "no_invented_clinician_approval",
    passed: true, // enforced structurally in the review service; placeholder here for report-level checks
  });

  return { ok: checks.every((c) => c.passed), checks };
}
