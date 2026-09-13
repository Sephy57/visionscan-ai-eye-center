# VisionScan AI Eye Center — Scientific Validation Stage 1 Report

Report date: 2026-09-14<br>
Repository: https://github.com/Sephy57/visionscan-ai-eye-center<br>
Branch: `main`<br>
Scope: external-dataset governance and frozen-protocol validation of retinal review-escalation research behavior.<br>
Evidence rule: no result is promoted beyond what was actually acquired, hashed, executed, and independently reviewed.

## 1. Executive scientific conclusion

Stage 1 stopped before external inference. The strongest reviewed candidate was BRSET v1.0.2, because its published data description includes patient grouping, eye/laterality, camera, quality fields, and ICDR 0–4 labels. The files are credentialed PhysioNet data requiring current human-subject/HIPAA training and a signed data-use agreement; no authorized access or local copy was present in this run.^1 ^2 ^3

The result is therefore:

**EXTERNAL REVIEW ESCALATION VALIDATION NOT ESTABLISHED**<br>
**GENERALIZATION NOT MEASURABLE**

This is a governance stop, not a model-negative result. No external image or label was read, no model was invoked, no case was excluded, and no high-grade miss or review-burden count can honestly be reported. The aggregate result artifact records unavailable denominators as `null`, not zero.

The software status is separate. After the Phase 11 CI record was reconciled to the already-observed exact evidence head, a fresh read-only independent engineering auditor returned `PASS_NO_P0_ENABLED_PATH_BLOCKER`. The bounded software classification is **ENGINEERING READY — CONTROLLED LOCAL RESEARCH**. That does not promote any model, clear the historical data-release gate, or create a clinical-use claim.

## 2. Engineering status

The engineering reconciliation completed before scientific work:

| Item | Observed result |
| --- | --- |
| Exact evidence head | `4f27c81e163f1058e9d2ef79faed2d9b9f2d9460` |
| Hosted workflow | `34784732836` |
| Linux | success; job `103798016798` |
| Windows | success; job `103798016854` |
| Browser | success; job `103798016626` |
| CI artifact reconciliation | administrative commit `165c731122de6af6c77af4ff55cd47a506a2ad92` |
| Fresh independent engineering audit | `PASS_NO_P0_ENABLED_PATH_BLOCKER` |
| Software scope | controlled local research only |

The audit reviewed the final sign-off report, exact CI evidence, mutex-wait cancellation, 25-job capacity, shutdown/recovery, deadline, post-terminal crash, clean-checkout, and clinical-boundary evidence. It found no remaining P0 correctness blocker in an enabled controlled-local-research software path. The audit remains bounded engineering evidence; it is not scientific validation, clinical validation, regulatory approval, or model-performance sign-off.

## 3. Model status

The installed fundus models remain research-only and unchanged:

- `fundus-lesions-clementp-unet-seresnext50`, version `a2cfcb594e483`, artifact SHA-256 `a7a7cb45b92328f7c9a8e581eec3944fd435d37fae8cbf340b1319c5f987c6d2`.
- `fundus-dr-grading-effb0`, version `aa5741419b90`, artifact SHA-256 `0d9a18b0cb6c90d1f30bf2e66153b368bd7ff0bcb45b6690e8d5ce14fa19f69b`.

The model manifests identify both packages as `research_only`. The DR model's publisher-reported training sources include EyePACS, APTOS, DDR, and IDRiD. The lesion model's publisher-reported training sources include DDR, FGADR, IDRiD, MESSIDOR, and RETLES. Those source lists are not exact image manifests; where a candidate is not named, residual overlap is still not mathematically excluded.

No weights, preprocessing, threshold, region-count rule, class filter, or calibration was changed for this program.

## 4. Clinical status

The system remains:

- **NOT CLINICALLY VALIDATED**
- **NOT A MEDICAL DEVICE**
- **NOT FOR AUTONOMOUS DIAGNOSIS**

External retrospective research evidence would not change those statements by itself. Model outputs are research observations requiring clinician review and provenance. An unavailable or failed model output is not a negative result, and the frozen lesion escalation signal is not diagnostic sensitivity, disease recovery, or a referral decision.

## 5. Dataset search

The search was limited to retinal/fundus sources relevant to the frozen research questions. Candidate selection was performed before any external outcome was available. No favorable dataset was selected after inference because no external inference occurred.

