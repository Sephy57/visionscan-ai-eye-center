# Active-data closure and legacy FK migration controls

This document records the bounded migration control added for the VisionScan
SQLite workspace. It does not authorize a production apply and contains no
patient text, names, or credentials.

## Scope and non-goals

The current FK evidence is 5,263 unresolved historical references:

| Relation | Count | Current classification |
| --- | ---: | --- |
| `documents.study_id -> studies` | 5,260 | `LEGACY_DETACHED_DOCUMENT` |
| `analyses.study_id -> studies` | 2 | `LEGACY_DETACHED_ANALYSIS` |
| `jobs.study_id -> studies` | 1 | `LEGACY_DETACHED_JOB` |

The closure tool does not guess a parent, alter a child payload, publish a
source file, delete a record, or change release-gate semantics. Its only
permitted apply action is to register the exact currently observed legacy
relationship as an isolated exception. Active unresolved references are
refused by apply and remain release blockers.

## Read-only plan

Run against an isolated restore or a quiesced local database:

```text
node scripts/migration/legacy-closure.mjs --dry-run \
  --database <database.db> --output <closure-plan.json>
```

The active-source read-only track is available as `npm run data:closure:dry-run`
and writes the PHI-minimizing 235-record ledger plus an active closure plan.
The legacy relationship operation is available as `npm run
data:legacy-closure:dry-run -- --database <database.db> --output <closure-plan.json>`.

The plan contains opaque child/parent scope hashes, exact exception hashes,
classifications, and aggregate counts. It excludes raw payloads and IDs from
the generated plan. The plan binds to:

* a SHA-256 hash of the SQLite file;
* a logical SHA-256 hash of all application rows, excluding only the closure
  registry tables; and
* schema and migration versions plus an `integrity_check` result.

The logical hash is needed for idempotency: applying a legacy plan adds
registry metadata and therefore changes SQLite file bytes. Any unrelated data
write changes the logical hash and invalidates the plan.

## Preconditions for apply

Apply is intentionally administrative and fail-closed:

```text
node scripts/migration/legacy-closure.mjs --apply \
  --database <database.db> \
  --plan <closure-plan.json> \
  --expected-db-sha256 <plan.database.sha256> \
  --backup-manifest <verified-backup>/manifest.json \
  --review-artifact <independent-review.json> \
  --actor-role ADMIN \
  --confirm APPLY_LEGACY_CLOSURE
```

`npm run data:legacy-closure:apply -- ...` is the equivalent npm wrapper. It still
requires every argument above; the wrapper does not supply credentials,
backup identity, review approval, or confirmation implicitly.

The backup manifest must identify the same database hash and an `ok`
integrity result. If it includes an encrypted or plaintext database payload,
the payload hash is checked as well. The review artifact must be an
`visionscan-legacy-closure-review-v1` approval for the exact plan and must
explicitly state that no bytes were fabricated, no relationships were
guessed, no active records were relabelled, and the release gate was not
weakened. It must also bind the pre/post reports, plan, and test evidence by
at least three SHA-256 evidence digests.

The transaction creates:

* `legacy_relationship_exceptions`: one immutable identity row per observed
  relation, with classification, reason codes, `ISOLATED` migration status,
  independent-review status, plan digest, backup ID, and role; and
* `legacy_relationship_closure_runs`: one receipt per plan digest, including
  the pre-apply hashes and review-artifact hash.

No application source row or file is changed. The exception registry is not a
parent table and does not make a broken relationship valid. It is an audit and
isolation boundary for a later, separately reviewed migration phase.

## Idempotency, stale plans, crash recovery, and rollback

* A second apply with the same plan is a no-op after checking the logical
  content hash and exact registry coverage. It cannot duplicate rows or
  rewrite classifications.
* A plan whose file hash and logical hash no longer match is rejected before
  the transaction. A tampered plan digest is rejected before database access.
* Registry DDL and all registry rows are in one SQLite transaction. An
  exception before commit rolls back the table and rows; source rows and
  files remain untouched.
* Metadata-only rollback is explicit and requires a fresh independent review,
  the same verified backup precondition, `ADMIN`, and
  `ROLLBACK_LEGACY_CLOSURE`. It deletes only rows owned by that plan whose
  status is still `ISOLATED`; it never removes source bytes or application
  records.

Rollback command:

```text
node scripts/migration/legacy-closure.mjs --rollback \
  --database <database.db> --plan <closure-plan.json> \
  --expected-db-sha256 <plan.database.sha256> \
  --backup-manifest <verified-backup>/manifest.json \
  --review-artifact <rollback-review.json> \
  --actor-role ADMIN --confirm ROLLBACK_LEGACY_CLOSURE
```

## Release semantics

The existing `npm run release:data-check` gate remains authoritative. A
registry entry does not reduce `legacy_orphan_count`, and this tool does not
alter `active_unresolved_sources`, `active_fk_orphan_count`, hash mismatch
counts, cross-tenant checks, or quarantine counts. Direct database FK
migration remains unsafe while legacy exceptions exist. Current data writes
must continue to reject missing and cross-tenant study links.

## Fixture validation

The isolated tests in `tests/migration/legacy-closure.test.ts` exercise:

* dry-run non-mutation and PHI-minimizing output;
* backup, independent-review, ADMIN, and explicit-confirmation gates;
* exact legacy-only registry apply and repeat-apply idempotency;
* tampered-plan and changed-database rejection;
* transaction rollback after a simulated mid-apply failure; and
* metadata-only rollback with unchanged source payloads.

These are fixture tests. They do not prove that the production database is
safe to mutate and they do not close the 5,263 legacy exceptions by
themselves. A primary operator must create and independently verify a new
encrypted backup, review a fresh plan, and record pre/post release-data,
reconciliation, FK-preflight, restore, and audit evidence before any apply.

## Current honest classification

The repository evidence supports:

```text
ACTIVE_FK_ORPHANS = 0
LEGACY_EXCEPTIONS = 5263
DIRECT_FK_MIGRATION_SAFE = false
```

This is a phased isolation control, not a claim of relational migration
completion. The clinical boundary remains:

```text
NOT CLINICALLY VALIDATED
NOT A MEDICAL DEVICE
NOT FOR AUTONOMOUS DIAGNOSIS
```
