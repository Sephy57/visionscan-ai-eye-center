# VisionScan AI Eye Center

## Phase 11 — Final Software Engineering Release Report

Report date: 2026-09-14  
Repository: https://github.com/Sephy57/visionscan-ai-eye-center  
Branch: main  
Scope: Phase 11 blocker-closure work only  
Evidence policy: repository artifacts, observed subprocesses, local gates, and exact-head CI. No clinical validation is implied.

Evidence labels used in this report:

- UNIT: isolated contract or code-path test.
- INTEGRATION: multiple application components exercised together.
- REAL_SUBPROCESS: an actual child process was launched and observed.
- REAL_WORKER: an actual VisionScan worker process was run.
- REAL_WINDOWS_CONSOLE: a genuine Windows console control event was attempted and observed.
- REAL_BROWSER: browser interaction against a running application.
- CI: hosted workflow evidence.
- NOT_MEASURED: the requested fact was not captured and is not upgraded to PASS.
- NOT_APPLICABLE: the requested fact does not apply to the enabled runtime.

## 1. Executive decision

Software classification: ENGINEERING PARTIAL — BLOCKERS REMAIN.

The enabled local runtime has strong evidence for graceful shutdown, genuine Windows Ctrl+C handling, restart recovery, active-provider deadline cleanup, resource-wait deadline behavior, post-terminal crash recovery, explicit overload states, FIFO control-plane ordering, review-conflict blocking, truthful retention wording, build/test gates, and exact-head CI. Those results do not establish production deployment, clinical validation, medical-device status, or autonomous diagnostic capability.

The software classification remains PARTIAL for three evidence reasons:

1. A fresh independent engineering re-audit did not return within the bounded 120-second attempts; primary review is not independent sign-off.
2. A separate real blocked-provider-mutex subprocess experiment was not captured. The code-path cancellation guard exists and is covered, but this evidence is PARTIAL.
3. The 25-job provider load result is inherited real evidence from the Phase 10 run. Phase 11 freezes and maps an explicit capacity policy but does not claim a new post-policy 25-job provider rerun.

Runtime classification: LOCAL RUNTIME VALIDATED — BOUNDED SINGLE-WORKER POLICY.

Model classification: MODEL INTELLIGENCE PARTIAL / RESEARCH-ONLY.  
Retinal intelligence classification: RETINAL REVIEW INTELLIGENCE PARTIAL — INTERNAL HELD-OUT EVIDENCE ONLY.  
Data classification: DATA RELEASE BLOCKED.  
Demo classification: DEMO MODE / SYNTHETIC OUTPUT ONLY.  
Clinical classification: NOT CLINICALLY VALIDATED; NOT A MEDICAL DEVICE; NOT FOR AUTONOMOUS DIAGNOSIS.

## 2. Starting SHA

START_LOCAL_SHA: c25686549be6e497070955ab81fce9eb3d84dd6e.

This was the Phase 10 engineering-closure report head from which Phase 11 implementation work began. No reset, history rewrite, or destructive cleanup was used.

## 3. Starting remote SHA

START_REMOTE_SHA: c25686549be6e497070955ab81fce9eb3d84dd6e on origin/main at the start of Phase 11.

The final pre-report remote parity check matched the then-current release-evidence head 2d2152e65072cb04780992fb6b834bb5399168ae.

## 4. Starting worktree

The working directory was D:\AI EYE ANALYSIS PLATFORM on branch main. Existing user history and files were preserved. Phase 11 changes were made as normal commits and pushed normally; no force push was used. The final worktree check after the report push is required to be empty and is recorded in the final handoff accompanying this report.

## 5. Phase 10 preserved evidence

The Phase 10 scientific and runtime baselines were preserved:

| Evidence | Preserved result |
| --- | --- |
| DR confusion counts | TP 79, FN 101, FP 2, TN 218 |
| Exact misses | Grade 3: 65; Grade 4: 20 |
| Lesion escalation | Grade 3: 62/65; Grade 4: 19/20 |
| Frozen rule | LESION_ESCALATION_RULE_PHASE7_V1 with region_count >= 3 |
| Crash matrix | Seven real process-kill/restart rows remained green |
| Resident runtime | Explicitly disabled; RESIDENT_RUNTIME_REJECTED_DISABLED |
| Load result | 15/25 completed; 10 JOB_DEADLINE_EXCEEDED |
| Fairness probe | 100 synthetic control jobs; zero rank overtakes; starvation false |
| Data release | BLOCKED; release:data-check was not weakened |

No new eye model, external dataset, RetGuard reopening, lesion-rule retuning, DR-baseline change, medication intelligence, or clinical LLM was added.

## 6. Live graceful shutdown setup

Evidence: REAL_WORKER and REAL_SUBPROCESS, artifact docs/generated/phase11-live-shutdown-final.json.

The experiment used a fresh isolated temporary root and synthetic/de-identified fixtures. Four jobs were seeded. An external worker was started, a real job was claimed, an approved short-lived local provider process was active, and the worker then received a genuine console interrupt through the Windows PTY path.

The captured scenario included the current job, its lease, the heavy-resource lease, restart recovery, canonical effects, report sealing/export, and descendant cleanup. The artifact reports the isolated root and observation time, so this result is not a replay of a stale screenshot.