The search considered endpoint compatibility, patient/eye grouping, laterality, device metadata, reference-label semantics, quality/OOD accounting, rights, provenance, and known model-training overlap. The complete machine-readable dossier is [scientific-validation-stage1-dataset-dossiers.json](<D:/AI EYE ANALYSIS PLATFORM/docs/generated/scientific-validation-stage1-dataset-dossiers.json>).

## 6. Dataset dossiers

| Dataset | Relevant evidence | Main blocker | Decision state |
| --- | --- | --- | --- |
| BRSET v1.0.2 | 16,266 images / 8,524 patients; `patient_id`, `exam_eye`, camera, quality, ICDR 0–4 | Credentialed access, CITI training, and DUA were not available | `NOT_ACQUIRED` |
| RFMiD 2.0 | 3,200 fundus images, multiple disease labels, three camera types, CC-BY 4.0 reported in paper | Image-level disease labels do not provide the required ICDR high-grade endpoint; patient/eye grouping is not documented | `REJECTED_ENDPOINT_MISMATCH` |
| IDRiD segmentation test | Compatible lesion pixel labels and CC-BY 4.0 archive | IDRiD is named in both installed model training disclosures; local export lacks patient/eye IDs and negative-image burden coverage | `REJECTED_OVERLAP_RISK` |
| APTOS 2019 | Clinician-rated DR grade 0–4; competition data | APTOS is named in the DR model training disclosure; no patient/eye separation; competition terms are non-commercial/academic research | `REJECTED_OVERLAP_RISK` |
| TJDR | 561 images; EX/HE/MA/SE pixel annotations; two camera families | Image/data rights are not separately granted by the linked archive; patient/eye grouping and ICDR labels are not documented | `REJECTED_RIGHTS` |
| Messidor-2 | 874 examinations / 1,748 images; paired-eye spreadsheet; research/education use | Official release states it contains no DR ground truth; third-party annotations cannot be silently substituted; lesion model overlap is reported | `REJECTED_GROUND_TRUTH` |
| EyePACS competition release | Five-class DR context | EyePACS is named in the DR model training disclosure and patient/eye separation was not demonstrated | `REJECTED_OVERLAP_RISK` |

### BRSET v1.0.2 dossier

BRSET is the conditional primary candidate. The official v1.0.2 page describes 16,266 fundus photographs from 8,524 Brazilian patients collected at three ophthalmological centers in São Paulo. It documents `patient_id`, `exam_eye`, camera, ICDR and Scottish grading, and image-quality fields. The v1.0.2 release also reviewed the OD/OS mapping.^1

The candidate is not an acquired evaluation cohort. PhysioNet marks the files as restricted access: credentialed access, required CITI training, and a signed DUA are prerequisites. The credentialed license limits use to lawful scientific research, prohibits re-identification and sharing, and requires security and training obligations.^2 ^3 No access credentials were available, and no authentication boundary was crossed.

### RFMiD 2.0 dossier

The RFMiD paper describes 3,200 fundus images captured with three camera types, adjudicated multi-label pathology annotations, and an image identity field. It reports a CC-BY 4.0 dataset license.^4 The published fields do not document patient IDs, eye IDs, or ICDR 0–4 severity. A binary DR label cannot establish the planned referable/high-grade endpoint, and no compatible pixel-level lesion reference was established. It was rejected before acquisition for endpoint mismatch.

### IDRiD dossier

The local IDRiD export is an overlap-disclosed segmentation evaluation, not an independent cohort. The local evidence records that IDRiD is named in the publisher-reported training sources of the evaluated lesion and DR checkpoints, that the export does not provide patient/eye identifiers, and that the 27-image segmentation test does not provide negative-image coverage adequate for false-positive burden. It remains useful as historical comparability evidence only, not Stage 1 external validation.

### APTOS 2019 dossier

The official competition page describes clinician-rated grades 0–4 and heterogeneous acquisition conditions. The competition data are subject to Kaggle rules, and the host's terms describe non-commercial competition, academic research, and education use.^5 ^6 The installed DR checkpoint's publisher-reported training sources include APTOS, and the export does not establish patient-level separation. It was rejected for known overlap risk.

### TJDR dossier

