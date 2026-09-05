# Phase 4 Forensic Audit — Real Ophthalmic Model Integration Readiness

Date: 2026-09-01
Auditor: independent re-verification (not the agent that wrote the Phase 4 commit)

## 0. Ground truth vs. the handoff document

The handoff brief this audit responds to claimed:
- Current HEAD: `72bf51e`
- Phase 4 not yet started

**Actual state, independently verified:**
- `git rev-parse HEAD` → `260b6e2754c920fcc950d3cd11d2fdd340d8b907`
- History: `06b131c → 764d0b3 → ab6ec8c → 85be9af → 72bf51e → 62fca8e → 260b6e2`
- `260b6e2` ("Phase 4: real-model integration readiness") already implements the large majority of the Phase 4 spec's infrastructure. The handoff's premise was stale by two commits.
- Working tree at audit time: 5 modified files. Two (`app/analyze/page.tsx`, `app/processing/page.tsx`) are this session's own bug fixes (a broken upload `XMLHttpRequest` call order, and a missing poll timeout in the processing page) — unrelated to Phase 4. The other three (`app/clinician/page.tsx`, `app/compare/page.tsx`, `app/devices/page.tsx`) are **pure CRLF/LF line-ending noise** — `git diff -w` on all three is empty. No real content change. Safe to leave uncommitted or normalize later.

## 1. Test/build verification (actually run, not trusted from prior report)

| Check | Result |
|---|---|
| `npm test` | **156/156 passed** (5 files) — previously reported as "108/108"; the count grew because `tests/phase4.test.ts` (48 tests) was added in `260b6e2`. All still pass. |
| `npm run smoke` | **13/13 passed** |
| `npm run build` | **Passed**, after clearing a stale `.next/trace` lock left by dev-server processes from earlier in this session (environmental, not a code defect) |
| `npm run audit:fs` | **Passed** — all data under `D:\...`, only Node.js runtime itself is on `C:` (unavoidable) |
| `node scripts/visual-qa.mjs` | **Passed** — all 10 routes: exactly one sidebar, no duplicated mobile-nav, 11 nav links, one banner |
| `GET /api/selftest` (admin self-test) | **13/13 passed** |

One real, minor defect found that none of the above catch: `npx tsc --noEmit` reports **6 type errors in `tests/phase4.test.ts`** — object literals missing the now-required `failure_type` field on `FailureCase` (`lib/research/failureAnalysis.ts:14`). `vitest` transpiles without full type-checking, so these tests still run and pass at runtime, masking the type-safety gap. `next build`'s type check doesn't cover `tests/`, so it's invisible there too. **Not a regression from this audit's own changes** — pre-existing in the Phase 4 commit.

## 2. Model provider architecture (Step 2) — REAL

`lib/models/provider.ts` — `EyeModelProvider` interface (`loadModel/validateModel/analyzeStudy/getCapabilities/getModelMetadata/unloadModel`) exists exactly as specified. Only `PlaceholderDemoProvider` is registered, correctly locked to `DEMO` status, gated through `gateOrThrow()` before it can run, and modality-checked before producing findings (provider.ts:108-121). The pipeline never talks to ONNX/PyTorch/etc. directly — this is a genuine adapter boundary ready for a real provider to be added alongside the placeholder.

## 3. Model registry (Step 3) — REAL, thorough

`lib/models/registry.ts` — `ModelRecord` has every field the spec's Step 3 list asks for (id, name, version, sha256, format, modalities, anatomy, supported findings/conditions/devices, input/output schema references, preprocessing via manifest, intended use, contraindications, limitations, validation status, evidence references via `performance.evidence_reference`, calibration reference, license/source via manifest). Status lifecycle `DEMO → RESEARCH → INTERNAL_VALIDATION → EXTERNALLY_VALIDATED → CLINICALLY_VALIDATED → RETIRED` is enforced via `STATUS_CAPABILITIES` and `gateModelUse()`. `auditRegistryConsistency()` self-audits for claimed-but-unevidenced validation. Only one model is registered: the DEMO placeholder, `sha256: null`, `status: "DEMO"` — correct and honest.