## 7. Live graceful shutdown result

PASS for the measured scenario.

The shutdown event was worker_shutdown_requested with policy LEASE_FOR_RECOVERY. The worker entered STOP_REQUESTED while job_mu0721vnciq2c3ly was current. New claims stopped. The current job was left durable for recovery, tracked provider processes reached zero, and the worker emitted the explicit completion event PROVIDER_TREE_TERMINATED_WORKER_EXITED_FOR_LEASE_RECOVERY with application exit code 0.

The PTY wrapper returned exit code 1 after the interrupt. This is an environment-wrapper caveat, not a hidden success claim: the worker itself emitted its completion event and called process.exit(0). The artifact contains all checks as true, including lease preservation, recovery, effect cardinality, report sealing/export, and resource release.

## 8. Windows Ctrl+C

Answer: YES for the available Windows environment.

Evidence: REAL_WINDOWS_CONSOLE. The artifact records PTY_ASCII_ETX, genuine_ctrl_c true, and source SIGINT. This was a genuine ASCII ETX console event sent through the PTY, not a unit-test lifecycle call, mocked SIGTERM, process.kill abstraction, or direct method invocation.

The artifact does not preserve a separate console-PID/provider-PID table. This report therefore does not claim exact individual PID values beyond the observed process-tree facts recorded in the artifact.

## 9. Restart recovery

PASS for the measured shutdown/restart scenario.

The first worker stopped with one active job left for recovery. A fresh worker was started once. It recovered the interrupted job, incremented attempts exactly once to 2 with retry_count 1, completed it, sealed and exported the report, and left the two other seeded jobs queued. Canonical analysis, evidence, reasoning, report, and audit effects remained valid and duplicate-free.

## 10. Lease recovery

PASS for the measured scenario.

The active job was not deleted or converted into a clinical-looking negative result. The shutdown policy preserved the job lease for recovery. On restart, the fresh worker reclaimed the durable work under the normal fencing rules and completed it without an unrecoverable stale lease.

## 11. Resource recovery

PASS for the measured scenario.

The heavy resource lease was active while the provider was running and was released after recovery. The final snapshot reported active heavy leases as 0. The restart path did not leave a reservation that prevented subsequent work.

## 12. Active-provider deadline

Answer: YES for the measured test-only short-deadline scenario.

Evidence: REAL_SUBPROCESS and REAL_WORKER, artifact docs/generated/phase11-deadline-evidence.json. A real approved local provider path was active; the artifact observed D:\AI EYE ANALYSIS PLATFORM\.venv-ophthalmic\Scripts\python.exe and another Python312 child. A configured active deadline of 6000 ms expired while the provider was active.

The job ended as JOB_DEADLINE_EXCEEDED, not MODEL_NEGATIVE, NO_TARGET_FINDING_DETECTED, or SUCCESS. It had one attempt and no analysis, evidence, reasoning, report, or canonical completion effects. The harness process exited 0 after cleanup; measured wall duration was 6958 ms because cleanup was awaited.

## 13. Resource-wait deadline

Answer: YES for the measured resource-wait scenario.

Evidence: REAL_SUBPROCESS and REAL_WORKER. A holder process owned the heavy slot. A waiter received a bounded 1500 ms resource-wait deadline. The waiter ended as JOB_DEADLINE_EXCEEDED with reason RESOURCE_WAIT_DEADLINE_EXCEEDED, did not launch a provider, emitted no clinical output, and did not retain a resource reservation.

The holder’s legitimate lease was visible while it was active and the final active lease count was 0 after cleanup.

## 14. Mutex-wait behavior

Answer: PARTIAL.

The current provider architecture has module-level Promise mutexes for the fundus-lesion, DR, and OCT local providers. Phase 11 added signal-aware guards so an aborted wait rejects before provider launch. The focused acceptance contract covers this code-path behavior and the evidence artifact labels the architecture MEASURED_BY_CODE_PATH.

A separate real blocked-mutex subprocess experiment was not captured. The correct classification is therefore PARTIAL, not PASS and not NOT_APPLICABLE.

## 15. Observed process tree

Evidence: REAL_SUBPROCESS. During the active deadline run, an actual Python executable and a Python312 child were observed. During the shutdown run, the worker tracked the provider tree and reported the tracked-process count reaching zero before worker exit.

The generated artifacts preserve the fact of an owned child and the after-cleanup result, but not a standalone pre-shutdown PID list. No universal claim about descendants that were never observed is made.

## 16. Deadline child cleanup

Answer: YES for all observed descendants.

After the active-provider deadline and after the resource-wait scenario, the re-query reported descendants as an empty list. The implementation awaits provider-tree cleanup and uses the deadline abort signal to terminate owned children.

Scope limitation: this proves cleanup of descendants observed by the harness, not an unbounded guarantee about arbitrary detached processes.

## 17. Deadline resource cleanup

Answer: YES.

The active-provider deadline left the job durable and non-successful, released the resource lease, and reported active heavy leases as 0. The resource-wait deadline launched no provider and left no waiter reservation. Provider mutex state was not left stuck in the measured code path.

