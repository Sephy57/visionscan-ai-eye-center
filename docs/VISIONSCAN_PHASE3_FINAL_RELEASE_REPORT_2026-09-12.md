# VisionScan Phase 3 — Final Release Report

**Report date:** 2026-09-12  
**System:** VisionScan AI Eye Center, eye-ai-platform 0.1.0  
**Repository:** D:/AI EYE ANALYSIS PLATFORM  
**Assessment:** source, model, data, safety, security, worker, UI, and release-gate review  
**Evidence rule:** every positive statement below is bounded by an observed command, artifact, test, or manual browser observation. Synthetic and research evidence is not presented as clinical evidence.

## 1. Starting HEAD

The task started at main commit 3c702f2881d1ab6281ec301c6ff346dd22ae0d50, also shown as origin/main at the start of the work.

## 2. Starting dirty-tree state

The starting checkout was intentionally dirty: 45 tracked paths were modified, with approximately 1,520 insertions and 357 deletions, plus untracked Phase 1, Phase 2, and Phase 3 reports, tests, scripts, and evidence. No reset, checkout, clean, or broad deletion was used.

## 3. Preserved prior work

The prior VisionScan safety, provenance, model-integration, data-governance, and UI work was preserved. Existing ignored data, model weights, databases, backups, reports, and logs were not moved or deleted. Prior release blockers remain visible rather than being reclassified as resolved.

## 4. Final HEAD

The verified implementation and evidence head before this report was 08c40489f23bd6de8b312f3dd188937e166b907f. This report is a documentation-only follow-on commit. Because a commit cannot contain its own future SHA without a circular rewrite, the final report-commit SHA is recorded by git rev-parse and the final handoff after this file is committed.

## 5. Commits

The Phase 3 release set contains:

- 64a9dec — feat: harden research analysis and safety gates
- 1d1482f — feat: add Phase 3 model validation and release gates
- 6039566 — docs: record Phase 3 closure performance and client QA
- 08c4048 — docs: align Phase 3 closure counts
- this report as the final documentation follow-on

## 6. Push

The implementation and evidence set was pushed to origin/main. The server-side ref was checked with git ls-remote and matched 08c40489f23bd6de8b312f3dd188937e166b907f. The report-only follow-on is pushed separately and is checked again in the final handoff.

## 7. Exact current-head CI

At the verified implementation/evidence head, GitHub Actions run 34702820629 recorded head SHA 08c40489f23bd6de8b312f3dd188937e166b907f, completed successfully, and ran:

| Job | Result |
|---|---|
| verify | success |
| verify-windows | success |
| verify-browser | success |

The run completed at 2026-09-12T15:42:36Z. Run URL: https://github.com/Sephy57/visionscan-ai-eye-center/actions/runs/34702820629. The final report-only commit causes a separate CI run; its exact current-head result is reported in the final handoff.

## 8. Final git status

Before creating this report, the checkout was clean at 08c4048. After the report is added, committed, and pushed, the expected final state is a clean main checkout with no uncommitted source, data, or generated evidence changes. The final handoff rechecks status after the report commit.

## 9. Architecture

The system is a Next.js 16.3.4 App Router application with API routes, a local SQLite persistence layer, file-backed study and report storage, local Python inference bridges, durable research jobs, specialist evidence contracts, and browser acceptance harnesses. The runtime is designed as a controlled local research system, not as a clinical service.

## 10. Local inference

Installed fundus and OCT providers execute locally through bounded subprocess bridges. The application records model identity, version, artifact hash, preprocessing, modality, domain/OOD state, and execution provenance. The result contract is observation-oriented and requires professional review; it does not turn model output into a diagnosis, normality statement, or treatment authority.

## 11. Zero-paid-API verification

The observed model-validation and browser asset runs used local model packages and local storage. No paid inference API was invoked, and no hidden remote model path was used by the tested local workflow. Optional LLM configuration remains separate and is not required for the local model evidence.

## 12. Model inventory

