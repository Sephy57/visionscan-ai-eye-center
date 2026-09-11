# Active Data Closure Final Report

This report records the evidence-bound source forensics and legacy-relational
closure run. It is an engineering/data-integrity report, not a clinical
validation report. No active source was relabelled to make a gate pass, no
source bytes were fabricated, and the live application database was not
mutated by the active-source closure run.

## 1. Starting HEAD

`d1d17d6ff451bc5d945976db3d37c6015701eee3` on `main`. The requested runtime
base `5cfe4901ba8ec03d767f9cf908d334b51a3855e0` was an earlier ancestor; the
working tree was inspected and preserved rather than reset.

## 2. Ending HEAD

The implementation tip is `ff52ff69481dc3b4ff71a5bdf7ab57be65f7ab7a`.
This report is maintained in documentation follow-up commits after that
implementation tip; those documentation-only commits do not change the
verified implementation result.

## 3. Branch

`main`.

## 4. Commits

This phase adds the active-source ledger/planner, lifecycle policy, strict
future-link guards, legacy exception controls, and fixture tests. Earlier
runtime/model-hardening commits remain in history; no destructive history
operation was used.

## 5. Push

`ff52ff6` was pushed to `origin/main` after the local matrix and generated
evidence were consistent. No force-push or history rewrite was used.

## 6. Final-head CI

Hosted CI run `34575555760` completed successfully for
`ff52ff69481dc3b4ff71a5bdf7ab57be65f7ab7a`. The required Ubuntu, Windows, and
browser jobs all passed; this is the final observed CI result for the
implementation tip.

## 7. Pre-migration backup

New encrypted backup: `data/backups/pre-migration-20260911135000`.
Manifest SHA-256 is `e16cd47adedd76f6355359da5b16d627eb4e09abeb2b8285373e102e0a6fb7bf`.
The backup used AES-256-GCM with scrypt, 14-day retention and legal hold; the
key was ephemeral and is not recorded. The manifest reports
`credentials_included=false`, 9,891 assets, schema 1, migration 1, and
SQLite integrity `ok`.

## 8. Pre-migration database hash

The verified online-backup snapshot hash is
`c1b253d048cf71e137f9f290143524730a20128a43f077740ec0c2192a5c80ad`. The
live SQLite main-file hash at the evidence snapshot was
`57082a374de09d54923c7a268f5fe37ea21ec6126bb7143fb6d640cfd4eb7222`; the
distinction is recorded because WAL/online-backup layout can change file
bytes without changing logical rows.

## 9. Pre-migration counts

The timestamped snapshot is `docs/generated/pre-migration-20260911135000.json`.
It records 455 studies, 321 patients, 93 analyses, 5,576 documents, 98
reports, 11 jobs, 116 reasoning records, 111 evidence rows, 81 reconciliation
quarantine files, active unresolved sources 235, legacy unresolved sources 66,
active FK orphans 0, legacy FK orphans 5,263, cross-tenant references 0, and
hash mismatches 0. Release status was `BLOCKERS_REMAIN`.

## 10. 235-record forensic methodology

`npm run data:closure:dry-run` reads the SQLite store read-only, enumerates
missing active study originals and detached active analysis parents, traverses
typed and payload references, checks audit history, and searches only
configured application roots. It emits exactly 235 records in
`docs/generated/active-source-forensics.json` and a digest-bound plan in
`docs/generated/data-closure-dry-run.json`.

## 11. Active definition

Active means a current workflow expects an original source, the entity is not
explicitly deleted/archived/retired/superseded, and the source is present and
hash-consistent. A null deletion field or an old row alone is insufficient.
The canonical policy is `docs/ACTIVE_SOURCE_LIFECYCLE.md`.

## 12. Creation-history findings

The ledger matched 1,682 audit events to the 233 missing-study findings; all
233 have at least one successful upload event. There are 208 study-level
delete events, but they do not have a matching modern lifecycle/journal state
for these rows. Individual event hashes are structurally valid, while the
global chain is `BROKEN_BRANCH` (first recorded at
`audit-2026-09-01.ndjson:16`). No route/job provenance was invented.

