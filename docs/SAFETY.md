# Safety Rules — Implemented Behavior

## Mandatory rules and where they are enforced

| # | Rule | Enforcement point |
|---|---|---|
| 1 | Never fabricate an imaging finding | Only `lib/analysis/findings.ts` creates findings; all marked `synthetic: true` (demo). Schema validator + safety check `synthetic_findings_labeled`. |
| 2 | Never fabricate confidence | Confidence comes from defined methodology (demo scenario + ensemble cap). Bounds-checked in schema validator. No ensemble => capped, never "HIGH". |
| 3 | Never fabricate measurements | No measurement components exist; `MEASUREMENTS_NOTE` states this. Temporal comparison refuses quantitative claims. |
| 4 | Never silently analyze a corrupted scan | DICOM/unsupported detected in `lib/imaging/dicom.ts`; pipeline returns explicit unsupported result. sharp `failOn: "none"` + gate metrics catch corrupt images. |
| 5 | Never ignore poor image quality | Quality gate (real metrics). Fail => zero findings + mandatory message; safety check `no_findings_when_quality_failed`. |
| 6 | Never override red-flag symptoms | Triage rule 1 maps red flags to urgent/emergency before any imaging logic. |
| 7 | Never force a diagnosis when uncertain | Indeterminate findings => "Indeterminate — additional imaging or specialist interpretation is recommended." Triage rule 4. |
| 8 | Never present screening as guaranteed | Validation banner on every page; disclaimers in result; safety check `no_diagnostic_absolutes`. |
| 9 | Negative results never mean "definitely healthy" | Mandatory wording "does not guarantee that no eye disease is present" (safety check `mandatory_negative_result_wording`). |
| 10 | No generic LLM as sole diagnostic engine | Pipeline is deterministic code + (future) specialized models. No LLM anywhere in the analysis path. |
| 11 | Explanation layer cannot modify findings | Report generator takes the validated structured result read-only; API exposes no path from "explanation" to findings. |
| 12 | Preserve the original scan | Uploads written once (`flag: "wx"`), never rewritten; SHA-256 recorded and displayed. |
| 13 | Log model/version per analysis | `provenance.models` + `ruleset_version` in every result/report; component registry with checksums. |
| 14 | All AI results auditable | Audit NDJSON on D: (`data/logs`), report review trail (accept/reject/correct/finalize), results stored as JSON on D:. |

## Triage ordering (most to least urgent)

1. `emergency_evaluation` — red-flag symptoms (sudden vision loss, curtain, severe pain, trauma)
2. `urgent_eye_care_review`
3. `prompt_professional_review` — high-risk finding patterns, failed quality gate, significant uncertainty
4. `specialist_review_required`
5. `routine_follow_up` — clean scans; still carries the mandatory caveat

`assertNotDowngraded()` exists so any future AI-assisted triage adjustment can only escalate, never reduce.

## Vocabulary policy

Ambiguous findings must be described, not labeled:
- "Focal hyperreflective region detected near the retinal vascular structure. The available image does not
  allow reliable determination of whether this represents hemorrhage, artifact, or another abnormality.
  Specialist review is recommended."
- Never: "blood clot", "you have X", "diagnosed with", "guaranteed", "100% accurate", "definitely healthy".
  The pipeline's safety validator scans output text for these patterns and rejects the result if found.

## Heatmaps / explainability

Not yet implemented (requires segmentation component). When added, overlays will be labeled
"AI-highlighted region" and documented as attention visualization, not proof of diagnosis.
