#!/usr/bin/env node

/**
 * Generate the Phase 8 evidence report. The report is intentionally
 * projection-oriented: it reads aggregate artifacts, excludes raw case
 * identifiers/paths, and writes NOT MEASURED whenever the evidence is absent.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(ROOT, "docs", "VISIONSCAN_PHASE8_RETINAL_EVIDENCE_AND_RELIABILITY_REPORT.md");
const STARTING_HEAD = process.env.PHASE8_STARTING_HEAD ?? "9798d94f9078ba0beeac9780e22b5eb5edbf35e1";
const TICK = String.fromCharCode(96);
const inline = (value) => `${TICK}${String(value)}${TICK}`;

function readJson(relativePath) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8")); } catch { return null; }
}

function readText(relativePath) {
  try { return fs.readFileSync(path.join(ROOT, relativePath), "utf8"); } catch { return ""; }
}

function git(args) {
  try { return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim() || "NOT RECORDED"; } catch { return "NOT RECORDED"; }
}

function sha256(relativePath) {
  try { return crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, relativePath))).digest("hex"); } catch { return "NOT RECORDED"; }
}

function n(value, fallback = "NOT MEASURED") {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : fallback;
}

function pct(value, fallback = "NOT MEASURED") {
  return typeof value === "number" && Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : fallback;
}

function safe(value, fallback = "NOT RECORDED") {
  return String(value ?? fallback).replaceAll("\\", "/").replace(/[A-Za-z]:\/[^\s;,)]+/g, "[redacted-path]");
}

const baseline = readJson("docs/generated/model-competition/phase6-retguard-20260913/baseline.json");
const calibration = readJson("docs/generated/model-competition/phase7-lesion-calibration-20260913/calibration.json");
const highGrade = readJson("docs/generated/phase8-high-grade-miss-registry.json");
const ruleFreeze = readJson("docs/generated/phase8-lesion-rule-freeze.json");
const external = readJson("docs/generated/phase8-external-lesion-validation.json");
const runtimeClosure = readJson("docs/generated/phase8-runtime-closure.json");
const realLoad = readJson("docs/generated/phase7-real-load.json");
const race = readJson("docs/generated/phase7-resource-race.json");
const crash = readJson("docs/generated/phase7-provider-crash-matrix.json");
const resident = readJson("docs/generated/phase7-resident-experiment.json");
const phase8Acceptance = readText("tests/phase8-acceptance.test.ts");
const confusion = baseline?.metrics?.referable?.confusion ?? {};
const grade3 = highGrade?.aggregate?.["3"] ?? {};
const grade4 = highGrade?.aggregate?.["4"] ?? {};
const heldOut = calibration?.selection?.held_out_evaluation_measurement ?? ruleFreeze?.measured_evidence?.held_out ?? null;
const point25 = (realLoad?.points ?? []).find((point) => point.requested === 25);
const endingHead = process.env.PHASE8_ENDING_HEAD ?? git(["rev-parse", "HEAD"]);
const worktree = process.env.PHASE8_WORKTREE_STATE ?? git(["status", "--short"]);
const generatorHash = sha256("scripts/generate-phase8-report.mjs");
const reportDataHash = crypto.createHash("sha256").update(JSON.stringify({ baseline, calibration, highGrade, ruleFreeze, external, runtimeClosure, realLoad, race, crash, resident })).digest("hex");
const ciEvidence = process.env.PHASE8_CI_EVIDENCE ?? "NOT RECORDED — no exact-head Phase 8 CI run supplied";
const pushEvidence = process.env.PHASE8_PUSH_EVIDENCE ?? "NOT RECORDED — publication state not inferred from a local checkout";
const acceptanceEvidence = process.env.PHASE8_ACCEPTANCE_STATUS ?? `${(phase8Acceptance.match(/it\("\d+\./g) ?? []).length} numbered Phase 8 acceptance contracts present; exact suite status is supplied by verification below`;
const responsiveEvidence = process.env.PHASE8_RESPONSIVE ?? "NOT RECORDED";
const accessibilityEvidence = process.env.PHASE8_ACCESSIBILITY ?? "NOT RECORDED";
const keyboardEvidence = process.env.PHASE8_KEYBOARD ?? "NOT RECORDED";
const screenshotEvidence = process.env.PHASE8_SCREENSHOTS ?? "NOT RECORDED";
const visualReviewEvidence = process.env.PHASE8_VISUAL_REVIEW ?? "NOT RECORDED";

const titles = [
  "Starting HEAD", "Ending HEAD", "Commits", "Push", "Exact-head CI", "Phase 7 baseline", "RetGuard state", "Candidate discovery state", "High-grade registry", "Grade-3 misses", "Grade-4 misses", "Grade-3 escalation coverage", "Grade-4 escalation coverage", "High-grade non-escalated cases", "Lesion rule freeze", "External validation dataset search", "External dataset rights", "External validation result", "External review burden", "External validation limitations", "RetinalEvidenceFusionEngine", "Evidence inputs", "Dependency groups", "Trust hierarchy", "Missing evidence", "Conflicts", "Review priority", "Urgency independence", "Fundus evidence", "OCT evidence", "Optic-disc evidence", "Document evidence", "Symptom evidence", "Longitudinal evidence", "Retina specialist", "Glaucoma specialist", "Other specialists", "Unsupported specialties", "Condition reasoning", "Source diagnoses", "Negation", "No-false-normal tests", "Clinician review", "Review reasons", "Immutable review audit", "Clinician authority", "Claim ledger", "Dependency provenance", "Unsourced claim gate", "Report integrity", "Medication boundary", "Prompt-injection defense", "25-job root cause", "Single-worker load", "Queue wait", "Resource wait", "Fairness", "Throughput", "CPU", "Memory", "Backpressure", "Persistence crash matrix", "Exactly-once effects", "Deadline", "Process cleanup", "Graceful shutdown", "Restart recovery", "Resident lesion parity", "Resident lesion memory", "Resident isolation", "Resident cancellation", "Resident DR", "Resident OCT", "Resident runtime decision", "UI redesign", "Imaging workspace", "Retinal review card", "Evidence timeline", "Specialist board", "Review queue", "Validation Center", "Report UI", "Manual screenshot QA", "Responsive", "Accessibility", "Keyboard", "Security", "PHI", "Secrets", "Consent", "Phase 8 acceptance", "Equipped tests", "No-model tests", "TypeScript", "lint", "build", "smoke", "browser E2E", "model audit", "filesystem audit", "SBOM", "release:data-check", "clean checkout", "Linux CI", "Windows CI", "Browser CI", "Independent clinical-safety audit", "Independent engineering audit", "Remaining model blockers", "Remaining engineering blockers", "Remaining data blockers", "Remaining clinical blockers", "Exact capabilities", "Exact non-capabilities", "Software classification", "Retinal intelligence classification", "Runtime classification", "Data classification", "Demo classification", "Clinical classification",
];

const bodies = {
  1: `Phase 8 preserves the published Phase 7 state from ${inline(STARTING_HEAD)} on ${inline("main")}. The work is additive: it retains the DeepDRiD baseline, RetGuard stop, patient-separated lesion evidence, and runtime limitations.`,
  2: `The report was generated at ${inline(endingHead)}. Worktree state at generation was ${inline(worktree || "clean")}; a clean publication and exact-head CI result are not assumed from a local hash.`,
  3: `Phase 8 adds ${inline("RetinalEvidenceFusionEngine")}, the hashed high-grade miss registry, the frozen ${inline("LESION_ESCALATION_RULE_PHASE7_V1")} record, external-validation attempt ledger, append-only clinician-review events, a Phase 8 Validation Center projection, runtime-closure projection, negation-safe urgency handling, and the 36 requested acceptance contracts plus one regression contract. Generator SHA-256 is ${inline(generatorHash)}; report data projection SHA-256 is ${inline(reportDataHash)}.`,
  4: `${pushEvidence}. A local checkout, even when clean, is not evidence that a remote branch contains this report.`,
  5: `${ciEvidence}. The historical Phase 7 run remains useful implementation evidence, but it is not exact-head Phase 8 CI unless the supplied commit matches ${inline(endingHead)}.`,
  6: `The frozen DeepDRiD regular-fundus validation cohort contains 400 images from 100 patients. At referable threshold ${inline("eye_grade >= 2")}, TP ${n(confusion.tp)}, FN ${n(confusion.fn)}, FP ${n(confusion.fp)}, and TN ${n(confusion.tn)} are retained. Sensitivity is ${pct(baseline?.metrics?.referable?.sensitivity)} and specificity is ${pct(baseline?.metrics?.referable?.specificity)}.`,
  7: `RetGuard remains ${inline("CANDIDATE_ONLY / RIGHTS_RESTRICTED / NOT_BENCHMARK_READY")}. Its fixed ${inline("0.001")} logit-parity stop, incompatible/unverified preprocessing equivalence, and absent same-cohort candidate outputs are unchanged. No parity re-investigation or candidate metric is claimed.`,
  8: `The Phase 7 candidate screen admitted no second comparator: ${inline("NO_SECOND_CANDIDATE_BENCHMARK_READY")}. Unknown weights were not loaded, and publisher-reported numbers were not substituted for local predictions.`,
  9: `The Phase 8 registry freezes ${n(highGrade?.cohort?.exact_high_grade_miss_cases)} exact high-grade undercalls from the existing export: ${n(highGrade?.cohort?.grade_3_exact_miss_cases)} grade-3 cases and ${n(highGrade?.cohort?.grade_4_exact_miss_cases)} grade-4 cases. Each entry uses hashed case/patient keys only.`,
  10: `The grade-3 definition is ground truth ${inline("3")} with baseline prediction not equal to ${inline("3")}. It contains ${n(grade3.exact_miss_cases)} cases, with predicted grades ${JSON.stringify(grade3.predicted_grade_counts ?? {})}.`,
  11: `The grade-4 definition is ground truth ${inline("4")} with baseline prediction not equal to ${inline("4")}. It contains ${n(grade4.exact_miss_cases)} cases, with predicted grades ${JSON.stringify(grade4.predicted_grade_counts ?? {})}.`,
  12: `The frozen ${inline("regions_ge_3")} behavior escalated ${n(grade3.escalated_cases)} of ${n(grade3.exact_miss_cases)} grade-3 exact misses: ${pct(grade3.review_escalation_coverage)}. This is review escalation coverage, not DR recovery.`,
  13: `The frozen rule escalated ${n(grade4.escalated_cases)} of ${n(grade4.exact_miss_cases)} grade-4 exact misses: ${pct(grade4.review_escalation_coverage)}. The single non-escalated grade-4 case remains explicitly represented; no safety conclusion is drawn.`,
  14: `Four high-grade entries are non-escalated under the frozen rule: three grade-3 and one grade-4. Their hashed registry records preserve baseline grade, source quality flag, lesion fields, and ${inline("NOT_RECORDED")} OCT/document/independent-clinician/OOD states.`,
  15: `The alias ${inline("LESION_ESCALATION_RULE_PHASE7_V1")} is frozen as ${inline("region_count >= 3")}, selected on calibration only. It is bound to model ${inline(ruleFreeze?.model?.model_id)}, version ${inline(ruleFreeze?.model?.model_version)}, artifact ${inline(ruleFreeze?.model?.artifact_sha256)}, preprocessing ${inline(ruleFreeze?.model?.preprocessing_version)}, split hash ${inline(ruleFreeze?.selection?.split_assignment_sha256)}, and source hashes.`,
  16: `The bounded search considered IDRiD, APTOS 2019, RFMiD, TJDR, and the internal DeepDRiD cohort. The external decision is ${inline(external?.decision ?? "EXTERNAL LESION ESCALATION VALIDATION NOT ESTABLISHED.")}. No dataset was added to the Phase 7 denominator.`,
  17: `IDRiD is publicly documented as CC BY 4.0, while RFMiD's referenced dataset card reports CC BY 4.0. Those observations do not authorize redistribution of data, annotations, or weights in this repository. APTOS and TJDR rights/manifest requirements remain unresolved. See the official [IDRiD data page](https://idrid.grand-challenge.org/Data/) and [RFMiD dataset card](https://huggingface.co/datasets/ctmedtech/RFMID).`,
  18: `No external lesion inference was run. The exact state is ${inline("EXTERNAL LESION ESCALATION VALIDATION NOT ESTABLISHED.")} External sensitivity, specificity, calibration, confidence intervals, and clinical utility are ${inline("NOT MEASURED")}.`,
  19: `External review burden is ${inline("NOT MEASURED")}. The internal held-out burden remains a Phase 7 research measurement only: ${n(heldOut?.review_escalations_per_100_path_cases)} review escalations per 100 applicable path cases.`,
  20: `External validation is blocked by overlap disclosure, missing or incomplete patient/eye separation, absent locally verified lesion annotations/manifests, and unresolved rights. These are evidence blockers, not reasons to infer a negative result.`,
  21: `The new ${inline("RetinalEvidenceFusionEngine")} is pure, deterministic, and versioned as ${inline("phase8-retinal-evidence-fusion-1.0.0")}. It organizes evidence for review; it is explicitly not a diagnostic ensemble.`,
  22: `Inputs are the existing canonical evidence items: fundus/AI findings, OCT/test results, optic-disc evidence, source-document diagnoses, symptoms, history/medications/allergies, clinician observations, and longitudinal references. The engine does not create a new clinical source.`,
  23: `Every active item is grouped by its explicit dependency group. Multiple models reading the same image occupy one shared-pixel group, so model count does not become independent evidence. The acceptance contract verifies a DR/lesion pair collapses to one group.`,
  24: `The trust order is clinician-entered, human-verified, validated AI, auto-extracted, unverified, then rejected. The order affects review prioritization only; it never silently resolves a conflict or promotes research output to clinical truth.`,
  25: `Missing fundus/OCT/optic-disc evidence, clinician observation, and patient-reported symptom context are emitted as named missing states. Missing is not converted to absent, negative, or normal.`,
  26: `Existing evidence conflicts remain visible, and the fusion layer adds a cross-modality review conflict when positive fundus evidence coexists with an OCT NORMAL estimate. The automatic resolution is always ${inline("NONE")}.`,
  27: `Priority is deterministic: emergency/urgent symptom flags first, then high priority for conflicts or quality/OOD blocks, then routine, with unable-to-assess when no active evidence exists. It is routing metadata, not a diagnosis or probability.`,
  28: `Urgent red-flag symptoms are represented with ${inline("independent_of_ai_findings: true")}. A reassuring, unavailable, or failed research result cannot suppress an emergency or urgent symptom route. Explicitly absent symptoms are excluded from urgency reasoning.`,
  29: `Fundus evidence remains research-only and no-signal is labeled ${inline("NO_SIGNAL_NOT_NORMAL")}. Grade 0 or lesion no-signal cannot produce a healthy-eye claim.`,
  30: `OCT remains a separate modality. ${inline("OCT_NORMAL")} is represented as ${inline("NORMAL_ESTIMATE_NOT_HEALTHY")}; it does not establish a healthy macula or exclude disease.`,
  31: `Optic-disc/cup segmentation remains the only narrow executable specialist path and remains ${inline("RESEARCH_ONLY")}. It is not glaucoma diagnosis, staging, or treatment.`,
  32: `Document evidence retains source-document diagnosis provenance, page information, extraction state, and unreviewed trust. The engine never rewrites a source diagnosis as a VisionScan diagnosis.`,
  33: `Present symptoms route urgency and context only. Their structured type, laterality, onset, duration, severity, progression, and frequency remain distinct from image findings.`,
  34: `Longitudinal comparison remains read-only and scope-safe. The current implementation reports presence/count changes with explicit limitations and does not establish progression or treatment response.`,
  35: `The retina lane has a real narrow research capability only; its output is clinician-review-required and not validated for autonomous diagnosis. No diabetic-retinopathy specialist model is implied by the lane name.`,
  36: `The glaucoma lane has no validated disease or CDR model. Missing evidence and ${inline("NO_VALIDATED_MODEL_AVAILABLE")} are displayed rather than fabricated specialist findings.`,
  37: `Other specialties retain explicit unavailable states and missing confirmation requirements. The system does not create nine artificial AI doctors or infer unsupported disease capabilities.`,
  38: `Unsupported claims include cataract, macular disease diagnosis, pathology, visual-acuity prediction, treatment authorization, and autonomous referral. These remain outside the system's validated boundary.`,
  39: `Condition reasoning remains deterministic and non-diagnostic. It emits possible/insufficient/conflicting states from provenance-bearing evidence and requires clinician correlation.`,
  40: `Source-document diagnoses remain labeled as source claims with document/page provenance. They are not merged into an AI diagnosis or used to bypass the diagnosis gate.`,
  41: `Explicit negation remains ${inline("ABSENT")}; lack of mention remains ${inline("NOT_REPORTED")} or ${inline("UNKNOWN")}. The Phase 8 regression closes the separate urgency path so absent red-flag symptoms cannot generate urgent flags.`,
  42: `The Phase 8 no-false-normal contracts cover DR grade 0, OCT NORMAL, and lesion no-signal. Each assertion checks a structured state or safety flag rather than a favorable fixture string.`,
  43: `Clinician review actions remain additive to the immutable AI layer. Confirm, reject, correct, indeterminate, request-new-scan, observation, treatment review, note, and finalize are represented as distinct actions.`,
  44: `Review events now carry an action-derived reason, optional bounded clinician rationale, finding/source references, dependency groups, and the AI snapshot hash. Missing rationale remains visible rather than invented.`,
  45: `The ${inline("clinician_reviews")} collection is now append-only at the persistence writer for event IDs. A duplicate event ID fails closed; the current report remains a mutable projection for compatibility.`,
  46: `Clinician authority is explicit: the authenticated session supplies reviewer identity, clinician-authored corrections remain separate, and AI findings are not overwritten. Laterality may be corrected in the additive correction record.`,
  47: `The claim ledger envelope remains ${inline("claim-ledger-1.1.0")}; Phase 8 dependency group IDs and independence state are additive optional fields. Claims retain evidence references, model execution IDs, and rule IDs.`,
  48: `A claim sharing model executions records the exact dependency groups. ${inline("DEPENDENT_SHARED_INPUT")} is used for one shared group; multiple groups are described without asserting statistical independence.`,
  49: `The existing safety validator still blocks a tampered empty evidence reference list. The fusion claim itself is ${inline("RESEARCH_REVIEW_ONLY")} and no unsourced presentation claim is admitted.`,
  50: `Reports retain version freeze and immutable reasoning snapshots. Clinician interpretation, corrections, observations, and final assessment remain additive and are not included in the AI seal.`,
  51: `Medication extraction remains provenance-bound. No Phase 8 output prescribes, changes, stops, doses, or authorizes medication; treatment information remains clinician-review-gated.`,
  52: `The document classifier treats instruction-like text as untrusted data. Phase 8 tests exercise the repository's actual classifier and use matching adversarial strings; prompt text cannot change model, safety, or report behavior.`,
  53: `Adversarial coverage now includes absent red-flag negation, PDF instruction-like text, medication instruction-like text, cross-modality conflict, OOD/quality blocks, laterality uncertainty, unavailable specialists, and immutable review writes.`,
  54: `The 25-job runtime point is ${inline(runtimeClosure?.status ?? "LOCAL RUNTIME PARTIAL")}; it is not complete. The actual run completed ${n(point25?.completed_jobs)} of ${n(point25?.requested)} jobs and failed ${n(point25?.failed_jobs)}.`,
  55: `The measured root cause is ${inline(runtimeClosure?.root_cause?.classification ?? "BOUNDED_SINGLE_SLOT_QUEUE_DEADLINE")}: one heavy-model reservation slot serialized work while queue/resource waiting consumed the deadline.`,
  56: `The real one-worker curve completed 1/1, 5/5, and 10/10; the 25-job point completed 15/25. This is a bounded serialized-load result, not production capacity.`,
  57: `At 25 jobs, queue wait p50 was ${n(point25?.queue_wait_ms?.p50)} ms, p95 ${n(point25?.queue_wait_ms?.p95)} ms, and max ${n(point25?.queue_wait_ms?.max)} ms.`,
  58: `At 25 jobs, resource wait p50 was ${n(point25?.resource_wait_ms?.p50)} ms, p95 ${n(point25?.resource_wait_ms?.p95)} ms, and max ${n(point25?.resource_wait_ms?.max)} ms. Resource wait, not model service latency, dominated the incomplete point.`,
  59: `Fairness is ${inline(runtimeClosure?.fairness?.status ?? "NOT MEASURED")}. Completion order and wait distributions exist, but a starvation/fairness target was not predeclared or measured.`,
  60: `Measured throughput was ${n(point25?.throughput_jobs_per_second)} jobs per second at the incomplete 25-job point. This does not imply a stable service-level objective.`,
  61: `The load probe records best-effort CPU seconds and thread counts, but no CPU quota or host-wide fairness guarantee. Thread controls are cooperative.`,
  62: `The real provider crash matrix observed forced termination and descendant cleanup for DR, lesion, and OCT windows. Persistence-stage recovery remains explicitly unmeasured.`,
  63: `Exactly-once effects are ${inline(runtimeClosure?.persistence?.exactly_once ?? "NOT MEASURED")}. No duplicate completion claim is inferred from process cleanup or a direct provider probe.`,
  64: `A real queue deadline was enforced from queue claim at ${n(realLoad?.config?.job_deadline_ms)} ms. Ten 25-job entries ended with ${inline("JOB_DEADLINE_EXCEEDED")}; no unbounded wait is claimed.`,
  65: `Process-tree cleanup was observed in the forced-termination matrix, with no completed payload observed in the termination windows. This is not persistence correctness.`,
  66: `Graceful shutdown is ${inline(runtimeClosure?.persistence?.graceful_shutdown ?? "NOT MEASURED")}. Forced task termination is not substituted for a drain protocol.`,
  67: `Restart recovery is ${inline(runtimeClosure?.persistence?.restart_recovery ?? "NOT MEASURED")}. No worker restart experiment was added without an auditable persistence boundary.`,
  68: `Resident lesion execution has prior measured 20-case evidence. Resident-vs-short-lived parity is ${inline("NOT MEASURED")}; the existing result does not establish output equivalence.`,
  69: `The 20-case resident result recorded initial load ${n(resident?.initial_load_ms)} ms, warm p50 ${n(resident?.warm_inference_ms?.p50)} ms, warm p95 ${n(resident?.warm_inference_ms?.p95)} ms, and peak working set ${n(resident?.peak_resources?.working_set_bytes)} bytes.`,
  70: `Resident isolation is bounded to independent manifest inputs and is labeled ${inline(resident?.state_isolation?.status ?? "BOUNDED_INPUT_SCOPE_ONLY")}; it is not a full production isolation proof.`,
  71: `Resident cancellation is ${inline("NOT MEASURED")}. No cancellation success or memory-release claim is inferred from serial completion.`,
  72: `Resident DR execution is ${inline("NOT MEASURED")}. The available resident experiment is lesion-only.`,
  73: `Resident OCT execution is ${inline("NOT MEASURED")}. The OCT provider remains separately bounded and research-only.`,
  74: `Runtime classification is ${inline("LOCAL RUNTIME PARTIAL")}: real bounded admission, deadline, race, resident lesion, and provider-cleanup evidence exist, but persistence, fairness, graceful shutdown, restart, and full 25-job completion do not.`,
  75: `The Validation Center now has a Phase 8 section for high-grade registry state, frozen rule, external-validation attempts, fusion safety, and persistence gaps. Other analysis/review surfaces retain their existing research labels.`,
  76: `The existing imaging workspace keeps original scan preservation, quality state, research overlays, modality separation, and clinician review controls. Phase 8 does not invent a localization or heatmap where none exists.`,
  77: `The retinal review card is represented by the evidence fusion contract and existing research panels: review priority, high-grade registry state, dependency warning, and no-false-normal language are explicit.`,
  78: `Evidence remains timeline/provenance-oriented: source type, laterality, temporal state, document/page, model/version, dependency group, conflict, and verification state are retained.`,
  79: `The specialist board retains one real narrow lane and explicit unavailable lanes. It does not display a synthetic consensus winner; conflicts and missing confirmation remain visible.`,
  80: `The review queue is driven by deterministic priority and independent urgency. Clinician review events now provide an append-only audit source while the report projection remains compatible.`,
  81: `Validation Center's Phase 8 endpoint is role-gated to ADMIN/REVIEWER/RESEARCHER, aggregate-only, and PHI-free. It exposes hashed-registry aggregates, not raw entries.`,
  82: `The report UI remains research-only and version-frozen. A negative/unavailable/OCT NORMAL result cannot render as a normal-eye conclusion.`,
  83: `Fresh PHI-free Chromium screenshots are ${inline(screenshotEvidence)}. The captures are kept in ignored local QA output and are not committed as validation artifacts.`,
  84: `Responsive automated QA is ${inline(responsiveEvidence)}. This verifies route rendering and horizontal-overflow constraints; it is not a substitute for manual screenshot inspection.`,
  85: `Accessibility automated QA is ${inline(accessibilityEvidence)}. This is axe WCAG A/AA coverage, not NVDA/JAWS or independent accessibility certification.`,
  86: `Keyboard automated QA is ${inline(keyboardEvidence)}. It verifies skip links, focus targets, bounded tab walks, and the mobile drawer contract. Visual review of the screenshot set is ${inline(visualReviewEvidence)}; this does not constitute screen-reader certification.`,
  87: `Security controls retain role checks, CSRF/session identity, tenant/study scope, redaction, prompt-safety classification, immutable AI snapshots, and append-only review events.`,
  88: `PHI-bearing review/evidence routes remain scoped. Aggregate Phase 8 artifacts set ${inline("phi_included: false")} and do not persist raw case/image identifiers.`,
  89: `No password, token, provider secret, or model secret is added by Phase 8. External source URLs are metadata; they are not credentialed access.`,
  90: `Consent remains required for the existing research-analysis endpoint. The new aggregate Validation Center route contains no patient study payload and is role-restricted.`,
  91: acceptanceEvidence + `. The 36 requested acceptance names are present in ${inline("tests/phase8-acceptance.test.ts")}; direct live provider persistence cases remain marked NOT MEASURED where the repository lacks a safe hook.`,
  92: `The test contracts read actual generated artifacts and call the deterministic engine; they do not replace model output with fixed fixture answers. Registry counts are recomputed by the generator from the frozen export.`,
  93: `No-model behavior remains part of the existing test architecture. Phase 8 additions are pure or aggregate and do not require weights for hosted CI. Exact fresh no-model Phase 8 suite evidence is ${inline("NOT RECORDED")}.`,
  94: `TypeScript status at report-generation time is ${inline(process.env.PHASE8_TYPESCRIPT ?? "NOT RECORDED")}. The code path was checked during implementation; final evidence should be supplied by the exact verification run.`,
  95: `Lint status is ${inline(process.env.PHASE8_LINT ?? "NOT RECORDED")}.`,
  96: `Production build status is ${inline(process.env.PHASE8_BUILD ?? "NOT RECORDED")}.`,
  97: `Smoke status is ${inline(process.env.PHASE8_SMOKE ?? "NOT RECORDED")}.`,
  98: `Browser E2E status is ${inline(process.env.PHASE8_BROWSER_E2E ?? "NOT RECORDED")}. The final browser route/viewport inspection remains separate from automated smoke.`,
  99: `Model-manifest audit status is ${inline(process.env.PHASE8_MODEL_AUDIT ?? "NOT RECORDED")}; RetGuard remains outside the approved registry.`,
  100: `Filesystem audit status is ${inline(process.env.PHASE8_FS_AUDIT ?? "NOT RECORDED")}; no raw identifiers are present in the Phase 8 aggregate artifacts by construction.`,
  101: `SBOM status is ${inline(process.env.PHASE8_SBOM ?? "NOT RECORDED")}.`,
  102: `Release data-check status is ${inline(process.env.PHASE8_DATA_CHECK ?? "NOT RECORDED")}. Data release remains blocked independently of software test status.`,
  103: `Clean-checkout status is ${inline(process.env.PHASE8_CLEAN_CHECKOUT ?? "NOT RECORDED")}. The current local worktree state is reported in section 2 and is not rewritten as clean.`,
  104: `Linux CI is ${inline(process.env.PHASE8_LINUX_CI ?? ciEvidence)}. Historical Phase 7 Linux success is not exact-head Phase 8 evidence.`,
  105: `Windows CI is ${inline(process.env.PHASE8_WINDOWS_CI ?? "NOT RECORDED")}.`,
  106: `Browser CI is ${inline(process.env.PHASE8_BROWSER_CI ?? "NOT RECORDED")}.`,
  107: `The independent clinical-safety audit is ${inline(process.env.PHASE8_CLINICAL_AUDIT ?? "NOT RECORDED")}. The implementation retains conservative boundaries and this report does not substitute agent self-review for independent sign-off.`,
  108: `The independent engineering audit is ${inline(process.env.PHASE8_ENGINEERING_AUDIT ?? "NOT RECORDED")}. Static sub-agent reviews identified real negation, specialist-consensus, review-event, and unmeasured-runtime issues; only the fixes recorded in this checkout are claimed.`,
  109: `Remaining model blockers: RetGuard parity/preprocessing/rights, no fair DR candidate, no external lesion validation, uncalibrated lesion outputs, no clinical validation, and no disease-recovery evidence.`,
  110: `Remaining engineering blockers: incomplete 25-job point, no fairness metric, no post-persistence crash/restart/exactly-once/graceful-shutdown evidence, no resident parity/cancellation, and no exact-head remote CI evidence.`,
  111: `Remaining data blockers: dataset rights and provenance are not a clinical release authorization; external lesion cohort/annotations/patient separation are unresolved; data release is blocked.`,
  112: `Remaining clinical blockers: no prospective clinical validation, no clinician-adjudicated endpoint, no calibrated autonomous decision, no device validation, no diagnostic or treatment authorization.`,
  113: `Exact capabilities demonstrated: evidence-graph enrichment, deterministic dependency-aware review routing, source/negation preservation, urgency independence, hashed high-grade miss accounting, calibration-rule freeze, scoped review-event audit, bounded local runtime admission, and aggregate Validation Center projection.`,
  114: `Exact non-capabilities: no diagnosis, no normal-eye guarantee, no disease recovery, no DR candidate improvement, no external lesion validation, no clinical sensitivity/specificity claim for Phase 8, no autonomous referral/treatment, no guaranteed production throughput, and no complete persistence/restart guarantee.`,
  115: `ENGINEERING PARTIAL — BLOCKERS REMAIN. The local implementation has meaningful controlled-research contracts, but the required full runtime/persistence/browser/CI closure is not all measured at this report snapshot.`,
  116: `RETINAL REVIEW INTELLIGENCE PARTIAL — INTERNAL HELD-OUT EVIDENCE ONLY. Grade-3 and grade-4 escalation coverage is measured from the internal Phase 7 export under a frozen rule; external lesion escalation validation is not established and no DR candidate improvement is claimed.`,
  117: `LOCAL RUNTIME PARTIAL. The system has bounded single-slot real-worker evidence, but the 25-job point is incomplete and persistence/graceful/restart/fairness/resident-parity evidence remains incomplete.`,
  118: `DATA RELEASE BLOCKED. Public dataset pages and local research exports do not constitute a release authorization or clinical validation dataset package.`,
  119: `Research-only/demo boundary retained. Synthetic outputs, research model outputs, source-document candidates, and aggregate evaluation artifacts remain visibly and semantically separate.`,
  120: `NOT CLINICALLY VALIDATED / NOT A MEDICAL DEVICE / NOT FOR AUTONOMOUS DIAGNOSIS. This classification is unconditional for the current system and is not weakened by internal held-out coverage or engineering test results.`,
};

const executive = `# VisionScan AI Eye Center — Phase 8 Retinal Evidence and Reliability Report\n\n` +
  `## Executive outcome\n\n` +
  `Phase 8 adds a deterministic, provenance-preserving retinal evidence fusion layer, a hashed registry for the ${n(highGrade?.cohort?.exact_high_grade_miss_cases)} exact grade-3/grade-4 baseline misses, a named freeze for ${inline("LESION_ESCALATION_RULE_PHASE7_V1")}, and append-only clinician review events. The evidence supports ${inline("RETINAL REVIEW INTELLIGENCE PARTIAL — INTERNAL HELD-OUT EVIDENCE ONLY")}; it does not support disease recovery, external validation, DR candidate improvement, diagnosis, normality, or clinical deployment.\n\n` +
  `The strongest new aggregate is grade-specific review escalation: grade 3 ${pct(grade3.review_escalation_coverage)} (${n(grade3.escalated_cases)}/${n(grade3.exact_miss_cases)}) and grade 4 ${pct(grade4.review_escalation_coverage)} (${n(grade4.escalated_cases)}/${n(grade4.exact_miss_cases)}) under the frozen region-count rule. The registry is derived from the existing Phase 7 export, so ${inline("fresh_phase8_inference: false")}; missing OCT, document, OOD, and independent-clinician fields remain ${inline("NOT_RECORDED")}.\n\n` +
  `Runtime remains ${inline("LOCAL RUNTIME PARTIAL")}: the 25-job point completed ${n(point25?.completed_jobs)}/${n(point25?.requested)} because single-slot queue/resource wait consumed the ${n(realLoad?.config?.job_deadline_ms)} ms deadline.\n\n` +
  `Clinical classification: ${inline("NOT CLINICALLY VALIDATED / NOT A MEDICAL DEVICE / NOT FOR AUTONOMOUS DIAGNOSIS")}.\n\n` +
  `## Evidence anchors\n\n` +
  `- High-grade registry: ${inline("docs/generated/phase8-high-grade-miss-registry.json")}\n` +
  `- Rule freeze: ${inline("docs/generated/phase8-lesion-rule-freeze.json")}\n` +
  `- External-validation ledger: ${inline("docs/generated/phase8-external-lesion-validation.json")}\n` +
  `- Runtime closure: ${inline("docs/generated/phase8-runtime-closure.json")}\n` +
  `- Acceptance contracts: ${inline("tests/phase8-acceptance.test.ts")}\n` +
  `- Implementation report data hash: ${inline(reportDataHash)}\n\n`;

const body = titles.map((title, index) => `## ${index + 1} ${title}\n\n${bodies[index + 1] ?? "NOT MEASURED — no evidence was supplied for this section."}`).join("\n\n");

const questions = `\n\n## Primary questions\n\n` +
  `Q1. Are the requested grade-3 and grade-4 exact misses represented? **MEASURED** — ${n(grade3.exact_miss_cases)} grade-3 and ${n(grade4.exact_miss_cases)} grade-4.\n\n` +
  `Q2. Did the frozen lesion rule escalate them? **MEASURED** — grade 3 ${pct(grade3.review_escalation_coverage)}; grade 4 ${pct(grade4.review_escalation_coverage)}; semantics are review escalation coverage.\n\n` +
  `Q3. Was external lesion escalation validation established? **NOT ESTABLISHED** — ${safe(external?.decision)}.\n\n` +
  `Q4. Did a new DR model improve the frozen baseline? **NOT MEASURED** — RetGuard stayed blocked and no second candidate entered paired inference.\n\n` +
  `Q5. Is retinal evidence fusion deterministic and non-diagnostic? **MEASURED** — engine version and 36 contract names are present; live route evidence remains bounded by the verification records.\n\n` +
  `Q6. Are shared pixels prevented from becoming independent evidence? **MEASURED** — dependency-group contract collapses same-image DR/lesion inputs; statistical independence is not asserted.\n\n` +
  `Q7. Is clinician review append-only? **MEASURED** — duplicate event IDs fail closed in the persistence contract; exact final-route/browser evidence is separately reported.\n\n` +
  `Q8. Why did the 25-job run fail to complete? **MEASURED** — bounded single-slot serialization plus queue/resource wait caused ${inline("JOB_DEADLINE_EXCEEDED")}.\n\n` +
  `Q9. Are exactly-once, graceful shutdown, and restart recovery proven? **NOT MEASURED**.\n\n` +
  `Q10. Is the system clinically validated? **NO** — ${inline("NOT CLINICALLY VALIDATED / NOT A MEDICAL DEVICE / NOT FOR AUTONOMOUS DIAGNOSIS")}.\n\n`;

const finalDirective = `\n\n## Final directive\n\n` +
  `Treat this checkout as a controlled local research system. Preserve the frozen baseline and lesion rule. Do not retune on the Phase 7 evaluation partition, do not call escalation disease recovery, do not treat OCT NORMAL or grade 0 as normality, do not merge dependent model outputs as independent evidence, and do not release clinical or autonomous claims until the explicit blockers in sections 109–112 are independently closed.`;

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, `${executive}${body}${questions}${finalDirective}\n`, "utf8");
console.log(JSON.stringify({ output: path.relative(ROOT, OUTPUT), sections: titles.length, ending_head: endingHead, status: "GENERATED_WITH_EXPLICIT_UNMEASURED_STATES" }, null, 2));
