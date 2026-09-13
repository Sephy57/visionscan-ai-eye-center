# VisionScan AI Eye Center

# Phase 10 — Final Engineering Closure Report

Report date: 2026-09-14 (Asia/Manila)  
Evidence timestamps: UTC, principally 2026-09-13  
Repository: https://github.com/Sephy57/visionscan-ai-eye-center  
Branch: main  
Scope: controlled local research engineering closure only

## 1. Executive decision

**ENGINEERING PARTIAL — BLOCKERS REMAIN.**

The system has a passing local Windows production build, a passing final-head CI run, passing focused Phase 10 acceptance, passing clean no-model checkout, passing isolated smoke/browser checks, and a bounded real-worker process-kill/restart matrix. The required release classification is still partial because live graceful shutdown and Windows Ctrl+C were not measured, the strict external/spontaneous OS-crash condition was not measured, real-provider capacity is partial at 25 jobs, resident mode is explicitly disabled rather than validated, deadline-specific descendant cleanup was not measured in Phase 10, and the data-release gate remains blocked.

Clinical status remains **NOT CLINICALLY VALIDATED / NOT A MEDICAL DEVICE / NOT FOR AUTONOMOUS DIAGNOSIS**.

## 2. Starting local HEAD

The verified starting local HEAD was 0c65e38366200ecafc1c8195bbf794c7fa55a4d8. This was checked before Phase 10 implementation work.

## 3. Starting origin/main HEAD

The verified starting origin/main HEAD was also 0c65e38366200ecafc1c8195bbf794c7fa55a4d8. The repository was not reset to a historical Phase 9 report or source SHA.

## 4. Starting worktree

Branch was main. The starting worktree was clean, with no unpushed commits and no uncommitted files. Initial checks included git status --short, git branch --show-current, git rev-parse HEAD, git log, git remote -v, and git diff --check.

## 5. Phase 9 preservation

The Phase 9 scientific state was preserved: DR TP 79, FN 101, FP 2, TN 218; Grade-3 exact misses 65; Grade-4 exact misses 20; frozen lesion escalation 62/65 for Grade 3 and 19/20 for Grade 4; frozen rule LESION_ESCALATION_RULE_PHASE7_V1 with region_count >= 3. RetGuard remains CANDIDATE_ONLY, RIGHTS_RESTRICTED, and NOT_BENCHMARK_READY. No disease rule, threshold, model search, medication intelligence, or external dataset was added.

## 6. Baseline test results

Before Phase 10 changes, npm run validation:phase9 passed 54/54. The full model-equipped Vitest run exited 1 after approximately 724.48 seconds: 89 files passed, 1 failed, 1 skipped; 1,165 tests passed, 1 failed, and 13 were skipped. The sole failure was the S9 real CPU inference case timing out at 120 seconds. TypeScript, lint, model audit, filesystem audit, and SBOM passed; release:data-check exited 1 because existing data blockers remained; the baseline production build also failed with an out-of-memory exit.

## 7. Baseline local Windows build

The baseline local Windows build used the repository's 8,192 MB old-space setting and failed with exit 134 after approximately 312 seconds. It was a real subprocess observation, not a simulated result.

## 8. Windows OOM reproduction

The reproduced environment was Windows 11 Pro, Node v20.20.2, npm 10.8.2, Next.js 16.3.4, approximately 16.43 GB physical RAM, and NODE_OPTIONS unset. The baseline command was npm run build, which invoked the webpack production build with an 8,192 MB old-space limit. The observed failure was V8 FATAL ERROR: Reached heap limit / JavaScript heap out of memory. Approximate peak working set was 8.19 GB and private bytes 8.65 GB.

## 9. Windows OOM root cause

The evidence supports webpack build-graph/process memory pressure at the old 8 GB limit, amplified by server-side document/native dependencies and the prior build configuration. It does not prove a single exclusive allocator or universal root cause. The investigation found no committed model weights, uploads, reports, database, or scratch data being intentionally bundled by the final build path. A formal bundle-analyzer report was not persisted, so the causal attribution remains bounded rather than absolute.

## 10. Build-memory remediation

The remediation enabled Next webpackMemoryOptimizations, disabled server source maps, and externalized sharp, pdfjs-dist, pdf-lib, tesseract.js, @napi-rs/canvas, and better-sqlite3. The repository build script now uses a deliberate 10,240 MB old-space ceiling because the measured graph required more than the previous 8 GB limit on this approximately 16 GB development machine. This is a documented host-specific containment, not a universal memory guarantee.

## 11. Final Windows build

**PASS — REAL_SUBPROCESS.** The final local main-checkout build passed at the code-equivalent cdd8effcfb614d4279ba6ab12023011f7e80d164 parent of the evidence-only correction commit, with exit 0 after 619,437 ms. The exact-head clean checkout at 132fb00 also passed npm run build with exit 0: compile 23.2 seconds, TypeScript 11.4 seconds, and 22/22 static pages generated.

## 12. Build peak memory

The final local main build observed approximately 8,789,901,312 bytes working set, 9,397,448,704 bytes private bytes, 16 processes, and 399.5 CPU seconds under the 10,240 MB setting. The generated artifact is docs/generated/phase10-build-memory.json. The artifact records the baseline 8 GB OOM and the remediated pass, and explicitly limits the conclusion to the observed host/build graph.

## 13. Committed-effect semantics

