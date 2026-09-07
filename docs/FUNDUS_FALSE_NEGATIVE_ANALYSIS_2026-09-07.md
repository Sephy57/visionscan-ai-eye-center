# Fundus candidate false-negative / false-positive analysis

Status: **evaluation not run; accuracy not established; model disabled**.

This record exists because a missed visibly abnormal image was explicitly
reported. It does not convert that report into a diagnosis or a measured false
negative. The source image, reference annotation, patient grouping, and
applicable-model output are not present in the current workspace, so the case
is an **unverified reported false-negative candidate**. The platform fix is
still concrete: when the broad detector is absent, triage and report wording
now fail closed and cannot describe an empty finding array as a normal image.

The only local engineering image has a historical offline result: an
unthresholded 16-pixel microaneurysm-like argmax component. Without a reference
mask this is a **possible false-positive candidate**, not a measured false
positive and not a lesion claim. Its old 1024-square coordinates are invalid
for original-image display; they are intentionally not used by the UI.

No sensitivity, specificity, Dice, IoU, AUROC, AUPRC, PPV, NPV, ECE, Brier
score, false-positive count, or false-negative count is reported. Each remains
`null` in the accompanying machine-readable record because:

- no legally cleared patient-keyed independent validation cohort is present;
- the current isolated environment lacks `torchseg`, `timm`, and `einops`;
- no pre-registered component/threshold rule exists;
- training-data downstream rights remain unresolved; and
- the reported abnormal source image is unavailable.

A future evaluation must freeze the artifact, preprocessing, original-image
inverse transform, connected-component rule, and threshold before a locked
patient/eye/visit-separated test. It must report failures by unsupported
pathology, model, threshold, preprocessing, quality, OOD, postprocessing, and
localization cause. Training-source cohorts (DDR, FGADR, IDRiD, MESSIDOR,
RETLES) cannot be called independent without exact non-overlap manifests.

Machine-readable record:
`docs/evaluations/fundus-lesion-candidate-failure-analysis-2026-09-07.json`.
