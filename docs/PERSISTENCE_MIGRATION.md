# Persistence migration, backup, and rollback

VisionScan now uses SQLite as its local transactional persistence backend. The
existing `dbGet`/`dbPut`/`dbAll` seam is unchanged for application callers, but
each collection is stored in a table with a JSON payload envelope:

```text
id TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at TEXT NOT NULL,
updated_at TEXT NOT NULL
```

The connection enables `foreign_keys=ON`, `journal_mode=WAL`,
`busy_timeout=5000`, and `synchronous=FULL`. Schema and migration versions are
recorded in `persistence_meta`. Large originals, PDFs, OCT regions, and model
weights remain file objects referenced by application records; SQLite cannot
make a file-system write and a database commit one atomic resource, so callers
must use the existing immutable/hash and reconciliation boundaries.

## Importing the legacy JSON store

`npm run migrate:data` is always a dry run unless `--apply` is supplied. A
normal review sequence is:

```text
npm run migrate:data -- --dry-run --source data/database/eye-ai.json --destination data/database/eye-ai.db
npm run migrate:data -- --apply --source data/database/eye-ai.json --destination data/database/eye-ai.db
```

The importer validates the top-level `collections` envelope, counts records,
computes source and deterministic record hashes, and reports invalid or
unsupported collections. Applying creates `data/backups/migration-*` (ignored
by Git), copies and hashes the immutable source and any existing destination,
imports all supported records in one SQLite transaction, verifies counts and
`PRAGMA integrity_check`, and atomically installs the result. A destination
with the same `migration_source_sha256` returns `already_applied`; a different
destination requires `--force` after review. Temporary databases are removed
on failure and the source is never changed.

The importer deliberately refuses to open a non-SQLite file at the destination
path. This protects the common `.db`/legacy-JSON collision and requires an
operator-reviewed migration rather than silently replacing data.

Reports that lack an immutable `version_freeze` or `reasoning_snapshot` are
counted and labelled `LEGACY_UNSEALED` at delivery time. No seal, snapshot, or
clinical conclusion is invented; the existing report-integrity gate continues
to reject those reports for clinician finalization.

## Backup and restore

`npm run backup:data -- --dry-run` prints a read-only plan. The real command
writes an ignored `data/backups/backup-*` directory containing the database,
SQLite sidecars when present, a hash- and size-bearing `manifest.json`, and an
asset manifest for uploads, documents, processed outputs, and reports. Model
weights are never copied automatically and credentials are never included.

Restore is non-destructive by default:

```text
npm run restore:data -- --backup data/backups/backup-<timestamp> --dry-run
npm run restore:data -- --backup data/backups/backup-<timestamp>
```

That creates a new ignored `data/restores/restore-*` directory after verifying
the database hash and SQLite integrity. Replacing an active database requires
an explicit target and `--activate`; the current target is backed up first.
There is no implicit overwrite.

Encryption, TLS, retention, key management, production consent enforcement,
and a multi-resource outbox/reconciliation worker remain deployment
responsibilities. This project remains research/demo software and is not a
medical device.
