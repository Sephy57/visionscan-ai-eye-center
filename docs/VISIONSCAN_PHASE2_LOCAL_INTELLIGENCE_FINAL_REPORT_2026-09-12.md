# VisionScan Phase 2 Local Intelligence — Final System Report

**Report date:** 2026-09-12 (Asia/Manila)  
**Repository:** `D:\AI EYE ANALYSIS PLATFORM`  
**Scope:** Phase 2 local research intelligence implementation, safety gates, specialist review contracts, PDF intelligence, worker separation, benchmark instrumentation, UI evidence surfaces, and release verification.  
**Evidence standard:** This report records observed repository state, test exits, local benchmark output, and real Chromium checks. It does not convert research output into clinical performance or device claims.

## 1. Starting repository state

The starting workspace was the existing VisionScan repository at `D:\AI EYE ANALYSIS PLATFORM`. It contained the prior Phase 1 safety, consent, provenance, data-governance, model-registry, and reporting changes, together with a deliberately dirty working tree. The existing tree was treated as user-owned history: no reset, checkout, broad cleanup, destructive data closure, commit, or push was performed.

The system already had a local Next.js application, SQLite-backed analysis/job data, research model manifests, a Python inference bridge, document extraction, specialist evidence packages, and prior reports. The Phase 2 work was applied on top of that state.

## 2. Preserved previous changes

Prior changes and reports were preserved, including the Phase 1 consent/authentication boundary, provenance-preserving extraction, model integrity checks, clinician-review gates, evidence synthesis, legacy-data policies, existing reports, and the prior 235 active-data and 5,263 legacy-reference blockers. Existing four legacy specialist package IDs (`RETINA`, `GLAUCOMA`, `MACULA_OCT`, and `COMPREHENSIVE`) remain available; the new nine-specialty view is additive.

No unrelated dirty-tree work was reverted. Phase 2 files and edits remain uncommitted for user review.

## 3. Starting HEAD

Starting HEAD was `3c702f2881d1ab6281ec301c6ff346dd22ae0d50`.

## 4. Ending HEAD

Ending HEAD remains `3c702f2881d1ab6281ec301c6ff346dd22ae0d50`. The implementation is currently a working-tree change set, not a new commit.

## 5. Commits

No commit was created. This preserves the user's existing branch/history and leaves review and commit boundaries under the user's control.

## 6. Push

No remote push was performed. The configured remote was not changed, and no external repository state was mutated.

## 7. Exact final CI

GitHub CI was not run because no commit or push was requested. The authoritative local release verifier was run from the final working tree with:

```text
npm run release:verify
```

Final summary: `D:\AI EYE ANALYSIS PLATFORM\data\tmp\release-verify-20260912133632-summary.json`  
Generated at: `2026-09-12T13:50:18.537Z`  
Source commit recorded by the verifier: `3c702f2881d1ab6281ec301c6ff346dd22ae0d50`

The exact aggregate result was **11/12 checks passed, 1 failed, status `BLOCKED`**. Passed checks were lint, typecheck, unit tests, production dependency audit, model-manifest audit, filesystem audit, SBOM, release inventory, foreign-key preflight, reconciliation/adjudication, and production build. The only failing check was `release_data_check` with exit code 1. The failure is the pre-existing/current data-release gate, not a test or build failure. `phi_included:false`.

## 8. Architecture changes

Phase 2 adds an explicit local-research intelligence layer around the existing pipeline:

- specialist results now expose execution state, models used, evidence reviewed, evidence for/against, contradictions, missing evidence, urgency, and mandatory review;
- the claim ledger carries categorical certainty plus source, model-execution, rule, and knowledge-source references;
- condition evidence has an explicit non-diagnostic state vocabulary;
- PDF extraction classifies full text for instruction-like prompt injection and skips unsafe instruction sentences;
- the job queue supports an external-worker mode with lease/recovery semantics;
- `npm run worker` runs a separate local worker process that claims and processes SQLite jobs;
- `npm run model:benchmark` runs bounded local model probes and samples the probe process tree;
- a 20-case Phase 2 validation manifest and 21-test acceptance suite exercise the local contracts;
- the UI discloses actual model, artifact, modality, status, integrity, latency, research, consent, evidence, and missing-data state.

## 9. Specialist implementation matrix

The UI and specialist contracts use the exact Phase 2 specialty set:

