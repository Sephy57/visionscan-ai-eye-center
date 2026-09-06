# VisionScan AI — local system, latency, and fundus-lesion candidate report

**Test date:** 2026-09-07 (Asia/Manila)
**Repository:** `D:\AI EYE ANALYSIS PLATFORM`
**Server:** Next.js 16.3.4 production build, `http://localhost:3000`
**Purpose:** engineering verification only. This is not clinical validation.

## Executive result

The application built and ran locally. End-to-end smoke, structural visual QA,
responsive browser QA, type checking, filesystem audit, and the complete Vitest
suite passed after two bounded research-runtime margins were hardened: the
SegFormer worker cap was widened from 60 to 120 seconds, and the PyTorch
environment-readiness probe from 15 to 19 seconds. These changes affect only
explicitly isolated, non-registered research subprocesses; neither is on the
live analysis path.

The ClementP fundus-lesion checkpoint was reproduced safely offline, but it is
not clinically or independently validated. It remains exactly:

> **CANDIDATE REMAINS DISABLED**

No live pipeline, registry entry, model package, or user-facing clinical result
can call it.

## Local run and responsiveness

- `npm run build`: passed; all application routes compiled and were generated.
- `npm run audit:fs`: passed; source, data, model storage, logs, and temp paths
  are on `D:` (about 274 GB free at test time).
- Local server started with the explicit private/local-only setting
  `ALLOW_INSECURE_LOCAL_AUTH=true`. HTTPS remains required by default for any
  shared or deployed environment.
- The browser login was exercised against the running server and redirected to
  `/` with an authenticated `ADMIN` session.

Latency sweep (eight sequential local requests, warmed production server):

| Request | Minimum | p50 | p95/max | Assessment |
| --- | ---: | ---: | ---: | --- |
| `GET /login?next=%2F` | 4.4 ms | 4.9 ms | 73.9 ms | Responsive; one cold/outlier sample |
| `GET /api/auth/session` | 3.1 ms | 4.6 ms | 5.6 ms | Responsive |

The heavier CPU cost is isolated model inference, not login/session navigation.
OCR and research inference remain bounded background-style work rather than a
login request dependency.

## Functional and browser verification

- `npm run smoke`: **16/16 passed**. This covered authentication, upload,
  structured symptoms, invalid-input rejection, analysis, red-flag triage,
  report generation, image-quality rejection, clinician finalization,
  comparison, self-test (15/15), authorization, and cleanup.
- `npm run visual-qa`: **10/10 routes passed**.
- `npm run browser:responsive`: **60/60 checks passed** at 375, 414, 768,
  1024, 1280, and 1440 px.
- `npx tsc --noEmit`: passed.
- Complete `npm test`: **38 files passed; 774 tests passed; 2 skipped**.
- Early full-suite attempts exposed test-host contention artifacts: the real
  SegFormer subprocess reached its old 60-second cap, and the PyTorch package
  readiness probe reached its old 15-second cap while Vitest workers competed
  for CPU. Both remain hard bounded (120 seconds and 19 seconds respectively),
  and the final full suite passes under default parallel scheduling.

Expected non-failing warnings included the existing Next.js middleware-to-proxy
deprecation notice, PDF standard-font notices in tests, and PyTorch deprecation
warnings during the offline research probe.

## ClementP lesion candidate — technical evidence

| Item | Verified value |
| --- | --- |
| Immutable source revision | `a2cfcb594e483d8baa17f24e1152009641cb9847` |
| Artifact | `model.safetensors`, 138,428,676 bytes |
| SHA-256 | `a7a7cb45b92328f7c9a8e581eec3944fd435d37fae8cbf340b1319c5f987c6d2` |
| Architecture | U-Net + SE-ResNeXt50 32x4d, 3-channel input, 5 output channels |
| State-dict proof | 444/444 keys strict; 0 missing, unexpected, or shape mismatches |
| Class order | background, cotton-wool spot, hard exudate, retinal hemorrhage, microaneurysm-like lesion |
| Isolated runtime | Python 3.12.10, CPU PyTorch 2.14.0, TorchSeg 0.0.1a4, timm 0.9.16, einops 0.7.0 |
| Forward contract | finite `(1, 5, 1024, 1024)` output; per-pixel softmax sums to 1 |
| Warm CPU timing | approximately 2.240–2.366 s for 1024×1024 with four threads |

The probe is offline-only, SafeTensors-only, uses a pinned local architecture,
verifies the artifact hash before and after loading, strips only the known
single `model.` wrapper prefix, and loads with `strict=True`. A wrong-hash
probe failed closed with `model SHA-256 mismatch`.

The existing non-PHI engineering image produced a finite argmax mask with a
16-pixel microaneurysm-like region and no other non-background class. This is
an engineering observation from a non-supplied fixture, not a lesion finding,
false-negative review, or clinical claim. Scores are explicitly
`NOT_CALIBRATED` and no diagnostic probability is emitted.

## Why the candidate remains disabled

- No legally cleared, independent patient/eye/visit-keyed validation cohort is
  present.
- The publisher reports training on DDR, FGADR, IDRiD, MESSIDOR, and RETLES;
  those datasets cannot be treated as independent without exact split and
  overlap manifests.
- Training-data rights are unresolved; an MIT artifact tag is not a clearance
  of underlying dataset restrictions.
- No frozen threshold protocol, calibration evidence, per-class Dice/IoU,
  sensitivity/specificity, confidence intervals, subgroup analysis, or
  structured false-negative/false-positive review is recorded.
- The supplied abnormal-image fixture is not present in the workspace, so no
  result is claimed for it.

Required promotion work is documented in
[FUNDUS_LESION_MODEL_INTEGRATION.md](FUNDUS_LESION_MODEL_INTEGRATION.md) and
[FUNDUS_ABNORMALITY_MODEL_VALIDATION.md](FUNDUS_ABNORMALITY_MODEL_VALIDATION.md).

## Local test account

The smoke harness contains a disposable local-only default account:
`smoke-admin` / `SmokeTest#Local1234`. Do not reuse this credential outside
the isolated local demo; real deployments must use administrator-managed
accounts over HTTPS.
