# Calibration and threshold governance

Status: all live models remain **NOT_CALIBRATED**. This document records what
was measured, what was decided, and the exact fixed rules in production, so
no future edit can silently introduce a probability or move a threshold.

## DR grader (single regression logit → grades 0–4)

Fixed rule (pinned from publisher `regression_to_prediction`, never tuned
here): `grade = round_clamp(logit, 0, 4)` with torch banker's rounding;
referable convention `grade >= 2`; any-DR convention `grade >= 1`.
Threshold record: `dr-fixed-round-rule-v1` (model aa5741419b90, objective:
publisher-exact reproduction, sensitivity 0.439/spec 0.991 at referable on
DeepDRiD-val 2026-09-08, version 1, no expiry, never tuned on test).

External 5×5 confusion (DeepDRiD validation, n=400):

```
true\pred    0    1    2    3    4
  0:       162   12    0    0    0
  1:        39    5    2    0    0
  2:        25   34   31    2    0
  3:        12   18   35    3    0
  4:         5    7    8    0    0
```

Grade collapse is structural: true grades 3–4 are predicted as 0–2;
grade 4 is never predicted. Any-DR≥1 misses 81/226 (mostly grade-1→0).

Ranking signal exists: raw-logit AUROC 0.885 (referable) / 0.820 (any-DR)
on validation, 0.879/0.816 overall — the operating point undercalls, the
ordering is informative. This does NOT justify a probability: the logit was
trained with MSE, not as log-odds, so Platt/sigmoid mapping would be a
fabricated semantic. No temperature, isotonic, or Platt fitting was run on
test data; none will be adopted without a locked calibration partition and
a re-validation run. Decision: **remain NOT_CALIBRATED** (measured
rationale, not default).

## Lesion detector (argmax components)

No threshold exists (fixed argmax rule `argmax-components-v1`). No score of
any kind is emitted, so AUROC/AUPRC/ECE/Brier are not applicable (not
missing — inapplicable by construction). Any future scored operating point
must freeze its threshold on a calibration partition with
threshold/dataset/objective/version/date recorded, then lock a test set.
Status: **NOT_CALIBRATED**.

## OCT classifier (backbone argmax)

Fixed rule: `argmax` of 4 backbone logits (`oct-argmax-v1`); the author's
XGBoost hybrid head is not executed; the shipped temperature scalar
(T=1.0504) is reported, never applied. Measured on Kermany test (n=1000,
overlap-disclosed): mean |confidence − correctness| of raw softmax 0.55,
Brier 0.41; with T=1.0504: 0.56/0.43 — temperature does not repair
structural overconfidence of backbone logits, so adopting it would be
cosmetic. Decision: **remain NOT_CALIBRATED** (measured rationale).
Author's ECE 0.0024 claim applies to their hybrid+temperature system, not
to this deployed backbone path — never quoted as ours.

## Display rules (normative)

- Raw logits/scores render as MODEL_SCORE with NOT_CALIBRATED wording.
- The words probability/confidence must never describe model outputs in
  UI, reports, findings, or evidence (enforced by contract tests + the
  safety-claims scan).
- `confidence_calibrated` stays null on every finding until a governed
  calibration record exists in the calibration registry with evidence.
