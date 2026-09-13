# VisionScan AI Eye Center

## Final Engineering Sign-off Report

Report date: 2026-09-14
Repository: https://github.com/Sephy57/visionscan-ai-eye-center
Branch: main
Scope: final Phase 11 evidence close-out only. This is not Phase 12.
Evidence policy: observed repository behavior, committed artifacts, real subprocess/worker runs, local gates, and exact-head CI. No clinical validation is implied.

The final decision is:

ENGINEERING PARTIAL — BLOCKERS REMAIN.

The three requested runtime evidence gaps were exercised:

- real provider-mutex wait cancellation passed;
- one new post-policy 25-job provider run passed its bounded accounting/safety criteria;
- a fresh independent read-only audit completed, but returned INCONCLUSIVE rather than the required no-P0 certification.

The exact evidence-head Linux, Windows, and Browser CI workflow passed. The software classification remains PARTIAL because the independent audit did not return PASS_NO_P0_ENABLED_PATH_BLOCKER. This report therefore does not promote the software classification.

The following boundaries remain unchanged:

- MODEL INTELLIGENCE PARTIAL / RESEARCH-ONLY
- RETINAL REVIEW INTELLIGENCE PARTIAL — INTERNAL HELD-OUT EVIDENCE ONLY
- DATA RELEASE BLOCKED
- DEMO MODE / SYNTHETIC OUTPUT ONLY
- NOT CLINICALLY VALIDATED
- NOT A MEDICAL DEVICE
- NOT FOR AUTONOMOUS DIAGNOSIS

Evidence labels used here:

- UNIT: isolated contract or code-path test.
- INTEGRATION: multiple application components exercised together.
- REAL_SUBPROCESS: an actual child process was launched and observed.
- REAL_WORKER: an actual VisionScan worker or provider workflow was run.
- REAL_BROWSER: browser interaction against a running application.
- CI: hosted workflow evidence.
- NOT_MEASURED: the requested fact was not captured and is not upgraded to PASS.

## 1. Executive decision

Decision: ENGINEERING PARTIAL — BLOCKERS REMAIN.

The enabled local runtime has now measured real provider-mutex cancellation, a new bounded provider-capacity run, graceful shutdown/recovery, active-provider deadline cleanup, resource-wait deadline behavior, post-terminal restart idempotency, explicit overload states, FIFO control-plane ordering, review-conflict blocking, additive corrections, truthful retention wording, security/consent boundaries, local builds, clean no-model reproducibility, and exact-head CI.

The final software promotion rule is not met because the independent audit result is INCONCLUSIVE. The auditor observed no P0 blocker in the reviewed enabled paths, but would not certify that conclusion after identifying an evidence-reconciliation limitation. No independent approval is inferred.

## 2. Starting SHA

FINAL_SIGNOFF_START_SHA: fd4f4658b6f994f7c009e29e8d8acca682784f97.

This was the clean main-worktree head at the beginning of the final sign-off run. The Phase 11 implementation lineage began at c25686549be6e497070955ab81fce9eb3d84dd6e. The final sign-off evidence commit is recorded in Section 41.

## 3. Starting remote SHA

FINAL_SIGNOFF_START_REMOTE_SHA: fd4f4658b6f994f7c009e29e8d8acca682784f97 on origin/main.

The evidence commit was pushed normally and verified against origin/main. No force push, reset, history rewrite, or destructive cleanup was used.

## 4. Worktree state

The main worktree was clean before final sign-off evidence work. The evidence harnesses used isolated temporary roots and did not write the production database, patient data, model weights, or application clinical records.

The final report was created as a separate documentation commit after the evidence commit. The post-report check required by this report was run after publication and the main worktree was verified clean. The clean no-model worktree used for reproducibility was D:\visionscan-final-clean-4f27c81 and remained separate from the main worktree.

## 5. Preserved Phase 11 evidence

The following earlier evidence remains part of the release decision and was not weakened:

| Evidence | Preserved result |
| --- | --- |
| Graceful shutdown | PASS_REAL_SIGINT_LEASE_RECOVERY |
| Active-provider deadline | PASS_REAL_DEADLINE_AND_RESOURCE_WAIT |
| Post-terminal restart | PASS_REAL_POST_TERMINAL_CRASH_RESTART |
| Resident runtime | PASS_EXPLICIT_RESIDENT_DISABLED |
| Resident decision | RESIDENT_RUNTIME_REJECTED_DISABLED |
| Phase 10 FIFO control | 100 jobs, zero rank overtakes, starvation false |
| Data release | BLOCKERS_REMAIN; release:data-check remains blocking |
| Model manifests | Three manifests pass integrity audit and remain research_only |
| Clinical safety boundary | PASS_BOUNDARY_INTACT |

No new eye model, external dataset, RetGuard promotion, lesion-rule retuning, DR-baseline change, medication intelligence, clinical LLM, resident worker, UI redesign, or data deletion was introduced.

## 6. Mutex experiment configuration

Evidence: REAL_SUBPROCESS and REAL_WORKER. Artifact: docs/generated/final-mutex-wait-evidence.json.

