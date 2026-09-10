# VISIONSCAN AI — ZERO-BLOCKER FINAL ENGINEERING RELEASE REPORT

Evidence freeze: 2026-09-10/11 local run, repository `D:\AI EYE ANALYSIS PLATFORM`, branch `main`. The runtime candidate was pushed and its current-head CI run completed successfully. This report is a documentation follow-up; it does not change the clinical claims or add model weights.

1. **Starting HEAD.** `44b93562f4c56bd5dd81554b37efc3eddd912dc3` was the actual HEAD at the start of this final-closure pass. The initial remote tip was `84a93329b9150f67d76f99dce7ef1bb5a769299d`. The working tree was inspected before changes; no destructive Git command was used.

2. **Ending HEAD.** Runtime/evidence-freeze HEAD is `a9b989fd9365eb4336f4fed143f622439cf5faab` (`chore: refresh reconciliation and FK evidence`). The report and refreshed release inventory are documentation follow-ups to that runtime candidate and are listed in item 4.

3. **Branch.** `main`; remote `origin` is `https://github.com/Sephy57/visionscan-ai-eye-center.git`.

4. **Commits.** The final-closure commits were:
   - `4239a43` — close local release validation gates
   - `23ecac0` — add reproducible database and Windows gates
   - `211fb59` — derive default project root from checkout
   - `57e3206` — cover retention expiry and db init status
   - `d78a4a5` — make Python bridge readiness explicitly opt in
   - `b10505f` — make result loading status accessible
   - `f6a9d32` — raise Next heap for local production builds
   - `a9b989f` — refresh reconciliation and FK evidence
   The earlier hardening baseline commits `44b9356` and `8b2bdb3` remain in the same linear history. No user changes were reset or stashed.

5. **Push.** `a9b989f` was pushed successfully to `origin/main` (`84a9332..a9b989f`). The local report/inventory files are a documentation follow-up; the runtime candidate itself is the pushed release evidence.

6. **Final-head CI.** GitHub Actions run `34519366185` executed against `a9b989fd9365eb4336f4fed143f622439cf5faab` and completed with `success`. Ubuntu `verify` completed in 2m29s; Windows `verify-windows` completed in 4m17s. Both jobs passed their configured typecheck, test, migration, audit, SBOM, filesystem, and build gates. No browser CI job is configured (item 31).

7. **Sub-agents.** Galileo (`/root/durable_workers`) completed durable-worker/recovery work; Bacon (`/root/backup_hardening`) completed backup/restore hardening; Lovelace (`/root/scale_pagination`) completed scale/pagination work. The primary agent reviewed and integrated their changes and owned the final classification.

8. **Reconciliation findings before.** The baseline scanner reported 349 aggregate findings: 253 `DB_ROW_WITHOUT_FILE`, 81 `FILE_WITHOUT_DB_ROW`, and 15 `MISSING_REPORT_EXPORT`; hash mismatches, stale ROIs, and duplicates were zero. The original findings were not deleted blindly.

9. **Reconciliation adjudication.** `docs/generated/reconciliation-adjudication.json` contains a deterministic PHI-minimizing record for every final adjudicated finding with `finding_id`, type/entity identifiers, path/hash where available, patient/tenant scope, reason, classification, repair action, reviewer, timestamp, and result. The final read-only output has 290 records: 235 `DB_ROW_WITHOUT_FILE` classified `MISSING_REQUIRED_ARTIFACT` with result `SOURCE_ARTIFACT_UNAVAILABLE`, 30 legacy DB rows classified `VALID_LEGACY_STATE`, and 25 missing exports classified `VALID_LEGACY_STATE`. The earlier apply run also recorded 81 quarantined orphan files; scanner and adjudicator counts differ because they use different finding granularity and because those files were removed from the active upload tree by quarantine.

10. **Automatic repairs.** Only the safe orphan-file action was applied: 81 unreferenced files were moved to `data/quarantine/reconciliation/<runId>` after `lstat`, reparse-point, allowed-root, and hash/path checks. No source upload, immutable document, clinician-authored content, or clinical evidence was fabricated, imported, or deleted. No report reasoning was rewritten.

11. **Manual-review findings.** The 235 `MISSING_REQUIRED_ARTIFACT` records require operator/source recovery or explicit clinical-record adjudication; the source bytes are unavailable and the repair action is `mark_unavailable`. They remain blocked rather than being reconstructed. The 55 `VALID_LEGACY_STATE` records are documented expected legacy state, not silently attached to new patient data.