## 4. Model package format + integrity (Steps 3/4) — REAL, fail-closed

- `lib/models/package.ts`: manifest+artifact package format (`data/models/<id>/manifest.json` + artifact file). `validateManifest()` requires every field non-defaulted; `loadModelPackage()` fails closed on unregistered id, malformed JSON, missing artifact, or **checksum mismatch** (rejects and audits, never executes). Path-traversal-safe (`pkgDir`/`artifactPath` bounds-checked against `MODEL_ROOT`).
- `lib/models/integrity.ts`: `verifyModelIntegrity()` — same fail-closed pattern for the registry-level check; a DEMO placeholder with no artifact is trusted only because it explicitly declares `format: "placeholder"` + `status: "DEMO"` + `file_path: null`; anything else with no file_path or a hash mismatch is rejected.
- `data/models/` directory: **confirmed empty**. No model artifact currently installed, as required.

## 5. Modality & device compatibility (Steps 5/6)

- **Modality — REAL, enforced.** `lib/models/modalities.ts` declares a canonical modality enum + alias table; `checkModalitySupported()` is called by the provider (provider.ts:108) before findings are produced, and blocks mismatches with an explicit reason.
- **Device — REAL as a function, but NOT enforced as an execution gate.** `deviceCompatible()` (registry.ts:355) correctly returns "has not been validated" for unknown devices/models with no device list. However, grepping all call sites shows it is used in exactly two places: (a) `lib/analysis/ood.ts:43` — feeds into the OOD signal (see §6), and (b) `pipeline.ts:198` — populates a `device_compatibility` **metadata field in the output**, after Stage 3 has already produced findings. `gateModelUse()`, the actual "may this model run" gate, has no device check at all. **This is a real, if currently low-impact (only a DEMO model exists so far), architectural gap**: a future real model with an empty or mismatched `devices` list would still have inference run against it; only the OOD flag and displayed metadata would say "not validated," not a hard block.

## 6. Quality gate & OOD (Steps 7/8)

- **Quality gate — REAL.** `lib/imaging/quality.ts` computes real deterministic metrics (sharpness, illumination, clipping, resolution, colorfulness); `pipeline.ts` sets `findings: qualityAcceptable ? findings : []` — a failed quality gate **hard-empties findings**, satisfying Step 7 exactly.
- **OOD — REAL, and correctly worded**, but not fully gating. `lib/analysis/ood.ts` never emits "normal/healthy" language; it returns the mandated `"Input is outside the validated operating conditions of this model."` and feeds reasons from modality mismatch, missing metadata, device incompatibility, and image-characteristic heuristics. `runTriage()` (`lib/clinical/triage.ts:129`, rule `ood_prevents_normality_claim`) **always** forces `prompt_professional_review` and never lets OOD-detected cases fall through to a routine/normal outcome — this is a strong, verified safety property at the triage/recommendation level.
  - **Gap**: Stage 3 finding-generation in `pipeline.ts` gates only on `qualityAcceptable && modelGate?.allowed` — it does **not** check `ood.detected`. So in an OOD-but-quality-pass scenario (e.g. unsupported device, missing acquisition metadata), synthetic DEMO findings can still be generated and displayed in the `findings` array alongside the OOD notice and the forced "prompt_professional_review" triage. No false "normal" claim ever reaches the user (verified: `runSafetyChecks` rule `ood_no_normality_claim` also checks this independently), but Step 7's literal instruction ("If quality fails: DO NOT perform medical inference") is not extended to the OOD case the way it is to the quality case. Low real-world severity today (DEMO findings always carry disclaimers), but worth closing before a real model is installed.

## 7. Output schema (Step 9) — REAL

`lib/models/outputContract.ts` — `RawModelOutput`/`RawFinding` + `validateRawModelOutput()`. Matches the spec's conceptual shape closely: `study_id, model_id, model_version, modality, laterality, findings[], conditions[], localization, segmentation, confidence (raw), calibrated_confidence, uncertainty, quality_status, ood_status, inference_status, limitations`. `inference_status` is the only mandatory field; a `"failed"` inference is required to carry zero findings (enforced, not just documented). Field names are singular/slightly different from the spec's plural sketch (`localization` vs `localizations`) — cosmetic only, not a functional gap.

