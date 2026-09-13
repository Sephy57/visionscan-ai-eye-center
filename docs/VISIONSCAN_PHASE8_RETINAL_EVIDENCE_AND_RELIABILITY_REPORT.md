# VisionScan AI Eye Center — Phase 8 Retinal Evidence and Reliability Report

## Executive outcome

Phase 8 adds a deterministic, provenance-preserving retinal evidence fusion layer, a hashed registry for the 85 exact grade-3/grade-4 baseline misses, a named freeze for `LESION_ESCALATION_RULE_PHASE7_V1`, and append-only clinician review events. The evidence supports `RETINAL REVIEW INTELLIGENCE PARTIAL — INTERNAL HELD-OUT EVIDENCE ONLY`; it does not support disease recovery, external validation, DR candidate improvement, diagnosis, normality, or clinical deployment.

The strongest new aggregate is grade-specific review escalation: grade 3 95.38% (62/65) and grade 4 95.00% (19/20) under the frozen region-count rule. The registry is derived from the existing Phase 7 export, so `fresh_phase8_inference: false`; missing OCT, document, OOD, and independent-clinician fields remain `NOT_RECORDED`.

Runtime remains `LOCAL RUNTIME PARTIAL`: the 25-job point completed 15/25 because single-slot queue/resource wait consumed the 120000 ms deadline.

Clinical classification: `NOT CLINICALLY VALIDATED / NOT A MEDICAL DEVICE / NOT FOR AUTONOMOUS DIAGNOSIS`.

## Evidence anchors

- High-grade registry: `docs/generated/phase8-high-grade-miss-registry.json`
- Rule freeze: `docs/generated/phase8-lesion-rule-freeze.json`
- External-validation ledger: `docs/generated/phase8-external-lesion-validation.json`
- Runtime closure: `docs/generated/phase8-runtime-closure.json`
- Acceptance contracts: `tests/phase8-acceptance.test.ts`
- Implementation report data hash: `b1077b93d8e38c72d779e233597eac7f771c0a2b1b2a842181ff1109c28242fa`

## 1 Starting HEAD

Phase 8 preserves the published Phase 7 state from `9798d94f9078ba0beeac9780e22b5eb5edbf35e1` on `main`. The work is additive: it retains the DeepDRiD baseline, RetGuard stop, patient-separated lesion evidence, and runtime limitations.

## 2 Ending HEAD

The report was generated at `163df789dc16b19e2f98594b8485ffd6bcc79990`. Worktree state at generation was `CLEAN BEFORE REPORT ARTIFACT REFRESH`; a clean publication and exact-head CI result are not assumed from a local hash.

## 3 Commits

Phase 8 adds `RetinalEvidenceFusionEngine`, the hashed high-grade miss registry, the frozen `LESION_ESCALATION_RULE_PHASE7_V1` record, external-validation attempt ledger, append-only clinician-review events, a Phase 8 Validation Center projection, runtime-closure projection, negation-safe urgency handling, and the 36 requested acceptance contracts plus one regression contract. Generator SHA-256 is `484b890c1010d54857a980235e3520d767562c3055c3b009e53491fb22b1a81a`; report data projection SHA-256 is `b1077b93d8e38c72d779e233597eac7f771c0a2b1b2a842181ff1109c28242fa`.

## 4 Push

NOT RECORDED — publication state not inferred from a local checkout. A local checkout, even when clean, is not evidence that a remote branch contains this report.

## 5 Exact-head CI

NOT RECORDED — no exact-head Phase 8 CI run supplied. The historical Phase 7 run remains useful implementation evidence, but it is not exact-head Phase 8 CI unless the supplied commit matches `163df789dc16b19e2f98594b8485ffd6bcc79990`.

## 6 Phase 7 baseline

The frozen DeepDRiD regular-fundus validation cohort contains 400 images from 100 patients. At referable threshold `eye_grade >= 2`, TP 79, FN 101, FP 2, and TN 218 are retained. Sensitivity is 43.89% and specificity is 99.09%.

## 7 RetGuard state

RetGuard remains `CANDIDATE_ONLY / RIGHTS_RESTRICTED / NOT_BENCHMARK_READY`. Its fixed `0.001` logit-parity stop, incompatible/unverified preprocessing equivalence, and absent same-cohort candidate outputs are unchanged. No parity re-investigation or candidate metric is claimed.