## 18. Post-terminal seam

Evidence: INTEGRATION and REAL_WORKER, artifact docs/generated/phase11-post-terminal-crash.json.

The test-only seam AFTER_JOB_COMPLETION_TRANSACTION was added at the point immediately after the terminal completion transaction and before the remaining cleanup path. It is guarded as a test fault seam and is not an ordinary production-triggered feature.

## 19. Post-terminal crash result

Answer: YES for the measured seam.

The worker was forced to exit with code 1 immediately after terminal publication. Before restart, the durable job was already completed, attempts remained 1, the report was sealed/exported, and canonical effects were present exactly once. A fresh worker restarted with code 0, reaped the expired lease, and did not retry the completed job.

After restart, the job remained completed, effect counts were unchanged, resource active count was 0, and descendants were absent.

## 20. Terminal effect count

The post-terminal scenario preserved one canonical terminal completion effect. The completed job remained at one attempt and did not create a second terminal transition after restart.

Canonical effects use insert-once/idempotent keys. The test proves the durable terminal publication and duplicate-free recovery for this seam; it does not claim an unavailable physical provider-invocation counter.

## 21. Report effect count

The post-terminal scenario preserved exactly one analysis effect, one evidence effect, one reasoning effect, and one report effect. The report remained sealed and exported after restart. The shutdown recovery scenario likewise preserved one canonical effect per expected type, with audit effects represented separately.

## 22. Retry behavior

The interrupted active job was retried once on restart as intended by LEASE_FOR_RECOVERY. The post-terminal completed job was not retried. The active-provider deadline job did not acquire a false success or retry churn; it ended durably as JOB_DEADLINE_EXCEEDED.

The result distinguishes durable job attempts from resource polling. A polling observation is not reported as a clinical retry.

## 23. Audit-event semantics

The implementation retains the required distinction:

- Canonical analysis, evidence, reasoning, report, and completion effects are insert-once/idempotent.
- The audit stream is append-only and may be at-least-once; it is not upgraded to an exactly-once claim.

The post-terminal result therefore supports duplicate-free canonical effects without claiming exactly-once audit delivery.

## 24. Queue policy

The bounded local policy is one heavy provider slot with durable FIFO job ordering. A job can be QUEUED, WAITING_FOR_RESOURCE, DEFERRED_CAPACITY, QUEUE_TIMEOUT, SERVICE_TIMEOUT, JOB_DEADLINE_EXCEEDED, or COMPLETED. Generic FAILED is not used as the only overload meaning.

Claims are lifecycle-gated. Shutdown prevents new claims, and resource admission, heartbeat, release, and recovery use the same lease configuration.

## 25. Queue/service/age policy

The formal defaults are:

- Maximum queue wait: 120000 ms.
- Maximum service time: 900000 ms (15 minutes).
- Maximum total age: 1020000 ms (queue plus service).

The current Phase 11 test envelope is explicitly configurable at queue wait 120000 ms, service time 600000 ms, and total age 720000 ms. These test values must not be confused with the production-code defaults.

Classification is centralized: service or total-age expiry becomes JOB_DEADLINE_EXCEEDED; queue-only expiry becomes QUEUE_TIMEOUT. SERVICE_TIMEOUT is reserved for separately instrumented service-budget evidence. The observed 25-job run used JOB_DEADLINE_EXCEEDED and is not relabeled after the fact.

## 26. Capacity policy

Policy name: bounded-single-slot-absolute-job-deadline-v1.

The policy accepts durable work into the queue, admits at most one heavy resource lease, waits only within the same absolute job deadline, and makes each job reach an explicit terminal or deferred policy state. It does not spawn uncontrolled concurrent providers. A capacity-defer state exists for explicit policy use; it is not used to disguise model negatives or ambiguous losses.

The policy mapping is based on observed provider-load behavior and the existing FIFO probe. It does not claim that a new 25-job provider rerun was performed after the policy code was added.

## 27. 25-job result

Evidence: REAL_SUBPROCESS provider-load evidence inherited from docs/generated/phase10-load-fairness.json and mapped by docs/generated/phase11-capacity-policy.json.

Observed/submitted jobs: 25. Completed: 15. JOB_DEADLINE_EXCEEDED: 10. Every observed job reached a defined terminal state. DEFERRED_CAPACITY and QUEUE_TIMEOUT were 0 in that run; no ambiguous failure bucket was used.

This is an inherited real-provider result, not a newly claimed Phase 11 post-policy 25-job rerun. Phase 11 intentionally did not rerun indefinitely in pursuit of 25/25 completion.

## 28. Completion/defer/timeout counts

The explicit mapped result is:

| State | Count |
| --- | ---: |
| COMPLETED | 15 |
| DEFERRED_CAPACITY | 0 |
| QUEUE_TIMEOUT | 0 |
| SERVICE_TIMEOUT | 0 |
| JOB_DEADLINE_EXCEEDED | 10 |
| Other ambiguous loss | 0 |
| Total observed | 25 |

The count is coherent under the declared bounded deadline policy. It is not evidence of a general production throughput SLO.

## 29. FIFO

Evidence: INTEGRATION/control-plane probe. The 100-job FIFO fairness probe recorded zero rank overtakes. The Phase 11 acceptance contract also requires accepted queue ordering to remain FIFO.

