# VISIONSCAN AI — FINAL PRODUCTION HARDENING REPORT

1. **Starting HEAD.** The hardening pass started from `84a93329b9150f67d76f99dce7ef1bb5a769299d` (`docs: record transactional data release gates`).

2. **Ending HEAD.** The runtime implementation release candidate is `8b2bdb31219ac499cfcb256cd34db4746dbdd05f` (`feat: complete production hardening workflow`). A documentation/inventory follow-up commit is intentionally made after this report is authored; no runtime claim depends on that follow-up.

3. **Commits and scope.** The implementation commit contains the durable queue, relational persistence, replay/supersession, reconciliation, backup/restore, scale/pagination, admin/health, stress tooling, and the associated tests and documentation. No destructive Git operation was used, and unrelated user changes were not reset.

4. **Push status.** Nothing was pushed to the remote. The master prompt requires a push only after final-head CI is green, and that gate has not been proven for the current HEAD.

5. **Final CI status.** The repository CI workflow is present, but a fresh run against `8b2bdb3` was not executed. Therefore this report does not claim final-head CI green. Local gates below are evidence from this worktree only.

6. **Delegated work.** The durable-worker, backup-hardening, and scale/pagination subtasks were completed by the delegated workers Galileo (`/root/durable_workers`), Bacon (`/root/backup_hardening`), and Lovelace (`/root/scale_pagination`); the primary agent integrated and verified the combined work.

7. **Durable job architecture.** Jobs now persist lifecycle state, attempt identity, worker identity, claim version, idempotency key, retry policy/ledger, cancellation intent, and lease timestamps in SQLite rather than relying on process memory.

8. **Lease design.** Claiming is atomic and versioned. A worker receives an `attempt_id` and `worker_id`; compare-and-swap checks prevent stale workers from overwriting a newer claim.

9. **Heartbeat.** Heartbeat updates are lease/version guarded and extend `lease_expires_at` only for the active attempt. A missing or mismatched attempt fails closed.

10. **Reaper.** A bounded reaper identifies expired leases, marks the attempt recoverable, and makes the job eligible for a new attempt without duplicating a sealed result.

11. **Crash recovery.** Startup recovery and stale-lease recovery are covered by `tests/job-lease-recovery.test.ts`; abandoned attempts are recorded and retried only within the configured retry policy.

12. **Exactly-once finalization.** Finalizers use durable state plus compare-and-swap/idempotency checks. A late worker cannot publish a second final result after a winning attempt has sealed the job.

13. **Relational constraints.** Collection rows now carry additive relational metadata and a `persistence_entities`/`persistence_links` registry provides foreign keys for typed links. Existing tables are upgraded additively at initialization. Full direct row-level foreign keys for every domain table are still a partial follow-up, so this is not claimed as complete relational normalization.

14. **Cross-tenant constraints.** Transactional writes extract typed references and reject tenant mismatches before commit. Tests cover cross-tenant patient/study/document/report link attempts and ensure the transaction does not partially persist.

15. **Legacy replay.** `lib/reports/replay.ts` and the admin-only replay route verify the legacy source report, immutable source bytes, document hashes, and required reasoning inputs before deterministic replay.

16. **Report supersession.** When sealed inputs differ, the service creates a new report version with `supersedes_report_id`, preserves the prior immutable report, and updates the study's `latest_report_id` pointer.

17. **Replay eligibility.** Missing, changed, ambiguous, or unverifiable legacy inputs fail closed with `LEGACY_REPLAY_NOT_POSSIBLE`; replay never fabricates a diagnosis or silently reuses changed source material.

18. **File/DB journal.** Multi-resource writes record `PREPARED`, `DB_COMMITTED`, `FILES_COMMITTED`, `COMPLETE`, or `FAILED_RECONCILIATION` in `reconciliation_journal`, enabling startup detection of incomplete work.

19. **Orphan scanner.** The read-only reconciliation endpoint scans database rows and files for missing counterparts, hashes, stale derived ROIs, missing report exports, and duplicate immutable assets. The live scan completed in about 0.9 seconds and reported 349 findings: 253 `DB_ROW_WITHOUT_FILE`, 81 `FILE_WITHOUT_DB_ROW`, and 15 `MISSING_REPORT_EXPORT`; hash, stale-ROI, and duplicate counts were zero.

20. **Repair policy.** Repair is explicit and review-gated. The current repair path audits and returns `REVIEW_REQUIRED`; it does not guess, delete, or mutate evidence automatically. The 349 live findings therefore remain an engineering blocker until adjudicated.