## 8 Candidate discovery state

The Phase 7 candidate screen admitted no second comparator: `NO_SECOND_CANDIDATE_BENCHMARK_READY`. Unknown weights were not loaded, and publisher-reported numbers were not substituted for local predictions.

## 9 High-grade registry

The Phase 8 registry freezes 85 exact high-grade undercalls from the existing export: 65 grade-3 cases and 20 grade-4 cases. Each entry uses hashed case/patient keys only.

## 10 Grade-3 misses

The grade-3 definition is ground truth `3` with baseline prediction not equal to `3`. It contains 65 cases, with predicted grades {"0":12,"1":18,"2":35}.

## 11 Grade-4 misses

The grade-4 definition is ground truth `4` with baseline prediction not equal to `4`. It contains 20 cases, with predicted grades {"0":5,"1":7,"2":8}.

## 12 Grade-3 escalation coverage

The frozen `regions_ge_3` behavior escalated 62 of 65 grade-3 exact misses: 95.38%. This is review escalation coverage, not DR recovery.

## 13 Grade-4 escalation coverage

The frozen rule escalated 19 of 20 grade-4 exact misses: 95.00%. The single non-escalated grade-4 case remains explicitly represented; no safety conclusion is drawn.

## 14 High-grade non-escalated cases

Four high-grade entries are non-escalated under the frozen rule: three grade-3 and one grade-4. Their hashed registry records preserve baseline grade, source quality flag, lesion fields, and `NOT_RECORDED` OCT/document/independent-clinician/OOD states.

## 15 Lesion rule freeze

The alias `LESION_ESCALATION_RULE_PHASE7_V1` is frozen as `region_count >= 3`, selected on calibration only. It is bound to model `fundus-lesions-clementp-unet-seresnext50`, version `a2cfcb594e483`, artifact `a7a7cb45b92328f7c9a8e581eec3944fd435d37fae8cbf340b1319c5f987c6d2`, preprocessing `clementp-source-pinned-1024-v1`, split hash `2a0694734556e5a591efdc3c320eb44053031f83bef144bd3d9accf8b624add0`, and source hashes.

## 16 External validation dataset search

The bounded search considered IDRiD, APTOS 2019, RFMiD, TJDR, and the internal DeepDRiD cohort. The external decision is `EXTERNAL LESION ESCALATION VALIDATION NOT ESTABLISHED.`. No dataset was added to the Phase 7 denominator.

## 17 External dataset rights

IDRiD is publicly documented as CC BY 4.0, while RFMiD's referenced dataset card reports CC BY 4.0. Those observations do not authorize redistribution of data, annotations, or weights in this repository. APTOS and TJDR rights/manifest requirements remain unresolved. See the official [IDRiD data page](https://idrid.grand-challenge.org/Data/) and [RFMiD dataset card](https://huggingface.co/datasets/ctmedtech/RFMID).

## 18 External validation result

No external lesion inference was run. The exact state is `EXTERNAL LESION ESCALATION VALIDATION NOT ESTABLISHED.` External sensitivity, specificity, calibration, confidence intervals, and clinical utility are `NOT MEASURED`.

## 19 External review burden

External review burden is `NOT MEASURED`. The internal held-out burden remains a Phase 7 research measurement only: 50.76923076923077 review escalations per 100 applicable path cases.

## 20 External validation limitations

External validation is blocked by overlap disclosure, missing or incomplete patient/eye separation, absent locally verified lesion annotations/manifests, and unresolved rights. These are evidence blockers, not reasons to infer a negative result.

## 21 RetinalEvidenceFusionEngine

The new `RetinalEvidenceFusionEngine` is pure, deterministic, and versioned as `phase8-retinal-evidence-fusion-1.0.0`. It organizes evidence for review; it is explicitly not a diagnostic ensemble.

## 22 Evidence inputs

Inputs are the existing canonical evidence items: fundus/AI findings, OCT/test results, optic-disc evidence, source-document diagnoses, symptoms, history/medications/allergies, clinician observations, and longitudinal references. The engine does not create a new clinical source.