No new priority policy was introduced.

## 30. Fairness

Evidence: PARTIAL. The control-plane probe found zero overtakes and starvation false. This supports bounded queue ordering and absence of starvation in the declared synthetic probe.

Real provider completion-order fairness and a sustained service-level fairness SLO were not measured. The inherited 25-job result is not presented as a real-service fairness distribution.

## 31. Retry/polling analysis

The inherited load artifact reported 3109 retries. Code-path analysis classifies these as RESOURCE_POLLING_NOT_JOB_RETRY_CHURN rather than 3109 durable job retries. Resource polling is bounded at 250 ms, while durable job attempts are limited explicitly to 3.

This distinction preserves semantics: polling for a heavy slot does not create extra clinical analyses or erase the job’s attempt history.

## 32. Throughput

The only bounded real-provider throughput observation is 15 completions out of 25 observed jobs in the inherited load run, or 60 percent of that run. The other 10 reached JOB_DEADLINE_EXCEEDED. No sustained jobs-per-second, production capacity, or service-level throughput claim is made.

## 33. Latency

No latency distribution or production SLO was established. The deadline evidence measured a 6000 ms active deadline with an observed 6958 ms harness duration because cleanup was awaited, and a 1500 ms resource-wait deadline. These are cleanup/deadline observations, not percentile latency claims.

## 34. Memory/CPU

The preserved Phase 10 build-memory artifact documents the host-specific 10240 MB ceiling, approximately 8,789,901,312 bytes working set, approximately 9,397,448,704 bytes private memory, 16 processes, and approximately 399.5 CPU during the prior build observation. webpackMemoryOptimizations, server externalization, and the existing source-map decision were preserved.

Phase 11 did not establish a new provider-load memory or CPU SLO. The final local build completed successfully in 719638 ms.

## 35. Clinician review conflict

The concurrent-review governance gap was closed in the enabled review path. Conflicting review events remain distinguishable, and an unresolved CONCURRENT_REVIEW_CONFLICT is not treated as agreement.

Evidence: UNIT/INTEGRATION acceptance contracts and the review service/API/UI changes. This is a software governance control, not clinical adjudication or clinical sign-off.

## 36. Conflict finalization rule

Rule: BLOCK FINALIZATION UNTIL ADJUDICATED.

When unresolved conflict exists, report finalization rejects with REVIEW_CONFLICT_REQUIRES_ADJUDICATION. The system cannot silently finalize a report as though concurrent reviewers agreed.

## 37. Adjudication

Adjudication is additive and append-only. The persisted adjudication event includes the event identity, study/report reference, conflicting review references, adjudicator, decision, reason, timestamp, AI snapshot hash, and prior report revision.

Prior review events are retained. The adjudication event records the governance decision without overwriting the original disagreement.

## 38. Laterality correction

Laterality correction is accessible through the clinician review path and is stored additively. The original model output is not altered. The correction is represented as a later review/amendment decision and remains subject to clinician authority and provenance.

## 39. Review reasons

Structured review reasons are exposed and persisted. Supported bounded reasons include WRONG_LATERALITY, IMAGE_QUALITY, WRONG_LOCALIZATION, MODEL_DISAGREEMENT, INSUFFICIENT_EVIDENCE, and OTHER, with an optional bounded rationale.

The reason is an explanation of the clinician review event, not a retroactive model-confidence or diagnostic claim.

## 40. Deletion/retention semantics

Current semantics are truthful and explicit. Source and derived image bytes can be removed from active access, while finalized reports, amendments, audit history, and recovery evidence remain retained where required. The API/UI wording uses SOURCE_BYTES_REMOVED_HISTORY_RETAINED and does not display PERMANENTLY DELETED for this path.

Retained history remains behind the existing authorized audit/recovery access controls; no public release of retained evidence is implied. The retention reason is audit/recovery integrity. This is not a claim that every historical byte is erased.

## 41. Resident runtime containment

Answer: YES, contained by disabling the path.

The final Phase 10 decision RESIDENT_RUNTIME_REJECTED_DISABLED remains intact. Resident parity, resident cancellation, and resident memory validation are NOT_APPLICABLE to the enabled release path. No resident inference was reopened.

## 42. Build regression

Evidence: local Windows build, exit code 0. The final code path built with Next 16.3.4 webpack, compiled successfully in approximately 10.2 minutes, completed TypeScript checking in approximately 26.1 seconds, and generated 22/22 static pages. The measured elapsed timer was 719638 ms.

The build used the preserved host-specific memory ceiling and did not require a timeout increase to obtain a pass.

## 43. Dependency audit

Production dependency audit command: npm audit --omit=dev --omit=optional --omit=peer --json. Result: exit 0, zero production vulnerabilities; 78 production dependencies, 271 development dependencies, 113 optional dependencies, and 2 peer dependencies were reported in the audit inventory.

The development dependency review identified two moderate Vitest/@vitest-mocker advisories, GHSA-82fw-gwwq-j7x9, affecting the current Vitest 3.2.6 development range with a fixed version in the Vitest 4.1.11 line. The issue is development-only, is not shipped in the runtime service, is not imported by the production application path, and is retained as a compatibility risk because a major harness upgrade may break the required test environment. CI and local mitigations remain in place.

