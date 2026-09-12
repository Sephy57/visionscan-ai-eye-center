# Phase 6 candidate-rights dossier

Status: research due diligence only. This dossier is not legal advice and does
not authorize clinical use, redistribution, or commercial deployment.

Review date: 2026-09-13
Reviewer: VisionScan Phase 6 implementation audit
Repository: https://github.com/Sephy57/visionscan-ai-eye-center

## Decision vocabulary

- `RIGHTS_ACCEPTABLE_FOR_LOCAL_RESEARCH`: the reviewed source grants a usable
  noncommercial research permission for the proposed local evaluation, subject
  to attribution and the listed limitations.
- `RIGHTS_RESTRICTED`: local research may be possible, but the source imposes
  material noncommercial, access, redistribution, or downstream-use limits.
- `RIGHTS_UNCLEAR`: the proposed use cannot be cleared from the reviewed
  materials.
- `REJECTED`: the proposed use is incompatible with the reviewed terms or the
  candidate fails a non-rights integrity gate that prevents safe evaluation.

## RetGuard DR v1.0.0

| Field | Review result |
|---|---|
| `candidate_id` | `retguard-dr-v1.0.0` |
| Code license | PolyForm Noncommercial 1.0.0 (`LICENSE.md`) |
| Weights license | CC BY-NC 4.0 (`LICENSE-WEIGHTS.md`) |
| Dataset rights | Mixed and not uniformly established by the publisher: EyePACS/Kaggle, DDR, APTOS, DeepDRiD, and Messidor-2 have access or redistribution limitations; IDRiD is reported as CC BY 4.0. The publisher expressly says several learned-weight and commercial rights require rights-holder review. |
| Commercial use | Not granted; separate written commercial license required. |
| Research use | Noncommercial research/experiment/testing is permitted by the reviewed code and weight terms, subject to the license conditions. |
| Redistribution | Restricted by the noncommercial licenses and attribution/notice obligations; do not redistribute the artifact or derived package without a separate review. |
| Modification | Code changes are allowed for permitted noncommercial purposes under PolyForm; adapted weight/documentation material remains subject to CC BY-NC terms. |
| Publication | Research publication is not prohibited by the reviewed terms; cite the project/preprint and preserve required notices. It does not convert publisher metrics into VisionScan evidence. |
| Required attribution | Cite the RETGUARD preprint and link `https://github.com/anchor-neuro/retguard`; preserve required copyright/license notices. |
| Source URLs | `https://github.com/anchor-neuro/retguard`; `https://github.com/anchor-neuro/retguard/releases/tag/v1.0.0`; `https://github.com/anchor-neuro/retguard/blob/main/LICENSE.md`; `https://github.com/anchor-neuro/retguard/blob/main/LICENSE-WEIGHTS.md`; `https://github.com/anchor-neuro/retguard/blob/main/docs/MODEL_CARD_dr.md` |
| Uncertainties | Training-data learned-weight rights are not independently cleared; target-camera/device rights and validation are absent; public weights are distributed as an ONNX export whose own six-sample logit-parity gate failed; the DR module's calibration exceeds the publisher's stated ECE gate. |
| Decision | `RIGHTS_RESTRICTED`; `CANDIDATE_ONLY`, not registered or promoted. Local noncommercial artifact verification is bounded and does not authorize ordinary inference or redistribution. |

### Artifact acquisition record

The canonical release asset is:

`https://github.com/anchor-neuro/retguard/releases/download/v1.0.0/retguard-dr-v1.0.0.zip`

The release publishes these checksums:

| Member | Size / SHA-256 |
|---|---|
| `retguard-dr-v1.0.0.zip` | 204,707,438 bytes / `663c7f8bbc3676df2fe353efa0f3913c757db8c35cf9bf97ab451a756792d2e0` |
| `retguard_dr_v1.0.0.onnx` | locally measured ZIP member 212,474,298 bytes; the model card states 212,474,067 bytes; `f0e19fa86d5a27a05731550d1d6708c01f6f363f45a1fa57849de988f91e775b` |
| `ood_gate_dr_v1.0.0.npz` | `cb99b4d375ecc384ce6fbeff4f9b94c42613964b32b7a96cef8b3e1227dbf5b2` |