The TJDR paper describes 561 color fundus images from Tongji Hospital, two camera families, and pixel annotations for hard exudates, hemorrhages, microaneurysms, and soft exudates. It states that images are openly downloadable and privacy information was removed.^7 The repository carries an Apache-2.0 license, but the linked image/annotation archive is not separately granted under a clearly stated data license. The code license cannot be assumed to license the external images or permit redistribution. Patient/eye grouping and ICDR grades are also not documented. It was rejected at the rights gate.

### Messidor-2 dossier

The official ADCIS page describes 874 examinations and 1,748 images, with a spreadsheet pairing the two images in each examination. It explicitly states that the official database does not contain DR ground truth and that third-party annotations are independent from the official database. The publisher allows free research/educational use but prohibits copying, redistribution, and unauthorized commercial use.^8 The absence of official ground truth blocks the planned reference endpoint, and the lesion model's publisher-reported training list includes MESSIDOR.

### EyePACS dossier

The EyePACS competition release was not acquired. The installed DR model's publisher-reported training sources include EyePACS, while the competition export did not provide a demonstrated patient/eye grouping suitable for the planned cluster analysis. It was rejected for known overlap risk rather than downloaded for an outcome comparison.

## 7. Primary dataset selection

No primary dataset was authorized for inference. BRSET v1.0.2 was selected only as the **conditional primary candidate** because it best matches the endpoint and grouping requirements. Its machine-readable selection state is `NOT_ACQUIRED`, not `ELIGIBLE_FOR_FROZEN_PROTOCOL`.

The selection is intentionally not a result-based promotion. The next gate is human-authorized credentialed access, exact-release acquisition, and a file-level manifest. Until those gates pass, a primary evaluation denominator does not exist.

## 8. Rights

Rights were reviewed as a gate, not inferred from public discoverability. BRSET's current license is the PhysioNet Credentialed Health Data License 1.5.0. The license limits use to lawful scientific research, prohibits re-identification and sharing, requires prudent security, and requires current human-subject/HIPAA training. The DUA repeats the no-sharing, no-identification, training, and open-code obligations.^2 ^3

Those terms are sufficient in principle for a properly credentialed internal research evaluation. They are not permission for commercial use, clinical deployment, public raw-data redistribution, or committing images/labels to Git. Because the required credential and DUA were not present, the performed work could not lawfully include the restricted files.

## 9. Dataset version

The conditional candidate is fixed to **BRSET v1.0.2**, released July 27, 2026 according to the official version page. The release notes state that `exam_eye` was comprehensively reviewed and that field-name corrections were made.^1 No mirror, older v1.0.0/v1.0.1 export, or mixed-version label table was used.

## 10. Manifest

The blocked manifest is [dataset-manifest.json](<D:/AI EYE ANALYSIS PLATFORM/docs/generated/dataset-manifest.json>). It is a safe pre-acquisition record with:

- dataset identity `brset-v1.0.2`;
- source and planned external root `D:/VISIONSCAN-VALIDATION-DATA/brset-v1.0.2`;
- rights state `CONDITIONALLY_DEFENSIBLE_RESEARCH_ONLY_CREDENTIAL_REQUIRED`;
- access state `CREDENTIAL_REQUIRED_NOT_AVAILABLE`;
- an empty `files` array;
- no image, label, patient, eye, or derived case bytes;
- `dataset_sha256: null` because dataset bytes were not obtained.

The empty file list is not evidence that BRSET contains zero files. The documented release counts are source metadata only and were not used as local denominators.

## 11. Manifest hash

The blocked manifest record has SHA-256:

`1ab490cf28b3a30f00052ee183252a46955d99ace9fdff0cafa4936cc9204667`

The hash scope is the canonical JSON representation with the manifest's `hash` property omitted. This hashes the blocked record, not unavailable dataset bytes. A future acquired-data manifest must replace the empty record with a new exact file list and new hash before inference.

## 12. Patient/eye grouping

The intended grouping keys are `patient_id` and `exam_eye`. Eyes must remain separate; OD/OS must not be inferred from filename order or image appearance. Where a patient contributes multiple images/eyes, proportions will be reported with a patient-cluster method rather than treating every eye as a fully independent person.

BRSET documents both keys, but this run did not inspect a label row. Consequently, patient count, eye count, duplicate structure, and cluster sizes are not asserted as local observations.

## 13. Training-overlap assessment

The conditional BRSET selection is not named in either installed model's publisher-reported training list. That supports a lower known-overlap risk than APTOS, EyePACS, IDRiD, or MESSIDOR. It does not prove zero overlap because the publishers do not provide complete, hashable training manifests.

