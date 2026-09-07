# VISIONSCAN AI — REAL OPHTHALMIC IMAGING FINAL REPORT

Release date: 2026-09-07 (Asia/Manila)

1. **Starting HEAD:** `41001e243ea129e4679d5319a2898dd5763bdc85` on `main`; the worktree was clean.
2. **Ending implementation HEAD:** `eedc1e4d7cee6b19a3f5113396698ff00aac4eb4`. The final report-only commit is recorded in the handoff because a commit cannot embed its own hash without changing it.
3. **Git status:** clean after the implementation commit and push; the report itself is the only subsequent documentation change before its commit.
4. **Files changed:** 48 implementation files, 1,388 insertions and 183 deletions. Changes span analysis/triage, model governance and integrity, localization, API/coverage, report generation, UI/accessibility, inference probes, QA/performance scripts, tests, and documentation.
5. **Sub-agents used:** repository/observability architect; UI/UX and regression auditor; lesion-model validation/security auditor. The main agent reviewed and integrated findings. A separate lesion-runtime track hit a usage-limit error and contributed no accepted result.
6. **Fundus models investigated:** ClementP U-Net SE-ResNeXt50 32x4d lesion segmenter; SegFormer optic-disc/cup REFUGE research model; existing synthetic demo provider; broad retinal anomaly coverage. No defensible broad abnormality model was available locally.
7. **Model actually activated:** none. `data/models/` remains empty. ClementP remains `CANDIDATE_ONLY / DISABLED`; SegFormer remains isolated research anatomy; the live registered imaging output remains explicitly synthetic/demo.
8. **Model license:** ClementP artifact is tagged MIT, but the declared training mix includes FGADR, whose official terms restrict use to non-commercial research. Derived-weight/training-data rights are unresolved, so the artifact is not cleared for activation.
9. **Artifact source:** pinned Hugging Face revision `a2cfcb594e483d8baa17f24e1152009641cb9847` of `ClementP/fundus-lesions-segmentation-unet_seresnext50_32x4d`; local artifact remains under gitignored `scratch/models/`, not the governed model store.
10. **Artifact SHA-256:** `a7a7cb45b92328f7c9a8e581eec3944fd435d37fae8cbf340b1319c5f987c6d2`; size 138,428,676 bytes.
11. **Safe-loading result:** SafeTensors header inspection found 444 tensors and no object/pickle payload. A historical isolated probe strict-loaded 444/444 tensors. The current dedicated runtime is not ready, and no third-party repository code or `trust_remote_code` was executed.
12. **Architecture reconstruction result:** the historical architecture is U-Net with SE-ResNeXt50 32x4d encoder and five channels ordered `BG, CTW, EX, HE, MA`. Reproducible current reconstruction stopped at the dependency gate: `torchseg`, `timm`, and `einops` are absent.
13. **Preprocessing:** pinned `clementp-source-pinned-1024-v1`; decoded fundus image, explicit crop metadata, aspect-preserving center letterbox to 1024×1024, and a recorded inverse transform. PIL dimensions are checked before OpenCV decode; artificial padding is suppressed.
14. **Postprocessing:** unfiltered five-channel argmax, padding removal, connected components, pixel-derived area/boxes/centroids, original-image normalized geometry, 10,000-region cap, and null raw scores. Components are explicitly not validated lesions and are not exposed to the product.
15. **Supported lesion classes:** the disabled candidate targets cotton-wool-spot-like, exudate-like, hemorrhage-like, and microaneurysm-like regions. No class is currently active in production.
16. **Unsupported pathology:** AMD/drusen, retinal detachment, vascular occlusion, tumors/choroidal lesions, macular disorders, and many other retinal diseases; broad abnormality detection is unavailable. OCT and DICOM pixel interpretation are unsupported.
17. **Real inference examples:** no current candidate inference was accepted because runtime readiness failed. Historical engineering-only execution exists, but no patient-specific result, diagnosis, or accuracy claim was promoted. The live smoke test exercised only the labeled synthetic/demo pipeline.
18. **CPU benchmark:** production local synthetic workload: upload 21.8 ms; full demo imaging pipeline 101.2 ms. HTTP p95: login page 6.2 ms, login API 62.6 ms, dashboard 4.3 ms, study list 4.7 ms, result bundle 5.2 ms, result page 3.6 ms, report page 3.6 ms. ClementP model load/inference are `null`; historical 2.24–2.37 s inference was not reproduced.
19. **Localization result:** mathematical conversion now covers crop, resize, letterbox, half-open model-pixel boxes, original-image normalized output, bounds, and malformed transforms. Nine golden tests pass for portrait, landscape, square, crop offset, padding/edge, zero/NaN, full-frame, multiple components, and inconsistent transforms.
20. **Overlay result:** viewer supports Original, Overlay, and Side-by-side; finite bounded non-empty boxes only; distinct toggles; correct pane measurement; keyboard zoom/pan status; responsive stacking. Unsupported mask/marker/heatmap layers say unavailable and are never fabricated.
21. **Validation dataset:** none legally and independently established for this candidate. Metrics remain null. Declared training/test sources cannot be treated as independent without signed sample/patient non-overlap evidence.
22. **Patient-separated validation methodology:** proposed freeze → development/calibration partition → never-touched patient-separated locked internal test → separate site/device external cohort; group both eyes, visits, and near-duplicates by patient; freeze artifact, runtime/SBOM, preprocessing, inverse transform, component rule, and thresholds before evaluation.
23. **Sensitivity:** not measured / not established.
24. **Specificity:** not measured / not established.
25. **Dice/IoU:** not measured / not established.
26. **AUROC/AUPRC:** not measured / not applicable without a validated image-level score and locked decision rule.
27. **Calibration status:** `NOT_CALIBRATED`; no threshold was tuned against the supplied image and no confidence/probability is emitted.
28. **False positives:** one historical 16-pixel component is recorded only as a possible unvalidated false-positive candidate. No disease label is assigned.
29. **False negatives:** the user-reported missed abnormal fundus is recorded as an unverified false-negative candidate/coverage failure. The system does not invent its pathology.
30. **Known failure modes:** unsupported pathology; unavailable broad detector; missing candidate dependencies; unresolved training-data rights; writable scratch ACL; absent independent validation/calibration; image quality/OOD rejection; unfiltered argmax component semantics; CPU/resource limits.
31. **OOD results:** existing regression coverage includes non-eye/invalid/extreme inputs and prevents clinically presented findings. Production smoke returned `INPUT OUT OF DISTRIBUTION — AUTOMATED FUNDUS INTERPRETATION INCONCLUSIVE` and retained urgent symptom escalation.
32. **Quality-gate results:** poor images fail with zero findings and `IMAGE_NOT_SUITABLE` semantics; a pass does not imply perfect quality. Quality and OOD remain gates before model presentation.
33. **PDF/document integration:** preserved working local PDF validation, text/OCR extraction, structured measurements/history/symptoms/medications/allergies, immutable originals, source page/text/method/status provenance, negation, and prompt-injection-as-data behavior.
34. **Image/document evidence fusion:** remains provenance-separated: AI observations, document facts, objective measurements, symptoms/history, and document-reported diagnoses are distinct evidence types. No document diagnosis becomes an AI diagnosis.
35. **Condition-association changes:** no unsupported disease classifier was added. Existing evidence requirements, supporting/contradicting/missing evidence, and confirmation requirements remain gated. Coverage metadata now prevents target-negative output from implying global absence.
36. **Etiology behavior:** automated output remains possible association/possible etiology with causality unestablished; no causal certainty is generated.
37. **Medication behavior:** unchanged fail-closed policy; no medication or treatment recommendation is inferred from imaging or document text.
38. **Clinician workflow:** research-unavailable states are visible, review layout stacks on mobile, overlays expose technical provenance, and report coverage is snapshotted. Clinician interpretation remains separate from AI output and final assessment.
39. **UI redesign:** capability table, explicit zero active production targets, unsupported-pathology disclosure, Original/Overlay/Side-by-side scan viewer, honest processing stages, optional symptoms, accessible mobile drawer/focus trap, progress semantics, and keyboard-focusable scrolling tables.
40. **Responsive QA:** real Chrome, 10 routes × 8 widths (`320, 375, 414, 768, 1024, 1280, 1440, 1920`) = 80/80 passed; structural visual QA 10/10 passed.
41. **Accessibility QA:** real Chrome + axe WCAG A/AA, 10 routes at 320 and 1280 = 20/20 passed. Fixed prohibited generic-span ARIA and keyboard-inaccessible scroll regions. Manual NVDA/JAWS testing was not performed and is not claimed.
42. **Security/red-team findings:** fail-closed output envelope pins completed status, image/artifact hashes, model/version, 5×1024×1024 shape, preprocessing/threshold versions, class order, null score semantics, geometry, limits, and malformed nested input handling. Package/registry integrity adds safe relative paths, regular-file/symlink checks, realpath containment, bounded streaming hashes, and distinguishes integrity from authorization.
43. **Cross-patient/tenant isolation:** existing scope, IDOR, tenant, patient, CSRF, RBAC, consent, and client/model spoofing tests passed; no boundary was weakened.
44. **Exact tests added:** new `fundus-localization-transform` (9), `ophthalmic-coverage` (4), and `ophthalmic-coverage-route` (3) suites; expanded lesion-contract tests to 11; added safety tests for absent/unavailable and unvalidated-negative detectors; expanded package-manifest hostile-input tests. Post-final UI targeted regression: 75/75.
45. **Full test count:** 41 files passed; 806 passed, 2 intentionally skipped, 0 failed; 321.02 s in the definitive isolated run. A discarded parallel build/test attempt caused three timeout-only failures and was rerun alone successfully.
46. **TypeScript result:** `npx tsc --noEmit` passed, including the final post-accessibility state.
47. **Build result:** `npm run build` passed in production mode; compile, TypeScript, page data, and 20 static pages completed. Next.js only reports its existing middleware-to-proxy deprecation warning.
48. **Smoke result:** 16/16 passed against the production server, including upload, structured symptoms, analysis, urgent escalation, report, review, quality rejection, auth, role behavior, and cleanup.
49. **Browser result:** structure 10/10, responsive 80/80, accessibility 20/20. Image viewer resizing and narrow-page overflow checks passed automated coverage.
50. **Dependency audit:** `npm audit` and `npm audit --omit=dev` both report zero vulnerabilities; filesystem audit passed with project/data on `D:`.
51. **Git commit:** implementation commit `eedc1e4d7cee6b19a3f5113396698ff00aac4eb4`, message `Harden ophthalmic imaging coverage and review UX`.
52. **GitHub push:** `41001e2..eedc1e4 main -> main` succeeded to the existing `origin` repository.
53. **GitHub CI URL/status:** implementation CI [run 34113172791](https://github.com/Sephy57/visionscan-ai-eye-center/actions/runs/34113172791) completed successfully. Final report-commit CI is recorded in the final handoff.
54. **Remaining clinical blockers:** legal clearance for declared training data/derived weights; immutable ACL-restricted packaging; attested interpreter and SBOM; OS-enforced network/CPU/memory/time sandbox; race-resistant hash-to-load; full dependency reconstruction; legally authorized patient-keyed internal/external datasets; calibration; clinical governance and clinical validation.
55. **Exact capability boundary:** VisionScan is a stronger local ophthalmic evidence-review workstation with explicit coverage, genuine geometry plumbing, safer candidate contracts, and fail-closed normality wording. It does **not** currently perform validated real fundus disease/lesion detection. No candidate model is active; no accuracy is established; no negative detector result can claim a normal eye; and only a qualified clinician can record a diagnosis.

## Release evidence

- Candidate integration and stop-gate detail: `docs/FUNDUS_LESION_MODEL_INTEGRATION.md`
- False-negative/coverage analysis: `docs/FUNDUS_FALSE_NEGATIVE_ANALYSIS_2026-09-07.md`
- Machine-readable failure record: `docs/evaluations/fundus-lesion-candidate-failure-analysis-2026-09-07.json`
- Candidate model card: <https://huggingface.co/ClementP/fundus-lesions-segmentation-unet_seresnext50_32x4d>
- FGADR terms: <https://csyizhou.github.io/FGADR/>
- IDRiD data page: <https://idrid.grand-challenge.org/Data/>
