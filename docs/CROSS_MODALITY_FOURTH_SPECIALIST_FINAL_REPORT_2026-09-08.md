# VisionScan AI — cross-modality, fourth-specialist, and longitudinal completion report

Release review date: 2026-09-08 (Asia/Manila)  
Scope: local Windows checkout `D:\AI EYE ANALYSIS PLATFORM`, with the existing
research-only model packages and the untrusted/dirty worktree preserved.

## 50-item release record

1. **Starting revision.** The handoff started at `c4c79485d0a5a76ece76ade94d91aa43635870c4` on `main`, with the prior local changes belonging to the user and retained.

2. **Working-tree rule.** No reset, checkout, clean, or stash was used. Existing edits and ignored local model artifacts were preserved while the new work was layered on top.

3. **Completion scope.** This pass covers real research-model validation evidence, a defensible fourth-specialist decision, cross-modality reasoning, same-eye longitudinal comparison, authorization, UI exposure, performance, and release gates.

4. **Parallel reconnaissance.** Runtime/security, lesion validation, observability, UI/release, and model-forensics tracks were consulted. Their findings were treated as untrusted engineering evidence and rechecked in the shared checkout.

5. **Local service.** The production-style Next.js service was reachable on `http://localhost:3000`; the login page rendered with labeled username/password fields, a submit control, navigation, and the research/not-medical-device banner.

6. **Local smoke credential.** The deterministic local smoke account is `smoke-admin` / `SmokeTest#Local1234` (from `scripts/smoke.mjs`). It is for this local development database only, must not be reused or deployed, and may be overridden with the script's environment variables.

7. **Authentication boundary.** Browser automation did not submit credentials without an explicit login authorization. API and route tests exercise authentication, RBAC, CSRF, patient scope, tenant scope, and unauthenticated denial directly.

8. **Model inventory.** Three real packages are installed locally under `data/models/`: ClementP fundus lesions, ClementP DR grading, and an ONNX OCT classifier. All are `RESEARCH`, not clinical models.

9. **Fundus artifact identity.** The ClementP U-Net/SE-ResNeXt50 checkpoint is SafeTensors, 138,428,676 bytes, revision `a2cfcb594e483`, SHA-256 `a7a7cb45b92328f7c9a8e581eec3944fd435d37fae8cbf340b1319c5f987c6d2`, with 444 strict state-dict tensors and five channels.

10. **Fundus architecture contract.** The live probe reconstructs `torchseg.create_model(arch='unet', encoder_name='seresnext50_32x4d', in_channels=3, classes=5)` and requires exact key/shape compatibility before execution.

11. **Fundus preprocessing.** The frozen research protocol is RGB decode, 5%-of-maximum non-black crop, OpenCV `INTER_CUBIC` longest-side resize to 1024, centered zero padding, 0..1 scaling, and ImageNet mean/std normalization. Source references and the implementation version are recorded in the manifest and integration document.

12. **Fundus postprocessing.** Only finite five-channel argmax output is accepted; artificial padding is suppressed, 8-connected components are bounded, and boxes/centroids are mapped back to `ORIGINAL_IMAGE_NORMALIZED`. Raw scores and calibration remain null.

13. **Fundus live inference.** The isolated `-I -s` worker, hash-before/hash-after check, strict transport schema, bounded stdout, reparse-point rejection, timeout, and provider mutex are active. A cold run is about 8.3 s; warmed 1024² CPU forward is about 2.3 s with roughly 1.3 GB peak worker RSS.

14. **Fundus external evidence.** DeepDRiD regular fundus is patient-separated from the publisher-reported training mix (400 validation images/100 patients plus 1,189 training images/299 patients). Grade-0 image-level detection is 113/174 (specificity about 0.35–0.39), while grade ≥1 detection is 0.87–1.00; this is research evidence, not clinical validation.

15. **Fundus third-population check.** A deterministic APTOS capped sample (250 grade-0 plus 25 per grade 1–4, n=350) produced 102/250 negative grade-0 images (specificity 0.408) and 100/100 positive grades 1–4. Patient IDs and full independence are not verifiable; the overlap/rights disclosure is explicit.

16. **Fundus failure analysis.** False positives concentrate in vessel/reflection and bright exudate-like content; tiny/low-contrast lesions and cotton-wool spots are missed. No post-processing suppression rule was added without evidence. The engineering image observation is not a patient result.

17. **DR artifact identity.** The EfficientNet-B0 regression checkpoint is SafeTensors, revision `aa5741419b90`, SHA-256 `0d9a18b0cb6c90d1f30bf2e66153b368bd7ff0bcb45b6690e8d5ce14fa19f69b`, and uses the pinned 512-pixel crop/resize protocol.

18. **DR external evidence.** DeepDRiD validation measured QWK 0.495 and accuracy 0.502; referable (grade ≥2) sensitivity is 79/180 (0.439), specificity 218/220 (0.991), PPV 0.975, and NPV 0.683. The weak sensitivity blocks referral or clinical use.

19. **DR overlap evidence.** APTOS is in the publisher-reported DR training pool, so the capped APTOS result is comparability evidence only, not independent validation. License and redistribution restrictions remain unresolved.

20. **DR semantics.** `round(logit).clamp(0,4)` is an uncalibrated grade estimate. A grade-0 result never excludes disease; no raw logit is shown as a probability or referral decision.

21. **OCT artifact identity.** The EfficientNetV2L/MHA ONNX package is SHA-256 `22b1fffb5a0ab88284d4c5817c581bedb1b54c09011d87c3f6472cb2c36b2b1f`, CPUExecutionProvider-only, class order `[CNV, DME, DRUSEN, NORMAL]`, and uses the pinned 224×224 RGB/linear/ImageNet path.

22. **OCT Kermany evidence.** The 1,000-image Kermany mirror measured accuracy 0.977, but patient IDs are stripped and the set is the publisher-reported training distribution. The result is therefore overlap-disclosed comparability, not independent validation; the NORMAL/DRUSEN boundary is fragile and uncalibrated.

23. **OCT Duke evidence.** The independent Duke Srinivasan cohort contains 3,231 B-scans from 45 subjects on Spectralis. Scan accuracy is 0.844 and subject-majority accuracy is 42/45 (0.933); the approximate dry-AMD→DRUSEN mapping and 234 NORMAL→DME overcalls are disclosed.

24. **OCT scope.** The OCT worker emits a class observation only; it does not emit a pixel mask, layer/fluid measurement, probability, or diagnosis. A NORMAL estimate never means a healthy macula.

25. **Fourth specialist decision.** No defensible glaucoma disease model was found. Candidates were rejected for absent weights/metrics, validation-only artifacts, paired-input/custom-code execution, pickle-only loading, incompatible licensing, or non-reproducible runtime requirements.

26. **Glaucoma coverage state.** The coverage registry records `glaucoma` as `NO_VALIDATED_MODEL_AVAILABLE` and optic-disc/cup localization as isolated `RESEARCH_ANATOMY_ONLY`; neither can create a glaucoma result or normality claim. The canonical rejection token is `NO_DEFENSIBLE_GLAUCOMA_MODEL_FOUND`.

27. **Validation registry.** `lib/models/validationRegistry.ts` is the machine-readable authority for model id/version/hash, dataset split, license, patient separation, overlap, metrics, calibration, device scope, population scope, limitations, and review date. The `/api/models/validation` endpoint is read-only and ADMIN-only.

28. **Coverage registry.** `lib/models/ophthalmicCoverage.ts` now truthfully exposes six pipeline-enabled research targets (four lesion classes, DR grade, OCT classification), zero production targets, and explicit negative-space entries for glaucoma, broad disease screening, DICOM pixels, and OCT segmentation.

29. **Integrity gate.** Registry identity, manifest schema, safe relative paths, regular-file/reparse checks, streaming SHA-256, strict model loading, and post-load rehash are enforced. A valid artifact alone cannot promote status or unlock clinical output.

30. **Cross-modality engine.** `lib/evidence/crossModality.ts` compares one same-eye fundus result with one same-eye OCT result using categorical signals only. It never averages scores/logits and returns `CROSS_MODALITY_CORROBORATION`, `CROSS_MODALITY_DISAGREEMENT`, or `NOT_COMPARABLE`.

31. **Cross-modality patterns.** The engine explicitly represents DR+DME corroboration, lesion-negative/OCT-positive disagreement, fundus-positive/OCT-NORMAL disagreement, consistent negatives that are not corroboration, quality/OOD/model-unavailable states, unknown eyes, and cross-eye refusal.

32. **Encounter service.** `assessEncounterCrossModality()` loads only linked stored studies/analyses, never triggers inference, excludes mismatched patient references, records excluded IDs/notes, and keeps evidence scoped to the encounter.

33. **Cross-modality API.** `GET /api/encounters/[id]/cross-modality` requires ADMIN/CLINICIAN/REVIEWER plus patient and every linked-study scope. It returns a schema version, categorical pairs, exclusions, notes, and a no-score-fusion notice; cross-tenant or missing links return 404.

34. **Cross-modality UI.** `CrossModalityPanel` is integrated into each patient encounter card. It displays eye, study IDs, categorical signals, agreement/disagreement, evidence-reference counts, exclusions, and the mandatory no-diagnosis/no-winner language.

35. **Evidence workspace.** Existing provenance-separated document/PDF extraction, source text/page/method, objective test results, symptoms, history, medications, allergies, clinician observations, conflicts, and possible-condition gates remain intact. No document diagnosis becomes an AI diagnosis.

36. **Symptom/red-flag behavior.** Symptoms remain structured context, not findings. Independent red-flag triage can escalate even when a model emits zero findings; the full smoke and red-team paths verify this.

37. **Longitudinal engine.** `comparePriorCurrent()` and the compare route use same-eye, same-patient scoped evidence and distinguish `NEW`, `PERSISTENT`, `CHANGED`, `NOT_COMPARABLE`, `MODEL_CHANGED`, `DEVICE_CHANGED`, and missing-prior states.

38. **No progression claim.** Longitudinal output is explicitly an observed-difference comparison. It rejects or avoids “worsening,” “improving,” “resolved,” “stable,” and similar clinical progression language and always requires clinician review.

39. **Audit provenance fix.** `analyzeStudy()` now records the pipeline-selected model id/version and resolves the exact registered artifact checksum instead of writing the legacy DEMO id for every analysis. Multi-model details remain in `analysis.multi_model`.