21. **50k benchmark.** `npm run benchmark:persistence -- --records=1000,10000,50000` passed. At 50,000 synthetic rows (12,500 studies, 7,500 documents, 7,500 analyses, 5,000 reports, 2,000 jobs, and the remaining configured collections), SQLite insert was 1,268.36 ms, 1,000 lookups 3.37 ms, 100-page keyset pagination 37.75 ms, dashboard aggregate 9.43 ms, patient workspace 0.14 ms, archive 1.55 ms, cleanup 42.38 ms, and the comparable JSON rewrite 115.5 ms.

22. **100-patient/500-study stress.** `npm run stress:workspace` passed with 100 patients and 500 studies. Integrity was `ok`; counts were 100 patients, 500 studies, 478 documents, 500 analyses, 500 jobs, 500 reports, 250 reviews, and 500 model-validation errors. Create/upload metadata took 93.77 ms, lookup 2.49 ms, pagination 0.11 ms, dashboard 32.14 ms, workspace 0.11 ms, lifecycle/retry/cancel/report/review flow 79.86 ms, validation writes 0.14 ms, and cleanup 6.85 ms.

23. **Pagination.** Studies, patients, reports, jobs, validation errors, and audit feeds use bounded keyset cursors over `(created_at, id)` with a maximum page size of 100 and a scan guard; cursors are opaque to the UI.

24. **Large-data UI.** History, patients, validation, and admin audit views expose load-more behavior and retain filters while fetching the next cursor. The UI does not request an unbounded collection.

25. **Backup encryption.** Backups support AES-256-GCM content encryption with authenticated manifests and atomic staged output. Plaintext backup is not silently substituted when encryption is requested.

26. **Key handling.** Keys can come from an environment variable, `--key-env`, or `--key-stdin`; key material is not written to the manifest or report. Missing keys, wrong keys, tampered manifests, and authentication failures fail closed. An OS key-store integration is not present.

27. **Retention.** Backup metadata carries `retention_days`, `legal_hold`, `archive_state`, and `deletion_eligible_at`. Automatic deletion is disabled; retention deletion remains an explicit operator action.

28. **Restore tests.** Backup/restore tests cover encrypted round-trip, wrong key, tampered manifest, missing asset, partial restore, traversal, and atomic staging. The live workspace has no verified usable `backup-*` manifest (only migration directories), so current admin backup status is truthfully `missing`.

29. **Corruption matrix.** `tests/corruption-fault-matrix.test.ts` passes all 4 cases for database-page corruption, truncation, tampered WAL sidecar, and path variants. Existing asset, ROI, report, reasoning, model, backup, and audit integrity tests also pass; no claim is made that every OS/filesystem failure mode has been exercised.

30. **Path traversal and reparse protection.** Safe-join checks cover mixed separators, encoded traversal, backup paths, and symbolic-link/reparse-point manifests. Windows junction/UNC-specific adversarial testing was not independently drilled and remains a follow-up risk.

31. **Database locking.** SQLite is configured with WAL, `foreign_keys=ON`, `synchronous=NORMAL`, and a 5,000 ms busy timeout. The standalone competing-writer test passed (1/1; bounded `SQLITE_BUSY` behavior, about 250 ms). Backup-during-write contention was not separately stress-tested.

32. **Database maintenance.** `/api/admin/maintenance` reports `integrity_check`, WAL checkpoint results, database/WAL/SHM byte sizes, and per-collection counts. The live response was `integrity_check: ok`, backend `sqlite`, with a successful checkpoint (`busy: 0`).

33. **Health/readiness.** `/api/health/live` and `/api/health/ready` return 200 locally. Readiness confirms SQLite schema/migration `1/1`, foreign keys enabled, WAL mode, busy timeout 5,000 ms, four registered research models, and no consistency failures; inference is intentionally `not_checked`.

34. **Admin operations.** Admin metrics and the operations page expose job totals/stale leases/failures, reconciliation errors, backup age/availability, schema/migration state, validation-error counts, database maintenance, and audit pagination. Metrics explicitly report `phi_included: false`.

35. **Security review.** Fail-closed checks cover authentication boundaries, tenant mismatches, replay provenance, backup authentication, traversal, symlink manifests, immutable report versions, and admin-only replay/maintenance routes. This is an application-level review, not an independent penetration test or formal threat-model sign-off.

36. **PHI review.** Release inventory, SBOM, admin metrics, and synthetic stress/benchmark fixtures declare no patient data (`phi_included: false`/synthetic-only). Production PHI deployment, encryption-at-rest policy, access review, retention approval, and audit-team sign-off remain outside this local engineering run.