## 23 Dependency groups

Every active item is grouped by its explicit dependency group. Multiple models reading the same image occupy one shared-pixel group, so model count does not become independent evidence. The acceptance contract verifies a DR/lesion pair collapses to one group.

## 24 Trust hierarchy

The trust order is clinician-entered, human-verified, validated AI, auto-extracted, unverified, then rejected. The order affects review prioritization only; it never silently resolves a conflict or promotes research output to clinical truth.

## 25 Missing evidence

Missing fundus/OCT/optic-disc evidence, clinician observation, and patient-reported symptom context are emitted as named missing states. Missing is not converted to absent, negative, or normal.

## 26 Conflicts

Existing evidence conflicts remain visible, and the fusion layer adds a cross-modality review conflict when positive fundus evidence coexists with an OCT NORMAL estimate. The automatic resolution is always `NONE`.

## 27 Review priority

Priority is deterministic: emergency/urgent symptom flags first, then high priority for conflicts or quality/OOD blocks, then routine, with unable-to-assess when no active evidence exists. It is routing metadata, not a diagnosis or probability.

## 28 Urgency independence

Urgent red-flag symptoms are represented with `independent_of_ai_findings: true`. A reassuring, unavailable, or failed research result cannot suppress an emergency or urgent symptom route. Explicitly absent symptoms are excluded from urgency reasoning.

## 29 Fundus evidence

Fundus evidence remains research-only and no-signal is labeled `NO_SIGNAL_NOT_NORMAL`. Grade 0 or lesion no-signal cannot produce a healthy-eye claim.

## 30 OCT evidence

OCT remains a separate modality. `OCT_NORMAL` is represented as `NORMAL_ESTIMATE_NOT_HEALTHY`; it does not establish a healthy macula or exclude disease.

## 31 Optic-disc evidence

Optic-disc/cup segmentation remains the only narrow executable specialist path and remains `RESEARCH_ONLY`. It is not glaucoma diagnosis, staging, or treatment.

## 32 Document evidence

Document evidence retains source-document diagnosis provenance, page information, extraction state, and unreviewed trust. The engine never rewrites a source diagnosis as a VisionScan diagnosis.

## 33 Symptom evidence

Present symptoms route urgency and context only. Their structured type, laterality, onset, duration, severity, progression, and frequency remain distinct from image findings.

## 34 Longitudinal evidence

Longitudinal comparison remains read-only and scope-safe. The current implementation reports presence/count changes with explicit limitations and does not establish progression or treatment response.

## 35 Retina specialist

The retina lane has a real narrow research capability only; its output is clinician-review-required and not validated for autonomous diagnosis. No diabetic-retinopathy specialist model is implied by the lane name.

## 36 Glaucoma specialist

The glaucoma lane has no validated disease or CDR model. Missing evidence and `NO_VALIDATED_MODEL_AVAILABLE` are displayed rather than fabricated specialist findings.

## 37 Other specialists

Other specialties retain explicit unavailable states and missing confirmation requirements. The system does not create nine artificial AI doctors or infer unsupported disease capabilities.

## 38 Unsupported specialties

Unsupported claims include cataract, macular disease diagnosis, pathology, visual-acuity prediction, treatment authorization, and autonomous referral. These remain outside the system's validated boundary.

## 39 Condition reasoning

Condition reasoning remains deterministic and non-diagnostic. It emits possible/insufficient/conflicting states from provenance-bearing evidence and requires clinician correlation.

## 40 Source diagnoses

Source-document diagnoses remain labeled as source claims with document/page provenance. They are not merged into an AI diagnosis or used to bypass the diagnosis gate.

## 41 Negation

Explicit negation remains `ABSENT`; lack of mention remains `NOT_REPORTED` or `UNKNOWN`. The Phase 8 regression closes the separate urgency path so absent red-flag symptoms cannot generate urgent flags.

## 42 No-false-normal tests

The Phase 8 no-false-normal contracts cover DR grade 0, OCT NORMAL, and lesion no-signal. Each assertion checks a structured state or safety flag rather than a favorable fixture string.

## 43 Clinician review

Clinician review actions remain additive to the immutable AI layer. Confirm, reject, correct, indeterminate, request-new-scan, observation, treatment review, note, and finalize are represented as distinct actions.

