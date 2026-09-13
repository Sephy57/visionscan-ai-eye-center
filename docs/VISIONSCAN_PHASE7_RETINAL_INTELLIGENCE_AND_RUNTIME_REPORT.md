# VisionScan AI Eye Center — Phase 7 Retinal Intelligence and Runtime Report

Generated: 2026-09-13T09:03:12.012Z

## Executive outcome

**NO — a defensible reduction of the observed 101 referable DR false negatives was not established.**

RetGuard remains `CANDIDATE_ONLY / RIGHTS_RESTRICTED / NOT_BENCHMARK_READY` after the fixed 0.001 parity stop, and the bounded second-candidate screen found no rights- and artifact-ready comparator. The lesion study is reported in research escalation language only. Real runtime evidence is bounded to a single heavy-model slot; it is not a production-capacity or clinical-validation claim.

## Evidence anchors

| Artifact | State |
|---|---|
| docs/generated/model-competition/phase6-retguard-20260913/baseline.json | Preserved 400-case/100-patient baseline |
| docs/generated/phase7-candidate-search.json | No second candidate benchmark-ready |
| docs/generated/phase7-retguard-parity-investigation.json | Fixed-tolerance parity stop preserved |
| docs/generated/model-competition/phase7-lesion-calibration-20260913/calibration.json | Patient-separated aggregate research calibration |
| docs/generated/phase7-real-load.json | Real bounded one-worker queued load |
| docs/generated/phase7-provider-crash-matrix.json | Real provider termination matrix with persistence gaps explicit |

No section turns missing evidence into zero. The ledger below is the requested exact 107-section Phase 7 report.

## 1 Starting HEAD

Phase 7 started from `fdc4f24897369161369a30b949f7c283d814f1b0` on `main`, preserving the Phase 6 published baseline. No reset, clean, force-push, or history rewrite was used.

## 2 Ending HEAD

The evidence snapshot was generated at `d809008206f0f147da7cb43013573e9b68a80ce1`. At generation the worktree was clean; publication and exact-head CI are stated separately.

## 3 Commits

Phase 7 adds bounded candidate due diligence, one fixed-tolerance RetGuard investigation, patient-separated lesion calibration, durable real-worker resource experiments, resident/crash probes, Validation Center/API projection, acceptance/security tests, CI wiring, and this generator. Generator SHA-256: `7ec639214ce90c4e413679767406026413eafeb7487059b4fb7cedf4ee949d4c`. Evidence projection hash: `b6367dc34f1a9e486bae0bfa44fc3dd7cb1331f7c36fc0e788cec4784fcefdce`.

## 4 Push

Implementation/evidence head d809008 created locally; normal push not yet performed.. A normal push is required before a remote result can be called exact-head evidence.

## 5 Exact-head CI

NOT RUN FOR ASSESSED HEAD d809008. Any historical CI result not tied to the assessed Phase 7 implementation head is retained only as historical evidence.

## 6 Phase 6 baseline

The preserved DeepDRiD regular-fundus validation baseline contains 400 images from 100 patients. The referable threshold is ICDR grade >=2 with TP 79, FN 101, FP 2, and TN 218. This baseline is not silently redefined by Phase 7.

## 7 RetGuard parity investigation

RetGuard was investigated once with the declared fixed logit tolerance `0.001`. The local immutable ONNX graph loaded on CPU for a deterministic synthetic tensor only; publisher sample tensors and framework logits were unavailable, so no local-vs-publisher number was fabricated.

## 8 RetGuard final decision

The parity stop remains `CANDIDATE_ONLY / RIGHTS_RESTRICTED / NOT_BENCHMARK_READY`. Publisher observation: maximum logit difference 0.002526, probability difference 0.000626; logit parity failed the fixed tolerance.

## 9 Candidate-2 search

The bounded second-candidate screen covered abssnet-dr-v1.0.0, retinalens-dr-v1.0.0, retfound-aptos-task-head-v1 and ended `NO_SECOND_CANDIDATE_BENCHMARK_READY`. No second candidate was admitted to inference.

## 10 Rights

Rights, redistribution, commercial-use, research-use, dataset, and weight-license uncertainty were gated before artifact execution. ABSS-Net code is source-described as MIT, but separately redistributable weight terms were not established; RetinaLens and RETFound task-head access/weight terms were not established.

## 11 Artifact