## 13. Downstream dependency analysis

Across the 235 findings the ledger records 152 document/page references, 38
analysis references (including the two detached parents), 35 report
references, 191 test-result references, and 72 record-extraction references.
No direct clinician-review, model-execution, or evidence-row reference was
found for the missing-source IDs. Three of the dependent historical reports
are clinician-reviewed according to the independent audit pass; their
contents remain immutable.

## 14. Trusted storage search

Only `data/uploads`, `data/documents`, `data/processed`, `data/reports`,
`data/quarantine`, and verified isolated restore asset roots were traversed.
The final run examined 49,588 regular files. Symlinks/reparse paths, traversal
paths, arbitrary personal directories, and unverified locations were not
searched.

## 15. Quarantine search

The 81 reconciliation-quarantine files were hashed and compared in place. No
candidate had both an exact expected digest and provenance-consistent
study/tenant/patient scope. Quarantine contents were never restored or
deleted.

## 16. Backup search

The new encrypted backup was decrypted only by `restore-data.mjs` into an
isolated directory. Its manifest, authenticated payloads, asset hashes, and
SQLite integrity were verified before inspection. The active database was
never overwritten to search the backup.

## 17. Hash-match candidates

There were zero admissible recovery candidates. 67,579 byte-digest matches
were observed across repeated fixture/restore files; every one was rejected
for wrong scope or unsupported provenance. A matching filename, date, or
digest without exact identity and provenance is not recovery evidence.

## 18. Rejected recovery candidates

Wrong-study duplicates, quarantine files without an origin event, derived
assets, and files whose owner scope is absent were all rejected. No
patient/study/tenant relationship was guessed and no derivative was promoted
to an original.

## 19. Successfully recovered sources

Zero. No source file was copied, moved, rewritten, or published.

## 20. Recovery evidence

The ledger records `candidate_recovery_count=0` for all 235 findings. Every
unavailable source has `SOURCE_UNAVAILABLE_FOR_REPLAY`; exact-hash, type,
scope, and provenance requirements remain mandatory for any future recovery.

## 21. Recovery audit

No recovery audit events were written because no recovery occurred. A future
recovery must stage copy-on-write bytes, recheck digest/size/type/scope, obtain
two-person logical review, then append an immutable audit event before atomic
publication.

## 22. Abandoned/incomplete records

No current production finding was proven abandoned. The planner supports an
explicit `ACTIVE_INCOMPLETE_UPLOAD` state only when a persisted uploading,
processing, or failure marker supplies that evidence; the current 233 rows
do not meet that proof threshold.

## 23. Synthetic/test records

Zero active findings carried a persisted synthetic/demo/fixture marker strong
enough for retirement. Synthetic fixtures are covered by isolated tests, not
used to relabel production rows.

## 24. Legacy misclassified records

Zero were reclassified. Historical delete events without a modern lifecycle
binding remain unresolved rather than being called legacy by inference.

## 25. Administrative retirements

Zero. No database row, source file, finalized report, or reasoning record was
retired or deleted. The lifecycle policy defines non-destructive retirement
states and the evidence gates required for a separately authorized workflow.

## 26. Retirement evidence

There is no retirement evidence for the current 235 rows. Retirement requires
known tenant/patient scope, no active finalized/report/reasoning dependency,
no legal hold, and independent review; a lower blocker count is never an
eligibility criterion.

## 27. Permanently unavailable active sources

Zero are labelled permanently lost because the available evidence cannot
prove permanence. The source bytes are unavailable at the checked canonical
paths, and the findings remain release-blocking pending adjudication.

## 28. Unknown/manual-review sources

233 missing study originals are `UNKNOWN_REQUIRES_REVIEW`; two detached
analyses are `DERIVATIVE_WITHOUT_REQUIRED_PARENT`. All 235 have
`allowed_action=KEEP_BLOCKED` (except an exact candidate would require a new
two-person review) and `review_status=UNREVIEWED`.