Canonical publication uses durable insert-once effects with immutable payload hashes. Retries and report replay reuse persisted immutable inputs/effects where possible and refuse a different payload under the same effect identity. A successful worker attempt therefore publishes through durable effect controls rather than relying on in-memory completion state.

## 14. At-least-once provider semantics

The worker model is at-least-once. A crash can cause a new worker attempt and potentially re-execute a provider. The evidence records durable worker attempts; it does not claim exact-once provider execution.

## 15. Canonical effect identities

The crash matrix expects exactly one of each applicable effect type: MODEL_RESULT, STRUCTURED_EVIDENCE, REASONING_RECORD, REPORT, and JOB_COMPLETION. The current matrix records one of each for every tested seam.

## 16. Immutable conflict behavior

The conflicting canonical-payload test passed: writing a different canonical payload under the same effect identity raises IMMUTABLE_EFFECT_CONFLICT and leaves the original payload unchanged. This is covered in Phase 10 acceptance test 9 and the Phase 9 committed-effect controls.

## 17. Fencing

Phase 10 acceptance tests 10–14 passed for stale analysis, evidence, reasoning, report, and terminal-completion publication. After lease recovery, an old worker cannot publish against the newer active attempt. The shared fence is checked at publication boundaries.

## 18. Crash matrix methodology

The matrix used isolated temporary SQLite/storage roots and the committed synthetic/public example fundus image. Each run seeded one job, launched the actual scripts/worker.ts process, injected a test-only fault seam, terminated the worker process, waited for lease recovery, launched a fresh worker, inspected the database and report export, and removed the temporary workspace. The parent requested Windows taskkill /T /F and sampled observed descendants before and after termination.

The evidence classification is deliberately REAL_WORKER_PROCESS_KILL_RESTART. The harness is not evidence of a spontaneous power loss, kernel failure, external job kill, or every possible OS failure mode; strict REAL_OS_CRASH evidence is **NOT MEASURED**.

## 19. Before-model-write crash

**PASS — bounded process-kill/restart.** BEFORE_MODEL_RESULT_WRITE was injected, the worker was terminated, restart completed the job, the resource reservation was released, the report was sealed/exported, and canonical counts were MODEL_RESULT 1, STRUCTURED_EVIDENCE 1, REASONING_RECORD 1, REPORT 1, JOB_COMPLETION 1.

## 20. After-model-write crash

**PASS — bounded process-kill/restart.** AFTER_MODEL_RESULT_WRITE recovered to completed with the same exact-one canonical effect counts and no observed surviving descendants after cleanup.

## 21. Before-evidence crash

**PASS — bounded process-kill/restart.** BEFORE_EVIDENCE_COMMIT recovered to completed with the immutable evidence snapshot committed once and all other expected effects present once.

## 22. After-evidence crash

**PASS — bounded process-kill/restart.** AFTER_EVIDENCE_COMMIT recovered to completed without a duplicate evidence effect or duplicate terminal completion.

## 23. Before-report crash

**PASS — bounded process-kill/restart.** BEFORE_REPORT_COMMIT recovered to a sealed report with a present derived export and no duplicate report identity.

## 24. After-report crash

**PASS — bounded process-kill/restart.** AFTER_REPORT_COMMIT recovered with the existing sealed report reused and the canonical report count equal to one.

## 25. Before-completion crash

**PASS — bounded process-kill/restart.** BEFORE_JOB_COMPLETE recovered with one terminal completion effect, released resource state, a sealed report, and no duplicate canonical effects.

## 26. Post-terminal crash

**NOT MEASURED.** An immediately-after-terminal-DB-transaction seam was not added as a distinct safe observable row. The seven committed seams exercise the required publication windows, but they do not establish the separate H condition from the master prompt.

## 27. Restart outcomes

All seven measured rows ended with restart status COMPLETED, attempts 2, no recorded job error, released resource state, report_sealed true, report_export_present true, and inspect exit 0. Each row observed a crash marker and passed the exact canonical-effect predicate.

## 28. Duplicate-effect analysis

Every measured row recorded one MODEL_RESULT, one STRUCTURED_EVIDENCE, one REASONING_RECORD, one REPORT, and one JOB_COMPLETION. duplicate_free was true and complete was true for all seven rows. This proves the committed-effect invariant for the tested application process-kill/restart paths, not exact-once provider execution.

## 29. Physical re-execution analysis

Each row recorded worker_attempts 2 and a model execution ledger row count of 3 in the fixture. The exact provider invocation count is explicitly NOT_MEASURED because the immutable model ledger does not expose a per-provider invocation counter. The correct conclusion is possible physical re-execution with one canonical committed result.

## 30. Filesystem/DB reconciliation

The crash fixture observed a sealed report and present export after restart. The service also contains the bounded repair path for a sealed report whose derived JSON export is missing, and report replay tests passed. The separate immediately-after-terminal DB transaction row was not measured; therefore full DB/filesystem crash-window closure is PARTIAL.

## 31. Audit-event semantics

Canonical effects are insert-once and hash-protected. Audit events are metadata-oriented append records with hash-chain support, but they are not claimed to be exactly-once or externally immutable. The audit sink is process/local persistence rather than a separately operated immutable event service.

## 32. Shutdown policy

The default policy remains LEASE_FOR_RECOVERY. It is not silently changed for Phase 10. The intended behavior is to stop new claims, allow the active job to become recoverable if the process exits, and let a restarted worker acquire the expired lease.

