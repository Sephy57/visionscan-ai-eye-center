# Validation Framework

No clinical accuracy claim may be made until the following has been completed and documented.

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
