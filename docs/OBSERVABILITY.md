# VisionScan operational observability

Operational metrics are deliberately PHI-free. `lib/observability/metrics.ts`
keeps bounded process-local counters for job/model/OCR failures, quality and
OOD rejects, clinician corrections, and security events. Labels are a fixed
allow-list; patient, study, document, image, report, and free-text identifiers
are never accepted. `GET /api/admin/metrics` is ADMIN-only and reports
`phi_included: false`, `scope: process_local`, and `persistence: none`.

This is a local operational snapshot, not a production monitoring service. A
production deployment must export equivalent counters/timings to an approved
metrics backend with PHI filtering, access control, retention, alert routing,
and a documented data-processing agreement. The audit log remains the source
for security-event detail; metrics intentionally contain no event detail.

Before release, instrument each asynchronous job boundary with start/completion
and duration observations, then alert on failure/reject rates and queue age.
Do not add request URLs containing identifiers, OCR text, report text, image
bytes, or patient labels to metrics or traces.