## 33. Live graceful shutdown

**NOT MEASURED.** A live worker with a real approved research provider was not run through the complete claim/provider-active/graceful-shutdown/restart sequence. Lifecycle unit and integration tests passed, but they are not a substitute for live shutdown evidence.

## 34. Windows Ctrl+C

**NOT MEASURED.** The environment did not produce and verify a genuine interactive Windows console Ctrl+C/SIGINT event for the worker. No unit test is relabeled as Ctrl+C evidence.

## 35. Forced termination

**PASS — bounded process kill.** The crash matrix used actual worker process termination and parent taskkill tree cleanup as a distinct experiment from graceful shutdown. This result must not be merged with a graceful-shutdown claim.

## 36. Restart recovery

**PASS for the measured process-kill rows; PARTIAL overall.** Each measured row waited beyond the 1,000 ms lease and restarted a fresh worker successfully. The unmeasured live graceful path and deadline-specific recovery scenarios remain open.

## 37. Lease recovery

The focused job-lease-recovery tests passed, including process-boundary worker death and recovery. The real-worker crash rows also recovered after the 1,000 ms lease, with attempts incremented to 2 and completed final state.

## 38. Resource recovery

The crash matrix recorded resource_reservation_state released in all seven rows. Resource-governor and lease-coordination tests passed. Deadline-triggered resource recovery was not separately measured in Phase 10, so the broader deadline gate remains partial.

## 39. Real provider deadline

**PARTIAL / historical bounded evidence.** The retained Phase 7 real-provider curve enforced a 120,000 ms queue-claim deadline and recorded ten JOB_DEADLINE_EXCEEDED outcomes at the 25-job point. Phase 10 did not produce a new complete real-provider deadline experiment covering active inference, resource wait, and mutex wait.

## 40. Deadline during inference

**NOT MEASURED as a Phase 10 experiment.** No new controlled run forced the deadline while an approved real provider was actively inferring and then verified all resulting child cleanup and durable non-success state.

## 41. Deadline during resource wait

**NOT MEASURED.** The Phase 10 evidence does not contain a dedicated deadline-while-waiting-for-heavy-model-reservation run. The load curve shows resource wait and deadline behavior at 25 jobs, but it is not a controlled resource-wait deadline proof.

## 42. Mutex-wait deadline

**NOT MEASURED.** No dedicated provider-mutex wait deadline experiment was run. The current evidence does not claim a mutex cancellation proof.

## 43. Observed process tree

The crash harness queried the Windows process tree before and after cleanup. It records parent taskkill tree requested, descendants_before_termination, descendants_absent_after_termination true, and remaining_descendant_pids empty for the measured rows. This means all observed descendants were terminated; it does not claim enumeration of descendants that were never observed.

## 44. Child cleanup

**PASS for the observed crash rows.** The parent awaited taskkill completion, waited briefly, re-queried descendants, and found none. This is stronger than the earlier unawaited cleanup observation. Deadline-specific provider descendants remain unmeasured.

## 45. Resource cleanup

**PASS for crash rows; PARTIAL for deadline rows.** The seven crash rows released reservations and had no stale resource state. The required active-inference/resource-wait deadline cleanup was not separately established.

## 46. Resident corpus

The resident decision artifact requested 20 cases and retains the historical finite Phase 7 resident experiment with 20 completed cases. The active Phase 10 decision does not promote that historical finite probe to a production resident service.

## 47. Parity tolerance

**NOT APPLICABLE while resident mode is disabled.** No current resident-versus-short-lived tolerance is asserted. A future resident experiment would need to freeze class identity, region count, bounding-box/centroid, mask-derived metric, and ordering tolerances before execution.

## 48. Short-lived outputs

The active runtime is the existing short-lived Python subprocess/provider contract. Its outputs remain available as the controlled path, with process-tree scoping and model-unavailable fail-closed behavior.

## 49. Resident outputs

**NOT MEASURED.** No resident output is used as current production evidence.

## 50. Parity result

**NOT APPLICABLE / NOT MEASURED.** With resident adoption disabled, there is no current parity result to compare or promote.

## 51. Repeatability

**NOT APPLICABLE for resident mode.** The short-lived path has ordinary deterministic and contract tests, but no resident repeatability claim is made.

## 52. Ordering

**NOT APPLICABLE for resident mode.** No resident queue/output ordering experiment was run. The independent short-lived queue probe is reported in sections 58–75.

## 53. Cross-job isolation

**NOT APPLICABLE for resident mode.** The short-lived application path has cross-study/cross-job isolation tests, while the disabled resident path has no state-leak evidence to promote.

## 54. Cancellation

**NOT APPLICABLE for resident mode.** General queued-job cancellation and bounded progress tests passed; resident-provider cancellation was not measured.

## 55. Crash recovery

**NOT APPLICABLE for resident mode.** The resident provider is not active. The real worker crash matrix applies to the short-lived worker path only.

## 56. Memory soak

**NOT APPLICABLE for resident mode.** No resident memory soak is used to justify approval.

## 57. Resident decision

**PASS — explicit containment decision.** phase10-resident-validation.json records PASS_EXPLICIT_RESIDENT_DISABLED and RESIDENT_RUNTIME_REJECTED_DISABLED. This is an engineering containment decision, not a clinical or model-accuracy claim.

## 58. Queue policy