The candidate search found no canonical local checkpoint for ABSS-Net or RetinaLens, and RETFound task-specific heads remained external/gated. RetGuard's acquired ONNX is retained as a restricted candidate artifact and is not promoted into the approved model registry.

## 12 Hash

RetGuard archive SHA-256 `663c7f8bbc3676df2fe353efa0f3913c757db8c35cf9bf97ab451a756792d2e0`; ONNX SHA-256 `f0e19fa86d5a27a05731550d1d6708c01f6f363f45a1fa57849de988f91e775b`; OOD archive SHA-256 `cb99b4d375ecc384ce6fbeff4f9b94c42613964b32b7a96cef8b3e1227dbf5b2`. Candidate-search artifact digests are null because no unknown checkpoint was executed.

## 13 Preprocessing

The frozen VisionScan DR contract remains `3x512x512`. RetGuard source-described input/preprocessing remains 480x480 and unverified against the frozen contract; ABSS-Net source-described preprocessing is 224x224 with CLAHE/ImageNet normalization, but no compatible pinned weight artifact was admitted.

## 14 Parity

Publisher six-sample observation: probability maximum difference 0.000626 passed its reported comparison, while logit maximum difference 0.002526 failed the immutable 0.001 gate. The Phase 7 probe preserves `stop_rule_preserved: true` and reports synthetic graph execution as synthetic-only.

## 15 Runtime

RetGuard local runtime evidence is graph load and deterministic synthetic-input CPU execution only. It is not an image prediction, not a benchmark result, and not a license or preprocessing approval.

## 16 Dataset coverage

The accepted frozen comparison cohort remains DeepDRiD regular-fundus validation, 400 images and 100 patients. No candidate-2 result has a common 400-case output stream; Phase 7 does not substitute a different dataset.

## 17 Baseline reproduction

The Phase 6 competition bundle preserves the measured baseline summary: 400 cases, referable TP 79, FP 2, TN 218, FN 101. The source export SHA-256 is `c040638f5397a86af54599a6c21b3e047d6a68bcbf93a28f186e6feb802a12e5`.

## 18 Candidate metrics

Candidate accuracy, balanced accuracy, macro F1, QWK, AUROC, AUPRC, sensitivity, specificity, PPV, NPV, grade metrics, confusion matrix, FN, and FP are `NOT MEASURED`. Publisher-reported metrics are not local candidate metrics.

## 19 Confidence intervals

Baseline Wilson 95% intervals are retained: sensitivity null, specificity null, PPV null, NPV null. Candidate and paired bootstrap intervals are not measured.

## 20 Paired comparison

The required same-case paired comparison has no candidate rows. Persisted counts remain {"baseline_wrong_candidate_correct":null,"baseline_correct_candidate_wrong":null,"both_correct":null,"both_wrong":null}; no baseline-wrong/candidate-correct or candidate-wrong cell is inferred.

## 21 Baseline FN

The preserved baseline has 101 referable false negatives at grade >=2. These are case-level counts on the frozen cohort, not a claim about independent patient counts.

## 22 Candidate FN

Candidate FN is `NOT MEASURED`; a stopped candidate cannot be credited with finding or missing a case.

## 23 FN recovered

FN_RECOVERED is `NOT MEASURED`. The report makes no claim that RetGuard or any searched candidate recovered a baseline false negative.

## 24 FN shared

FN_SHARED is `NOT MEASURED`; no candidate prediction entered the paired denominator.

## 25 FN new

FN_NEW is `NOT MEASURED`; candidate false-negative behavior cannot be calculated without admitted candidate outputs.

## 26 Grade 3 analysis

Baseline exact grade-3 sensitivity is 3/68 = 0.0441. Candidate grade-3 sensitivity is `NOT MEASURED`; no high-grade improvement is claimed.

## 27 Grade 4 analysis

Baseline exact grade-4 sensitivity is 0/20 = 0.0000. Candidate grade-4 behavior is `NOT MEASURED`; runnable graph code does not establish safety.

## 28 Baseline FP

Baseline referable FP is 2 with specificity 99.09% on the frozen cohort.

## 29 Candidate FP

Candidate FP is `NOT MEASURED`; no candidate result entered the denominator.

## 30 FP delta

Candidate FP delta, removed FP, shared FP, and new FP are `NOT MEASURED`. No favorable FP assumption is made.

