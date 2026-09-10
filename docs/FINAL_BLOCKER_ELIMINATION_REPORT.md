# VisionScan AI — Final blocker elimination and release-stabilization report

Evidence freeze: 2026-09-11 local Windows run in `D:\AI EYE ANALYSIS PLATFORM`.
This is an engineering/release report for the local research workflow. It does
not add a feature, model, patient data, or clinical claim. Counts are taken
from the generated PHI-minimizing reports under `docs/generated/` and from the
commands recorded below.

1. **Starting HEAD.** The actual repository tip at the start of this final pass was `c58595234cfb109ba8e65aeaab185575920c24c6` on `main`, with the earlier prompt candidate `a9b989fd9365eb4336f4fed143f622439cf5faab` in its history. The working tree was inspected with `git status --short`, `git diff --check`, and `git diff --stat`; no reset, clean, checkout, restore, or stash was used.

2. **Ending HEAD.** The runtime/evidence integration tip is `a75bb13b70cef94bb09853d3517f82a53537b6d5` (`test: bound red-team paths and refresh release evidence`). The report and inventory are a documentation follow-up to that candidate; they do not change runtime behavior or data.

3. **Branch.** `main`; remote `origin` is `https://github.com/Sephy57/visionscan-ai-eye-center.git`.

4. **Commits.** The relevant blocker-closure history is linear and preserved: `a9b989f` (reconciliation/FK evidence), `e6743c4` (optional bridge policy and browser smoke), `56e42bf` (Vitest compatibility evidence), `8b4c56c` (future-write integrity and release data gates), `1ef098b` (query-spoof isolation), `e992e73` (hosted-browser storage isolation), `c585952` (bounded model benchmark), `a75bb13` (current red-team fixture bound, hydration warning fix, current generated evidence, and inventory metadata fields), and `ad05f9d` (this final blocker-elimination report and inventory snapshot).

5. **Push.** The runtime/evidence candidate is ready for `git push origin main`; no credentials or tokens are recorded in this report. Push and the resulting final-head workflow are an explicit release gate, not assumed from a local commit.

6. **Final-head CI.** At this evidence freeze the new `verify`, `verify-windows`, and `verify-browser` workflows were present and the prior candidate run `34519366185` was green. The final push must be followed by `gh run list`/`gh run watch`; a workflow being queued is not treated as success. The resulting run IDs and conclusions are recorded in the final inventory follow-up.

7. **Sub-agents.** The required parallel review was completed by `/root/integrity_closure` (reconciliation, FK, future-write and release-data gates), `/root/runtime_stability` (worker/model runtime, S9 benchmark and red-team stability), and `/root/toolchain_browser` (Vitest/bridge policy and hosted browser CI). Main-agent review integrated their non-overlapping changes. Data integrity, model runtime, security, toolchain, CI, and release classification were each independently checked; no FAIL was left unaddressed in the local evidence.

8. **Baseline gates.** The pre-fix model-equipped baseline was not green: 64 test files passed, 1 skipped, and 2 failed in 801.44 seconds. The failures were the process-boundary job-lease child-exit mismatch and the S-FINAL model-bound security timeout. This baseline is retained as the comparison point; the final canonical run below is authoritative.

9. **Missing source artifacts before.** Reconciliation reported 235 `MISSING_REQUIRED_ARTIFACT` records with result `SOURCE_ARTIFACT_UNAVAILABLE`.

10. **Missing source classifications.** The current adjudication separates 233 missing study originals (active `REAL_REQUIRED_SOURCE`), two active detached analysis dependencies, 36 legacy missing study originals, and 30 legacy missing report exports. No source bytes were synthesized. The older 55-legacy snapshot increased to 66 only because later synthetic/browser runs created additional deleted test/report rows; the active count stayed 235.

11. **Hash recovery.** Trusted application storage was checked for exact content-hash recovery. No candidate satisfied byte identity plus patient scope, tenant scope, and provenance, so zero records were relinked. Hash mismatch count is zero. Filenames, dates, and nearest encounters were never used as identity evidence.

12. **Active versus legacy classification.** Active unresolved source dependencies are 235 and block the active-data release gate. The 66 legacy findings are retained as explicit historical state and are isolated from active reasoning/report workflows. Neither class is silently converted to normal, negative, verified, or clinically interpretable data.