The experiment used the existing local-fundus-lesion provider, model fundus-lesions-clementp-unet-seresnext50, and its existing hash-verified Python subprocess. It used a public/de-identified DeepDRiD fundus fixture with image SHA-256 6b672f301e7b258c0baf2a0cf06234f2e9350052ef30f9eb6634e18a0a4d2854. The two calls ran in the same Node process and targeted the fundusLesionLocalProvider module-level inferenceMutex.

The harness projected two isolated durable job states and separately observed the real provider child, without creating production application effects.

## 7. Real mutex wait proof

Job A acquired the shared provider mutex at 2026-09-13T21:02:51.806Z and completed the real provider call. Job B entered the same provider path, recorded provider_mutex_wait, and was observed while Job A’s Python child remained active.

The result is a measured blocked waiter, not only a unit-test invocation:

- same Node process;
- shared module-level mutex;
- real Python provider child observed;
- Job B abort/deadline occurred while the mutex was held by Job A;
- Job B did not proceed to provider launch.

## 8. Cancellation event

Job B mutex wait began at 2026-09-13T21:02:52.197Z. Its abort was recorded at 2026-09-13T21:02:52.286Z. The terminal durable state was JOB_DEADLINE_EXCEEDED with error FINAL_MUTEX_WAIT_DEADLINE_EXCEEDED.

The experiment did not reinterpret the cancellation as a provider error or clinical result. Job A was allowed to finish and Job B remained a terminal operational failure.

## 9. Provider launch result

Job B provider_launched_for_job_b: false.

The harness observed one tracked provider process during the wait, belonging to Job A. The observed Job A Python child was still present immediately after Job B’s abort, demonstrating that the waiter was cancelled while the mutex holder continued. No Job B model process or provider output was observed.

## 10. Canonical effect result

Job B canonical effect counts were all zero:

| Effect type | Job B count |
| --- | ---: |
| MODEL_RESULT | 0 |
| STRUCTURED_EVIDENCE | 0 |
| REASONING_RECORD | 0 |
| REPORT | 0 |
| JOB_COMPLETION | 0 |

The direct provider layer does not create normal application effects. The zero-effect result is therefore the safety assertion: the cancelled waiter did not publish model, clinical, evidence, reasoning, report, or canonical completion output.

## 11. Resource cleanup

The final mutex artifact records all cleanup checks true:

- mutex reusable after Job A;
- Job A not corrupted;
- Job B no model output;
- Job B no clinical negative;
- Job B no evidence, reasoning, or report;
- observed provider descendants absent after cleanup;
- tracked provider children absent after cleanup;
- resource active leases 0;
- stale reservations 0.

The descendant claim is limited to the actual children observed by this harness.

## 12. Mutex final classification

PASS_REAL_MUTEX_WAIT_CANCELLATION.

This closes the previously unmeasured real blocked-provider-mutex evidence gap. It does not establish exactly-once provider execution or universal cleanup for descendants that were never observed.

## 13. Frozen capacity policy

The new run froze this policy before submission:

- policy version: bounded-single-slot-absolute-job-deadline-v1;
- heavy-provider slots: 1;
- queue deadline: 120000 ms;
- service deadline: 600000 ms;
- total-age deadline: 720000 ms;
- resource polling interval: 250 ms;
- maximum durable attempts: 3;
- worker concurrency: 1;
- provider: local-fundus-lesion;
- model: fundus-lesions-clementp-unet-seresnext50;
- model SHA-256: a7a7cb45b92328f7c9a8e581eec3944fd435d37fae8cbf340b1319c5f987c6d2;
- max active resource leases: 1;
- resource request: 2 GiB, 4 threads, 1 GiB headroom, 60000 ms lease.

The policy has distinct explicit terminal states. Queue timeout is not relabeled as model failure, clinical negative, or provider error.

## 14. 25-job configuration

Evidence: REAL_SUBPROCESS and REAL_WORKER. Artifact: docs/generated/final-25-job-capacity-evidence.json.

The canonical run started at 2026-09-13T21:07:11.420Z and was observed at 2026-09-13T21:09:19.910Z on Windows 10.0.26200, x64, Node v20.20.2, Python 3.12.10, 12 CPUs, with 4,701,233,152 bytes free at start. It submitted exactly 25 public/de-identified fundus fixtures, with phi_included false.

All 25 jobs were accepted and accounted for. The final artifact was not rerun after its raw workload observation; derived metrics were corrected to represent the observed queue-timeout timestamps without changing the raw terminal states. This preserves the one-canonical-run rule.

## 15. Per-job result table

Queue and resource values are milliseconds. An em dash means the value was not applicable or was not separately measured for a queued job that never received admission.