37. **Clean-checkout reproducibility.** A fresh clean-checkout `npm ci` plus the complete gate sequence was not independently run. Reproducibility is therefore an explicit release blocker even though the current worktree typechecks, lints, builds, and tests.

38. **CI matrix.** `.github/workflows/ci.yml` runs Ubuntu `npm ci`, TypeScript, single-worker Vitest, migration/backup dry-runs, 1k/10k benchmark, validation/model audits, SBOM, inventory, filesystem audit, and build. It does not currently prove Windows, browser, smoke, local performance, or full audit gates, and no current-HEAD run is recorded.

39. **Vitest advisory.** `npm audit --omit=dev` is clean. Full `npm audit` exits 1 because `@vitest/mocker` 2.1.0–4.1.10 has two moderate dev-only advisories (`GHSA-82fw-gwwq-j7x9`); `npm audit fix --force` would install a breaking Vitest major and was not used.

40. **Accessibility.** Browser accessibility checks passed 20/20 at 320 px and 1280 px, and keyboard navigation passed 21/21 across login, dashboard, patients, analyze, history, result, report, validation, clinician, and the mobile drawer. Manual screen-reader/browser-dialog verification remains outstanding.

41. **Performance and lag evidence.** `npm run performance:local` completed on the local CPU-only synthetic path: login page p50/p95 4.3/5.4 ms, login API 51.8/57.4 ms, dashboard 3.6/4.2 ms, study listing 3.8/4.6 ms, upload 35.9 ms, full demo pipeline 263.5 ms, result bundle 5.4/6.1 ms, result page 3.5/4.7 ms, and report page 3.2/4.0 ms. The ClementP worker was about 7,329 ms cold and about 2.3 s warmed at 1,024 px, peaked near 1.3 GB RSS, and is serialized by a provider mutex; it is not an SLO or clinical-performance claim.

42. **Test totals.** The completed single-worker full run reported 65 files, 977 passed, and 2 skipped (979 total), exit 0, in about 8m36s. It ran before `tests/database-locking.test.ts` was added. A subsequent targeted run of the locking and corruption files reported 2 files and 5/5 passed in 1.32s. The repository now contains 66 test files; an aggregate 66-file rerun was not performed.

43. **TypeScript.** `npm exec tsc -- --noEmit --pretty false` passed with exit 0 after the final hardening edits.

44. **ESLint.** `npm run lint` passed with exit 0 and no errors or warnings.

45. **Production build.** `npm run build` passed with Next 16.3.4 webpack, 21/21 static pages, and the admin, health, jobs, reports, and replay routes included.

46. **Smoke tests.** `npm run smoke` passed 16/16; the embedded self-test passed 15/15, including upload/analyze/review, deletion lifecycle, and access-control checks.

47. **Browser E2E and visual gates.** Visual structure passed, responsive checks passed 80/80 across 320–1920 px, accessibility passed 20/20, keyboard checks passed 21/21, and the asset workflow passed for metadata-free fundus, research-only fundus models, mixed PDF extraction, OCT/lab routing, and report provenance. These are local Chrome gates, not a hosted deployment certification.

48. **Dependency/filesystem/model audits.** `npm audit --omit=dev`, `npm run audit:fs`, `npm run model:audit`, `npm run migration:preflight`, and `npm run sbom` passed. The SBOM is CycloneDX 1.5 with 464 components and `phi=false`; all three installed model manifests are marked `research_only`.

49. **Remaining engineering blockers.** Current reconciliation findings (349), absent verified production backup, incomplete direct row-level FK normalization, no clean-checkout proof, no current-head CI run, missing Windows/junction/UNC and backup-during-write coverage, and the full-audit dev advisory prevent an engineering-complete release classification.

50. **Remaining model blockers.** Installed fundus/OCT providers are research-only and uncalibrated. There is no frozen operating point, external validation set, subgroup/error analysis, prospective monitoring plan, or production SLO for the CPU-heavy ClementP path; outputs must remain clinician-review prompts.

51. **Remaining clinical blockers.** No prospective clinical validation, reference-standard adjudication, clinical governance approval, regulatory assessment, or deployment-site safety case was established by this local run.

52. **Capability boundary.** The system is a local research/clinician decision-support workflow that preserves provenance, uncertainty, replayability, and human review. It must not be represented as autonomous diagnosis, a substitute for an ophthalmologist, or evidence of clinical efficacy.

53. **Engineering classification.** `ENGINEERING PARTIAL — BLOCKERS REMAIN`.

54. **Clinical classification.** `NOT CLINICALLY VALIDATED`  
`NOT A MEDICAL DEVICE`  
`NOT FOR AUTONOMOUS DIAGNOSIS`

