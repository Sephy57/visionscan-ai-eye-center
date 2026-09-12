# VisionScan Phase 3 — Active Data Closure Report

**Observed:** 2026-09-12, local Windows checkout.  
**Mode:** read-only source forensics and dry-run planning.  
**Decision:** `DATA RELEASE BLOCKED`.

## Scope and safety boundary

This review covers unresolved active source dependencies, detached legacy references, foreign-key preflight, hash/provenance searches, quarantine inspection, and the dry-run closure plans. It does not reconstruct missing bytes, delete records, publish a source, or relabel an unknown item as safe. No patient data, credentials, database file, uploaded asset, report export, model weight, or backup was added to Git.

The controlling recovery rule remains: an admissible source requires an exact expected SHA-256, compatible asset type, exact tenant/study/patient scope, and provenance that proves the relationship. A filename, timestamp, duplicate digest, derivative, OCR text, thumbnail, ROI crop, mask, page render, or model output is not an original-source recovery.

## Active blockers before and after

| State | Active findings | Classification |
|---|---:|---|
| Before dry run | 235 | 233 `MISSING_REQUIRED_ARTIFACT`; 2 `DETACHED_ANALYSIS_PARENT` |
| After dry run | 235 | 0 recovered; 0 retireable; 233 ambiguous; 2 active-lost; all unchanged |

The closure plan reports:

```text
total_findings=235
recoverable=0
retireable=0
active_lost=2
ambiguous=233
unchanged=235
mutation.performed=false
source_rows_changed=0
source_files_changed=0
audit_events_written=0
phi_included=false
```

The current release-data gate therefore remains `BLOCKERS_REMAIN` with `active_data_release_safe:false`. The two detached analyses cannot be treated as valid source-independent analysis records; the 233 missing required artifacts remain unresolved.

## Forensic search evidence

The current active closure dry run scanned 69,352 files. It observed 91,745 exact digest matches, but all 91,745 were rejected for scope or provenance. This is not contradictory: the same bytes can occur in fixtures, backups, derivatives, or unrelated scopes without proving ownership of a required source.

Trusted roots considered by the planner were `uploads`, `documents`, `processed`, `reports`, `quarantine`, and verified isolated restores. No candidate satisfied the full identity tuple. The generated ledger and dry-run plan are:

- [`active-source-forensics.json`](generated/active-source-forensics.json)
- [`data-closure-dry-run.json`](generated/data-closure-dry-run.json)
- [`ACTIVE_DATA_CLOSURE_FINAL_REPORT.md`](ACTIVE_DATA_CLOSURE_FINAL_REPORT.md)

## Legacy state

The legacy closure dry run found 5,263 detached/orphan references:

| Legacy class | Count |
|---|---:|
| Detached legacy documents | 5,260 |
| Detached legacy analyses | 2 |
| Detached legacy job | 1 |
| Total | 5,263 |

The current release-data check also reports 100 legacy unresolved source conditions: 55 missing required artifacts and 45 missing report exports. These references are preserved legacy governance state, not evidence that the current release dataset is clean. No legacy row was silently deleted, reparented, or promoted.

## Integrity and tenant boundaries

The current checks report:

- active foreign-key orphans: `0`;
- cross-tenant violations: `0`;
- source-hash mismatches: `0`;
- quarantined records inspected: `81`;
- direct FK migration safety: `false` while legacy exceptions remain;
- PHI included in generated evidence: `false`.

Zero active FK orphans does not clear the source-release gate: missing required artifacts and detached analysis parents are separate provenance/replay blockers.

## Recovery, retirement, and mutation policy

No source was recovered because no candidate satisfied exact hash, scope, type, and provenance simultaneously. No source was retired because retirement is an operator/governance decision that needs explicit retention evidence and an immutable audit event. No database or asset mutation was performed.

If new evidence becomes available, the next safe sequence is:

1. create and verify an operator-controlled backup;
2. restore that backup into an isolated directory/database;
3. search by exact digest and asset type within the permitted scope;
4. require two-person review of provenance and tenant/study ownership;
5. stage copy-on-write changes with an idempotency key;
6. validate SQLite integrity, FK scope, hashes, and replay behavior;
7. publish atomically and record an immutable audit event;
8. rerun the release-data check and retain the before/after evidence.

Crash, retry, duplicate, and partial-failure paths must leave the source ledger and audit trail consistent. The current dry-run plan demonstrates the safe no-op path only.

## Release decision

**Data classification:** `DATA RELEASE BLOCKED`.

The repository has stronger enumeration and fail-closed planning than an untracked cleanup would provide, but it cannot truthfully reconstruct absent source bytes. Release requires itemized adjudication of all 235 active findings and the 5,263 legacy references, followed by a fresh backup/restore rehearsal and green release-data evidence.