| Rank | Claim | Complete | Job | State | Provider | Output | Queue wait | Resource wait | Service | Total | Attempts | Polls |
| ---: | ---: | ---: | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1 | 1 | final-capacity-job-01 | COMPLETED | yes | complete | 213.779 | 0 | 9040.943 | 9276.673 | 1 | 0 |
| 2 | 2 | 2 | final-capacity-job-02 | COMPLETED | yes | complete | 9246.898 | 9075.191 | 8289.244 | 17627.941 | 1 | 7 |
| 3 | 3 | 3 | final-capacity-job-03 | COMPLETED | yes | complete | 17647.587 | 17478.431 | 7858.898 | 25530.103 | 1 | 14 |
| 4 | 4 | 4 | final-capacity-job-04 | COMPLETED | yes | complete | 25548.166 | 25380.967 | 8695.482 | 34263.166 | 1 | 21 |
| 5 | 5 | 5 | final-capacity-job-05 | COMPLETED | yes | complete | 34285.729 | 34119.923 | 8266.892 | 42580.000 | 1 | 29 |
| 6 | 6 | 6 | final-capacity-job-06 | COMPLETED | yes | complete | 42601.568 | 42437.027 | 7842.186 | 50463.544 | 1 | 36 |
| 7 | 7 | 7 | final-capacity-job-07 | COMPLETED | yes | complete | 50482.117 | 50318.855 | 8635.688 | 59144.796 | 1 | 43 |
| 8 | 8 | 8 | final-capacity-job-08 | COMPLETED | yes | complete | 59163.350 | 59001.942 | 8525.369 | 67926.447 | 1 | 51 |
| 9 | 9 | 9 | final-capacity-job-09 | COMPLETED | yes | complete | 67943.347 | 67783.450 | 8086.507 | 76049.696 | 1 | 59 |
| 10 | 10 | 10 | final-capacity-job-10 | COMPLETED | yes | complete | 76067.858 | 75909.424 | 8688.301 | 84789.939 | 1 | 65 |
| 11 | 11 | 11 | final-capacity-job-11 | COMPLETED | yes | complete | 84809.219 | 84651.902 | 9352.001 | 94183.673 | 1 | 73 |
| 12 | 12 | 12 | final-capacity-job-12 | COMPLETED | yes | complete | 94199.976 | 94044.100 | 8009.787 | 102243.522 | 1 | 81 |
| 13 | 13 | 13 | final-capacity-job-13 | COMPLETED | yes | complete | 102259.969 | 102105.873 | 8617.519 | 110938.828 | 1 | 88 |
| 14 | 14 | 14 | final-capacity-job-14 | COMPLETED | yes | complete | 110956.269 | 110803.666 | 8459.717 | 119435.700 | 1 | 96 |
| 15 | 15 | 15 | final-capacity-job-15 | COMPLETED | yes | complete | 119455.141 | 119303.805 | 8283.371 | 127764.465 | 1 | 104 |
| 16 | — | — | final-capacity-job-16 | QUEUE_TIMEOUT | no | — | 120601.299 | — | 0 | 120601.299 | 1 | 105 |
| 17 | — | — | final-capacity-job-17 | QUEUE_TIMEOUT | no | — | 120599.705 | — | 0 | 120599.705 | 1 | 105 |
| 18 | — | — | final-capacity-job-18 | QUEUE_TIMEOUT | no | — | 120597.998 | — | 0 | 120597.998 | 1 | 105 |
| 19 | — | — | final-capacity-job-19 | QUEUE_TIMEOUT | no | — | 120596.794 | — | 0 | 120596.794 | 1 | 105 |
| 20 | — | — | final-capacity-job-20 | QUEUE_TIMEOUT | no | — | 120595.536 | — | 0 | 120595.536 | 1 | 105 |
| 21 | — | — | final-capacity-job-21 | QUEUE_TIMEOUT | no | — | 120594.300 | — | 0 | 120594.300 | 1 | 105 |
| 22 | — | — | final-capacity-job-22 | QUEUE_TIMEOUT | no | — | 120592.544 | — | 0 | 120592.544 | 1 | 105 |
| 23 | — | — | final-capacity-job-23 | QUEUE_TIMEOUT | no | — | 120591.131 | — | 0 | 120591.131 | 1 | 105 |
| 24 | — | — | final-capacity-job-24 | QUEUE_TIMEOUT | no | — | 120589.894 | — | 0 | 120589.894 | 1 | 105 |
| 25 | — | — | final-capacity-job-25 | QUEUE_TIMEOUT | no | — | 120588.683 | — | 0 | 120588.683 | 1 | 105 |

## 16. State counts

| Policy state | Count |
| --- | ---: |
| COMPLETED | 15 |
| DEFERRED_CAPACITY | 0 |
| QUEUE_TIMEOUT | 10 |
| SERVICE_TIMEOUT | 0 |
| JOB_DEADLINE_EXCEEDED | 0 |
| CANCELLED | 0 |
| PROVIDER_ERROR | 0 |
| UNKNOWN | 0 |

All 25 jobs have one explicit terminal policy state. There are zero lost and zero ambiguous jobs.

## 17. Queue latency

The 25-job queue-latency aggregate is:

- count 25;
- p50 102259.969 ms;
- p95 120597.998 ms;
- maximum 120601.299 ms.

