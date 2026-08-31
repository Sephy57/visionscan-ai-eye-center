# Data Governance

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
| Database | `data\database\eye-ai.json` (SQLite-ready interface) |
| Audit logs | `data\logs\audit-*.ndjson`, `data\logs\analyses.ndjson` |
| Models | `data\models\` (empty by design) |
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
| Encryption in transit | Local deployment; TLS termination NOT configured (dev build) |
| Encryption at rest | **NOT IMPLEMENTED** |
| Authentication | **NOT IMPLEMENTED** |
| RBAC | **NOT IMPLEMENTED** |
| Public image URLs | None generated |
| Image logging | Never |
| Audit logging | IMPLEMENTED (append-only) |
| Data deletion | IMPLEMENTED |

The dev build must not be exposed to untrusted networks and must not contain real patient data.