## 29. Active blockers before

235 active unresolved sources: 233 missing required artifacts and two detached
analysis parents. Active FK orphan count was already zero.

## 30. Active blockers after

235 active unresolved sources remain. The release gate was not weakened and no
active row was relabelled, so the blocker count correctly did not disappear.

## 31. Legacy FK state before

5,263 legacy orphan references: 5,260 documents, two analyses, and one job;
cross-tenant count 0. Direct FK migration was unsafe.

## 32. Legacy exception registry

`scripts/migration/legacy-closure.mjs` defines a canonical
`legacy_relationship_exceptions` registry and a closure-run receipt table. It
stores exact relation/identity hashes, classification, reason, migration
status, review status, backup id, and actor role rather than a hard-coded
allow-list.

## 33. Strict current-data enforcement

Future document, analysis, job, report→analysis, and clinician-review→report
writes now reject missing typed parents and cross-tenant targets before the
transaction commits. Legacy imported rows remain visible to read-only
reconciliation and are not silently normalized.

## 34. FK migration actions

No production FK reassociation was applied. The legacy tool can isolate only
the exact reviewed historical exception metadata; it never changes source
rows/files or invents a parent. The active closure apply plan had no approved
actions.

## 35. FK state after

Active FK orphans remain 0; legacy FK orphans remain 5,263; cross-tenant
references remain 0; `direct_fk_migration_safe=false`. These are the truthful
post-run values.

## 36. Dry-run behavior

`npm run data:closure:dry-run` is read-only and emits the ledger, counts,
trusted-root scan summary, plan digest, and `mutation.performed=false`. The
plan digest is stable for unchanged logical data even though evidence files
carry a generation timestamp.

## 37. Apply behavior

`npm run data:closure:apply` requires a digest-valid plan, exact expected DB
SHA-256, a verified backup id/manifest, `--confirm APPLY_DATA_CLOSURE`, an
independent approval artifact, and `ADMIN`. The current production plan has
zero approved recovery/retirement actions and therefore returns
`NO_ACTIONS_APPLIED` without mutation.

## 38. Idempotency

The active no-op apply is idempotent by construction: repeated execution can
only return the same no-action result after rechecking the hash and review
preconditions. Legacy registry apply uses unique exception hashes and was
tested for repeat no-op behavior.

## 39. Stale-plan rejection

Tampered plan digests, changed database hashes, changed logical content,
wrong backup hashes, and mismatched review artifacts are rejected before any
transaction. Fixture tests cover both active and legacy controls.

## 40. Crash recovery

Legacy registry DDL and rows are in one SQLite transaction; a simulated crash
before commit leaves no registry rows. The active planner itself performs no
write, so it has no partial-source failure mode.

## 41. Rollback

The legacy tool supports an independently reviewed metadata-only rollback that
removes only still-isolated registry rows for the exact plan. It never removes
application source rows/files or finalized report history. Active source
recovery has no rollback because no recovery was applied.

## 42. Security red-team

The final security red-team remained 9/9 PASS on three repeated runs with no
timeouts or mutation bypasses. New fixture tests cover path traversal,
wrong-scope hashes, tampered plans, missing backups, unauthorized roles, and
confirmation failures.

## 43. PHI review

Generated evidence has `phi_included=false`, contains no names, dates of birth,
OCR, clinical narratives, or raw audit detail, and uses hashed tenant/patient
scopes where present. Durable opaque study/entity IDs are retained only to
make each finding auditable.

## 44. Secret review

Backup encryption keys were generated ephemerally, removed from the process
environment after verification, and never written to the ledger/report.
Backup manifests and generated artifacts report `credentials_included=false`.

## 45. Post-migration backup