The future acquisition gate must compare the exact BRSET image manifest against every available model-training manifest and record any unresolved identity risk. If overlap cannot be excluded enough for the stated claim, the program must stop with `EXTERNAL REVIEW ESCALATION VALIDATION NOT ESTABLISHED`.

## 14. Frozen protocol

The pre-inference protocol is [scientific-validation-stage1-protocol.json](<D:/AI EYE ANALYSIS PLATFORM/docs/generated/scientific-validation-stage1-protocol.json>). It freezes the candidate identity, label mapping, quality/OOD rules, lesion rule, model identity, endpoints, denominators, subgroups, statistics, reproducibility selector, storage boundary, and stopping rules before any external output.

Its status is `FROZEN_BEFORE_INFERENCE_NOT_ACQUIRED`. Because no data were acquired, it authorizes no inference. If the human access gate later succeeds, the actual file manifest must be created and a new frozen protocol record must reference that exact manifest before the first model invocation.

## 15. Protocol hash

The protocol record has SHA-256:

`7a8be3b7f766cb38c5b41128b5f2fec86631f8b602ddad268ad65955c335faa0`

The hash scope is canonical JSON with the protocol's `hash` property omitted. The protocol references the blocked manifest-record hash above, not a dataset-byte hash.

## 16. Frozen lesion rule

The rule remains exactly:

`LESION_ESCALATION_RULE_PHASE7_V1: region_count >= 3`

This is a research review-escalation rule. It is not sensitivity, specificity, disease recovery, diagnosis, or a clinical referral rule. No external result was used to tune region count, minimum area, class filtering, camera thresholds, or any other operating point.

## 17. Frozen models

The planned external run retains the installed identities and source-pinned preprocessing:

| Model | Version | Artifact SHA-256 | Preprocessing |
| --- | --- | --- | --- |
| `fundus-lesions-clementp-unet-seresnext50` | `a2cfcb594e483` | `a7a7cb45b92328f7c9a8e581eec3944fd435d37fae8cbf340b1319c5f987c6d2` | `clementp-source-pinned-1024-v1` |
| `fundus-dr-grading-effb0` | `aa5741419b90` | `0d9a18b0cb6c90d1f30bf2e66153b368bd7ff0bcb45b6690e8d5ce14fa19f69b` | `clementp-dr-source-pinned-512-v1` |

Both remain `RESEARCH_ONLY`. No model invocation occurred in Stage 1.

## 18. Predeclared exclusions

If the data-access gate is later cleared, exclusions will be limited to rules declared before inference:

- unsupported image/modality;
- decode or shape/byte-limit failure;
- missing required artifact or reference label;
- existing quality gate block;
- existing OOD/domain gate block;
- model or preprocessing failure;
- label ambiguity;
- unusable patient grouping for a patient-cluster claim.

Excluded cases will remain in the coverage accounting. No difficult case may be removed after seeing an output.

## 19. Endpoints

The primary endpoint is **REVIEW ESCALATION COVERAGE**:

> Among eligible executed cases with `DR_ICDR >= 2`, how many satisfy the unchanged lesion review-escalation rule `region_count >= 3`?

The secondary endpoint is **REVIEW ESCALATION BURDEN**:

> Among eligible executed cases with `DR_ICDR < 2`, how many satisfy the unchanged lesion review-escalation rule, reported per 100 lower-risk executed cases?

DR grade classification metrics are secondary research measurements and are kept separate from the lesion escalation endpoint. No endpoint is called clinical sensitivity or specificity unless a different, separately governed diagnostic reference-standard program establishes that terminology.

## 20. Statistics

The frozen statistical plan specifies:

- Wilson intervals for proportions;
- patient-cluster bootstrap or a justified cluster-robust proportion interval where multiple eyes/images per patient exist;
- accuracy, balanced accuracy, macro F1, QWK, confusion matrix, and grade-specific recall for compatible DR labels;
- AUROC/AUPRC only as research score-ranking measurements;
- no calibrated-probability claim for the raw DR score;
- no calibration fit on the external evaluation set;
- no p-value fishing or selective reporting of exploratory comparisons;
- `INSUFFICIENT_SUBGROUP_SAMPLE` for small groups.

## 21. Dataset total

**Not measured.** The official BRSET page documents 16,266 images and 8,524 patients, but those are source-description values, not a locally verified denominator. The result artifact records `dataset_total: null`.