13. **Permanently unavailable sources.** The adjudicator persists `SOURCE_ARTIFACT_UNAVAILABLE` with `mark_unavailable`; the documented terminal policy is `SOURCE_PERMANENTLY_UNAVAILABLE` after authorized confirmation. Replay/report surfaces must say `SOURCE MATERIAL UNAVAILABLE FOR REPLAY`. No reconstruction, substitution, or clinical inference is allowed while bytes are missing.

14. **Reconciliation result after.** `docs/generated/reconciliation-adjudication.json` contains 301 PHI-minimizing findings: 235 `MISSING_REQUIRED_ARTIFACT` and 66 `VALID_LEGACY_STATE`. `quarantine_applied` is false for this read-only adjudication, and `docs/generated/release-data-check.json` reports `status: BLOCKERS_REMAIN` because 235 active source dependencies remain.

15. **FK orphans before.** FK preflight reported 5,263 orphan references across 11 typed relations: 5,260 `documents.study_id -> studies`, two analyses, and one job.

16. **FK orphan root cause.** The 5,260 document children are logically deleted test/development rows with absent parents and no deterministic legacy-ID mapping. The two analyses are detached derivative/report pairs; the single job is terminal `COMPLETED` history. There is no evidence of a current-patient corruption pattern.

17. **Safe repairs.** Zero relational FK rows were automatically repaired. Preflight shows `cross_tenant_references=0`, `invalid_nullability=0`, and `direct_fk_migration_safe=false`; no guessed parent, synthetic study, nearest encounter, or date-only association was created. The preserved quarantine inventory is 81 files and remains auditable.

18. **Legacy detached documents.** All 5,260 document references are classified `LEGACY_DETACHED_DOCUMENT`, `repairable=false`, `repair_strategy=authorized_reassociation_only`. They cannot enter cross-modality reasoning, condition synthesis, clinician reports, or longitudinal comparison without an authorized, evidence-backed reassociation.

19. **Future-write FK enforcement.** Application transactions now reject new `documents`, `analyses`, and `jobs` rows whose `study_id` is absent, before payload publication, and preserve tenant checks. `tests/future-write-integrity.test.ts` proves missing-study writes and unavailable active-source replay fail closed.

20. **FK migration plan.** Legacy tables remain retained and classified; constrained application writes/views protect new data; evidence-backed repairs are the only permitted legacy migration; direct SQL constraints are deferred until preflight is clean. This prevents old dirty rows from weakening future integrity.

21. **FK result after.** Active FK orphan count is 0, legacy orphan count is 5,263, cross-tenant count is 0, and direct migration remains unsafe. This is a phased migration state, not a falsely green zero-orphan claim.

22. **S9 timeout reproduction.** The earlier model-enabled full suite reproduced a deterministic first-inference timeout: one call could take about 111.8 seconds and the repeat hit the 120-second test budget. A focused S9 run later passed 10 tests with one expected skip, but isolated success alone was not accepted as the release result.

23. **CPU profiling.** `npm run model:performance` measures artifact hashing, Python probe execution, import/startup, model load, inference, JSON transport, and teardown separately for three cold and three sequential provider calls. It does not download weights, alter the provider, or make a clinical latency claim. Peak child RSS is explicitly unavailable in this benchmark.

24. **Python startup.** Fresh probe-reported Python/module import time was 7,030–7,535 ms; total cold subprocess wall time was 9,845.5–10,356 ms. The import measurement includes the runtime imports used by the probe; torch/torchvision are not independently split because this provider does not import torchvision/timm.

25. **Torch/model load.** The same cold runs measured model construction/state load at 461–506 ms and forward inference at 1,341–1,379 ms. The artifact was hash-verified as `22e45131b64eb07a5d29a2e5388a7709d10696b13f48d2d0cdcf56cafa1f9ea5` before timing.

26. **Cold inference metrics.** Three cold runs completed: p50 9,900.7 ms, p95 10,356 ms, minimum 9,845.5 ms, maximum 10,356 ms. All exited 0 with completed inference status.

27. **Warm inference metrics.** Three sequential provider calls completed: p50 9,514.6 ms, p95 10,026.4 ms, minimum 9,500.2 ms, maximum 10,026.4 ms. “Warm” means filesystem/module warm-up while each call still uses an isolated subprocess; it is not a resident model worker. Peak RSS was not observed.

