# VisionScan Phase 4 — Next-Generation Local Intelligence Report

**Observed:** 2026-09-13, Asia/Manila
**Workspace:** `D:\AI EYE ANALYSIS PLATFORM`
**Scope:** continuation of Phase 3 with local ophthalmic model integrity, failure-aware research fusion, OCT aggregation, specialist boundaries, worker reliability, adversarial validation, UI evidence, and release verification.
**Decision:** the software is suitable for controlled local research engineering and a constrained demonstration. It is not clinically validated, not a medical device, and not for autonomous diagnosis.

This report is deliberately evidence-bounded. A missing model, missing device metadata, missing ground truth, unsupported specialty, or failed contract produces an explicit unavailable/incomplete/invalid state; it is never converted into a normal result, a probability, a diagnosis, or a treatment recommendation.

## 1. Starting HEAD

The verified starting commit was `f1ec9858daa2fe6be78d999372f25e9ba7673aee`, on `main`, matching `origin/main` before Phase 4 implementation. The initial worktree was clean. Existing Phase 3 history and user changes were preserved.

## 2. Final HEAD

The implementation release head is `ede958e32fe797992461e9e237bfae6d3108f1a4` (`test: align no-model safety assertion`). The report is a documentation follow-up committed after that implementation head; it does not redefine the code evidence or its model hashes.

## 3. Commits

Phase 4 implementation commits:

- `f43d760` — `feat: harden phase 4 local intelligence safety`
- `4d593e2` — `fix: keep missing demo device metadata advisory`
- `ede958e` — `test: align no-model safety assertion`

The implementation adds the research fusion contract, strict optic-disc/cup geometry validation, deterministic OCT aggregation, model-output integrity fields, explicit Phase 4 acceptance cases, nonzero worker-exit handling, OOD admission behavior, source binding, and CI steps. The stale no-model red-team expectation was corrected to require `MODEL_UNAVAILABLE`; no behavior was weakened.

## 4. Push

The implementation head was pushed normally with:

```text
git push origin main
```

The push advanced `origin/main` from `f1ec985` to `ede958e`. No force push, reset, checkout, or history rewrite was used. The report document is intended to be pushed as a subsequent documentation-only commit.

## 5. CI

GitHub Actions run `34711160836` was triggered for the exact implementation SHA `ede958e32fe797992461e9e237bfae6d3108f1a4`. It contains `verify`, `verify-windows`, and `verify-browser`; all three completed successfully. The exact run is <https://github.com/Sephy57/visionscan-ai-eye-center/actions/runs/34711160836>.

The prior successful run for `f1ec985` is historical baseline evidence only and is not substituted for the Phase 4 run. CI is engineering validation, not clinical validation. The workflow intentionally uses no patient data, no model weights, no paid API, and no remote inference.

## 6. Baseline model state

The installed local artifact inventory remained three research-only models. The optic-disc/cup artifact is a separate candidate and is not a disease model.

| Model | Runtime/input | Artifact SHA-256 | State |
|---|---|---|---|
| `fundus-dr-grading-effb0` | SafeTensors/CPU; FUNDUS, `3x512x512` | `0d9a18b0cb6c90d1f30bf2e66153b368bd7ff0bcb45b6690e8d5ce14fa19f69b` | `RESEARCH_ONLY` |
| `fundus-lesions-clementp-unet-seresnext50` | SafeTensors/CPU; FUNDUS, `3x1024x1024` | `a7a7cb45b92328f7c9a8e581eec3944fd435d37fae8cbf340b1319c5f987c6d2` | `RESEARCH_ONLY` |
| `oct-retinal-weights-fp32` | ONNX/CPUExecutionProvider; OCT, `1x224x224x3` | `22b1fffb5a0ab88284d4c5817c581bedb1b54c09011d87c3f6472cb2c36b2b1f` | `RESEARCH_ONLY` |
| `segformer-optic-disc-cup-refuge` | SafeTensors/CPU; candidate anatomy path | `22e45131b64eb07a5d29a2e5388a7709d10696b13f48d2d0cdcf56cafa1f9ea5` | `CANDIDATE_ONLY` |

Every executable model path checks the registry identity, artifact hash, preprocessing/version contract, output transport, and research-only status. No remote provider is a fallback, and no paid API is used by the default path.

## 7. DR baseline

The DR grader is a five-grade ordinal research model. The displayed integer is a rounded/clamped regression output, not a calibrated probability. The strongest available comparison is the DeepDRiD regular-fundus validation export: `N=400` images from `100` patients, with the publisher split retained and no overlap with the local training export.

Measured values are accuracy `0.5025`, balanced accuracy `0.2842`, macro F1 `0.2620`, and quadratic weighted kappa `0.4950`. At the exploratory referable rule `grade >= 2`, sensitivity is `0.4389` (`79/180`), specificity `0.9909` (`218/220`), PPV `0.9753`, and NPV `0.6834`. The rule is research evidence, not a clinical referral policy.

## 8. DR candidates

