# Release controls

VisionScan is released only as engineering software with the following local
gates: full Vitest suite, TypeScript check, production build, filesystem audit,
dependency audit, browser smoke, visual QA, accessibility checks, PHI/secret
scan, and `git diff --check`. Model promotion additionally requires a verified
artifact, license, intended-use match, patient-level split, validation,
calibration, subgroup/failure analysis, and clinician sign-off.

The release boundary is explicit: no local JSON deployment may handle real PHI
on an untrusted network. Production requires an approved database, encrypted
storage, TLS, backups and restore drills, retention/deletion policy, consent
enforcement, monitoring, incident response, and regulatory review.

Never commit `.env`, credentials, patient records, OCR output, reports, audit
logs containing PHI, unapproved model weights, or migration backups. GitHub
creation/push requires authenticated human approval and a final clean artifact
scan. No release may describe VisionScan as clinically validated, a medical
device, or an autonomous diagnostic/prescribing system.