| Model | Version | Artifact SHA-256 | State |
|---|---|---|---|
| fundus-dr-grading-effb0 | aa5741419b90 | 0d9a18b0cb6c90d1f30bf2e66153b368bd7ff0bcb45b6690e8d5ce14fa19f69b | RESEARCH_ONLY |
| fundus-lesions-clementp-unet-seresnext50 | a2cfcb594e483 | a7a7cb45b92328f7c9a8e581eec3944fd435d37fae8cbf340b1319c5f987c6d2 | RESEARCH_ONLY |
| oct-retinal-weights-fp32 | hf-main-2026 | 22b1fffb5a0ab88284d4c5817c581bedb1b54c09011d87c3f6472cb2c36b2b1f | RESEARCH_ONLY |
| segformer-optic-disc-cup-refuge | candidate | 22e45131b64eb07a5d29a2e5388a7709d10696b13f48d2d0cdcf56cafa1f9ea5 | isolated CANDIDATE_ONLY |

## 13. Model cards

Generated model cards and machine-readable evidence are in docs/model-validation/. They pin intended research use, inputs, outputs, preprocessing, license boundaries, validation limits, hashes, and failure registries. The generator reports phi_included:false and emits hashed case keys rather than raw evaluation identifiers.

## 14. Dataset inventory

| Evaluation export | Size | Separation/evidence |
|---|---:|---|
| DeepDRiD training export | 1,189 images, 299 patients | separation confirmed within the export |
| DeepDRiD validation export | 400 images, 100 patients | 0 patient overlap with the training export |
| APTOS capped export | 350 images | comparability only; separation unverifiable |
| IDRiD Task 2 lesion test | 27 images | patient/eye separation unverifiable |
| Kermany OCT test mirror | 1,000 scans, 250 per class | patient separation unverifiable |
| Duke Srinivasan | 3,231 scans, 45 subject folders | subject-separated folders |

## 15. Dataset licenses

The evaluation inventory records IDRiD and the Kermany mirror as CC-BY-4.0, Duke as research/educational-only, and publisher code/checkpoint declarations as MIT where reported. A model or code license does not automatically clear upstream dataset terms, derived weights, redistribution, or commercial use.

## 16. Patient separation

The DeepDRiD training and validation exports have confirmed patient separation with 299 training patients, 100 validation patients, and no overlap. Duke uses subject-separated folders. Patient-level separation is not verifiable for APTOS, IDRiD, or the Kermany mirror; those results are therefore overlap-disclosed technical comparisons, not independent patient-level validation.

## 17. DR validation

DeepDRiD validation n=400 produced accuracy 0.5025, balanced accuracy 0.2842, macro F1 0.2620, and quadratic weighted kappa 0.4950. At the referable threshold of grade 2 or higher, TP=79, FP=2, TN=218, FN=101, sensitivity=0.4389, specificity=0.9909, PPV=0.9753, NPV=0.6834, AUROC=0.8845, and AUPRC=0.8967. The score metrics are ranking evidence only.

## 18. DR false positives

The hashed DR failure registry contains 2 referable false-positive records. They are retained as overcall or threshold-transfer review candidates. The system does not assert the pathology or cause of either record.

## 19. DR false negatives

The hashed DR failure registry contains 101 referable false-negative records. Referable sensitivity is low at 0.4389, and the export materially undercalls higher grades: grade 3 sensitivity is 0.0441 and grade 4 sensitivity is 0.0000. These records are a bounded review queue, not explanations of clinical failure.

## 20. Lesion validation

On the 27-image IDRiD Task 2 export, aggregate Dice and IoU were:

| Class | Dice | IoU | Detection sensitivity |
|---|---:|---:|---:|
| MA | 0.4046 | 0.2536 | 1.0000, 27/27 |
| HE | 0.6649 | 0.4981 | 0.9630, 26/27 |
| EX | 0.7641 | 0.6182 | 1.0000, 27/27 |
| SE/CWT | 0.7115 | 0.5522 | 0.7143, 10/14 |

## 21. Lesion FP burden

Region-level false-positive burden is NOT_MEASURABLE. The export lacks a usable negative-image region table and persisted mask-level evidence. Zero exported detection false positives are not interpreted as zero false-positive regions.

## 22. Lesion FN analysis

Per-lesion false-negative analysis is NOT_MEASURABLE because aggregate exports do not identify individual lesions. The engineering failure analysis is NOT_RUN because independent cohort evidence, runtime dependencies, a pre-registered component rule, rights confirmation, and a reported failure image are unavailable.

## 23. OCT validation

On the Kermany mirror, OCT accuracy, balanced accuracy, and macro F1 were each 0.9770. Per-class sensitivity was CNV 0.9960, DME 0.9960, DRUSEN 0.9360, and NORMAL 0.9800. The error registry contains 23 hashed misclassification records. The publisher hybrid XGBoost head is not executed; the local provider executes the backbone argmax only.