12. **Reconciliation findings after.** The post-quarantine read-only scan is stable at 290 explicit records (235 missing required artifacts and 55 documented legacy states), with no remaining unreferenced upload files in the active tree, no hash mismatch, no stale ROI, and no duplicate finding. Because 235 source artifacts remain unavailable, the unresolved-blocking count is 235; reconciliation is not release-green.

13. **FK preflight.** `npm run fk:preflight` passed and generated `docs/generated/fk-preflight.json`. It evaluated the 11 requested typed relations. Results: `orphan_references: 5263`, `cross_tenant_references: 0`, `invalid_nullability: 0`, `legacy_exceptions: 367`, `direct_fk_migration_safe: false`. The largest orphan set is 5,260 `documents.study_id -> studies`; the remainder is 2 analyses and 1 job reference. Constraints were not enabled against an unsafe legacy dataset.

14. **Direct FK changes.** Typed relational metadata and application-level reference validation are active, including tenant checks and transactional persistence links. Direct database FK constraints were deliberately not added to the existing domain tables because preflight proves the current data cannot migrate safely; no giant payload normalization or global foreign-key disable was introduced.

15. **Cross-tenant FK tests.** Six atomic rejection cases passed: study A to patient B, document A to study B, analysis A to study B, report A to analysis B, job A to study B, and review A to report B. Each rejected the write and left no partial cross-tenant row.

16. **Verified encrypted backup.** A real backup exists at `D:\AI EYE ANALYSIS PLATFORM\data\backups\backup-release-20260910143502`. It is AES-256-GCM encrypted, authenticated, and marked `VERIFIED_BACKUP_AVAILABLE` after isolated restore and integrity verification. The encryption key is intentionally not recorded here or in repository artifacts.

17. **Backup manifest.** Manifest evidence: created `2026-09-10T06:35:03.380Z`; source commit `44b93562f4c56bd5dd81554b37efc3eddd912dc3`; SQLite `eye-ai.db`; `snapshot_method: sqlite_online_backup`; schema `1`; migration `1`; integrity check `ok`; 9,968 assets; AES-256-GCM with scrypt parameters `N=16384,r=8,p=1,key_length=32`; SHA-256 manifest HMAC; retention 14 days; `legal_hold: true`; archive state `ARCHIVED`; automatic deletion disabled and operator action required; model weights and credentials excluded.

18. **Restore result.** The encrypted backup was restored into isolated `D:\AI EYE ANALYSIS PLATFORM\data\restores\restore-1789022260211-23264`, never over the active data directory. The restored database opened successfully and passed `integrity_check`. Direct comparison at verification recorded active/restored counts: patients 321/321, studies 449/443, documents 5,575/5,574, analyses 87/81, reports 91/84, jobs 10/9, reasoning records 109/102; both active and restored integrity status were `ok`. The count differences reflect the online snapshot boundary and were not treated as corruption; hashes and report/reasoning provenance checks passed.

19. **Wrong-key result.** A wrong key failed authenticated decryption with exit code 1, produced no plaintext restore, left no partial restore, and did not alter the active database. Tampered-manifest/authentication tests also failed closed.

20. **Backup-during-write.** A targeted test held an active `BEGIN IMMEDIATE` transaction while inserting 1,000 rows and created an online SQLite backup. The snapshot restored with valid integrity and contained either the pre-transaction state or the complete committed state (0 or 1,000 rows), never a torn intermediate. The same bounded behavior was exercised during an inference-like active operation; login/navigation were not held indefinitely.

21. **Windows junction tests.** Actual Windows tests in `tests/windows-path-redteam.test.ts` passed 2/2, including junction/reparse and symlink-style escape attempts. Combined with `tests/safety.test.ts`, 27/27 Windows path/safety tests passed. The checks cover uploads, derived assets, models, backup/restore, migration, and report-export roots.