The worker uses created_at ASC, id ASC ordering, one worker concurrency, and a 32-row page bound. The API-facing default is created_at DESC, id DESC. The bounded deadline policy is queue wait 120,000 ms, service time 600,000 ms, and total age 720,000 ms in the test-only runtime envelope.

## 59. Queue ordering

The deterministic 100-job integration probe observed the declared FIFO order with zero rank overtakes. Worker ordering and API display ordering are intentionally separate.

## 60. Backpressure

The heavy resource governor limits active leases to one in the measured curve. Jobs wait for the resource under a bounded policy; at overload they can reach JOB_DEADLINE_EXCEEDED rather than producing a clinical result. The 25-job point demonstrates bounded rejection/defer behavior, not capacity readiness.

## 61. Fairness definition

Fairness was predeclared as rank_overtakes across a 100-job synthetic queue. A job is starved if a newer job is selected ahead of it while the older job remains runnable. This is a control-plane metric, not a sustained model-service SLO.

## 62. 1-job load

REAL_WORKER historical point: 1 requested, 1 completed, 0 failed, 0 timed out; queue wait p50/p95/max 60.141/60.141/60.141 ms; resource wait 0/0/0 ms; service 9,390.588/9,390.588/9,390.588 ms; total 9,478.743/9,478.743/9,478.743 ms; throughput 0.1055 jobs/s.

## 63. 5-job load

REAL_WORKER historical point: 5 requested, 5 completed, 0 failed, 0 timed out; queue wait p50/p95/max 17,240.320/25,243.295/33,316.080 ms; resource wait 16,561.521/24,565.956/32,640.637 ms; service 7,947.223/8,481.898/8,648.659 ms; total 25,224.551/33,295.992/41,286.070 ms; throughput 0.1210 jobs/s; retries 131.

## 64. 10-job load

REAL_WORKER historical point: 10 requested, 10 completed, 0 failed, 0 timed out; queue wait p50/p95/max 31,891.077/63,945.131/71,958.585 ms; resource wait 31,305.255/63,364.275/71,378.912 ms; service 7,901.525/8,077.940/8,128.284 ms; total 39,714.299/71,933.831/79,886.523 ms; throughput 0.1251 jobs/s; retries 591.

## 65. 25-job load

REAL_WORKER historical point: 25 requested, 15 completed, 10 failed with JOB_DEADLINE_EXCEEDED, 0 timed out. Queue wait p50/p95/max 16,354.999/97,586.922/115,227.026 ms; resource wait 15,767.058/97,011.242/114,653.692 ms; service for 15 completed jobs 8,050.247/9,133.728/9,403.080 ms; total 105,932.425/120,370.919/124,663.793 ms; throughput 0.1203 jobs/s; retries 3,109.

## 66. Completion/rejection counts

The load curve is 1/1 completed, 5/5 completed, 10/10 completed, and 15/25 completed at the 25-job point. The ten rejected/deadline-exceeded jobs are durable non-success states; they are not counted as negative clinical findings.

## 67. Queue latency

Queue latency increases with contention: p50 is 60.141 ms at one job, 17,240.320 ms at five, 31,891.077 ms at ten, and 16,354.999 ms at 25, with the 25-job p95/max reaching 97,586.922/115,227.026 ms. The non-monotonic 25-job p50 reflects bounded failures and scheduling, not an optimization claim.

## 68. Resource latency

Resource-wait p50 is 0 ms at one job, 16,561.521 ms at five, 31,305.255 ms at ten, and 15,767.058 ms at 25. At 25 jobs p95/max are 97,011.242/114,653.692 ms. This demonstrates the one-slot resource bottleneck and bounded waiting behavior.

## 69. Service latency

Completed-job service p50 remains approximately 7.9–8.1 seconds at 1, 5, 10, and 25 jobs: 9,390.588, 7,947.223, 7,901.525, and 8,050.247 ms respectively. At 25 jobs the p95/max are 9,133.728/9,403.080 ms across the 15 completed jobs.

## 70. Total latency

Total-latency p50 is 9,478.743 ms at one job, 25,224.551 ms at five, 39,714.299 ms at ten, and 105,932.425 ms at 25. The 25-job p95/max are 120,370.919/124,663.793 ms, with ten JOB_DEADLINE_EXCEEDED outcomes.

## 71. Throughput

Observed throughput was 0.1055, 0.1210, 0.1251, and 0.1203 jobs per second for 1, 5, 10, and 25 requested jobs respectively. These are bounded single-worker historical real-provider observations, not production-scale capacity.

## 72. CPU

Peak CPU seconds in the retained provider curve were 16.671875 at one job, 16.03125 at five, 15.90625 at ten, and 17.5625 at 25. The metric is process-level evidence from the bounded run and is not a host-wide utilization guarantee.

## 73. Memory

Peak working set/private bytes were approximately 1.363/1.697 GB at one job, 1.441/1.800 GB at five, 1.439/1.800 GB at ten, and 1.429/1.799 GB at 25. These are the worker/provider load observations, distinct from the approximately 8.79/9.40 GB production build observation.

## 74. Starvation result

**PASS for the declared control-plane probe.** The 100-job synthetic queue observed zero rank overtakes and starvation_observed false. **NOT PROVEN as a sustained provider-service starvation SLO.**

## 75. Capacity classification