## 44 Review reasons

Review events now carry an action-derived reason, optional bounded clinician rationale, finding/source references, dependency groups, and the AI snapshot hash. Missing rationale remains visible rather than invented.

## 45 Immutable review audit

The `clinician_reviews` collection is now append-only at the persistence writer for event IDs. A duplicate event ID fails closed; the current report remains a mutable projection for compatibility.

## 46 Clinician authority

Clinician authority is explicit: the authenticated session supplies reviewer identity, clinician-authored corrections remain separate, and AI findings are not overwritten. Laterality may be corrected in the additive correction record.

## 47 Claim ledger

The claim ledger envelope remains `claim-ledger-1.1.0`; Phase 8 dependency group IDs and independence state are additive optional fields. Claims retain evidence references, model execution IDs, and rule IDs.

## 48 Dependency provenance

A claim sharing model executions records the exact dependency groups. `DEPENDENT_SHARED_INPUT` is used for one shared group; multiple groups are described without asserting statistical independence.

## 49 Unsourced claim gate

The existing safety validator still blocks a tampered empty evidence reference list. The fusion claim itself is `RESEARCH_REVIEW_ONLY` and no unsourced presentation claim is admitted.

## 50 Report integrity

Reports retain version freeze and immutable reasoning snapshots. Clinician interpretation, corrections, observations, and final assessment remain additive and are not included in the AI seal.

## 51 Medication boundary

Medication extraction remains provenance-bound. No Phase 8 output prescribes, changes, stops, doses, or authorizes medication; treatment information remains clinician-review-gated.

## 52 Prompt-injection defense

The document classifier treats instruction-like text as untrusted data. Phase 8 tests exercise the repository's actual classifier and use matching adversarial strings; prompt text cannot change model, safety, or report behavior.

## 53 25-job root cause

Adversarial coverage now includes absent red-flag negation, PDF instruction-like text, medication instruction-like text, cross-modality conflict, OOD/quality blocks, laterality uncertainty, unavailable specialists, and immutable review writes.

## 54 Single-worker load

The 25-job runtime point is `LOCAL RUNTIME PARTIAL`; it is not complete. The actual run completed 15 of 25 jobs and failed 10.

## 55 Queue wait

The measured root cause is `BOUNDED_SINGLE_SLOT_QUEUE_DEADLINE`: one heavy-model reservation slot serialized work while queue/resource waiting consumed the deadline.

## 56 Resource wait

The real one-worker curve completed 1/1, 5/5, and 10/10; the 25-job point completed 15/25. This is a bounded serialized-load result, not production capacity.

## 57 Fairness

At 25 jobs, queue wait p50 was 16354.999 ms, p95 97586.922 ms, and max 115227.026 ms.

## 58 Throughput

At 25 jobs, resource wait p50 was 15767.058 ms, p95 97011.242 ms, and max 114653.692 ms. Resource wait, not model service latency, dominated the incomplete point.

## 59 CPU

Fairness is `NOT_MEASURED`. Completion order and wait distributions exist, but a starvation/fairness target was not predeclared or measured.

## 60 Memory

Measured throughput was 0.1203 jobs per second at the incomplete 25-job point. This does not imply a stable service-level objective.

## 61 Backpressure

The load probe records best-effort CPU seconds and thread counts, but no CPU quota or host-wide fairness guarantee. Thread controls are cooperative.

## 62 Persistence crash matrix

The real provider crash matrix observed forced termination and descendant cleanup for DR, lesion, and OCT windows. Persistence-stage recovery remains explicitly unmeasured.

## 63 Exactly-once effects

Exactly-once effects are `NOT_MEASURED`. No duplicate completion claim is inferred from process cleanup or a direct provider probe.

## 64 Deadline

A real queue deadline was enforced from queue claim at 120000 ms. Ten 25-job entries ended with `JOB_DEADLINE_EXCEEDED`; no unbounded wait is claimed.

## 65 Process cleanup

Process-tree cleanup was observed in the forced-termination matrix, with no completed payload observed in the termination windows. This is not persistence correctness.

## 66 Graceful shutdown