28. **Root cause.** The normal path is dominated by one-shot Python process/import overhead and is sensitive to CPU/filesystem contention when the full suite starts several native/image and model-related operations. No semantic output nondeterminism or artifact mismatch was observed. The provider has no persistent worker, so a two-minute S9 result is an environment/test-contention failure mode rather than a clinical performance result.

29. **Fix.** Functional S9 semantics are separated from the new bounded cold/warm benchmark. The final suite uses the documented single-worker Vitest invocation, and the two security-boundary red-team scenarios use a non-fundus fixture so request-authority assertions cannot accidentally invoke the optional research model. The 120-second hang guard was not “fixed” by simply increasing it.

30. **Repeated cold test.** The benchmark completed all 3/3 cold and 3/3 warm samples in the fresh run above. The S9 focused functional run also completed without a timeout; both functional and performance evidence are retained separately.

31. **Model-enabled full suite.** The authoritative final run was `npm test -- --pool=forks --no-file-parallelism --maxWorkers=1 --minWorkers=1 --reporter=dot`: 67 test files passed, 1 skipped; 986 tests passed, 10 skipped; duration 628.23 seconds; exit code 0.

32. **Query-spoof timeout reproduction.** The earlier focused red-team run recorded 18 passes and one approximately 30-second GET query-spoof timeout. The model-equipped full run also showed request-budget pressure when security tests used a fundus fixture. Those observations were retained rather than hand-waved away.

33. **Request-path profile.** The real GET study route performs authentication, identifier validation, stored-study access, and response shaping. `useSearchParams()` consumers only use navigation identifiers such as `study`/`job`; safety fields are re-fetched from the server. The route does not send unknown query keys to OCR, filesystem scans, full-database traversal, or model inference.

34. **Fail-fast changes.** Static route tests assert no privileged safety query parameter is read, and body tests assert `/api/analyze` reads only the permitted study/async fields. Security-boundary scenarios now declare `external_eye` so their real route/service assertions remain bounded on both model-equipped and clean checkouts. No production timeout was increased and no arbitrary query parameter is passed into a domain object.

35. **Repeated spoof test.** Three consecutive `tests/s-final-redteam.test.ts` runs completed 9/9, with elapsed times 34.95 s, 37.16 s, and 35.35 s. They recorded zero timeouts, zero mutation bypasses, and the expected server-derived reviewer/diagnosis-gate values.

36. **Security performance.** The bounded `/api/analyze` and review authority scenarios completed in approximately 517 ms and 204 ms respectively after fixture isolation. The broader smoke/security gates also passed unauthenticated, non-admin, tenant-mismatch, path, lease, retry, backup, replay, and supersession rejection cases without touching the research provider.

37. **Python bridge classification.** The generic `PythonBridgeProvider` is an `OPTIONAL_RESEARCH_COMPONENT`: it is not in the live provider map or model registry and cannot produce findings in the current release. Its readiness probe is explicitly opt-in.

38. **Python bridge dependency result.** The opt-in probe truthfully reports missing `torch`/`torchvision`; the default clean-checkout contract skips the live probe (8 expected skips in the bridge suite) and does not fail application readiness. No large package was installed solely to turn an optional status green; an opt-in run completed its 8/8 fail-closed assertions on the configured host.

39. **Vitest 4 root cause.** The isolated Vitest 4.1.11 experiment removed the standalone top-level `vite-node` child entrypoint used by `tests/job-lease-recovery.test.ts`; the child exited 1 before reaching its intentional exit 17. Vitest 4 also removed the project’s `--minWorkers` option. This is a test-runner dependency/layout incompatibility, not a lease-recovery product regression.

40. **Vitest compatibility result.** Vitest 4 was not adopted. The release lock remains on Vitest 3.2.6, whose single-worker full suite is green; lease crash/recovery, late-worker fencing, cancellation, and retry semantics remain asserted.

41. **Dependency advisory decision.** `npm audit --audit-level=high` exits 0 with two disclosed moderate dev-only Vitest advisories (`GHSA-82fw-gwwq-j7x9` family); `npm audit --omit=dev --audit-level=high` exits 0 with zero production vulnerabilities. `npm audit fix --force` was not used. The advisory is accepted as a development-only limitation.

42. **Browser CI.** `.github/workflows/ci.yml` contains a live `verify-browser` job that installs Chromium, starts an isolated local server/SQLite store, and checks login, dashboard, patients, analyze, result, and report with synthetic data only. The hosted-equivalent local run passed 6/6 checks; remote workflow status is pending the final push at this evidence freeze.

