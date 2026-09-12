# Phase 5 DR candidate inventory

Status: research due diligence only. No entry in this inventory is installed,
registered, or reachable from the live analysis provider map. A published
metric is not a local reproduction and a permissive source-code license does
not grant rights to the training data or weights.

Research date: 2026-09-13. Search scope: public local fundus DR classifiers,
retinal foundation models with task-specific DR paths, and CPU/ONNX releases.
Candidates were screened for a canonical source, artifact identity,
preprocessing reproducibility, task semantics, validation evidence, and
practical CPU execution on the target Windows host.

## Screening table

| Candidate ID | Repository / artifact | Format and size | License state | Datasets / reported evidence | Architecture / input / preprocessing | CPU and security review | Phase 5 decision |
|---|---|---|---|---|---|---|---|
| `retguard-dr-v1.0.0` | [anchor-neuro/retguard](https://github.com/anchor-neuro/retguard); release asset `retguard-dr-v1.0.0.zip` at the [v1.0.0 release](https://github.com/anchor-neuro/retguard/releases/tag/v1.0.0) | ONNX member reported as 204,707,438 bytes; publisher-reported member SHA-256 `f0e19fa86d5a27a05731550d1d6708c01f6f363f45a1fa57849de988f91e775b`; not downloaded or locally verified | Source code PolyForm Noncommercial 1.0.0; weights and companion material CC BY-NC 4.0; commercial use requires a separate agreement | Maintainer reports Messidor-2 zero-shot `n=1,744`, AUC 0.9691, sensitivity 0.9716, specificity 0.7607. No local reproduction, target-camera validation, or prospective validation in this checkout | Task-specific referable-DR ONNX module; exact model-card preprocessing and output semantics require a controlled reimplementation review; no general VLM | Repository states CPU-only ONNX Runtime support. Local RAM/latency is not measured. Published README discloses calibration ECE above its own gate and a failed ONNX logit-parity check; release/install provenance still requires review | **REJECTED for registration; CANDIDATE_ONLY for separately authorized noncommercial research.** License, calibration, export-parity, and no-local-head-to-head blockers remain |
| `abssnet-dr-v1` | [guptapradeep85/ABSSNET](https://github.com/guptapradeep85/ABSSNET); checkpoints are described under the repository `models/` directory | PyTorch `.pth`, approximately 21.2 MB per fold per repository; no locally computed SHA-256 | Repository code is marked MIT; the repository explicitly separates code from third-party images and does not establish commercial rights for data-derived weights | APTOS-derived 3,662-image five-class set; repository reports 5-fold means accuracy 0.7026, macro-F1 0.5206, QWK 0.7933, AUC 0.8862. Referable sensitivity/specificity are not reported in the reviewed summary and were not derived here | EfficientNet-B0 Noisy Student with CBAM and gated token mixing; five ICDR classes; 224x224; Gaussian/CLAHE and ImageNet normalization paths are code/config dependent and must be frozen exactly | Torch/Python runtime; CPU inference and peak RAM not measured. Weights are not independently hashed; data and preprocessing lineage need review; optional Mamba ablation adds unnecessary CUDA/toolchain surface | **REJECTED for this release; CANDIDATE_ONLY.** No canonical verified artifact, no target-partition result, unresolved dataset/weight rights, and no local CPU evidence |
| `retinalens-efficientnet-b4` | [egwaojeangel/retinalens-ai-diabetic-retinopathy-detection](https://github.com/egwaojeangel/retinalens-ai-diabetic-retinopathy-detection); README says `best_model.pth` is obtained from a Kaggle notebook output | PyTorch `.pth`; artifact URL, size, and SHA-256 are not supplied by the repository | Source repository displays MIT; dataset and learned-weight redistribution rights are not established | README reports 115,241 images from EyePACS, APTOS, and MESSIDOR; validation accuracy 0.649 and macro-F1 0.5879 with per-grade F1. Patient-level separation and external validation are not confirmed | EfficientNet-B4, five severity classes, 260x260 RGB, ImageNet normalization; exact training/inference path depends on an external notebook artifact | CPU feasibility, RAM, exact artifact provenance, and deterministic output contract are unmeasured. Web application and Grad-CAM are not evidence of clinical validity | **REJECTED for this release; CANDIDATE_ONLY.** Artifact cannot be acquired and hashed from a canonical release, the split/rights are unresolved, and no same-data comparison exists |
| `retfound-mae` | [rmaphoh/RETFound](https://github.com/rmaphoh/RETFound) and [openmedlab/RETFound_MAE](https://github.com/openmedlab/RETFound_MAE) | PyTorch checkpoint family, approximately 300M parameters; gated Hugging Face acquisition; no local artifact or hash | CC-BY-NC-4.0/noncommercial in the existing dossier; commercial/clinical deployment blocked | Pretraining is reported on 1.6M retinal images; it is a foundation/backbone release, not a DR classifier with a shipped task head | ViT-Large retinal foundation model; downstream fine-tuning and preprocessing are task-specific; no finding-level output without a separately trained head | GPU-oriented source path; CPU RAM/latency and a task head are not available here. Gated pickle-based checkpoints require safe loading and access review | **REJECTED for this release; CANDIDATE_ONLY.** No task-specific head, gated access, noncommercial scope, artifact hash, or fair comparison |
| `aptos2019-community-dr-grading` | Community APTOS solutions, including [4uiiurz1/kaggle-aptos2019-blindness-detection](https://github.com/4uiiurz1/kaggle-aptos2019-blindness-detection) | Repository-specific PyTorch/checkpoint formats; no single canonical artifact or hash | Unknown/competition and dataset terms; commercial redistribution not established | Competition/leaderboard evidence is not a controlled external validation; patient-level split and exact preprocessing vary by repository | Usually EfficientNet/SE-ResNeXt five-class fundus grading; preprocessing varies | Supply-chain and reproducibility risk is high; CPU and RAM are not established | **REJECTED.** Kept only as a searched category; no promotion path without a specific, licensed, hashed artifact |

## Required acquisition record for any future candidate

Before any candidate can enter the competition runner, a maintainer must
record the immutable repository revision, direct artifact URL, artifact size,
SHA-256 computed from the downloaded bytes, license for both code and weights,
dataset rights, class mapping, input dimensions, exact preprocessing version,
output schema, runtime package lock, CPU latency/RAM, and a three-reviewer
sign-off. A candidate with a publisher-reported digest but no local digest is
still unacquired. A candidate with good benchmark numbers but no task-specific
head is not a DR model.

## Sources and interpretation

The repository pages above are primary project sources for the claims in this
inventory. Their reported metrics remain author-reported until this project
reproduces them on an eligible, patient-separated evaluation partition. No
candidate was downloaded, promoted, or used to generate a VisionScan finding
as part of Phase 5.

