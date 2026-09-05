/**
 * S6-A/S6-B — real-world model CANDIDATE dossiers.
 *
 * HARD RULE: nothing in this file is installed, registered, or runnable.
 * These entries are NEVER inserted into `MODELS` (lib/models/registry.ts),
 * never given weights on disk, never referenced by lib/analysis/pipeline.ts,
 * and never used to produce a Finding. They exist purely as documented,
 * human-reviewable due-diligence records for models a human maintainer could
 * consider installing in a future, explicitly authorized phase.
 *
 * Every dossier below reflects real, publicly documented projects
 * (researched via web search on 2026-09-02 - see `sources`), not a
 * fabricated or hypothetical model. Populating this file is NOT the same as
 * clearing a model for use: every entry's `status` is "CANDIDATE_ONLY" and
 * every entry documents concrete, unresolved blockers under
 * `unresolved_blockers` that a human must clear before any installation
 * could even be considered (license review, artifact integrity, prospective/
 * external validation, patient-level split confirmation, etc.).
 *
 * See docs/MODEL_INTEGRATION.md and docs/MODEL_GOVERNANCE.md.
 */

export type CandidateStatus = "CANDIDATE_ONLY";

export interface CandidateModelDossier {
  candidate_id: string;
  model_name: string;
  version_or_release: string;
  source: string;              // canonical repository/publication URL
  license: string;
  license_compatible_for_commercial_clinical_use: boolean | "UNKNOWN";
  modality: string[];
  intended_task: string;
  input_requirements: string;
  output_format: string;
  training_dataset: string;
  validation_dataset: string;
  patient_level_split_confirmed: boolean | "UNKNOWN";
  external_validation_performed: boolean | "UNKNOWN";
  known_limitations: string[];
  demographic_coverage: string;
  device_coverage: string;
  preprocessing_requirements: string;
  inference_runtime: string;
  hardware_requirements: string;
  model_weights_integrity_hash: string | null;   // null for an uninstalled candidate; populated ONLY once an artifact has actually been downloaded to scratch/ and independently hashed (S9)
  security_considerations: string[];
  evidence_quality: "none" | "single_publication" | "peer_reviewed" | "prospective_multi_site";
  clinical_claims: string;
  unresolved_blockers: string[];
  status: CandidateStatus;
  sources: string[];
  researched_at: string;
  /**
   * S7 - checkpoint acquisition + environment status (optional; only
   * populated for a candidate that actually reached an S7 acquisition
   * attempt). Recording "blocked" here is itself a real, useful audit trail
   * entry - it is NOT the same as an installed artifact, and none of these
   * fields ever imply the candidate may be used.
   */
  checkpoint_status?: {
    acquisition_state: "NOT_ATTEMPTED" | "BLOCKED_GATED_ACCESS" | "BLOCKED_NO_LICENSE" | "ACQUIRED";
    artifact_filename: string | null;
    artifact_size_bytes: number | null;
    checkpoint_format: string | null;
    sha256: string | null;
    installed_at: string | null;
    blocker_detail: string;
    checked_at: string;
  };
  /** S7 - Python/ML-runtime readiness at the time this dossier was reviewed (independent of checkpoint acquisition). */
  environment_review?: {
    venv_path: string;
    python_version: string;
    packages: Record<string, string>;
    cpu_only: boolean;
    reviewed_at: string;
  };
}