The ten queued jobs reached the explicit QUEUE_TIMEOUT state at approximately the configured 120000 ms boundary. Queue timeout is an operational policy state, not a clinical result.

## 18. Resource latency

Resource wait was separately measured for the 15 admitted jobs:

- count 15;
- p50 59001.942 ms;
- p95 110803.666 ms;
- maximum 119303.805 ms.

The ten jobs that timed out while still queued have resource_wait_ms null because they were never admitted to the resource-lease wait path. They are not misreported as zero resource wait.

## 19. Service latency

The 15 admitted provider calls had:

- p50 8459.717 ms;
- p95 9040.943 ms;
- maximum 9352.001 ms.

The ten queue-timeout jobs launched no provider and therefore have service time 0 only as an explicit non-launch representation.

## 20. Total latency

Across all 25 jobs:

- p50 110938.828 ms;
- p95 120599.705 ms;
- maximum 127764.465 ms.

These are observed local timings under one bounded single-worker policy, not a production throughput or clinical service-level objective.

## 21. Throughput

The run completed 15 jobs in 128489.555 ms, equivalent to 0.116741 completed jobs per second.

This measures the observed bounded local provider workload. It does not promise 25/25 completion, multi-worker scale, or production capacity.

## 22. Durable retries

The run recorded 25 total durable attempts and a maximum of one durable attempt per job. No job was durably retried.

The maximum-attempt policy remains three, but the observed run did not need a second attempt. This is distinct from resource polling and does not represent 1,817 model launches.

## 23. Resource polling

The run recorded 1,817 resource-polling observations. They are classified separately from durable job retry and provider launch counts.

The canonical artifact records each admitted job’s polling count and records no unexpected provider descendants after the workload. Polling is an operational wait observation, not repeated model execution.

## 24. CPU/memory

The frozen host and provider budget were:

- Windows win32 release 10.0.26200, x64;
- Node v20.20.2;
- Python 3.12.10;
- 12 CPUs;
- 16,425,873,408 bytes total memory;
- 4,701,233,152 bytes free at start;
- provider request 2,147,483,648 bytes;
- provider request 4 threads;
- 1,073,741,824 bytes headroom;
- one active heavy lease.

The provider process-tree metrics are best-effort observations. They are recorded in the artifact and do not establish a universal host-resource SLO.

## 25. FIFO

The new run had claim ranks 1 through 15 equal to submission ranks and completion ranks 1 through 15 equal to claim ranks. No claim-rank overtakes occurred.

The separate 100-job control-plane probe recorded requested 100, observed 100, zero rank overtakes, starvation false, and FIFO_CONTROL_PLANE_PASS.

## 26. Starvation

Starvation count was zero. The artifact defines starvation as an accepted job lacking any explicit final policy state; the ten QUEUE_TIMEOUT rows are explicit terminal states and therefore are not starvation.

This does not claim a sustained production starvation SLO. It establishes the bounded behavior exercised by the run and the control-plane probe.

## 27. Resource cleanup

After the 25-job workload:

- active heavy leases: 0;
- active leases before reaping: 0;
- stale reservations: 0;
- active leases after reaping: 0;
- unexpected provider descendants: none;
- all workload rows accounted for.

The provider resource lease was not left held by a completed or timed-out job.

## 28. Capacity classification

PASS_NEW_POST_POLICY_25_JOB_CAPACITY for the declared bounded policy criteria:

- all 25 submitted;
- all 25 accounted for;
- zero lost;
- zero ambiguous;
- zero false clinical negatives from overload;
- heavy concurrency bounded by one active lease;
- explicit terminal state for every job;
- zero starvation;
- final active lease zero;
- no unexpected provider descendants.

This is not a claim that all 25 jobs must complete. It is also not a production capacity SLO or clinical performance claim.

## 29. Full equipped suite

The model-equipped authoritative run was:

npm test -- --pool=forks --poolOptions.forks.singleFork=true

Observed result: 90 test files passed, 1 skipped; 1,234 tests passed, 13 skipped; exit code 0; duration 442.24 seconds.

The full release verification matrix repeated the same test totals and exited 0 for its unit_tests step. The expected negative restore/tamper stderr from tests was asserted by passing tests and is not treated as a suite failure.

## 30. TypeScript

Main worktree: npx tsc --noEmit --pretty false passed with exit 0 after correcting a test-only harness import.

Clean no-model checkout at the evidence SHA: the same TypeScript command passed with exit 0.

## 31. Lint

npm run lint passed with exit 0 in the main worktree and in the clean no-model checkout. The final evidence harnesses are included in the lint scope.

## 32. Model audit

The main model manifest audit passed with three manifests, zero patient-data inclusion, and all three model packages marked research_only:

| Model | Artifact SHA-256 | Status |
| --- | --- | --- |
| fundus-dr-grading-effb0 | 0d9a18b0cb6c90d1f30bf2e66153b368bd7ff0bcb45b6690e8d5ce14fa19f69b | PASS; research_only |
| fundus-lesions-clementp-unet-seresnext50 | a7a7cb45b92328f7c9a8e581eec3944fd435d37fae8cbf340b1319c5f987c6d2 | PASS; research_only |
| oct-retinal-weights-fp32 | 22b1fffb5a0ab88284d4c5817c581bedb1b54c09011d87c3f6472cb2c36b2b1f | PASS; research_only |