## 22. Eligible cases

**Not measured.** No file list or label row was available to apply the predeclared eligibility rules. `eligible: null` is intentional.

## 23. Excluded cases

**Not measured.** No case reached an exclusion decision. `excluded_by_predeclared_rule: null` is not a zero-exclusion claim.

## 24. Quality blocked

**Not measured.** No image entered the quality gate. The quality gate was not relaxed.

## 25. OOD blocked

**Not measured.** No image entered the OOD/domain gate. The OOD gate was not changed.

## 26. Execution failures

**Not measured.** No model execution was attempted. No unavailable output was interpreted as negative.

## 27. Executed cases

Observed executed cases: **0**.<br>
Raw images read: **0**.<br>
Model invocations: **0**.

These are the only zero counts in the coverage record because they describe observed activity, not unavailable dataset counts.

## 28. Coverage

The complete coverage object is in [scientific-validation-stage1-results.json](<D:/AI EYE ANALYSIS PLATFORM/docs/generated/scientific-validation-stage1-results.json>). Its status is `NOT_MEASURED_NO_DATA_ACQUIRED`.

| Coverage field | Value | Interpretation |
| --- | ---: | --- |
| Dataset total | `null` | Release not acquired |
| Eligible | `null` | No rows inspected |
| Predeclared exclusions | `null` | No case decisions |
| Decode failures | `null` | No images read |
| Quality blocked | `null` | No quality evaluations |
| OOD blocked | `null` | No OOD evaluations |
| Execution failures | `null` | No execution attempts |
| Executed | `0` | Observed |
| Missing ground truth | `null` | No rows inspected |

## 29. Review escalation coverage

**Not measured.** Numerator, denominator, Wilson interval, and missed-escalation count are all `null`. There is no external review-escalation estimate to compare with the internal Grade 3/4 escalation observations.

## 30. Review burden

**Not measured.** No lower-risk/non-target image was executed, so no false-positive or review-burden rate exists. The planned denominator is lower-risk executed cases, not the entire source description and not only cases selected after inference.

## 31. High-risk non-escalated cases

**Not measured.** No referable/high-grade external case was inspected. The count of high-risk non-escalated cases, Grade 3 misses, and Grade 4 misses is `null`, not zero.

## 32. Error registry

The [scientific-validation-stage1-error-registry.json](<D:/AI EYE ANALYSIS PLATFORM/docs/generated/scientific-validation-stage1-error-registry.json>) has status `NOT_RUN_NO_DATA_ACQUIRED` and an empty `errors` array. This means no case could be entered because no data were acquired; it does not mean zero errors or zero high-risk non-escalations.

The future registry will contain only opaque case references, dataset/version, permitted grouping hash, laterality, reference label, quality/OOD state, research outputs, region count, escalation state, and failure reason. Raw image bytes and sensitive identifiers will remain outside Git.

## 33. DR external metrics

**Not measured.** BRSET was not acquired, so accuracy, balanced accuracy, macro F1, QWK, referable research sensitivity/specificity, PPV, NPV, AUROC, and AUPRC are unavailable. No external number is copied from a publisher report into the Stage 1 results.

## 34. DR confusion matrix

**Not measured.** There is no external executed-case confusion matrix.

## 35. Referable result

**Not measured.** `DR_ICDR >= 2` is the predeclared reference condition for a future research analysis only. It was not evaluated here and must not be described as a clinical referral label.

## 36. Grade 3 result

**Not measured.** External support, DR research output, lesion escalation, combined review escalation, and un-escalated count are all unavailable. No Grade 3 case entered the external error registry.

## 37. Grade 4 result

**Not measured.** External support, DR research output, lesion escalation, combined review escalation, and un-escalated count are all unavailable. No Grade 4 case entered the external error registry.

## 38. Lesion external metrics

**Not measurable on the unacquired BRSET candidate.** The official BRSET data description documents image-level pathology and DR fields, not compatible pixel-level lesion annotations. No segmentation metric was computed.

## 39. Lesion class metrics

**Not measured.** No external per-class result exists for cotton-wool spot, hard exudate, retinal hemorrhage, or microaneurysm-like lesion. Soft-exudate/cotton-wool mapping must not be assumed from a label name.

## 40. Region burden

**Not measured.** Median, mean, p95, and class distribution of candidate regions per negative/lower-risk image are unavailable. Empty results are not interpreted as zero false-positive burden.

