# Consent & Data Governance

Status: **PARTIALLY IMPLEMENTED** - see per-section markers.

## Consent architecture — IMPLEMENTED (data layer + API), NOT wired as a hard gate

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
`ADMIN` can withdraw it, `CLINICIAN`/`ADMIN`/`REVIEWER` can read it) -
consistent with the Phase 4 audit's specific complaint that some
Phase-4-era library code (multi-grader adjudication) was real but had zero
API route, so it was unreachable outside unit tests. This module does not
repeat that mistake.

### Why it is not wired as a hard gate in front of analysis

The brief for this phase explicitly says: **"DO NOT CHANGE: existing safety
validator, red-flag logic, OOD logic, ... clinician review separation"**.
Making consent a hard precondition for `analyzeStudy()` would change the
existing, already-reviewed clinical pipeline's control flow - exactly the
kind of change that instruction asks not to make casually in a phase whose
stated primary focus is infrastructure, not the clinical pipeline itself.

`requireGrantedConsent(studyId, purpose)` exists and is ready to be called
at whatever policy point a deployment chooses (e.g. inside
`createStudy()`, inside `analyzeStudy()`, or at the UI layer before upload)
- it is deliberately **not called from anywhere** in this codebase yet.
This is disclosed as a real, present gap, not silently deferred: **a
deployment that needs consent to block clinical processing must wire this
in explicitly** before going anywhere near real patient data. The
architecture is ready; the policy decision of *where exactly* to enforce it
(and what UX a blocked-for-no-consent state should show) was left to
whoever owns that clinical decision, not decided unilaterally here.

## Data governance

| Concern | Status | Notes |
|---|---|---|
| Deletion | **IMPLEMENTED** | `deleteStudy()` removes the study record, analysis, report, and all files under `data/uploads/<id>`, `data/processed/<id>`, `data/reports/<id>` (path-traversal-safe as of this phase - see `docs/PHASE5B_SECURITY.md`). Verified end-to-end by `tests/selftest.ts` and `scripts/smoke.mjs`. |
| Deletion verification | **IMPLEMENTED** | `deleteStudy()`'s return value and the self-test both re-fetch the bundle after deletion and assert it is gone. |
| Access logging | **IMPLEMENTED** | Every study access, upload, analysis, review action, and RBAC denial is audit-logged (`lib/audit`), hash-chained for tamper evidence. |
| Data export | **PARTIALLY IMPLEMENTED** | Every analysis/report is already written to a JSON file (`lib/storage/files.ts writeJson`) and the report UI has a "download JSON" action. A structured, access-controlled bulk-export *endpoint* (e.g. "export everything for study X as a signed package") does not exist - **DEFERRED**. |
| Correction workflow | **IMPLEMENTED** | The clinician review `correct` action (`lib/studies/service.ts submitReview`) lets a clinician amend a finding; the original AI output is never overwritten (see immutability note below). |
| Retention policy | **DOCUMENTED ONLY** | No automatic time-based deletion exists. This is a policy decision (how long to keep research/demo data) that depends on the deploying organization's actual retention requirements and cannot be invented here - **REQUIRES POLICY DECISION**, then straightforward to implement as a scheduled job once decided. |
| Backup / restore | **DOCUMENTED ONLY** | Storage is a single JSON file (`data/database/eye-ai.json`) plus flat files under `data/`. Backup today means copying that directory tree; there is no automated backup/restore tooling. **REQUIRES EXTERNAL INFRASTRUCTURE** (a real backup schedule, offsite copy, restore drill) for a genuine production deployment. |
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