The clean no-model checkout’s model audit passed with zero manifests and no patient data.

## 33. Filesystem audit

npm run audit:fs passed in the main worktree and in the clean D: checkout. The clean checkout confirmed source, repository, data-root directories, and model storage on D:, with zero checkout-local uploads, documents, processed files, or reports. The main D: filesystem audit reported approximately 369.2 GB free at the time of observation.

Application data remains on D:. The system Node runtime and default npm cache remain unavoidable C: dependencies and are disclosed by the audit.

## 34. Secret scan

npm run security:phase11:secrets passed:

- status PASS_NO_HIGH_CONFIDENCE_SECRET;
- 613 tracked text files scanned;
- zero findings;
- placeholders excluded;
- credentials not printed.

## 35. Security

The focused security, authorization, consent, prompt-safety, path/reparse, backup/restore, lease, retry, review, diagnosis-gate, no-false-normal, and cross-tenant suites passed. The clinical-safety boundary artifact is PASS_BOUNDARY_INTACT.

The production dependency audit passed with zero vulnerabilities. The full development dependency audit still reports two moderate Vitest/@vitest/mocker advisories; they are retained as development-tool maintenance findings and are not silently converted to zero.

No penetration-test certificate, universal security guarantee, or clinical safety certification is claimed.

## 36. release:data-check

The release-data gate remains intentionally blocked and was not weakened:

- command exit: 1;
- status: BLOCKERS_REMAIN;
- active unresolved sources: 235;
- legacy unresolved sources: 158;
- active FK orphans: 0;
- legacy orphan references: 5263;
- cross-tenant references: 0;
- hash mismatches: 0;
- quarantine count: 81;
- PHI included: false;
- active_data_release_safe: false.

Active source reasons are 233 MISSING_REQUIRED_ARTIFACT and 2 DETACHED_ANALYSIS_PARENT. Legacy reasons are 87 MISSING_REQUIRED_ARTIFACT and 71 MISSING_REPORT_EXPORT. The data release block is independent of the software test result.

## 37. Windows build

The main local Windows release verification run completed the production build with exit 0. Next.js 16.3.4 webpack compiled successfully, TypeScript completed, and 22/22 static pages were generated. The build duration was 660713 ms within release:verify.

The overall release:verify command exited 1 solely because its release_data_check step preserved the intentional data blocker. Its other 12 steps, including production_build, exited 0.

The clean no-model checkout at the exact evidence SHA also completed npm run build with exit 0, compiled successfully, and generated 22/22 static pages.

## 38. Clean no-model checkout

Fresh detached checkout: D:\visionscan-final-clean-4f27c81
Exact SHA: 4f27c81e163f1058e9d2ef79faed2d9b9f2d9460

The checkout began without .env, database, uploads, reports, scratch data, model weights, or node_modules. npm ci passed, setup passed, and SQLite initialization passed.

The model-free full suite passed with 89 files passed, 2 skipped; 1,200 tests passed, 47 skipped; exit code 0. The expected skips are artifact-dependent/model-bridge cases; no fake model output was produced.

Clean-checkout typecheck, lint, model audit, filesystem audit, SBOM, production dependency audit, build, smoke, and browser smoke all passed. The clean model audit found zero manifests and the clean filesystem audit found zero checkout-local patient/data files.

## 39. Smoke

The clean checkout HTTP smoke passed 16/16 checks on an isolated local server. It exercised synthetic upload, consent, structured symptoms, invalid symptom rejection, model-unavailable behavior, red-flag triage escalation, report labeling, quality gating, clinician finalization, temporal comparison, locked self-test, deletion, unauthenticated rejection, and role behavior.

The returned analysis explicitly stated model unavailability and did not fabricate findings or a clinical normal result.

## 40. Browser

The clean checkout hosted browser smoke passed 7 checks:

- login to dashboard;
- /dashboard;
- /patients;
- /analyze;
- /validation-center;
- /result;
- /report.

The browser used a synthetic account, no model/data assets, a real local server, and basic accessible-structure checks. The first account attempt was rejected after the smoke run had consumed the one-time bootstrap window; rerunning with the existing synthetic account passed and did not change code or evidence.

## 41. Implementation/evidence SHA

IMPLEMENTATION_EVIDENCE_SHA: 4f27c81e163f1058e9d2ef79faed2d9b9f2d9460.

This evidence commit is Add final Phase 11 runtime sign-off evidence. It contains:

- docs/generated/final-mutex-wait-evidence.json;
- docs/generated/final-25-job-capacity-evidence.json;
- reproducible final-mutex-wait-experiment.ts;
- reproducible final-25-job-capacity.ts;
- refreshed FIFO control and release-governance evidence.

The independent audit artifact and this report are documentation/evidence outputs added in the separate report commit. No scientific/model behavior change is included.

