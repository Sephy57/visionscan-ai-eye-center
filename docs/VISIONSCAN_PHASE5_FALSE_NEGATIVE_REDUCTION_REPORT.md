# VisionScan Phase 5 — False-Negative Reduction and System Operations Report

**Observed:** 2026-09-13, Asia/Manila  
**Workspace:** `D:\AI EYE ANALYSIS PLATFORM`  
**Scope:** Phase 5 continuation of the ophthalmic research system: DR false-negative reduction infrastructure, candidate due diligence, fair comparison contracts, lesion safety-net behavior, worker resource/deadline/process controls, validation-center evidence UI, security, acceptance cases, and release verification.  
**Decision:** the implementation is suitable for controlled local research engineering and a constrained synthetic demonstration. It does not establish improved DR sensitivity, clinical utility, clinical validation, medical-device status, or autonomous diagnosis.

This report is evidence-bounded. A missing candidate artifact, missing ground truth, unmeasured threshold, absent calibration, unsupported modality, failed worker, or unresolved data relationship remains missing or blocked. No metric, candidate, clinical conclusion, or performance value is inferred from absence of evidence.

## 1 Starting HEAD

The verified starting commit was `1bb2d9c215159763cd0cbe017e0ecb5b53a0a843` on `main`, matching the Phase 4 published implementation/document state. The worktree was clean before Phase 5 changes. Existing Phase 4 history and local data were preserved.

## 2 Ending HEAD

The Phase 5 implementation release head is `18a39cdc1e67fb10c499ba9abf2c4e6ec1e9cd04` (`test: skip model-dependent freeze without weights`). It includes the implementation commit `ad36155da59fdb53ff674810093a8866206edbd0` plus the no-model reproducibility test correction. This report is a documentation follow-up to that implementation head; the report publication commit is listed separately after it is created.

## 3 Commits

Phase 5 implementation commits:

- `ad36155` — `feat: add phase 5 false-negative reduction controls`
  - Added the immutable DR competition contract and baseline freezer.
  - Added candidate-only DR dossiers and the research inventory.
  - Added process-local resource admission, overall job deadlines, process-tree tracking/termination, and worker shutdown cleanup.
  - Added bounded operations telemetry and the Validation Center route/UI.
  - Added 64-case synthetic acceptance data, security tests, runtime-experiment envelope, and Windows crash matrix.
  - Added CI coverage and browser-route/hydration/accessibility fixes.
- `18a39c` — `test: skip model-dependent freeze without weights`
  - Makes the artifact-dependent baseline-freeze test skip explicitly when a fresh checkout has no research weights, while retaining the full measured assertion when weights are installed.

No reset, force push, history rewrite, or deletion of prior detached worktrees was used.

## 4 Push

The implementation was pushed normally:

```text
git push origin main
1bb2d9c..18a39cd  main -> main
```

The remote implementation SHA was verified against the pushed local SHA before the report was prepared. The report itself is intended as a subsequent documentation-only commit.

## 5 CI

GitHub Actions run `34717367773` was triggered for exact SHA `18a39cdc1e67fb10c499ba9abf2c4e6ec1e9cd04` and completed successfully for all three jobs:

| Job | Result | Scope |
|---|---|---|
| `verify` | PASS | Linux typecheck, full model-free suite, migrations/backup, Phase 4/5 acceptance, audits, SBOM, inventory, build |
| `verify-windows` | PASS | Windows path/red-team tests, full suite, Phase 4/5 acceptance, audits, SBOM, build |
| `verify-browser` | PASS | Isolated empty-store authenticated browser smoke |

Run: <https://github.com/Sephy57/visionscan-ai-eye-center/actions/runs/34717367773>. CI is engineering validation only. It intentionally uses no patient data, no private model weights, no paid API, and no remote inference.

## 6 Phase 4 baseline

Phase 4 ended with strict anatomy integrity, OCT scan aggregation, output-contract validation, OOD/source binding, research fusion, nonzero worker-failure handling, a 40-case safety acceptance pack, and a no-model clean-checkout gate. Its final implementation evidence was the `ede958e` run, followed by the published Phase 4 report at `1bb2d9c`.

Phase 5 preserves those boundaries. It adds infrastructure for reducing and measuring false negatives, but no clinical or model-performance result is silently upgraded because the infrastructure now exists.

## 7 DR baseline

The current DR model is a five-grade ordinal regression research model. The integer grade is rounded/clamped output, not a calibrated probability. The frozen baseline uses the DeepDRiD regular-fundus validation export: `400` images from `100` patients, with the declared patient-separated publisher split retained.

Measured baseline values:

| Metric | Result |
|---|---:|
| Accuracy | `0.5025` |
| Balanced accuracy | `0.2842` |
| Macro F1 | `0.2620` |
| Quadratic weighted kappa | `0.4950` |
| Referable rule | grade `>= 2` |
| Referable sensitivity | `79/180 = 0.4389` |
| Referable specificity | `218/220 = 0.9909` |
| Referable PPV | `0.9753` |
| Referable NPV | `0.6834` |
| Referable FNs | `101` |
| Referable FPs | `2` |

These are research metrics from a frozen evidence export, not a referral policy, regulatory result, or prospective clinical validation.