**PARTIAL_REAL_LOAD_PLUS_FIFO_CONTROL_PLANE.** The queue policy is explicit, fairness control-plane behavior passed, and 1/5/10 completed. The 25-job point completed only 15/25 and produced ten JOB_DEADLINE_EXCEEDED outcomes, so capacity is not ready for a broader claim.

## 76. Clinician-review regression

Review confirm, reject, correct, indeterminate, request-new-scan, additive history, and report immutability tests passed. A separate clinical-safety audit found remaining workflow gaps: laterality correction and structured reason-note capture are not fully exposed in the current UI, and concurrent-review conflict finalization needs stronger blocking/adjudication semantics. Overall: **PARTIAL**.

## 77. Evidence-governance regression

Provenance, laterality, source-document linkage, model labels, review state, no-false-normal, and immutable report/effect controls remained intact in the acceptance suites. The current artifact and test evidence are PHI-free. Overall: **PASS for tested boundaries; PARTIAL for unmeasured operational/external-sink claims.**

## 78. No-false-normal regression

**PASS.** Phase 8, red-team, fusion, and end-to-end tests preserve normality_claim_allowed false, require clinical correlation, and do not infer normal from Grade 0 or an unavailable model. No Phase 10 change promotes a negative output to a normal diagnosis.

## 79. Prompt-injection regression

**PASS for supported plain-text injection cases; PARTIAL coverage.** Tests verify that prompt-like document text cannot alter thresholds, release state, or clinical interpretation. The classifier is deliberately narrow; obfuscated, Unicode, split-token, and adversarially transformed variants were not measured. No active LLM/direct-diagnosis path was found.

## 80. Security red team

The focused security audit and the repository's security/red-team acceptance coverage passed, including authentication scope, query spoofing, client-field spoofing, cross-tenant access, PHI-shaped input rejection, and fault-hook isolation. Dependency hygiene remains a blocker to a stronger security classification: full npm audit reports two moderate dev-only Vitest/@vitest-mocker findings, while npm audit --omit=dev reports zero production vulnerabilities.

## 81. Fault-hook isolation

**PASS.** Fault injection is constrained to isolated test mode and explicit Phase 9/10 variables; the real process-kill path is not enabled in ordinary production execution. Tests verify hooks are disabled or fail closed outside the explicit isolated compatibility mode.

## 82. PHI scan

**PASS for committed/generated Phase 10 evidence.** All Phase 10 JSON artifacts declare phi_included false, the clean checkout had no model/data payloads, the SBOM reported patient-data-included false, and the clean filesystem audit found empty runtime data directories. The ignored production data tree remains PHI-capable by design and is not represented as universally PHI-free.

## 83. Secret scan

**PARTIAL.** Existing hygiene tests and prior tracked-file review found no committed credential, token, private key, or real-patient payload; smoke credentials were test-only/ephemeral. A dedicated external secret-scanner run was not recorded in this Phase 10 evidence set, so this report does not claim a complete secret-scanning certificate.

## 84. Consent regression

**PASS for processing gates; PARTIAL for governance completeness.** Image-model consent is required and rechecked by the worker; consent route tests and clean smoke passed. The clinical audit identified a remaining deletion/retention governance issue: deletion marks records while retaining some history/report access, so erasure semantics and post-delete access need an explicit reviewed policy before broader deployment.

## 85. Phase 10 acceptance tests

**PASS — 94/94.** The focused command ran tests/phase10-acceptance.test.ts, tests/phase9-controls.test.ts, tests/phase8-acceptance.test.ts, and tests/job-lease-recovery.test.ts with one worker: 4 files passed and 94 tests passed, exit 0. The 40 Phase 10 contracts include crash rows, exact effects, stale-worker fencing, cleanup, resident containment, queue policy, clinical safety, and release blocking.

## 86. Full equipped suite

The final main-checkout equipped run was executed with the single-worker Vitest command. The recorded passing result was 89 files passed and 1 skipped, with 1,206 tests passed and 13 skipped, exit 0, 568.33 seconds. The exact-head CI run also passed its no-model runner suite with 87 files passed and 3 skipped, 1,170 tests passed and 49 skipped, exit 0.

## 87. No-model clean checkout

**PASS at exact implementation/evidence head 132fb00ad40c13870dd1d25fe6b862770c418243.** Fresh clone D:/visionscan-phase10-clean-132fb00 began without .env, model weights, database, uploads, reports, cache, or scratch data. npm ci passed; setup and SQLite initialization passed; the full no-model suite passed 88 files with 2 skipped and 1,172 tests with 47 skipped; typecheck, lint, model audit, filesystem audit, SBOM, build, smoke 16/16, and browser 7/7 all passed. The clean smoke explicitly showed model unavailable as a safe non-clinical result.

## 88. TypeScript

**PASS.** npx tsc --noEmit --pretty false exited 0 in the exact-head clean checkout and in CI.

## 89. Lint

**PASS.** npm run lint -- --quiet exited 0 in the exact-head clean checkout and CI.

## 90. Build

**PASS.** The exact-head clean checkout production build exited 0, and the exact-head implementation CI build steps passed on Linux and Windows. The local Windows memory observation is documented separately in sections 7–12.

## 91. Smoke

**PASS — 16/16.** The exact-head clean checkout smoke used an isolated local HTTPS-equivalent opt-in for loopback only, a synthetic account, a synthetic image, no model assets, and deleted its created study. It verified upload, consent, symptom handling, unavailable-model safety, red-flag urgency, quality rejection, clinician finalization, self-test, deletion, and unauthorized access.