This is a documented dev-tool risk, not a claim of zero vulnerabilities in every development dependency.

## 44. Secret scan

Evidence: bounded tracked-file scan, artifact docs/generated/phase11-secret-scan.json. Command: npm run security:phase11:secrets.

Result: PASS_NO_HIGH_CONFIDENCE_SECRET. The scan covered 612 tracked text files, found no findings, excluded placeholders by rule, and printed no credential values. It checked private-key material, GitHub/AWS-style tokens, common API-key patterns, password assignments, and accidentally tracked .env files.

This is a bounded repository secret scan, not a certificate or a guarantee about secrets outside tracked text.

## 45. Prompt-injection regression

Evidence: UNIT/INTEGRATION and Phase 11 acceptance. Bounded cases cover Unicode obfuscation, zero-width characters, split-token instruction text, mixed-case instructions, and base64-looking instruction text in document data.

Normalization is used only for classification decisions; original document data remains unchanged. The classifier treats prompt-like document content as untrusted data and does not decode base64-looking text as an instruction. No clinical release or diagnosis rule is altered by these inputs.

## 46. Security red team

Classification: PARTIAL.

The bounded secret scan, prompt-safety regression, release/data checks, authorization/consent contracts, and clinical-safety boundary audit passed their declared checks. A fresh independent engineering/security red-team sign-off was not measured because the bounded independent auditor attempts timed out. No certificate, penetration-test attestation, or universal security guarantee is claimed.

## 47. PHI

The Phase 11 live experiments used isolated synthetic/de-identified data. The release-data check reported PHI false for the inspected release evidence. The committed Phase 11 evidence contains no known PHI according to the bounded audit and secret/data checks.

This does not authorize uploading real patient data or imply that the system is cleared for PHI production operations.

## 48. Consent

Consent gating remains enabled and was covered by the preserved safety contracts and Phase 11 acceptance. Consent-denied paths return without clinical analysis and still execute the required job-finished lifecycle cleanup.

This is a software control result, not legal or clinical consent validation.

## 49. Phase 11 acceptance

Evidence: UNIT/INTEGRATION. npx vitest run tests/phase11-acceptance.test.ts --pool=forks --poolOptions.forks.singleFork=true passed 28/28 tests.

The acceptance contracts cover shutdown claim fencing, lease-for-recovery, restart recovery, active and waiting deadlines, mutex cancellation code path, descendant/resource cleanup, post-terminal recovery, effect cardinality, capacity states, FIFO/starvation probe, review governance, retention wording, resident containment, fault-hook scope, prompt safety, no-false-normal, diagnosis gate, and release:data-check blocking.

## 50. Full equipped tests

Evidence: UNIT/INTEGRATION. npm test -- --pool=forks --poolOptions.forks.singleFork=true exited 0.

Result: 90 passed test files, 1 skipped file; 1234 passed tests, 13 skipped tests; duration approximately 493.77 seconds. Expected negative-case restore diagnostics, PDF font warnings, and one Node MaxListeners warning were observed without test failures.

## 51. Clean no-model tests

Evidence: CLEAN CHECKOUT and INTEGRATION. A fresh detached checkout at dc8b0dc0198d43030f0ed1fcbe3c78e990bb3d76 was created under a temporary directory. The initial tracked checkout had no .env, database, model files, uploads, reports, .next output, scratch, or cache.

npm ci, setup, db:init, npm run validation:phase11, TypeScript, lint, model audit, filesystem audit, SBOM, build, smoke, and browser smoke passed. The clean Phase 11 validation result was 5 files and 122 tests. The clean browser smoke completed 7 checks. The clean checkout later contained one synthetic retained report as expected from retention semantics; it had zero model files and zero upload files and remained Git-clean.

The clean local build passed after the development server had populated cache. A separate cold-local-clean-build timing is not claimed; the exact-head hosted Windows build also passed.

## 52. TypeScript

Evidence: UNIT/BUILD. npx tsc --noEmit --pretty false exited 0 in the equipped checkout and in the clean no-model checkout.

## 53. Lint

Evidence: UNIT/BUILD. npm run lint -- --quiet exited 0 in the equipped checkout and in the clean no-model checkout.

## 54. Build

Evidence: BUILD and CI. The final local Windows build exited 0, generated all 22 static pages, and preserved the Phase 10 memory controls. The clean no-model build exited 0. The hosted exact-head Windows build also passed.

## 55. Smoke

Evidence: INTEGRATION and REAL_BROWSER setup. The clean no-model server smoke passed 16/16 checks against localhost:3012. The server was stopped after the check; no long-running test server is part of the release claim.

## 56. Browser E2E

Evidence: REAL_BROWSER and CI. The clean no-model browser pass completed 7 checks covering login/dashboard, /dashboard, /patients, /analyze, /validation-center, /result, and /report. Hosted Browser CI passed at the exact implementation-evidence head.

## 57. Model audit

Evidence: UNIT/INTEGRATION. The equipped model audit passed for the three committed DR, lesion, and OCT manifests, all labeled research_only. The clean no-model audit passed with zero manifests. No model was promoted by this phase.