## 24. OCT external validation

The Duke export contains 3,231 scans from 45 subjects. Subject-majority agreement was 42/45, or 0.933. Scan accuracy was 0.8437. Dry AMD is mapped only as a DRUSEN-proxy; Duke has no CNV reference class, so 112 dry-AMD to CNV predictions remain visible as out-of-label errors. This is domain-shift evidence, not clinical validation.

## 25. Calibration

No installed model has an accepted clinical calibration record. DR outputs are ordinal score rankings, not probabilities. OCT descriptive calibration reported mean absolute confidence error 0.55 and Brier 0.41 raw; the temperature trial reported 0.56 and 0.43 and was not adopted. Lesion masks are not probabilities.

## 26. Operating points

The governed research operating-point record is dr-fixed-round-rule-v1, the fixed ordinal rounding/clamping rule used to reproduce the displayed DR grade. It is not a clinical referral threshold and is not prevalence-, device-, subgroup-, prospective-, or reader-calibrated.

## 27. SegFormer evaluation

The isolated SegFormer candidate has hash 22e45131b64eb07a5d29a2e5388a7709d10696b13f48d2d0cdcf56cafa1f9ea5. It is anatomy-only research output for optic disc and cup segmentation, not a registered clinical model. The generic fundus probe observed optic-cup area 31,305 pixels versus optic-disc area 23,671 pixels, an implausible relationship that remains disclosed. No published task validation was established.

## 28. Glaucoma capability

There is no validated glaucoma classifier. The system does not produce a glaucoma probability, cup-to-disc risk claim, glaucoma diagnosis, or treatment recommendation. SegFormer anatomy output cannot be promoted into any of those claims.

## 29. Cornea capability

The cornea/external-eye lane has no artifact-backed validated local model. The specialist surface preserves missing evidence and routes to review rather than inferring normality from model absence.

## 30. Cataract capability

The cataract/lens lane has no artifact-backed validated local model. It is a structured research workflow and review surface, not a cataract classifier or diagnosis service.

## 31. Other specialties

Neuro-ophthalmology, pediatric ophthalmology, uveitis/inflammation, and ocular oncology also lack accepted validated local model packages. Comprehensive ophthalmology and retina are represented as application lanes, but lane presence is not model validation.

## 32. Specialist matrix

The exact specialty matrix is: COMPREHENSIVE, RETINA, GLAUCOMA, CORNEA_EXTERNAL, CATARACT_LENS, NEURO_OPHTHALMOLOGY, PEDIATRIC, UVEITIS, and OCULAR_ONCOLOGY. Each lane carries evidence state, missing confirmation, and review constraints. No lane is allowed to infer normality merely because no validated model is available.

## 33. Evidence graph

The evidence path is source asset to preprocessing and provenance to model execution to structured evidence to claim ledger to specialist/reviewer surface to report. Source hash, modality, laterality, domain state, model version, and execution status are preserved where available. Missing source bytes or missing provenance blocks replay and new reasoning.

## 34. Condition reasoning

Condition panels are gated by validated evidence and do not translate a pattern observation into a disease claim. Model disagreement, out-of-distribution state, unavailable source, insufficient quality, and uncertain evidence remain visible. The synthetic fundus result showed a suspicious region and required ophthalmic review without a diagnosis, normality conclusion, or probability.

## 35. Claim ledger

The claim-ledger implementation binds displayed claims to evidence references, execution provenance, and review state. Unsupported, contradictory, unavailable, or insufficient evidence is retained as blocked or uncertain rather than upgraded by language generation. The claim-ledger tests passed in the full suite.

## 36. Contradictions

Model disagreement is displayed as disagreement, not averaged into false certainty. Specialist corroboration is partial and independent reasoning guards prevent one unsupported model result from authorizing a second clinical claim. Contradictions remain review items.

## 37. Missing evidence

Material gaps remain in original source bytes, patient-level separation for several exports, independent clinical cohorts, lesion region-level FP/FN registries, calibration, subgroup evidence, clinical reader comparison, medication sourcing, performance SLOs, multi-worker capacity, and deployment hardening.

## 38. Medication source research

Medication source research found NO_DEFENSIBLE_SOURCE_FOUND. No connected, versioned, jurisdiction-scoped medication knowledge source was used to generate treatment content.

## 39. Medication registry

The medication registry is empty for actionable content. The UI and report state that no defensible source is connected; no drug, dose, frequency, contraindication, prescription, or treatment plan is shown.