Because no persistent data mutation was authorized, the post-closure backup is
a verified post-run snapshot rather than a claim that legacy data was fixed:
`data/backups/post-closure-final-20260911071301`. Manifest SHA-256 is
`888e0c01f56c986fa61404e922440327023aee4e477e77cd42c45073a64dd628`.
Its encrypted database payload SHA-256 is
`8df5df3fab5ebf5e242188c700c0eb682156624a27b7e2bba2855eb83ec61237`.
The manifest records 9,894 assets, schema/migration 1/1, SQLite integrity
`ok`, `credentials_included=false`, AES-256-GCM encryption, 14-day retention,
and legal hold.

## 46. Restore result

The post-closure encrypted backup restored successfully to an isolated
directory (`restore-1789110816755-15816`) with authenticated manifest and
asset verification; no active path was overwritten.

## 47. Integrity check

Both pre- and post-closure restores report SQLite `integrity_check: ok`,
schema version 1, and migration version 1. The pre-migration restore contains
9,891 assets; the final post-closure restore contains 9,894 assets because
the local smoke/browser QA generated and cleaned up additional test artifacts.

## 48. Reconciliation after

`npm run reconciliation:adjudicate` completed with run id
`reconciliation-20260911071108`: 310 findings, 235
`MISSING_REQUIRED_ARTIFACT`, 75 `VALID_LEGACY_STATE`, and no quarantine
mutation.

## 49. FK preflight after

`npm run fk:preflight` completed with 5,263 orphan references, zero
cross-tenant references, zero invalid-nullability findings, and
`direct_fk_migration_safe=false`. The output remains PHI-minimizing.

## 50. release:data-check after

The gate intentionally exits 1 with `BLOCKERS_REMAIN`: active unresolved 235,
legacy unresolved 75, active FK orphans 0, legacy FK orphans 5,263,
cross-tenant 0, hash mismatches 0, quarantine 81. Its semantics were not
changed.

## 51. Full test totals

The authoritative model-enabled run passed `69 passed | 1 skipped` test files
and `997 passed | 10 skipped` tests, exit 0, in 560.95 seconds. The focused
closure/future-write/persistence run passed 18/18 tests after the strict-link
change.

## 52. TypeScript

`npx tsc --noEmit` passed after the closure and future-link changes.

## 53. lint

ESLint passed for the new planner, lifecycle tests, migration tool, storage
guard, and updated future-write tests.

## 54. build

`npm run build` passed with the 8,192 MB Node heap setting. Next.js compiled,
type-checked, prerendered 21 static pages, and emitted the full route table in
about 6.7 minutes. No UI or clinical model code was changed in this phase.

## 55. smoke

The local production smoke gate passed 16/16. It requires the explicitly
scoped `ALLOW_INSECURE_LOCAL_AUTH=true` local-only setting; secure defaults
remain unchanged.

## 56. red-team

S-final red-team evidence is 9/9 PASS in three repetitions. Closure-specific
authorization and tamper tests also pass in isolated fixtures.

## 57. responsive

The local responsive browser gate passed 80/80. This data-only phase does not
alter responsive code; hosted CI remains a release gate.

## 58. accessibility

The local accessibility browser gate passed 20/20. No accessibility surface
changed in this phase.

## 59. keyboard

The local keyboard browser gate passed 21/21. No keyboard surface changed in
this phase.

## 60. asset E2E

The local asset-routing E2E gate passed, including fundus/PDF/OCT provenance
checks. Closure tooling treats such assets as derivatives unless exact source
evidence exists.

## 61. model audit

The model-manifest audit passed previously and remains unchanged. No new model,
weight, operating point, or clinical claim was introduced.

## 62. dependency audit

The last production dependency audit reported zero production vulnerabilities.
The closure scripts add no runtime dependency.

## 63. model-enabled suite

The required canonical command is
`npm test -- --pool=forks --no-file-parallelism --maxWorkers=1 --minWorkers=1`.
The final authoritative run passed 69 files (1 skipped), 997 executed tests
(10 skipped), exit 0, in 560.95 seconds. An earlier transient run exposed two
fixture violations of the newly strict report→analysis guard; fixture ordering
was corrected before this passing run.