Graceful shutdown is `NOT_MEASURED`. Forced task termination is not substituted for a drain protocol.

## 67 Restart recovery

Restart recovery is `NOT_MEASURED`. No worker restart experiment was added without an auditable persistence boundary.

## 68 Resident lesion parity

Resident lesion execution has prior measured 20-case evidence. Resident-vs-short-lived parity is `NOT MEASURED`; the existing result does not establish output equivalence.

## 69 Resident lesion memory

The 20-case resident result recorded initial load 509.237 ms, warm p50 2831.528 ms, warm p95 3575.317 ms, and peak working set 1476771840 bytes.

## 70 Resident isolation

Resident isolation is bounded to independent manifest inputs and is labeled `BOUNDED_INPUT_SCOPE_ONLY`; it is not a full production isolation proof.

## 71 Resident cancellation

Resident cancellation is `NOT MEASURED`. No cancellation success or memory-release claim is inferred from serial completion.

## 72 Resident DR

Resident DR execution is `NOT MEASURED`. The available resident experiment is lesion-only.

## 73 Resident OCT

Resident OCT execution is `NOT MEASURED`. The OCT provider remains separately bounded and research-only.

## 74 Resident runtime decision

Runtime classification is `LOCAL RUNTIME PARTIAL`: real bounded admission, deadline, race, resident lesion, and provider-cleanup evidence exist, but persistence, fairness, graceful shutdown, restart, and full 25-job completion do not.

## 75 UI redesign

The Validation Center now has a Phase 8 section for high-grade registry state, frozen rule, external-validation attempts, fusion safety, and persistence gaps. Other analysis/review surfaces retain their existing research labels.

## 76 Imaging workspace

The existing imaging workspace keeps original scan preservation, quality state, research overlays, modality separation, and clinician review controls. Phase 8 does not invent a localization or heatmap where none exists.

## 77 Retinal review card

The retinal review card is represented by the evidence fusion contract and existing research panels: review priority, high-grade registry state, dependency warning, and no-false-normal language are explicit.

## 78 Evidence timeline

Evidence remains timeline/provenance-oriented: source type, laterality, temporal state, document/page, model/version, dependency group, conflict, and verification state are retained.

## 79 Specialist board

The specialist board retains one real narrow lane and explicit unavailable lanes. It does not display a synthetic consensus winner; conflicts and missing confirmation remain visible.

## 80 Review queue

The review queue is driven by deterministic priority and independent urgency. Clinician review events now provide an append-only audit source while the report projection remains compatible.

## 81 Validation Center

Validation Center's Phase 8 endpoint is role-gated to ADMIN/REVIEWER/RESEARCHER, aggregate-only, and PHI-free. It exposes hashed-registry aggregates, not raw entries.

## 82 Report UI

The report UI remains research-only and version-frozen. A negative/unavailable/OCT NORMAL result cannot render as a normal-eye conclusion.

## 83 Manual screenshot QA

Fresh PHI-free Chromium screenshots are `PASS — 27 PHI-free captures (9 requested surfaces × 3 viewports) generated in ignored data/tmp output`. The captures are kept in ignored local QA output and are not committed as validation artifacts.

## 84 Responsive

Responsive automated QA is `PASS — real Chromium automated responsive QA 88/88 route/viewport checks`. This verifies route rendering and horizontal-overflow constraints; it is not a substitute for manual screenshot inspection.

## 85 Accessibility

Accessibility automated QA is `PASS — real Chrome axe WCAG A/AA QA 22/22 route/viewport checks`. This is axe WCAG A/AA coverage, not NVDA/JAWS or independent accessibility certification.

## 86 Keyboard

Keyboard automated QA is `PASS — real Chrome keyboard/focus QA 23/23 checks`. It verifies skip links, focus targets, bounded tab walks, and the mobile drawer contract. Visual review of the screenshot set is `PASS — contact sheets containing all 27 captures were visually inspected for hierarchy, spacing, contrast, overflow, clipping, stacking, empty states, and research labels`; this does not constitute screen-reader certification.

## 87 Security

Security controls retain role checks, CSRF/session identity, tenant/study scope, redaction, prompt-safety classification, immutable AI snapshots, and append-only review events.

## 88 PHI