## 31 Review burden

RetGuard review burden is `NOT MEASURED`. Lesion escalation burden is a separate research measurement and cannot stand in for a DR candidate trade-off.

## 32 Candidate promotion decision

Promotion is BLOCKED. RetGuard remains `CANDIDATE_ONLY / RIGHTS_RESTRICTED / NOT_BENCHMARK_READY`; the three-reviewer implementation, validation/statistics, and safety/governance sign-off chain is not a promotion authorization.

## 33 Lesion calibration dataset

The Phase 7 lesion study uses the same frozen 400-case DeepDRiD regular-fundus source with 100 patients, split 80 calibration patients and 20 evaluation patients by stable patient hash. Split SHA-256: `2a0694734556e5a591efdc3c320eb44053031f83bef144bd3d9accf8b624add0`.

## 34 Lesion calibration rules

Predeclared aggregate rules include any signal, class-presence combinations, connected-region count thresholds, and combined class/count rules. Selection was calibration-only with FN review escalation coverage >=0.90 and lower path burden than `any_signal`; evaluation results were not used for selection.

## 35 Lesion calibration results

Lesion calibration state is `MEASURED_HELD_OUT_RESEARCH`; selected rule is `regions_ge_3`. Valid aggregate outputs: 397; unavailable reasons: {"ood_blocked":3}.

## 36 Lesion held-out evaluation

Held-out evaluation exists for the calibration-selected rule `regions_ge_3`: FN coverage 100.00%, path burden 50.76923076923077 escalations per 100 path cases. This is held-out research evidence, not clinical validation.

## 37 FN escalation coverage

The allowed label is `REVIEW ESCALATION COVERAGE`, not disease recovery. Phase 6 all-signal coverage was 98.02% over 101 baseline-FN cases; Phase 7 selected-rule held-out coverage is 100.00%. No lesion-like signal is called a confirmed lesion.

## 38 Review burden

Phase 6 all-signal path burden was 78.0564263322884 escalations per 100 baseline-predicted-nonreferable path cases. Phase 7 calibration compares this burden transparently; it does not call escalation a disease recovery.

## 39 Pareto frontier

Phase 7 records calibration and held-out Pareto frontiers as aggregate rule summaries: calibration 8 nondominated rules and evaluation 5. Pareto status is research trade-off evidence, not a clinical operating point.

## 40 Combined retinal strategies

No combined DR-candidate-plus-lesion operating strategy was promoted. Baseline, candidate, lesion escalation, and disagreement branches remain explicitly separate until candidate parity, paired metrics, rights, and clinical review are resolved.

## 41 Ensemble/disagreement

Candidate disagreement, score averaging, either/both logic, and ensemble FN/FP results are `NOT MEASURED`. No missing candidate score is replaced with a negative, zero, or publisher number.

## 42 OCT unchanged evidence

The approved OCT artifact remains a separate modality with Phase 6 bounded local timing only. Phase 7 does not infer retinal-fundus candidate performance from OCT evidence and makes no cross-modality ensemble claim.

## 43 Glaucoma boundary

Optic-disc/cup segmentation remains an analysis component, not glaucoma diagnosis. No Phase 7 result establishes glaucoma detection, staging, treatment, or normality.

## 44 Unsupported specialties

No evidence is claimed for cataract, macular disease diagnosis, pathology, treatment recommendation, visual acuity prediction, or autonomous referral. Unsupported specialty requests remain outside the validated system boundary.

## 45 Medication state

Medication extraction and medication safety state remain unchanged: document-derived urgency requires provenance and clinician review; no Phase 7 model output authorizes medication, discontinuation, or treatment.

## 46 Cross-process governor

The real-worker experiments use durable SQLite admission with WAL/full synchronization, bounded memory/thread requests, one active heavy-model slot, heartbeat, expiry/reap, and ownership fencing. Host memory is observation/cooperative policy, not OS enforcement.

## 47 Resource race

Two independent worker processes were launched. Status `MEASURED_REAL_WORKER_RACE`; admitted 1, model launches 1, no-double-launch true, heartbeat observed true.

## 48 Stale recovery

The isolated injected-clock stale/fencing probe records old admitted true, newer admitted true, reclaimed 1, active after 0. Stale release blocked: true.

## 49 Memory headroom