## 8 Candidate discovery

The fresh search focused on public, task-specific DR classifiers or retinal foundation-model paths that could plausibly satisfy the same five-grade fundus task, with exact artifact identity, preprocessing reproducibility, license review, CPU feasibility, and patient-separated comparison as prerequisites. The full due-diligence record is [docs/PHASE5_DR_CANDIDATE_INVENTORY.md](./PHASE5_DR_CANDIDATE_INVENTORY.md).

Primary project sources reviewed included [Retguard](https://github.com/anchor-neuro/retguard), [ABSSNET](https://github.com/guptapradeep85/ABSSNET), [RetinaLens](https://github.com/egwaojeangel/retinalens-ai-diabetic-retinopathy-detection), and [RETFound](https://github.com/rmaphoh/RETFound). Their published numbers remain author-reported until this project reproduces them under the frozen local protocol.

## 9 Candidate rejection table

| Candidate | Evidence reviewed | Decision and blockers |
|---|---|---|
| `retguard-dr-v1.0.0` | Task-specific CPU ONNX; publisher reports Messidor-2 `n=1,744`, AUC `0.9691`, sensitivity `0.9716`, specificity `0.7607`; publisher discloses calibration and ONNX parity concerns | Rejected for registration. Artifact was not downloaded or locally hashed; noncommercial code/weights terms, calibration gate, export parity, target-camera behavior, and local head-to-head remain unresolved |
| `abssnet-dr-v1` | Five-class EfficientNet-B0/CBAM/gated-token model; repository reports five-fold APTOS-derived results, including accuracy `0.7026`, macro F1 `0.5206`, QWK `0.7933`, AUC `0.8862` | Rejected. No canonical locally verified checkpoint hash, no same-protocol referable sensitivity/specificity, split/weight rights unresolved, and no local CPU/RAM evidence |
| `retinalens-efficientnet-b4` | Five-class EfficientNet-B4; README reports mixed EyePACS/APTOS/MESSIDOR data and validation accuracy `0.649`, macro F1 `0.5879` | Rejected. `best_model.pth` is described as a Kaggle notebook output without a canonical artifact URL/hash; patient split, rights, CPU behavior, and independent comparison unresolved |
| `retfound-mae` | Retinal foundation model with reported 1.6M-image pretraining and gated checkpoint access | Rejected. No shipped DR task head, gated acquisition, noncommercial scope, large CPU burden, artifact hash, or comparable output contract |
| Community APTOS solutions | Multiple repository-specific competition approaches | Rejected as a category. No single immutable artifact, consistent license/rights, patient-separated external result, or reproducible promotion path |

## 10 Candidate accepted models

**None.** No Phase 5 candidate was downloaded, locally hashed, registered, promoted, or used to generate a VisionScan finding. The installed DR model remains the existing baseline research artifact, not a Phase 5 accepted candidate.

## 11 Head-to-head metrics

**Not measured.** The competition contract now requires identical task semantics, dataset split, case-count policy, preprocessing fingerprint, model artifact hash, finite score coverage, and immutable result hashes. The baseline freezer measures only the existing evidence. There is no candidate result to compare, so no accuracy, sensitivity, specificity, calibration, latency, or superiority claim is made.

## 12 Confidence intervals

The baseline freezer now records Wilson 95% intervals for the referable binary metrics. These are case-level binomial intervals and do not account for patient clustering, spectrum design, prevalence transport, device effects, or clinical utility.

| Referable metric | Point estimate | Wilson 95% interval |
|---|---:|---:|
| Sensitivity | `0.4389` | `[0.3684, 0.5119]` |
| Specificity | `0.9909` | `[0.9675, 0.9975]` |
| PPV | `0.9753` | `[0.9144, 0.9932]` |
| NPV | `0.6834` | `[0.6304, 0.7320]` |

Candidate intervals are **not available**. The contract uses null/unmeasured states instead of manufacturing precision.

## 13 Grade-level metrics

The validation export records the following one-vs-rest grade sensitivities. Grade-level FN counts are one-vs-rest counts and must not be summed as unique referable patients.

| Ground-truth grade | Support | Sensitivity | Grade-level FN |
|---:|---:|---:|---:|
| 0 | 174 | `0.9310` | 12 |
| 1 | 46 | `0.1087` | 41 |
| 2 | 92 | `0.3370` | 61 |
| 3 | 68 | `0.0441` (`3/68`) | 65 |
| 4 | 20 | `0.0000` (`0/20`) | 20 |

## 14 Baseline FNs

The frozen referable baseline contains `101` FNs (`180` referable eyes, `79` detected). Higher-grade under-calling is the load-bearing safety concern: only `3/68` grade-3 cases and `0/20` grade-4 cases were correctly detected as the exact grade, while the referable threshold still produced only `79/180` referable true positives.

These are observed model errors. The export does not establish whether each error is caused by pathology coverage, image quality, preprocessing, thresholding, domain shift, or model capacity.

## 15 Candidate FNs

**Not measured.** There is no candidate case-level prediction file, so candidate FN count is null. No candidate is allowed to inherit the baseline result or be described as better because its published headline metric is higher.

## 16 FN overlap

**Not measured.** There are no paired baseline/candidate case-level predictions and no candidate artifact. FN overlap, unique recovery, and complementary-error analysis therefore remain unavailable.

## 17 Baseline FPs

The frozen referable baseline contains `2` FPs (`218/220` nonreferable cases correctly classified). This high specificity does not offset the observed false-negative burden and is not an accepted clinical operating point.

## 18 Candidate FPs

**Not measured.** No candidate result exists. The system does not infer candidate FP burden from a repository README or from the baseline.

## 19 FP overlap

**Not measured.** Baseline/candidate FP overlap and added review burden cannot be computed without the same case IDs and complete paired predictions.

## 20 Ensemble experiments

**Not run.** No DR score averaging, voting, calibration blend, or candidate ensemble was introduced. The research fusion layer compares completed categorical signals from the same source-bounded study; it does not average uncalibrated scores or choose a winner.

## 21 Threshold experiments

**Not run.** The current exploratory referable rule remains `predicted grade >= 2`. No threshold sweep, calibration partition, prevalence adjustment, or post-processing change was applied. The competition contract leaves score-derived measures unmeasured when scores are missing or not comparable.

## 22 Sensitivity/specificity frontier

**Not measured.** Only the existing grade-derived operating point is available. A future frontier must be generated from a locked calibration partition and evaluated on an untouched patient-separated test partition, with confidence intervals, subgroup/device strata, review-burden accounting, and pre-specified acceptance criteria.

## 23 Selected research strategy

The selected Phase 5 strategy is an evidence-first research lane:

- freeze the existing baseline before candidate work;
- keep all candidate models outside the live registry until acquisition, rights, preprocessing, artifact, runtime, and comparison gates pass;
- measure high-sensitivity research operating points separately from clinical claims;
- retain the lesion detector as an independent safety-net signal rather than using it to repair or override DR grading;
- expose false-negative, missing-evidence, worker, and provenance states in an internal Validation Center;
- fail closed when resources, source integrity, deadlines, or evidence contracts are not satisfied.

## 24 Why selected

This strategy addresses the actual observed risk—high referable and higher-grade misses—without creating a new false-reassurance risk. A candidate with an attractive published score but no locally verified artifact, patient-separated comparison, or rights review cannot safely be called an improvement. A lesion-like signal can prompt review, but it cannot prove a missed DR grade or establish disease.

## 25 Lesion safety-net

The existing fundus lesion model remains a separate `RESEARCH_ONLY` signal. It produces lesion-like regions under its own quality, OOD, artifact, and geometry contracts. The fusion layer can surface `DR_BELOW_REFERABLE_THRESHOLD_BUT_LESION_SIGNAL` when the completed signals disagree. It does not convert that flag into a diagnosis, calibrated probability, referral decision, or validated localization.

The safety-net is therefore a review escalation/coverage signal, not a replacement DR grader and not a proof of recovered disease.

## 26 FN recovery

**Measured recovery: none.** Because no candidate or new threshold was evaluated, the baseline `101` referable FNs remain the measured result. The software now makes a possible complementary lesion signal visible and traceable, but no number of recovered FNs is claimed.

## 27 FP review burden

The existing lesion evidence shows why a safety-net can add review burden. On the overlap-disclosed IDRiD export, grade-0 lesion-like target detection was observed on `113/174 = 0.649`; on the capped APTOS comparison it was `148/250 = 0.592`. Region-level FP burden remains `NOT_MEASURABLE` because the export lacks negative-image region ground truth. The system therefore does not suppress lesions to make a favorable burden claim.

## 28 OCT

The OCT classifier remains a four-class research backbone (`CNV`, `DME`, `DRUSEN`, `NORMAL`) with no clinical calibration. Existing evidence is:

- Kermany mirror: `1,000` scans, accuracy/balanced accuracy/macro F1 approximately `0.9770`; patient separation is not verifiable and the data overlap the reported training distribution.
- Duke export: `3,231` scans from `45` subject folders; scan accuracy `0.8437`; subject-majority accuracy `42/45 = 0.933`.
- Duke dry AMD is only an approximate `DRUSEN` proxy; there is no CNV reference class, and `112` dry-AMD scans predicted as CNV remain visible as out-of-label errors.

The OCT class `NORMAL` never means a healthy eye or disease absence.

## 29 OCT study aggregation

The pipeline admits only explicitly linked, source-hash-verified OCT B-scan ROIs. It retains page hash, ROI hash, laterality, execution status, and model ledger rows. Aggregation is categorical and deterministic: logits are not averaged; failed, skipped, unknown-laterality, or incompatible scans are not silently pooled; insufficient or mixed evidence remains explicit.

The real browser asset gate exercised a mixed PDF with `3` routed pages and `8` OCT ROIs and verified that the report rendered both routing and research provenance.

## 30 Domain shift

The Kermany `0.9770` scan result and Duke `0.8437` scan result are retained as distribution-dependent evidence, not collapsed into one headline. The Duke shift includes NORMAL-to-DME overcalls and dry-AMD-to-CNV out-of-label predictions. Device, population, label mapping, subject separation, image quality, and calibration remain open validation dimensions.

## 31 Optic nerve

The SegFormer optic-disc/cup artifact remains `CANDIDATE_ONLY` anatomy output, not a glaucoma model. A local probe on a `1634x1634` image returned `23,671` disc pixels and `31,305` cup pixels, producing cup/disc area ratio `1.3225`. The output was rejected as invalid because cup area exceeded disc area and the anatomy was not clinically admissible.

Artifact SHA-256: `22e45131b64eb07a5d29a2e5388a7709d10696b13f48d2d0cdcf56cafa1f9ea5`. Historical probe timing was import `53.029 s`, load `1.957 s`, inference `14.916 s`; these are engineering timings, not clinical measurements.

## 32 Glaucoma pathway

There is no validated glaucoma classifier, accepted CDR measurement, or glaucoma risk model. The system can preserve clinician-entered IOP, visual-field, pachymetry, laterality, and anatomy evidence when actually sourced. It does not infer glaucoma from the invalid optic-disc/cup output or from the absence of a glaucoma model.

## 33 Other specialty state

Cornea, cataract, neuro-ophthalmology, pediatric ophthalmology, uveitis/inflammation, and ocular oncology have no promoted local disease model in this release. Their specialist paths preserve routing, missing evidence, and professional-review boundaries; they do not create automated disease or normality claims.

## 34 Fusion engine

`fuseResearchSignals()` and the related pipeline contracts compare same-study, source-bound research outcomes. They retain separate fundus DR, lesion, and OCT evidence, reject incompatible scope/laterality, and expose disagreement. The engine never treats a score as a probability, never averages logits, never lets a negative DR grade erase a lesion signal, and never turns two research outputs into a diagnosis.

## 35 Contradictions

The current explicit contradiction states include:

- `DR_BELOW_REFERABLE_THRESHOLD_BUT_LESION_SIGNAL`;
- `DR_REFERABLE_WITHOUT_SUPPORTED_LESION_SIGNAL`;
- `MIXED_OCT_CLASS_RESULTS`;
- `MODEL_OUTPUT_INVALID` for invalid anatomy or output geometry.

Contradictions remain visible for clinician reconciliation. Phase 5 does not add an automatic adjudication rule or claim that disagreement identifies a true disease case.

## 36 Missing evidence

The system exposes missing device metadata, unknown laterality, unsupported modality, absent model, model failure, quality block, OOD block, missing source bytes, missing ground truth, missing calibration, missing candidate artifact, unavailable medication source, and incomplete specialist evidence as distinct states. None is converted into normality, a probability, or a diagnosis.

## 37 False reassurance tests

The Phase 5 synthetic pack contains `64` cases and `145` assertions, all `SYNTHETIC_ONLY`, grouped as:

| Group | Cases |
|---|---:|
| DR false-negative and threshold/calibration/provenance boundaries | 8 |
| Lesion taxonomy, false-positive, laterality, mask, and ground-truth boundaries | 8 |
| OCT class, aggregation, and domain boundaries | 8 |
| Worker deadline, failure, retry, and resource boundaries | 8 |
| Unsupported-specialty boundaries | 8 |
| Empty-evidence boundaries | 8 |
| False-reassurance/no-negative-inference boundaries | 8 |
| Security/tamper/RBAC/scope boundaries | 8 |

The acceptance test verifies the pack shape, category coverage, provenance/forbidden-claim contracts, missing output behavior, and mutation rejection. `npm run validation:phase5` passes `8/8` files and `52/52` tests locally.

## 38 Knowledge sources

Knowledge inputs are separated into local evidence and external project sources. Local sources include `docs/model-validation/validation-summary.json`, the DR/lesion/OCT failure registries, exact model manifests, the frozen competition result, source-pinned preprocessing implementations, and the Phase 5 candidate inventory. External candidate claims are linked to their primary repositories in the inventory and remain author-reported.

No external source is treated as a clinical guideline, no README metric is copied into the live registry, and no candidate score is substituted for local evaluation.

## 39 Medication source state

Medication/treatment information remains clinician-review-only and source-gated. Phase 5 does not add a drug source, dosage, contraindication decision, or prescribing behavior. When the condition/evidence/source requirements are not met, the system records `NO_DEFENSIBLE_SOURCE_FOUND` or an unavailable state and does not recommend medication.

## 40 Resource governor

`lib/runtime/resourceGovernor.ts` provides deterministic process-local reservation accounting. The configured example budget is `2 GiB` and `4` threads. Job reservations are:

| Job kind | Reserved memory | Reserved threads |
|---|---:|---:|
| Analysis | `2 GiB` | 4 |
| Extraction | `512 MiB` | 2 |

An unconfigured real research job fails closed with `unconfigured_research`; deterministic DEMO work may bypass the research reservation. The governor has no OS-level RAM enforcement, no process affinity, and no protection against independently launched processes. Its focused suite passes `7/7`.

## 41 Thread budget

Thread admission is part of the same process-local reservation token. It prevents cooperating jobs in one Node worker from exceeding the declared thread budget and returns deterministic rejection reasons. It does not measure native library thread creation or enforce a system-wide Windows limit. Multiple-worker operation remains intentionally unapproved without measured memory evidence.

## 42 Job deadline

Every claimed job receives an overall wall-clock deadline. The default is `900000 ms` (`15 minutes`), with a bounded maximum of `24 hours`; invalid configuration falls back to the safe bounded default. The deadline starts at claim, is stored as `deadline_ms`/`deadline_at`, caps the lease, is not extended by heartbeats, aborts cooperative work, and finalizes a timed-out job as `JOB_DEADLINE_EXCEEDED` after cleanup/fencing.

The deadline contract suite passes `4/4` deadline tests within the `worker-phase5` file.

## 43 Process tree termination

Providers register spawned child processes with the current job scope. Cancellation and deadline expiry call the centralized process-control path. On Windows the termination command is exactly `taskkill /PID <pid> /T /F`; non-Windows is a deliberate no-op rather than an unsafe guessed command. The result records attempted/failed/terminated state without claiming that a successful command proves every possible orphan was removed.

## 44 Crash matrix

The real Windows synthetic probe passed:

```text
status: PASSED
platform: win32
python_command: python
tree: one synthetic Node -> Python process tree
taskkill exit code: 0
descendants_absent: true
```

The probe observed a real parent/descendant tree and verified the parent and enumerated descendants were absent after recursive termination. This is bounded evidence for the exercised Windows tree only, not a universal production-worker orphan guarantee.

## 45 Graceful shutdown

`scripts/worker.ts` now handles `SIGINT`/`SIGTERM` by stopping new work, invoking centralized tracked-tree cleanup, and awaiting the cleanup promise before exit. Queue leases, stale recovery, bounded retries, and process cleanup remain separate controls. A long-lived production shutdown soak with every native provider is not measured.

## 46 Queue telemetry

`/api/admin/operations` is a dynamic, no-store, role-restricted, PHI-free bounded snapshot. It reports at most `100` sampled jobs, status counts, overdue running deadlines, active tracked subprocess count, worker mode, crash-recovery policy, termination method, resource-governor snapshot, and deadline policy. It does not expose patient/document identifiers or raw job payloads.

## 47 Worker health

The durable queue retains `queued`, `running`, `stale`, `retryable`, `completed`, `failed`, and `cancelled` states; attempt/worker ownership, heartbeat, lease fencing, stale recovery, and bounded retry policy remain in force. Default worker polling is one job per cycle. The implementation supports external-worker mode and in-process mode, but no HA deployment, autoscaling, or long-run throughput SLO is claimed.

## 48 One-shot benchmark

The existing measured engineering benchmark is for the SegFormer anatomy candidate and is intentionally separate from resident-worker evidence:

| Mode | Samples | p50 | p95 |
|---|---:|---:|---:|
| Cold isolated subprocess | 3 | `9900.7 ms` | `10356 ms` |
| Warm isolated subprocess calls | 3 | `9514.6 ms` | `10026.4 ms` |

The result is from `docs/generated/model-performance.json`, measured `2026-09-10`, with peak RSS null/unobserved. A current `MODEL_BENCHMARK_RUNS=1` attempt was interrupted because sampling was too slow and produced no result; it is not used as evidence.

## 49 Resident experiment

`npm run model:runtime-experiment` emitted an auditable envelope at commit `18a39cdc1e67fb10c499ba9abf2c4e6ec1e9cd04`, run id `phase5-runtime-20260912201844034`, script SHA-256 `a82c2672b7c94b4ff99434c625a7fd2ac59b2261a52fea42ccb5df180d1186f1`. The envelope status is `NOT_MEASURED` because no approved resident model worker exists. Requested load points `1`, `5`, `10`, and `25` are all null/unmeasured; second-worker execution was not run without a measured governor-backed memory check.

## 50 Memory

Historical process-tree working-set observations remain approximate: lesion worker `1.34–1.39 GiB`, DR worker `0.442 GiB`, OCT worker `1.07 GiB`, and SegFormer worker `1.235–1.245 GiB`. The current performance artifact reports `peak_rss_bytes: null`. The new governor accounts declared reservations but does not measure or enforce OS memory, so memory safety is **PARTIAL**.

## 51 CPU

The registered research providers use CPU-oriented isolated Python/ONNX paths. No current Phase 5 CPU utilization series, native-thread census, or resident-worker CPU measurement was captured. CPU compatibility is therefore an implementation fact for the exercised paths, not a throughput or utilization claim.

## 52 Load test

The requested concurrency set was `[1, 5, 10, 25]`. The runtime envelope records all four as `NOT_MEASURED` with null throughput, latency, memory, CPU, timeout, retry, and failure values. A second worker was not run. There is no accepted capacity number.

## 53 Queue latency

**Not measured.** No Phase 5 synthetic load run produced queue p50/p95 or claim-to-start latency. The queue contract is bounded and durable, but latency under contention is not established.

## 54 Service latency

The only measured service-like evidence is the historical SegFormer one-shot timing in section 48. End-to-end upload, document extraction, model admission, persistence, and report-generation latency is not measured as a Phase 5 SLO.

## 55 Throughput

**Not measured.** No jobs-per-second, sustained queue throughput, or failure-adjusted throughput value is reported. This avoids converting one-shot timing or test duration into a capacity claim.

## 56 Validation center UI

`/validation-center` is an internal research-review surface with a server shell and client-rendered role-scoped data. It displays model identity and limitations, baseline FN/FP evidence, OCT split/aggregation evidence, resource/deadline/worker state, traceability, and explicit PHI/clinical boundaries. The page is reachable through the existing application shell and its API is limited to `ADMIN`, `REVIEWER`, and `RESEARCHER` roles.

The real browser responsive, accessibility, keyboard, and asset gates cover the new route.

## 57 Operations UI

The operations snapshot is backed by `/api/admin/operations`, uses dynamic request-time authorization and `cache-control: no-store`, and exposes bounded counts rather than raw records. It shows whether the worker is external or in-process, whether crash recovery and centralized termination are configured, current local reservations, and the bounded deadline policy. It is observability, not a clinical dashboard and not a substitute for infrastructure monitoring.

## 58 Specialist Center

The existing Specialist/Clinician Center remains evidence- and review-oriented. Phase 5 does not add a validated specialist disease engine. The Validation Center links research evidence and operational state to review; it does not activate a candidate, authorize a diagnosis, or suppress clinician review.

## 59 Evidence trace

Current analyses retain a row-oriented `model_execution_ledger` with model/version, artifact hash, input asset/ROI, laterality, eligibility, execution status, quality/domain state, runtime, output contract, validation state, and dependency group. The claim ledger retains evidence refs, source/model/rule/knowledge refs, laterality, release state, provenance, blocked reasons, and mandatory clinician review.

Document routing retains source document/page hashes and ROI hashes. The browser asset gate verified `3` PDF pages, `8` OCT ROIs, multiple ledger rows, and rendered report routing/provenance text. No browser-supplied ledger or model result is trusted as server evidence.

## 60 Security

The Phase 5 security suite passes `9/9`. Covered controls include candidate-only promotion, immutable/hash-bound competition contracts, no fake comparison result, missing-output fail-closed behavior, artifact-integrity boundary, RBAC/scope seams, PHI-free operations state, and security/tamper cases in the synthetic pack. There is no new public competition HTTP endpoint; competition evaluation is a local/scripted contract surface.

The dependency install reports `2` moderate npm audit findings; they remain a supply-chain remediation item and are not hidden by the Phase 5 report.

## 61 PHI

Phase 5 source artifacts, candidate inventory, acceptance data, runtime envelope, operations API, CI, and browser fixtures are classified PHI-free or synthetic-only. Operations responses intentionally exclude identifiers and raw payloads. Local production-like storage still requires operator access control, retention, encryption, backup, and legal/clinical governance; a PHI-free test artifact does not make deployment PHI-free.

## 62 Secrets

No credentials, patient identifiers, model outputs, or provider secrets were committed. Hosted browser CI creates an ephemeral masked password. Local browser asset E2E used the synthetic `smoke-admin` account supplied to the local test environment. The candidate inventory includes public source links and publisher-reported digests only; an un-downloaded publisher digest is not treated as local artifact verification.

## 63 Phase 5 acceptance cases

`validation-cases/phase5-false-negative-reduction-pack.json` contains `64` synthetic cases across eight groups and `145` assertions. `tests/phase5-acceptance-pack.test.ts` verifies:

- every case is synthetic and structurally complete;
- all required categories and provenance boundaries are present;
- forbidden reassurance/diagnosis/treatment literals are represented;
- missing outputs and mutated cases fail closed;
- the pack remains separate from patient data and model artifacts.

## 64 Equipped test totals

The equipped local run (three installed research manifests and artifacts) passed:

```text
82 test files passed, 1 skipped
1,090 tests passed, 13 skipped
1,103 total; exit 0
```

The Phase 5 focused command at the final implementation head passed `8` files and `52` tests. Equipped means local research artifacts were available; it does not mean the models are clinically validated.

## 65 No-model test totals

The fresh detached checkout `D:\visionscan-phase5-clean-20260913` at exact `18a39cd` was created without `.env`, database, uploads, or model files. After `npm ci`, `npm run setup`, and `npm run db:init`, its full single-worker suite passed:

```text
81 test files passed, 2 skipped
1,056 tests passed, 47 skipped
1,103 total; exit 0
```

The only intentional model-dependent skip was the measured DR baseline-freeze test when the DR manifest was absent. Model-free behavior is therefore explicit, not simulated as a model result.

## 66 TypeScript

`npx tsc --noEmit --pretty false` passed with exit `0` on the main worktree and the fresh no-model checkout. The clean checkout production build also completed its internal TypeScript phase successfully.

## 67 lint

`npm run lint` completed with exit `0` on the final implementation worktree.

## 68 build

`npm run build` passed on the fresh no-model checkout at `18a39cd` using Next.js `16.3.4` webpack. It compiled successfully, completed TypeScript, generated `22/22` static pages, and included `/validation-center` and `/api/admin/operations` in the route map.

## 69 smoke

The authenticated local smoke gate passed `16/16`. It exercised the real local server, synthetic account, fundus path, red-flag triage, quality failure, review, compare, self-test, deletion, and unauthenticated access boundaries.

## 70 responsive

The real Playwright responsive gate passed `88/88`. It includes the Validation Center route, hydration-aware login, and the corrected 320 px/350 px layout overflow boundary.

## 71 accessibility

The real Playwright axe gate passed `22/22`. The Validation Center tables expose focusable scroll regions with labels, resolving the scrollable-region accessibility requirement without removing the data.

## 72 keyboard

The real Playwright keyboard gate passed `23/23`. It includes the hydrated mobile drawer interaction and Enter-key route handling for the added Validation Center navigation item.

## 73 browser E2E

The authenticated real-asset browser gate passed:

```text
Chrome login/dashboard
metadata-free fundus upload
RESEARCH_MODEL_ANALYSIS with lesion + DR execution
mixed PDF queued and extraction completed
3 routed PDF pages
8 OCT ROIs
report rendered research provenance and PDF routing
BROWSER ASSET E2E: PASSED
```

The hosted no-model browser job in CI also passed. The local asset gate uses synthetic generated fundus/PDF/OCT content and deletes the study in cleanup.

## 74 model audit

Equipped `npm run model:audit` passed with three manifests and no patient data:

| Model | Artifact SHA-256 | Validation state |
|---|---|---|
| `fundus-dr-grading-effb0` | `0d9a18b0cb6c90d1f30bf2e66153b368bd7ff0bcb45b6690e8d5ce14fa19f69b` | `RESEARCH_ONLY` |
| `fundus-lesions-clementp-unet-seresnext50` | `a7a7cb45b92328f7c9a8e581eec3944fd435d37fae8cbf340b1319c5f987c6d2` | `RESEARCH_ONLY` |
| `oct-retinal-weights-fp32` | `22b1fffb5a0ab88284d4c5817c581bedb1b54c09011d87c3f6472cb2c36b2b1f` | `RESEARCH_ONLY` |

The fresh no-model audit also passed with `0` manifests and no patient data.

## 75 filesystem audit

The equipped D-drive filesystem audit passed. Source, Git, uploads, documents, processed analyses, reports, database, model storage, logs, and temp roots were all on `D:`; free space was approximately `384.2 GB`. The fresh no-model audit also passed with empty upload/document/processed/report/model/log/temp roots and only its initialized SQLite file.

## 76 SBOM

`npm run sbom` completed with exit `0` and generated the CycloneDX SBOM from `package-lock.json` and local research manifests. The package-lock SHA-256 is `578f9898fe3222c787e547659c92265d70c012a19eb7207e504fcf620d71acef`; the generated SBOM SHA-256 is `df9dff9e2f2148ab0e911832e388b4282359d138df3a10eff69fb3b6a4dde930`. The SBOM records `patient-data-included: false` and `phi-included: false`, includes the three installed research models with their exact hashes, and is not a clinical or licensing clearance certificate.

## 77 clean checkout

The final implementation was verified in detached checkout `D:\visionscan-phase5-clean-20260913` at `18a39cd` with:

```text
npm ci                         PASS
npm run setup                  PASS
npm run db:init                PASS
npm test -- --pool=forks ...  PASS (81 files, 1056 tests; 2 files/47 tests skipped)
npx tsc --noEmit               PASS
npm run model:audit            PASS (0 manifests)
npm run audit:fs               PASS
npm run build                  PASS (22/22 static pages)
```

The checkout contained no `.env`, model artifact, upload, report, or pre-existing database before setup.

## 78 Linux CI

`verify` in run `34717367773` passed on Linux, including the full test suite, the Phase 5 acceptance command, no-model-safe model audit, de-identified SBOM generation, filesystem audit, release inventory, and production build.

## 79 Windows CI

`verify-windows` in run `34717367773` passed on Windows, including Windows path/reparse tests, full tests, Phase 5 acceptance, model audit, SBOM, filesystem audit, and production build.

## 80 Browser CI

`verify-browser` in run `34717367773` passed with an isolated empty SQLite store, an ephemeral masked synthetic account password, no models, no patient data, and no provider credentials. It covered login/dashboard and the hosted browser route smoke. The expanded local asset/responsive/a11y/keyboard gates are reported in sections 69–73.

## 81 Independent model audit

The independent model review concluded **PARTIAL / NOT PROVEN** for Phase 5 model improvement. It confirmed that no candidate was installed or fairly compared, that existing model evidence is research-only, that lesion region FP burden is not measurable from the export, and that candidate license/artifact/data rights remain blockers. It did not find evidence supporting a candidate promotion or a DR FN reduction claim.

## 82 Independent system audit

The independent system review concluded **PARTIAL / NOT PROVEN** for complete Phase 5 operational readiness. The review accepted the candidate boundary, acceptance pack, security seam, queue/deadline/process integrations, and Validation Center direction, while retaining limitations: the resource governor is process-local, the resident worker/load experiment is absent, and the real crash matrix is bounded to one synthetic Windows tree. No universal orphan-free, OS-safe, HA, or throughput claim is made.

## 83 Remaining model blockers

- No candidate artifact has local SHA-256 acquisition evidence.
- No candidate has a same-protocol case-level result on the frozen patient-separated split.
- No candidate calibration, threshold, subgroup, device, or external validation has been accepted.
- Candidate licenses, learned-weight rights, and dataset downstream rights remain unresolved where documented.
- Existing DR grade-3/grade-4 sensitivity remains very low in the measured baseline.
- No candidate may enter the live registry without independent review and a complete immutable result bundle.

## 84 Remaining engineering blockers

- The resource governor is cooperative process-local accounting, not an OS memory/thread limit.
- No approved resident model worker exists; resident safety, memory growth, reload, and concurrency remain unmeasured.
- Queue latency, service latency, throughput, CPU utilization, and sustained load are not established.
- The real process-tree probe covers one synthetic Node-to-Python Windows tree, not every launcher/provider failure mode.
- No HA, autoscaling, multi-host resource coordination, or production soak evidence exists.
- Dependency remediation remains open for the `2` moderate npm audit findings.

## 85 Remaining data blockers

The current data release check remains blocked:

```text
active_unresolved_sources: 235
legacy_unresolved_sources: 131
active_fk_orphan_count: 0
legacy_orphan_count: 5263
cross_tenant_count: 0
hash_mismatch_count: 0
quarantine_count: 81
active_data_release_safe: false
status: BLOCKERS_REMAIN
```

The active findings include `233` active missing-required-artifact findings and `2` active detached-analysis-parent findings. Legacy relationship cleanup and explicit reconciliation remain required before a broad data release.

## 86 Remaining clinical blockers

- No prospective clinical validation or clinical utility study.
- No accepted medical-device classification or regulatory pathway.
- No device/scanner, site, demographic, or subgroup validation.
- No clinical calibration or validated referral threshold.
- No proof that lesion-like regions localize true pathology in deployment conditions.
- No clinician adjudication study demonstrating safe FN reduction or acceptable added review burden.
- No autonomous diagnosis, treatment, or medication authorization.

## 87 Exact capabilities

At this release, the system can exactly:

- run a registry-bound, research-only fundus DR grade estimate when the artifact, modality, quality, OOD, and source gates pass;
- run a separate research-only fundus lesion-like localization path when its gates pass;
- compare same-study categorical research signals and surface contradictions;
- route and extract mixed PDF content, preserve page/source/ROI hashes, and admit only verified OCT B-scan derivatives;
- aggregate OCT class observations without averaging logits or claiming normality;
- preserve model/input execution and claim provenance with laterality and release state;
- represent model unavailable, failed, skipped, blocked-quality, blocked-OOD, unsupported, and incomplete states;
- use durable queue leases, heartbeat, stale recovery, bounded retries, cancellation, overall deadlines, cooperative resource admission, and Windows process-tree cleanup;
- expose bounded PHI-free operations telemetry to approved internal roles;
- render the Validation Center and evidence-oriented review surfaces;
- pass the documented model-free CI, clean checkout, synthetic acceptance, local browser, and Windows probe gates.

## 88 Exact non-capabilities

It cannot exactly or safely claim:

- that Phase 5 reduced DR false negatives;
- that any candidate is better, accepted, clinically validated, or ready for production;
- that a DR score is a probability or that a grade is a diagnosis/referral decision;
- that an OCT `NORMAL` class means a healthy eye or excludes disease;
- that a lesion-like region is a confirmed lesion or clinical localization;
- that the governor guarantees OS RAM/thread safety;
- that the resident worker, load, queue latency, throughput, or HA behavior is validated;
- that a missing model, negative result, empty finding set, or worker failure proves normality;
- that unsupported specialties, treatment, or medication recommendations are available;
- that the current dataset is safe for broad release while unresolved active findings remain.

## 89 Software classification

**ENGINEERING PARTIAL — BLOCKERS REMAIN.** The software has strong contract, persistence, authorization, provenance, worker, and browser evidence, but resource enforcement, resident/load performance, production soak, dependency remediation, and data-release blockers remain.

## 90 Model classification

**MODEL INTELLIGENCE PARTIAL.** Existing models execute as research-only local capabilities with measured limitations. No Phase 5 candidate was accepted, no head-to-head was measured, and no false-negative improvement was proven.

## 91 Performance classification

**LOCAL PERFORMANCE PARTIAL.** One-shot SegFormer timing is available. Resident-worker, peak RSS, CPU utilization, load, queue latency, service latency, and throughput evidence are absent or incomplete.

## 92 Data classification

**DATA RELEASE BLOCKED.** The latest release data check reports `235` active unresolved sources, `131` legacy unresolved sources, and `active_data_release_safe: false`. Hash mismatch and cross-tenant counts are zero in that run, but those positives do not clear the unresolved-source blockers.

## 93 Demo classification

**CONTROLLED SYNTHETIC DEMONSTRATION / RESEARCH WORKFLOW ONLY.** The application can demonstrate authenticated upload, routing, research execution when local artifacts are installed, evidence display, review boundaries, and failure states. Demonstration success is not clinical validation.

## 94 Clinical classification

**NOT CLINICALLY VALIDATED / NOT A MEDICAL DEVICE / NOT FOR AUTONOMOUS DIAGNOSIS.** All model outputs and condition patterns require qualified ophthalmic review and clinical correlation. The system must not be used as a stand-alone diagnostic, triage, referral, or treatment authority.
