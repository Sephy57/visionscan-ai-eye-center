# Phase 3 model-validation evidence

Generated from the PHI-minimized exports under docs/evaluations/ by node scripts/model-validation-report.mjs.

| Artifact | Purpose |
|---|---|
| fundus-dr-grading-effb0.md | DR model card, split status, task metrics, calibration boundary |
| fundus-lesions-clementp-unet-seresnext50.md | Lesion model card, pixel metrics, FP-burden limitation |
| oct-retinal-weights-fp32.md | OCT model card, Kermany/Duke split evidence, NORMAL safety |
| validation-summary.json | Machine-readable aggregate evidence |
| dr-failure-registry.json | Hashed referable DR FN/FP registry |
| oct-error-registry.json | Hashed Kermany multiclass error registry |
| lesion-metrics.json | Pixel/detection metrics and explicit FP-burden status |

All statuses remain research-only. No document here grants clinical validation, device approval, diagnostic authority, treatment authority, or permission to report one system-level accuracy number.