Observed host memory at the race report is 5.25 GiB available of 15.30 GiB total, with configured heavy-model request 2.00 GiB and headroom 1.00 GiB. This is an observation and admission policy, not a guarantee against unrelated processes.

## 50 Threads

The real probes set bounded OMP, MKL, OpenBLAS, NumExpr, PyTorch, and ONNX Runtime thread settings where supported. Thread controls are cooperative; third-party libraries and the OS may still behave differently.

## 51 One-worker load

Real queued load status `PARTIAL_BOUNDED_SINGLE_WORKER_LOAD` using `ONE_NODE_WORKER_WITH_DURABLE_SQLITE_SINGLE_SLOT`. Requested points: 1 jobs / 1 completed, 5 jobs / 5 completed, 10 jobs / 10 completed, 25 jobs / 15 completed.

## 52 Two-worker decision

Two-worker real model load status is `NOT_RUN_FOR_SAFETY`; no duplicated heavy-model capacity claim is made.

## 53 Queue wait

Real queue wait p50/p95 by requested point: 1: 60.141/60.141 ms, 5: 17240.32/25243.295 ms, 10: 31891.077/63945.131 ms, 25: 16354.999/97586.922 ms.

## 54 Resource wait

Real durable-resource wait p50/p95 by requested point: 1: 0/0 ms, 5: 16561.521/24565.956 ms, 10: 31305.255/63364.275 ms, 25: 15767.058/97011.242 ms. Rejections remain classified rather than counted as completed jobs.

## 55 Service latency

Fresh-process real lesion service latency p50/p95 by point: 1: 9390.588/9390.588 ms, 5: 7947.223/8481.898 ms, 10: 7901.525/8077.94 ms, 25: 8050.247/9133.728 ms. These values do not establish resident service latency.

## 56 Throughput

Bounded single-worker completed-job throughput by requested point: 1: 0.1055 jobs/s, 5: 0.121 jobs/s, 10: 0.1251 jobs/s, 25: 0.1203 jobs/s. It is a serialized fresh-process observation, not sustained production capacity.

## 57 CPU

Peak observed process-tree CPU seconds by requested point: 1: 16.671875 s, 5: 16.03125 s, 10: 15.90625 s, 25: 17.5625 s. Metrics are best-effort Windows observations.

## 58 Memory

Peak observed working set by requested point: 1: 1.27 GiB, 5: 1.34 GiB, 10: 1.34 GiB, 25: 1.33 GiB. Phase 6 single-process benchmark references remain lesion MEASURED; cold 7708.2 ms / 1.25 GiB working set; warm 7908.9 ms / 1.02 GiB working set; DR MEASURED; cold 4975.3 ms / 419 MiB working set; warm 4763.5 ms / 472 MiB working set; OCT MEASURED; cold 3295.8 ms / 1021 MiB working set; warm 3224.9 ms / 1016 MiB working set.

## 59 Real provider crash matrix

Real DR/lesion/OCT forced-termination matrix status `PARTIAL_REAL_PROVIDER_CRASH_MATRIX`. Provider rows: DR=OBSERVED_TERMINATION_AND_CLEANUP, LESION=OBSERVED_TERMINATION_AND_CLEANUP, OCT=OBSERVED_TERMINATION_AND_CLEANUP. Persistence-boundary stages remain explicitly unmeasured.

## 60 Deadline

Real queued load enforces a 120000 ms job deadline from queue admission. Crash probes use bounded termination windows; neither is a universal production SLO or clinical deadline guarantee.

## 61 Process-tree cleanup

The crash matrix records descendant absence after forced termination where observed. It does not prove every provider/launcher path, but it does not convert an incomplete kill into a successful result.

## 62 Graceful shutdown

Graceful shutdown across active model inference, durable attempt state, lease release, restart, and persistence remains `NOT MEASURED`. The implementation retains fail-closed process-control hooks and explicit limitations.

## 63 Resident DR

No resident DR model experiment was run. DR remains short-lived subprocess evidence only; resident load, cancellation, restart, and stale-state behavior are `NOT MEASURED`.

## 64 Resident lesion

Resident lesion experiment status `MEASURED_RESIDENT_20_CASES` over 20/20 serial cases; initial load 509.237 ms; warm p50 2831.528 ms; memory decision `RESIDENT_RESEARCH_SAFE_FOR_BOUNDED_USE`.

## 65 Resident OCT