## 42. Push parity

Before the final report commit, the evidence parity check was:

git rev-parse HEAD
4f27c81e163f1058e9d2ef79faed2d9b9f2d9460

git ls-remote origin refs/heads/main
4f27c81e163f1058e9d2ef79faed2d9b9f2d9460 refs/heads/main

The report commit is intentionally not self-embedded in this file. Its exact REPORT_SHA and post-report remote parity are recorded in the final handoff after commit so a self-referential hash is not presented as evidence.

## 43. Linux CI

Exact evidence-head workflow run: 34784732836
Head SHA: 4f27c81e163f1058e9d2ef79faed2d9b9f2d9460
Job: verify
Job ID: 103798016798
Conclusion: success.

The Linux job passed install, SQLite initialization, typecheck, single-worker tests, migration/backup checks, acceptance gates, model audit, SBOM, inventory, filesystem audit, and production build.

## 44. Windows CI

Exact evidence-head workflow run: 34784732836
Head SHA: 4f27c81e163f1058e9d2ef79faed2d9b9f2d9460
Job: verify-windows
Job ID: 103798016854
Conclusion: success.

The Windows job passed install, SQLite initialization, typecheck, native path/reparse tests, single-worker tests, acceptance gates, model audit, SBOM, filesystem audit, and production build.

## 45. Browser CI

Exact evidence-head workflow run: 34784732836
Head SHA: 4f27c81e163f1058e9d2ef79faed2d9b9f2d9460
Job: verify-browser
Job ID: 103798016626
Conclusion: success.

The Browser job passed isolated SQLite setup, synthetic account setup, Chromium installation, local-server startup, hosted browser smoke, and cleanup.

## 46. Independent auditor identity/type

Auditor identity supplied by the subagent: Newton.
Auditor type: explorer.
Audit type: fresh bounded read-only engineering audit.
Audit target: 4f27c81e163f1058e9d2ef79faed2d9b9f2d9460.

The auditor reported no file changes, no experiments, no commits, and no pushes. It was instructed to inspect actual code and evidence, not to treat repository prose as approval.

## 47. Evidence reviewed

The independent auditor reviewed or cited:

- docs/VISIONSCAN_PHASE11_FINAL_SOFTWARE_ENGINEERING_RELEASE_REPORT.md;
- phase11-live-shutdown-final.json;
- phase11-deadline-evidence.json;
- phase11-post-terminal-crash.json;
- final-mutex-wait-evidence.json;
- final-25-job-capacity-evidence.json;
- phase10-load-fairness.json;
- phase10-resident-validation.json;
- phase11-clinical-safety-boundary-audit.json;
- release-data-check.json;
- the clean no-model checkout;
- lib/jobs/effects.ts;
- lib/studies/service.ts;
- docs/CONSENT_DATA_GOVERNANCE.md.

Its question results were PASS for the reviewed lifecycle, mutex, capacity, security, retention, clean-checkout, and build evidence, INCONCLUSIVE for its CI reconciliation question, and INCONCLUSIVE for definitive P0 clearance.

## 48. Auditor result

The exact independent auditor result is:

INCONCLUSIVE

The required exact result was not rewritten or upgraded. The auditor stated that no P0 blocker was observed in the reviewed enabled paths, but it did not issue PASS_NO_P0_ENABLED_PATH_BLOCKER because it could not reconcile the newer exact-head CI run with the older committed phase11-ci.json record during its audit session.

## 49. Auditor limitations

The independent result remains INCONCLUSIVE for these reasons:

- the committed phase11-ci.json artifact still referenced an older successful head;
- the auditor did not independently reconcile the newly verified run 34784732836 at 4f27c81;
- the capacity harness does not persist normal application canonical reports/effects;
- descendant cleanup is proven only for observed/owned processes;
- the audit is not clinical validation, regulatory review, or model-performance sign-off.

The later exact-head CI observation is recorded in Sections 43–45, but it does not retroactively change the independent auditor’s exact returned result.

## 50. Clinical-safety boundary audit

The preserved boundary audit status is PASS_BOUNDARY_INTACT.

The measured software boundaries remain:

- research-only model manifests;
- clinician review and provenance retained;
- no-false-normal gate retained;
- diagnosis gate retained;
- prompt-injection content treated as untrusted;
- unresolved review conflict blocks finalization;
- laterality correction is additive and reasoned;
- data-release block remains explicit.

These are software/governance boundary results. They are not evidence of clinical safety, clinical validity, regulatory compliance, or authorization for patient care.

## 51. Remaining software blockers

The qualifying independent no-P0 sign-off remains unresolved because the auditor result is INCONCLUSIVE. This prevents the maximum software classification.

No P0 correctness blocker was observed in the enabled paths reviewed by the auditor. The remaining non-P0 engineering limitations include best-effort observed-descendant scope and two moderate development-dependency advisories. They remain disclosed rather than zeroed.

## 52. Remaining model blockers

Model intelligence remains research-only. External clinical validation, multi-site/device validation, calibration/operating-point approval, rights/provenance clearance for all research assets, and clinically meaningful performance sign-off remain open.