PHI-bearing review/evidence routes remain scoped. Aggregate Phase 8 artifacts set `phi_included: false` and do not persist raw case/image identifiers.

## 89 Secrets

No password, token, provider secret, or model secret is added by Phase 8. External source URLs are metadata; they are not credentialed access.

## 90 Consent

Consent remains required for the existing research-analysis endpoint. The new aggregate Validation Center route contains no patient study payload and is role-restricted.

## 91 Phase 8 acceptance

PASS — 37 Phase 8 tests passed (36 requested contracts plus one regression contract). The 36 requested acceptance names are present in `tests/phase8-acceptance.test.ts`; direct live provider persistence cases remain marked NOT MEASURED where the repository lacks a safe hook.

## 92 Equipped tests

The test contracts read actual generated artifacts and call the deterministic engine; they do not replace model output with fixed fixture answers. Registry counts are recomputed by the generator from the frozen export.

## 93 No-model tests

No-model behavior remains part of the existing test architecture. Phase 8 additions are pure or aggregate and do not require weights for hosted CI. Exact fresh no-model Phase 8 suite evidence is `NOT RECORDED`.

## 94 TypeScript

TypeScript status at report-generation time is `PASS — npx tsc --noEmit --pretty false`. The code path was checked during implementation; final evidence should be supplied by the exact verification run.

## 95 lint

Lint status is `PASS — npm run lint`.

## 96 build

Production build status is `PASS — npm run build and release:verify production_build`.

## 97 smoke

Smoke status is `PASS — 16/16 local smoke checks`.

## 98 browser E2E

Browser E2E status is `PASS — hosted-style Chromium smoke 7/7 checks; synthetic account, no model/data assets; browser asset E2E passed`. The final browser route/viewport inspection remains separate from automated smoke.

## 99 model audit

Model-manifest audit status is `PASS — npm run model:audit`; RetGuard remains outside the approved registry.

## 100 filesystem audit

Filesystem audit status is `PASS — npm run audit:fs`; no raw identifiers are present in the Phase 8 aggregate artifacts by construction.

## 101 SBOM

SBOM status is `PASS — npm run sbom and release:verify SBOM`.

## 102 release:data-check

Release data-check status is `BLOCKED — release:data-check exit 1; 235 active unresolved sources and 5,263 legacy FK orphans`. Data release remains blocked independently of software test status.

## 103 clean checkout

Clean-checkout status is `PASS — implementation tree clean before report artifact refresh`. The current local worktree state is reported in section 2 and is not rewritten as clean.

## 104 Linux CI

Linux CI is `NOT RECORDED — no exact-head remote Linux CI run supplied`. Historical Phase 7 Linux success is not exact-head Phase 8 evidence.

## 105 Windows CI

Windows CI is `NOT RECORDED — no exact-head remote Windows CI run supplied`.

## 106 Browser CI

Browser CI is `LOCAL HOSTED-STYLE PASS — 7/7; remote exact-head Browser CI NOT RECORDED`.

## 107 Independent clinical-safety audit

The independent clinical-safety audit is `BOUNDED INTERNAL FINAL AUDIT PASS — six invariant checks; not independent clinical sign-off`. The implementation retains conservative boundaries and this report does not substitute agent self-review for independent sign-off.

## 108 Independent engineering audit

The independent engineering audit is `BOUNDED INTERNAL FINAL AUDIT PASS — release matrix and screenshot-set checks; not independent engineering sign-off`. Static sub-agent reviews identified real negation, specialist-consensus, review-event, and unmeasured-runtime issues; only the fixes recorded in this checkout are claimed.

## 109 Remaining model blockers

Remaining model blockers: RetGuard parity/preprocessing/rights, no fair DR candidate, no external lesion validation, uncalibrated lesion outputs, no clinical validation, and no disease-recovery evidence.

## 110 Remaining engineering blockers

Remaining engineering blockers: incomplete 25-job point, no fairness metric, no post-persistence crash/restart/exactly-once/graceful-shutdown evidence, no resident parity/cancellation, and no exact-head remote CI evidence.

## 111 Remaining data blockers

Remaining data blockers: dataset rights and provenance are not a clinical release authorization; external lesion cohort/annotations/patient separation are unresolved; data release is blocked.