## 40. Medication limitations

Medication output is unavailable by design until a publisher, version, license, jurisdiction, hash, update policy, rollback path, and clinical review process are established. The system must not fill this gap from model priors or unverified web text.

## 41. Prompt-injection defense

Document text is treated as untrusted data. Instruction-like text is classified and ignored by structured extraction, cannot change system behavior, and cannot create a clinical claim. Injection behavior is covered by regression tests and the 12-case Phase 3 synthetic acceptance pack.

## 42. Security

The checked system includes role-based access control, CSRF checks, patient-scope enforcement, consent gates, generic analysis failure responses, and local smoke accounts. The leak scan found no tracked credential, token, private key, or real-patient payload. Smoke credentials are test-only. Global CSP/HSTS, external TLS, disk encryption, and production deployment hardening were not established by this local review.

## 43. Consent

Purpose-specific consent is required for image model analysis and document extraction in the tested routes. Consent is explicit, persisted, and tested. Clinician review and finalization remain separate controls; no Confirm or Finalize clinical action was clicked during manual QA.

## 44. PHI

Generated model registries, validation cases, SBOM, closure plans, and screenshots report phi_included:false or contain only synthetic context and hashed keys. The ignored data tree remains PHI-capable because it contains uploads, documents, reports, databases, backups, logs, and model artifacts; those paths were not added to Git.

## 45. Active data blockers before

The current active source review identified 235 blockers: 233 MISSING_REQUIRED_ARTIFACT findings and 2 DETACHED_ANALYSIS_PARENT findings. These are source and replay blockers, not merely cosmetic database warnings.

## 46. Active data blockers after

The read-only closure dry run left all 235 findings unchanged: recoverable=0, retireable=0, active_lost=2, ambiguous=233, mutation=false, source rows changed=0, files changed=0, audit events written=0. The release-data gate remains BLOCKERS_REMAIN and active_data_release_safe=false.

## 47. Recovered sources

Recovered sources: 0. Exact digest matches were not promoted because identity, scope, and provenance requirements were not simultaneously satisfied.

## 48. Retired sources

Retired sources: 0. No record was deleted, reparented, relabeled, or retired without explicit evidence and immutable operator review.

## 49. Remaining lost sources

The active set retains 2 active-lost detached analyses and 233 ambiguous missing-artifact findings. The trusted search scanned 69,353 files and saw 91,745 exact digest matches; all 91,745 were rejected for scope or provenance. Exact bytes alone do not prove source identity.

## 50. Legacy references

The legacy closure dry run found 5,263 detached references: 5,260 documents, 2 analyses, and 1 job. The current release-data check also reports 107 legacy unresolved source conditions: 59 missing required artifacts and 48 missing report exports. No legacy row was silently removed or promoted.

## 51. FK status

The release checks report active FK orphans=0, cross-tenant violations=0, source-hash mismatches=0, and quarantine records=81. Application-level relation preflight still reports 5,263 legacy orphan references, and direct FK migration safety is false while those legacy exceptions remain. Zero active FK orphans does not clear source replay blockers.

## 52. Worker architecture

The durable queue records creation, claim, start, completion, lease, heartbeat, retry, and cancellation state. Defaults are a 15-minute lease, 30-second heartbeat, 60-second recovery grace, exponential retry backoff, and at most three attempts. scripts/worker.ts provides a separate worker process; a worker pass clamps maxJobs to 1.

## 53. Worker crash recovery

The crash suite demonstrates stale recovery after a temporary child claims work and exits. Lease fencing and reclaim tests pass. The current evidence does not yet kill a real worker at provider execution, persistence, report finalization, heartbeat, OOM, DB-lock, or process-tree boundaries, and no orphan-child assertion or overall processJob deadline is established.

## 54. CPU

The observed host is Windows and CPU-only. Fundus probes request four threads. Effective host CPU utilization, capacity under load, and safe multi-worker concurrency were not measured.

## 55. Peak RSS

Historical sampled process-tree peak working sets were: lesion 1,340,567,552 cold and 1,393,590,272 warm bytes; DR 441,774,080 cold and 441,843,712 warm; OCT 1,069,690,880 cold and 1,069,977,600 warm; SegFormer 1,235,030,016 cold and 1,244,504,064 warm. These are Windows working-set samples, not portable RSS high-water marks.

## 56. Model latency