The DR, lesion, and OCT models remain integrity-checked research packages. No new scientific or model claim is made by this sign-off.

## 53. Remaining data blockers

Data classification remains DATA RELEASE BLOCKED. The current release-data evidence contains 235 active unresolved sources, 158 legacy unresolved sources, and 5263 legacy orphan references. Active release safety is false.

No data deletion, orphan suppression, quarantine weakening, source rewrite, or hash-check weakening was used to obtain the runtime results.

## 54. Remaining clinical blockers

Clinical validation, regulatory review, medical-device determination, prospective clinical evaluation, external held-out validation, and clinician-approved operating points remain open.

The system must not be used for autonomous diagnosis, treatment selection, or patient-specific clinical advice. The evidence in this report is engineering and research evidence only.

## 55. Exact capabilities

Within the bounded local research scope, VisionScan can:

- authenticate users and enforce role/tenant boundaries;
- accept scoped study inputs and purpose-specific processing consent;
- run configured local research providers when integrity and modality gates pass;
- preserve model provenance, evidence provenance, laterality, review state, and additive correction history;
- expose review-oriented retinal research outputs with explicit uncertainty and clinical-correlation gates;
- process jobs under durable leases, bounded single-worker heavy concurrency, absolute deadlines, explicit queue states, and process-tree cleanup;
- recover eligible active work after worker interruption and avoid duplicate canonical effects at the tested restart seam;
- cancel a provider-mutex waiter before provider launch and output;
- account for bounded overload with operational states rather than clinical negatives;
- run model-free ordinary tests, builds, smoke, and browser checks without copying private model weights into the checkout.

## 56. Exact non-capabilities

VisionScan cannot honestly be represented as:

- clinically validated;
- a medical device;
- approved for autonomous diagnosis;
- a diagnostic or normality oracle;
- a treatment recommender;
- a production multi-worker or unlimited-capacity service;
- a guarantee that every burst of 25 jobs completes;
- proof of clinical accuracy, calibration, fairness, prevalence, or generalization;
- proof of cleanup for descendants never observed by the process monitor;
- a resident-model runtime; resident mode is explicitly disabled;
- a data-release-safe package while release:data-check is blocked;
- an independent engineering approval when the auditor result is INCONCLUSIVE.

## 57. Software classification

ENGINEERING PARTIAL — BLOCKERS REMAIN.

The runtime and CI evidence are substantially green, but the independent audit did not return the exact qualifying PASS result. No promotion to ENGINEERING READY — CONTROLLED LOCAL RESEARCH is made.

## 58. Runtime classification

LOCAL RUNTIME VALIDATED — BOUNDED SINGLE-WORKER POLICY.

This is limited to the enabled local runtime, one heavy provider slot, observed Windows process behavior, explicit terminal states, and the tested evidence envelope.

## 59. Model classification

MODEL INTELLIGENCE PARTIAL / RESEARCH-ONLY.

Model artifacts are hash-checked and execution is gated, but clinical validation and production model governance are not established.

## 60. Retinal classification

RETINAL REVIEW INTELLIGENCE PARTIAL — INTERNAL HELD-OUT EVIDENCE ONLY.

Retinal outputs are review-oriented research evidence with provenance and clinical-correlation requirements. They are not autonomous diagnosis.

## 61. Data classification

DATA RELEASE BLOCKED.

The release-data check remains a required blocking gate and continues to report unresolved source and legacy orphan conditions.

## 62. Demo classification

DEMO MODE / SYNTHETIC OUTPUT ONLY.

Synthetic/demo output must remain visibly labeled and must not be presented as patient-specific validated clinical advice.

## 63. Clinical classification

NOT CLINICALLY VALIDATED
NOT A MEDICAL DEVICE
NOT FOR AUTONOMOUS DIAGNOSIS

## Primary final questions

## Q1. Was real provider mutex-wait cancellation measured?

Answer: YES. Evidence: REAL_SUBPROCESS/REAL_WORKER artifact final-mutex-wait-evidence.json records Job A holding the module-level provider mutex and Job B cancelling while waiting.

## Q2. Did the cancelled waiter avoid provider launch?

Answer: YES. Evidence: provider_launched_for_job_b is false.

## Q3. Did it emit any model/clinical output?

Answer: NO. Evidence: Job B MODEL_RESULT, STRUCTURED_EVIDENCE, REASONING_RECORD, REPORT, and JOB_COMPLETION effect counts are all zero; the artifact also records no clinical negative.

## Q4. Was the mutex reusable afterward?

Answer: YES. Evidence: mutex_usable_after_job_a is true and the cleanup checks pass.

## Q5. Were all resources cleaned?

Answer: YES for the observed scope. Evidence: tracked provider children and observed descendants are absent, active leases are zero, and stale reservations are zero.

## Q6. Was a NEW 25-job post-policy run performed?

Answer: YES. Evidence: final-25-job-capacity-evidence.json is classified NEW_POST_POLICY_REAL_PROVIDER_RUN and records exactly 25 submissions.