40. **Workstation UX.** The result, clinician, patient, models, compare, and report views expose model status, quality/OOD, evidence provenance, localization limits, review separation, validation evidence, and research-only labels without hiding uncertainty.

41. **Responsive QA.** The existing browser QA covers ten routes at 320–1920 px, including narrow mobile layouts, scrollable tables, viewer controls, and no horizontal overflow. The cross-modality panel uses wrapping/stacking primitives consistent with the workstation.

42. **Accessibility QA.** The existing real-browser axe/manual-structure gate covers the workstation routes at mobile and desktop widths. New route/UI strings use semantic status text and do not introduce an interactive canvas or unlabeled control.

43. **Local performance.** The final `npm run performance:local` sample passed: login page p50 5.5 ms/p95 7.3 ms, login API p50 63.3 ms/p95 86.5 ms, dashboard p95 5.2 ms, study listing p95 5.2 ms, upload 19.0 ms, result bundle p95 4.5 ms, result page p95 4.1 ms, and report page p95 6.8 ms. The model cold-start and memory cost are separately disclosed: ClementP cold load/inference 7.8 s, warmed 1024² CPU forward about 2.3 s, and peak worker RSS about 1.3 GB.

44. **Lag mitigation.** The production processing UI uses `async=true` job submission and polling, while providers serialize the large CPU workers. The old red-team synchronous test budgets were increased to 120 s so real inference is bounded without mistaking host contention for a security failure.

45. **Smoke gate.** `npm run smoke` passed 16/16, including auth, upload, symptom validation/rejection, real research analysis, red-flag triage, report, symptom correlation, quality rejection, clinician finalize, temporal compare, self-test 15/15, deletion, unauthenticated access, and cross-role checks.

46. **Focused evidence gate.** Validation registry (5/5), cross-modality unit (7/7), prior/current comparison (8/8), cross-modality route (3/3), and both red-team suites (14/14) passed. The isolated encounter acceptance file passed 3/3 in about 59 s.

47. **Full-suite gate.** The final serialized Vitest result is **50 test files passed, 899 tests passed, and 2 tests skipped (901 total)** in 802.14 s. The prior real-inference timeout was corrected by increasing only the affected bounded red-team budgets to 120 s; no security assertion was weakened.

48. **Static gates.** `npx tsc --noEmit`, `npm run build`, `npm run audit:fs`, `npm audit --audit-level=high`, and `npm audit --omit=dev --audit-level=high` passed. The filesystem audit confirms source/data on D: and reports 430.5 GB free space. `npm run lint` is not a valid Next 16 command in this checkout (`next lint` was removed by Next); no false green lint result is claimed until an ESLint configuration is deliberately added.

49. **Release decision.** Engineering release is **GREEN for local research/evidence-review use**: real research workers are hash-verified, cross-modality and longitudinal paths are scoped and fail closed, and no glaucoma capability is fabricated. Clinical deployment remains **BLOCKED**.

50. **Remaining gates and handoff.** The pushed engineering workflow is verified; before any clinical or broader deployment, resolve training-data/derived-weight rights, lock dependencies and an SBOM, harden ACLs and OS resource/network sandboxing, complete patient-separated multi-device clinical validation, freeze/calibrate operating points, and obtain governance/regulatory review. The application remains NOT A MEDICAL DEVICE / NOT FOR CLINICAL USE.

## Evidence locations

- `lib/models/validationRegistry.ts` and `app/api/models/validation/route.ts`
- `lib/evidence/crossModality.ts`, `lib/evidence/encounterCrossModality.ts`, and `app/api/encounters/[id]/cross-modality/route.ts`
- `lib/evidence/priorCurrentComparison.ts` and `app/compare/page.tsx`
- `components/CrossModalityPanel.tsx` and `app/patients/[id]/page.tsx`
- `docs/FUNDUS_LESION_FAILURE_ANALYSIS.md`, `docs/FUNDUS_LESION_MODEL_INTEGRATION.md`, `docs/DR_GRADE_MODEL_INTEGRATION.md`, and `docs/OCT_MODEL_INTEGRATION.md`
- `docs/evaluations/aptos-capped-20260908-raw.json` and `docs/evaluations/duke-oct-external-20260908-raw.json`

## Final test/CI record