Historical three-run fresh-process p50/p95 values were lesion 8,601.1/9,374.8 ms cold and 8,550.5/8,978.9 ms warm; DR 5,313.2/5,354.3 and 5,326.2/5,389.3; OCT 3,130.1/4,161.0 and 3,118.6/3,138.4; SegFormer 9,959.1/16,307.5 and 9,751.3/10,164.2. A later bounded one-run diagnostic exited 0 but timed out lesion cold/warm, DR cold, and SegFormer cold; partial benchmarks are not capacity results.

## 57. Thread limits

Only the fundus probe thread request is uniform enough to cite: four threads. Inter-op, OpenMP/MKL, ONNX Runtime, and SegFormer thread budgets are not uniformly pinned. Provider mutexes are process-local, so multiple workers can still launch multiple heavy subprocesses.

## 58. Landing page

The landing surface showed a research-environment banner, validation-first positioning, synthetic visual labeling, human-review language, and the explicit non-clinical boundary. Persisted screenshot: docs/qa/screenshots/landing.png.

## 59. Dashboard

The dashboard showed MODEL STATUS RESEARCH, SYSTEM STATUS Operational, locally stored study status, and a clinical-correlation queue state. Persisted screenshot: docs/qa/screenshots/dashboard.png.

## 60. Analysis workspace

The intake surface showed pseudonymous identifier guidance, upload restrictions, provenance and quality guardrails, research-only status, and purpose-specific consent controls. Persisted screenshots: docs/qa/screenshots/intake.png and docs/qa/screenshots/processing.png.

## 61. Viewer

The result/viewer surface showed original pixels separately from the research overlay, laterality, original hash, modality/device/domain state, model disagreement, uncalibrated score language, and required ophthalmic review. Persisted screenshots: docs/qa/screenshots/result.png and docs/qa/screenshots/result-evidence.png.

## 62. Specialist board

The specialist board showed all nine lanes, partial corroboration, blocked or failed evidence states, missing confirmation, and independent reasoning guards. Persisted screenshots: docs/qa/screenshots/specialist-board.png and docs/qa/screenshots/specialist-review.png.

## 63. Report

The report surface showed research banners, model execution and provenance, limitations, non-clinical safety language, no active production target, and no medication source. Persisted screenshot: docs/qa/screenshots/report.png.

## 64. Demo

The controlled local demo is CLIENT DEMO READY for research software workflow demonstration. It is not a clinical demo, does not release patient conclusions, and does not authorize diagnosis, treatment, or autonomous action.

## 65. Screenshot QA

Persistent local Chromium/CUA manual inspection saved 15 PHI-free PNGs under docs/qa/screenshots/, with byte lengths and SHA-256 values indexed in docs/qa/screenshots/README.md. The screenshots use synthetic or empty-state context. No clinician Confirm or Finalize action was clicked. No real PDF page or real OCT ROI screenshot was created.

## 66. Responsive

The real-browser responsive harness passed 80/80 across 10 routes at widths 320, 375, 414, 768, 1024, 1280, 1440, and 1920 pixels.

## 67. Accessibility

The real-browser accessibility harness passed 20/20 at 320 and 1280 pixels. A small-screen settings contrast/link-in-text-block issue was fixed with visible link underlines and the suite was rerun.

## 68. Keyboard

The real-browser keyboard harness passed 21/21, including skip links, focus targets, bounded Tab walks, and the mobile drawer interaction.

## 69. Console errors

No console errors were observed during the manual CUA run. Browser asset E2E passed the metadata-free fundus flow, mixed PDF extraction, three routed pages, eight OCT ROI candidates, and report provenance. The absence of console errors is not a clinical safety claim.

## 70. Acceptance pack

The Phase 3 model-validation pack contains exactly 12 bounded synthetic cases covering DR, lesion segmentation, OCT in-distribution and domain-shift evidence, SegFormer anatomy-only scope, specialty coverage, absent medication source, prompt injection, data-closure dry run, and UI research boundary. No case contains PHI or a clinical diagnosis claim.

## 71. Hallucination tests

Claim-ledger, safety, report, condition, specialist, and full red-team tests passed. They enforce evidence-bound observations and refusal of unsupported clinical conclusions. The project does not claim zero hallucinations; it claims tested controls and remaining limitations.

## 72. Injection tests

Prompt-injection regression tests passed, and the Phase 3 static security check confirms the analysis route returns ANALYSIS_FAILED without exposing err.message or String(err) content. Extracted document instructions cannot alter system behavior or create a claim.