## 58. Filesystem audit

Evidence: INTEGRATION. The equipped filesystem audit passed with source/data roots on D: and reported approximately 369.6 GB free on D:. The clean no-model audit passed; its temporary checkout was on C:, so the warning that clean roots were C:-located is an environment placement note, not a software failure.

## 59. SBOM

Evidence: INTEGRATION. The equipped and clean no-model SBOM commands passed and wrote their outputs to temporary evidence paths. The committed report does not expose secrets from those outputs.

## 60. release:data-check

Evidence: INTEGRATION. npm run release:data-check -- --output C:\Users\pc\AppData\Local\Temp\visionscan-phase11-release-data-check.json exited 1 as expected with status BLOCKERS_REMAIN.

The inspected active unresolved count was 235 and the legacy unresolved count was 158. Active missing-artifact issues were 233 plus 2 detached-parent issues. Legacy missing-artifact issues were 87 plus 71 missing report exports. Active FK, cross-tenant, and hash-mismatch counts were 0; legacy orphan count was 5263; quarantine count was 81; PHI was false.

Data release remains blocked. The check was not weakened, and this data status is kept separate from local research software runtime status.

## 61. Implementation SHA

Implementation code SHA: 79d9cae39e136896db3b0c0784b39e067e71708e.

Exact CI evidence head recorded by docs/generated/phase11-ci.json: 39cb5f44177aabbdb2f621fa9c90738c45c04528. Later commits 2ce9a1f61029f6b08fe28caaa5cab8e3e19300ff and 2d2152e65072cb04780992fb6b834bb5399168ae added or corrected evidence artifacts without changing the Phase 11 application implementation.

The report SHA is intentionally not embedded in this report body. Embedding a self-referential SHA before committing would be false. The report commit and final remote parity are verified after publication.

## 62. Push parity

Normal push parity was verified before report publication: local pre-report head 2d2152e65072cb04780992fb6b834bb5399168ae matched origin/main. No force push was used.

The report itself is committed separately. The exact report SHA and its origin/main parity are recorded in the final handoff after that commit, rather than fabricated inside the report.

## 63. Linux CI

Evidence: CI, docs/generated/phase11-ci.json. Workflow run 34778722481, URL https://github.com/Sephy57/visionscan-ai-eye-center/actions/runs/34778722481, passed the Linux job 103781668677 with conclusion success. The artifact classifies this as PASS_EXACT_IMPLEMENTATION_HEAD_CI at head 39cb5f44177aabbdb2f621fa9c90738c45c04528.

## 64. Windows CI

Evidence: CI, the same run 34778722481 passed the Windows job 103781668789 with conclusion success at the exact recorded implementation-evidence head.

## 65. Browser CI

Evidence: CI, the same run 34778722481 passed the Browser job 103781668761 with conclusion success at the exact recorded implementation-evidence head.

The report-head CI run is push-triggered and does not exist until this report commit is pushed. The immutable report therefore does not invent a future run ID; the final handoff records whether the workflow ran, its head SHA, and Linux/Windows/Browser conclusions. This is not classified as NOT_MEASURED: it is a post-publication verification step.

## 66. Independent engineering audit

Classification: NOT_MEASURED.

docs/generated/phase11-independent-audit.json records NOT_MEASURED_INDEPENDENT_AUDITOR_TIMEOUT. Two bounded independent auditor attempts stopped without a result. Its observations are explicitly labeled PRIMARY_REVIEW_ONLY and are not presented as independent approval. No remaining P0 correctness blocker was independently cleared.

This is the principal reason the overall software classification remains ENGINEERING PARTIAL — BLOCKERS REMAIN.

## 67. Clinical-safety boundary audit

Evidence: separate read-only boundary inspection, artifact docs/generated/phase11-clinical-safety-boundary-audit.json. Status: PASS_BOUNDARY_INTACT.

The audit confirmed research-only manifests, clinician review/provenance, no-false-normal behavior, diagnosis gating, untrusted prompt content, conflict blocking, additive laterality correction, consent control, truthful deletion wording, and release-data blocking. It did not perform clinical validation, establish diagnostic accuracy, or confer regulatory status.

## 68. Remaining engineering blockers

The remaining engineering evidence blockers are:

- NOT_MEASURED: fresh independent post-implementation engineering re-audit did not return within bounded attempts.
- NOT_MEASURED: separate real blocked-provider-mutex subprocess evidence was not captured; the signal-aware code-path guard is covered.
- NOT_MEASURED: a new post-policy 25-job provider rerun was not performed; the inherited real 25-job result is explicitly mapped to the frozen policy.

These are not silently converted to PASS. Data, model, and clinical issues are listed separately below and are not mislabeled as runtime defects.

## 69. Remaining model blockers

Model blockers remain: external lesion validation is not established; the DR model remains weak on the preserved internal baseline; RetGuard remains a candidate only, rights-restricted, and not benchmark-ready; and no new model evidence was added in Phase 11.

The deterministic clinical analysis path is not an active LLM path. An optional OpenAI-compatible provider module is disabled by default and requires explicit enablement, endpoint/key/model, and data-disclosure gates; it was not used by this release evidence.