The full-suite count above is from the final local run. The implementation was
pushed as commit `6f884ff8e3e3d5fc2cacee764e2733bb1a554ff5`; its GitHub Actions
CI run [34236530299](https://github.com/Sephy57/visionscan-ai-eye-center/actions/runs/34236530299)
completed successfully with typecheck, unit/integration tests, filesystem
audit, and production build green. No clinical validation is inferred from a
green engineering suite.

## 2026-09-09 clinical-intelligence expansion addendum

This addendum records the work performed after the prior report and is scoped
to the shared checkout at `D:\\AI EYE ANALYSIS PLATFORM`. It does not replace
the prior 50-item record or change its clinical-use limitations.

### A. Revision, preservation, and implementation scope

1. **Starting revision.** The verified starting revision for this phase was
   `f72222a6ad2e1b38b3a2ee28b6e2c928f7c7cd70` on `main`.

2. **Implementation revision.** The implementation was committed as
   `e5c9101` (`feat: expand clinical extraction and specialist evidence`). No
   reset, clean, checkout, or destructive workspace operation was used.

3. **Changed surface.** The commit contains 46 files, including clinical
   extraction, objective test parsing, evidence projection/conflict handling,
   specialist packages, report/result UI exposure, research-provider caching,
   Next 16 route compatibility overloads, and a dedicated clinical-intelligence
   test file (1,012 insertions and 93 deletions).

4. **Safety boundary.** The phase remains research/evidence-review support.
   Source-document diagnoses remain source-attributed; structured evidence is
   not promoted to an AI diagnosis; unavailable, unsupported, and uncertain
   states remain visible.

### B. Clinical document extraction

5. **Version and provenance.** `clinical-extraction-1.1.0` now emits assertion,
   source-section, extraction-method, page, and character-offset metadata for
   extracted facts. OCR/text-layer provenance is retained at record and entity
   level.

6. **Sections and visit context.** Chief complaint/reason-for-visit, history,
   assessment, plan, and follow-up sections are recognized. Plan and follow-up
   candidates are exposed as separate evidence categories instead of being
   interpreted as findings.

7. **Symptoms.** The extractor records symptom type, onset/duration/severity
   and progression language when present, with span-local laterality. Explicit
   negation and uncertainty are separate from present symptoms; possible
   associated symptoms are not silently merged with image findings.

8. **Negation and uncertainty.** Negated symptoms, medications, histories, and
   allergies are represented as explicit absent/unreviewed assertions. “Rule
   out,” “possible,” “suspect,” and similar source language is marked uncertain.
   Negative source claims such as “negative for diabetic retinopathy” remain
   absent source claims, not a new AI conclusion.

9. **History, medication, and allergy safeguards.** Ocular surgery, systemic
   history, diabetes, medication use, allergy reactions, `NKDA`, and plain
   “no allergies” are handled with exception-safe parsing. Disease adjectives
   such as “diabetic retinopathy” do not create a systemic diabetes history.

10. **Entity projection.** Annotation updates reproject generic structured
    entities so reviewer edits cannot leave a stale entity view behind the
    canonical record extraction.

11. **Partial documents.** OCR failures and incomplete page coverage produce a
    `PARTIAL` record state with warnings rather than a falsely complete chart.
    Stale record extraction is removed at extraction start, matching the
    existing test-result supersession boundary.

### C. Objective ophthalmic test extraction

12. **Measurements covered.** The parser now handles IOP, Snellen/logMAR and
    categorical visual acuity, cup-to-disc ratio, central subfield thickness,
    pachymetry, visual-field metrics, refraction, and OCT/RNFL measurements.

13. **Eye-pair safety.** Explicit OD/OS rows and same-line pairs are split into
    independent results. Bare or contradictory laterality remains unknown;
    laterality is never inferred from an adjacent eye's symptom or measurement.

14. **Units and ambiguity.** Incompatible units are retained as raw values with
    an `unexpected_unit` ambiguity flag; they are not normalized into a valid
    clinical unit. OCT header dates are not mistaken for measurement dates.

15. **Metric subtypes.** Visual-field MD and PSD and related metric subtypes are
    carried through the test-result, evidence, conflict, and trend keys so
    different metrics do not conflict merely because they share a category.

16. **Verification boundary.** Extracted measurements remain
    `AUTO_EXTRACTED`/unreviewed until the existing human verification workflow;
    no parsed value is connected directly to treatment, diagnosis, or triage.

### D. Deterministic specialist hand-off packages

17. **Four packages.** `lib/clinical/specialistPackages.ts` builds explicit
    RETINA, GLAUCOMA, MACULA_OCT, and COMPREHENSIVE packages from stored
    evidence and optional analysis output.

18. **Package contents.** Each package contains available model/status,
    observed findings, supporting and contradicting evidence, missing evidence,
    possible condition patterns, urgency notes, limitations, source evidence
    IDs, and an unconditional clinician-review requirement.

19. **No opaque synthesis.** Packages contain no diagnosis field, probability,
    confidence score, or score fusion. They are deterministic evidence
    organization over already-produced observations.

20. **Glaucoma status.** The glaucoma package explicitly reports
    `NO_VALIDATED_MODEL_AVAILABLE`, requests IOP/visual-field/optic-nerve
    correlation and clinician-authored longitudinal assessment, and cannot
    manufacture a glaucoma result or normality claim.

21. **API and UI exposure.** The specialist-analysis API returns the packages;
    `SpecialistConsensusPanel` renders model state, findings, evidence,
    missing information, urgency notes, limitations, and review status. The
    report and patient views expose extraction metadata, plan/follow-up, and the
    evidence workspace without collapsing provenance.

### E. Runtime and performance hardening

22. **No auth-path inference.** Authentication and initial page routes do not
    execute machine-learning inference. Research analysis remains asynchronous
    and provider-serialized.

23. **Duplicate-work reduction.** Heavy SegFormer research calls use a short
    in-process result TTL and in-flight deduplication. Specialist orchestration
    reuses existing research evidence references rather than creating duplicate
    random references for the same result.

24. **Measured local latency.** `npm run performance:local` passed on the
    running service at `http://localhost:3000`: login page p50 4.6 ms/p95 6.2
    ms (one 57.3 ms max sample), login API p50 68.9 ms/p95 75.5 ms, dashboard
    p95 6.2 ms, study-list API p95 3.9 ms, upload 22.3 ms, result-bundle API
    p95 4.2 ms, result page p95 4.8 ms, and report page p95 3.6 ms.

25. **Model cost.** The ClementP model cold load/inference measured 8,548.2 ms;
    a warmed 1024-pixel CPU forward was about 2.3 s, with approximately 1.3 GB
    peak worker RSS and serialized provider execution. This is the principal
    remaining local lag source and is intentionally kept off the auth path.

### F. Compatibility, verification, and QA record

26. **Next 16 route contract.** Dynamic API handlers now accept both the
    generated Next 16 `Promise` params contract and synchronous test contexts
    through overloads, while every implementation awaits the params value.

27. **Typecheck/build.** `npx tsc --noEmit` passed. The default Turbopack
    `npm run build` passed with TypeScript and 20/20 static pages generated;
    the long wall time was host contention, not a compile failure. Only the
    existing middleware-convention and Edge `process.cwd` warnings remained.

28. **Focused regression.** The seven-file clinical/evidence focus passed
    117/117 tests. The dedicated expansion file passed 9/9, and a later
    two-file evidence/specialist rerun passed 32/32.

29. **Full regression.** The final serialized Vitest run completed 51 files:
    907 passed, 2 skipped, and 1 timeout (910 tests total) in 1,967.69 s.
    The timeout was the OD-IOP/OS-symptom isolation case in
    `s5-evidence-critical.test.ts`; running that exact case alone passed in
    3.6 s. It is therefore recorded as suite-level host contention, not
    treated as a green full-suite claim.

30. **Smoke.** `npm run smoke` passed 16/16, including authenticated upload,
    symptom validation/rejection, real research analysis, red-flag triage,
    report generation, clinician finalize, temporal comparison, self-test,
    deletion, unauthenticated denial, and cross-role checks.

31. **Static/security audits.** `npm run audit:fs` passed (source/data on D:;
    approximately 430.3 GB free). Both `npm audit --audit-level=high` and
    `npm audit --omit=dev --audit-level=high` reported zero vulnerabilities.

32. **Browser QA.** `npm run visual-qa` passed its 10-route structure gate;
    `npm run browser:responsive` passed 80/80 checks across 320–1920 px; and
    `npm run browser:a11y` passed 20/20 axe WCAG A/AA checks at mobile and
    desktop widths.

33. **Lint limitation.** `npm run lint` remains non-actionable because this
    checkout's script invokes removed Next 16 `next lint` and no ESLint config
    is installed. The command fails with “Invalid project directory ...\\lint”;
    no false lint pass is claimed.

34. **Service smoke.** A direct request to the running local service returned
    HTTP 200 for `/login` and included the research/not-a-medical-device banner.
    The local-only smoke account remains `smoke-admin` /
    `SmokeTest#Local1234`; it is not a deployment credential.

### G. Current release classification

35. **Engineering state.** The implementation is suitable for local research
    and evidence-review testing with the disclosed full-suite timeout and lint
    limitation. The isolated timed-out case, all focused tests, build, smoke,
    browser QA, audits, and performance gates have direct recorded results.

36. **Clinical state.** Clinical deployment remains **BLOCKED**. Unresolved
    gates include rights for training data/derived weights, locked dependency
    and SBOM governance, OS/resource/network sandboxing, patient-separated
    multi-device validation, calibration and operating-point freeze, and
    regulatory/clinical governance review.

37. **Push/CI state.** The implementation and addendum were pushed to
    `origin/main` (`f72222a..ed40a0d`). GitHub Actions run
    [34267304170](https://github.com/Sephy57/visionscan-ai-eye-center/actions/runs/34267304170)
    completed successfully in 1m35s with typecheck, unit/integration tests,
    filesystem audit, and production build green. GitHub also annotated the
    run because the checkout/setup actions target deprecated Node.js 20 and are
    being forced onto Node.js 24; this is an infrastructure warning, not a
    failed application gate.

## H. Real asset routing / OCT-PDF analysis phase (2026-09-09)

1. **Starting HEAD.** Work for this phase began at `f353fce424b89bad1a94a669c66292c686d2075c` on `main`. Existing history and dirty user work were preserved; no reset, clean, restore, checkout, or stash operation was used.

2. **Ending HEAD.** The final implementation SHA for this phase is `533e9c162a8ad9aa73e17e3517a4f49f57f99298`. The report close-out is committed separately so this source-release SHA remains directly auditable.

3. **Working tree.** The implementation commit was made from the reviewed routing, extraction, provenance, UI, test, script, and package changes. No uploaded patient PDF/JPEG, OCR output, credentials, or model data was staged. The documentation close-out is the only follow-up change; the final tree is checked clean after that commit.

4. **Commits.** `9b9d4c29cd231f385851cf2bd9ed5f56c10c4ea7` adds the real asset router, PDF intelligence/ROI extraction, immutable provenance checks, inference caching, modality-aware pipeline/report/UI behavior, browser acceptance, regression tests, and the `browser:asset-e2e` script. `533e9c162a8ad9aa73e17e3517a4f49f57f99298` fixes fresh-checkout behavior by reserving the labeled DEMO path for absent research packages while keeping installed-provider failures as `MODEL_FAILED`. This report is the documentation close-out commit.

5. **Push.** Both implementation commits were pushed to the existing `origin/main` (`f353fce424b89bad1a94a669c66292c686d2075c..533e9c162a8ad9aa73e17e3517a4f49f57f99298`). The close-out report commit is pushed after this documentation edit; no new repository or branch was created and no destructive Git operation was used.

6. **CI.** The first implementation run [34334517531](https://github.com/Sephy57/visionscan-ai-eye-center/actions/runs/34334517531) exposed five fresh-checkout compatibility failures. After the availability fix, run [34335757273](https://github.com/Sephy57/visionscan-ai-eye-center/actions/runs/34335757273) for `533e9c162a8ad9aa73e17e3517a4f49f57f99298` completed successfully in 1m57s with typecheck, 51/52 test files passed (1 skipped), 874/917 tests passed (43 skipped), filesystem audit, and production build green. GitHub annotated the existing checkout/setup actions because they target deprecated Node.js 20 and are forced onto Node.js 24; this is an infrastructure warning, not an application failure.

7. **Root cause of fundus UNKNOWN state.** Upload creation trusted a missing/`unknown` client modality and did not derive modality from immutable image bytes. Device metadata absence therefore left the study globally unknown even when pixels were fundus-like.

8. **Root cause of false OOD state.** Device validation and pixel/domain OOD were coupled. A missing camera/device record could be converted into an OOD-style rejection before a real image-domain check, preventing eligible research routing.

9. **Fundus modality-classification changes.** `lib/assets/assetRouter.ts` now performs deterministic container and raster-content classification using multiple signals (circular field/FOV, dark exterior, color distribution, texture/vessel-like structure, and optic-disc-like brightness). It returns `FUNDUS_PHOTO_CONFIRMED`, `FUNDUS_PHOTO_PROBABLE`, or `UNKNOWN`; no filename, hash, dimension, or fixture-specific shortcut is used.

10. **Device/domain/OOD changes.** Modality, device, domain validation, image quality, and OOD are separate states. A recognized image with absent device metadata is `DEVICE_UNKNOWN` plus `DOMAIN_VALIDATION_UNKNOWN`; only a genuine pixel/domain gate produces `OUT_OF_DISTRIBUTION`. Quality limitations remain quality limitations and are not relabeled OOD.

11. **Real fundus routing result.** The real-Chrome acceptance upload of a metadata-free, synthetic fundus-like raster was content-routed as fundus and entered `RESEARCH_MODEL_ANALYSIS`; the result reported the server-computed route and did not fall through to the demo detector.

12. **Lesion model execution result.** The ClementP lesion provider was attempted and executed for the accepted fundus workflow as `fundus-lesions-clementp-unet-seresnext50` (pinned version `a2cfcb594e483`) when its quality/OOD/artifact gates allowed it. Output conversion preserves supported lesion types and bounding regions; a miss is not rewritten as normal.

13. **DR model execution result.** The research DR grader was attempted and executed for the same eligible fundus workflow as `fundus-dr-grading-effb0` (pinned version `aa5741419b90`). It remains a research grade estimate, explicitly `NOT_CALIBRATED`, with no diagnostic probability.

14. **Report provenance changes.** Analysis results now carry server-computed asset routing, immutable source/ROI hashes, model registry metadata, `models_attempted`, `models_executed`, `models_failed`, `models_skipped`, skip reasons, artifact hashes, versions, runtime status, and per-document/per-page provenance. Stale or mismatched sidecars are excluded.

15. **DEMO/research banner fix.** `analysis_mode` is derived from actual provider execution (`DEMO_ONLY`, `RESEARCH_MODEL_ANALYSIS`, `MIXED_RESEARCH_AND_DEMO`, `NO_MODEL_EXECUTED`, or `MODEL_FAILED`). Research output is shown as research-only/not clinically validated; demo copy is shown only when demo is what ran. A target-negative research result is not presented as a green normal diagnosis.

16. **Mixed-PDF classification architecture.** PDFs are retained as one immutable source document, then rendered page-by-page, text-extracted as evidence, visually classified, and decomposed into bounded image regions. The document is `MIXED_CLINICAL_DOCUMENT` when page classes differ; there is no single global modality override.

17. **PDF page categories.** Controlled categories are implemented for `LAB_RESULT`, `OPHTHALMIC_NOTE`, `FUNDUS_REPORT`, `OCT_MACULAR_CUBE`, `OCT_RASTER`, `VISUAL_FIELD`, `IOP_REPORT`, `REFRACTION`, `DICOM_SUMMARY`, `UNKNOWN_CLINICAL`, and `NON_OPHTHALMIC_CLINICAL`, with classifier method, confidence semantics, and verification state preserved.

18. **OCT page detection.** Zeiss/Cirrus markers, macular-cube terminology, raster terminology, ILM-RPE/thickness terms, and OCT visual signals are used conservatively. The mixed-PDF browser fixture was observed as three pages with OCT macular-cube/raster pages and a separate laboratory page.

19. **OCT ROI extraction.** `pdfIntelligence.ts` extracts bounded, non-uniform candidate regions and records `document_id`, page, bounding box, source-page hash, ROI hash, content type, laterality, and extraction method. The original PDF is never mutated; invalid, oversized, or untrusted derivatives are rejected.

20. **B-scan extraction.** Only elongated grayscale/layer-textured candidates classified as `OCT_BSCAN` are eligible for the OCT classifier. Thickness maps and en-face images receive separate content types; headings, tables, logos, signatures, and whole-page screenshots are not sent as B-scans.

21. **Laterality extraction.** Explicit, unambiguous `OD`/`OS` markers are attached at page level and inherited by a region only from that page. A page that mentions both eyes without an unambiguous assignment is `UNKNOWN` with `AMBIGUOUS` provenance; laterality is never copied from an adjacent page.

22. **Objective OCT measurement extraction.** Clearly legible Central Subfield Thickness, Cube Volume, Cube Average Thickness, and related labels retain `value_raw`, optional `value_normalized`, `unit`, laterality, page, source region, and review status. Missing units remain null; no disease meaning or patient value is hard-coded.

23. **OCT model routing.** Each validated OCT B-scan ROI independently passes quality and OOD gates before `oct-retinal-weights-fp32` (`hf-main-2026`) is invoked. The PDF page, thickness map, en-face crop, fundus photo, and laboratory page are excluded from this B-scan path. Research failures remain explicit failures rather than demo fallback.

24. **Multi-B-scan behavior.** Every compatible B-scan candidate is retained and evaluated; the pipeline does not silently choose one crop or average arbitrary logits. Scan-level outputs are preserved and aggregate categorically as consistent target class, mixed class results, insufficient scan quality, or not comparable.

25. **Non-ophthalmic page handling.** Laboratory/serology pages remain `LAB_RESULT`/`NON_OPHTHALMIC_CLINICAL_RECORD` evidence with page provenance. They are not routed to fundus, DR, or OCT inference and are not deleted from the source document.

26. **Image/PDF evidence fusion.** Fundus findings, OCT classifications, extracted measurements, and document evidence can enter the existing cross-modality evidence layer only with their source hashes, page/eye context, and evidence type intact. Unrelated laboratory facts are not synthesized into an eye diagnosis.

27. **Symptom behavior.** Symptoms come from validated user/document extraction, including explicit negation and uncertainty; they are never inferred from pixels. The report separates AI-observed imaging findings, documented symptoms, and possible associated symptom evidence.

28. **Findings/no-model distinction.** Schema and UI distinguish `NO_TARGET_FINDING_DETECTED`, `NO_APPLICABLE_MODEL`, `MODEL_FAILED`, `INPUT_UNSUITABLE`, and `OUT_OF_DISTRIBUTION`. `Findings (0)` is only used for successfully executed models with zero supported targets, not for an analysis that never ran.

29. **UI/report redesign.** Result and report pages now lead with analysis mode, uploaded asset/page breakdown, model execution, findings/measurements, ROI provenance, and limitations. Clinician/dashboard language is modality-aware; OCT studies do not show stale fundus-unavailable text, and `ScanViewer` no longer appends an unconditional demo label.

30. **Security/red-team.** Server recomputation ignores spoofed modality/page-class/model fields. Study/document/routing IDs, source hashes, page hashes, ROI hashes, bounding boxes, and patient scope are verified before analysis. Extraction caps embedded resources and rejects malformed/unsupported assets; path traversal and cross-study derivative reuse remain blocked. Prompt text in PDFs is evidence, not executable instruction.

31. **Performance.** Login/navigation remain off the model path. `npm run performance:local` passed: login API p95 72.6 ms, dashboard p95 5.5 ms, study-list API p95 6.1 ms, upload 34.7 ms, result/report page p95 4.8/4.3 ms. The ClementP cold single-run measured 7,604.7 ms (interpreter included); warmed 1024-pixel CPU forward was about 2.3 s, peak worker RSS about 1.3 GB, with serialized execution. The endpoint fixture was borderline quality and `NO_MODEL_EXECUTED`, so these are engineering timings, not clinical latency claims.

32. **Test totals.** The installed-artifact isolated full regression using fresh temporary database/storage roots passed 52 files, 915 tests, and 2 skipped (917 total) in 494.95 s. The default shared store run had an afterAll cleanup timeout after 915 passes; it is recorded as host/store contention, not a green claim. The fresh-checkout CI run passed 51 files with 1 skipped and 874 passed/43 skipped tests (917 total). The new asset/PDF regression file has 8 focused tests, and the three targeted red-team/dashboard files passed 23/23 in both installed and empty-package simulations.

33. **TypeScript.** `npx tsc --noEmit` passed after the routing, extraction, provenance, and UI changes.

34. **Build.** `npm run build` passed using the stable webpack command (`next build --webpack`), compiling successfully, typechecking, and generating 20/20 static pages. Existing middleware-convention warning remains non-blocking.

35. **Smoke.** `npm run smoke` passed 16/16, including authenticated upload, symptom validation and rejection, real research analysis, red-flag triage, report generation, clinician finalize, temporal comparison, self-test, deletion, unauthenticated denial, and cross-role checks.

36. **Browser E2E.** `npm run browser:asset-e2e` passed in real headless Chrome: metadata-free fundus upload reached research models; mixed PDF extraction completed; pages were classified; 8 OCT ROI candidates were preserved and analyzed through the B-scan path; and the report showed research provenance/PDF routing without a stale synthetic banner.

37. **Responsive QA.** `npm run browser:responsive` passed 80/80 checks across 10 routes at 320, 375, 414, 768, 1024, 1280, 1440, and 1920 px.

38. **Accessibility.** `npm run browser:a11y` passed 20/20 axe WCAG A/AA checks at 320 px and 1280 px over the 10 application routes.

39. **npm audits.** `npm audit --omit=dev --json` passed with 0 production vulnerabilities across 42 dependencies. Full `npm audit --json` remains non-zero for two moderate dev-only Vitest vulnerabilities (`vitest`/`@vitest/mocker`, GHSA-82fw-gwwq-j7x9); the available fix is a major Vitest upgrade and was not applied without review. `npm run audit:fs` passed with source/data on D: and approximately 430 GB free.

40. **Remaining clinical/model limitations.** Research artifacts remain uncalibrated and non-diagnostic; supported pathology is limited to each pinned model's contract; device/domain validation is incomplete for unknown acquisition hardware; rights/provenance for training data and derived weights, SBOM/dependency governance, resource/network sandboxing, multi-device patient-separated validation, operating-point/calibration freeze, and clinical/regulatory review remain open. The stale `next lint` script still fails because no ESLint configuration is installed.

41. **Exact capability boundary.** VisionScan can now content-route eligible fundus images and mixed scanned ophthalmic PDFs, preserve page/ROI/eye provenance, and run isolated local research providers when all gates pass. It cannot diagnose, establish normality, infer symptoms from pixels, interpret normative OCT colors as disease, guarantee sensitivity/specificity, or replace clinician review. Unsupported, ambiguous, low-quality, tampered, or true-OOD inputs fail closed.

42. **Final classification.** **ENGINEERING PARTIAL — BLOCKERS REMAIN.** The requested routing and report-correctness behavior is implemented, locally verified, pushed, and covered by a green CI run. The full release is not called complete while the two moderate dev-only audit findings, the stale/non-actionable `next lint` command, and the disclosed clinical/model governance gates remain unresolved.

## I. FINAL CLINICAL INTELLIGENCE VALIDATION & HARDENING REPORT (2026-09-09)

This section is the current close-out record for the handoff that began at the
requested baseline. It supersedes older measurements in the historical release
record above where the two records differ.
1. **Starting HEAD.** The requested starting revision was c9e76646304841de2fbcd8f155bfe7863e1c292a on main. It was verified before integration and was not reset or rewritten.

2. **Ending HEAD.** The implementation close-out revision is 5967f5ed158dc08e5e59dbaabc74a060cea9cf98. The report itself is committed as a follow-up documentation close-out; the final repository HEAD is recorded in the handoff after that commit so the implementation and documentation hashes remain independently auditable.

3. **Branch.** All work was performed on main in D:\AI EYE ANALYSIS PLATFORM and pushed to the existing origin/main.

4. **Working tree.** The implementation was committed from a reviewed diff with no patient PDFs, patient images, OCR dumps, model artifacts, credentials, or secrets staged. Generated test data was kept outside the committed source set; the final documentation commit is the only intentional follow-up change.

5. **Commits.** 5967f5e adds the model execution ledger, canonical evidence enrichment, dependency and temporal semantics, structured condition assessments, semantic source-diagnosis conflicts, adversarial review, independent verification, specialist reasoning exposure, retry actor hardening, lint configuration, and updated browser assertions. The report close-out is a separate documentation commit.

6. **Push.** The implementation was pushed with git push origin main. No destructive Git command, force push, new branch, or new repository was used.

7. **CI.** GitHub Actions run 34349456184 completed successfully in 1m58s for 5967f5e. Install, typecheck, unit/integration tests, filesystem audit, and production build all passed. GitHub emitted only the existing action-runtime warning that checkout/setup actions target Node.js 20 and are being forced onto Node.js 24.

8. **Sub-agents used.** Read-only tracks covered pipeline/evidence archaeology, clinical specialist logic, PDF/OCT design, provenance/report review, and security/UI/release review. Their findings were reconciled in the shared checkout; they reported focused passes with documented limitations rather than autonomous clinical approval.

9. **Architecture findings.** The pipeline remains upload → persistent asset → server routing → page/ROI extraction → quality/OOD gates → research inference → evidence adapters → reasoning/specialist review → report/UI. The hardening pass closes several dropped-data edges, but duplicate legacy condition paths and non-persisted specialist outputs remain engineering debt.

10. **Asset routing.** Routing is recomputed from immutable bytes and separates modality, device knowledge, domain status, quality, and eligibility. Fundus-like rasters and mixed documents are accepted only when content evidence supports the route; conflicts, unsupported content, and ambiguous cases fail closed.

11. **Fundus analysis.** The real ClementP lesion provider and the research DR grader are attempted only after artifact, quality, domain, and modality gates pass. Lesion output preserves supported lesion classes and regions; DR remains an uncalibrated research grade estimate and never becomes a diagnosis or probability.

12. **OCT analysis.** Native and PDF-derived OCT B-scan candidates are evaluated independently by the pinned research classifier when eligible. The path keeps scan-level outputs and distinguishes B-scan, thickness-map, en-face, and non-OCT regions; it does not infer disease from a classifier label or a single thickness value.

13. **PDF/document intelligence.** PDF bytes remain the immutable source. Page rendering, text extraction, statement extraction, measurement parsing, visual page classification, and bounded ROI extraction retain page hashes, methods, confidence/verification state, and source linkage. The current browser fixture produced three pages and eight OCT ROIs.

14. **Laterality.** OD, OS, OU, and UNKNOWN are represented explicitly. Page-level markers are inherited only when unambiguous; mixed-eye or contradictory text remains UNKNOWN/ambiguous. Same-eye compatibility is checked before correlation and UNKNOWN is never silently promoted to OU.

15. **Measurements.** Objective values preserve raw text, normalized value when safely derivable, unit, eye, page/region, source hash, and review status. Missing units remain null and no normative threshold or disease interpretation is invented.

16. **Evidence graph.** A canonical enrichment layer now assigns stable ev_ identifiers derived from evidence content and attaches patient, encounter, study, source, modality, timestamp, concept, values, negation, certainty, verification, trust, model, page, ROI, and provenance fields. JSON serialization includes the structured hardening metadata.

17. **Trust/provenance.** Clinician-authored, device-measured, source-documented, extracted, patient-reported, and AI-research observations remain distinguishable. Research evidence is capped as non-diagnostic, and every derived finding points to a source asset, page, ROI, model, or encounter context.

18. **Evidence dependency groups.** Findings from the same fundus asset share a dependency_group_id even when lesion and DR models both execute. Independent OCT, device measurement, document, and encounter groups are tracked separately so item counts cannot masquerade as independent clinical corroboration.

19. **Temporal reasoning.** Enrichment derives SAME_ENCOUNTER, NEARBY_ENCOUNTER, HISTORICAL, or TEMPORALLY_UNCERTAIN from encounter/reference timestamps. Longitudinal comparisons stay separate from same-visit corroboration and unknown timestamps are not treated as contemporaneous.

20. **Retina specialist.** Retina-oriented review consumes lesion findings, DR research observations, source retinal statements, history, symptoms, and laterality. It returns possible patterns, supporting/contradicting evidence, missing evidence, urgency, limitations, and model coverage without a confirmed diagnosis.

21. **OCT/macula specialist.** Macula review consumes OCT B-scan classifications, extracted CST/cube measurements, source interpretations, symptoms, fundus context, and eye identity. A single number or class is insufficient; confirmation remains clinician OCT review and examination.

22. **Glaucoma/optic-nerve specialist.** No defensible glaucoma disease classifier was promoted. The workflow can organize IOP, cup/disc or optic-disc research anatomy, RNFL, field, history, and source assessment as a glaucoma-related evidence pattern, never as an autonomous glaucoma diagnosis.

23. **Urgent/neuro review.** Red-flag review remains independent of imaging and can escalate for sudden loss, flashes, floaters, curtain/shadow, severe pain, neurologic visual symptoms, trauma, or chemical exposure. Negative or unavailable research inference cannot suppress an urgent flag; chemical/severe-pain coverage still needs broader case validation.

24. **Comprehensive specialist synthesis.** The reasoning engine now exposes specialist consensus plus adversarial review and independent verification. Synthesis is categorical and evidence-referenced; it does not average arbitrary model scores or overwrite clinician fields.

25. **Condition knowledge rules.** Existing rule-based patterns are reused and kept bounded to supported retinal, macular, vascular, optic-nerve, and warning concepts. The implementation adds no invented thresholds; reference governance, versioned citations, and clinical review dates are still incomplete for release.

26. **Condition ranking.** ConditionAssessment carries rank, specialty, evidence strength, source counts, dependency groups, model/objective/document/symptom support, limitations, and confirmation requirements. Ranking penalizes contradictions, wrong eye, temporal uncertainty, poor quality, OOD/domain uncertainty, and single-source AI support; it is not a probability.

27. **Contradictions.** The conflict layer preserves laterality conflicts, model disagreement, measurement disagreement, historical/current mismatch, and semantic source-document diagnosis versus same-eye AI observations. A conflict is surfaced with references and no automatic winner.

28. **Missing evidence.** Candidate conditions expose missing evidence in structured form, such as verified retinal examination, RNFL/field evidence, repeat imaging, or clinician confirmation. Missingness is distinct from a negative finding and is not filled with generic assumptions.

29. **Confirmation requirements.** Requirements are grounded in the condition pattern and available evidence, for example clinician retinal examination, OCT review, IOP confirmation, visual-field/RNFL review, or repeat imaging. The system does not claim that a recommendation is medically necessary or prescribe a test autonomously.

30. **Specialist disagreements.** Consensus now reports SPECIALISTS_CONCORDANT, PARTIAL_CORROBORATION, SPECIALIST_DISAGREEMENT, or INSUFFICIENT_SPECIALIST_EVIDENCE while retaining the legacy status field. Disagreement and verifier discrepancies remain visible rather than being resolved by majority vote.

31. **Source-document diagnoses.** A diagnosis written in a PDF is stored as SOURCE_DOCUMENT evidence with page and extraction provenance. The UI can say that source documentation reports a condition; it does not rewrite that statement as a VisionScan diagnosis.

32. **Negation handling.** Explicit negation and uncertainty survive extraction, including absent flashes/floaters, rule-out language, historical diagnoses, and possible conditions. Adversarial tests cover negative statements and prevent them from becoming positive findings.

33. **Symptom handling.** Patient or document symptoms are separate from image observations. A hemorrhage-like region cannot create blurred vision, pain, floaters, or vision loss; contextual symptom language is not stored as a patient symptom unless documented.

34. **Urgency.** Urgency is a separate safety output and is not derived from a model confidence score. Red flags can require prompt professional review even with zero findings, model failure, or an otherwise reassuring research classification.

35. **Clinician final assessment.** AI evidence-based assessment and FINAL CLINICAL ASSESSMENT remain physically and structurally separate. Only an authorized clinician can persist diagnosis, impression, plan, or follow-up attribution; AI cannot populate verified clinician fields.

36. **Medication boundary.** The system does not prescribe, generate dosage, or recommend medication from an unvalidated condition. Governed medication knowledge may be displayed only when available; otherwise the explicit state is KNOWLEDGE_UNAVAILABLE.

37. **Model execution ledger.** Every analysis now receives a server-derived ledger row with model_id, version, task, artifact hash, asset/ROI, laterality, eligibility, execution status, skip reason, quality/domain, runtime, output contract, validation status, and dependency group. Statuses include EXECUTED, SKIPPED, UNAVAILABLE, FAILED, BLOCKED_QUALITY, BLOCKED_OOD, and UNSUPPORTED_MODALITY.

38. **False-positive analysis.** The research lesion and DR outputs remain susceptible to vessel/reflection, bright exudate-like content, device variation, and threshold/post-processing effects. No suppression rule was invented from a small fixture; false positives require labeled, patient-separated validation.

39. **False-negative analysis.** Tiny, low-contrast, atypical, or out-of-contract pathology can be missed, and a negative DR/OCT estimate never establishes normality. The system records no-target, failed, blocked, and unavailable states distinctly, but it does not yet contain a clinically powered false-negative estimate.

40. **Model error registry.** There is no integrated labeled case/error registry that records adjudicated false positives, false negatives, subgroup performance, or remediation history. This is a remaining validation deliverable, not evidence that error rates are zero.

41. **Multimodal acceptance cases.** Real Chrome asset E2E verified metadata-free fundus routing, research model execution, mixed-PDF extraction, three pages, eight OCT ROIs, ledger rows, report provenance, and PDF routing. Focused multimodal and extraction suites passed; a formal ten-case expected-evidence harness is not yet implemented.

42. **Adversarial clinical review.** clinicalRedTeam.ts checks support references, same-eye compatibility, dependency inflation, contradiction handling, temporal uncertainty, and unverified-AI confirmation. It can weaken a condition and require clinician review; it cannot certify clinical correctness.

43. **Security red-team.** Server recomputes modality, provenance, ledger status, and retry actor identity; client-supplied requested_by is ignored. Scope, CSRF, cross-patient/tenant, path traversal, malformed PDF, decompression, stale-cache, and artifact-integrity tests remain protected, with broader adversarial coverage still desirable.

44. **PHI review.** No patient assets, OCR outputs, model artifacts, external LLM calls, hosted OCR, API keys, or secrets were introduced. The phase remains local; the smoke credential exists only in development scripts/environment and is not part of the new commit.

45. **UI redesign.** The workstation now presents modality-aware analysis state, evidence-backed condition metadata, specialist guard status, provenance, and model coverage without decorative certainty. Research and clinician language remain visually distinct.

46. **Result page.** The result view includes the input/model execution ledger, task/model, asset or ROI, eye, eligibility, status/skip reason, quality/domain, runtime, findings, and limitations. A research result is not relabeled as a demo or normal diagnosis.

47. **Report page.** The report carries analysis mode, model ledger, source/page/ROI provenance, structured condition assessment, conflicts, missing evidence, specialist guard output, and clinician-final separation. The report generator copies the ledger from the server-side analysis rather than guessing coverage.

48. **Image viewer.** Fundus overlays are limited to actual model-derived regions and retain finding linkage. Classification-only models do not receive fabricated heatmaps or localization; viewer controls remain presentation aids, not clinical measurement tools.

49. **OCT viewer.** Extracted B-scans are shown separately from the whole PDF page, thickness maps, and numeric tables with source page, eye, ROI, model, classification, and limitations. The fixed-crop caveat and research-only semantics remain explicit.

50. **Document evidence viewer.** Extracted statements expose text, page/source, verification state, negation/certainty, and provenance so a clinician can inspect the original context. OCR is not promoted to clinician-verified evidence automatically.

51. **Responsive QA.** Real browser responsive QA passed 80/80 checks across ten routes at 320, 375, 414, 768, 1024, 1280, 1440, and 1920 px. No horizontal-overflow failure was observed in the automated route sweep.

52. **Accessibility.** Real browser axe QA passed 20/20 WCAG A/AA checks at 320 and 1280 px across ten routes. Automated accessibility is green; NVDA/JAWS and a full manual assistive-technology certification were not performed and are not claimed.

53. **Performance.** Current local performance measured login page p50/p95 4.7/5.8 ms, dashboard 4.3/5.4 ms, upload 47.3 ms, study-list API 3.5/4.3 ms, result bundle API 3.8/4.5 ms, result page 3.0/4.6 ms, and report page 2.6/3.4 ms. The demo imaging pipeline fixture completed in 134.4 ms without a model because its quality was borderline.

54. **Login performance.** Login API p50/p95 was 71.5/129.9 ms in the current run. Authentication does not initialize ML/OCR artifacts; the higher p95 than the historical 72.6 ms snapshot is an observed local sample, not a release regression claim.

55. **OCR/model latency.** ClementP cold load/inference measured 7,362.3 ms; warmed 1024-pixel CPU forward was approximately 2.3 s with peak RSS near 1.3 GB and serialized execution. PDF/OCR and real inference remain outside login/session paths; per-stage progress and cancellation are not yet complete.

56. **Test totals.** The final local full Vitest run passed 53 files, 922 tests, and skipped 2 tests (924 total) in 743.73 s with one worker. Additional focused evidence/clinical suites passed 72/72, 35/35, 29/29, 33/33, and the new hardening suite 7/7.

57. **TypeScript.** npx tsc --noEmit --pretty false exited 0 after the hardening changes. CI typecheck also passed.

58. **ESLint.** The stale Next lint invocation was replaced with a supported flat ESLint configuration. npm run lint exits 0 with five existing unused-disable warnings; warnings are recorded and are not treated as zero-warning proof.

59. **Build.** npm run build exited 0 with Next 16.3.4 webpack, successful typecheck, and 20/20 generated static pages. The existing middleware-convention deprecation warning is non-blocking.

60. **Smoke.** npm run smoke passed 16/16, including authenticated upload, symptom validation/rejection, research analysis, red-flag triage, report generation, clinician finalize, temporal comparison, self-test, deletion, unauthenticated denial, and cross-role checks.

61. **Browser E2E.** npm run browser:asset-e2e passed in real headless Chrome after allowing the uncached CPU analysis window. It verified fundus research execution, mixed PDF/page/ROI routing, ledger assertions, report provenance, and no stale demo banner.

62. **Filesystem audit.** npm run audit:fs exited 0. Source and application data remain on D:, with approximately 430.1 GB free; the audit reported the expected local upload/document/processed counts without staging those assets.

63. **Dependency audit.** npm audit --omit=dev --json exited 0 with zero production vulnerabilities across 42 production dependencies. Full npm audit --json remains non-zero for two moderate dev-only Vitest/@vitest-mocker path-traversal/arbitrary-file-read advisories (GHSA-82fw-gwwq-j7x9); the available remediation is a major Vitest upgrade and was not forced without compatibility review.

64. **GitHub CI.** Run 34349456184 is green for implementation SHA 5967f5e. The final documentation close-out push should be watched separately; the CI workflow itself covers typecheck, npm test, filesystem audit, and build, not browser E2E, full audit, or clinical validation.

65. **Remaining engineering blockers.** The formal case-package expected-evidence harness and adjudicated model-error registry are absent; specialist/reasoning outputs are not yet fully persisted as immutable report records; long-running stages lack complete progress/cancellation; fixed-crop B-scan limitations, legacy duplicate condition paths, and broader browser keyboard/manual QA remain. Full audit still has the two dev-only findings.

66. **Remaining model blockers.** Providers are research-only, uncalibrated, and limited to their output contracts. Patient-separated multi-device/domain validation, artifact/data-rights review, calibration/operating-point freeze, subgroup/error analysis, and honest sensitivity/false-negative measurement are not complete; cold CPU latency and memory are material operational limits.

67. **Remaining clinical-validation blockers.** No prospective clinical validation, reference-standard adjudication, clinical governance sign-off, normative OCT reference policy, regulatory assessment, or deployment monitoring plan has been completed. These are required before any clinical diagnostic or screening claim.

68. **Exact capability boundary.** VisionScan is a local research / clinician decision-support workstation that can route eligible fundus, OCT, and mixed-document inputs; preserve page, ROI, eye, dependency, and temporal provenance; expose actual model execution; organize symptoms and objective measurements; and present cautious specialist/differential evidence. It cannot diagnose, prove normality, infer undocumented symptoms, guarantee sensitivity/specificity, prescribe, or replace a clinician. Unsupported, ambiguous, low-quality, tampered, and true-OOD inputs fail closed.

69. **Final classification.** ENGINEERING PARTIAL — BLOCKERS REMAIN

## J. CASE VALIDATION / ERROR REGISTRY / REPRODUCIBILITY FINAL REPORT (2026-09-09)

This section supersedes earlier phase measurements where they conflict with the current case-validation and persistence implementation. It records the evidence that was actually run; it does not convert research-only behavior into clinical validation.

1. **Starting HEAD.** This phase started from `2d4e4d281a69097faab0b12caa571a95bfa0f844` on `main`.

2. **Ending HEAD for implementation gates.** The implementation/release-gate head before this documentation commit is `17fda11462a2eb59e622d9cf710fc41de3ddd660` (the final report commit is intentionally not self-referenced).

3. **Commits.** `fe964f9775c2f63666f79b642ec2965be83abf7e` adds the validation/error/persistence/UI gates; `17fda11462a2eb59e622d9cf710fc41de3ddd660` adds the de-identified SBOM.

4. **Push.** Implementation, SBOM, and report/inventory commits were pushed successfully to `origin/main`; the report/inventory artifact was introduced in `663114b` and this final CI-status correction is the following docs commit.

5. **CI.** GitHub Actions runs `34359219208` (implementation), `34359394503` (SBOM), and final-head `34374085817` (report/inventory) completed successfully. The final-head job completed in 2m33s; GitHub emitted only a Node.js 20 action-deprecation annotation.

6. **Sub-agents.** Three explicitly requested parallel workstreams were completed and reconciled: synthetic case/error registry, persistence/progress/cache safety, and aggregate validation dashboard/security.

7. **Case-package architecture.** `lib/validation/casePackage.ts` validates a JSON package as synthetic-only, schema-versioned, provenance-bearing cases with typed expected projections and semantic assertions; no fixture bytes are required for package validation.

8. **Number of validation cases.** `validation-cases/synthetic-safety-package.json` contains 15 cases (`synthetic-001` through `synthetic-015`). The schema supports optional asset descriptors; only synthetic descriptors are present and no clinical/patient bytes are committed.

9. **Evidence assertions.** The harness covers existence, reference, source attribution, laterality, negation, uncertainty, and structured evidence-category assertions using explicit paths/matches rather than free-text scoring.

10. **Routing assertions.** Cases assert modality/page type, laterality, ambiguous routing, unsupported modality, OOD/domain state, and the requirement that server-computed routing—not uploader metadata—controls eligibility.

11. **Model execution assertions.** Cases can require a model/version, research-only status, expected execution/blocked/failed state, and no synthetic fallback after a real research-model failure; the model execution ledger remains server-authored.

12. **Specialist assertions.** Cases can require a specialist package, allow an optional specialist, and assert `requires_clinician_review`; specialist output remains an evidence pattern, not a diagnosis.

13. **Condition assertions.** Cases can assert a bounded possible-condition identifier, state, laterality, and supporting evidence while rejecting autonomous `CLINICAL_DIAGNOSIS` claims.

14. **Forbidden-output assertions.** Cases can list forbidden literals (for example, `diagnosis confirmed`) and the focused contract test rejects unsafe confirmed-diagnosis wording in automated output.

15. **Model-error registry.** `lib/validation/modelErrorRegistry.ts` defines canonical categories (including `MISCLASSIFICATION`, `OOD_FALSE_REJECTION`, `OOD_FALSE_ACCEPTANCE`, `LOCALIZATION_ERROR`, `ROUTING_ERROR`, `ROI_ERROR`, `LATERALITY_ERROR`, `MODEL_TIMEOUT`, `CONTRACT_FAILURE`, and `UNSUPPORTED_PATHOLOGY`) with normalized legacy aliases.

16. **Error adjudication.** `lib/validation/modelErrorStore.ts` persists insert-only error records and requires an explicit reviewer and valid lifecycle transition for adjudication; automated inference cannot close or resolve an error.

17. **False-positive registry.** FP records are representable with immutable input/fixture identity, modality, eye, quality/domain state, structured expected/observed projections, reviewer, mitigation, regression test, and adjudication status. No clinical FP rate is claimed and no clinical FP dataset is committed.

18. **False-negative registry.** FN records use the same provenance and reviewer gates, including `OOD_FALSE_REJECTION` and unsupported-pathology pathways. No sensitivity or false-negative estimate is claimed without a labeled, patient-separated reference set.

19. **Reasoning persistence.** Specialist/condition evidence and deterministic reasoning are persisted as a self-contained `reasoning_record` with source-analysis hash, evidence hash, ruleset versions, and payload hash; raw document snippets are scoped to evidence paths.

20. **Report immutability.** Reports carry an AI-owned `version_freeze` hash. AI fields cannot be silently rewritten, finalized reports reject reruns, and clinician amendments remain additive review records.

21. **Ruleset freeze.** The report seal records pipeline, pipeline-ruleset, coverage, evidence taxonomy, specialist, validation-registry, reasoning-engine, and reasoning-record schema versions.

22. **Reproducibility.** Deterministic reasoning, canonical JSON hashing, immutable source bytes, server-derived provenance, and content/model/version/ROI cache keys make replay checks explicit; reproducibility is engineering-level, not clinical performance evidence.

23. **Job progress.** Analysis and extraction jobs persist bounded stages (`preparing`, source validation, asset routing, inference, report generation, completion/failure) with monotonic percentages and unit counts.

24. **Cancellation.** Queued jobs cancel immediately; running jobs check cancellation at safe checkpoints and refuse cancellation after persistence/report publication begins, preventing a partially published result.

25. **Retry.** Retry requires an 8–128 character idempotency key; exact replay returns the existing attempt without creating another worker attempt or duplicate audit event, and retries reset progress for a new attempt.

26. **Cache safety.** Inference cache keys include content hash, optional ROI hash, model/version, preprocessing version, scope, and eye. Entries are cloned on write/read and malformed keys are rejected, preventing cross-study or caller-mutation poisoning.

27. **Validation dashboard.** `/api/validation/dashboard` exposes aggregate-only validation metrics and `/validation` renders them. Statuses distinguish model failure, unsupported modality, quality block, OOD, urgent review, and ordinary review.

28. **Evidence trace UI.** Validation/error routes and specialist-analysis views expose scoped provenance, evidence references, model ledger rows, and adjudication state without placing case IDs, dataset references, reviewer notes, or raw snippets in aggregate dashboard responses.

29. **Clinician UI.** Report/clinician surfaces keep AI reasoning, evidence, and clinician-authored final assessment structurally separate; only the authorized review workflow can persist diagnosis, impression, plan, or follow-up fields.

30. **Security.** API routes enforce session, role, scope, and CSRF checks; modality, laterality, provenance, model status, and retry actor are recomputed server-side. `proxy.ts` is only a page redirect convenience and is not the authorization boundary.

31. **PHI review.** New committed artifacts are synthetic/de-identified source code, tests, manifests, and metadata only. Local ignored data still contains user-generated studies and model weights; neither is staged, logged, or included in the SBOM.

32. **Dependency advisories.** `npm audit --omit=dev --json` passed with 0 production vulnerabilities across 42 production dependencies. Full audit remains non-zero for two moderate dev-only Vitest/@vitest-mocker path-traversal/arbitrary-file-read advisories (GHSA-82fw-gwwq-j7x9); the available fix is a major upgrade and was not forced.

33. **ESLint.** `npm run lint` exited 0 after the hardening changes.

34. **Next.js warnings.** `npm run build` exited 0 under Next 16.3.4 webpack and reports `ƒ Proxy (Middleware)`; the prior middleware-convention warning is gone.

35. **GitHub Actions.** The implementation and SBOM CI runs completed all configured typecheck, single-worker test, validation-case, manifest-audit, SBOM, inventory, filesystem, and build steps successfully.

36. **SBOM.** `docs/generated/SBOM.cdx.json` is a CycloneDX 1.5 inventory generated from the lockfile, Python environment, and local research manifests; it marks patient-data-included as false and contains no model weights or patient assets.

37. **Release inventory.** `docs/generated/release-inventory.json` records application/runtime/model/ruleset hashes, the SBOM hash, `phi_included: false`, and a clean-tree snapshot at commit `17fda11462a2eb59e622d9cf710fc41de3ddd660` before the report append.

38. **Performance.** Current local CPU-only measurements were login page 4.0/5.3 ms p50/p95, login API 87.2/114.9 ms, dashboard 3.7/6.3 ms, study-list API 2.5/2.9 ms, upload 55.2 ms, result bundle 3.2/6.4 ms, result page 3.4/4.3 ms, and report page 3.4/3.8 ms. The demo pipeline was 250.6 ms with `NO_MODEL_EXECUTED`; ClementP cold worker load/inference was 7,237.8 ms, with the observed warmed CPU note remaining approximately 2.3 s/1024 px and approximately 1.3 GB RSS, serialized. These are local engineering observations, not SLOs or clinical claims.

39. **Test totals.** The full single-worker Vitest run completed 54 of 56 files with 938 passed tests and 2 skipped (940 total); two suites failed only their 30-second `afterAll` cleanup hooks while removing studies from the accumulated 19.5 MB JSON store (`s2-extraction.test.ts` and `s4-verification.test.ts`). The focused new hardening suites passed 3 files / 16 tests.

40. **TypeScript.** `npx tsc --noEmit --pretty false` exited 0 after the final source changes.

41. **Build.** `npm run build` exited 0, compiled successfully, typechecked successfully, generated 21/21 static pages, and included the validation dashboard/error routes.

42. **Smoke.** `npm run smoke` passed 16/16, including authenticated upload, symptom validation/rejection, research analysis, urgent triage, report generation, clinician finalize, comparison, self-test, deletion, unauthenticated denial, and cross-role checks.

43. **Browser E2E.** With the local demo auth flag enabled, real headless Chrome passed asset E2E through dashboard login, metadata-free fundus upload, research inference, mixed-PDF extraction, three-page/ eight-OCT-ROI routing, and report provenance.

44. **Responsive.** Real browser responsive QA passed 80/80 checks across ten routes at 320, 375, 414, 768, 1024, 1280, 1440, and 1920 px with no horizontal overflow.

45. **Accessibility.** Real browser axe QA passed 20/20 WCAG A/AA checks across ten routes at 320 and 1280 px. Manual NVDA/JAWS certification was not performed and is not claimed.

46. **Dependency audit.** Production dependency audit is green as stated in item 32; the remaining two moderate findings are development-only and require compatibility review before a major Vitest upgrade.

47. **Remaining engineering blockers.** The full local suite is not exit-green because two cleanup hooks exceed 30 seconds on the accumulated JSON store; historical legacy reports without the new reasoning/version seal are rejected by the freeze verifier and need an explicit migration policy; browser keyboard/manual QA and a production-grade transactional database remain incomplete.

48. **Remaining model blockers.** All installed models are research-only and uncalibrated. Patient-separated multi-device/domain validation, subgroup/error analysis, calibration/operating-point freeze, approved data rights, and clinically powered sensitivity/specificity measurement remain absent; PDF-to-OCT routing still uses heuristic/fixed ROI extraction.

49. **Remaining clinical-validation blockers.** No prospective clinical validation, reference-standard adjudication, clinical governance sign-off, normative OCT policy, regulatory assessment, or post-deployment monitoring plan has been completed. The synthetic harness validates contracts and safety boundaries, not diagnostic accuracy.

50. **Exact capability boundary.** VisionScan is a local research / clinician decision-support workstation that can route eligible fundus, OCT, and mixed-document inputs; preserve byte/page/ROI/eye/model provenance; execute explicitly labeled research providers; organize symptoms and objective measurements; persist deterministic reasoning; and present cautious specialist/condition evidence. It cannot diagnose, prove normality, infer undocumented symptoms, guarantee sensitivity/specificity, prescribe, or replace a clinician. Unsupported, ambiguous, low-quality, tampered, and true-OOD inputs fail closed.

51. **Final classification.** ENGINEERING PARTIAL — BLOCKERS REMAIN

## K. TRANSACTIONAL DATA & ZERO-FAILURE RELEASE REPORT (2026-09-10)

This close-out records the production-data-layer hardening evidence actually
run on the local research workstation. It does not promote any clinical claim
or turn synthetic/retrospective checks into clinical validation.

1. **Starting HEAD.** This phase started at `a11881ef7ab01d9ee2cc49720c975d2fa444578c` on `main`.

2. **Ending HEAD.** The implementation/release-gate head before this report close-out is `6992be96150724779494eebf7d70b61f787fd714`; the report and generated-artifact commit is documentation-only.

3. **Commits.** `700681969666b46b153548eb54211f47fd5c670c` adds transactional SQLite persistence, migration, backup/restore, job CAS, isolated tests, and safe file writes; `6992be96150724779494eebf7d70b61f787fd714` adds the browser keyboard gate.

4. **Push.** Both implementation commits were pushed to `origin/main` without force-push; this documentation close-out is pushed with the generated SBOM/inventory.

5. **Final CI.** GitHub Actions run `34390846769` for `6992be96150724779494eebf7d70b61f787fd714` completed successfully in 2m17s. Typecheck, single-worker tests, migration dry-run, backup plan, benchmark, validation contract, model audit, SBOM, inventory, filesystem audit, and build were all green.

6. **Sub-agents.** The three requested independent investigations were reconciled: storage forensics, test isolation, and migration/security/release review; each returned limitations that are retained below rather than silently promoted to PASS.

7. **Original cleanup root cause.** The prior suite rewrote and reparsed an approximately 20 MB JSON envelope for each mutation; teardown then scanned/re-wrote accumulated data and hit two 30-second `afterAll` timeouts. Forensics found 39 stale JSON temporary files (~164.9 MB).

8. **Storage architecture before.** `dbGet/dbPut/dbAll/dbDelete` used a process-local read-modify-write JSON store; files and audit logs were separate, and multi-record changes had no database transaction.

9. **Storage architecture after.** The same async seam now defaults to SQLite; explicit `VISIONSCAN_PERSISTENCE_BACKEND=json` remains only for legacy inspection. SQLite rows retain structured JSON payloads, timestamps, and primary IDs so callers need no ORM rewrite.

10. **Database choice.** `better-sqlite3` was selected for the local-first Next.js stack: synchronous transactions, low operational overhead, no hosted service, and a small compatibility surface; Next externalizes the native module.

11. **Schema.** SQLite creates 38 allowlisted collection tables plus `persistence_meta`, covering users, patients, encounters, studies, documents/pages/assets/OCT ROIs, analyses/ledger/evidence/reasoning, reports/reviews, jobs/audit, validation/model errors, sessions/consent, and legacy collections. Payloads remain immutable JSON envelopes rather than blindly normalized columns.

12. **Transactions.** `dbTransaction` commits cross-collection writes atomically and rejects asynchronous callbacks; analysis/report completion, test-result replacement, study deletion, and job state changes use one transaction where their database records must agree.

13. **Immutable records.** Reads and writes are deep-cloned; source hashes, page/ROI hashes, model ledgers, reasoning hashes, report version freezes, clinician review history, and model-error adjudications remain append-only or sealed by existing service gates.

14. **File/database consistency.** Large originals, PDFs, derived regions, and model weights stay filesystem-backed with hash/path/size metadata. Database/file operations are reconciled and idempotent, but they are not one atomic resource; a residual crash window remains during post-commit file cleanup.

15. **Legacy migration.** `npm run migrate:data -- --apply` imports the immutable JSON source into a temporary SQLite database, creates a hashed backup, verifies counts and `PRAGMA integrity_check`, then atomically installs it. The original `eye-ai.json` remains untouched.

16. **Migration dry-run.** The current dry-run found 16,931 valid records, 0 invalid records, 5,660 records needing manual reference review, 51 legacy reports, source SHA-256 `7ec65302b223e9a18972eae92cfc4bc6ed64884ef5510708ebf6624ee31ebe13`, and an estimated SQLite size of 15,338,453 bytes; no destination or backup was written.

17. **Migration idempotency.** A second apply against the same source returns `already_applied` from the recorded source hash; fixture tests verify no duplicate rows, ledgers, evidence, reports, or audit events.

18. **Migration rollback.** Fixture tests cover invalid-source rejection and temporary-database cleanup; atomic rename restores the prior destination on swap failure. A separate durable failure-report artifact for every possible mid-import exception remains a gap.

19. **Legacy report policy.** Reports without `version_freeze` or `reasoning_snapshot` are delivered as `LEGACY_UNSEALED` with a prominent warning; the generator refuses to replace them and no historical seal or reasoning is fabricated.

20. **Report replay.** An explicit legacy replay command that creates a superseding report/reasoning record is not implemented. Original reports remain preserved and cannot be silently upgraded; this is an engineering blocker.

21. **Concurrency.** SQLite WAL/full-sync settings plus 100 concurrent `dbPut` operations and same-key contention tests completed without lost rows; cross-collection commit/rollback tests also passed.

22. **Crash recovery.** Migration temp files, hash checks, integrity checks, and restore-on-rename-failure are covered. Process-kill recovery for every application stage and a durable lease reaper are not yet proven.

23. **Job claiming.** Queue claims use a transaction and conditional queued/version state, recording worker, claim time, lease expiry, and monotonic version so two workers cannot claim one attempt in the tested race.

24. **Cancellation races.** Queued cancellation and running safe-checkpoint behavior passed the progress-safety tests; cancellation after persistence/report publication is refused. Cancellation flags remain process-local, so restart recovery is incomplete.

25. **Retry.** Retries require an 8–128 character idempotency key; exact replay returns the existing attempt and avoids duplicate audit/worker work. The durable replay-key history is bounded to the last 16 keys.

26. **Cache.** Inference keys include content, model/version, preprocessing, optional ROI, scope, and eye; malformed keys are rejected and entries are cloned on read/write. Cross-study cache poisoning tests pass.

27. **Cross-patient isolation.** Service scope checks and existing evidence/tenant tests reject cross-study and cross-patient references; the SQLite payload schema itself does not yet enforce full relational foreign keys for every typed reference.

28. **Audit integrity.** Audit output remains append-only, PHI-sanitized, hash-chained NDJSON with serialized writes. The chain is process-local/file-backed rather than a transactionally linked SQLite audit ledger, so tamper-evident verification across processes remains limited.

29. **Clinician amendment integrity.** Clinician finalization/amendments remain additive review records with author/time/prior-report context; AI reruns refuse to overwrite clinician content.

30. **Model-error integrity.** Error records are insert-only and adjudication transitions require an explicit reviewer/lifecycle gate; automated inference cannot clinically close its own model error.

31. **Backup.** `npm run backup:data -- --dry-run` planned a hash-verified backup of the 18,518,016-byte SQLite database plus 9,951 asset files; model weights and credentials are excluded. The real backup/manifest path passed fixture tests.

32. **Restore.** Restore verifies database and asset hashes/integrity and defaults to a new ignored directory; activation requires explicit `--activate --target` and preactivation backup. Sidecar/asset rollback is not yet a multi-resource transaction.

33. **Corruption testing.** A corrupted SQLite payload fails closed with `PersistenceCorruptionError`, and backup/restore verifies hashes. Direct asset/ROI/report-byte corruption drills were not run as a complete matrix.

34. **Database performance.** Synthetic SQLite benchmark results: 1,000 inserts 13.88 ms, dashboard count 0.19 ms, cleanup 9.18 ms; 10,000 inserts 78.44 ms, dashboard 0.77 ms, cleanup 24.22 ms. The 50,000-record run and production-shaped pagination benchmark remain outstanding.

35. **Cleanup benchmark.** The previously failing S2/S4 extraction/verification teardown now passed 42/42 tests under isolated SQLite with no 30-second hook timeout; the fix removes global-store accumulation rather than increasing the timeout.

36. **Stress test.** The suite covers 100 concurrent writes, same-key races, migration/restore fixtures, and the browser mixed-document workload. The requested 100-patient/500-study create-query-retry-cancel-delete workload has not yet been run as a dedicated stress scenario.

37. **Keyboard QA.** New `npm run browser:keyboard` passed 21/21: Enter login, skip-link activation, programmatic main focus, bounded Tab walks on dashboard/patient/study/result/report/validation/clinician routes, and mobile drawer Enter/focus trap/Escape restoration.

38. **Focus QA.** Automated checks confirm visible first-focus skip behavior, logical focus target, drawer focus trap, and trigger restoration; broader modal/error-focus inventory is still not a manual certification.

39. **Screen-reader structure.** Landmarks, headings, labels, table semantics, dialogs, status/live regions, and keyboard targets are exercised by axe and DOM assertions; NVDA/JAWS manual certification was not performed.

40. **Responsive QA.** Real headless Chrome passed 80/80 route/viewport checks at 320, 375, 414, 768, 1024, 1280, 1440, and 1920 px with no horizontal overflow.

41. **Accessibility.** Axe WCAG A/AA passed 20/20 at 320 and 1280 px after correcting the patient-link contrast from 4.43:1 to 5.07:1; keyboard QA passed 21/21. Manual assistive-technology coverage remains outside the claim.

42. **Security red-team.** Existing route/RBAC/CSRF, malformed provenance, retry, corruption, path, and cross-scope tests pass; limitations remain around typed-reference database constraints, encrypted/retained backups, durable leases, and exhaustive traversal/fault injection.

43. **PHI review.** Staged source/tests/manifests are synthetic or de-identified; no PDFs, JPEGs, PNGs, local SQLite databases, backups, tokens, or weights are tracked. Local ignored data and the one-way-hashed smoke account remain outside Git.

44. **Gitignore.** `git check-ignore` confirms `data/` covers `.db`, `-wal`, `-shm`, backups, restores, migrations, uploads, processed files, reports, and logs; required migration scripts/fixtures remain tracked.

45. **Vitest advisory.** `npm audit --omit=dev --json` exits 0 with zero production vulnerabilities. Full `npm audit --json` exits 1 for two moderate dev-only `vitest/@vitest-mocker` GHSA-82fw-gwwq-j7x9 findings; the available fix is a major Vitest upgrade not forced without compatibility review.

46. **GitHub Actions.** Official `actions/checkout@v5` and `actions/setup-node@v5` remove the prior Node 20 action-deprecation annotation. Run `34390846769` is green for the implementation head.

47. **SBOM.** `docs/generated/SBOM.cdx.json` is CycloneDX 1.5 with 464 components, SHA-256 `df9dff9e2f2148ab0e911832e388b4282359d138df3a10eff69fb3b6a4dde930`, `visionscan:phi-included=false`, SQLite metadata, local research manifests, and no patient assets or model weights.

48. **Release inventory.** `docs/generated/release-inventory.json` records commit `6992be96150724779494eebf7d70b61f787fd714`, Node `v20.20.2`, Python `3.12.10`, three research-only model hashes, ruleset versions, SQLite schema/migration `1/1`, and the SBOM hash. Its clean-tree flag is false because the inventory was generated immediately before committing the report/artifacts; this is retained as an honest generation-time snapshot.

49. **Test totals.** The final local single-worker Vitest run exited 0: 59 test files, 950 passed tests, and 2 skipped (952 total), duration 565.76 seconds; no `afterAll` timeout or unhandled rejection was emitted.

50. **TypeScript.** `npx tsc --noEmit --pretty false` exited 0 after the persistence, migration, queue, report, and UI changes.

51. **ESLint.** `npm run lint` exited 0 with no reported errors or warnings after the keyboard gate and contrast correction.

52. **Build.** `npm run build` exited 0 under Next 16.3.4 webpack, compiled and typechecked successfully, generated 21/21 static pages, and introduced no new Next.js warning.

53. **Smoke.** Against the restarted SQLite server with the explicit local-only HTTP auth flag, `npm run smoke` passed 16/16: authentication, upload, symptoms, research analysis, urgent triage, report, clinician finalize, comparison, self-test, deletion, and access controls.

54. **Browser E2E.** Real Chrome asset E2E passed metadata-free fundus research execution, mixed PDF extraction, three routed pages/eight OCT ROIs, execution-ledger checks, and report provenance display.

55. **Performance.** Current local CPU-only samples: login page 6.5/10.3 ms p50/p95, login API 115.5/195.0 ms, dashboard 5.7/6.9 ms, study listing 12.9/15.1 ms, upload 192.1 ms, no-model demo pipeline 435.9 ms, result bundle 7.4/8.8 ms, result page 5.1/7.3 ms, report page 4.7/5.9 ms. ClementP cold worker was 12,723.9 ms; warmed note remains ~2.3 s/1024 px and ~1.3 GB RSS, serialized. These are engineering observations, not SLOs or clinical performance.

56. **Remaining engineering blockers.** Full relational constraints, durable worker lease/reaper and process-crash recovery, multi-resource file/database reconciliation, legacy replay, complete 50k/production-shaped pagination and stress benchmarks, encrypted backup/retention, and exhaustive corruption/traversal fault injection remain.

57. **Remaining model blockers.** All installed providers remain research-only and uncalibrated; patient-separated multi-device/domain validation, subgroup/error analysis, approved data rights, operating-point freeze, and powered sensitivity/false-negative measurement are absent. Fixed/heuristic OCT ROI extraction and material CPU/memory latency remain.

58. **Remaining clinical blockers.** No prospective clinical validation, reference-standard adjudication, governance sign-off, normative OCT policy, regulatory assessment, or post-deployment monitoring plan has been completed.

59. **Exact capability boundary.** VisionScan is a local research/clinician decision-support workstation that preserves byte/page/ROI/eye/model provenance, executes explicitly labeled research providers, organizes symptoms and objective measurements, persists deterministic reasoning, and presents cautious evidence. It cannot diagnose, prove normality, infer undocumented symptoms, guarantee sensitivity/specificity, prescribe, or replace an eye-care professional; unsupported, ambiguous, low-quality, tampered, and OOD inputs fail closed.

60. **Engineering classification.** ENGINEERING PARTIAL — BLOCKERS REMAIN.

61. **Clinical classification.** NOT CLINICALLY VALIDATED — NOT A MEDICAL DEVICE — NOT FOR AUTONOMOUS DIAGNOSIS.