## 73. Full unit totals

The final local full suite exited 0: 75 test files passed, 1 was skipped; 1,028 tests passed and 10 were skipped. The run emitted expected PDF font-data warnings and negative-path child-process messages; these did not change the successful exit.

## 74. TypeScript

The command npx tsc --noEmit --incremental false --pretty false exited 0 after the final source changes.

## 75. lint

The command npm run lint exited 0 after the final source changes.

## 76. build

The final local npm run build exited 0. Next.js 16.3.4 compiled successfully, TypeScript completed, all 21 static pages generated, and the production bundle finalized. The exact pushed CI also passed production builds on Linux and Windows.

## 77. smoke

The local smoke run exited 0 with SMOKE RESULT: 16/16 passed, including the ADMIN self-test endpoint at 15/15. Consent gates were included in the smoke path.

## 78. model audit

The model manifest audit exited 0 with 3/3 installed manifests passing. All installed model manifests remain research-only. The isolated SegFormer candidate is not counted as a validated glaucoma model.

## 79. filesystem audit

The filesystem audit exited 0. Project and data paths resolved on D:, the available-space check reported approximately 390 GB free, and no broad whole-drive operation was used.

## 80. SBOM

The de-identified SBOM command exited 0 and wrote data/tmp/phase3-sbom.json. The generated evidence does not include patient names, MRNs, DOBs, credentials, or raw evaluation identifiers.

## 81. backup/restore

Backup/restore integrity tests passed in the full suite, and the release pack includes a read-only backup plan. A fresh production backup/restore rehearsal is still required before any destructive source retirement or database repair.

## 82. clean checkout

The clean-checkout gate requires a no-model detached worktree to run npm ci, setup, database initialization, lint, TypeScript, and build, while model-equipped evidence remains tied to the original D: checkout with hash-verified artifacts. The fresh no-model worktree is created and checked without copying PHI-capable data or large model weights; the final handoff records its exact path and command results.

## 83. current-head CI

The exact verified implementation head 08c40489f23bd6de8b312f3dd188937e166b907f has a completed successful CI run 34702820629 with verify, verify-windows, and verify-browser all successful. The report-only commit is a separate current-head check and is not conflated with this implementation evidence.

## 84. Software classification

ENGINEERING PARTIAL — BLOCKERS REMAIN. The software architecture, safety controls, tests, and controlled local workflow are strong enough for continued local engineering and research demonstration, but performance, deployment hardening, and unresolved data conditions prevent a production release claim.

## 85. Model classification

MODEL INTELLIGENCE PARTIAL. Three local research artifacts have reproducible technical measurements and one isolated anatomy candidate is bounded, but evidence is not sufficient for clinical validation, device validation, diagnosis, normality, or treatment.

## 86. Demo classification

CLIENT DEMO READY. The controlled local research workflow, review surfaces, consent gates, synthetic browser asset flow, and persisted UI evidence are demonstrable with the exact disclosures in this report.

## 87. Data classification

DATA RELEASE BLOCKED. Active source findings remain 235, legacy unresolved source conditions remain 107, and legacy detached references remain 5,263. The dry run made no mutation and recovered no source.

## 88. Clinical classification

RESEARCH-ONLY SOFTWARE. The system presents bounded model observations and provenance for professional review; it is not clinically validated and must not be used as a diagnostic or treatment service.

## 89. Exact capability boundary

NOT CLINICALLY VALIDATED

NOT A MEDICAL DEVICE

NOT FOR AUTONOMOUS DIAGNOSIS

The system also does not claim disease absence, clinical probability, treatment authority, or patient-release readiness.

## 90. Remaining blockers

Release remains blocked by:

- 235 active source findings: 233 missing required artifacts and 2 detached analysis parents;
- 5,263 legacy detached references and 107 legacy unresolved source conditions;
- absent independent clinical validation, calibration, subgroup evidence, and reader comparison;
- lesion region-level FP/FN evidence that cannot currently be measured;
- no defensible medication source;
- incomplete host-wide concurrency, memory, queue-SLO, and real-worker crash evidence;
- incomplete production deployment hardening such as external TLS, disk encryption, and security-header proof;
- required operator adjudication, backup/restore rehearsal, and immutable audit evidence before any source retirement or repair.

The safe next state is continued controlled research engineering with the blockers visible and a fresh release-data gate after each evidence or data-governance change.
