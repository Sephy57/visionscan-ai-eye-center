# Persistence migration and rollback

The current atomic JSON store (`data/database/eye-ai.json`) is for local
development and is not a production PHI database. The stable `dbGet`/`dbPut`/
`dbAll` interface is intentionally the seam for a reviewed SQLite development
adapter or PostgreSQL production adapter.

## Preflight

Run:

```text
npm run migration:preflight
```

This is a dry run. It parses the source, validates collection shape, computes
the source SHA-256, and prints collection counts without changing the source.
Use `npm run migration:preflight -- --write-manifest` only when a local,
gitignored manifest is wanted. The manifest is evidence for an importer review;
it is not itself a database migration.

## Required production migration controls

1. Make and independently verify a read-only backup of the entire JSON store
   and file objects; record hashes and a restore test.
2. Import into a staging database with explicit schema/version mappings for
   patients, encounters, studies, documents, images, measurements, findings,
   evidence, reviews, reports, audit, model registry, evaluations, medications,
   sessions, grants, consent, and jobs.
3. Reconcile row counts, IDs, references, tenant/patient scope, hashes, and
   timestamps. Stop on any mismatch; never silently coerce PHI.
4. Keep the source immutable and read-only during cutover. Run dual-read or a
   maintenance window, then perform a signed, human-approved cutover.
5. Roll back by routing reads/writes back to the verified source or restoring a
   database snapshot. Never delete the source as part of migration.

Encryption, TLS, backups, retention, key management, and production consent
enforcement remain deployment responsibilities and are not simulated here.