| Specialty | Current capability state | Honest output boundary |
|---|---|---|
| `COMPREHENSIVE` | No validated specialist model | Review aggregation and missing-evidence state only |
| `RETINA` | Fundus research models plus isolated optic-disc/cup research probe | Research findings/localization; clinician review required |
| `GLAUCOMA` | No validated glaucoma model | No glaucoma diagnosis, calibrated risk, or cup-to-disc conclusion |
| `CORNEA_EXTERNAL` | No integrated model | Explicit unavailable state |
| `CATARACT_LENS` | No integrated model | Explicit unavailable state |
| `NEURO_OPHTHALMOLOGY` | No integrated model | Explicit unavailable state |
| `PEDIATRIC` | No integrated model | Explicit unavailable state |
| `UVEITIS` | No integrated model | Explicit unavailable state |
| `OCULAR_ONCOLOGY` | No integrated model | Explicit unavailable state |

The persisted specialist result contract uses explicit `EXECUTED`, `NOT_EXECUTED`, `BLOCKED`, or `FAILED` execution states and never turns model failure into “nothing detected.”

## 10. Model inventory

The installed local manifest inventory contains three research-only model packages:

1. `fundus-dr-grading-effb0` — local SafeTensors fundus DR grading artifact, research-only and uncalibrated.
2. `fundus-lesions-clementp-unet-seresnext50` — local SafeTensors fundus lesion-segmentation artifact, research-only and uncalibrated.
3. `oct-retinal-weights-fp32` — local ONNX OCT artifact, research-only and uncalibrated.

The `segformer-optic-disc-cup-refuge` candidate is a separate local research probe under `scratch/models`; it is deliberately not registered in the production model registry. It may be attempted only through the narrow research capability path and is never treated as a clinically validated model.

## 11. New candidate models researched