## 41. Device analysis

BRSET is suitable in principle for a predeclared device analysis because its source description documents Nikon NF505 and Canon CR-2 camera fields.^1 No per-camera execution coverage or review-escalation result was measured. No camera-specific validation claim is made.

## 42. Quality analysis

The candidate source documents focus, illumination, image field, and artifacts as quality fields. No quality stratum was inspected, and the application quality gate was not weakened to increase hypothetical coverage.

## 43. Severity analysis

The planned severity strata are ICDR 0, 1, 2, 3, and 4. All five supports and all Grade 3/4 escalation outcomes are unavailable because no cases were acquired. No severe-case absence is inferred.

## 44. Other predeclared subgroups

Only trusted source metadata may be used. Planned groups are camera, quality, ICDR severity, site where explicitly supplied, and laterality where supplied. Age/sex may be described only after governance review and only as trusted dataset metadata; race or ethnicity will never be inferred from fundus pixels.

No subgroup result was measured. No fairness, demographic, site, device, or population-generalization claim is made.

## 45. Confidence intervals

**Not measured.** No external proportion exists to which a Wilson interval or patient-cluster bootstrap could be applied. The absence of an interval is a consequence of no data, not a narrow interval or a favorable result.

## 46. Patient-cluster analysis

**Not run.** The planned keys are `patient_id` and `exam_eye`, but no label row was inspected. No eye-level result was treated as a person-level result.

## 47. Domain-shift discussion

The candidate would introduce a distinct Brazilian outpatient population and Nikon/Canon acquisition domains relative to the internal DeepDRiD Shanghai cohort and the installed models' reported training sources. The expected dimensions for later analysis are camera, compression, resolution, population, prevalence, site, and acquisition protocol.

Because no BRSET image was executed, domain shift was not measured and no claim of material degradation or stability can be made.

## 48. Reproducibility

**Not run.** The frozen selector is deterministic: sort eligible input SHA-256 values lexicographically and select the first `min(100, all eligible)` cases. The future rerun must preserve model, preprocessing, runtime, device, input, and protocol hashes. No subset was cherry-picked in this run.

## 49. Comparison with internal evidence

The internal evidence remains frozen and separate:

- DeepDRiD regular-fundus validation: 400 images / 100 patients; TP 79, FN 101, FP 2, TN 218; referable research sensitivity 43.89% and specificity 99.09% under the existing internal convention.
- Exact Grade 3 baseline: 3/68.
- Exact Grade 4 baseline: 0/20.
- Internal lesion review escalation: Grade 3 `62/65`; Grade 4 `19/20`.

These are internal held-out or internal review-escalation observations and are not external evidence. Stage 1 adds no external number and does not alter these baselines.

## 50. What generalized

No external behavior was measured. The only conclusion that generalized from the governance review is that candidate selection, rights, overlap, grouping, denominator, and clinical-language gates were applied before inference and stopped the program when the required source files were unavailable.

## 51. What did not generalize

No scientific generalization conclusion is supportable. In particular, this run does not establish whether the lesion escalation rule generalizes, whether device or quality strata differ, how many high-grade cases are missed, or what review burden the rule creates.

## 52. Limitations

- No authorized BRSET credential, CITI evidence, or signed DUA was available.
- No external image, label row, file hash, patient grouping, laterality, quality state, or OOD state was inspected.
- Publisher-reported model training lists are not complete, hashable training manifests.
- Candidate rights and endpoint evidence are source-grounded but do not substitute for a human legal/data-governance approval.
- The empty blocked manifest hashes a planning record, not dataset bytes.
- The software audit is bounded to controlled local research paths and is not clinical or regulatory validation.

## 53. Independent scientific audit

The fresh independent scientific audit reviewed this report, the dataset dossiers, blocked manifest, frozen protocol, result artifact, error registry, source/rights evidence, installed model manifests, and the explicit no-inference stop. It answered the 15 method-boundary questions in the protocol directive and returned exactly:

**`PASS_SCIENTIFIC_METHOD_BOUNDARIES`**

The auditor found the candidate-selection, rights, provenance, overlap, grouping, endpoint, frozen-model, denominator, error-registry, no-inference, aggregate-only, and research-only boundaries coherent. This is a bounded methods/governance result, not external performance validation, clinical validation, regulatory approval, or model-performance sign-off. The audit record is [here](<D:/AI EYE ANALYSIS PLATFORM/docs/generated/scientific-validation-stage1-independent-audit.json>).