## 112 Remaining clinical blockers

Remaining clinical blockers: no prospective clinical validation, no clinician-adjudicated endpoint, no calibrated autonomous decision, no device validation, no diagnostic or treatment authorization.

## 113 Exact capabilities

Exact capabilities demonstrated: evidence-graph enrichment, deterministic dependency-aware review routing, source/negation preservation, urgency independence, hashed high-grade miss accounting, calibration-rule freeze, scoped review-event audit, bounded local runtime admission, and aggregate Validation Center projection.

## 114 Exact non-capabilities

Exact non-capabilities: no diagnosis, no normal-eye guarantee, no disease recovery, no DR candidate improvement, no external lesion validation, no clinical sensitivity/specificity claim for Phase 8, no autonomous referral/treatment, no guaranteed production throughput, and no complete persistence/restart guarantee.

## 115 Software classification

ENGINEERING PARTIAL — BLOCKERS REMAIN. The local implementation has meaningful controlled-research contracts, but the required full runtime/persistence/browser/CI closure is not all measured at this report snapshot.

## 116 Retinal intelligence classification

RETINAL REVIEW INTELLIGENCE PARTIAL — INTERNAL HELD-OUT EVIDENCE ONLY. Grade-3 and grade-4 escalation coverage is measured from the internal Phase 7 export under a frozen rule; external lesion escalation validation is not established and no DR candidate improvement is claimed.

## 117 Runtime classification

LOCAL RUNTIME PARTIAL. The system has bounded single-slot real-worker evidence, but the 25-job point is incomplete and persistence/graceful/restart/fairness/resident-parity evidence remains incomplete.

## 118 Data classification

DATA RELEASE BLOCKED. Public dataset pages and local research exports do not constitute a release authorization or clinical validation dataset package.

## 119 Demo classification

Research-only/demo boundary retained. Synthetic outputs, research model outputs, source-document candidates, and aggregate evaluation artifacts remain visibly and semantically separate.

## 120 Clinical classification

NOT CLINICALLY VALIDATED / NOT A MEDICAL DEVICE / NOT FOR AUTONOMOUS DIAGNOSIS. This classification is unconditional for the current system and is not weakened by internal held-out coverage or engineering test results.

## Primary questions

Q1. Are the requested grade-3 and grade-4 exact misses represented? **MEASURED** — 65 grade-3 and 20 grade-4.

Q2. Did the frozen lesion rule escalate them? **MEASURED** — grade 3 95.38%; grade 4 95.00%; semantics are review escalation coverage.

Q3. Was external lesion escalation validation established? **NOT ESTABLISHED** — EXTERNAL LESION ESCALATION VALIDATION NOT ESTABLISHED..

Q4. Did a new DR model improve the frozen baseline? **NOT MEASURED** — RetGuard stayed blocked and no second candidate entered paired inference.

Q5. Is retinal evidence fusion deterministic and non-diagnostic? **MEASURED** — engine version and 36 contract names are present; live route evidence remains bounded by the verification records.

Q6. Are shared pixels prevented from becoming independent evidence? **MEASURED** — dependency-group contract collapses same-image DR/lesion inputs; statistical independence is not asserted.

Q7. Is clinician review append-only? **MEASURED** — duplicate event IDs fail closed in the persistence contract; exact final-route/browser evidence is separately reported.

Q8. Why did the 25-job run fail to complete? **MEASURED** — bounded single-slot serialization plus queue/resource wait caused `JOB_DEADLINE_EXCEEDED`.

Q9. Are exactly-once, graceful shutdown, and restart recovery proven? **NOT MEASURED**.

Q10. Is the system clinically validated? **NO** — `NOT CLINICALLY VALIDATED / NOT A MEDICAL DEVICE / NOT FOR AUTONOMOUS DIAGNOSIS`.



## Final directive

Treat this checkout as a controlled local research system. Preserve the frozen baseline and lesion rule. Do not retune on the Phase 7 evaluation partition, do not call escalation disease recovery, do not treat OCT NORMAL or grade 0 as normality, do not merge dependent model outputs as independent evidence, and do not release clinical or autonomous claims until the explicit blockers in sections 109–112 are independently closed.