## 8. Calibration (Step 13) — REAL, exact match

`lib/models/calibration.ts` — `CalibrationRecord` + `CalibratedScore` use the spec's exact vocabulary: `raw_score`, `calibrated_probability`, `calibration_method`, `calibration_dataset`, `calibration_date`, plus `ece_after` and a mandatory `evidence_ref`. `applyCalibration()` refuses to run without a record that passes `validateCalibrationRecord()` (which requires the evidence reference). `mayDisplayCalibrated()` is the single guard presentation code must call. No raw score anywhere in this deployment is currently labeled "confidence"/"probability of disease" without going through this — the only registered model has `calibration_available: false`.

## 9. Condition gating (Step 11) — REAL

`lib/clinical/conditions.ts` — `possibleConditions()` returns an empty list unless: model status is `EXTERNALLY_VALIDATED` or `CLINICALLY_VALIDATED` **and** `hasValidationEvidence` **and** the condition's declared modality matches **and** at least one relevant finding type is actually present. The DEMO model's `supported_conditions: []` means conditions are structurally impossible today regardless. Device-specific gating is not part of this function (consistent with the device gap noted in §5); the overarching `runSafetyChecks` rule `conditions_blocked_for_demo_models` (safety.ts:157-163) independently double-checks the DEMO case.

## 10. Evidence gates & status transitions (Step 20) — REAL, with one durability caveat

- `lib/research/evidence.ts` — `EvidenceRecord` requires dataset ref, population, methodology, metrics summary, evaluation date; `registerEvidence()` validates before persisting. A bare `validated: true` is structurally impossible to express.
- `lib/models/transitions.ts` — `requestStatusTransition()` enforces: no ladder-skipping, minimum evidence count per transition, external-study evidence required from `INTERNAL_VALIDATION` onward, validation date + calibration required for the higher transitions. Every request (approved or rejected) is persisted to a `transitions` collection and audited.
- **Caveat (self-documented in the code, confirmed real):** `transitions.ts:154-156` — an approved transition mutates `model.status` on the **in-memory** `MODELS` object, not a persisted registry store. The `transitions` collection is a durable audit trail of *decisions*, but the live model status itself would revert to its source-code default (`DEMO`) on a process/server restart. The comment calls this out as "a planned upgrade." **This is the single most consequential gap for real-world use**: today it's invisible because the only registered model never changes status, but it must be fixed before any real model transition is granted, or a restart would silently (if honestly, on next boot) demote a model without anyone requesting it.

## 11. Validation infrastructure (Step 14) — REAL, thorough

`lib/research/metrics.ts` — confusion matrix, sensitivity/specificity/PPV/NPV, rank-based AUROC, AUPRC, 10-bin ECE + reliability bins, subgroup breakdowns. Explicitly never reports a headline "accuracy" figure (`evaluate()` notes array says so outright). `lib/research/failureAnalysis.ts` — false negatives/positives, **missed-urgent-case list**, FN rate split by urgent-vs-non-urgent presentation (with an explicit safety note if urgent FN rate exceeds non-urgent), FN by symptom category, FN by device/subgroup, FN with-vs-without-symptoms. `lib/research/evaluationRuns.ts` persists all of this per run and explicitly refuses to merge internal/external/device/modality splits into one number (`compareRuns()`).

## 12. Patient-level leakage & locked datasets (Steps 15/16) — REAL

`lib/research/datasets.ts`: `addSample()` rejects any `patient_key` that already appears in a different split unless a `documented_exemption` string is supplied (itself audited separately from a normal add). Locked (`purpose: "locked_test"`) datasets reject any sample addition or reference-label mutation outright unless the same exemption path is used. `evaluationRuns.ts` additionally re-checks for duplicate `patient_ids` **within a single run**. `deidentifyPatientKey()` salts+hashes raw identifiers — patient keys are never raw. This meets the spec's "hard requirement" language.