No resident OCT worker experiment was run. OCT resident memory, cancellation, process recovery, and cross-job state are `NOT MEASURED`.

## 66 Cross-job isolation

The resident probe records only bounded independent manifest inputs and explicitly says it is not a full production isolation proof. Short-lived providers retain finally-cleanup boundaries; caches, cancellation, and restart require further evidence.

## 67 Resident decision

Resident production execution is not promoted. Even if the bounded lesion experiment completed, its resident decision is research-scoped and cannot establish universal resident safety or capacity.

## 68 Validation Center

Validation Center exposes a role-gated read-only Phase 7 projection with candidate search, parity stop, held-out lesion research summary, resource race/load, resident, crash, and clinical-boundary state. It does not expose raw paths, patient identifiers, or model-promotion controls.

## 69 Error explorer

The error surface remains aggregate and separated from raw cases. No Phase 7 UI projection adds image bytes, row-level model outputs, free-text clinical notes, or hidden candidate-success state.

## 70 Traceability

The Phase 7 artifacts retain schema versions, observation times, model/source hashes, split hash, fixed tolerance, study state, limitations, and `phi_included:false`. The report generator itself is hash-recorded.

## 71 Security

New routes are GET-only and role-gated for ADMIN, REVIEWER, and RESEARCHER. Candidate promotion remains server-controlled; unknown weights are screened before execution; subprocesses use isolated Python invocation and bounded thread settings; no force-upgrade or force-push escape hatch was added.

## 72 PHI

Committed Phase 7 projections are aggregate-only and declare `phi_included:false`. They contain no patient names, dates of birth, addresses, medical-record numbers, raw images, case keys, or row-level predictions.

## 73 Secrets

No credentials, private model bytes, or authentication material are committed. Local restricted artifacts remain outside the committed evidence projection; public research data are not treated as clinical or proprietary data.

## 74 Dependency audit

Dependency audit status is 2 moderate development/test advisories: Vitest/@vitest-mocker GHSA-82fw-gwwq-j7x9; fix requires major Vitest upgrade; exit 1; no force fix. The report preserves the existing audit distinction between development/test advisories and production dependency risk; no force fix was applied.

## 75 Phase 7 acceptance

Phase 7 acceptance status: PASS: 2 files, 22 tests. The acceptance pack checks baseline preservation, candidate gates, fixed parity, split/hash provenance, research language, real runtime evidence, report ledger, and artifact hashes.

## 76 Equipped tests

Model-equipped local evidence status: PASS: 86 files passed, 1 skipped; 1123 tests passed, 13 skipped; exit 0. Equipped work is explicitly separated from hosted/no-model CI; candidate-gated inference remains disabled.

## 77 No-model tests

No-model checkout status: PASS: clean checkout suite pending rerun after hash portability fix. Ordinary tests, build, audit, and read-only projections must not require private model bytes; artifact-dependent probes fail closed when unavailable.

## 78 TypeScript

TypeScript status: PASS: npx tsc --noEmit exit 0. The Phase 7 strict-null fixes and route/client types are included in this check.

## 79 lint

Lint status: PASS: npm run lint exit 0.

## 80 build

Next.js build status: PASS: npm run build exit 0. The Node/dynamic route follows the repository's current App Router guidance.

## 81 smoke

Smoke status: PASS: 16/16. No smoke claim is inferred from typecheck or unit tests.

## 82 responsive

Responsive browser status: PASS: 88/88. The Phase 7 UI adds evidence tables without changing the existing mobile/table overflow boundary.

## 83 accessibility

Accessibility status: PASS: 22/22. Candidate state and research-only boundaries are expressed as text, not color alone.

## 84 keyboard

Keyboard status: PASS: 23/23. No new model-promotion control is keyboard-reachable because no such control exists.

## 85 browser E2E

Browser E2E status: PASS: asset E2E and hosted-style smoke. Browser CI remains no-model/synthetic unless the recorded exact-head result says otherwise.

## 86 model audit

Model manifest audit status: PASS: 3 approved manifests. Approved local artifacts remain hash-verified; RetGuard remains outside promotion.

## 87 filesystem audit

Filesystem audit status: PASS: project/data on D:. Sensitive extensions, reparse/path hazards, ignored model bytes, and aggregate-only committed evidence remain release gates.

## 88 SBOM