## 64. Clean checkout

No reset/clean/checkout-destructive command was used. Final release requires a
fresh checkout at the pushed tip with only reproducible generated evidence and
no untracked runtime state.

## 65. Ubuntu CI

The final focused Ubuntu job `103187092213` passed in 2m37s as part of CI run
`34575555760`, including typecheck, unit/integration tests, legacy dry run,
backup plan, model audit, SBOM, filesystem audit, and production build.

## 66. Windows CI

The final focused Windows job `103187092379` passed in 3m24s as part of CI run
`34575555760`, including Windows path/reparse tests, typecheck, unit/integration
tests, legacy dry run, backup plan, model audit, SBOM, filesystem audit, and
production build.

## 67. browser CI

The final focused browser job `103187092375` passed in 1m19s as part of CI run
`34575555760`, including isolated storage, ephemeral account setup, Chromium
install, local server startup, hosted browser smoke, and clean shutdown.

## 68. Independent data-auditor verdict

PASS for integrity conduct: no bytes fabricated, no filename/date-only
recovery, no guessed relationships, no active relabelling, no gate weakening,
and no hidden deletion. Verdict is not a clearance of the 235 blockers; it is
an approval of the evidence-bound handling.

## 69. Remaining active source blockers

235 unresolved active dependencies remain: 233 unknown missing originals and
two detached derivative parents. They are excluded from new reasoning as
verified source evidence and require human adjudication or exact recovery.

## 70. Remaining legacy limitations

75 legacy source limitations remain (41 missing study artifacts and 34 missing
report exports). They are historical and isolated in reconciliation evidence;
the increase reflects local smoke/browser test cleanup residue, not an active
reclassification, and they are not silently promoted to active data.

## 71. Remaining relational limitations

5,263 legacy FK orphans remain and prevent direct global constraint migration.
The exception registry/tooling is ready for separately reviewed isolation, but
no production apply was authorized in this run.

## 72. Remaining model limitations

Models remain research/demo components with documented validation and
operating-condition limits. No source closure action changes model status,
weights, confidence semantics, or clinical interpretation.

## 73. Remaining clinical limitations

Missing-source closure cannot diagnose, exclude disease, infer symptoms, or
provide treatment. Historical reports are not replayable when their original
source is unavailable.

## 74. Exact engineering capability boundary

The repository can now enumerate and audit active source loss, perform
hash/scope/provenance-bound candidate searches, fail closed on unsafe apply,
isolate legacy FK metadata transactionally, enforce strict current writes, and
preserve immutable history. It cannot truthfully reconstruct absent source
bytes or close the remaining blockers without new evidence.

## 75. Engineering classification

`ENGINEERING PARTIAL — BLOCKERS REMAIN`. The persisted state is more truthful
and reproducible, but active source availability and legacy relational
limitations are not resolved.

## 76. Clinical classification

The exact clinical labels remain:

```text
NOT CLINICALLY VALIDATED
NOT A MEDICAL DEVICE
NOT FOR AUTONOMOUS DIAGNOSIS
```

They were not changed by this data-integrity phase.

## Evidence checklist

* [x] New encrypted pre-migration backup and isolated authenticated restore
* [x] All 235 findings individually represented in the canonical ledger
* [x] Exact-hash/scope/provenance recovery only; zero recoveries claimed
* [x] Quarantine and verified-backup searches isolated and non-destructive
* [x] Derivatives excluded as originals; missing sources excluded from new reasoning
* [x] Retirement workflow and tests are evidence-gated; zero production retirements
* [x] Strict future typed links preserved and expanded
* [x] Legacy FK exceptions represented by transactional registry tooling
* [x] Release-data gate remains blocking with original semantics
* [x] Post-closure encrypted backup and isolated restore verified
* [x] Final focused commit `ff52ff6` pushed and hosted CI observation green