## 13. Multi-grader adjudication (Step 17) — REAL CODE, BUT NOT WIRED TO ANY ROUTE (genuine gap)

`recordAnnotations()`, `adjudicate()`, and `setReferenceLabel()` in `lib/research/datasets.ts:151-221` are genuine, well-designed production functions: ≥2 independent grader annotations required, agreement computed (unanimous/majority/disagreement/insufficient), a disagreement **cannot** produce a final label until an `adjudicate()` call is made, and the adjudicator may only select one of the recorded annotations (never invent a new label) — matches the spec precisely.

**However**: `grep -rln "recordAnnotations\|adjudicate\|setReferenceLabel\|createDataset\|addSample" app/ components/` returns **zero results**. The only caller anywhere in the repo is `tests/research.test.ts`. There is no API route and no UI page that lets an actual researcher/admin invoke this workflow. It is fully real as a library, but currently unreachable as a feature — the distinction the brief specifically asked to be precise about.

## 14. Model cards (Step 19) — REAL

`lib/reports/modelCard.ts` — `generateModelCard()` builds a card purely from registry fields (never invents data): intended use, contraindications, limitations, modalities, devices ("None — device compatibility has not been validated" when empty), training/validation dataset description, patient-level-split flag (explicitly flags `false` as "NOT ACCEPTABLE"), full metrics table with "Not measured" for nulls, regulatory status, artifact SHA-256.

## 15. Audit trail (Step 22) — REAL

`lib/audit/index.ts` — generic `AuditEvent` (actor/action/study id/outcome/detail, PII-scrubbing `sanitizeDetail()` that redacts anything matching image-data/base64/private-key/auth-header/password patterns) plus a dedicated `AnalysisAuditRecord` (study id, image sha256, model id/version/checksum, device, modality, quality score, findings count, uncertainty, ruleset version, triage priority, symptom flags, timestamp). Clinician finalize/review actions are captured through the generic `audit()` call with `actor: "clinician:<id>"` (verified in `lib/studies/service.ts`), separately from the per-analysis record — together these cover every field Step 22 asks for.

## 16. Safety firewall order (Step 21)

The spec's canonical order is: `INPUT → INTEGRITY → QUALITY → MODALITY → DEVICE → OOD → MODEL INFERENCE → OUTPUT SCHEMA → CALIBRATION → CONDITION GATE → SAFETY VALIDATOR → RESULT → CLINICIAN REVIEW`.