SBOM status: PASS: CycloneDX 1.5 generated. The SBOM describes dependencies and evidence scope; it does not imply private model execution in hosted CI.

## 89 Clean checkout

Clean-checkout status: PASS: exact-head checkout created; no-model suite rerun pending after hash portability fix. A clean validation checkout must use external data/model/database roots and prove no-model ordinary tests without copying restricted weights into Git.

## 90 Linux CI

Linux exact-head CI: NOT RECORDED.

## 91 Windows CI

Windows exact-head CI: NOT RECORDED.

## 92 Browser CI

Browser exact-head CI: NOT RECORDED.

## 93 Independent model audit

Independent model-audit conclusion: RetGuard integrity and local graph loading are recorded, but rights remain restricted, the fixed logit parity gate failed, and no local candidate performance or clinical improvement claim is admissible.

## 94 Independent system audit

Independent system-audit conclusion: durable cross-process admission, heartbeat, stale recovery, fencing, real bounded single-worker load, and real provider termination observations are present where their artifacts say measured; host-memory controls remain observational/cooperative and resident/persistence gaps remain.

## 95 Remaining model blockers

Remaining model blockers are failed RetGuard logit parity, unresolved preprocessing equivalence, incompatible input contract, absent candidate predictions, absent paired metrics/high-grade comparison, restricted rights, and no promotion sign-off.

## 96 Remaining engineering blockers

Remaining engineering blockers are production capacity, multi-worker safety, resident DR/OCT evidence, persistence-stage crash injection, graceful shutdown/restart, and broader provider/OS failure coverage.

## 97 Remaining data blockers

The application data-release gate remains separate and blocked where unresolved source/reference records remain. Model-validation artifacts do not clear the application's data-release status.

## 98 Remaining clinical blockers

No clinical adjudication, prospective validation, device compatibility validation, clinically suitable calibration, safety/utility study, autonomous-diagnosis evaluation, or medical-device authorization evidence exists.

## 99 Exact capabilities

Phase 7 demonstrates: bounded rights/artifact candidate screening; fixed-tolerance parity stop; patient-separated aggregate lesion rule calibration/evaluation when measured; durable real-worker admission/race/heartbeat/stale/fencing probes; queued single-slot real load; bounded resident/crash observations; role-gated evidence projection; and fail-closed research governance.

## 100 Exact non-capabilities

Phase 7 does not demonstrate a better DR model, recovery of 101 baseline FN, candidate sensitivity/specificity, clinical lesion confirmation, disease recovery, calibrated clinical probabilities, safe two-worker duplication, production throughput, universal cleanup, resident-worker safety, clinical diagnosis, normality, or treatment advice.

## 101 Software classification

ENGINEERING PARTIAL — BLOCKERS REMAIN. Controls and bounded evidence are implemented, but open operational, data, and clinical gates prevent a complete system release claim.

## 102 DR classification

C. NO DEFENSIBLE DR CANDIDATE BENCHMARK COMPLETED. The fixed parity stop and second-candidate rights/artifact gates prevented a fair same-frozen-400 comparison; no FN reduction or FP/review trade-off is claimed.

## 103 Lesion escalation classification

RESEARCH-ONLY HELD-OUT REVIEW ESCALATION COVERAGE EVIDENCE. The selected rule was chosen on calibration patients and evaluated on held-out patients; this is not disease recovery, lesion confirmation, clinical sensitivity, or referral utility.

## 104 Performance classification

LOCAL RUNTIME PARTIAL. Control-plane and/or bounded subprocess evidence exists, but the requested real single-worker load is not complete.

## 105 Data classification

DATA RELEASE BLOCKED. Aggregate research artifacts and model hashes do not clear unresolved application data provenance or release gates.

## 106 Demo classification

DEMO / SYNTHETIC RESULT - NOT FOR CLINICAL USE. Synthetic RetGuard tensor execution is explicitly separated from image inference, benchmark evidence, and clinical use.

## 107 Clinical classification

NOT CLINICALLY VALIDATED. NOT A MEDICAL DEVICE. NOT FOR AUTONOMOUS DIAGNOSIS.

Primary answer: NO. VisionScan cannot defensibly claim reduction of the observed 101 referable DR false negatives from Phase 7 without inventing candidate predictions or hiding the absent FP/review trade-off. Any lesion result is REVIEW ESCALATION COVERAGE only—not disease recovery.