export const CANDIDATE_MODEL_DOSSIERS: CandidateModelDossier[] = [
  {
    candidate_id: "retfound-mae",
    model_name: "RETFound (Vision Foundation Model for retinal/OCT imaging)",
    version_or_release: "openmedlab/RETFound_MAE (public release)",
    source: "https://github.com/openmedlab/RETFound_MAE",
    license: "CC-BY-NC-4.0 (non-commercial)",
    license_compatible_for_commercial_clinical_use: false,
    modality: ["FUNDUS", "OCT"],
    intended_task: "Self-supervised foundation model (masked-autoencoder pretraining) intended as a BACKBONE for downstream fine-tuned task heads (e.g. DR grading, glaucoma detection) - it is not itself a finding-producing classifier.",
    input_requirements: "Fundus color photographs and/or OCT B-scans; exact preprocessing (resolution, normalization) defined by the reference implementation, not independently verified here.",
    output_format: "Learned image embeddings only, from the published checkpoint; a finding-level output requires a separately trained, separately validated task head that does not ship with this repository.",
    training_dataset: "~1.6 million retinal images sourced from NHS clinical data plus public datasets, per the publishing institution's own description.",
    validation_dataset: "Downstream task validation is reported per fine-tuned application in the associated publications, not for the foundation model itself.",
    patient_level_split_confirmed: "UNKNOWN",
    external_validation_performed: "UNKNOWN",
    known_limitations: [
      "Foundation/backbone model only - produces no clinical finding on its own.",
      "Any downstream task head built on it would need its own independent dataset, patient-level split, and validation - none of that transfers automatically from the backbone's provenance.",
      "License is non-commercial - blocks any commercial clinical deployment outright without a separate agreement.",
    ],
    demographic_coverage: "Not independently confirmed for this deployment's target population; NHS-sourced pretraining data demographic breakdown not verified from primary sources during this dossier's research.",
    device_coverage: "Not documented per-device in the sources reviewed.",
    preprocessing_requirements: "Reference implementation-specific (see repository); would need independent re-implementation review before use.",
    inference_runtime: "PyTorch (per repository); GPU recommended for the full model size.",
    hardware_requirements: "GPU recommended; exact VRAM/throughput not benchmarked for this deployment.",
    model_weights_integrity_hash: null,
    security_considerations: [
      "Public checkpoints are typically distributed as PyTorch .pth/.pt files - these can execute arbitrary code via pickle deserialization unless loaded with weights_only=True (or an equivalent safe-loading path) and the checksum is verified against a source the maintainer trusts.",
      "No independent security review of the published artifact has been performed for this dossier.",
    ],
    evidence_quality: "peer_reviewed",
    clinical_claims: "Publishing institution frames this as a research foundation model for downstream ophthalmic AI development, not as a validated diagnostic device.",
    /**
     * S7 human decision (2026-09-02): explicitly authorized to proceed with
     * this candidate SCOPED STRICTLY to internal, non-commercial research
     * use, consistent with its actual CC-BY-NC-4.0 license - never as a path
     * to production clinical deployment, and never bypassing Gate A. This
     * does not change any other blocker below.
     */
    unresolved_blockers: [
      "Non-commercial license permits research/internal use only (explicitly authorized for that scope, S7) - still blocks ANY commercial or clinical-deployment use without a separate agreement.",
      "No finding-producing task head exists to actually evaluate for this platform's intended use - would require a full additional training/validation effort this platform cannot perform (no labeled ophthalmic training data, no training compute).",
      "S7 CHECKPOINT DOWNLOAD BLOCKED: every RETFound HuggingFace repository (natureCFP, natureOCT, meh, shanghai, dinov2 variants) is a GATED repo (confirmed via the HF API - \"gated\": \"auto\", HTTP 401 without authentication). Downloading requires a HuggingFace account that has submitted an access request (name/affiliation/job title) and been granted access. No credentials for this were available to complete the download in this session - see docs/MODEL_INTEGRATION.md 'Checkpoint acquisition status'.",
      "No artifact hash can be recorded because the checkpoint could not be downloaded (see blocker above).",
      "No patient-level-split confirmation obtained from primary sources for this dossier.",
    ],
    /**
     * S7 RESOLVED (2026-09-02): the Python-runtime blocker recorded at S6 is
     * no longer accurate and has been removed from the list above. An
     * isolated, project-scoped venv (D:\AI EYE ANALYSIS PLATFORM\.venv-ophthalmic,
     * never global/user site-packages) was created and verified with
     * CPU-only PyTorch 2.14.0+cpu, torchvision 0.29.0+cpu, numpy 2.5.2,
     * pillow 12.3.0 - a real `import torch` + CPU tensor operation was
     * executed and passed. See lib/models/pythonBridgeProvider.ts and
     * tests/s7-python-bridge.test.ts, which probe this live environment
     * with no mocking. This resolves the ENVIRONMENT blocker only; the
     * checkpoint-access blocker above is unrelated and still open.
     */
    status: "CANDIDATE_ONLY",
    sources: ["https://github.com/openmedlab/RETFound_MAE", "https://github.com/rmaphoh/RETFound"],
    researched_at: "2026-09-02",
    checkpoint_status: {
      acquisition_state: "BLOCKED_GATED_ACCESS",
      artifact_filename: "RETFound_mae_natureCFP.pth", // confirmed via HF API file listing - NOT downloaded
      artifact_size_bytes: null, // repo storage ~3.68 GiB total (HF API usedStorage: 3952489221 bytes) - per-file size not confirmed since the file could not be fetched
      checkpoint_format: "PyTorch pickle-based state dict (.pth) - safe loading requires torch.load(..., weights_only=True); no safe-format (e.g. safetensors) alternative was found published for this candidate",
      sha256: null,
      installed_at: null,
      blocker_detail:
        "https://huggingface.co/api/models/YukunZhou/RETFound_mae_natureCFP returns \"gated\": \"auto\"; a direct HTTP request for the weight file returns 401 with x-error-code: GatedRepo (\"Access to model ... is restricted. You must have access to it and be authenticated to access it.\"). " +
        "Access requires a HuggingFace account that has submitted an access request (First Name, Last Name, Affiliation, Job title) and been granted access by the repository owner. All sibling checkpoints under the same author (natureOCT, meh, shanghai, dinov2 variants) are gated identically. " +
        "No HuggingFace account/credentials were available in this session to complete the request, so no bytes were downloaded and no hash could be computed.",
      checked_at: "2026-09-02",
    },
    environment_review: {
      venv_path: "D:\\AI EYE ANALYSIS PLATFORM\\.venv-ophthalmic",
      python_version: "3.12.10 (Windows, isolated venv - base install C:\\Users\\pc\\AppData\\Local\\Programs\\Python\\Python312)",
      packages: { torch: "2.14.0+cpu", torchvision: "0.29.0+cpu", numpy: "2.5.2", pillow: "12.3.0" },
      cpu_only: true, // torch.cuda.is_available() == False; machine GPU is AMD Radeon integrated graphics (no CUDA)
      reviewed_at: "2026-09-02",
    },
  },
  {
    candidate_id: "denet-glaucoma-refuge",
    model_name: "DENet (Disc-aware Ensemble Network) for glaucoma screening / optic disc-cup segmentation",
    version_or_release: "HzFu/DENet_GlaucomaScreen (research code release)",
    source: "https://github.com/HzFu/DENet_GlaucomaScreen",
    license: "CONFIRMED NONE - re-verified 2026-09-02 (S7): the repository contains no LICENSE file and the README states no usage terms beyond a citation request. No license means default 'all rights reserved' copyright applies; use requires contacting the author directly. This is now a HARDER blocker than 'unconfirmed' - it is confirmed absent.",
    license_compatible_for_commercial_clinical_use: false,
    modality: ["FUNDUS"],
    intended_task: "Optic disc/cup segmentation and glaucoma-screening classification from color fundus photographs, trained/evaluated on the ORIGA and REFUGE challenge datasets.",
    input_requirements: "Color fundus photographs; specific crop/normalization defined by the reference implementation.",
    output_format: "Disc/cup segmentation masks plus a glaucoma-screening score, per the associated publication.",
    training_dataset: "ORIGA dataset.",
    validation_dataset: "REFUGE challenge dataset (a public glaucoma-screening benchmark).",
    patient_level_split_confirmed: "UNKNOWN",
    external_validation_performed: "UNKNOWN",
    known_limitations: [
      "Single-institution research code release - no evidence of prospective or multi-site external validation was found for this dossier.",
      "Cup-to-disc ratio / optic-disc appearance ALONE never establishes glaucoma clinically - this platform's own existing condition taxonomy (lib/clinical/conditions.ts) already encodes that requirement (IOP, visual fields, RNFL analysis all also needed), and this candidate provides none of those other modalities.",
      "Benchmark-era code (REFUGE challenge dates to ~2018-2020); no evidence of maintenance against newer imaging devices found.",
    ],
    demographic_coverage: "Not documented in the sources reviewed for this dossier.",
    device_coverage: "Not documented in the sources reviewed for this dossier.",
    preprocessing_requirements: "Reference implementation-specific; not independently reviewed.",
    inference_runtime: "Not confirmed (likely a Keras/TensorFlow or Caffe-era research codebase based on publication date; requires direct repository inspection before any further step).",
    hardware_requirements: "Not benchmarked.",
    model_weights_integrity_hash: null,
    security_considerations: [
      "Provenance/maintenance status of this repository was not independently verified beyond the search results used for this dossier - older, single-maintainer research repositories carry higher supply-chain risk (unclear provenance of any pretrained weights offered for download).",
      "S7 re-verification: pretrained weights are NOT hosted in the repository itself - the README points to OneDrive/BaiduPan links for 5 separate model files. Third-party file-hosting links carry materially higher supply-chain risk than a repository-hosted or HuggingFace-hosted release (no cryptographic provenance chain from the publishing institution to the file, easier for a link to be silently swapped or go stale/hijacked).",
    ],
    evidence_quality: "single_publication",
    clinical_claims: "Presented in its source publication as a research screening tool, not a diagnostic device.",
    /**
     * S7 re-verification (2026-09-02): fetched the repository directly.
     * Confirmed no LICENSE file exists and weights are hosted off-repository
     * on consumer file-sharing services. This candidate is now considered
     * LESS viable than at initial S6 research, not merely "unconfirmed" -
     * it remains CANDIDATE_ONLY and is not the recommended path forward.
     */
    unresolved_blockers: [
      "CONFIRMED no license (not merely unconfirmed) - default all-rights-reserved copyright applies; would require directly contacting the author for any grant of rights before further evaluation.",
      "No external/prospective validation evidence found.",
      "Provides only one of several modalities (optic disc/fundus) this platform's own taxonomy already says are individually insufficient for a glaucoma determination.",
      "No artifact hash recorded - nothing downloaded or reviewed - and any future hash would be computed against an unverified third-party (OneDrive/BaiduPan) file, not a source-controlled release artifact.",
    ],
    status: "CANDIDATE_ONLY",
    sources: ["https://github.com/HzFu/DENet_GlaucomaScreen"],
    researched_at: "2026-09-02",
  },
  {
    candidate_id: "aptos2019-community-dr-grading",
    model_name: "APTOS 2019 Blindness Detection - community competition solutions (diabetic retinopathy severity grading)",
    version_or_release: "multiple independent community repositories (e.g. top ~2-3% leaderboard placements)",
    source: "e.g. https://github.com/4uiiurz1/kaggle-aptos2019-blindness-detection ; https://github.com/MamatShamshiev/Kaggle-APTOS-2019-Blindness-Detection",
    license: "UNKNOWN / not formally granted for redistribution in the repositories reviewed - these are competition submission archives, not licensed software releases.",
    license_compatible_for_commercial_clinical_use: false,
    modality: ["FUNDUS"],
    intended_task: "5-class diabetic retinopathy severity grading (no DR / mild / moderate / severe / proliferative), fine-tuned CNNs (e.g. EfficientNet, SE-ResNeXt) on the APTOS 2019 Kaggle dataset.",
    input_requirements: "Color fundus photographs, competition-specific preprocessing (varies per repository).",
    output_format: "A single ordinal severity class or regression score per image; no localization, no measurements.",
    training_dataset: "APTOS 2019 (Kaggle competition dataset).",
    validation_dataset: "Held-out competition validation/leaderboard split, occasionally cross-evaluated against Messidor-2 in follow-up research (not the competition code itself).",
    patient_level_split_confirmed: "UNKNOWN",
    external_validation_performed: "UNKNOWN",
    known_limitations: [
      "Competition-submission code, not a maintained software release - no formal support, no guaranteed reproducibility of the exact reported score.",
      "The APTOS 2019 Kaggle competition's own terms restrict commercial use and redistribution of the dataset (and, by extension, weights trained directly on it) - this alone is a hard licensing blocker independent of any repository's own (usually absent) LICENSE file.",
      "No independent, prospective, or multi-device external validation found for any of the reviewed repositories.",
      "Image-level vs. patient-level split practice varies by competition entry and was not independently confirmed for any specific repository during this dossier's research.",
    ],
    demographic_coverage: "APTOS 2019 was collected in India (Aravind Eye Hospital); coverage of other populations/devices not established.",
    device_coverage: "Not documented per-repository.",
    preprocessing_requirements: "Repository-specific (typically: crop-to-circle, resize, normalize); not standardized across entries.",
    inference_runtime: "PyTorch (most reviewed entries).",
    hardware_requirements: "GPU recommended for training; single-image inference is comparatively lightweight but not benchmarked here.",
    model_weights_integrity_hash: null,
    security_considerations: [
      "Community competition repositories are the highest supply-chain-risk category considered in this dossier set - no formal release process, no guaranteed provenance chain for any weights a maintainer might later choose to download.",
    ],
    evidence_quality: "none",
    clinical_claims: "None of the reviewed repositories present themselves as clinically validated - they are competition entries.",
    unresolved_blockers: [
      "Kaggle/APTOS competition terms restrict commercial redistribution/use - a fundamental blocker independent of any specific repository.",
      "No external validation evidence found for any specific candidate repository.",
      "No artifact hash recorded - nothing downloaded or reviewed.",
      "No single canonical, maintained repository identified - 'the model' is really a class of independently trained community models with materially different weights and unverified provenance.",
    ],
    status: "CANDIDATE_ONLY",
    sources: [
      "https://github.com/4uiiurz1/kaggle-aptos2019-blindness-detection",
      "https://github.com/MamatShamshiev/Kaggle-APTOS-2019-Blindness-Detection",
    ],
    researched_at: "2026-09-02",
  },
  // ---------------------------------------------------------------------
  // S8 (2026-09-02) - non-gated, task-specific candidates. Full due-
  // diligence (independent license/security/clinical-evidence audits,
  // cross-checked with the two-agent verification rule) lives in
  // docs/S8_MODEL_DISCOVERY.md; these entries carry the audited summary.
  // ---------------------------------------------------------------------
  {
    candidate_id: "monai-retinaloct-rpd-segmentation",
    model_name: "MONAI retinalOCT_RPD_segmentation (reticular pseudodrusen / AMD biomarker segmentation)",
    version_or_release: "Project-MONAI/model-zoo bundle, mirrored at huggingface.co/MONAI/retinalOCT_RPD_segmentation",
    source: "https://huggingface.co/MONAI/retinalOCT_RPD_segmentation",
    license: "BSD 2-Clause (c) uw-biomedical-ml - verified directly by reading the repository's LICENSE file; text matches standard 2-clause redistribution/attribution/disclaimer terms. Explicitly permits commercial use and redistribution with attribution.",
    license_compatible_for_commercial_clinical_use: true, // license itself permits it; CLINICAL use remains blocked by validation/regulatory status regardless, see unresolved_blockers
    modality: ["OCT"],
    intended_task: "Segments reticular pseudodrusen (RPD), an AMD biomarker, in OCT B-scans; a narrower, well-scoped task (not a general disease classifier).",
    input_requirements: "OCT B-scans, Heidelberg Spectralis-acquired in the source study (device generalization untested per authors).",
    output_format: "5-fold ensemble segmentation output; a per-scan AUC-style detection score was reported in validation, not just a raw mask.",
    training_dataset: "LEAD study: 9,800 B-scans, 200 eyes, 100 individuals.",
    validation_dataset: "Internal test: 250 B-scans / 125 eyes / 92 individuals (disjoint from the 100 training individuals). External test: 5 independent cohorts, 1,017 eyes / 812 individuals total (MACUSTAR, NICOLA, University of Washington, University of Bonn, Montrachet).",
    patient_level_split_confirmed: true, // explicitly confirmed by independent audit - development split at individual level, internal test drawn from a disjoint individual set
    external_validation_performed: true, // 5 independent institutions/cohorts, none overlapping training data - confirmed genuine external validation, not merely cross-dataset-within-training-pool
    known_limitations: [
      "Single-device training/validation only (Heidelberg Spectralis) - generalization to other OCT devices is explicitly untested by the authors.",
      "Training ground truth from a single grader (supervised by two senior investigators) - not multi-grader adjudicated; internal/external test sets used 2-4 specialist graders.",
      "Cannot assess image-ungradable scans; excludes late-AMD eyes; provides no lesion-extent quantification.",
      "A narrow single-biomarker task (RPD only) - not a general AMD/OCT abnormality classifier; would need to be paired with other models for broader OCT coverage.",
    ],
    demographic_coverage: "5-cohort external validation spans multiple countries (Germany, Northern Ireland, US, France, multi-center Europe) - the strongest demographic/geographic diversity of any candidate reviewed in S6-S8, though still not exhaustively documented per protected demographic category.",
    device_coverage: "Heidelberg Spectralis only - explicitly and honestly disclosed by the authors as untested on other devices.",
    preprocessing_requirements: "Not independently reviewed beyond the bundle's own documented pipeline (MONAI Bundle config-driven preprocessing).",
    inference_runtime: "PyTorch via MONAI (Mask-RCNN, ResNeXt-101-32x8d-FPN backbone).",
    hardware_requirements: "Authors cite ~3GB GPU / 6GB RAM on an A100 for inference; CPU-only feasibility on this deployment's hardware is UNKNOWN (Mask-RCNN ensembles are typically slow on CPU) - must be benchmarked before relying on it for interactive use.",
    model_weights_integrity_hash: null,
    security_considerations: [
      "S8 independent security audit: weights are pickle-based .pth files ONLY (fold1-fold5 model_final.pth) - no safetensors alternative offered. torch.load(..., weights_only=True) is MANDATORY for any future load - never weights_only=False.",
      "This is a full MONAI Bundle shipping custom executable Python (inference.py, Ensembler.py, analysis_lib.py) alongside its config - running the bundle's own documented pipeline via standard monai.bundle tooling executes repo-supplied code, a materially larger and different risk than a plain state-dict load. A future integration must load only the raw tensor weights into an independently-authored, separately-reviewed model definition - never execute the bundle's own inference/ensembler scripts unreviewed.",
      "Provenance flag: the HF repo's author field shows 'MONAI' (matching the official org name) but the audit found 0 downloads and no visible verification badge at audit time - the 'official MONAI org' identity should be independently reconfirmed (e.g. cross-checked against the Project-MONAI GitHub model-zoo listing, which was also checked and does list this bundle) before treating provenance as fully settled.",
    ],
    evidence_quality: "prospective_multi_site", // 5 independent external cohorts is the strongest evidence tier among all S6-S8 candidates reviewed
    clinical_claims: "Presented in its associated preprint as a research biomarker-detection tool with genuine external validation; not presented as, and not usable as, a diagnostic device.",
    unresolved_blockers: [
      "SECURITY: pickle-only checkpoint format + bundled executable inference code (not just a state dict) - requires a from-scratch, independently-authored, security-reviewed loading/inference path before any use; the bundle's own scripts must not be executed as-is.",
      "CPU feasibility for this deployment's hardware (15.3GB RAM, no GPU) is UNKNOWN and must be benchmarked - Mask-RCNN ensembles are GPU-oriented and may be impractically slow or memory-heavy on CPU-only inference.",
      "Single-device (Heidelberg Spectralis) training/validation - any image from a different OCT device is out-of-distribution for this model by the authors' own disclosure; the existing OOD/image-suitability gate (lib/analysis/imageSuitability.ts) would need real device-metadata matching to enforce this, which does not exist yet.",
      "Narrow single-biomarker scope (RPD/AMD only) - does not by itself constitute general OCT disease detection.",
      "No artifact has been downloaded; SHA-256 not yet computed.",
    ],
    status: "CANDIDATE_ONLY",
    sources: [
      "https://huggingface.co/MONAI/retinalOCT_RPD_segmentation",
      "https://github.com/Project-MONAI/model-zoo",
      "https://www.medrxiv.org/content/10.1101/2024.09.11.24312817v1.full",
      "https://pmc.ncbi.nlm.nih.gov/articles/PMC12886592/",
    ],
    researched_at: "2026-09-02",
  },
  {
    candidate_id: "segformer-optic-disc-cup-refuge",
    model_name: "SegFormer optic disc/cup segmentation (REFUGE-trained)",
    version_or_release: "pamixsun/segformer_for_optic_disc_cup_segmentation (Hugging Face)",
    source: "https://huggingface.co/pamixsun/segformer_for_optic_disc_cup_segmentation",
    license: "Apache-2.0 (HF model-card tag, verified directly).",
    license_compatible_for_commercial_clinical_use: true, // license permits it; CLINICAL use remains blocked by total absence of validation evidence, see unresolved_blockers
    modality: ["FUNDUS"],
    intended_task: "3-class semantic segmentation (background/optic disc/cup) on color fundus photographs; a CDR value would need to be computed downstream from the mask, not produced directly.",
    input_requirements: "Color fundus photographs.",
    output_format: "Segmentation mask (disc/cup regions), from which cup-to-disc ratio could be deterministically computed - the model itself does not output a CDR number.",
    training_dataset: "REFUGE challenge dataset (1,200 fundus images), CC BY 4.0 (permissive, citation-only requirement).",
    validation_dataset: "UNKNOWN - no held-out evaluation is reported anywhere on the model card or in any linked material.",
    patient_level_split_confirmed: "UNKNOWN",
    external_validation_performed: false, // confirmed by independent audit: zero validation evidence of any kind exists for this specific checkpoint
    known_limitations: [
      "ZERO published metrics (no Dice/IoU, no citation, model card literally shows '[More Information Needed]') - independently confirmed by a dedicated clinical-evidence audit, not merely an unsurfaced gap.",
      "Uploader identity ('pamixsun'/'Xu Sun') is not independently confirmed - a same-named individual appears among REFUGE 2018 challenge co-authors, but the match to this specific uploader could not be verified.",
      "No linked paper, training repository, or reproducibility artifact exists.",
    ],
    demographic_coverage: "UNKNOWN - REFUGE's own demographic breakdown not independently re-verified in this dossier.",
    device_coverage: "UNKNOWN.",
    preprocessing_requirements: "Standard transformers image preprocessing (SegformerImageProcessor: resize 512, ImageNet mean/std normalization, bilinear resample) - confirmed S9 by reading preprocessor_config.json directly; no undocumented/custom preprocessing exists.",
    inference_runtime: "PyTorch via transformers (native SegformerForSemanticSegmentation class - no custom/trust_remote_code required). S9: real end-to-end inference verified working, CPU-only, torch 2.14.0+cpu, transformers 5.16.1.",
    hardware_requirements: "~47.2M parameters. S9 BENCHMARKED (real, not estimated): model load ~0.4s, single-image CPU inference ~1.0-1.9s, total pipeline latency (cold Python import + load + preprocess + inference + postprocess) 6.3-11.3s on this deployment's hardware (15.3GB RAM, no GPU). Confirms EASY CPU feasibility.",
    model_weights_integrity_hash: "22e45131b64eb07a5d29a2e5388a7709d10696b13f48d2d0cdcf56cafa1f9ea5", // S9: sha256 of model.safetensors, computed independently and cross-verified against HuggingFace's own recorded LFS sha256 (exact match)
    security_considerations: [
      "S8 independent security audit: BOTH model.safetensors AND pytorch_model.bin are present in the repo - the safetensors file must be loaded explicitly (AutoModel.from_pretrained(..., use_safetensors=True)); the pickle-based .bin sibling must never be loaded.",
      "No custom code / trust_remote_code required - a native, built-in transformers architecture class handles this model, the lowest code-execution risk among all S6-S8 candidates reviewed.",
      "Uploader is an unverified individual account (478 downloads, last modified Sept 2023 - over 2 years stale at audit time) - moderate provenance risk, mitigated by the absence of any custom-code execution surface.",
      "S9: only config.json, preprocessor_config.json, and model.safetensors were downloaded - pytorch_model.bin was never fetched, eliminating the pickle-deserialization surface entirely for this deployment's copy of the artifact.",
      "S9 SAFETY FINDING: the raw model has NO internal rejection of degenerate/unsuitable inputs - a 1x1 pixel image, an all-black image, an all-white image, and an extreme-aspect-ratio image were all fed to the real loaded model and every one produced a numerically valid (no NaN/Inf) but meaningless segmentation without any error or warning. Upstream quality/OOD/image-suitability gating (lib/analysis/imageSuitability.ts) is therefore MANDATORY, not optional, for any future integration - the model provides no safety net of its own.",
    ],
    evidence_quality: "none", // confirmed genuinely zero, not merely unsurfaced
    clinical_claims: "None made anywhere in available materials - the model card contains no clinical framing at all, consistent with the complete absence of validation evidence.",
    unresolved_blockers: [
      "COMPLETE ABSENCE OF VALIDATION EVIDENCE - no Dice/IoU, no test set, no comparison to expert graders. This is the weakest-evidence candidate reviewed across S6-S8; any use would require this platform to perform its own from-scratch benchmarking (e.g. against DRISHTI-GS or RIM-ONE, per the fundus research agent's suggestion) before treating its output as meaningful at all. S9's own real-inference run on a generic (non-REFUGE) fundus photo produced an anatomically implausible result (segmented 'cup' area larger than 'disc' area) - concrete, first-hand evidence the model's real-world behavior on out-of-distribution images is unreliable, consistent with its zero published validation.",
      "Uploader identity/authorization to publish is not independently confirmed.",
      "S9: artifact acquired to scratch/models/segformer-optic-disc-cup-refuge/ (gitignored, NOT data/models/, NOT committed). SHA-256 computed and verified against HuggingFace's own record. Real CPU inference demonstrated working. This remains CANDIDATE_ONLY - no registry entry was created, nothing is reachable by the live pipeline, Gate A remains CLOSED.",
    ],
    status: "CANDIDATE_ONLY",
    sources: [
      "https://huggingface.co/pamixsun/segformer_for_optic_disc_cup_segmentation",
      "https://huggingface.co/api/models/pamixsun/segformer_for_optic_disc_cup_segmentation",
    ],
    researched_at: "2026-09-02",
  },
  {
    candidate_id: "clementp-fundus-dr-grading-efficientnet",
    model_name: "FundusDRGrading EfficientNet-B0 (diabetic retinopathy severity grading)",
    version_or_release: "ClementP/FundusDRGrading-efficientnet_b0 (Hugging Face)",
    source: "https://huggingface.co/ClementP/FundusDRGrading-efficientnet_b0",
    license: "MIT (HF model-card tag on the weights page, verified directly) - but S8 legal audit found this likely covers only the wrapper/packaging, not a clearance of the underlying training-data restrictions (see unresolved_blockers). Classified REVIEW_REQUIRED, not PASS, by the independent license audit.",
    license_compatible_for_commercial_clinical_use: "UNKNOWN", // MIT tag says yes; APTOS/EyePACS training-data terms say non-commercial/no-redistribution - genuinely unresolved, not optimistically assumed either way
    modality: ["FUNDUS"],
    intended_task: "5-class diabetic retinopathy severity grading (no DR / mild / moderate / severe / proliferative).",
    input_requirements: "Color fundus photographs.",
    output_format: "Single ordinal severity class.",
    training_dataset: "Pooled APTOS 2019 + EyePACS + DDR + IDRiD.",
    validation_dataset: "Each dataset's own held-out test partition (EyePACS, IDRiD, DDR) - evaluated per-dataset, not on a cohort excluded from the entire training pool.",
    patient_level_split_confirmed: "UNKNOWN", // no explicit patient-level de-duplication statement found; risk of image-level leakage cannot be ruled out
    external_validation_performed: false, // independently confirmed: per-dataset internal test partitions only, not true external validation on a fully held-out-from-training cohort
    known_limitations: [
      "Reported metric is quadratic kappa ONLY (EyePACS 0.751, IDRiD 0.751, DDR 0.712) - no sensitivity, specificity, PPV, NPV, AUROC, AUPRC, or calibration reported anywhere, including the author's own related papers.",
      "Validation is internal per-dataset (same pool as training), not genuine external validation - independently confirmed weaker than the MONAI RPD candidate's multi-institution external validation.",
      "APTOS 2019's own dataset terms state 'Competition Use and Non-Commercial & Academic Research' (explicitly non-commercial); EyePACS's Kaggle terms do not permit redistribution of the raw data. Two of the four training datasets carry restrictions the MIT weights-license tag does not obviously clear.",
      "No ground-truth/grading-methodology disclosure (single grader vs. adjudicated) found on the model card.",
    ],
    demographic_coverage: "UNKNOWN - inherits whatever the 4 pooled public datasets cover; not independently re-verified in this dossier.",
    device_coverage: "UNKNOWN.",
    preprocessing_requirements: "Standard transformers/EfficientNet preprocessing pipeline (author also publishes a companion `fundus-data-toolkit` package).",
    inference_runtime: "PyTorch via transformers (EfficientNet-B0, ~4.05M params - small).",
    hardware_requirements: "Very small model; CPU inference is very likely feasible, though not yet benchmarked on this deployment.",
    model_weights_integrity_hash: null,
    security_considerations: [
      "S8 independent security audit: BOTH model.safetensors AND pytorch_model.bin are present - the safetensors file must be loaded explicitly; the pickle-based .bin sibling must never be loaded.",
      "No custom code / trust_remote_code required - native transformers EfficientNet class.",
      "Uploader is an unverified individual account (moderate usage: 576 downloads, last modified June 2024) - not institutionally vetted.",
    ],
    evidence_quality: "single_publication",
    clinical_claims: "None explicit beyond the reported kappa scores; not presented as a validated diagnostic tool.",
    unresolved_blockers: [
      "LICENSE AMBIGUITY: the MIT tag on the weights does not obviously clear APTOS's explicit non-commercial terms or EyePACS's no-redistribution terms for the underlying training data - a human legal reviewer should resolve this before any use beyond the currently-authorized internal, non-commercial research/evaluation scope (S8 legal audit: REVIEW_REQUIRED, not PASS).",
      "No sensitivity/specificity/AUROC/calibration reported - kappa alone is insufficient evidence for any clinical framing.",
      "Validation is internal-only (same pool as training) - not externally validated by any strict definition.",
      "Patient-level split not confirmed - image-level leakage cannot be ruled out.",
      "No artifact has been downloaded; SHA-256 not yet computed.",
    ],
    status: "CANDIDATE_ONLY",
    sources: [
      "https://huggingface.co/ClementP/FundusDRGrading-efficientnet_b0",
      "https://github.com/ClementPla/fundus-data-toolkit",
    ],
    researched_at: "2026-09-02",
  },
];

export const CANDIDATE_MODEL_DOSSIER_MAP: Record<string, CandidateModelDossier> = Object.fromEntries(
  CANDIDATE_MODEL_DOSSIERS.map((d) => [d.candidate_id, d])
);