43. **Windows CI.** `verify-windows` remains configured on `windows-latest` for npm install, schema/migration, typecheck, path/reparse safety, tests, backup dry-run, model audit, SBOM, filesystem audit, and build. No Windows path safety gate was removed.

44. **Linux CI.** The Ubuntu `verify` job remains configured for install, DB init, typecheck, single-worker tests, migration/backup checks, synthetic validation, model audit, SBOM, inventory, filesystem audit, and build.

45. **Active-data integrity.** `npm run release:data-check` reports active unresolved sources 235, active FK orphans 0, cross-tenant references 0, hash mismatches 0, and `active_data_release_safe=false`. The non-zero status is intentional and prevents an active source-integrity blocker from being hidden.

46. **Legacy-data integrity.** Legacy source findings are 66 and legacy FK references are 5,263, all classified and retained. They are not reachable from active study reasoning/report paths; no legacy row was deleted or silently reassociated.

47. **Future-write invariants.** New document, analysis, and job references require an existing study; cross-tenant links reject atomically; missing active source bytes fail closed. These invariants are covered by focused tests and remain independent of the legacy exception set.

48. **Release-data-check.** The machine-readable result records: `active_unresolved_sources=235`, `legacy_unresolved_sources=66`, `active_fk_orphan_count=0`, `legacy_orphan_count=5263`, `cross_tenant_count=0`, `hash_mismatch_count=0`, `quarantine_count=81`, `status=BLOCKERS_REMAIN`, `phi_included=false`.

49. **PHI scan.** `git ls-files` found zero tracked database/SQLite, PDF/image/OCT, encrypted backup, key, or other sensitive-extension files. Generated SBOM/inventory and test fixtures declare `phi_included=false`; no patient bytes or patient identifiers were printed into this report.

50. **Secret scan.** Count-only scans found zero high-risk token/private-key patterns and no provider credentials, authorization tokens, or encryption keys in tracked files or generated release evidence. Generic policy words in templates/docs are not secrets. Credentials are intentionally omitted from this report.

51. **SBOM.** `npm run sbom` generated CycloneDX 1.5 with 464 components, SHA-256 `df9dff9e2f2148ab0e911832e388b4282359d138df3a10eff69fb3b6a4dde930`, and `phi_included=false`. No model weights, database, backup, or patient binary is in the SBOM.

52. **Release inventory.** `docs/generated/release-inventory.json` is regenerated for `a75bb13` and records Node `v20.20.2`, Python `3.12.10`, SQLite schema/migration `1/1`, three research manifests and hashes, ruleset versions, package-lock/SBOM hashes, verified encrypted backup metadata, reconciliation 235/66, FK state, model cold/warm timing, hosted-browser status, `phi_included=false`, and the prior CI run ID. Final-head CI IDs are added after the push.

53. **Full test totals.** Final model-enabled total: 67 files passed, 1 skipped; 986 tests passed, 10 skipped; exit 0 in 628.23 s. Independent fresh no-model checkout evidence was 66 files passed/1 skipped and 951 tests passed/43 skipped in 199.60 s. Final focused red-team was 9/9 on each of three repetitions; S9 functional and model benchmark gates were green.

54. **TypeScript.** `npx tsc --noEmit --pretty false` passed with exit 0.

55. **ESLint.** `npm run lint` passed with exit 0, including the changed UI/test files.

56. **Build.** `npm run build` passed with Next 16.3.4 webpack, the configured 4 GB Node heap, TypeScript compilation, and 21/21 static routes/pages.

57. **Smoke.** `npm run smoke` passed 16/16, including authenticated upload/analyze/review/delete/RBAC checks and the embedded self-test.

58. **Responsive.** `npm run browser:responsive` passed 80/80 across the configured routes and widths from 320 through 1920 px.

59. **Accessibility.** `npm run browser:a11y` passed 20/20. The EmptyState markup fix also removes the nested paragraph hydration warning without changing clinical content.

60. **Keyboard.** `npm run browser:keyboard` passed 21/21 across login, dashboard, patients, analyze, history, result, report, validation, clinician, and mobile drawer flows.

61. **Asset E2E.** `npm run browser:asset-e2e` passed the synthetic fundus, mixed PDF, OCT ROI, provenance, and research-only routing checks with isolated local storage; no real patient/provider credentials were used.