## 92. Browser E2E

**PASS — REAL_BROWSER 7/7.** The exact-head clean browser harness used an isolated empty SQLite store, ephemeral synthetic account, no model/data assets, and local browser checks for login/dashboard, /dashboard, /patients, /analyze, /validation-center, /result, and /report. It reported HOSTED BROWSER SMOKE: PASSED.

## 93. Model audit

**PASS for the clean checkout; research-only for the main checkout.** The exact-head clean checkout found zero model manifests and patient_data_included false. The main checkout model audit found three local manifests, all marked research_only, with no claim of clinical validation. The DR, lesion, and OCT model contracts remain non-clinical.

## 94. Filesystem audit

**PASS for the clean checkout and main storage layout.** All source, Git, data, model, log, and temporary paths were on D:. The clean checkout had zero uploads, documents, processed files, reports, logs, and temporary files; only its initialized database existed. The audit does not claim arbitrary ignored operator data is PHI-free.

## 95. SBOM

**PASS — PHI-free CycloneDX inventory.** The exact-head clean run generated CycloneDX 1.5 evidence from package-lock.json and local research metadata, with patient-data-included false and phi-included false. SBOM success is not a vulnerability waiver; the two moderate dev-only npm audit findings remain recorded.

## 96. release:data-check

**FAIL AS A RELEASE GATE / CORRECT RESULT: DATA RELEASE BLOCKED.** The unweakened check exited 1 at the final local evidence refresh with active_unresolved_sources 235, legacy_unresolved_sources 158, active_fk_orphan_count 0, legacy_orphan_count 5,263, cross_tenant_count 0, hash_mismatch_count 0, quarantine_count 81. Main reasons were active MISSING_REQUIRED_ARTIFACT 233, active DETACHED_ANALYSIS_PARENT 2, legacy MISSING_REQUIRED_ARTIFACT 87, and legacy MISSING_REPORT_EXPORT 71. No unresolved data was deleted or relabeled as safe.

## 97. Implementation SHA

The final pushed implementation/evidence SHA is 132fb00ad40c13870dd1d25fe6b862770c418243. It contains the Phase 10 implementation and the corrected crash-matrix artifact required by the acceptance suite. The build-memory artifact was measured on its code-equivalent parent cdd8effcfb614d4279ba6ab12023011f7e80d164 before the evidence-only correction.

## 98. Implementation push parity

**PASS.** After the implementation push, git rev-parse HEAD and git ls-remote origin main both resolved to 132fb00ad40c13870dd1d25fe6b862770c418243.

## 99. Implementation Linux CI

**PASS.** Actions run 34768056009, job verify, database ID 103752483986, ran against head SHA 132fb00ad40c13870dd1d25fe6b862770c418243 and completed successfully. Its full validation, tests, audits, and production build steps passed.

## 100. Implementation Windows CI

**PASS.** Actions run 34768056009, job verify-windows, database ID 103752483880, ran against head SHA 132fb00ad40c13870dd1d25fe6b862770c418243 and completed successfully. Its Windows path tests, full suite, audits, and production build steps passed.

## 101. Implementation Browser CI

**PASS.** Actions run 34768056009, job verify-browser, database ID 103752483948, ran against head SHA 132fb00ad40c13870dd1d25fe6b862770c418243 and completed successfully. It exercised an isolated browser server and no-model synthetic account/data path.

## 102. Report SHA

The report is intentionally committed separately from the implementation. Its containing commit SHA cannot be known until this document is committed, so this body does not pretend to embed a future self-referential hash. The final delivery records the actual report commit SHA and verifies it against origin/main after push.

## 103. Final remote parity

This section is completed by the post-report verification: the final remote origin/main must equal the report commit SHA, while the implementation SHA remains the independently verified parent-line release SHA in section 97. No force push is permitted.

## 104. Report-head CI

The report commit triggers a separate CI run from implementation run 34768056009. The final delivery records that report-head run ID, head SHA, and Linux/Windows/Browser job conclusions. A report-head run that is still queued or failed is not treated as final green evidence.

## 105. Final worktree

The final worktree must be empty after the report and refreshed generated artifacts are committed. The final delivery includes the observed git status --short result; ignored runtime data are not treated as report changes.

## 106. Independent engineering audit

An independent read-only engineering auditor, separate from the implementation work, inspected the crash artifact, effects, fencing, shutdown, deadline, cleanup, resident, load, build, security, clean checkout, and CI evidence. It found no observed P0 correctness failure in the bounded controls, but it correctly retained the strict external OS-crash, live shutdown, capacity, deadline, resident, and release-data gaps. It also identified the earlier incomplete exact-effect predicate and unawaited descendant cleanup; those bounded evidence defects were fixed and the exact 94/94 suite and implementation CI were rerun. The auditor was not rerun after the evidence-only 132fb00 commit, so the independent audit status is **PASS for observed controls / PARTIAL as a final-head re-audit**.

## 107. Clinical-safety boundary audit

The separate clinical-safety boundary audit found no weakening of the diagnosis gate, no-false-normal rule, urgency behavior, research labels, medication restrictions, clinician authority, scope checks, or PHI-minimizing evidence boundaries. It retained PARTIAL findings for narrow prompt-injection coverage, DR half-logit validation, UI laterality/reason-note workflow, deletion/retention governance, generic validation-label strictness, and concurrent-review conflict handling. This is a software boundary audit, not clinical validation or external professional sign-off.

