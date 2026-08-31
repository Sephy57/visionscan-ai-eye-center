# Validation Framework

No clinical accuracy claim may be made until the following has been completed and documented.

## Phase 2 validation infrastructure (IMPLEMENTED - research tooling)

- **Dataset management** (`lib/research/datasets.ts`): versioned datasets per split
  (train / validation / locked_test / external_test), de-identified patient keys (salted SHA-256),
  patient-level cross-split leakage rejection, read-only locked test sets, audited documented exemptions only.
- **Multi-grader labeling**: N-expert annotations, agreement computation (unanimous / disagreement /
  insufficient), mandatory adjudication for disagreements (adjudicator must select a recorded annotation),
  reference labels only settable with adjudication provenance.
- **Evaluation tooling** (`lib/research/metrics.ts` + `POST /api/research/metrics`): sensitivity, specificity,
  PPV, NPV, FPR, FNR, AUROC (tie-corrected), AUPRC, calibration ECE + reliability bins, confusion matrix, and
  subgroup breakdowns (device / modality / quality). Overall accuracy is deliberately NOT a headline metric.
- **Registry evidence rules**: models cannot hold validation-level status without `evidence_reference`,
  a validation dataset, and a validation date; `auditRegistryConsistency()` fails closed otherwise.
- **Locked test protection**: the production UI has no pathway to modify locked test membership or labels;
  both are rejected at the data layer.

## Current status

| Component | Status |
|---|---|
| Quality gate (heuristic) | Not validated — thresholds are engineering defaults |
| Anatomical segmentation | Integration placeholder |
| Lesion/vascular detectors | Integration placeholder (synthetic demo output) |
| OCT analyzer | Integration placeholder |
| Triage ruleset | Engineering-reviewed, not clinically validated |
| Whole system | **NOT VALIDATED — NOT A MEDICAL DEVICE** |

## Required validation before any clinical claim

### Metrics (per condition, per device, per modality)
- Sensitivity, Specificity, PPV, NPV
- AUROC with confidence intervals
- Calibration (calibration curves, expected vs observed error; calibration drift monitoring)
- False-positive rate and false-negative rate
- Image-quality failure rate
- Safety-critical conditions prioritize **sensitivity and clinically appropriate NPV**, not overall accuracy.
  A model with 99% overall accuracy can still be unsafe if it misses rare serious abnormalities.
- Per-condition performance dashboards are required (see admin dashboard placeholder).

### Data splits
- Training / validation / **locked test** / external test sets
- Locked test set remains isolated; never used for development decisions
- Patient-level separation enforced: same-patient scans never span splits
- No device-specific leakage (per-device evaluation is separate)
- No metadata leakage (labels may not be inferable from acquisition metadata)

### Labeling methodology
- Multiple qualified graders where possible
- Adjudication process for disagreements, documented
- Dataset provenance documented (source, population, devices, acquisition protocols)

### Per-device validation
- Models validated on device A must not be assumed equivalent on device B
- Validate per: device model, firmware/software version, scan protocol, resolution,
  field of view, calibration, laterality, acquisition conditions

### Release gates
1. All metrics above computed on locked + external sets
2. Pre-registered acceptance thresholds per intended use
3. Safety-critical sensitivity meets threshold
4. Calibration error within tolerance
5. Quality-gate failure rate characterized
6. Regulatory status determined for the intended use (screening aid vs diagnostic)

### Continuous validation
- Clinician review workflow stores AI result + clinician correction + final result
- This diff stream feeds ongoing performance monitoring and drift detection
- Every analysis records model versions, checksums, and ruleset version for reproducibility