One wording limitation was identified during review: the original broad `raw_images_in_repository` dossier flag could be read as covering non-PHI engineering fixtures and historical overlap-disclosed files. The final dossier scopes the statement to `raw_validation_images_in_repository` and separately identifies those non-Stage-1 files; this clarification does not change the stop, protocol, model, or result state.

## 54. External validation classification

**EXTERNAL REVIEW ESCALATION VALIDATION NOT ESTABLISHED**

This is the required exact classification for a stop before defensible data acquisition and inference.

## 55. Generalization classification

**GENERALIZATION NOT MEASURABLE**

No supportive, mixed, or poor generalization label can be assigned without an external executed cohort.

## 56. Model classification

**MODEL INTELLIGENCE PARTIAL / RESEARCH-ONLY**

The model artifacts remain integrity-checked research packages. Stage 1 does not promote them to external, clinical, or calibrated status.

## 57. Retinal intelligence classification

**RETINAL REVIEW INTELLIGENCE PARTIAL — INTERNAL HELD-OUT EVIDENCE ONLY**

The current internal lesion escalation observations remain available as internal research evidence. No external generalization or high-grade miss estimate was established.

## 58. Data classification

**DATA RELEASE BLOCKED**

The historical application release-data gate remains separate. Stage 1 dataset governance does not clear active or legacy unresolved source records, FK/data-release blockers, or PHI-release policy.

## 59. Software classification

**ENGINEERING READY — CONTROLLED LOCAL RESEARCH**

This bounded classification is supported by the exact-head CI evidence and the fresh independent engineering result `PASS_NO_P0_ENABLED_PATH_BLOCKER`. It does not mean production-ready, unlimited-capacity, clinically validated, or authorized for patient care.

## 60. Clinical classification

**NOT CLINICALLY VALIDATED — NOT A MEDICAL DEVICE — NOT FOR AUTONOMOUS DIAGNOSIS**

These statements remain mandatory regardless of the future external research result.

## Primary questions

### Q1. Was a defensible independent external retinal cohort obtained?

**No.** BRSET v1.0.2 was identified as the conditional primary candidate, but its credentialed files were not obtained. Other candidates were rejected before inference for overlap, rights, endpoint, ground-truth, or grouping defects.

### Q2. Were rights sufficient for the performed research evaluation?

**No evaluation was performed.** BRSET's research-only credentialed terms are conditionally sufficient for an authorized researcher, but the required access and DUA were not available in this run.

### Q3. Was the protocol frozen before inference?

**Yes, with no inference afterward.** The protocol status is `FROZEN_BEFORE_INFERENCE_NOT_ACQUIRED`, and its hash is recorded above.

### Q4. Was the Phase 7 lesion rule used unchanged?

**No external execution occurred; the planned rule is unchanged.** The frozen definition remains `region_count >= 3` under `LESION_ESCALATION_RULE_PHASE7_V1`.

### Q5. How many external cases were eligible?

**Not measured.** The value is `null` because no BRSET files were acquired.

### Q6. How many actually executed?

**0.** No external image was read and no model was invoked.

### Q7. How many were quality-blocked?

**Not measured.** No image reached the quality gate.

### Q8. How many were OOD-blocked?

**Not measured.** No image reached the OOD gate.

### Q9. What was external review escalation coverage?

**Not measured.** No numerator or denominator exists.

### Q10. What was review burden?

**Not measured.** No lower-risk external case was executed.

### Q11. How many high-grade/referable cases remained un-escalated?

**Not measured.** The count is `null`; it is not zero.

### Q12. How did external behavior compare with internal held-out behavior?

**It cannot be compared.** No external behavior was measured; internal baselines remain unchanged and separately labeled.

### Q13. How did the existing DR research model perform externally?

**Not measured.** The unchanged DR model was not invoked on BRSET.

### Q14. How did Grade 3 behave?

**Not measured.** No external Grade 3 support or escalation result exists.

### Q15. How did Grade 4 behave?

**Not measured.** No external Grade 4 support or escalation result exists.

### Q16. Were results stable across devices/sites where measurable?

**Not measurable.** No device or site group was executed.

### Q17. Were any subgroup concerns observed?

**Not observed because no subgroups were analyzed.** No demographic attributes were inferred.