The candidate review covered public source/model pages and repositories, including [EyeeSEE](https://huggingface.co/Nj-1111/EyeeSEE), [the optic-disc/cup SegFormer candidate](https://huggingface.co/pamixsun/segformer_for_optic_disc_cup_segmentation/tree/main), [RetGuard](https://github.com/anchor-neuro/retguard), [DIRD](https://github.com/Debaq/Dird), [FunduSegmenter](https://huggingface.co/JusticeZzy/FunduSegmenter/blob/main/README.md), [OPENEye-FM](https://github.com/yangzhou12/OPENEye-FM), [Luna](https://huggingface.co/loopback-kr/Luna), [a YOLO optic-disc candidate](https://huggingface.co/DigitalHolography/YOLO_OpticDisc), and [an OCT classification repository](https://github.com/mr7495/OCT-classification).

The review used the Phase 2 acceptance contract: source, license, exact artifact, hash, task/classes, architecture, preprocessing, output semantics, validation evidence, CPU feasibility, safe serialization, and absence of hidden remote or paid inference. No candidate was promoted to a clinical or production-approved registry.

## 12. Accepted models

The three installed manifests are accepted for bounded local research execution because their local artifacts, checksums, modality routing, output contracts, and research-only status are explicit. Acceptance means **research execution only**, not clinical validation, autonomous diagnosis, or medical-device approval.

The SegFormer candidate is accepted only as an isolated research probe. Its local SafeTensors artifact and CPU execution are real, but it is not registry-enabled and is not accepted as a glaucoma model or disease classifier.

## 13. Rejected models and exact reasons

The following candidates were not accepted into the integrated model registry:

- **EyeeSEE:** the locally reproducible contract, licensing scope, exact artifact/integrity evidence, and intended-use validation were incomplete for this deployment.
- **RetGuard:** public source/code did not establish a complete safe local model artifact/runtime contract suitable for this pipeline.
- **DIRD:** paper/code availability did not establish a deployable validated artifact with a complete license, CPU, preprocessing, and output contract.
- **FunduSegmenter:** model-card task/classes/validation evidence was insufficient for activation in this system.
- **OPENEye-FM:** foundation-model scope, weights/runtime, licensing, task-specific output semantics, and validation were not sufficiently bounded for the current use.
- **Luna:** general vision-language/foundation scope was not an evidence-grounded ophthalmic specialist classifier with an approved local contract.
- **YOLO optic-disc candidate:** artifact, validation, preprocessing/output contract, and deployment evidence were insufficient.
- **OCT classification repository:** no current accepted artifact, license, CPU/runtime, and dataset contract was established for this deployment.

The optic-disc/cup SegFormer was not promoted: real local inference was demonstrated, but it has no published disease validation and a generic fundus probe produced anatomically implausible behavior. It remains `CANDIDATE_ONLY` and isolated.

## 14. Licenses

The current manifest declarations are:

- DR checkpoint: `MIT` as published for the checkpoint/training code, with training-data terms still applicable.
- Lesion checkpoint: `MIT` as published for model code/checkpoint, with training-data terms unresolved and documented as a blocker for broader reuse.
- OCT artifact/training code: `MIT` as published for the checkpoint/training code, with source-specific dataset terms still requiring review.
- SegFormer probe: `Apache-2.0` as declared for the candidate artifact/source.

These declarations are provenance metadata, not a blanket assertion that every upstream training dataset or commercial clinical use is cleared. Dataset redistribution, jurisdiction, intended use, and downstream commercialization require separate human/legal review.

## 15. Artifact hashes

The exact verified artifact SHA-256 values are:

| Model | Artifact | SHA-256 |
|---|---|---|
| `fundus-dr-grading-effb0` | `data/models/fundus-dr-grading-effb0/model.safetensors` | `0d9a18b0cb6c90d1f30bf2e66153b368bd7ff0bcb45b6690e8d5ce14fa19f69b` |
| `fundus-lesions-clementp-unet-seresnext50` | `data/models/fundus-lesions-clementp-unet-seresnext50/model.safetensors` | `a7a7cb45b92328f7c9a8e581eec3944fd435d37fae8cbf340b1319c5f987c6d2` |
| `oct-retinal-weights-fp32` | `data/models/oct-retinal-weights-fp32/human_eye_fp32.onnx` | `22b1fffb5a0ab88284d4c5817c581bedb1b54c09011d87c3f6472cb2c36b2b1f` |
| `segformer-optic-disc-cup-refuge` | `scratch/models/segformer-optic-disc-cup-refuge/model.safetensors` | `22e45131b64eb07a5d29a2e5388a7709d10696b13f48d2d0cdcf56cafa1f9ea5` |

Model execution records expose model ID, version, artifact hash, task, status, and preprocessing. Integrity mismatch fails closed.

## 16. Local runtime

The local runtime uses the repository's Python environment and CPU execution. The SegFormer probe was run with PyTorch `2.14.0+cpu` and Transformers `5.16.1`; the installed models use their declared local SafeTensors or ONNX path. No paid inference API, hidden remote model call, or remote runtime dependency was introduced.

The model contract explicitly prefers SafeTensors/ONNX, does not enable `trust_remote_code=true`, records preprocessing/output semantics, and refuses model/task/modality mismatch. The benchmark's model subprocesses are bounded and observable.

## 17. Fundus validation

Fundus routing and local research execution were verified end-to-end with a real local fundus image. The lesion and DR research models both completed on the manual flow, and the output displayed their actual model IDs, artifact prefixes, integrity state, modality, laterality, quality, and latency.

The repository contains validation-registry metadata for research comparison datasets and limitations, but this Phase 2 run did not establish prospective clinical validation, reader agreement, deployment validation, or a clinical performance claim. A successful local run means the bounded software path executed; it does not establish diagnostic accuracy.

## 18. Lesion validation

The lesion model executed locally on the fundus path and produced a research localization. The manual result displayed a “microaneurysm-like lesion” research finding, preserved the original pixels in the overlay, and labelled the output uncalibrated and not clinically validated.

No lesion sensitivity, specificity, false-positive rate, false-negative rate, calibrated probability, or clinical diagnosis was claimed. The finding is an image-model output for research review only.

## 19. OCT validation

The OCT model is present as a local FP32 ONNX artifact with an integrity hash and research-only manifest. OCT routing and document-ROI handling are explicit, including unsupported-modality/quality/OOD states.

The manual fundus run correctly marked the OCT model `UNSUPPORTED_MODALITY`; it did not fabricate an OCT result from a fundus image. No clinical OCT validation or performance claim was established by this implementation.

## 20. Glaucoma/optic nerve status

The isolated SegFormer probe targets optic-disc/cup anatomy segmentation only. It is not a glaucoma classifier, does not produce a calibrated cup-to-disc ratio or glaucoma risk, and cannot support a glaucoma diagnosis. The glaucoma specialty lane correctly reports no validated glaucoma model available.

The probe's generic-fundus behavior included an anatomically implausible cup-versus-disc result, which is treated as evidence of domain/OOD limitations rather than suppressed or reinterpreted.

## 21. Cornea status

No cornea/external-disease model is integrated. The `CORNEA_EXTERNAL` lane exposes an explicit unavailable state and missing evidence rather than a fabricated result.

## 22. Cataract status

No cataract/lens model is integrated. The `CATARACT_LENS` lane exposes an explicit unavailable state. No cataract presence, severity, or normality is inferred from the available fundus research models.

## 23. Other specialist status

No validated model is integrated for neuro-ophthalmology, pediatric ophthalmology, uveitis, or ocular oncology. The corresponding lanes (`NEURO_OPHTHALMOLOGY`, `PEDIATRIC`, `UVEITIS`, and `OCULAR_ONCOLOGY`) return explicit missing-capability states. Comprehensive review aggregates evidence but does not create a disease conclusion.

## 24. False positives

No false-positive rate was established. The acceptance pack and manual run exercise safety behavior, provenance, mismatch, disagreement, and hallucination boundaries; they are not a statistically powered clinical accuracy study. Research findings must remain subject to clinician review.

## 25. False negatives

No false-negative rate was established. A missing finding, skipped model, unsupported modality, failed quality gate, OOD rejection, or unavailable specialist must never be read as evidence that disease is absent.

## 26. Calibration

The installed research outputs are not calibrated for clinical probability or decision thresholds. The DR value is displayed as an uncalibrated research estimate, and lesion localization is shown as research output. Claim certainty uses categorical states such as `UNKNOWN`, `RESEARCH_SCORE_ONLY`, and `RULE_DERIVED`; the system does not invent probability percentages.

## 27. Domain/device limitations

Population scope and acquisition-device scope remain unknown or incomplete for the research models. Image quality, modality, metadata completeness, laterality, and OOD gates are disclosed. Missing device metadata is represented as domain-validation uncertainty where appropriate, not silently treated as safe in-distribution evidence.

The current system therefore cannot claim generalization across cameras, scanners, populations, sites, languages, clinical workflows, or disease prevalence. It is research software, not a cleared or approved medical device.

## 28. Specialist orchestration

Specialist routing now separates capability from execution and represents model failure explicitly. Each result can include specialty/capability, model outputs, model status, execution state, validation status, quality, OOD state, evidence reviewed, evidence for/against, contradictions, missing evidence, urgency, limitations, disagreements, provenance, and mandatory clinician review.

The orchestration layer never selects a winner by averaging conflicting model outputs. For the manual fundus result, the lesion and DR outputs were both retained and a `MODEL_DISAGREEMENT` was shown because localization and DR threshold semantics differed.

## 29. Evidence graph

Evidence remains traceable from source to normalized evidence item to finding/claim. The graph can carry image, PDF, source-document diagnosis, test result, symptom, history, medication, allergy, clinician observation, AI research finding, model execution, page hash, ROI hash, laterality, temporal state, trust, certainty, and verification status.

The report and clinician view show source references and missing evidence. Unverified document extraction does not become a supported condition, and laterality stays `UNKNOWN` when it cannot be established explicitly.

## 30. Condition reasoning

Condition reasoning is restricted to possible associations and evidence-state display. The new condition state vocabulary is:

`STRONGLY_SUPPORTED_BY_AVAILABLE_EVIDENCE`, `SUPPORTED_BY_AVAILABLE_EVIDENCE`, `POSSIBLE`, `WEAKLY_SUPPORTED`, `INSUFFICIENT_EVIDENCE`, `CONFLICTING_EVIDENCE`, and `CONTRADICTED`.

These states describe the available evidence, not diagnosis. In the manual fundus result, possible conditions were withheld because the available model outputs were not clinically validated. No “normal” conclusion was generated from an empty or blocked result.

## 31. Missing evidence

Missing evidence is first-class in specialist results, condition cards, report sections, and the clinician view. Examples include absent validated models, unknown device/population scope, incomplete laterality, absent clinician confirmation, missing test results, unsupported modality, and unresolved source-document context.

The manual clinician view displayed missing-confirmation items and “no validated model available” states instead of filling gaps with assumptions.

## 32. Contradictions

Contradictions are retained as structured data and shown for review. The manual result recorded an explicit model disagreement between a lesion-localization output and the DR threshold output; neither was automatically promoted to a clinical winner.

Document/test conflicts, laterality conflicts, qualitative conflicts, and source-diagnosis conflicts continue to use the existing evidence-conflict vocabulary and require acknowledgement or review where applicable.

## 33. Claim ledger

Phase 2 claim-ledger schema version is `claim-ledger-1.1.0`. Every Phase 2 claim requires categorical certainty and arrays of `source_ids`, `model_execution_ids`, `rule_ids`, and `knowledge_source_ids`, in addition to clinician-review requirements and provenance.

The manual report showed claims such as `RESEARCH_SCORE_ONLY` and `RULE_DERIVED`, model/evidence references, and `knowledge_source_ids: none` where no defensible knowledge source existed. Traceability and safety validation fail closed when required references are missing.

## 34. Medication source research

Medication governance was reviewed against primary source terms for [openFDA](https://open.fda.gov/terms/) and [NLM RxNorm](https://www.nlm.nih.gov/research/umls/rxnorm/docs/termsofservice.html), including the [openFDA API documentation](https://open.fda.gov/apis/) and [RxNorm file documentation](https://www.nlm.nih.gov/research/umls/rxnorm/docs/rxnormfiles.html).

No authoritative, licensed, locally redistributed medication source with a recorded jurisdiction, update process, and offline-use rights was established for this deployment. The safe result is an empty registry, not a remembered or generated treatment list.

## 35. Medication registry

`lib/treatment/medications.ts` and the treatment-information mapping remain empty for production medication knowledge. The system records `NO_DEFENSIBLE_SOURCE_FOUND` when no governed source is available and uses the wording `POTENTIALLY RELEVANT TREATMENT KNOWLEDGE` only as a governance label, never as a recommendation.

No drug, indication, dose, route, duration, contraindication, or prescription record was invented from model output or an LLM.

## 36. Medication safety

Medication safety is fail-closed: no condition evidence is silently converted into treatment, no medication is selected from a disease association, and no treatment panel implies that a clinician should prescribe. Any future registry must carry source/version/date/jurisdiction/licensing and evidence provenance before activation.

The manual report correctly disclosed that no connected medication source was available and displayed no treatment information.

## 37. Unsupported medication behavior

When the system has no defensible source, the medication surface shows an explicit unavailable/empty state and directs review to an appropriately qualified clinician. It does not produce a medication name, dose, prescription, or treatment plan. This behavior also applies when a condition is only possible, conflicting, unsupported, or derived from an unvalidated research output.

## 38. PDF intelligence

PDF ingestion preserves document/page provenance and routes extracted content through structured evidence. The browser asset E2E exercised a mixed PDF: extraction completed, `pages=3`, and `OCT_ROIs=8` were observed. The report surface discloses PDF routing and research provenance.

Document-derived candidates remain unverified until human review. PDF extraction is not a license to treat a source document's diagnosis as a VisionScan diagnosis.

## 39. Prompt-injection defense

The new deterministic prompt-safety classifier scans full extracted text and identifies instruction-like content such as “You are a doctor,” “Ignore safety,” “Diagnose glaucoma,” “Prescribe prednisolone,” “Mark this patient normal,” and system-override strings. Instruction-like sentences are skipped from clinical extraction, while provenance and safety flags remain available for review.

The Phase 2 acceptance suite includes text-only malicious/instruction strings and asserts that they cannot create diagnosis, normality, symptom, laterality, or prescription claims. The defense is a deterministic boundary, not a claim that arbitrary adversarial documents are solved forever.

## 40. Worker architecture

External worker mode is enabled with `VISIONSCAN_EXTERNAL_WORKER=true`. The intended path is:

`Next.js request -> SQLite job queue -> separate npm run worker process -> local subprocess/model runtime -> SQLite result`.

The API process does not need to own the long-running model subprocess when external-worker mode is selected. The worker is started with `npm run worker` and uses the existing queue contracts.

## 41. Crash recovery

Queue leases, stale-job recovery, bounded processing, failure states, and explicit result persistence are retained. A worker crash or timeout does not become an empty successful analysis. The queue can recover expired leases and persist failure/retry state for review.

The Phase 2 acceptance tests cover worker-mode contracts and failure behavior; no destructive queue purge or data reset was performed.

## 42. CPU benchmarks

`MODEL_BENCHMARK_RUNS=3 node scripts/model-benchmark.mjs` measured four bounded local probes. Timings below are milliseconds and were measured on the deployment's CPU-only Windows environment:

| Model | Cold p50 / p95 | Warm p50 / p95 |
|---|---:|---:|
| `fundus-lesions-clementp-unet-seresnext50` | 8,601.1 / 9,374.8 | 8,550.5 / 8,978.9 |
| `fundus-dr-grading-effb0` | 5,313.2 / 5,354.3 | 5,326.2 / 5,389.3 |
| `oct-retinal-weights-fp32` | 3,130.1 / 4,161.0 | 3,118.6 / 3,138.4 |
| `segformer-optic-disc-cup-refuge` | 9,959.1 / 16,307.5 | 9,751.3 / 10,164.2 |

All four probe statuses were `MEASURED`. These are software/runtime measurements, not clinical utility or service-level guarantees.

## 43. Peak RSS

Peak process-tree RSS was sampled for each bounded probe, excluding unrelated processes and GPU memory. Approximate cold/warm peaks were:

| Model | Cold peak RSS | Warm peak RSS |
|---|---:|---:|
| Lesion | 1,340,567,552 bytes | 1,393,590,272 bytes |
| DR | 441,774,080 bytes | 441,843,712 bytes |
| OCT | 1,069,690,880 bytes | 1,069,977,600 bytes |
| SegFormer | 1,235,030,016 bytes | 1,244,504,064 bytes |

The measurements indicate that the lesion and SegFormer probes are materially heavier than the DR probe on this machine; deployment sizing and concurrency limits still require engineering decisions.

## 44. Cold/warm inference

The benchmark uses bounded cold and warm conditions. “Warm” means a fresh probe process after filesystem/runtime warmup; it does not claim a resident model server or an already-loaded model cache. This keeps the comparison honest and avoids treating a one-off in-process measurement as a production latency guarantee.

## 45. UI before

Before the Phase 2 UI work, research status, model fabric, evidence/traceability, specialty availability, consent purpose, and safe empty medication states were not presented as a single coherent review surface. Existing screens and report routes were preserved while their state disclosures were expanded.

## 46. UI after

The updated UI uses a dark navy/graphite shell with cyan, teal, and violet accents and exposes actual pipeline state. The landing page shows model/artifact metadata; the dashboard shows the nine specialty lanes; analysis intake shows purpose-specific consent; processing shows bounded stages; result/report/clinician views expose research-only findings, model execution, disagreements, missing evidence, and empty medication/condition states.

## 47. Design system

The Phase 2 design system is dark by default: dark navy and graphite surfaces, cyan/teal status accents, violet specialist accents, high-contrast cards, explicit badges, tables, and review banners. Labels distinguish `RESEARCH`, `EXECUTED`, `FAILED`, `UNSUPPORTED_MODALITY`, `NO VALIDATED MODEL AVAILABLE`, `NOT VALIDATED`, and other actual states.

No fake graphs, doctor identities, confidence percentages, diagnostic percentages, or fabricated operational states were added.

## 48. Landing page

Manual Chromium inspection showed the landing page with the actual local model fabric:

- lesion `fundus-lesions-clementp-unet-seresnext50`, research SafeTensors, local CPU research, version `a2cfcb594e483`, hash prefix `a7a7cb45b923…`;
- DR `fundus-dr-grading-effb0`, research SafeTensors, version `aa5741419b90`, hash prefix `0d9a18b0cb6c…`;
- OCT `oct-retinal-weights-fp32`, research ONNX, version `hf-main-2026`, hash prefix `22b1fffb5a0a…`.

The page did not present these models as clinically approved.

## 49. Dashboard

Manual inspection showed a dark dashboard with `MODEL STATUS RESEARCH`, `SYSTEM STATUS Operational`, and exactly nine specialty lanes. Retina showed `RESEARCH PROBE`; the other lanes showed `NO COMPATIBLE IMAGE MODEL` for the inspected fundus context. The board disclosed capability state instead of displaying a generic green clinical status.

## 50. Analysis workspace

The analysis intake now requires separate, purpose-specific consent choices for image model analysis and clinical research analysis, with document extraction consent required for PDF content. The flow displays the selected modality/laterality, file type, resolution, SHA prefix, and pre-upload quality checks.

The successful manual run used the pseudonymous synthetic reference `synthetic-phase2-ui-003`, a local fundus image, `Fundus photograph`, and `Right`/OD. It recorded the image-analysis and clinical-research consent purposes before execution.

## 51. Viewer

The result viewer preserved original pixels and displayed the research overlay separately. It showed modality, laterality, quality, model execution status, artifact-integrity prefixes, and research-only semantics. The overlay did not overwrite or imply a clinical annotation of the source image.

## 52. Specialist board

The clinician view showed `MULTI-SPECIALIST CONSENSUS` with `PARTIAL CORROBORATION`, then displayed each of the nine specialty lanes with its actual outcome. Retina was `FAILED` due to OOD in the inspected specialist context; other lanes reported `NO VALIDATED MODEL AVAILABLE`.

Legacy evidence packages remained visible for Retina, Glaucoma, Macula/OCT, and Comprehensive, with their research/unavailable status. This is a compatibility limitation that is disclosed rather than hidden.

## 53. Condition cards

The result page showed “Possible conditions to consider” with no conditions displayed because the available models were not validated for a diagnostic use. The card did not convert a lesion-like research output into a disease diagnosis or “normal” result.

## 54. Medication panel

The medication panel showed no treatment information because no connected defensible medication source exists. It did not display drug names, doses, prescriptions, or condition-to-treatment suggestions.

## 55. Report

Manual inspection of `/report?study=study_mtyedufp26d2tadv` showed `RESEARCH ANALYSIS REPORT`, the banner `NOT VALIDATED - NOT A MEDICAL DEVICE - NOT FOR CLINICAL USE`, and `RESEARCH USE ONLY - NOT VALIDATED FOR CLINICAL USE`.

The report showed claim-ledger entries with `RESEARCH_SCORE_ONLY` and `RULE_DERIVED`, evidence/model/rule references, no knowledge-source references where none existed, model execution, quality, finding, uncertainty, limitations, interoperability, and safety disclaimers.

## 56. Demo

The full manual demonstration completed from local login through upload, consent, queued processing, local research inference, result review, clinician view, and report. Observed study ID: `study_mtyedufp26d2tadv`. The demo is suitable as a controlled software demonstration of local research workflow and disclosure surfaces, not as a clinical demonstration.

## 57. Screenshot QA

Real Chromium/CUA manual QA was performed on the visible landing, dashboard, analysis intake, processing, result, clinician, and report surfaces. Screens were observed in the browser; no screenshot artifact was persisted as a report attachment. Browser console inspection returned an empty error list: `[]`.

No confirmation/finalization action was clicked, because the task did not authorize a clinical action and the workflow is research-only.

## 58. Responsive

The real-browser responsive harness passed:

`REAL BROWSER RESPONSIVE QA: PASSED (80/80)`.

It covered the login, dashboard, patients, analyze, history, result, report, clinician, settings, and admin routes at 320, 375, 414, 768, 1024, 1280, 1440, and 1920 pixel widths.

## 59. Accessibility

The real-browser accessibility harness passed:

`REAL BROWSER ACCESSIBILITY QA: PASSED (20/20)`.

The keyboard harness also passed `21/21`. During QA, a real contrast/link-in-text-block issue on `/settings` at 320px was found and fixed by adding visible link underlines in content blocks; the accessibility suite was then rerun successfully.

## 60. Browser E2E

The asset E2E passed. It verified Chrome login/dashboard, metadata-free fundus upload, research analysis routing to the lesion and DR models, mixed-PDF queuing and extraction, `pages=3`, `OCT_ROIs=8`, and a report with research provenance and PDF routing. The final manual flow also verified the consent gate and the expected research-only result semantics.

## 61. 20-case acceptance pack

`validation-cases/phase2-local-intelligence-pack.json` contains 20 synthetic acceptance cases spanning modality/model mismatch, artifact integrity, specialist status, evidence traceability, condition-state boundaries, medication emptiness, PDF routing, injection strings, worker behavior, and UI/release disclosures.

`tests/phase2-local-intelligence-acceptance.test.ts` passed all 21 tests. The cases are synthetic contract/behavior checks and are not clinical validation data.

## 62. Hallucination suite

The hallucination/injection checks are integrated into the Phase 2 acceptance tests. They assert that the system does not invent diagnoses, normality, symptoms, laterality, confidence, medications, doses, or knowledge-source references from unsupported or malicious text. They do not constitute proof against every possible adversarial input.

## 63. Security

Security controls include local artifact hashing, safe serialization preference, fail-closed model/task/modality gates, no `trust_remote_code=true`, no hidden paid inference path, authentication/consent boundaries, prompt-injection classification, provenance retention, tenant/FK checks, and explicit error states.

Final release verification reported production dependency audit exit 0 with zero vulnerabilities in the audited production dependency set. This is a snapshot, not a permanent security guarantee.

## 64. Consent

The analysis UI now separates image model analysis, clinical research analysis, and document extraction consent. Consent is recorded through the local consent route with a pseudonymous subject reference and purpose-specific `consentType: "explicit"`. Submission fails closed when required purposes are not selected.

The first manual attempt without purpose consent correctly stopped with `CONSENT_REQUIRED`; after the consent UI was added, the focused consent tests passed and the full manual flow completed.

## 65. Data integrity

Final release checks reported zero active foreign-key orphans, zero cross-tenant violations, zero hash mismatches, and 81 quarantined records in the inspected data state. Reconciliation completed with 335 total findings; 235 were `MISSING_REQUIRED_ARTIFACT` and 100 were `VALID_LEGACY_STATE`. Quarantine was not applied as a destructive cleanup operation.

## 66. Existing 235 blockers

The final active data release check still reports **235 unresolved active sources**:

- `233` active `MISSING_REQUIRED_ARTIFACT` records;
- `2` active `DETACHED_ANALYSIS_PARENT` records.

Accordingly, `active_data_release_safe:false` and the data-release gate remains blocked. These blockers were not deleted or silently adjudicated away.

## 67. Existing 5,263 legacy references

The final current data state reports **5,263 legacy orphan references**, including 5,260 detached legacy documents, 2 detached legacy analyses, and 1 detached legacy job. The final legacy unresolved-source count was 100: 55 legacy missing required artifacts and 45 legacy missing report exports. These are preserved legacy references/data-governance blockers, not evidence of a clean release dataset.

## 68. Backup/restore

The existing backup/restore coverage passed within the full unit run; the release verifier's unit result includes the backup/restore tests. No new backup was created by this run, and no destructive restoration, orphan purge, or data closure was performed. A production release still requires an operator-owned backup and restore rehearsal before any data remediation.

## 69. Full tests

The final authoritative full unit run completed with **74 test files passed, 1 skipped; 1,025 tests passed, 10 skipped**, exit code 0. It ran in approximately 499.76 seconds. Expected negative-test/PDF warning output did not change the successful exit.

The focused Phase 2 run passed 21 tests; the targeted regression set passed 8 files and 129 tests; the focused consent regression passed 2 files and 22 tests.

## 70. TypeScript

`npx tsc --noEmit --pretty false` passed with exit code 0. The production build's TypeScript phase also passed.

## 71. lint

`npm run lint` passed with exit code 0 after the consent/UI and accessibility changes.

## 72. build

`npm run build` passed with exit code 0. The final production build compiled successfully, completed its TypeScript phase, and generated 21/21 static pages. The authoritative release verifier also recorded production build exit code 0.

## 73. smoke

`npm run smoke` passed with `SMOKE RESULT: 16/16 passed`.

## 74. model audit

The model-manifest audit passed with 3 manifests, all marked `research_only`. The four local benchmark probes were measured, but the isolated SegFormer probe remains outside the registered production model inventory. The exact installed artifact hashes are recorded in section 15.

## 75. SBOM

The release verifier's SBOM check passed with exit code 0. The verifier recorded `phi_included:false`. SBOM success does not remove the model-license, dataset-rights, validation, or data-release blockers.

## 76. clean checkout

No clean checkout was created. The repository remains intentionally dirty so that all prior and Phase 2 changes remain visible and recoverable in the user's working tree. `git diff --check` found no actual whitespace errors; only CRLF warnings were reported.

## 77. CI

No GitHub CI run, commit, or push was performed. The report's quality evidence is from local commands and real-browser checks in the final working tree. A future handoff should commit the reviewed change set and run the repository's remote CI before any release claim.

## 78. Known limitations

The material limitations are:

- the final data-release gate is blocked by 235 active unresolved sources and 5,263 legacy orphan references;
- no clinical validation, calibration, prospective reader study, device validation, or autonomous-diagnosis authorization exists;
- no defensible local medication source is connected;
- four legacy specialist packages coexist with nine Phase 2 lanes, and most lanes have no validated model;
- research CPU inference can take seconds to tens of seconds and has high peak RSS for lesion/SegFormer probes;
- population, device, prevalence, and domain generalization are not established;
- the working tree is dirty and remote CI was not run;
- prompt-injection detection is deterministic coverage, not a proof of universal adversarial robustness;
- model and source licenses/dataset terms still require human review for any broader or commercial use.

## 79. Exact capability boundary

VisionScan Phase 2 can provide a controlled local research workflow: consent-gated input, provenance-preserving document/PDF extraction, safe model artifact verification, bounded local research inference, explicit modality/quality/OOD/failure states, specialist evidence packaging, claim traceability, model disagreement display, and clinician-review handoff.

It cannot provide a diagnosis, prove disease absence, estimate calibrated clinical risk, prescribe treatment, select a medication, claim sensitivity/specificity, or establish medical-device safety/effectiveness. The exact clinical boundary displayed by the system is:

`NOT CLINICALLY VALIDATED`  
`NOT A MEDICAL DEVICE`  
`NOT FOR AUTONOMOUS DIAGNOSIS`

## 80. Final classifications

**Software:** `ENGINEERING PARTIAL — BLOCKERS REMAIN`  
**Model:** `MODEL INTELLIGENCE PARTIAL`  
**Demo:** `CLIENT DEMO READY` — for a controlled local research software demonstration with the disclosures above.  
**Data:** `DATA RELEASE BLOCKED`

Clinical boundary:

`NOT CLINICALLY VALIDATED`  
`NOT A MEDICAL DEVICE`  
`NOT FOR AUTONOMOUS DIAGNOSIS`

The implementation is therefore suitable for continued controlled engineering/research review and a transparently labelled client software demo, but not for clinical deployment, autonomous diagnosis, treatment recommendation, or data release.