## 108. Remaining engineering blockers

- Live graceful shutdown with an active approved provider and genuine Windows Ctrl+C remain NOT MEASURED.
- Strict spontaneous/external OS-crash or power-loss evidence remains NOT MEASURED; the matrix is a bounded real worker process-kill/restart experiment.
- Deadline during active inference, resource wait, and mutex wait was not separately measured with observed provider descendant cleanup.
- The 25-job real-provider point is partial: 15 completed and 10 reached JOB_DEADLINE_EXCEEDED.
- Resident runtime is disabled and therefore has no parity, repeatability, cancellation, crash, or soak approval.
- Full dependency audit still reports two moderate dev-only Vitest findings.
- Formal persisted bundle analysis and an external immutable audit sink were not established.

## 109. Remaining model blockers

External lesion validation is not established. RetGuard remains candidate-only, rights-restricted, and not benchmark-ready. DR/lesion/OCT local models are research-only and not clinically validated. Subgroup, device, demographic, external-cohort, and clinical calibration claims remain outside this closure.

## 110. Remaining data blockers

Data release remains blocked by the final release-data check: 235 active unresolved sources, 158 legacy unresolved sources, 5,263 legacy orphans, and 81 quarantined items. The existence of clean technical tests does not authorize release of the unresolved active/legacy data tree.

## 111. Remaining clinical blockers

There is no clinical validation, medical-device determination, regulatory approval, external clinician sign-off, or autonomous-diagnosis authorization. Review workflow gaps and deletion/retention governance must be resolved before any broader operational claim.

## 112. Exact capabilities

Within the observed bounded scope, VisionScan can authenticate and authorize scoped users; require processing consent; ingest and process synthetic/local research inputs; fail closed when models are unavailable; preserve provenance and laterality; produce research-only structured outputs; persist immutable canonical effects and reports; recover tested worker leases after process termination; enforce stale-worker fences; expose bounded queue/deadline/resource states; and provide clinician-review workflow primitives.

## 113. Exact non-capabilities

VisionScan cannot honestly claim exact-once provider execution, spontaneous OS/power-loss recovery coverage, live graceful-shutdown correctness, Windows Ctrl+C correctness, resident-provider parity or soak safety, production-scale 25-job capacity, external lesion validation, clinical diagnosis, normality from a negative/unavailable model, medical-device status, data-release safety, HIPAA/regulatory certification, or autonomous treatment/triage authority.

## 114. Software classification

**CONTROLLED LOCAL RESEARCH SOFTWARE — ENGINEERING PARTIAL.** The software controls and final-head CI are substantially evidenced, but P0 closure gates remain open.

## 115. Runtime classification

**LOCAL RUNTIME PARTIAL.** The bounded single-worker crash/restart and queue controls pass their measured experiments, but the complete runtime classification requires live graceful shutdown, deadline cleanup, and capacity/fairness closure that all pass.

## 116. Retinal intelligence classification

**RETINAL REVIEW INTELLIGENCE PARTIAL — INTERNAL HELD-OUT EVIDENCE ONLY.** No Phase 10 engineering work upgrades model validity or external generalization.

## 117. Data classification

**DATA RELEASE BLOCKED.** This classification is independent of the software engineering result.

## 118. Demo classification

**RESEARCH-ONLY LOCAL DEMO / SYNTHETIC OR DE-IDENTIFIED EVIDENCE.** The clean smoke/browser checks are suitable for bounded demonstration of fail-closed behavior and review workflow, not for real-patient clinical use.

## 119. Clinical classification

**NOT CLINICALLY VALIDATED.**  
**NOT A MEDICAL DEVICE.**  
**NOT FOR AUTONOMOUS DIAGNOSIS.**

# Primary questions

## Q1. Did local Windows production build pass?

**YES — bounded.** The exact-head clean checkout passed, and the local remediated main build passed with the documented 10,240 MB setting. The build is not a universal host guarantee.

## Q2. What caused the Phase 9 local OOM?

**PARTIAL.** Measured webpack build-graph/process memory pressure exceeded the old 8 GB heap boundary, with server/document/native dependency bundling and prior build configuration as supported contributors. No single exclusive allocator cause was proven.

## Q3. Can a real OS crash after persistence create duplicate canonical effects?

**PARTIAL.** The real worker process-kill/restart matrix produced no duplicate canonical effects across seven seams. A spontaneous external OS crash or power loss was not measured, and provider invocation exact-once was not claimed.

## Q4. Can a stale worker publish after fencing?

**NO in the tested fencing paths.** Analysis, evidence, reasoning, report, and completion stale-worker tests all rejected old publication attempts.

## Q5. Can a sealed report survive the DB/export crash window?

**PARTIAL.** The measured report seams recovered a sealed report with export present, and replay/repair controls passed. The distinct immediately-after-terminal DB transaction seam was not measured.

## Q6. Does graceful shutdown stop new claims and preserve recoverability?

**NOT MEASURED.** The declared policy remains LEASE_FOR_RECOVERY and lifecycle tests pass, but no live graceful shutdown sequence was run.

## Q7. Does restart recover the active job correctly?

**YES for the measured process-kill matrix.** All seven rows restarted to completed with attempt 2, released resources, sealed/exported report, and exact canonical effects.