## 70. Remaining data blockers

Data release remains DATA RELEASE BLOCKED. The release:data-check unresolved counts and missing artifact/report-export issues are recorded in Section 60. The Phase 11 decision is to preserve the block rather than delete, rewrite, or weaken data-integrity evidence.

## 71. Remaining clinical blockers

Clinical blockers remain: no clinical validation, no external clinical sign-off, no regulatory approval, and no basis for medical-device or autonomous-diagnosis claims. Research-only labels, clinician authority, provenance, consent, conflict blocking, and no-false-normal controls reduce software risk but do not replace clinical evidence.

## 72. Exact software capabilities

Within the bounded local research path, VisionScan can:

- run its web application and deterministic local analysis workflow;
- queue durable jobs with one heavy resource slot and bounded absolute deadlines;
- stop claims on graceful shutdown, preserve a current lease for recovery, restart, and recover durable work;
- cancel owned provider descendants for measured deadline scenarios;
- preserve canonical effects through process crash/restart at the measured post-terminal seam;
- expose clinician review conflict blocking, additive adjudication, laterality correction, and structured review reasons;
- retain audit/recovery history with truthful source-byte deletion wording;
- run research-only DR, lesion, and OCT manifests where the required local assets exist;
- support synthetic/de-identified demo and release-evidence workflows.

## 73. Exact software non-capabilities

VisionScan cannot honestly be described by this evidence as:

- clinically validated, diagnostically accurate, or approved for patient care;
- a medical device or an autonomous diagnosis system;
- externally validated on a new lesion dataset;
- a production-scale or sustained-throughput service;
- a resident-inference runtime;
- an active clinical LLM system;
- a cleared data-release pipeline;
- universally able to clean up descendants it never observed;
- independently re-audited and approved for all Phase 11 P0 criteria;
- free of every development-tool advisory.

## 74. Software classification

ENGINEERING PARTIAL — BLOCKERS REMAIN.

The local engineering path is substantially evidenced, but the independent re-audit and two additional measurement gaps prevent the maximum classification ENGINEERING READY — CONTROLLED LOCAL RESEARCH.

## 75. Runtime classification

LOCAL RUNTIME VALIDATED — BOUNDED SINGLE-WORKER POLICY.

This classification is limited to the enabled local runtime and is supported by live shutdown, restart, deadline cleanup, explicit capacity states, and FIFO/starvation probe evidence.

## 76. Model classification

MODEL INTELLIGENCE PARTIAL / RESEARCH-ONLY.

No new model claim was introduced. Existing manifests and baseline metrics remain bounded internal evidence.

## 77. Retinal intelligence classification

RETINAL REVIEW INTELLIGENCE PARTIAL — INTERNAL HELD-OUT EVIDENCE ONLY.

The system supports review-oriented retinal analysis and escalation logic, but external validation and clinical performance evidence are not established.

## 78. Data classification

DATA RELEASE BLOCKED.

The release-data gate remains intentionally blocking.

## 79. Demo classification

DEMO MODE / SYNTHETIC OUTPUT ONLY.

The live Phase 11 experiments and committed evidence are isolated synthetic/de-identified workflows. Demo output must not be represented as patient-specific clinical advice.

## 80. Clinical classification

NOT CLINICALLY VALIDATED.  
NOT A MEDICAL DEVICE.  
NOT FOR AUTONOMOUS DIAGNOSIS.

## Q1. Was a live graceful shutdown measured?

Answer: YES. Evidence: REAL_WORKER artifact docs/generated/phase11-live-shutdown-final.json records an external worker, a claimed job, shutdown transition, lease-for-recovery, worker exit, restart, recovery, effects, and cleanup.

## Q2. Did shutdown stop new claims?

Answer: YES. Evidence: the shutdown event entered STOP_REQUESTED, used LEASE_FOR_RECOVERY, and the final checks report no new claims after the request.

## Q3. Did restart recover the active job?

Answer: YES. Evidence: the fresh worker recovered the interrupted durable job, incremented its attempt once, completed it, sealed/exported the report, and preserved canonical effect counts.

## Q4. Was a genuine Windows Ctrl+C measured?

Answer: YES. Evidence: REAL_WINDOWS_CONSOLE PTY_ASCII_ETX with genuine_ctrl_c true and source SIGINT. The PTY wrapper’s exit code 1 is documented as an interrupt-wrapper caveat; the worker emitted its explicit success exit event.

## Q5. Did a real provider hit a deadline during active inference?

Answer: YES. Evidence: REAL_SUBPROCESS observed the actual local Python provider path and child; the 6000 ms active deadline produced JOB_DEADLINE_EXCEEDED with no clinical effects.

## Q6. Were all observed provider descendants gone afterward?

Answer: YES. Evidence: the post-deadline re-query reported descendants as an empty list. This is limited to observed/owned descendants.

## Q7. Did resource-wait deadline behavior work?

Answer: YES. Evidence: a holder owned the heavy slot; the 1500 ms waiter ended with RESOURCE_WAIT_DEADLINE_EXCEEDED, did not launch a provider, and left no reservation.

## Q8. Was provider mutex waiting tested or legitimately NOT_APPLICABLE?

