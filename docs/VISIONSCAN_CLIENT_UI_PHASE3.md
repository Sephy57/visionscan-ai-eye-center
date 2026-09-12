# VisionScan Phase 3 — Client UI and Manual QA Report

**Observed:** 2026-09-12 in persistent local Chromium/CUA.  
**Evidence:** saved PHI-free PNGs under [`docs/qa/screenshots/`](qa/screenshots/).  
**Disposition:** `CLIENT DEMO READY` for a controlled research software demonstration; not a clinical demonstration.

## Manual route coverage

| Surface | Observed result |
|---|---|
| Landing | Research environment banner, validation-first positioning, synthetic visual explicitly labelled, human review language visible |
| Login | Sign-in form, no self-service account creation, research environment language visible |
| Dashboard | `MODEL STATUS RESEARCH`, `SYSTEM STATUS Operational`, locally stored study readout, clinical-correlation queue state |
| Intake | Pseudonymous identifier guidance, upload restrictions, quality/provenance guardrails, research-only badge, purpose-specific consent controls |
| Processing | Server-side bounded stages, queued/running state, progress described as workflow completion rather than model confidence |
| Result | Local fundus research output, modality/device/domain state, executed model table, model disagreement, uncalibrated score language |
| Viewer | Original pixels shown separately from the research overlay; laterality and original SHA are visible |
| Clinician review | AI output and clinician interpretation are separate; confirm/reject/correct/indeterminate/request-new-scan controls exist. No control was clicked during QA. |
| Conditions | No possible conditions displayed when validated-model gating is not satisfied; evidence patterns remain non-diagnostic and may be insufficient/unable to assess |
| Medication | Treatment information explicitly unavailable because no defensible medication knowledge source is connected; no drug, dose, or prescription was shown |
| Specialist board | Nine specialty lanes, partial corroboration, failed/blocked/no-validated-model states, missing confirmation, and independent reasoning guards visible |
| Report | Research banner, no active production targets, model execution/provenance, limitations, and non-clinical safety boundary visible |
| Models | Three hash-verified local research artifacts and their research-only status visible; demo placeholder visibly separated |
| Validation/evaluations | Aggregate-only privacy boundary and research metrics visible; no case identifiers or clinical-validation claim presented |

## Observed research result

The existing synthetic study completed with the fundus lesion and DR research probes executed. OCT was marked unsupported/out-of-distribution for the fundus input. The result displayed a suspicious retinal region, uncalibrated model output, model disagreement, and a required ophthalmic review. No diagnosis, normality conclusion, calibrated probability, or treatment recommendation was displayed.

The report header displayed `NOT VALIDATED - NOT A MEDICAL DEVICE - NOT FOR CLINICAL USE` and `RESEARCH USE ONLY - NOT VALIDATED FOR CLINICAL USE`. The conditions panel displayed no conditions because validated-model condition gating was not satisfied. The treatment panel stated that no defensible medication source is connected.

## Screenshot evidence

The screenshot files are persisted in a safe, repository-local QA directory and are indexed with byte length and SHA-256 in [`docs/qa/screenshots/README.md`](qa/screenshots/README.md). They contain the research UI and synthetic study context only. They do not constitute a screenshot of a patient record or an endorsement of the model output.

## Responsive and accessibility evidence

The real-browser responsive harness passed `80/80` across the login, dashboard, patients, analyze, history, result, report, clinician, settings, and admin routes at 320, 375, 414, 768, 1024, 1280, 1440, and 1920 px widths. Accessibility passed `20/20`; keyboard navigation passed `21/21`. A contrast/link-in-text-block issue at `/settings` on the 320 px viewport was fixed by adding visible link underlines and the accessibility suite was rerun.

No console errors were observed during the manual CUA run. The current browser asset E2E passed metadata-free fundus execution, mixed-PDF extraction, three routed pages, eight OCT ROI candidates, and report provenance in isolated local storage. No screenshot of a real PDF page or OCT ROI was created in this manual pass; the persisted `intake.png` and the current E2E logs are the available evidence for that path.

## UI classification

**Client:** `CLIENT DEMO READY` for local controlled research workflow and review-surface demonstration.  
**Clinical interpretation:** the UI is deliberately not a clinical product surface. It does not authorize diagnosis, treatment, patient release, or autonomous action.
