# Data Governance

Current checkout note (2026-09-12): SQLite is the transactional default and
the three installed local models are RESEARCH-only. The dated historical
storage statements below are superseded where they conflict with the current
runbook and release report.

## Principles

Eye scans are sensitive medical information. Uploaded scans are **never** used for model training in this
deployment without explicit consent, governance, and legal authorization (none of which exists yet — so no
training occurs).

## Storage map (all on D:)

| Data | Location |
|---|---|
| Original scans | `data\uploads\<study_id>\` (byte-for-byte, SHA-256) |
| Analyses | `data\processed\` |
| Reports | `data\reports\` |
| Database | `data\database\eye-ai.db` (SQLite; legacy JSON import tooling only) |
| Audit logs | `data\logs\audit-*.ndjson`, `data\logs\analyses.ndjson` |
| Models | `data\models\` (local hash-verified RESEARCH-only packages; no clinical validation) |
| Temp | `data\tmp\` (auto-cleaned) |

## Audit trail

- Event audit (`audit-<date>.ndjson`): who/what/when/study id/outcome — metadata only. Images, full reports,
  credentials, and tokens are never logged; potentially sensitive log content is redacted by a sanitizer.
- Analysis audit (`analyses.ndjson`): append-only per-analysis provenance — study id, image hash, model id,
  model version, checksum, device, modality, quality score, findings count, uncertainty, ruleset version,
  triage priority, timestamp. Records are never updated or deleted by the application.

## Deletion

Study deletion (History page or `DELETE /api/studies/:id`) removes the original image, processed analysis, and
report. The deletion event itself is recorded in the audit trail.

## Research dataset governance (`lib/research/datasets.ts`)

- **De-identification**: patient keys are salted SHA-256 hashes; raw identifiers are never stored.
- **Patient-level split enforcement**: the same patient cannot appear in two different splits
  (train / validation / locked_test / external_test) without a documented exemption, which is audited.
- **Locked test sets**: created with purpose `locked_test` are read-only — sample membership and labels are
  immutable; any modification attempt is rejected (and audited) unless a documented exemption is provided.
- **Reference standards**: labels can only be set through the adjudication workflow (below). Label provenance
  must reference a completed agreement/adjudication record.

## Multi-grader labeling (`lib/research/datasets.ts`)

```
Expert 1 ┐
Expert 2 ├→ agreement computation → (unanimous | majority | disagreement | insufficient)
Expert 3 ┘         │
        unanimous → reference standard
        disagreement → adjudicator resolution required (must select a recorded annotation)
```

One expert's label is never silently selected as truth. Grader id, annotation, timestamp, disagreement, and
adjudicator are recorded for every sample.

## Security status (honest)

| Control | Status |
|---|---|
| Encryption in transit | **REQUIRES EXTERNAL INFRASTRUCTURE** - TLS termination is not, and should not be, done by this application; see `docs/PHASE5B_SECURITY.md` |
| Encryption at rest | **REQUIRES EXTERNAL INFRASTRUCTURE** - not implemented at the application layer (correctly so - see `docs/PHASE5B_SECURITY.md`) |
| Authentication | **IMPLEMENTED** (Phase 5B) - scrypt password hashing, server-side sessions, CSRF, rate limiting, lockout; see `docs/AUTH_RBAC.md` |
| RBAC | **IMPLEMENTED** (Phase 5B) - five roles, enforced server-side on every protected route; see `docs/AUTH_RBAC.md` |
| Public image URLs | None generated; `/api/studies/[id]/image` requires an authenticated clinical-staff role (Phase 5B) |
| Image logging | Never |
| Audit logging | IMPLEMENTED (append-only, hash-chained for tamper evidence as of Phase 5B - see `docs/PHASE5B_SECURITY.md`) |
| Data deletion | IMPLEMENTED |

This table was last accurate as of Phase 3; Phase 5B substantially changed the
authentication/RBAC/encryption rows above (this correction was made when that
staleness was noticed during the Phase 5B → Phase 6 readiness audit). The dev
build must still not be exposed to untrusted networks without a real TLS
terminator in front of it, and must not contain real patient data until the
clinical-validation and regulatory gates in later phases are satisfied.
