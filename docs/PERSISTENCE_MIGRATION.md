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

Plaintext remains the backwards-compatible default. For a local encrypted
backup, use an environment secret (the secret is never logged or written to a
manifest):

```text
$env:VISIONSCAN_BACKUP_KEY = "operator-supplied-secret"
npm run backup:data -- --encrypt --output data/backups/backup-encrypted
npm run restore:data -- --backup data/backups/backup-encrypted
```

The operator may instead pipe a secret with `--key-stdin`, or select another
environment variable with `--key-env NAME`. Encryption uses Node's built-in
AES-256-GCM with a fresh random IV per payload and scrypt-derived key material;
the manifest carries algorithm/KDF/salt metadata and a keyed HMAC so a
tampered manifest fails closed. Database, sidecar, asset, and asset-manifest
payloads are encrypted; the outer manifest contains only recovery metadata.
Wrong keys, modified ciphertext, modified hashes, and modified authenticated
metadata are rejected before a restore is published.

For example, a one-shot stdin flow (the key is not an argument and is not
printed) is:

```text
"operator-supplied-secret" | npm run backup:data -- --encrypt --key-stdin
"operator-supplied-secret" | npm run restore:data -- --backup data/backups/backup-<timestamp> --key-stdin
```

Backups optionally carry non-destructive retention metadata:

```text
npm run backup:data -- --retention-days 30 --legal-hold --archive-state ARCHIVED
```

Equivalent environment variables are `VISIONSCAN_BACKUP_RETENTION_DAYS`,
`VISIONSCAN_BACKUP_LEGAL_HOLD`, and `VISIONSCAN_BACKUP_ARCHIVE_STATE`. The
manifest records `retention_days`, `legal_hold`, `archive_state`,
`deletion_eligible_at`, and `policy_version`; automatic deletion is always
false and any destructive cleanup remains an explicit operator action.

Restore is non-destructive by default:

```text
npm run restore:data -- --backup data/backups/backup-<timestamp> --dry-run
npm run restore:data -- --backup data/backups/backup-<timestamp>
```

That creates a new ignored `data/restores/restore-*` directory after verifying
the database hash and SQLite integrity. Restore is staged in a temporary
directory and atomically published only after every listed asset, hash, and
path has been verified; missing or unsafe assets are removed with the staging
directory, so a partial restore is not presented as complete. Replacing an
active database requires an explicit target and `--activate`; the current
target is backed up first. There is no implicit overwrite.

Backup and restore reject absolute, UNC, dot-segment, encoded-traversal, and
symlink/reparse-point paths. Asset roots are allowlisted and duplicate target
paths are rejected. These checks protect the file boundary but are not a
replacement for OS ACLs, volume encryption, key rotation, or off-host backup
storage.

TLS, production key management/rotation, production consent enforcement, and
a multi-resource outbox/reconciliation worker remain deployment
responsibilities. This project remains research/demo software and is not a
medical device.
