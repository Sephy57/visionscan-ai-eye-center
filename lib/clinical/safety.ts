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

  // 3. Synthetic labeling: a DEMO-status model's findings must always be
  // flagged synthetic (unchanged, hard rule for the only model installed
  // today). A non-DEMO model's finding MAY be synthetic: false - this does
  // not weaken the DEMO guarantee, it only stops forcing a real model's
  // genuine output to falsely claim it is synthetic demo data.
  checks.push({
    rule: "synthetic_findings_labeled",
    passed: result.findings.every((f) => f.synthetic === true || f.model_status !== "DEMO"),
    detail: "Every finding from a DEMO-status model must be marked synthetic.",
  });

  // 4. Demo labeling present whenever a SYNTHETIC finding exists (mirrors
  // rule 14 "demo_isolation" below). Does not require the demo label for a
  // genuinely non-synthetic finding from a non-DEMO model.
  checks.push({
    rule: "demo_label_present",
    passed: !result.findings.some((f) => f.synthetic) || result.demo.synthetic_result === true,
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
    // DEMO has no calibration evidence and must never show a calibrated
    // number (unchanged, hard rule). A non-DEMO model MAY carry a
    // calibrated_confidence - trusting that it was only ever set through
    // lib/models/outputConversion.ts's mayDisplayCalibrated() gate is this
    // rule's remaining job as a defense-in-depth check, not a blanket ban.
    passed: result.findings.every((f) => f.confidence_calibrated === undefined || f.confidence_calibrated === null || f.model_status !== "DEMO"),
    detail: "A DEMO-status model has no calibration evidence; calibrated confidence must be absent for its findings.",
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

  // 15. No invented clinician approval: the raw AI-generated AnalysisResult
  // must never itself carry a clinician-authorship field (reviewer id,
  // finalized timestamp, etc.) - that only exists on the ClinicalReport,
  // added exclusively through the review service after an actual clinician acts.
  checks.push({
    rule: "no_invented_clinician_approval",
    passed: !("reviewer_id" in result) && !("finalized_at" in result) && !("clinician_interpretation" in result),
    detail: "The AI-generated result must not contain any clinician-authorship field; that is only added by the review workflow.",
  });

  // 15b. Every current presentation-facing claim must have a durable evidence
  // reference. A blocked ledger is never publishable, even if a caller tries
  // to bypass the report generator.
  if (result.claim_ledger) {
    const phase2Ledger = /^claim-ledger-1\.[1-9]\d*\./.test(result.claim_ledger.schema_version);
    checks.push({
      rule: "claim_ledger_evidence_gate",
      passed: result.claim_ledger.publication_blocked === false &&
        result.claim_ledger.publication_status === "RESEARCH_REVIEW_ONLY" &&
        result.claim_ledger.entries.every((entry) => entry.evidence_refs.length > 0) &&
        (!phase2Ledger || result.claim_ledger.entries.every((entry) =>
          typeof entry.certainty === "string" &&
          Array.isArray(entry.source_ids) &&
          Array.isArray(entry.model_execution_ids) &&
          Array.isArray(entry.rule_ids) &&
          Array.isArray(entry.knowledge_source_ids))),
      detail: phase2Ledger
        ? "Every claim must retain evidence, categorical certainty, source/model/rule/knowledge traceability before publication."
        : "Every claim must retain evidence references before publication.",
    });
  }

  // ---- Phase 3 additions ----

  // 16. Symptom -> finding / symptom -> diagnosis hallucination blocking.
  const correlationText = textFields.join(" ");
  const symptomCausation = /\b(because (the patient|they) reports?|due to the reported symptom|indicates a diagnosis of|therefore (the )?(patient )?(has|has a))\b/i;
  checks.push({
    rule: "no_symptom_driven_findings",
    passed: !symptomCausation.test(correlationText),
    detail: "Symptoms must never be worded as causes of findings or diagnoses.",
  });

  // 17. Correlation honesty: research correlation must be labeled as such.
  if (result.symptom_correlation) {
    checks.push({
      rule: "correlation_labeled_research",
      passed: result.symptom_correlation.label.includes("NOT CLINICALLY VALIDATED"),
    });
  }

  // 18. Possible conditions must be absent for DEMO models (condition inference requires validated evidence).
  if (result.possible_conditions && result.model_registry?.model_status === "DEMO") {
    checks.push({
      rule: "conditions_blocked_for_demo_models",
      passed: result.possible_conditions.conditions.length === 0,
    });
  }

  // 19. Patient context honesty note must be present when symptoms are reported.
  if (result.patient_context?.reported) {
    checks.push({
      rule: "symptom_context_note_present",
      passed: result.patient_context.note.includes("CONTEXT only"),
    });
  }

  // ---- Phase 5 additions ----

  // 20. Treatment information can only exist for conditions that already
  // passed possible_conditions gating (finding -> condition -> treatment chain).
  if (result.treatment_information) {
    const gatedIds = new Set((result.possible_conditions?.conditions ?? []).map((c) => c.id));
    checks.push({
      rule: "treatment_requires_gated_condition",
      passed: result.treatment_information.items.every((i) => gatedIds.has(i.condition_id)),
      detail: "Treatment information must never be produced for a condition that did not pass possible_conditions gating.",
    });

    // 21. Every treatment item must carry the mandatory clinician-review label.
    checks.push({
      rule: "treatment_requires_clinician_label",
      passed: result.treatment_information.items.every((i) => i.label.includes("clinician review required")),
    });

    // 22. DEMO models can never surface treatment information (mirrors condition gating).
    if (result.model_registry?.model_status === "DEMO") {
      checks.push({
        rule: "treatment_blocked_for_demo_models",
        passed: result.treatment_information.items.length === 0,
      });
    }

    // 23. Dosage safety: treatment information must never resemble a computed, patient-specific dose.
    const dosagePattern = /\b\d+(\.\d+)?\s?(mg|mcg|g|ml|units?)\b.{0,20}\b(once|twice|three times|daily|per day|bid|tid|qid|q\d+h)\b/i;
    checks.push({
      rule: "no_dosage_instructions",
      passed: !dosagePattern.test(JSON.stringify(result.treatment_information)),
      detail: "Medication and dosage must be determined by the treating clinician - this system never computes a dose.",
    });
  }

  return { ok: checks.every((c) => c.passed), checks };
}
