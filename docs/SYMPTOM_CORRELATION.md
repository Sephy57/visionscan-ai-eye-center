# Symptom Intake & Correlation

## Structured symptom schema (`lib/clinical/symptoms.ts`)

Symptoms are stored as structured records — never as an unstructured text blob:

```json
{
  "type": "blurred_vision",
  "onset": "sudden",
  "duration": "6_hours | hours | days | ... | unknown",
  "severity": "mild | moderate | severe",
  "laterality": "right | left | both | unknown",
  "progression": "stable | worsening | improving | unknown",
  "frequency": "constant | intermittent | unknown",
  "free_text": "optional description (truncated to 1000 chars)"
}
```

Validation is strict: unknown symptom types and invalid enum values are **rejected** (fail closed), never coerced.

## Vocabulary

30 symptom types across four categories (visual, retinal/vitreous, discomfort, other). Each definition carries:
- `red_flag` + `urgency` (emergency / urgent / none)
- `related_finding_types` — controlled taxonomy finding types used ONLY for correlation wording

## Red flags (safety escalation)

Sudden vision loss, curtain/shadow over vision, trauma with vision loss, severe eye pain with visual
disturbance → **emergency**. New floaters, flashes with field loss, recent eye trauma → **urgent**.

When triggered:
- The triage engine escalates **before/without** any model diagnosis: "Urgent ophthalmic assessment is
  recommended." — never naming a condition.
- The UI shows the escalation immediately (including during intake, before upload).
- Symptom wording never implies a diagnosis ("You have retinal detachment" is mechanically blocked).

## Correlation engine (`lib/clinical/correlation.ts`)

Runs AFTER the model output. States (worst-case overall reported):

| State | Meaning |
|---|---|
| `correlated` | A detected finding is taxonomically related to the symptom — worded as "may be relevant"; causation is explicitly disclaimed |
| `not_explained` | Findings exist but none matches the symptom — "Symptom is not explained by the current automated imaging result. Clinical evaluation may still be warranted." |
| `inconclusive` | No findings + unvalidated model — "cannot confirm or exclude a cause" (normality is never claimed) |
| `conflicting` | Reserved for explicit symptom/imaging conflicts |
| `urgent` | Configured safety escalation criteria met |

All correlation output is labeled: **RESEARCH CORRELATION — NOT CLINICALLY VALIDATED**.

## Model input honesty

- The registry declares `uses_symptoms` / `input_schema` per model. The installed DEMO model is
  `IMAGE_ONLY` — symptoms are correlated post-hoc and the result explicitly says "MODEL INPUT: IMAGE ONLY".
- Future symptom-aware models must register: `supported_symptom_types`, `input_schema`,
  `performance_with_symptoms`, `performance_without_symptoms`. Symptom-aware performance is never assumed.

## Possible conditions (`lib/clinical/conditions.ts`)

A controlled 14-condition taxonomy (diabetic retinopathy, AMD, RVO, retinal detachment, macular hole, etc.).
Conditions are displayed ONLY when: the model registers the condition, the modality matches, the model holds
EXTERNALLY_VALIDATED/CLINICALLY_VALIDATED status with an evidence reference, AND relevant findings were
actually detected. For the DEMO model **no conditions are ever displayed** — enforced in the correlation
engine, the schema validator, and the safety validator.

## Hard rules (tested)

1. Symptoms never create imaging findings (`symptom-only → no findings`).
2. Symptoms never produce diagnoses (condition inference requires validated model + detected findings).
3. Causal wording ("because the patient reports…", "due to the reported symptom…") is mechanically blocked.
4. Symptom correlation is never converted into model confidence — the two are reported separately.
5. Symptoms never override contradictory imaging evidence; disagreement is displayed, never hidden.