### Q18. Did domain shift materially degrade performance?

**Not measurable.** The relevant domain dimensions were predeclared but not executed.

### Q19. Did the independent scientific auditor approve the methodology?

**`PASS_SCIENTIFIC_METHOD_BOUNDARIES`.** This confirms only that the pre-inference scientific governance boundaries were coherent and honestly reported. It is not approval of model performance, clinical use, or a claim that external validation was established.

### Q20. Can external review escalation evidence honestly be called established?

**No.** The exact classification is `EXTERNAL REVIEW ESCALATION VALIDATION NOT ESTABLISHED`.

### Q21. Does any result justify clinical deployment?

**No.** No external result was generated, and retrospective research evidence would not justify clinical deployment. The system remains not clinically validated, not a medical device, and not for autonomous diagnosis.

## Next authorized gate

The next step is not a feature phase. A human-authorized researcher must complete BRSET credentialing, CITI training, and the DUA; obtain the exact v1.0.2 release; place it under the ignored external D: research root; hash every file; review label/grouping/overlap integrity; create a new frozen protocol tied to that manifest; and only then run the predeclared inference. If any stop rule fails, retain the present `NOT ESTABLISHED` / `NOT MEASURABLE` classifications.

No Phase 12 was created. No application feature, DR baseline, lesion rule, model weight, or RETGUARD state was changed by this program.

## Sources

1. BRSET authors / PhysioNet, “A Brazilian Multilabel Ophthalmological Dataset (BRSET), version 1.0.2,” July 27, 2026. [Official dataset page](https://physionet.org/content/brazilian-ophthalmological/1.0.2/).
2. MIT Laboratory for Computational Physiology, “PhysioNet Credentialed Health Data License 1.5.0,” applied to BRSET v1.0.2. [License](https://physionet.org/content/brazilian-ophthalmological/view-license/1.0.2/).
3. MIT Laboratory for Computational Physiology, “PhysioNet Credentialed Health Data Use Agreement 1.5.0,” applied to BRSET v1.0.2. [DUA](https://physionet.org/content/brazilian-ophthalmological/view-dua/1.0.2/).
4. Panchal et al., “Retinal Fundus Multi-Disease Image Dataset (RFMiD): A Dataset for Multi-Disease Detection Research,” *Data* 2021. [Dataset paper](https://mdpi-res.com/d_attachment/data/data-06-00014/article_deploy/data-06-00014-with-cover.pdf?version=1669199114).
5. Asia Pacific Tele-Ophthalmology Society / Kaggle, “APTOS 2019 Blindness Detection.” [Dataset page](https://www.kaggle.com/competitions/aptos2019-blindness-detection/data).
6. Asia Pacific Tele-Ophthalmology Society / Kaggle, “APTOS 2019 Blindness Detection — competition rules.” [Rules](https://www.kaggle.com/competitions/aptos2019-blindness-detection/rules).
7. Mao et al., “TJDR: A High-Quality Diabetic Retinopathy Pixel-Level Annotation Dataset,” arXiv:2312.15389. [Dataset paper](https://arxiv.org/abs/2312.15389); [repository](https://github.com/NekoPii/TJDR).
8. ADCIS / Messidor program partners, “Messidor-2.” [Official dataset terms and description](https://www.adcis.net/en/third-party/messidor2/).

Local evidence artifacts:

- [Dataset dossiers](<D:/AI EYE ANALYSIS PLATFORM/docs/generated/scientific-validation-stage1-dataset-dossiers.json>)
- [Blocked dataset manifest](<D:/AI EYE ANALYSIS PLATFORM/docs/generated/dataset-manifest.json>)
- [Frozen protocol](<D:/AI EYE ANALYSIS PLATFORM/docs/generated/scientific-validation-stage1-protocol.json>)
- [Aggregate results](<D:/AI EYE ANALYSIS PLATFORM/docs/generated/scientific-validation-stage1-results.json>)
- [External error registry](<D:/AI EYE ANALYSIS PLATFORM/docs/generated/scientific-validation-stage1-error-registry.json>)
- [Independent scientific-method audit](<D:/AI EYE ANALYSIS PLATFORM/docs/generated/scientific-validation-stage1-independent-audit.json>)
- [Reconciled independent engineering audit](<D:/AI EYE ANALYSIS PLATFORM/docs/generated/final-independent-engineering-audit.json>)
