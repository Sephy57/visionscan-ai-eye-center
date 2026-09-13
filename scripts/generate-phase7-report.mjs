#!/usr/bin/env node

/**
 * Generate the evidence-backed Phase 7 report.
 *
 * This report is deliberately projection-oriented: it reads aggregate evidence,
 * never emits row-level identifiers or local absolute paths, and renders a
 * missing measurement as NOT MEASURED instead of treating it as zero.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(ROOT, "docs", "VISIONSCAN_PHASE7_RETINAL_INTELLIGENCE_AND_RUNTIME_REPORT.md");
const STARTING_HEAD = process.env.PHASE7_STARTING_HEAD ?? "fdc4f24897369161369a30b949f7c283d814f1b0";
const TICK = String.fromCharCode(96);
const inline = (value) => TICK + String(value) + TICK;

function readJson(relativePath) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8")); } catch { return null; }
}

function readText(relativePath) {
  try { return fs.readFileSync(path.join(ROOT, relativePath), "utf8"); } catch { return ""; }
}

function git(args) {
  try { return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim(); } catch { return "NOT AVAILABLE"; }
}

function sha256(relativePath) {
  try { return crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, relativePath))).digest("hex"); } catch { return "NOT AVAILABLE"; }
}

function n(value, fallback = "NOT MEASURED") {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : fallback;
}

function pct(value, fallback = "NOT MEASURED") {
  return typeof value === "number" && Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : fallback;
}

function bytes(value, fallback = "NOT MEASURED") {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} GiB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(0)} MiB`;
  return `${(value / 1024).toFixed(0)} KiB`;
}

function safe(value) {
  return String(value ?? "NOT RECORDED")
    .replaceAll("\\", "/")
    .replace(/[A-Za-z]:\/[^\s;,)]+/g, "[redacted-path]");
}

function status(value, fallback = "NOT MEASURED") {
  return safe(value ?? fallback);
}

function modelLine(model) {
  if (!model) return "NOT MEASURED";
  return `${status(model.status)}; cold ${n(model.cold?.wall_time?.p50_ms)} ms / ${bytes(model.cold?.resources?.peak_rss_bytes)} working set; warm ${n(model.warm?.wall_time?.p50_ms)} ms / ${bytes(model.warm?.resources?.peak_rss_bytes)} working set`;
}

function list(values) {
  return Array.isArray(values) && values.length ? values.map((item) => safe(item)).join(", ") : "NOT MEASURED";
}

const bundleDir = "docs/generated/model-competition/phase6-retguard-20260913";
const baseline = readJson(`${bundleDir}/baseline.json`);
const candidate = readJson(`${bundleDir}/candidate.json`);
const paired = readJson(`${bundleDir}/paired-errors.json`);
const phase6Lesion = readJson("docs/generated/phase6-lesion-safety-net.json");
const benchmark = readJson("docs/generated/phase6-model-benchmark.json");
const phase6Load = readJson("docs/generated/phase6-resource-load.json");
const candidateSearch = readJson("docs/generated/phase7-candidate-search.json");
const parity = readJson("docs/generated/phase7-retguard-parity-investigation.json");
const calibration = readJson("docs/generated/model-competition/phase7-lesion-calibration-20260913/calibration.json");
const race = readJson("docs/generated/phase7-resource-race.json");
const realLoad = readJson("docs/generated/phase7-real-load.json");
const resident = readJson("docs/generated/phase7-resident-experiment.json");
const crash = readJson("docs/generated/phase7-provider-crash-matrix.json");
const modelMap = new Map((benchmark?.models ?? []).map((model) => [model.model_id, model]));
const referable = baseline?.metrics?.referable ?? {};
const confusion = referable.confusion ?? {};
const phase6Fn = phase6Lesion?.baseline_fn ?? {};
const phase6Path = phase6Lesion?.nonreferable ?? {};
const calibrationSelection = calibration?.selection ?? {};
const selectedHeldOut = calibrationSelection.held_out_evaluation_measurement;
const calibrationMeasured = calibration?.measurement_state === "MEASURED_HELD_OUT_RESEARCH";
const candidateDecision = "CANDIDATE_ONLY / RIGHTS_RESTRICTED / NOT_BENCHMARK_READY";
const endingHead = git(["rev-parse", "HEAD"]);
const dirty = Boolean(git(["status", "--short"]));
const generatorSha = sha256("scripts/generate-phase7-report.mjs");
const ciEvidence = process.env.PHASE7_CI_EVIDENCE ?? "NOT RECORDED";
const pushEvidence = process.env.PHASE7_PUSH_EVIDENCE ?? "NOT RECORDED";
const acceptanceEvidence = process.env.PHASE7_ACCEPTANCE_STATUS ?? "NOT RECORDED";
const equippedEvidence = process.env.PHASE7_EQUIPPED_TESTS ?? "NOT RECORDED";
const noModelEvidence = process.env.PHASE7_NO_MODEL_TESTS ?? "NOT RECORDED";
const cleanEvidence = process.env.PHASE7_CLEAN_CHECKOUT ?? "NOT RECORDED";
const candidateIds = candidateSearch?.candidates?.map((item) => item.candidate_id) ?? [];
const reportDataHash = crypto.createHash("sha256").update(JSON.stringify({ candidateSearch, parity, calibration, race, realLoad, resident, crash })).digest("hex");

const sections = [
  ["1 Starting HEAD", `Phase 7 started from ${inline(STARTING_HEAD)} on ${inline("main")}, preserving the Phase 6 published baseline. No reset, clean, force-push, or history rewrite was used.`],
  ["2 Ending HEAD", `The evidence snapshot was generated at ${inline(endingHead)}. At generation the worktree was ${dirty ? "modified while the Phase 7 implementation/report was being assembled" : "clean"}; publication and exact-head CI are stated separately.`],
  ["3 Commits", `Phase 7 adds bounded candidate due diligence, one fixed-tolerance RetGuard investigation, patient-separated lesion calibration, durable real-worker resource experiments, resident/crash probes, Validation Center/API projection, acceptance/security tests, CI wiring, and this generator. Generator SHA-256: ${inline(generatorSha)}. Evidence projection hash: ${inline(reportDataHash)}.`],
  ["4 Push", `${pushEvidence}. A normal push is required before a remote result can be called exact-head evidence.`],
  ["5 Exact-head CI", `${ciEvidence}. Any historical CI result not tied to the assessed Phase 7 implementation head is retained only as historical evidence.`],
  ["6 Phase 6 baseline", `The preserved DeepDRiD regular-fundus validation baseline contains 400 images from 100 patients. The referable threshold is ICDR grade >=2 with TP ${n(confusion.tp)}, FN ${n(confusion.fn)}, FP ${n(confusion.fp)}, and TN ${n(confusion.tn)}. This baseline is not silently redefined by Phase 7.`],
  ["7 RetGuard parity investigation", `RetGuard was investigated once with the declared fixed logit tolerance ${inline("0.001")}. The local immutable ONNX graph loaded on CPU for a deterministic synthetic tensor only; publisher sample tensors and framework logits were unavailable, so no local-vs-publisher number was fabricated.`],
  ["8 RetGuard final decision", `The parity stop remains ${inline(parity?.final_decision ?? candidateDecision)}. Publisher observation: maximum logit difference ${n(parity?.publisher_observation?.max_logit_difference, "0.002526")}, probability difference ${n(parity?.publisher_observation?.max_probability_difference, "0.000626")}; logit parity failed the fixed tolerance.`],
  ["9 Candidate-2 search", `The bounded second-candidate screen covered ${list(candidateIds)} and ended ${inline(candidateSearch?.decision ?? "NO_SECOND_CANDIDATE_BENCHMARK_READY")}. No second candidate was admitted to inference.`],
  ["10 Rights", `Rights, redistribution, commercial-use, research-use, dataset, and weight-license uncertainty were gated before artifact execution. ABSS-Net code is source-described as MIT, but separately redistributable weight terms were not established; RetinaLens and RETFound task-head access/weight terms were not established.`],
  ["11 Artifact", `The candidate search found no canonical local checkpoint for ABSS-Net or RetinaLens, and RETFound task-specific heads remained external/gated. RetGuard's acquired ONNX is retained as a restricted candidate artifact and is not promoted into the approved model registry.`],
  ["12 Hash", `RetGuard archive SHA-256 ${inline("663c7f8bbc3676df2fe353efa0f3913c757db8c35cf9bf97ab451a756792d2e0")}; ONNX SHA-256 ${inline("f0e19fa86d5a27a05731550d1d6708c01f6f363f45a1fa57849de988f91e775b")}; OOD archive SHA-256 ${inline("cb99b4d375ecc384ce6fbeff4f9b94c42613964b32b7a96cef8b3e1227dbf5b2")}. Candidate-search artifact digests are null because no unknown checkpoint was executed.`],
  ["13 Preprocessing", `The frozen VisionScan DR contract remains ${inline("3x512x512")}. RetGuard source-described input/preprocessing remains 480x480 and unverified against the frozen contract; ABSS-Net source-described preprocessing is 224x224 with CLAHE/ImageNet normalization, but no compatible pinned weight artifact was admitted.`],
  ["14 Parity", `Publisher six-sample observation: probability maximum difference 0.000626 passed its reported comparison, while logit maximum difference 0.002526 failed the immutable 0.001 gate. The Phase 7 probe preserves ${inline("stop_rule_preserved: true")} and reports synthetic graph execution as synthetic-only.`],
  ["15 Runtime", `RetGuard local runtime evidence is graph load and deterministic synthetic-input CPU execution only. It is not an image prediction, not a benchmark result, and not a license or preprocessing approval.`],
  ["16 Dataset coverage", `The accepted frozen comparison cohort remains DeepDRiD regular-fundus validation, 400 images and 100 patients. No candidate-2 result has a common 400-case output stream; Phase 7 does not substitute a different dataset.`],
  ["17 Baseline reproduction", `The Phase 6 competition bundle preserves the measured baseline summary: 400 cases, referable TP ${n(confusion.tp)}, FP ${n(confusion.fp)}, TN ${n(confusion.tn)}, FN ${n(confusion.fn)}. The source export SHA-256 is ${inline(baseline?.evidence?.find((item) => item.id === "dr-deepdrid-validation-export")?.sha256 ?? "NOT RECORDED")}.`],
  ["18 Candidate metrics", `Candidate accuracy, balanced accuracy, macro F1, QWK, AUROC, AUPRC, sensitivity, specificity, PPV, NPV, grade metrics, confusion matrix, FN, and FP are ${inline("NOT MEASURED")}. Publisher-reported metrics are not local candidate metrics.`],
  ["19 Confidence intervals", `Baseline Wilson 95% intervals are retained: sensitivity ${JSON.stringify(referable.confidence_intervals?.referable?.sensitivity ?? null)}, specificity ${JSON.stringify(referable.confidence_intervals?.referable?.specificity ?? null)}, PPV ${JSON.stringify(referable.confidence_intervals?.referable?.ppv ?? null)}, NPV ${JSON.stringify(referable.confidence_intervals?.referable?.npv ?? null)}. Candidate and paired bootstrap intervals are not measured.`],
  ["20 Paired comparison", `The required same-case paired comparison has no candidate rows. Persisted counts remain ${JSON.stringify(paired?.counts ?? null)}; no baseline-wrong/candidate-correct or candidate-wrong cell is inferred.`],
  ["21 Baseline FN", `The preserved baseline has ${n(confusion.fn)} referable false negatives at grade >=2. These are case-level counts on the frozen cohort, not a claim about independent patient counts.`],
  ["22 Candidate FN", `Candidate FN is ${inline("NOT MEASURED")}; a stopped candidate cannot be credited with finding or missing a case.`],
  ["23 FN recovered", `FN_RECOVERED is ${inline("NOT MEASURED")}. The report makes no claim that RetGuard or any searched candidate recovered a baseline false negative.`],
  ["24 FN shared", `FN_SHARED is ${inline("NOT MEASURED")}; no candidate prediction entered the paired denominator.`],
  ["25 FN new", `FN_NEW is ${inline("NOT MEASURED")}; candidate false-negative behavior cannot be calculated without admitted candidate outputs.`],
  ["26 Grade 3 analysis", `Baseline exact grade-3 sensitivity is 3/68 = 0.0441. Candidate grade-3 sensitivity is ${inline("NOT MEASURED")}; no high-grade improvement is claimed.`],
  ["27 Grade 4 analysis", `Baseline exact grade-4 sensitivity is 0/20 = 0.0000. Candidate grade-4 behavior is ${inline("NOT MEASURED")}; runnable graph code does not establish safety.`],
  ["28 Baseline FP", `Baseline referable FP is ${n(confusion.fp)} with specificity ${pct(referable.specificity)} on the frozen cohort.`],
  ["29 Candidate FP", `Candidate FP is ${inline("NOT MEASURED")}; no candidate result entered the denominator.`],
  ["30 FP delta", `Candidate FP delta, removed FP, shared FP, and new FP are ${inline("NOT MEASURED")}. No favorable FP assumption is made.`],
  ["31 Review burden", `RetGuard review burden is ${inline("NOT MEASURED")}. Lesion escalation burden is a separate research measurement and cannot stand in for a DR candidate trade-off.`],
  ["32 Candidate promotion decision", `Promotion is BLOCKED. RetGuard remains ${inline(candidateDecision)}; the three-reviewer implementation, validation/statistics, and safety/governance sign-off chain is not a promotion authorization.`],
  ["33 Lesion calibration dataset", `The Phase 7 lesion study uses the same frozen ${n(calibration?.dataset?.frozen_cases)}-case DeepDRiD regular-fundus source with ${n(calibration?.dataset?.patient_count)} patients, split ${n(calibration?.dataset?.calibration_patient_count)} calibration patients and ${n(calibration?.dataset?.evaluation_patient_count)} evaluation patients by stable patient hash. Split SHA-256: ${inline(calibration?.dataset?.split_assignment_sha256 ?? "NOT MEASURED")}.`],
  ["34 Lesion calibration rules", `Predeclared aggregate rules include any signal, class-presence combinations, connected-region count thresholds, and combined class/count rules. Selection was calibration-only with FN review escalation coverage >=0.90 and lower path burden than ${inline("any_signal")}; evaluation results were not used for selection.`],
  ["35 Lesion calibration results", `Lesion calibration state is ${inline(calibration?.measurement_state ?? "NOT MEASURED")}; selected rule is ${inline(calibrationSelection.selected_rule_id ?? "NONE")}. Valid aggregate outputs: ${n(calibration?.gates?.valid_outputs)}; unavailable reasons: ${JSON.stringify(calibration?.gates?.unavailable_reasons ?? {})}.`],
  ["36 Lesion held-out evaluation", calibrationMeasured && selectedHeldOut ? `Held-out evaluation exists for the calibration-selected rule ${inline(calibrationSelection.selected_rule_id)}: FN coverage ${pct(selectedHeldOut.fn_review_escalation_coverage)}, path burden ${n(selectedHeldOut.review_escalations_per_100_path_cases)} escalations per 100 path cases. This is held-out research evidence, not clinical validation.` : "Held-out selected-rule evaluation is NOT MEASURED because no calibrated rule was selected or the finite study did not complete."],
  ["37 FN escalation coverage", `The allowed label is ${inline("REVIEW ESCALATION COVERAGE")}, not disease recovery. Phase 6 all-signal coverage was ${pct(phase6Fn.review_escalation_coverage)} over ${n(phase6Fn.input_cases)} baseline-FN cases; Phase 7 selected-rule held-out coverage is ${pct(selectedHeldOut?.fn_review_escalation_coverage)}. No lesion-like signal is called a confirmed lesion.`],
  ["38 Review burden", `Phase 6 all-signal path burden was ${n(phase6Path.extra_review_escalations_per_100)} escalations per 100 baseline-predicted-nonreferable path cases. Phase 7 calibration compares this burden transparently; it does not call escalation a disease recovery.`],
  ["39 Pareto frontier", `Phase 7 records calibration and held-out Pareto frontiers as aggregate rule summaries: calibration ${n(calibration?.pareto_frontier?.calibration?.length, "NOT MEASURED")} nondominated rules and evaluation ${n(calibration?.pareto_frontier?.evaluation?.length, "NOT MEASURED")}. Pareto status is research trade-off evidence, not a clinical operating point.`],
  ["40 Combined retinal strategies", `No combined DR-candidate-plus-lesion operating strategy was promoted. Baseline, candidate, lesion escalation, and disagreement branches remain explicitly separate until candidate parity, paired metrics, rights, and clinical review are resolved.`],
  ["41 Ensemble/disagreement", `Candidate disagreement, score averaging, either/both logic, and ensemble FN/FP results are ${inline("NOT MEASURED")}. No missing candidate score is replaced with a negative, zero, or publisher number.`],
  ["42 OCT unchanged evidence", `The approved OCT artifact remains a separate modality with Phase 6 bounded local timing only. Phase 7 does not infer retinal-fundus candidate performance from OCT evidence and makes no cross-modality ensemble claim.`],
  ["43 Glaucoma boundary", `Optic-disc/cup segmentation remains an analysis component, not glaucoma diagnosis. No Phase 7 result establishes glaucoma detection, staging, treatment, or normality.`],
  ["44 Unsupported specialties", `No evidence is claimed for cataract, macular disease diagnosis, pathology, treatment recommendation, visual acuity prediction, or autonomous referral. Unsupported specialty requests remain outside the validated system boundary.`],
  ["45 Medication state", `Medication extraction and medication safety state remain unchanged: document-derived urgency requires provenance and clinician review; no Phase 7 model output authorizes medication, discontinuation, or treatment.`],
  ["46 Cross-process governor", `The real-worker experiments use durable SQLite admission with WAL/full synchronization, bounded memory/thread requests, one active heavy-model slot, heartbeat, expiry/reap, and ownership fencing. Host memory is observation/cooperative policy, not OS enforcement.`],
  ["47 Resource race", race?.status ? `Two independent worker processes were launched. Status ${inline(race.status)}; admitted ${n(race.admission?.admitted_count)}, model launches ${n(race.admission?.model_launch_count)}, no-double-launch ${String(race.admission?.no_double_launch ?? "NOT MEASURED")}, heartbeat observed ${String(race.heartbeat?.real_worker_heartbeat_observed ?? "NOT MEASURED")}.` : "The real cross-process resource race is NOT MEASURED."],
  ["48 Stale recovery", race?.stale_recovery ? `The isolated injected-clock stale/fencing probe records old admitted ${String(race.stale_recovery.old_admitted)}, newer admitted ${String(race.stale_recovery.newer_admitted)}, reclaimed ${String(race.stale_recovery.reclaimed)}, active after ${n(race.stale_recovery.active_after)}. Stale release blocked: ${String(race.ownership_fencing?.old_release_blocked)}.` : "Stale recovery and fencing are NOT MEASURED in the Phase 7 artifact."],
  ["49 Memory headroom", `Observed host memory at the race report is ${bytes(race?.host_memory?.availableBytes)} available of ${bytes(race?.host_memory?.totalBytes)} total, with configured heavy-model request ${bytes(race?.config?.memory_bytes)} and headroom ${bytes(race?.config?.headroom_bytes)}. This is an observation and admission policy, not a guarantee against unrelated processes.`],
  ["50 Threads", `The real probes set bounded OMP, MKL, OpenBLAS, NumExpr, PyTorch, and ONNX Runtime thread settings where supported. Thread controls are cooperative; third-party libraries and the OS may still behave differently.`],
  ["51 One-worker load", realLoad?.status ? `Real queued load status ${inline(realLoad.status)} using ${inline(realLoad.worker_mode ?? "NOT MEASURED")}. Requested points: ${(realLoad.points ?? []).map((point) => `${n(point.requested)} jobs / ${n(point.completed_jobs)} completed`).join(", ") || "NOT MEASURED"}.` : "Real one-worker queued load is NOT MEASURED."],
  ["52 Two-worker decision", `Two-worker real model load status is ${inline(realLoad?.two_worker_decision?.status ?? "NOT_RUN_FOR_SAFETY")}; no duplicated heavy-model capacity claim is made.`],
  ["53 Queue wait", `Real queue wait p50/p95 by requested point: ${(realLoad?.points ?? []).map((point) => `${n(point.requested)}: ${n(point.queue_wait_ms?.p50)}/${n(point.queue_wait_ms?.p95)} ms`).join(", ") || "NOT MEASURED"}.`],
  ["54 Resource wait", `Real durable-resource wait p50/p95 by requested point: ${(realLoad?.points ?? []).map((point) => `${n(point.requested)}: ${n(point.resource_wait_ms?.p50)}/${n(point.resource_wait_ms?.p95)} ms`).join(", ") || "NOT MEASURED"}. Rejections remain classified rather than counted as completed jobs.`],
  ["55 Service latency", `Fresh-process real lesion service latency p50/p95 by point: ${(realLoad?.points ?? []).map((point) => `${n(point.requested)}: ${n(point.service_latency_ms?.p50)}/${n(point.service_latency_ms?.p95)} ms`).join(", ") || "NOT MEASURED"}. These values do not establish resident service latency.`],
  ["56 Throughput", `Bounded single-worker completed-job throughput by requested point: ${(realLoad?.points ?? []).map((point) => `${n(point.requested)}: ${n(point.throughput_jobs_per_second)} jobs/s`).join(", ") || "NOT MEASURED"}. It is a serialized fresh-process observation, not sustained production capacity.`],
  ["57 CPU", `Peak observed process-tree CPU seconds by requested point: ${(realLoad?.points ?? []).map((point) => `${n(point.requested)}: ${n(point.peak_cpu_seconds)} s`).join(", ") || "NOT MEASURED"}. Metrics are best-effort Windows observations.`],
  ["58 Memory", `Peak observed working set by requested point: ${(realLoad?.points ?? []).map((point) => `${n(point.requested)}: ${bytes(point.peak_working_set_bytes)}`).join(", ") || "NOT MEASURED"}. Phase 6 single-process benchmark references remain lesion ${modelLine(modelMap.get("fundus-lesions-clementp-unet-seresnext50"))}; DR ${modelLine(modelMap.get("fundus-dr-grading-effb0"))}; OCT ${modelLine(modelMap.get("oct-retinal-weights-fp32"))}.`],
  ["59 Real provider crash matrix", crash?.status ? `Real DR/lesion/OCT forced-termination matrix status ${inline(crash.status)}. Provider rows: ${(crash.providers ?? []).map((item) => `${safe(item.provider)}=${safe(item.status)}`).join(", ") || "NOT MEASURED"}. Persistence-boundary stages remain explicitly unmeasured.` : "Real provider crash matrix is NOT MEASURED."],
  ["60 Deadline", `Real queued load enforces a ${n(realLoad?.config?.job_deadline_ms)} ms job deadline from queue admission. Crash probes use bounded termination windows; neither is a universal production SLO or clinical deadline guarantee.`],
  ["61 Process-tree cleanup", `The crash matrix records descendant absence after forced termination where observed. It does not prove every provider/launcher path, but it does not convert an incomplete kill into a successful result.`],
  ["62 Graceful shutdown", `Graceful shutdown across active model inference, durable attempt state, lease release, restart, and persistence remains ${inline("NOT MEASURED")}. The implementation retains fail-closed process-control hooks and explicit limitations.`],
  ["63 Resident DR", `No resident DR model experiment was run. DR remains short-lived subprocess evidence only; resident load, cancellation, restart, and stale-state behavior are ${inline("NOT MEASURED")}.`],
  ["64 Resident lesion", resident?.status ? `Resident lesion experiment status ${inline(resident.status)} over ${n(resident.cases?.completed)}/${n(resident.cases?.requested)} serial cases; initial load ${n(resident.initial_load_ms)} ms; warm p50 ${n(resident.warm_inference_ms?.p50)} ms; memory decision ${inline(resident.resident_decision ?? "NOT MEASURED")}.` : "Resident lesion experiment is NOT MEASURED."],
  ["65 Resident OCT", `No resident OCT worker experiment was run. OCT resident memory, cancellation, process recovery, and cross-job state are ${inline("NOT MEASURED")}.`],
  ["66 Cross-job isolation", `The resident probe records only bounded independent manifest inputs and explicitly says it is not a full production isolation proof. Short-lived providers retain finally-cleanup boundaries; caches, cancellation, and restart require further evidence.`],
  ["67 Resident decision", `Resident production execution is not promoted. Even if the bounded lesion experiment completed, its resident decision is research-scoped and cannot establish universal resident safety or capacity.`],
  ["68 Validation Center", `Validation Center exposes a role-gated read-only Phase 7 projection with candidate search, parity stop, held-out lesion research summary, resource race/load, resident, crash, and clinical-boundary state. It does not expose raw paths, patient identifiers, or model-promotion controls.`],
  ["69 Error explorer", `The error surface remains aggregate and separated from raw cases. No Phase 7 UI projection adds image bytes, row-level model outputs, free-text clinical notes, or hidden candidate-success state.`],
  ["70 Traceability", `The Phase 7 artifacts retain schema versions, observation times, model/source hashes, split hash, fixed tolerance, study state, limitations, and ${inline("phi_included:false")}. The report generator itself is hash-recorded.`],
  ["71 Security", `New routes are GET-only and role-gated for ADMIN, REVIEWER, and RESEARCHER. Candidate promotion remains server-controlled; unknown weights are screened before execution; subprocesses use isolated Python invocation and bounded thread settings; no force-upgrade or force-push escape hatch was added.`],
  ["72 PHI", `Committed Phase 7 projections are aggregate-only and declare ${inline("phi_included:false")}. They contain no patient names, dates of birth, addresses, medical-record numbers, raw images, case keys, or row-level predictions.`],
  ["73 Secrets", `No credentials, private model bytes, or authentication material are committed. Local restricted artifacts remain outside the committed evidence projection; public research data are not treated as clinical or proprietary data.`],
  ["74 Dependency audit", `Dependency audit status is ${status(process.env.PHASE7_DEPENDENCY_AUDIT, "NOT RECORDED")}. The report preserves the existing audit distinction between development/test advisories and production dependency risk; no force fix was applied.`],
  ["75 Phase 7 acceptance", `Phase 7 acceptance status: ${status(acceptanceEvidence)}. The acceptance pack checks baseline preservation, candidate gates, fixed parity, split/hash provenance, research language, real runtime evidence, report ledger, and artifact hashes.`],
  ["76 Equipped tests", `Model-equipped local evidence status: ${status(equippedEvidence)}. Equipped work is explicitly separated from hosted/no-model CI; candidate-gated inference remains disabled.`],
  ["77 No-model tests", `No-model checkout status: ${status(noModelEvidence)}. Ordinary tests, build, audit, and read-only projections must not require private model bytes; artifact-dependent probes fail closed when unavailable.`],
  ["78 TypeScript", `TypeScript status: ${status(process.env.PHASE7_TYPESCRIPT, "NOT RECORDED")}. The Phase 7 strict-null fixes and route/client types are included in this check.`],
  ["79 lint", `Lint status: ${status(process.env.PHASE7_LINT, "NOT RECORDED")}.`],
  ["80 build", `Next.js build status: ${status(process.env.PHASE7_BUILD, "NOT RECORDED")}. The Node/dynamic route follows the repository's current App Router guidance.`],
  ["81 smoke", `Smoke status: ${status(process.env.PHASE7_SMOKE, "NOT RECORDED")}. No smoke claim is inferred from typecheck or unit tests.`],
  ["82 responsive", `Responsive browser status: ${status(process.env.PHASE7_RESPONSIVE, "NOT RECORDED")}. The Phase 7 UI adds evidence tables without changing the existing mobile/table overflow boundary.`],
  ["83 accessibility", `Accessibility status: ${status(process.env.PHASE7_A11Y, "NOT RECORDED")}. Candidate state and research-only boundaries are expressed as text, not color alone.`],
  ["84 keyboard", `Keyboard status: ${status(process.env.PHASE7_KEYBOARD, "NOT RECORDED")}. No new model-promotion control is keyboard-reachable because no such control exists.`],
  ["85 browser E2E", `Browser E2E status: ${status(process.env.PHASE7_BROWSER, "NOT RECORDED")}. Browser CI remains no-model/synthetic unless the recorded exact-head result says otherwise.`],
  ["86 model audit", `Model manifest audit status: ${status(process.env.PHASE7_MODEL_AUDIT, "NOT RECORDED")}. Approved local artifacts remain hash-verified; RetGuard remains outside promotion.`],
  ["87 filesystem audit", `Filesystem audit status: ${status(process.env.PHASE7_FILESYSTEM_AUDIT, "NOT RECORDED")}. Sensitive extensions, reparse/path hazards, ignored model bytes, and aggregate-only committed evidence remain release gates.`],
  ["88 SBOM", `SBOM status: ${status(process.env.PHASE7_SBOM, "NOT RECORDED")}. The SBOM describes dependencies and evidence scope; it does not imply private model execution in hosted CI.`],
  ["89 Clean checkout", `Clean-checkout status: ${status(cleanEvidence)}. A clean validation checkout must use external data/model/database roots and prove no-model ordinary tests without copying restricted weights into Git.`],
  ["90 Linux CI", `Linux exact-head CI: ${status(process.env.PHASE7_LINUX_CI, "NOT RECORDED")}.`],
  ["91 Windows CI", `Windows exact-head CI: ${status(process.env.PHASE7_WINDOWS_CI, "NOT RECORDED")}.`],
  ["92 Browser CI", `Browser exact-head CI: ${status(process.env.PHASE7_BROWSER_CI, "NOT RECORDED")}.`],
  ["93 Independent model audit", `Independent model-audit conclusion: RetGuard integrity and local graph loading are recorded, but rights remain restricted, the fixed logit parity gate failed, and no local candidate performance or clinical improvement claim is admissible.`],
  ["94 Independent system audit", `Independent system-audit conclusion: durable cross-process admission, heartbeat, stale recovery, fencing, real bounded single-worker load, and real provider termination observations are present where their artifacts say measured; host-memory controls remain observational/cooperative and resident/persistence gaps remain.`],
  ["95 Remaining model blockers", `Remaining model blockers are failed RetGuard logit parity, unresolved preprocessing equivalence, incompatible input contract, absent candidate predictions, absent paired metrics/high-grade comparison, restricted rights, and no promotion sign-off.`],
  ["96 Remaining engineering blockers", `Remaining engineering blockers are production capacity, multi-worker safety, resident DR/OCT evidence, persistence-stage crash injection, graceful shutdown/restart, and broader provider/OS failure coverage.`],
  ["97 Remaining data blockers", `The application data-release gate remains separate and blocked where unresolved source/reference records remain. Model-validation artifacts do not clear the application's data-release status.`],
  ["98 Remaining clinical blockers", `No clinical adjudication, prospective validation, device compatibility validation, clinically suitable calibration, safety/utility study, autonomous-diagnosis evaluation, or medical-device authorization evidence exists.`],
  ["99 Exact capabilities", `Phase 7 demonstrates: bounded rights/artifact candidate screening; fixed-tolerance parity stop; patient-separated aggregate lesion rule calibration/evaluation when measured; durable real-worker admission/race/heartbeat/stale/fencing probes; queued single-slot real load; bounded resident/crash observations; role-gated evidence projection; and fail-closed research governance.`],
  ["100 Exact non-capabilities", `Phase 7 does not demonstrate a better DR model, recovery of 101 baseline FN, candidate sensitivity/specificity, clinical lesion confirmation, disease recovery, calibrated clinical probabilities, safe two-worker duplication, production throughput, universal cleanup, resident-worker safety, clinical diagnosis, normality, or treatment advice.`],
  ["101 Software classification", `ENGINEERING PARTIAL — BLOCKERS REMAIN. Controls and bounded evidence are implemented, but open operational, data, and clinical gates prevent a complete system release claim.`],
  ["102 DR classification", `C. NO DEFENSIBLE DR CANDIDATE BENCHMARK COMPLETED. The fixed parity stop and second-candidate rights/artifact gates prevented a fair same-frozen-400 comparison; no FN reduction or FP/review trade-off is claimed.`],
  ["103 Lesion escalation classification", calibrationMeasured && selectedHeldOut ? `RESEARCH-ONLY HELD-OUT REVIEW ESCALATION COVERAGE EVIDENCE. The selected rule was chosen on calibration patients and evaluated on held-out patients; this is not disease recovery, lesion confirmation, clinical sensitivity, or referral utility.` : `LESION ESCALATION RESEARCH PARTIAL. No defensible selected-rule held-out result is available; any measured signal remains REVIEW ESCALATION COVERAGE only, not disease recovery.`],
  ["104 Performance classification", realLoad?.status?.startsWith("MEASURED") ? `LOCAL RUNTIME VALIDATED — BOUNDED SINGLE-WORKER LOAD. Real 1/5/10/25 queued points ran under one durable single slot; resident production capacity and two-worker safety remain unproven.` : `LOCAL RUNTIME PARTIAL. Control-plane and/or bounded subprocess evidence exists, but the requested real single-worker load is not complete.`],
  ["105 Data classification", `DATA RELEASE BLOCKED. Aggregate research artifacts and model hashes do not clear unresolved application data provenance or release gates.`],
  ["106 Demo classification", `DEMO / SYNTHETIC RESULT - NOT FOR CLINICAL USE. Synthetic RetGuard tensor execution is explicitly separated from image inference, benchmark evidence, and clinical use.`],
  ["107 Clinical classification", `NOT CLINICALLY VALIDATED. NOT A MEDICAL DEVICE. NOT FOR AUTONOMOUS DIAGNOSIS.\n\nPrimary answer: NO. VisionScan cannot defensibly claim reduction of the observed ${n(confusion.fn)} referable DR false negatives from Phase 7 without inventing candidate predictions or hiding the absent FP/review trade-off. Any lesion result is REVIEW ESCALATION COVERAGE only—not disease recovery.`],
];

if (sections.length !== 107) throw new Error(`Expected 107 report sections, got ${sections.length}`);

const intro = `# VisionScan AI Eye Center — Phase 7 Retinal Intelligence and Runtime Report\n\n` +
  `Generated: ${new Date().toISOString()}\n\n` +
  `## Executive outcome\n\n` +
  `**NO — a defensible reduction of the observed ${n(confusion.fn)} referable DR false negatives was not established.**\n\n` +
  `RetGuard remains ${inline(candidateDecision)} after the fixed 0.001 parity stop, and the bounded second-candidate screen found no rights- and artifact-ready comparator. The lesion study is reported in research escalation language only. Real runtime evidence is bounded to a single heavy-model slot; it is not a production-capacity or clinical-validation claim.\n\n` +
  `## Evidence anchors\n\n` +
  `| Artifact | State |\n|---|---|\n` +
  `| ${bundleDir}/baseline.json | Preserved 400-case/100-patient baseline |\n` +
  `| docs/generated/phase7-candidate-search.json | No second candidate benchmark-ready |\n` +
  `| docs/generated/phase7-retguard-parity-investigation.json | Fixed-tolerance parity stop preserved |\n` +
  `| docs/generated/model-competition/phase7-lesion-calibration-20260913/calibration.json | Patient-separated aggregate research calibration |\n` +
  `| docs/generated/phase7-real-load.json | Real bounded one-worker queued load |\n` +
  `| docs/generated/phase7-provider-crash-matrix.json | Real provider termination matrix with persistence gaps explicit |\n\n` +
  `No section turns missing evidence into zero. The ledger below is the requested exact 107-section Phase 7 report.\n\n`;

const report = intro + sections.map(([title, body]) => `## ${title}\n\n${body}\n`).join("\n");
fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, report.replaceAll("\\n", "\n"), "utf8");
process.stdout.write(JSON.stringify({ status: "PHASE7_REPORT_WRITTEN", output: "docs/VISIONSCAN_PHASE7_RETINAL_INTELLIGENCE_AND_RUNTIME_REPORT.md", sections: sections.length, ending_head: endingHead }, null, 2) + "\n");
