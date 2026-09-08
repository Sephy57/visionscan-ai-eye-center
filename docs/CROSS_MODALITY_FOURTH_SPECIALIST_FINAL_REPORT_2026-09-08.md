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