## Q8. Does a real deadline terminate all observed provider descendants?

**NOT MEASURED.** The crash matrix proves observed descendant cleanup for process-kill rows; a dedicated deadline-with-active-provider run was not completed.

## Q9. Does the heavy resource slot recover after deadline/crash?

**PARTIAL.** It was released in all seven crash rows and resource-governor tests passed; deadline-specific slot recovery was not separately measured.

## Q10. Does resident lesion output match short-lived output within the predeclared tolerance?

**NOT MEASURED.** Resident mode is explicitly disabled and no current tolerance/result is asserted.

## Q11. Is resident output repeatable?

**NOT MEASURED.** No resident production output is approved.

## Q12. Does resident execution leak state between jobs?

**NOT MEASURED.** Resident execution is disabled; short-lived isolation tests are separate.

## Q13. Does resident cancellation behave safely?

**NOT MEASURED.** No resident provider path is active.

## Q14. Does resident crash recover safely?

**NOT MEASURED.** No resident provider path is active.

## Q15. Is resident memory bounded?

**NOT MEASURED.** No resident memory soak is used as evidence.

## Q16. What is the final resident runtime decision?

**YES — explicit rejection/disablement.** RESIDENT_RUNTIME_REJECTED_DISABLED; short-lived runtime remains the bounded path.

## Q17. What are the explicit queue/service/total-age policies?

**YES.** The test envelope declares 120,000 ms queue wait, 600,000 ms service time, and 720,000 ms total age, with one active heavy resource lease and FIFO worker order.

## Q18. What happens at 25 submitted jobs?

**PARTIAL.** Fifteen completed and ten reached JOB_DEADLINE_EXCEEDED under max_active_leases=1; the system retained durable non-success states rather than fabricating clinical negatives.

## Q19. Was starvation measured?

**YES — control plane only.** A 100-job FIFO probe observed zero rank overtakes and no starvation under the declared definition.

## Q20. Did the complete load matrix pass its PREDECLARED policy?

**NO.** FIFO control-plane fairness passed, but the real-provider 25-job capacity point was partial with ten deadline-exceeded jobs.

## Q21. Did the full equipped test suite pass?

**YES.** The final recorded equipped run passed 89 files with 1 skipped and 1,206 tests with 13 skipped, exit 0; exact-head CI also passed its no-model runner.

## Q22. Did the no-model clean checkout pass?

**YES.** Exact-head 132fb00 passed npm ci, setup/db init, 1,172/1,219 tests, typecheck, lint, audits, build, 16/16 smoke, and 7/7 browser checks.

## Q23. Did the exact implementation SHA pass Linux CI?

**YES.** Run 34768056009, verify job 103752483986, exact head 132fb00, success.

## Q24. Did it pass Windows CI?

**YES.** Run 34768056009, verify-windows job 103752483880, exact head 132fb00, success.

## Q25. Did it pass Browser CI?

**YES.** Run 34768056009, verify-browser job 103752483948, exact head 132fb00, success.

## Q26. Did the final report HEAD also receive known CI status?

**NOT MEASURED AT REPORT AUTHORING.** The report commit is separate and triggers its own CI; the final delivery records its run and conclusion after push rather than inventing a status in this pre-commit document.

## Q27. Does release:data-check remain blocked?

**YES.** It exited 1 with active_data_release_safe false and the unresolved-source, legacy-orphan, quarantine, and missing-artifact counts retained.

## Q28. Did an independent engineering auditor find any P0 blocker?

**PARTIAL.** The independent auditor found no observed P0 correctness failure in measured controls, but retained critical evidence gaps: strict external OS crash, live shutdown, deadline cleanup, capacity, resident validation, and release data. It was not rerun after the evidence-only final correction commit.

## Q29. Did the clinical-safety boundary remain intact?

**YES for the audited boundaries; PARTIAL overall.** Diagnosis gating, no-false-normal, urgency, research-only model labels, medication restrictions, clinician authority, consent processing, scope, and PHI-minimizing evidence remained intact. Workflow and governance gaps remain documented.

## Q30. Can VisionScan now honestly be classified ENGINEERING READY — CONTROLLED LOCAL RESEARCH?

**NO.** The honest final classification is ENGINEERING PARTIAL — BLOCKERS REMAIN because multiple required P0 closure gates are unmeasured or partial.

## Evidence index

- docs/generated/phase10-crash-matrix.json — PHI-free bounded worker process-kill/restart matrix.
- docs/generated/phase10-resident-validation.json — explicit resident-disabled decision.
- docs/generated/phase10-load-fairness.json — FIFO probe and retained real-provider load curve.
- docs/generated/phase10-build-memory.json — baseline OOM and remediated local build memory evidence.
- docs/generated/phase10-release-evidence.json — release decision and unresolved-data counts.
- docs/generated/release-data-check.json — unweakened release gate.
- tests/phase10-acceptance.test.ts — 40 Phase 10 acceptance contracts.
- docs/VISIONSCAN_PHASE9_CONTROLLED_RESEARCH_RELEASE_CANDIDATE_REPORT.md — preserved Phase 9 baseline and controls.

## Final release statement

This report closes the performed Phase 10 engineering work without promoting unmeasured conditions to PASS. The system is suitable for bounded local research demonstration and continued engineering work under the classifications above. It is not approved for clinical deployment, autonomous diagnosis, external validation claims, or data release.