## Q7. Were all 25 jobs accounted for?

Answer: YES. Evidence: submitted 25, accepted 25, accounted_for 25, with an explicit terminal state for every row.

## Q8. How many completed?

Answer: 15. Evidence: state count COMPLETED is 15.

## Q9. How many deferred/timed out/deadline-exceeded?

Answer: 10 QUEUE_TIMEOUT; 0 DEFERRED_CAPACITY; 0 SERVICE_TIMEOUT; 0 JOB_DEADLINE_EXCEEDED; 0 CANCELLED; 0 PROVIDER_ERROR. Evidence: Section 16 and the capacity artifact state counts.

## Q10. Were any jobs lost or ambiguous?

Answer: NO. Evidence: zero lost, zero ambiguous, and zero UNKNOWN in the capacity pass criteria.

## Q11. Did any overload state become a clinical negative?

Answer: NO. Evidence: overload clinical state was NOT_CREATED, forbidden overload labels were empty, and no patient data was included.

## Q12. Was heavy concurrency bounded?

Answer: YES. Evidence: frozen max_active_leases is 1, observed active leases after workload are 0, and the pass criterion heavy_concurrency_bounded_by_policy is true.

## Q13. Was FIFO preserved?

Answer: YES for the measured claim/control-plane policy. Evidence: zero claim-rank overtakes in the 25-job run and zero rank overtakes in the 100-job FIFO control probe.

## Q14. Was starvation observed?

Answer: NO. Evidence: starvation_count is 0 and the artifact’s explicit-final-state definition does not classify expected queue timeouts as starvation.

## Q15. Did full equipped tests pass?

Answer: YES. Evidence: 90 files passed, 1 skipped; 1,234 tests passed, 13 skipped; exit 0.

## Q16. Did clean no-model checkout pass?

Answer: YES. Evidence: exact-SHA clean checkout passed npm ci, setup, SQLite initialization, 89 files/2 skipped, 1,200 tests/47 skipped, typecheck, lint, audits, build, smoke, and browser smoke.

## Q17. Did local Windows build pass?

Answer: YES. Evidence: local Windows release verification production_build exited 0; clean exact-SHA Windows build exited 0 and generated 22/22 static pages.

## Q18. Did secret/security gates pass?

Answer: YES for the declared gates, with two moderate development-only npm audit advisories retained. Evidence: secret scan PASS_NO_HIGH_CONFIDENCE_SECRET, production audit zero vulnerabilities, security/consent/red-team suites passed, and boundary audit PASS_BOUNDARY_INTACT.

## Q19. Did exact-head Linux CI pass?

Answer: YES. Evidence: run 34784732836, head 4f27c81e163f1058e9d2ef79faed2d9b9f2d9460, verify job 103798016798, success.

## Q20. Did exact-head Windows CI pass?

Answer: YES. Evidence: run 34784732836, head 4f27c81e163f1058e9d2ef79faed2d9b9f2d9460, verify-windows job 103798016854, success.

## Q21. Did exact-head Browser CI pass?

Answer: YES. Evidence: run 34784732836, head 4f27c81e163f1058e9d2ef79faed2d9b9f2d9460, verify-browser job 103798016626, success.

## Q22. Did the independent auditor complete?

Answer: YES. Evidence: the fresh read-only auditor returned a structured result and the final-independent-engineering-audit.json artifact was recorded.

## Q23. What was its exact result?

Answer: INCONCLUSIVE. Evidence: final-independent-engineering-audit.json records auditor_result INCONCLUSIVE.

## Q24. Did it find any P0 blocker in an ENABLED path?

Answer: INCONCLUSIVE. Evidence: the auditor reported no observed P0 blocker in the reviewed enabled paths, but did not issue a definitive no-P0 certification because of the CI-evidence reconciliation limitation.

## Q25. Is release:data-check still blocked?

Answer: YES. Evidence: release:data-check exited 1 with BLOCKERS_REMAIN, active_data_release_safe false, and the unresolved counts in Section 36.

## Q26. Did clinical-safety boundaries remain intact?

Answer: YES. Evidence: PASS_BOUNDARY_INTACT plus passing no-false-normal, diagnosis-gate, consent, provenance, review-conflict, laterality, prompt-safety, and overload-safety checks.

## Q27. Can VisionScan finally be classified: ENGINEERING READY — CONTROLLED LOCAL RESEARCH?

Answer: NO. Evidence: the exact runtime, local, clean-checkout, and CI gates passed, but the independent auditor result is INCONCLUSIVE rather than PASS_NO_P0_ENABLED_PATH_BLOCKER. The honest software classification remains ENGINEERING PARTIAL — BLOCKERS REMAIN.

## Publication and stop rule

The final report was committed separately from the evidence commit and pushed normally. REPORT_SHA, remote parity, report-head workflow behavior, and final empty-worktree verification are recorded in the final handoff because embedding a report’s own commit hash would be self-referential.

No Phase 12 was created. No new engineering feature or scientific/model change is authorized by this report. The next distinct program, if pursued, is external scientific validation and model improvement.