No new DR candidate was downloaded, registered, or integrated in Phase 4. Candidate discovery was limited to checking whether a reproducible, task-aligned, locally runnable, licensed artifact could satisfy the promotion gate. RETFound (<https://github.com/rmaphoh/RETFound>) is a broad retinal foundation-model research resource rather than a drop-in, hash-pinned, CPU-validated replacement for the current five-grade contract. MIRAGE (<https://github.com/j-morano/MIRAGE>) is a multimodal OCT/SLO research direction, not a directly comparable DR grader.

Neither candidate has a Phase 4 local artifact, preprocessing lock, independent head-to-head evaluation, three-person review, or promotion record. They remain research leads, not capabilities of this release.

## 9. DR head-to-head

There is no Phase 4 head-to-head result. Without an installed candidate and a frozen patient/eye-separated evaluation export, the report does not invent accuracy, sensitivity, specificity, calibration, latency, or superiority. The current grader remains the only executed DR artifact and retains its low-sensitivity limitation.

## 10. DR ensemble

There is no DR model ensemble and no score/logit averaging. The new fusion layer compares categorical DR and lesion outcomes only when both completed on the same study. It can report corroboration or disagreement; it does not select a winner or repair a weak DR grade.

## 11. DR FN before

The DeepDRiD validation registry contains `101` referable false negatives. Referable sensitivity is `79/180 = 0.4389`. Per-grade sensitivity is `0.9310` for grade 0, `0.1087` for grade 1, `0.3370` for grade 2, `0.0441` for grade 3, and `0.0000` for grade 4. The two higher-grade cells are the load-bearing safety limitation: grade 3 sensitivity is `3/68` and grade 4 sensitivity is `0/20`.

These are measured registry outcomes, not asserted root causes. The registry preserves bounded failure categories, ground-truth/predicted grade, score, and quality fields where available without releasing raw patient identifiers.

## 12. DR FN after

`NOT MEASURED — no DR candidate, threshold, calibration, preprocessing, or model artifact changed.` Phase 4 improves visibility and prevents a low DR output from erasing a separate lesion signal, but it does not claim that the `101` false negatives were reduced.

## 13. DR FP before

The referable false-positive registry contains `2` cases on the same measured validation export. Referable specificity is `218/220 = 0.9909`. The high specificity does not compensate for the observed high-grade misses, and it is not a deployment operating point.

## 14. DR FP after

`NOT MEASURED — no DR candidate, threshold, or postprocessing change.` The existing false-positive records remain available for review, and the system makes no claim of zero false positives.

## 15. DR operating point

No clinical operating point is accepted. The current `dr-fixed-round-rule-v1` reproduces the research integer grade only. It is not prevalence-adjusted, device-specific, subgroup-validated, calibrated, prospective, or a safe referral threshold. Any future threshold must be frozen on a calibration partition, independently tested, versioned, and reviewed before runtime use.

## 16. Lesion baseline

The lesion detector is an uncalibrated argmax connected-component research detector. The available IDRiD Task 2 comparison has `27` images and four classes; the checkpoint's reported training distribution includes IDRiD, and patient/eye separation cannot be verified. It is therefore overlap-disclosed comparability evidence, not independent validation.

## 17. Lesion new validation

No new lesion cohort, model, threshold, or postprocessing rule was introduced. Existing measurements are MA Dice `0.4046`, HE Dice `0.6649`, EX Dice `0.7641`, and SE/CWT Dice `0.7115`; corresponding IoU values are `0.2536`, `0.4981`, `0.6182`, and `0.5522`. Region outputs remain explicitly unvalidated lesion-like regions.

## 18. Lesion FP burden

IDRiD cannot measure image-level specificity or region-level false positives because the test images have no usable negative-image region table. The documented DeepDRiD comparison found target regions on `113/174` grade-0 eyes (`0.649`), and the APTOS capped comparison found `148/250` grade-0 eyes (`0.592`) with the fixed argmax behavior. These are sensitivity-oriented, specificity-poor research observations, not a safe clinical operating point.

No suppression rule was added. A size, optic-disc adjacency, color, or quality filter would require a frozen calibration set, explicit ground truth, and revalidation.

## 19. Lesion FN analysis

The known IDRiD image-level misses include four cotton-wool-like misses (`10/14` image sensitivity) and one hemorrhage miss (`26/27`). MA pixel recall is `<=0.35` on `8/27` images. The aggregate export does not provide a defensible per-lesion registry for all components, so complete region-level FN analysis remains `NOT MEASURABLE`.

The engineering record also keeps uniform black, random noise, red synthetic content, and an unverified 16-pixel example-image component as false-alarm candidates rather than clinical findings.

## 20. OCT baseline

The OCT classifier has four classes: CNV, DME, DRUSEN, and NORMAL. On the Kermany mirror (`1,000` scans, `250` per class), the observed accuracy, balanced accuracy, and macro F1 are each `0.9770`. Patient separation is not verifiable and the evaluation overlaps the reported training distribution; this is not universal OCT performance.

On the Duke export (`3,231` scans, `45` subject folders), scan-level accuracy is `0.8437` and subject-majority accuracy is `42/45 = 0.933`. Duke dry AMD is used only as an approximate DRUSEN proxy; it has no CNV reference class. The domain-shift result is descriptive and research-only.

## 21. OCT candidate models

No replacement OCT model was installed or promoted. The current ONNX artifact runs the pinned local backbone/argmax contract; the publisher's hybrid XGBoost head is not executed. Multimodal or foundation-model candidates remain unintegrated because identity, license, preprocessing, CPU behavior, output semantics, and independent validation were not all satisfied.

## 22. OCT external validation

The Duke result is the strongest external distribution check currently available, but it is not a universal disease classifier validation. Approximate mapped sensitivities are NORMAL `0.8159`, DME `0.9246`, and DRUSEN-proxy `0.7746`; the export includes `112` dry-AMD-to-CNV predictions that remain visible as out-of-label errors. No clinical utility or device-transfer claim follows.

## 23. OCT aggregation

`lib/models/octAggregation.ts` now aggregates only completed, class-bearing scans from the same explicitly linked set. It excludes failed/skipped scans while preserving their IDs, never averages logits, never invents confidence, and never selects a winner in a mixed class set.

States include `CONSISTENT_TARGET_CLASS`, `CONSISTENT_NO_TARGET_CLASS`, `MIXED_OCT_CLASS_RESULTS`, `INSUFFICIENT_SCAN_QUALITY`, and `NOT_COMPARABLE`. One scan is `NOT_COMPARABLE`; unknown/bilateral mixed laterality is not pooled. `NORMAL` remains a model class, not a healthy-eye or disease-absent claim.

## 24. OCT domain shift

The difference between Kermany `0.9770` scan accuracy and Duke `0.8437` scan accuracy / `0.933` subject majority is retained as domain-shift evidence. The system does not collapse these datasets, call the Kermany result external, or claim device invariance. Device, scan quality, subject separation, label mapping, and class availability remain validation dimensions.

## 25. Optic disc/cup

The SegFormer candidate is anatomy-only. A local probe produced `23,671` optic-disc pixels and `31,305` optic-cup pixels on a `1634x1634` image. Its normalized boxes were technically present, but cup area exceeded disc area: ratio `1.3225`. The output was rejected as `INVALID` with the reasons that cup area/ratio exceeded the disc and the geometry was not clinically admissible.

The candidate artifact hash matched `22e45131b64eb07a5d29a2e5388a7709d10696b13f48d2d0cdcf56cafa1f9ea5`. The probe timing was import `53.029s`, load `1.957s`, and inference `14.916s` on CPU. This is an engineering probe, not clinical CDR measurement.

## 26. Glaucoma evidence pathway

The application can preserve structured evidence such as clinician-entered visual-field, IOP, pachymetry, laterality, and anatomy observations when those values are actually sourced. Phase 4 adds strict disc/cup output checks and blocks invalid candidate anatomy before presentation.

There is no validated local glaucoma classifier, no accepted glaucoma risk model, no validated CDR measurement, and no inference from optic-disc geometry alone. The glaucoma lane therefore ends in structured evidence plus clinician correlation, not a glaucoma label.

## 27. Cornea

No artifact-backed corneal or anterior-segment model is registered for execution. The specialist lane preserves missing evidence and routes to professional review. It does not infer corneal disease or normality from a fundus/OCT model absence.

## 28. Cataract

No validated local cataract/lens model is registered. Cataract claims, grading, or treatment advice are unavailable unless supported by separately sourced and reviewed evidence. The system does not use a fundus lesion detector as a cataract detector.

## 29. Other specialties

Neuro-ophthalmology, pediatric ophthalmology, uveitis/inflammation, and ocular oncology have no promoted local artifact in this release. Their specialist records are routing and evidence-boundary structures, not disease engines. Unsupported specialty requests remain incomplete rather than being filled by a general model.

## 30. Disease coverage matrix

| Area | Local artifact | Evidence state | Allowed output |
|---|---|---|---|
| Fundus lesions | Yes | Research-only; overlap/distribution limits | Lesion-like regions with provenance and limitations |
| DR grading | Yes | Research-only; low sensitivity in higher grades | Ordinal research grade, no diagnosis/referral |
| OCT class | Yes | Research-only; Kermany overlap and Duke shift | Separate uncalibrated class observation |
| Optic disc/cup | Candidate | Invalid geometry observed; candidate-only | Validated technical anatomy only, if output passes |
| Glaucoma | No validated model | Missing clinical evidence | Structured evidence/correlation only |
| Cornea/cataract | No validated model | Unsupported | No automated condition claim |
| Other specialties | No validated model | Unsupported | Routing and missing-evidence disclosure |

## 31. Specialist matrix

The specialist orchestrator uses modality and evidence routing for RETINA, GLAUCOMA, CORNEA, CATARACT, NEURO_OPHTHALMOLOGY, PEDIATRIC, UVEITIS, OCULAR_ONCOLOGY, and GENERAL/UNSUPPORTED paths. The matrix describes which specialist should review evidence; it is not a claim that every lane has an executable model.

Fundus lesion/DR work routes to retina. OCT class results remain modality-specific. Optic-disc/cup candidate output can inform a glaucoma review queue only as bounded anatomy evidence. Symptoms, document-derived urgency, laterality, and clinician-entered measurements remain separate evidence streams.

## 32. Evidence fusion

`fuseResearchSignals()` compares same-study categorical signals. It can return `CORROBORATED_RESEARCH_EVIDENCE`, `MODEL_DISAGREEMENT`, `CONSISTENT_RESEARCH_NEGATIVE`, `SINGLE_RESEARCH_MODEL`, or `NO_RESEARCH_MODEL_OUTPUT`.

It never averages scores, treats an uncalibrated score as probability, or lets one model erase another. OCT is explicitly retained as a separate uncalibrated modality observation. “Corroborated” means two research outputs agree; it does not mean confirmed disease.

## 33. Dependency groups

The pipeline preserves dependency groups so a global OOD/quality failure can block dependent imaging execution without fabricating downstream findings. Fundus lesion and DR outputs can be compared only when their source asset and study scope match. OCT aggregation requires an explicitly linked scan set and laterality compatibility.

Urgent symptom/document evidence is not dependent on a model result. A missing model cannot erase urgency, and an imaging model cannot manufacture symptoms, treatment history, or clinical measurements.

## 34. Contradictions

The fusion layer emits explicit flags:

- `DR_BELOW_REFERABLE_THRESHOLD_BUT_LESION_SIGNAL`
- `DR_REFERABLE_WITHOUT_SUPPORTED_LESION_SIGNAL`

Mixed OCT classes emit `MIXED_OCT_CLASS_RESULTS` rather than a majority winner. Invalid anatomy emits `MODEL_OUTPUT_INVALID`. Contradictions remain visible for clinician reconciliation; no automatic adjudication is performed.

## 35. Missing evidence

Missing device compatibility, missing laterality, absent anatomy channels, failed scans, absent models, unavailable medication sources, missing ground truth, and unsupported specialties are all represented as missing/incomplete/unknown states. Missing device metadata on the image-only DEMO path is advisory because the path makes no device claim; modality, quality, image-characteristic, and OOD gates still apply. Research execution must never be mistaken for device validation.

## 36. Symptoms

Symptoms are document/user evidence, not image inference. The existing extraction and symptom pathway preserves source, laterality, confidence/unknown state, and clinician review. The Phase 4 acceptance pack forbids invented symptoms and retains the rule that a model cannot assert “no symptoms.”

## 37. Urgency

Urgency remains independently derived from explicit red-flag symptom evidence and document evidence. A sudden-vision-loss or comparable red flag can produce an urgent review state even when imaging has zero findings or no model is available. Imaging does not lower that urgency, and absent symptoms do not prove safety.

## 38. Temporal reasoning

Longitudinal comparison uses real persisted timestamps, explicit same-eye/laterality links, and observed-difference states. It does not claim progression, improvement, stability, or treatment response without sufficient comparable evidence. “Prior/current” language is kept separate from causal clinical interpretation.

## 39. Laterality

OD, OS, bilateral, and UNKNOWN are preserved as source-bound values. Unknown or contradictory laterality is not silently repaired. OCT aggregation refuses to pool unknown/bilateral mixed scans, and cross-source evidence does not associate an OD measurement with an OS symptom as if they were the same eye.

## 40. Condition knowledge base

The condition layer is deterministic and structured. It records evidence categories, possible-condition patterns, contraindications, missing evidence, and review requirements. An AI finding alone cannot become `SUPPORTED_CONDITION`; a possible pattern still requires clinician correlation.

No generated prose is treated as a knowledge source. The knowledge layer cannot supply a diagnosis, a normality claim, or a medication plan when the required evidence is absent.

## 41. Knowledge sources

Phase 4 did not add an external clinical knowledge source or silently import remote facts. Existing source references and evidence provenance remain visible, while unsupported relationships are left unknown. A future source must be versioned, licensed, reviewed, and linked to the exact displayed claim before use.

## 42. Medication research

Medication behavior remains fail-closed. The Phase 4 synthetic cases expect `NO_DEFENSIBLE_SOURCE_FOUND` where medication evidence is not actually available. The system does not infer a medication from an image, condition pattern, symptom, or model score.

## 43. Medication registry

No medication registry was promoted in Phase 4. There is no defensible source/version/license/review record sufficient for patient-specific medication lookup or recommendation. The absence is shown as unavailable rather than replaced by a generic drug list.

## 44. Medication safety

Medication names, dosing, contraindications, and changes remain outside the imaging model boundary. The application must not recommend, stop, or alter treatment. Any future medication integration requires an authoritative source, patient/context verification, interaction checks, audit history, and explicit clinician ownership.

## 45. Worker architecture

The durable SQLite queue has persisted job states, transactional claim ownership, lease expiry, heartbeat, retry/backoff, cancellation, fencing, startup recovery, and an optional external `npm run worker` process. The default worker pass is bounded to one job. Providers execute in local subprocess boundaries and preserve failure state rather than returning partial JSON as success.

Phase 4 adds explicit nonzero-exit rejection in the SegFormer, DR, OCT, and lesion bridges before JSON parsing. A child that exits unsuccessfully cannot become a fabricated finding.

## 46. Memory governor

`NOT IMPLEMENTED / BLOCKER.` There is no host-wide memory governor that budgets concurrent model subprocesses using available memory, model weight size, or measured working set. This is important because historical CPU probes used approximately `0.44–1.39 GB` working-set scale depending on model.

## 47. CPU threading

Fundus probes cap PyTorch intra-op threads at four by default (bounded to 16), but inter-op, OpenMP/MKL, ONNX Runtime, and SegFormer budgets are not uniformly governed across all processes. CPU settings are recorded as engineering configuration, not a throughput or capacity guarantee.

## 48. Resident-worker experiment

`NOT RUN.` The current benchmark uses isolated subprocess calls and does not prove a resident model worker, safe warm reuse, bounded memory growth, or cross-job state isolation. A resident-worker experiment requires model hash, process count, thread settings, warm-up policy, RSS/private bytes, failure recovery, and teardown evidence.

## 49. Queue telemetry

The queue persists created, claimed, started, completed, retry, heartbeat, and lease fields, but no released Phase 4 load run establishes queue-wait distributions, backlog age, claim-to-start latency, retry rates under load, fairness, or jobs/second. Telemetry is structurally present but operational performance evidence is incomplete.

## 50. Job deadline

Provider subprocess timeouts exist, but `processJob()` has no demonstrated overall job deadline covering extraction, model execution, persistence, reporting, and finalization. A future queue-level deadline must produce an auditable timeout state and safely recover the lease.

## 51. Process tree termination

`NOT PROVEN.` Provider timeout behavior does not yet prove complete Windows process-tree termination or absence of orphan descendants. A centralized process-tree termination utility, child-PID audit, and forced-kill test are remaining engineering work.

## 52. Crash matrix

The existing suite proves lease recovery after a temporary worker process exits and covers database, backup, extraction, and transactional failure paths. It does not yet kill a real model worker at every durable boundary: provider execution, heartbeat, model timeout, persistence, report finalization, database lock, OOM, and process-tree teardown. The full crash matrix remains partial.

## 53. Performance before

The stored SegFormer engineering benchmark (`docs/generated/model-performance.json`) recorded three cold and three warm isolated subprocess probes:

| Mode | p50 | p95 | Samples |
|---|---:|---:|---:|
| Cold | `9,900.7 ms` | `10,356.0 ms` | 3 |
| Warm filesystem/module state | `9,514.6 ms` | `10,026.4 ms` | 3 |

The benchmark also records import times of `7.030–7.535s`, load times of `0.461–0.506s`, and inference times of `1.341–1.379s`. `peak_rss_bytes` is null because no portable RSS high-water measurement was captured. These are engineering timings, not a clinical latency SLO.

## 54. Performance after

`NOT MEASURED as a comparative Phase 4 performance result.` Phase 4 changed contract validation, routing, and failure semantics, not a measured runtime optimization. No post-change throughput, latency, memory, or capacity improvement is claimed.

## 55. Peak memory

The current generated benchmark says `peak_rss_observed: false` and `peak_rss_bytes: null`. Historical process-tree working-set samples were approximately lesion `1.34–1.39 GB`, DR `0.442 GB`, OCT `1.07 GB`, and SegFormer `1.235–1.245 GB`. They are host-specific sampled working sets, not a production RSS guarantee.

## 56. Queue latency

`NOT MEASURED.` No accepted p50/p95/p99 queue wait or backlog-age measurement exists. The queue fields permit future measurement, but fields alone are not latency evidence.

## 57. Service latency

`NOT MEASURED as a service SLO.` Model probe timings are isolated engineering measurements. End-to-end service latency, extraction time, database contention, report generation, and browser-to-API time were not combined into a capacity claim.

## 58. Concurrency

The default local worker pass is bounded to one job, but multiple processes can still launch heavy subprocesses without a host-wide governor. No concurrent real-model load run proves safe memory, CPU, fairness, or throughput. The platform therefore makes no multi-worker capacity claim.

## 59. Hallucination architecture

The safety architecture is contract-first: structured model outputs, source-bound findings, artifact/preprocessing provenance, explicit state enums, claim-ledger fields, output-invalid rejection, OOD gating, and clinician-review requirements. Free-form language cannot upgrade an unavailable or unvalidated result into a diagnosis.

## 60. Claim ledger

The report and reasoning records preserve claim provenance and dependency references. Claims are classified as observed, model-produced research evidence, possible condition pattern, limitation, or unavailable. A finding without the required source/model/artifact evidence is rejected or shown as unknown; it is not silently filled by text generation.

## 61. OOD

The pipeline applies modality, quality, image-characteristic, and OOD gates before research model execution. A global OOD state skips dependent lesion/DR/OCT research work with an explicit reason. Missing device metadata is not treated as proof of compatibility; the DEMO image-only path discloses domain/device validation uncertainty instead.

## 62. Quality gates

Quality gates cover MIME/content validation, fundus/OCT routing, image dimensions and characteristics, artifact identity, preprocessing, output schema, failure status, laterality, and anatomy plausibility. A failed gate results in a controlled unavailable/incomplete/invalid state and remains visible in provenance.

## 63. Adversarial images

The red-team and model tests cover uniform/black/white, random noise, red synthetic content, malformed or extreme image inputs, spoofed client fields, invalid localization, impossible anatomy, and unavailable model behavior. Random noise and red content are retained as false-alarm candidates; they are never converted to clinical findings.

## 64. Adversarial PDFs

The document pipeline tests malformed files, native text versus scanned pages, OCR timeouts, page limits, cancellation, duplicate/integrity checks, path traversal, unsafe assets, and backup/restore tamper cases. Extracted text is provenance-bound and cannot autonomously become a diagnosis or medication instruction.

## 65. Security

The full security suite covers authentication and lockout, RBAC, tenant/patient scope, IDOR/cross-tenant access, CSRF, upload spoofing, traversal/reparse-point hazards, document integrity, backup encryption/tamper handling, query spoofing, model manifest tamper, and failure-state disclosure. API handlers remain the substantive security boundary; UI gating is not relied upon.

## 66. PHI

The tracked validation cases, generated model reports, SBOM, screenshots, browser fixtures, and CI paths are synthetic or de-identified. Generated evidence records state `phi_included: false`. Local ignored storage can contain user-controlled data by design; the release checks do not claim that an arbitrary operator's local disk is PHI-free.

## 67. Secrets

No provider credential or secret is required for the default local path. The scan and tracked artifacts contain no high-confidence secrets. Local smoke credentials are ephemeral/test-scoped and are not a production credential. Authentication boundaries were not crossed or changed as part of Phase 4.

## 68. UI

Phase 4 did not introduce a visual redesign. Existing UI surfaces continue to show research-only status, limitations, model availability, evidence provenance, specialist routing, review requirements, and non-normal wording. No UI text is permitted to imply clinical certainty, disease absence, or treatment authority.

## 69. Specialist Center

The Specialist Center routes the available modality/evidence bundle to a named review lane and presents unsupported lanes as unsupported. It does not pretend that a lane has a model merely because it has a card, route, or UI destination.

## 70. Model validation UI

The validation surfaces are restricted governance views for model identity, validation records, limitations, errors, and registry state. They do not execute a candidate merely by listing it, and they do not let a client-supplied status promote a model.

## 71. Viewer

The viewer supports original/overlay/side-by-side presentation only for finite, bounded, source-linked regions. Unsupported masks, markers, heatmaps, or measurements are shown as unavailable. The invalid SegFormer geometry cannot be rendered as a valid CDR or glaucoma overlay.

## 72. Report

The report path persists an immutable, version-frozen snapshot with model/artifact/provenance fields, limitations, review state, and claim boundaries. It cannot turn a research observation into a diagnosis. Red-flag symptom evidence remains visible even when model execution is unavailable.

## 73. Screenshots

The repository preserves `14` PNG screenshots under `docs/qa/screenshots/`. The README identifies them as PHI-free synthetic UI evidence captured from the local application on 2026-09-12. Phase 4 did not create new screenshots because it did not change the visual layout; current browser scripts were rerun separately.

## 74. Responsive

Real-Chrome responsive QA passed `80/80` across ten routes and widths `320, 375, 414, 768, 1024, 1280, 1440, 1920`. The first cold-route login attempt timed out during server warm-up; the bounded retry passed. The retry result, not the transient cold-start failure, is the accepted local result, with the warm-up caveat retained.

## 75. Accessibility

Automated axe-based accessibility QA passed `20/20`: ten routes at mobile and desktop widths. This does not claim manual NVDA/JAWS/VoiceOver testing or full assistive-technology coverage.

## 76. Keyboard

Real keyboard/focus QA passed `21/21`, including login, navigation, protected routes, mobile drawer behavior, focus handling, and keyboard-accessible scrolling/toggles. This is browser automation evidence, not a claim that every assistive technology combination has been tested.

## 77. Acceptance tests

The Phase 4 acceptance pack is `validation-cases/phase4-nextgen-local-intelligence-pack.json`: `40` synthetic cases and `40` contract assertions. It covers DR failure visibility, high-grade undercall boundaries, lesion limitations, OCT aggregation and domain shift, invalid anatomy, OOD/dependency behavior, fusion contradictions, missing device metadata, no-model wording, medication absence, provenance, laterality, adversarial inputs, and specialist routing.

The dedicated Phase 4 test file passed `18/18` tests with no skips in the equipped run. The explicit CI command is model-free and runs serially with one worker.

## 78. Full tests

The equipped local full suite passed with `76` files passed and `1` skipped; `1,042` tests passed and `10` skipped; exit code `0`. The final fresh no-model checkout at `ede958e` passed `76` files and `1` skipped; `1,009` tests passed and `43` skipped; exit code `0`.

The expected stderr from negative restore/tamper tests appeared during the suite, but those tests passed by asserting rejection. No full-suite result is reported as green without the final process exit.

## 79. Model-equipped tests

Equipped validation included the full local suite, targeted Phase 4/localization/research/safety tests (`55` passed and `1` skipped in the focused run), the prior Phase 3/model acceptance set (`136` passed), model manifest audit (`3/3` pass), and browser asset E2E. Asset E2E passed metadata-free fundus upload, local lesion+DR research analysis, mixed-PDF extraction, three routed pages, eight OCT ROI candidates, and report provenance.

The equipped evidence is local and model-hash verified. It does not promote any artifact to clinical status.

## 80. No-model tests

The third fresh checkout contained no ignored model artifacts. After correcting the stale S13 expectation, its full model-free suite passed `1,009/1,009` executed tests with `43` intentional skips. A no-model run reports `GENERAL FUNDUS ABNORMALITY MODEL UNAVAILABLE — CLINICAL INTERPRETATION NOT AVAILABLE`; it does not fabricate synthetic findings or call the result OOD solely because DEMO has no device metadata.

## 81. TypeScript

`npx tsc --noEmit` passed with exit code `0` in the final fresh no-model checkout. The equipped implementation also passed the prior typecheck gate.

## 82. lint

`npm run lint` passed with exit code `0` on the equipped implementation checkout. The final no-model changes were test wording/comment alignment only; the implementation was typechecked and built in the exact clean checkout.

## 83. build

`npm run build` passed with exit code `0` in the final clean checkout using Next.js `16.3.4` webpack. TypeScript completed, and `21/21` static pages were generated. The route inventory included the protected analysis, specialist, validation, models, report, compare, and API paths.

## 84. smoke

`npm run smoke` passed `16/16` in the local isolated server workflow. It covered authentication, upload, symptoms, research analysis, urgent triage, report, clinician review/finalization, comparison, self-test, deletion, and access-control behavior. It used synthetic data and a local-only auth flag in an isolated test server.

## 85. model audit

`npm run model:audit` passed with `3` manifests found and all `3` passing identity/integrity checks. The model audit reported `patient_data_included: false`. The three registered artifacts remain `RESEARCH_ONLY`; the SegFormer candidate hash was independently checked against the installed file and remains `CANDIDATE_ONLY`.

## 86. filesystem audit

`npm run audit:fs` passed. The project/data/model/log/temp roots were on `D:` with approximately `387.8 GB` free at the observed check. This is a workspace-path audit, not a claim about all drives or every operator-managed file.

## 87. SBOM

The de-identified CycloneDX SBOM command completed with exit code `0`; the generated inventory contained `464` components and no PHI. It is an inventory artifact, not a vulnerability waiver. The clean `npm ci` install emitted the repository's existing dependency warnings, including two moderate audit findings in the fresh dependency tree; production dependency audit evidence remains separate from this SBOM result.

## 88. clean checkout

The final clean checkout was `D:\visionscan-phase4-clean-20260913c`, detached at `ede958e`, with no model artifacts copied into it. It ran `npm ci`, `npm run setup`, `npm run db:init`, the full serial model-free test suite, `npx tsc --noEmit`, and `npm run build`. All required commands exited `0`; the full test suite had `43` expected skips because optional model/bridge artifacts were absent.

Earlier clean checkouts exposed and helped correct a real DEMO state-classification regression. That history is retained in separate worktrees; no destructive cleanup was performed.

## 89. Linux CI

The exact implementation SHA has a successful Linux `verify` job in Actions run `34711160836`. Its job includes install, SQLite initialization, typecheck, serial unit/integration tests, migration/backup dry-runs, synthetic benchmarks, validation-case contract, explicit Phase 4 acceptance, model audit, SBOM, release inventory, filesystem audit, and build. The historical green run is not substituted.

## 90. Windows CI

The exact implementation SHA has a successful native Windows `verify-windows` job in Actions run `34711160836`. It includes Windows path/reparse-point tests, the serial full suite, explicit Phase 4 acceptance, model audit, SBOM, filesystem audit, and build. Local clean-checkout evidence also passed the required model-free commands.

## 91. Browser CI

The exact implementation SHA has a `verify-browser` job in Actions run `34711160836`. It runs an isolated empty SQLite store, synthetic account, no model weights, no patient data, and no provider credentials. The job completed successfully during the observed poll. Its hosted smoke scope is `6/6`: login/dashboard and HTTP `200` checks for `/dashboard`, `/patients`, `/analyze`, `/result`, and `/report`.

The larger `80/80`, `20/20`, `21/21`, and asset-E2E suites are local Chrome evidence and are not mislabeled as hosted deployment certification.

## 92. Independent auditor

Scoped read-only audit work was requested in parallel for code, model, safety, worker, UI, and release evidence. The final requested three-person sign-off for every new model was not completed because the agent-thread concurrency limit blocked an additional independent adversarial reviewer. No candidate was promoted, so the missing reviewer is a release blocker rather than hidden as approval.

Independent final audit classification: `PARTIAL / NOT PROVEN`.

## 93. Remaining engineering blockers

- No host-wide memory governor or unified CPU-thread budget.
- No demonstrated queue-level overall job deadline.
- No centralized, tested Windows process-tree termination guarantee.
- No resident-worker experiment or real concurrent-load/capacity evidence.
- No full real-worker crash matrix across model execution and durable transitions.
- No final production deployment proof for external TLS, disk encryption, operational secret management, and hosted release controls.

## 94. Remaining model blockers

- DR referable sensitivity remains `0.4389`, with grade 3 sensitivity `0.0441` and grade 4 sensitivity `0.0000`.
- No independently validated DR candidate or head-to-head result.
- Lesion region-level FP/FN burden remains unmeasurable on the available exports.
- OCT Kermany evidence overlaps the reported training distribution; Duke mapping is approximate and domain-shifted.
- SegFormer anatomy candidate produced invalid cup/disc geometry and is not a glaucoma model.
- No validated cornea, cataract, or other specialty models.

## 95. Remaining data blockers

The release-data check remains `BLOCKERS_REMAIN` with `active_unresolved_sources: 235`, `legacy_unresolved_sources: 118`, `active_fk_orphan_count: 0`, `legacy_orphan_count: 5263`, `cross_tenant_count: 0`, `hash_mismatch_count: 0`, and `quarantine_count: 81`. Active reasons are `233` missing required artifacts and `2` detached analysis parents. Legacy relationships are classified as `5260` detached documents, `2` detached analyses, and `1` detached job.

`npm run release:data-check` exited `1` as an expected negative release gate. No active source was silently deleted, reassociated, or released.

## 96. Remaining clinical blockers

There is no prospective clinical validation, reader comparison, calibration accepted for clinical use, subgroup/device validation, clinical safety study, regulator/device determination, or clinician-owned deployment protocol. The application has not established disease absence, triage safety, treatment benefit, or autonomous diagnostic performance.

## 97. Exact capabilities

At this release, VisionScan can:

- execute three pinned local research artifacts when their registry, hash, preprocessing, modality, quality, and output contracts pass;
- preserve artifact, source, model, laterality, and limitation provenance;
- expose DR/lesion disagreement without score averaging;
- aggregate comparable OCT categorical outputs without inventing a winner;
- reject impossible optic-disc/cup geometry;
- fail closed on missing models, OOD inputs, bad worker exits, invalid output, missing evidence, and unsupported specialties;
- route evidence to specialist review lanes;
- preserve document-derived symptoms/urgency separately from imaging;
- run a controlled local synthetic demo with review and audit boundaries.

## 98. Exact non-capabilities

It cannot safely claim or perform:

- clinical diagnosis, disease exclusion, or autonomous triage;
- a calibrated probability, clinical referral threshold, or universal accuracy;
- glaucoma diagnosis or clinical CDR measurement from the candidate anatomy path;
- validated cornea, cataract, neuro-ophthalmic, pediatric, uveitis, or oncology inference;
- medication selection, dosing, interaction advice, or treatment change;
- zero false negatives, zero false positives, hallucination-free behavior, or medical-grade performance;
- safe multi-worker capacity, resident-model behavior, complete process-tree termination, or production SLOs;
- release of unresolved active/legacy data.

## 99. Software classification

**ENGINEERING PARTIAL — BLOCKERS REMAIN.** The software safety boundaries, local workflows, test evidence, and failure states are materially stronger after Phase 4, but unresolved worker/resource controls, data release blockers, and deployment hardening prevent a production-ready claim.

## 100. Model classification

**MODEL INTELLIGENCE PARTIAL.** Three local artifacts have reproducible technical evidence and explicit limitations; the anatomy candidate is bounded and rejected when invalid. Evidence is insufficient for clinical validation, diagnosis, device compatibility, or disease absence.

## 101. Data classification

**DATA RELEASE BLOCKED.** The current data gate remains blocked by `235` active unresolved sources, `118` legacy unresolved sources, and `5263` legacy orphaned foreign-key references. No source retirement or repair is implied by this report.

## 102. Demo classification

**CONTROLLED LOCAL RESEARCH DEMO.** The local synthetic workflow is demonstrable with model-equipped and no-model states, clinician-review gates, source provenance, specialist routing, and explicit limitations. It is not a patient-facing clinical service.

## 103. Clinical classification

**NOT CLINICALLY VALIDATED. NOT A MEDICAL DEVICE. NOT FOR AUTONOMOUS DIAGNOSIS.**

No section of this report, model output, screenshot, benchmark, or CI result should be read as authorization to diagnose, exclude disease, prescribe treatment, or release patient data.