62. **Red-team.** The repeated S-FINAL suite is 9/9 on all three runs. The wider focused attacks (tenant spoof, requested-by/model override, traversal/UNC/junction, late worker, cancel/retry, wrong-key backup, legacy replay tamper, report supersession, reconciliation abuse, and RBAC) also exited green in their dedicated suites.

63. **Model audit.** `npm run model:audit` passed for three local research manifests. Artifact hashes match their manifests; models are marked `RESEARCH`, and `patient_data_included=false`. Weights remain gitignored and uncommitted.

64. **Dependency audit.** Production dependency audit is clean (`npm audit --omit=dev --audit-level=high` exit 0, zero vulnerabilities). The two moderate development advisories and non-adoption of Vitest 4 remain documented in items 39–41.

65. **Performance.** `npm run performance:local` passed the synthetic no-model path: login page p50/p95 47.9/77.3 ms, login API 83.7/131.4 ms, dashboard 46.5/68 ms, studies 11.9/16.1 ms, upload 39 ms, demo pipeline 315.8 ms, result bundle 16/20.4 ms, result page 43.3/57.3 ms, and report 42.7/96.4 ms. The separate research-worker observation was about 8.5 s cold and about 2.3 s warmed at 1024 px, with roughly 1.3 GB peak RSS. These are engineering timings only, never clinical latency or diagnostic SLOs.

66. **Original blocker A status.** `UNRESOLVED`: 235 active source-artifact dependencies remain unavailable. They are explicit, fail-closed, and not fabricated; release-data-check therefore remains non-green.

67. **Original blocker B status.** `PHASED_MIGRATION_ACTIVE`: active FK orphans are 0 and future writes are constrained, but 5,263 legacy references keep direct FK migration unsafe.

68. **Original blocker C status.** `RESOLVED` for the engineering gate: the final model-enabled full suite exits 0 and the independent 3× cold/warm benchmark completes. The model remains optional research infrastructure and is not clinically validated.

69. **Original blocker D status.** `RESOLVED` for the engineering gate: query/request-authority red-team runs are deterministic across three repetitions with zero timeout and zero mutation bypass. The earlier timeout is retained as historical evidence.

70. **Original blocker E status.** `OPTIONAL_NOT_RELEASE_BLOCKING`: the generic Python bridge is not on the live path, and missing torch/torchvision is reported only by its opt-in readiness probe.

71. **Original blocker F/G status.** `ACCEPTED_DEV_ONLY_LIMITATION`: two moderate Vitest advisories remain disclosed; Vitest 4 is not adopted because of the proven child-runner incompatibility. Production dependencies are unaffected.

72. **Original blocker H status.** `RESOLVED` locally: a real `verify-browser` hosted job exists and the isolated hosted-equivalent smoke is 6/6. The final remote conclusion is only green after the post-push workflow result is observed.

73. **Remaining engineering blockers.** The active release blockers are the 235 unavailable source dependencies and the unsafe direct migration of 5,263 legacy FK references. `npm run release:data-check` intentionally exits non-zero for those active conditions. No functional model-suite or focused red-team failure remains locally.

74. **Remaining model blockers.** Research artifacts remain uncalibrated and unvalidated; there is no prospective clinical cohort, reference-standard performance, subgroup analysis, clinical operating point, or production diagnostic SLO. The benchmark also cannot sample child RSS. These are model/research limitations, not evidence to present a clinical result.

75. **Remaining clinical blockers.** No prospective clinical validation, regulatory assessment, governance approval, deployment-site safety case, or efficacy evidence was established. Human clinician review and independent clinical correlation remain mandatory.

76. **Exact capability boundary.** This software is a local, provenance-preserving research and clinician decision-support workflow with durable jobs, human review, uncertainty, replay checks, encrypted backup/restore, and fail-closed safety controls. It does not establish autonomous diagnosis, clinical efficacy, calibration, or suitability for patient care.

77. **Engineering classification.** `ENGINEERING PARTIAL — BLOCKERS REMAIN` because active source artifacts remain unavailable and direct FK migration is not yet safe, even though the model-enabled full suite and final red-team suite are green.

78. **Clinical classification.**

    `NOT CLINICALLY VALIDATED`

    `NOT A MEDICAL DEVICE`

    `NOT FOR AUTONOMOUS DIAGNOSIS`