The zip and member digests above are source-published values. A local digest
is recorded separately by the Phase 6 acquisition script if the archive is
downloaded. No published digest is treated as a local digest.

## ABSSNET DR v1

| Field | Review result |
|---|---|
| `candidate_id` | `abssnet-dr-v1` |
| Code license | Repository marks code as MIT. |
| Weights license | Not independently stated for the trained checkpoints. |
| Dataset rights | APTOS-derived data and learned-weight redistribution rights are not established by the reviewed repository. |
| Commercial use | Not established. |
| Research use | Likely intended by the repository, but the checkpoint-specific terms are not clear enough to clear the proposed evaluation. |
| Redistribution | Unclear. |
| Modification | Code license permits modification; checkpoint terms remain unresolved. |
| Publication | Possible with appropriate citation, but no model result should be published as locally reproduced without a verified artifact and protocol. |
| Required attribution | Repository and upstream dataset attribution as specified by the source, pending checkpoint clarification. |
| Source URLs | `https://github.com/guptapradeep85/ABSSNET` |
| Uncertainties | No canonical release/hash, no same-protocol referable sensitivity/specificity, and preprocessing/checkpoint provenance is not frozen. |
| Decision | `RIGHTS_UNCLEAR`; `REJECTED` for Phase 6 acquisition. |

## Retinalens EfficientNet-B4

| Field | Review result |
|---|---|
| `candidate_id` | `retinalens-efficientnet-b4` |
| Code license | Repository displays MIT. |
| Weights license | Not established for the Kaggle notebook output. |
| Dataset rights | EyePACS/APTOS/MESSIDOR downstream rights and learned-weight redistribution are not established. |
| Commercial use | Not established. |
| Research use | Not cleared for the specific checkpoint. |
| Redistribution | Unclear. |
| Modification | Source code may be MIT; checkpoint rights remain unresolved. |
| Publication | Not useful as a locally reproducible result without a canonical artifact. |
| Required attribution | Source repository and upstream datasets, if a future rights review clears them. |
| Source URLs | `https://github.com/egwaojeangel/retinalens-ai-diabetic-retinopathy-detection` |
| Uncertainties | Artifact is described as a Kaggle output, with no canonical URL, digest, patient separation, or controlled runtime contract. |
| Decision | `RIGHTS_UNCLEAR`; `REJECTED` for Phase 6 acquisition. |

## RETFound MAE

| Field | Review result |
|---|---|
| `candidate_id` | `retfound-mae` |
| Code license | The reviewed source/checkpoint family uses noncommercial terms; exact artifact-specific terms must be retained with any gated download. |
| Weights license | CC BY-NC 4.0 is reported for the public model page. |
| Dataset rights | Pretraining corpus and downstream use rights are not sufficient to clear a new DR benchmark in this repository. |
| Commercial use | Restricted/not granted. |
| Research use | Research use may be possible after gated access and artifact-specific review. |
| Redistribution | Restricted by noncommercial/gated access. |
| Modification | Downstream task adaptation is a research activity, but no DR head is shipped here. |
| Publication | Cite the source paper/repository if used. |
| Required attribution | RETFound source and paper attribution. |
| Source URLs | `https://github.com/rmaphoh/RETFound`; `https://huggingface.co/open-eye/RETFound_MAE` |
| Uncertainties | Gated checkpoint, large foundation backbone, no task-specific DR head, no local hash, and no fair five-class/referable output contract. |
| Decision | `RIGHTS_RESTRICTED`; `REJECTED` for this Phase 6 comparison. |

## Rights gate conclusion

RetGuard is the only Phase 5 candidate with a canonical public artifact and a
source-described noncommercial research path. That path is restricted, not a
clinical or commercial authorization. Its failed ONNX logit-parity criterion
is an independent benchmark-readiness blocker. The other screened candidates
remain `RIGHTS_UNCLEAR` or lack an authenticated task-specific artifact, so
none may be substituted merely to obtain a positive result.
