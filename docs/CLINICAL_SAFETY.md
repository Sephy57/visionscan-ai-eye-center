# Clinical Safety

## Separation of concern levels

| Level | Meaning | Who can establish it |
|---|---|---|
| **OBSERVATION** | What is visible/measurable in the image | Automated analysis (with confidence + uncertainty) |
| **POSSIBLE ASSOCIATION** | "This finding can be associated with…" | Automated analysis, association wording only |
| **DIAGNOSIS** | A named condition | Only a qualified clinician — or a CLINICALLY_VALIDATED model for a specific authorized intended use |

Enforced by the finding taxonomy (`lib/analysis/taxonomy.ts`):
- All taxonomy findings are OBSERVATION level.
- `mayEmitFinding()` refuses diagnosis-level emission unless model status is CLINICALLY_VALIDATED.
- The schema validator rejects any finding with `taxonomy_level: "diagnosis"`.
- Forbidden vocabulary: "blood clot" (and "clot") never appear in the taxonomy; ambiguous findings are
  reported as indeterminate with specialist-review language.

## Safety validator (`lib/clinical/safety.ts`)

Runs after AI generation, before storage/display. Current checks:

1. `no_findings_when_quality_failed` — quality gate blocks all findings
2. `confidence_in_bounds` — 0..1
3. `synthetic_findings_labeled` — placeholder output always flagged
4. `demo_label_present`
5. `no_diagnostic_absolutes` — rejects "you have", "diagnosed with", "100% accurate", "definitely healthy", affirmative "guarantee"
6. `provenance_recorded` — model versions, ruleset, timestamp
7. `uncertainty_recorded`
8. `disclaimers_present`
9. `mandatory_negative_result_wording` — "does not guarantee that no eye disease is present"
10. `no_fabricated_measurements` — placeholder/demo models may never emit measurements
11. `calibration_honesty` — calibrated confidence forbidden without calibration evidence
12. `ood_no_normality_claim` — OOD inputs cannot yield "no abnormality detected"
13. `model_validation_status_recorded`
14. `no_fabricated_validation`
15. `demo_isolation` — synthetic results always carry the demo flag + label

Additionally, the pipeline's claim scanner rejects results containing forbidden claim patterns before storage.

## Triage (deterministic, conservative)

Order of escalation (highest first):
1. Red-flag symptoms → emergency/urgent (overrides everything)
2. Quality gate failure → prompt review; no interpretation generated
3. High-risk finding types → prompt review regardless of confidence
4. **OOD / outside operating conditions → prompt review; "Automated interpretation is inconclusive."**
5. High uncertainty or indeterminate findings → prompt review
6. Any finding → prompt review
7. Clean scan → routine follow-up, with the mandatory caveat

AI output can never lower a triage level (`assertNotDowngraded`).

## AI → Clinician separation

Three separate records, never overwritten:
- **AI OUTPUT** (`analyses` collection + `data\processed\`) — immutable pipeline result
- **CLINICIAN INTERPRETATION** (`report.clinician_interpretation`) — confirm/reject/correct/indeterminate/request-new-scan per finding, plus notes
- **FINAL REPORT** (`report.final_interpretation`) — only written at finalize, attributed to the reviewer id; no signatures fabricated

Every review action is audited with actor, action, study, and finding id.

## Uncertainty behavior

- Raw model output and calibrated confidence are stored separately; calibrated values are displayed only if
  calibration evidence exists (none currently does — so no calibrated percentages are shown anywhere).
- Uncertain models return INDETERMINATE, never a forced classification.
- OOD detection flags: unsupported modality, unvalidated device, missing metadata, atypical image
  characteristics, severe artifacts → "Input is outside the validated operating conditions of this model."