**Actual order found in `lib/analysis/pipeline.ts` (`runPipeline()`):**
1. Format/DICOM gate (`unsupportedResult` short-circuit)
2. Quality gate (real metrics)
3. Model registry gate + OOD assessment (modality, device, metadata, image-characteristic heuristics all folded into one `assessOod()` call — device/modality checks happen here, not as separate earlier stages)
4. Segmentation placeholder (no-op)
5. Detector stage — gated on `qualityAcceptable && modelGate.allowed` (modality-checked inside the provider path; **not** OOD-checked, see §6 gap)
6. Ensemble/consistency
7. Uncertainty estimation (folds in OOD reasons)
8. Symptom correlation (context only, after model output)
9. Possible-conditions gating
10. Triage/clinical rules (also independently OOD-aware)
11. Result assembly (output-schema-shaped `AnalysisResult`, not the raw `RawModelOutput` — the outputContract module exists but isn't yet the literal type flowing through this specific pipeline; see note below)
12. Safety validator (`validateAnalysisResult` schema check + `DISALLOWED_CLAIM_PATTERNS` regex block, throws on failure — never stores/returns an invalid or blocked result)
13. Clinician review — handled downstream in `lib/studies/service.ts`, not part of this function

**Assessment**: functionally equivalent to the spec's intent (integrity/quality/modality/device/OOD all happen before findings are trusted; safety validation is the last gate before storage), but modality/device/OOD are **merged into one combined stage** rather than four discrete gates, and calibration/output-contract validation is not literally interposed as its own pipeline stage — `outputContract.ts`'s `validateRawModelOutput()` is a standalone module not yet called from `runPipeline()`. This makes sense given the only current "model" is the deterministic demo generator producing pipeline-native `Finding[]` directly rather than a `RawModelOutput` that needs contract validation — **but it means `outputContract.ts` and `calibration.ts` are currently unexercised in the live request path**, only in their own unit tests. Once a real provider is added that returns raw scores, `runPipeline` (or the provider's `analyzeStudy`) will need to actually call `validateRawModelOutput()` and `applyCalibration()`/`mayDisplayCalibrated()` — the plumbing exists but isn't yet connected end-to-end.

## Genuine gaps requiring implementation (ranked by importance)

1. **Registry status persistence** (`lib/models/transitions.ts:154-156`): an approved status transition mutates an in-memory object only; it does not survive a process restart. The transition *decision* is durably audited, but the live gate state is not. Must be fixed before any real model is ever promoted past DEMO.
2. **Device compatibility is not an execution gate**: `deviceCompatible()` is informational/OOD-input only; `gateModelUse()` never checks it. A future real model with `devices: []` or a mismatched device would still run inference (with only a metadata note and an OOD-driven "prompt_professional_review" catching it downstream) rather than being hard-blocked at the same point modality mismatches are blocked.
3. **`outputContract.ts` and `calibration.ts` are not yet wired into `runPipeline()`** — both modules are real, tested, and correct in isolation, but the live analysis path doesn't call `validateRawModelOutput()` or `applyCalibration()` because the only provider today emits pipeline-native findings directly, not a `RawModelOutput`. This is expected integration work for whenever a real provider is added, not a bug today, but it is the literal "connect the plumbing" work the next real-model integration will require.
4. **Multi-grader adjudication has no reachable entry point**: `recordAnnotations`/`adjudicate`/`setReferenceLabel`/`createDataset`/`addSample` are real, correct, tested library functions with zero API routes or UI wiring — currently only reachable from unit tests, not from the running application.
5. **OOD does not gate Stage-3 finding generation**, only quality and modality-per-provider do; triage and the safety validator both independently prevent any false "normal" claim from reaching the user, so the practical risk is currently low, but this is a narrower interpretation of Step 7/8 than literally written.
6. **`tests/phase4.test.ts` has 6 objects missing the required `failure_type` field** on `FailureCase` — a genuine `tsc --noEmit` type error that `vitest`'s transpile-only runner silently lets pass at runtime. Cosmetic/test-hygiene only, not a production defect.
7. **`lib/clinical/safety.ts:132-136`** — rule `no_invented_clinician_approval` is hardcoded `passed: true` with a comment saying it's "enforced structurally in the review service" instead. Plausible (clinician finalize logic in `lib/studies/service.ts` does gate on `reviewer_id`), but this specific safety-check rule provides no actual verification at this layer — worth either removing the no-op check or actually asserting something at this layer.

None of the above are exploitable overclaiming risks today: the only installed model is the DEMO placeholder, `data/models/` is empty, no forbidden claim language exists anywhere in the codebase (verified by grep), and multiple independent layers (registry gate, taxonomy gate, condition gate, triage rules, safety validator) all separately enforce "no unearned validation claim, no false normal claim." The gaps above matter for when a **real** model is actually installed, not for the current DEMO deployment's honesty.

## Current medical status (unchanged, verified)

- `VALIDATION_STATUS` banner: `"NOT VALIDATED - NOT A MEDICAL DEVICE - NOT FOR CLINICAL USE"` — present in `.env`, surfaced via `VALIDATION_STATUS_BANNER` in every analysis result's `safety.disclaimers`.
- Model installed: **NO**. `data/models/` is empty; only the synthetic DEMO placeholder is registered.
- No accuracy, sensitivity, specificity, or FDA/CE claims exist anywhere in the codebase (verified by grep for `100%`, `FDA`, `CE cert`, `diagnostic confidence` — zero hits outside the regex patterns that exist specifically to *block* such claims).