Answer: PARTIAL. Evidence: provider mutexes exist and signal-aware cancellation guards are covered by the code-path contract; a separate real blocked-mutex subprocess measurement was not captured, so NOT_APPLICABLE would be incorrect.

## Q9. Did the post-terminal crash create any duplicate canonical effect?

Answer: YES, no duplicate was created. Evidence: the AFTER_JOB_COMPLETION_TRANSACTION crash left one terminal/analysis/evidence/reasoning/report effect each before and after restart.

## Q10. Did a completed job remain completed after restart?

Answer: YES. Evidence: post-terminal restart preserved completed status, attempts 1, sealed/exported report, and no retry.

## Q11. Is the overload/capacity policy explicit?

Answer: YES. Evidence: bounded-single-slot-absolute-job-deadline-v1 defines queue, resource, capacity, timeout, and completion states and limits heavy admission to one slot.

## Q12. At 25 jobs, did every job reach a defined state?

Answer: YES. Evidence: inherited real provider-load mapping observed 25 terminal jobs: 15 COMPLETED and 10 JOB_DEADLINE_EXCEEDED, with no ambiguous loss. Caveat: this was not a new post-policy rerun.

## Q13. Was starvation measured?

Answer: YES. Evidence: the 100-job FIFO control-plane probe recorded zero overtakes and starvation false. Sustained real-service fairness was not claimed.

## Q14. Were retry/polling counts explained?

Answer: YES. Evidence: 3109 observations are classified as bounded resource polling, not durable job retries; polling is 250 ms and durable attempts are capped at 3.

## Q15. Can concurrent clinician disagreement be finalized silently?

Answer: NO. Evidence: unresolved CONCURRENT_REVIEW_CONFLICT rejects finalization with REVIEW_CONFLICT_REQUIRES_ADJUDICATION.

## Q16. Are review conflicts preserved and adjudicated?

Answer: YES. Evidence: conflict and adjudication events are append-only, preserve prior references and AI snapshot hash, and require an authorized adjudication decision/reason.

## Q17. Are laterality corrections additive?

Answer: YES. Evidence: laterality correction is stored as an additive clinician review/amendment event; original model output remains unchanged.

## Q18. Is deletion/retention wording truthful?

Answer: YES. Evidence: source/derived-byte removal is described as SOURCE_BYTES_REMOVED_HISTORY_RETAINED; finalized reports, amendments, audit, and recovery history are retained where required; PERMANENTLY DELETED is not falsely shown.

## Q19. Is resident runtime definitely disabled?

Answer: YES. Evidence: RESIDENT_RUNTIME_REJECTED_DISABLED remains the explicit Phase 10 decision and no resident path was reopened.

## Q20. Did the final Windows local build pass?

Answer: YES. Evidence: local npm run build exited 0, compiled with Next 16.3.4 webpack, generated 22/22 pages, and completed in 719638 ms.

## Q21. Did the full equipped suite pass?

Answer: YES. Evidence: npm test exited 0 with 90 passed files, 1 skipped file, 1234 passed tests, and 13 skipped tests.

## Q22. Did the clean no-model checkout pass?

Answer: YES. Evidence: fresh checkout npm ci, setup, db:init, focused no-model validation, TypeScript, lint, model audit, filesystem audit, SBOM, build, smoke, and browser checks passed. The exact scope and cache nuance are recorded in Section 51.

## Q23. Did exact implementation Linux CI pass?

Answer: YES. Evidence: run 34778722481, Linux job 103781668677, conclusion success at the exact head recorded in phase11-ci.json.

## Q24. Did exact implementation Windows CI pass?

Answer: YES. Evidence: run 34778722481, Windows job 103781668789, conclusion success at the exact head recorded in phase11-ci.json.

## Q25. Did exact implementation Browser CI pass?

Answer: YES. Evidence: run 34778722481, Browser job 103781668761, conclusion success at the exact head recorded in phase11-ci.json.

## Q26. Did a fresh independent engineering audit find a remaining P0 software blocker?

Answer: NOT_MEASURED. Evidence: the independent auditor timed out twice without returning a finding; the retained artifact is PRIMARY_REVIEW_ONLY and explicitly does not substitute for independent sign-off.

## Q27. Did the clinical-safety boundary remain intact?

Answer: YES. Evidence: phase11-clinical-safety-boundary-audit.json reports PASS_BOUNDARY_INTACT for research labels, provenance, clinician authority, no-false-normal, diagnosis gate, prompt safety, conflict handling, laterality, consent, retention wording, and PHI boundary checks. This is not clinical validation.

## Q28. Is data release still blocked?

Answer: YES. Evidence: release:data-check exited 1 with BLOCKERS_REMAIN and the unresolved active/legacy counts recorded in Section 60.

## Q29. Can VisionScan now honestly be called ENGINEERING READY — CONTROLLED LOCAL RESEARCH?

Answer: NO. Evidence: the measured local runtime gates pass, but the independent engineering re-audit is NOT_MEASURED, separate real mutex-wait evidence is NOT_MEASURED, and no new post-policy 25-job provider rerun was performed. The honest current classification is ENGINEERING PARTIAL — BLOCKERS REMAIN.

