# Consent & Data Governance

Status: **PARTIALLY IMPLEMENTED** - purpose-specific processing gates are now
enforced at HTTP and durable-job boundaries; direct library fixtures remain
deliberately ungated and operational retention/erasure still requires policy.

## Consent architecture — IMPLEMENTED (data layer + API + processing gate)

`lib/consent/consent.ts` implements the requested record shape:

```
consentId, studyId, subjectRef, purpose, consentType, status, version,
timestamp, actor, expiresAt, withdrawnAt, withdrawalReason
```

States: `PENDING`, `GRANTED`, `WITHDRAWN`, `EXPIRED`, plus a distinct
`"UNKNOWN"` return value (not a `ConsentStatus` member) that
`getConsentStatus()` returns when no record exists at all, or the most
recent record has passed its `expiresAt`. There is no code path that
defaults absence-of-a-record to `GRANTED` - this was verified directly in
`tests/phase5b-security.test.ts` ("consent defaults to UNKNOWN, never
GRANTED", "a withdrawn consent is reported as WITHDRAWN, not GRANTED").

`GET/POST/DELETE /api/studies/[id]/consent` exposes this as a reachable
route (`CLINICIAN`/`ADMIN`/`TECHNICIAN` can record consent, `CLINICIAN`/
`ADMIN` can withdraw it, `CLINICIAN`/`ADMIN`/`REVIEWER` can read it). When a
study is bound to a patient, the server validates any supplied subject
reference and persists the canonical study subject, never a caller-selected
identity.

### Purpose-specific hard gates

`lib/consent/policy.ts` maps the required purposes and returns a structured
`CONSENT_REQUIRED` response. The following boundaries require a current
`GRANTED` record before they read/process the study:

- `IMAGE_MODEL_ANALYSIS`: `/api/analyze` and analysis queue jobs;
- `DOCUMENT_EXTRACTION`: document upload/extraction routes and extraction jobs;
- `CLINICAL_RESEARCH_ANALYSIS`: research, record, and specialist analysis routes.

The durable worker rechecks consent after claiming a job. If consent is
missing, withdrawn, or expired, the job fails with a structured consent error
and no result is published. Direct calls to deterministic library services are
not automatically gated so existing unit fixtures can exercise pure clinical
logic; production callers must use the authenticated HTTP/job boundaries.

## Data governance

| Concern | Status | Notes |
|---|---|---|
| Deletion | **IMPLEMENTED** | `deleteStudy()` removes the study record, analysis, report, and all files under `data/uploads/<id>`, `data/processed/<id>`, `data/reports/<id>` (path-traversal-safe as of this phase - see `docs/PHASE5B_SECURITY.md`). Verified end-to-end by `tests/selftest.ts` and `scripts/smoke.mjs`. |
| Deletion verification | **IMPLEMENTED** | `deleteStudy()`'s return value and the self-test both re-fetch the bundle after deletion and assert it is gone. |
| Access logging | **IMPLEMENTED** | Every study access, upload, analysis, review action, and RBAC denial is audit-logged (`lib/audit`), hash-chained for tamper evidence. |
| Data export | **PARTIALLY IMPLEMENTED** | Every analysis/report is already written to a JSON file (`lib/storage/files.ts writeJson`) and the report UI has a "download JSON" action. A structured, access-controlled bulk-export *endpoint* (e.g. "export everything for study X as a signed package") does not exist - **DEFERRED**. |
| Correction workflow | **IMPLEMENTED** | The clinician review `correct` action (`lib/studies/service.ts submitReview`) lets a clinician amend a finding; the original AI output is never overwritten (see immutability note below). |
| Retention policy | **DOCUMENTED ONLY** | No automatic time-based deletion exists. This is a policy decision (how long to keep research/demo data) that depends on the deploying organization's actual retention requirements and cannot be invented here - **REQUIRES POLICY DECISION**, then straightforward to implement as a scheduled job once decided. |
| Backup / restore | **PARTIALLY IMPLEMENTED** | SQLite-aware `npm run backup:data` / `npm run restore:data` preserve hashes, integrity metadata, and asset manifests; AES-256-GCM backup encryption is available when explicitly configured. Scheduling, key custody, offsite storage, and a completed restore drill remain operational requirements. |
| De-identification boundary | **IMPLEMENTED (research layer)** | `lib/research/datasets.ts deidentifyPatientKey()` salts+hashes raw identifiers before they ever enter a research dataset; patient keys are never raw in that layer. The *clinical* layer (`StudyRecord.patient_ref`) intentionally keeps whatever identifier a clinician chose to enter (e.g. an MRN-like reference) - it is operational data, not research data, and de-identifying it would break the clinical workflow's own record-keeping. |
| Research-vs-clinical separation | **IMPLEMENTED** | Research data lives in dedicated collections (`datasets`, `dataset_samples`, `evidence`, `evaluation_runs`) with their own patient-level-leakage and locked-dataset protections (Phase 4). `RESEARCHER` role cannot reach raw clinical study routes at all (see `docs/AUTH_RBAC.md`'s route matrix) - it is restricted to the research-only endpoints (`/api/evaluations`, `/api/research/metrics`). |
| Data subject rights (access/correction/erasure) | **PARTIALLY IMPLEMENTED** | Erasure = `deleteStudy()` (works). Access = the existing bundle/report endpoints (works, subject to RBAC). A dedicated "subject rights request" workflow (formal request intake, SLA tracking) does not exist - **DEFERRED**, this is an organizational process question, not purely a code gap. |
| Incident logging | **IMPLEMENTED (as audit)** | RBAC denials, failed logins, account lockouts, and CSRF rejections are all audit-logged today. A dedicated security-incident triage/alerting workflow on top of that log does not exist - **DEFERRED**. |

## Immutability (unchanged from Phase 5A, re-verified here)

The AI-generated `AnalysisResult` and its `treatment_information` are never
mutated by a clinician action. Clinician decisions (finding
accept/reject/correct, treatment accept/modify/reject/add-medication/
remove-medication/mark-contraindication/mark-restriction/note) are recorded
as separate, additive records (`clinician_interpretation`,
`treatment_review`) on the `ClinicalReport`, never overwriting the original.
