# VisionScan AI local system test and performance report

**Test date:** 2026-09-06 (Asia/Manila)  
**Environment:** local production server (`next start`), Windows host  
**Application address:** `http://localhost:3000`  
**Revision:** `a9f2e946f410c918640bc7bafdf0b6c3601b66f4` (`main`)  
**Remote:** `https://github.com/Sephy57/visionscan-ai-eye-center.git`  
**Report purpose:** record the local functional, structural UI, and latency checks performed after release. This is an engineering test report, not clinical validation.

## Executive summary

The production build started normally and the exercised local workflows passed. There was no evidence of sustained UI or API lag in warmed requests. The first request to a server-rendered route was slower than later requests, which is expected cold-start behavior. Login was slower than ordinary requests because password verification intentionally uses a computationally expensive hash check.

The application remains subject to its established safety boundary: it is **not clinically validated**, **not a medical device**, and **not for autonomous diagnosis, treatment, prescribing, or dosage decisions**. Clinical review remains required.

## Test configuration

- Server command: `npm start -- --port 3000`
- Runtime: Next.js 16.3.4 production server
- Test account: local `smoke-admin` account created/used by the existing smoke-test harness
- Test data: synthetic images only; the smoke-test study is deleted at the end of its workflow
- No external model service was used
- The research-only SegFormer pathway was not used as a clinical model

## Functional end-to-end results

`npm run smoke` completed successfully: **16/16 checks passed.**

| Area | Result | Notes |
| --- | --- | --- |
| Authentication | Pass | Local smoke-test administrator authenticated successfully. |
| Upload | Pass | Synthetic clean image uploaded and study persisted. |
| Symptom intake | Pass | Structured symptom input accepted; invalid input rejected. |
| Analysis | Pass | Analysis/report generated with demo and safety context. |
| Triage | Pass | Red-flag symptom escalated to urgent eye-care review. |
| Report | Pass | Report generated with safety information. |
| Evidence honesty | Pass | Image-only model remained unable to claim unsupported conditions. |
| Quality gate | Pass | Poor-quality input was blocked rather than analyzed as normal. |
| Clinician workflow | Pass | Clinician finalization completed. |
| Longitudinal view | Pass | Correctly states that validated quantitative comparison is unavailable. |
| Self-test endpoint | Pass | 15/15 internal checks completed. |
| Authorization | Pass | Unauthenticated access was rejected; role behavior was consistent. |
| Cleanup | Pass | Smoke-test study deletion completed. |

## UI structure validation

`npm run visual-qa` completed successfully: **10/10 routes passed.**

Validated routes:

- `/`
- `/dashboard`
- `/analyze`
- `/history`
- `/compare`
- `/clinician`
- `/settings`
- `/devices`
- `/admin`
- `/report`

For each route, the structural check confirmed one application sidebar, expected navigation, a main landmark, the persistent safety banner, and no unexpectedly open mobile drawer. This is a DOM/structure check; it is not a substitute for human visual review at every viewport size.

## Local latency measurements

### Initial route warm-up

The first home-page request took approximately **208 ms**. Immediate repeat requests were approximately **82.5 ms** and **7.4 ms**. This pattern is consistent with server/runtime warm-up rather than persistent lag.

### Warm-route sample (10 requests per route)

| Route | Mean | p95 sample | Assessment |
| --- | ---: | ---: | --- |
| `/` | 17.5 ms | 16.0 ms | Healthy after warm-up |
| `/dashboard` | 8.0 ms | 8.4 ms | Healthy |
| `/api/auth/session` | 11.9 ms | 20.6 ms | Healthy |

### Authenticated workflow sample

| Action | Observed time | Assessment |
| --- | ---: | --- |
| Login | 280 ms | Expected: deliberate password-hash verification cost |
| List studies | 42 ms | Healthy |
| Upload synthetic image | 42 ms | Healthy |
| Analyze synthetic image | 99 ms | Healthy; quality gate returned safely |
| Delete temporary study | 37 ms | Healthy |

## Lag assessment

No sustained lag was reproduced in the routes or workflows tested.

Expected sources of occasional delay are:

1. **First-request warm-up.** Server-rendered routes can take longer on their first request after process start.
2. **Password verification.** The login route intentionally performs a slow password-hash comparison to resist credential attacks. This should not be removed merely to improve a sub-second local timing.
3. **Document OCR and image work.** Large PDFs, OCR, and any research-only CPU segmentation can take materially longer than ordinary UI/API requests. These paths have explicit timeouts, quality gates, job states, and fail-closed behavior.
4. **Local JSON persistence.** The current JSON store is development-oriented. Larger multi-user production workloads require the documented SQLite/PostgreSQL migration, indexing, backup/restore procedures, and approved observability infrastructure.

No performance change was made from this test run because the measured ordinary paths are already responsive and no regression was identified.

## Safety and correctness observations

- The quality gate rejected unsuitable images rather than issuing a reassuring result.
- Red-flag symptoms remain able to escalate urgency independently of image findings.
- Demo/synthetic analysis remains labeled and does not produce a clinical diagnosis.
- Possible conditions, evidence synthesis, and research outputs remain separate from clinician-authored final assessment fields.
- Patient/tenant scopes, role-based access, CSRF protection, and PHI-safe audit/metrics controls are part of the released system.
- Candidate models remain non-clinical and fail closed. The isolated research segmentation model is not in the production diagnostic registry.

## Known limitations and follow-up work

| Topic | Current state | Required before clinical/production expansion |
| --- | --- | --- |
| Clinical validation | Not performed | Prospective/external validation, calibration review, subgroup analysis, governance approval, regulatory assessment |
| Model availability | Candidate/research only | Approved licensing, verified immutable artifacts, validation evidence, threshold governance, monitored deployment |
| Storage | Local JSON development store | Reviewed SQLite/PostgreSQL migration, encryption, backups, retention and recovery testing |
| Operational monitoring | Process-local PHI-safe metrics | Approved centralized monitoring, alerting, retention policy, incident response procedures |
| Responsive visual review | Structure test passed | Human/browser review at the required device and viewport sizes |
| Performance under load | Single-host local check passed | Concurrent-user load testing, database load testing, queue throughput testing, capacity plan |

## Verification record

The following release checks were previously completed on this revision line and remain relevant to the local run:

- TypeScript typecheck passed.
- Production build passed.
- Full automated test suite passed in GitHub Actions.
- Filesystem audit passed.
- Production dependency audit reported zero vulnerabilities.
- Private GitHub CI run completed successfully: `33993381462`.

## Conclusion

VisionScan operated correctly in the tested local production configuration. Warm UI and authenticated API response times were low, and no reproducible lagging issue was found. The remaining work is production-scale performance testing and clinical validation—not a local responsiveness defect.