22. **UNC policy.** Untrusted UNC/network roots are rejected by policy for local research deployment. Drive-qualified, drive-relative, UNC, extended `\\?\`, NUL, traversal, and mixed-separator variants fail closed unless an explicitly trusted configured root is used.

23. **Path canonicalization.** `safeJoin` rejects absolute/UNC/extended/drive-relative inputs, canonicalizes the candidate, verifies it remains under the configured root, and rechecks symlink/reparse metadata before critical open/write. Recursive reconciliation uses `lstat` and refuses reparse directories/files to reduce TOCTOU escape risk.

24. **Full current test count.** The authoritative fresh no-model checkout run at `D:\visionscan-clean-20260911-final` discovered 67 files and completed `66 passed | 1 skipped`; 994 test cases completed `951 passed | 43 skipped`, exit 0, in 199.60s. The canonical model-enabled main-worktree run also discovered 67 files but ended `65 passed | 1 skipped | 1 failed` and `983 passed | 10 skipped | 1 failed`, exit 1, after 1,149.90s because the real CPU inference test timed out. Therefore the current model-enabled suite is not green.

25. **Open-handle status.** The orphaned `npm run dev:worker` watcher (PIDs 13084/27096/28776 plus descendants), started about 10 hours earlier with its parent gone, was terminated as an exact process tree. A final check found no VisionScan Vitest/build/server process, no port-3000 listener, no database lock/WAL/SHM residue, and no stale lease. Port 3001 belonged to an unrelated InsightFlow process and was left untouched.

26. **Clean checkout.** The independent checkout `D:\visionscan-clean-20260911-final` was created from `a9b989f` without reusing `node_modules`, database, models, `.env`, or generated reports. `npm ci`, database init, migration preflight, test, typecheck, lint, build, filesystem audit, model audit, and SBOM all exited 0. Earlier `C:\Temp` retries encountered a Windows esbuild sharing violation; the D: checkout is the reproducible authoritative run.

27. **Clean checkout without models.** With no gitignored research artifacts, the clean checkout built and tested successfully and returned explicit model-unavailable behavior where model execution was requested. It did not substitute fake clinical output.

28. **Clean checkout with research models.** Only three locally installed, hash-verified research model directories were copied into the clean checkout. The fundus-lesion, DR-grade, and OCT research tests passed 60/60 with 12 expected skips; `npm run model:audit` found three manifests, `patient_data_included: false`, status `PASS`. Weights were not committed.

29. **Windows CI.** `.github/workflows/ci.yml` now includes `verify-windows` on `windows-latest` with npm install, DB init, typecheck, path/reparse tests, full unit/integration tests, migration dry-run, backup dry-run, model audit, SBOM, filesystem audit, and build. Run `34519366185` passed this job in 4m17s.

30. **Linux CI.** The existing Ubuntu `verify` job was preserved and passed run `34519366185` in 2m29s, including its configured tests, migration, backup, benchmark, validation, audit, SBOM, inventory, filesystem, and build gates.

31. **Browser CI.** No hosted browser job was added. Local Chrome gates are recorded separately: visual structure passed, responsive 80/80, accessibility 20/20, keyboard 21/21, and asset E2E passed. This is a documented CI coverage boundary, not a claim of browser CI.

32. **Vitest upgrade experiment.** In isolated `C:\Users\pc\AppData\Local\Temp\visionscan-vitest-upgrade-20260910-v1`, Vitest 4.1.11 installed without changing `package.json` or the lockfile. The compatible full command (`--pool=forks --maxWorkers=1`) ended with 65 files passed, 1 skipped, 1 failed; 950 tests passed and 43 skipped, with `tests/job-lease-recovery.test.ts` failing its child-process exit-code assertion. The old `--minWorkers` option is removed in Vitest 4. TypeScript, lint, and build passed. Main remains on Vitest 3.2.6.

33. **Dependency audit.** The dev-only advisory `GHSA-82fw-gwwq-j7x9` remains in `@vitest/mocker`; full audit reports two moderate development advisories. `npm audit --omit=dev --audit-level=high` exits 0 with zero production vulnerabilities. `npm audit fix --force` was not used. The advisory is limited to developer/test tooling and is absent from the production dependency path, but remains documented.

34. **Retention tests.** Retention tests passed, including `legal_hold=true`, archived backup, expired backup, deletion eligibility, and operator-action-only deletion. No automatic patient-data deletion occurs.

35. **Job restart recovery.** `tests/job-lease-recovery.test.ts` performs a real child-process crash/restart simulation. The reaper recovered the expired lease within retry policy, and no duplicate final result, report, or ledger was created.

36. **Late-worker protection.** A stale worker returning after worker B acquired a new attempt was fenced by attempt/lease compare-and-swap and could not finalize or overwrite the winning result.

37. **Cancel/reaper behavior.** Cancelling a stale running job persisted cancellation intent; the reaper respected it and did not schedule a retry after cancellation.

38. **Concurrent retry.** Concurrent requests with the same idempotency key produced exactly one new attempt/result; other callers observed the existing durable attempt rather than duplicating work.

39. **Legacy replay.** Legacy replay tests passed with immutable source identifiers, source-byte/hash checks, reasoning snapshots, and clinician-review boundaries. Replay is admin-only and fail-closed.

40. **Report supersession.** Supersession tests passed: old report remains immutable, a new report is created, `latest_report_id` advances, `supersedes_report_id` points to the old report, and source legacy ID/history are preserved.

41. **Changed-source replay rejection.** Altering the source asset/hash returns `LEGACY_REPLAY_NOT_POSSIBLE`; no forced replay or silent source substitution occurs.

42. **Large pagination browser test.** The 100-patient/500-study synthetic scale path and keyset pagination tests passed with stable cursors, bounded pages, filters, and no duplicate/missing rows. Local browser responsive/keyboard checks passed across the relevant history, validation, and admin routes. A separate hosted browser CI job and a 1,000-audit-event browser seed were not added, so this gate is local-only.

43. **Validation dashboard scale.** Aggregate validation/dashboard paths use bounded counts and pagination rather than loading raw evidence or thousands of records. The 100-patient/500-study stress run passed and declared synthetic/PHI-free metrics; no raw patient evidence is included in dashboard aggregates.

44. **Admin RBAC.** Smoke/security gates passed: unauthenticated and non-admin maintenance/reconciliation/backup/recovery/replay requests were denied; admin requests were allowed. The local smoke run was 16/16, including upload, analysis, review, deletion, and access-control checks.

45. **Health endpoint review.** Local liveness/readiness returned 200. Readiness checks schema/migration, SQLite foreign keys/WAL/busy timeout, registered research models, and consistency without exposing filesystem paths, patient counts, credentials, model secrets, or database keys. Expensive full integrity checks remain an admin/maintenance action.

46. **PHI scan.** Tracked-file and release scans found zero tracked patient bytes, SQLite databases, backups, uploaded PDFs/images/OCT data, OCR output, encryption keys, or tokens. SBOM, inventory, stress fixtures, and audit metadata declare `phi_included: false`; local runtime data remains outside Git.

47. **Model artifact scan.** `npm run model:audit` passed. The three research manifests are external/gitignored, hash-verified, marked `RESEARCH`, and contain no patient data. `git ls-files` reported zero tracked data files and zero tracked sensitive extensions.

48. **SBOM.** `docs/generated/SBOM.cdx.json` is a CycloneDX 1.5 SBOM with 464 components, `visionscan:phi-included=false`, no database/backup/model binaries, and a recorded SHA-256 in the release inventory. Generation passed locally and in CI.

49. **Release inventory.** `docs/generated/release-inventory.json` records source commit `a9b989fd9365eb4336f4fed143f622439cf5faab`, branch `main`, Node `v20.20.2`, Python `3.12.10`, SQLite schema/migration `1/1`, model IDs/versions/hashes, ruleset versions, SBOM hash, `VERIFIED_BACKUP_AVAILABLE`, reconciliation status `ADJUDICATED_BLOCKERS_REMAIN` with 235 unresolved blocking findings, `phi_included:false`, and CI run ID `34519366185`.

50. **Performance.** `npm run performance:local` passed on the CPU-only synthetic path. Login page p50/p95 was 43.7/73.2 ms (max 105.3 ms); login API 89.2/165.5 ms; dashboard 42.1/54.1 ms; study listing 10.0/14.4 ms; upload 37.6 ms; full demo imaging pipeline 280.3 ms; result bundle 14.1/17.1 ms; result page 41.8/55.3 ms; report page 38.7/45.0 ms. ClementP cold worker was 7,422.8 ms, warmed forward about 2.3 s at 1,024 px, peak RSS about 1.3 GB, serialized by a provider mutex. These are local engineering measurements, not clinical or production SLOs.

51. **Security red-team.** Tenant mismatch, typed-reference/FK bypass, reconciliation quarantine abuse, backup/restore traversal, wrong key, tamper, UNC/junction escape, late worker, stale lease, retry replay, cancellation race, legacy replay spoof, supersession spoof, and admin RBAC tests passed in their focused suites. A targeted four-file red-team run recorded 18 passes and one timeout in the GET query-spoof scenario (`tests/s-final-redteam.test.ts`, 30s); this intermittent/reproducible lag is retained as a blocker rather than reported green.

52. **Test totals.** Across the release matrix: clean no-model checkout 951 passed/43 skipped; model-enabled canonical full run 983 passed/10 skipped/1 failed; model-enabled isolated S9 first-inference run passed once at 111.8s but the deterministic repeat timed out at 120s; focused backup/FK/recovery suite 24/24 passed; Windows path suite 27/27 passed; research-model suite 60/60 passed with 12 skips; browser responsive 80/80, accessibility 20/20, keyboard 21/21, and smoke 16/16 passed. The aggregate release is not green because the canonical model run and red-team timeout failed.

53. **TypeScript.** `npx tsc --noEmit --pretty false` passed with exit 0 in the main tree and clean checkout.

54. **ESLint.** `npm run lint` passed with exit 0; focused changed-file lint also passed.

55. **Build.** `npm run build` passed with Next 16.3.4 webpack, the configured 4 GB Node heap, TypeScript compilation, and 21/21 static pages/routes. The earlier 2 GB local heap failure was fixed in the build script; CI build passed on Ubuntu and Windows.

56. **Smoke.** `npm run smoke` passed 16/16, including embedded self-test 15/15 and the authenticated upload/analyze/review/delete/RBAC flow.

57. **Responsive QA.** `npm run browser:responsive` passed 80/80 over widths 320, 375, 414, 768, 1024, 1280, 1440, and 1920 across 10 routes.

58. **Accessibility.** `npm run browser:a11y` passed 20/20 at 320 px and 1280 px after adding an explicit status role/label to the result loading skeleton.

59. **Keyboard QA.** `npm run browser:keyboard` passed 21/21 across login, dashboard, patients, analyze, history, result, report, validation, clinician, and mobile drawer flows.

60. **Asset E2E.** `npm run browser:asset-e2e` passed with ephemeral local smoke environment variables: metadata-free fundus upload, research analysis, mixed PDF extraction, OCT ROIs, and report provenance. Credentials were not persisted in code, logs, inventory, or this report.

61. **npm audit.** Unfiltered audit output contains the two moderate dev-only Vitest advisories. The high-severity threshold command exits 0, and `npm audit --omit=dev --audit-level=high` exits 0 with zero production vulnerabilities. The moderate dev advisory remains an explicit dependency blocker.

62. **Remaining engineering blockers.** (a) 235 source-artifact-unavailable reconciliation records; (b) 5,263 FK orphan references make direct migration unsafe; (c) canonical model-enabled full suite has a reproducible S9 CPU deterministic timeout; (d) targeted security red-team query-spoof scenario timed out; (e) opt-in Python bridge lacks `torch`/`torchvision`; (f) two moderate dev-only Vitest advisories; (g) Vitest 4 experiment is not compatible; (h) no hosted browser CI job; and (i) a documentation-only follow-up is needed if inventory/report hashes must be recomputed after this file is committed.

63. **Remaining model blockers.** The three providers are research-only and uncalibrated. There is no frozen operating point, external validation cohort, prospective monitoring plan, subgroup/error analysis, or production SLO for the CPU-heavy ClementP path. The local Python bridge cannot be considered ready without the missing `torch` and `torchvision` packages. Outputs remain clinician-review prompts.

64. **Remaining clinical blockers.** No prospective clinical validation, reference-standard adjudication, clinical governance approval, regulatory assessment, deployment-site safety case, or clinical efficacy evidence was established by this engineering run.

65. **Exact engineering capability boundary.** This release supports a local, provenance-preserving research/clinician decision-support workflow with durable jobs, human review, uncertainty, replay checks, encrypted backup/restore, and fail-closed safety controls. It does not establish autonomous diagnosis, clinical efficacy, calibration, or suitability for patient care.

66. **Engineering classification.** `ENGINEERING PARTIAL — BLOCKERS REMAIN`.

67. **Clinical classification.**

   `NOT CLINICALLY VALIDATED`

   `NOT A MEDICAL DEVICE`

   `NOT FOR AUTONOMOUS DIAGNOSIS`

