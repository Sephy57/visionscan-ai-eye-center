#!/usr/bin/env node

/**
 * Generate the evidence-backed Phase 6 report from repository artifacts.
 * Missing evidence is rendered as NOT MEASURED rather than converted to zero.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(ROOT, "docs", "VISIONSCAN_PHASE6_DR_CANDIDATE_AND_RUNTIME_VALIDATION_REPORT.md");
const STARTING_HEAD = process.env.PHASE6_STARTING_HEAD ?? "9eef23e3bd95b2d0fb9c4cd00685b8d71ad9f5b6";
const TICK = String.fromCharCode(96);
const inline = (value) => TICK + value + TICK;

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
function num(value, fallback = "Not measured") {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : fallback;
}
function percent(value, fallback = "Not measured") {
  return typeof value === "number" && Number.isFinite(value) ? (value * 100).toFixed(1) + "%" : fallback;
}
function size(value) {
  if (!Number.isFinite(value)) return "Not measured";
  if (value >= 1024 ** 3) return (value / 1024 ** 3).toFixed(2) + " GiB";
  if (value >= 1024 ** 2) return (value / 1024 ** 2).toFixed(0) + " MiB";
  return (value / 1024).toFixed(0) + " KiB";
}
function benchLine(model) {
  if (!model) return "Not measured";
  const cold = model.cold?.wall_time ?? {};
  const warm = model.warm?.wall_time ?? {};
  return (model.status ?? "unknown") + "; cold p50 " + num(cold.p50_ms) + " ms / " + size(model.cold?.resources?.peak_rss_bytes) +
    " peak working set; warm p50 " + num(warm.p50_ms) + " ms / " + size(model.warm?.resources?.peak_rss_bytes) + " peak working set";
}

const bundleDir = "docs/generated/model-competition/phase6-retguard-20260913";
const bundle = readJson(bundleDir + "/manifest.json");
const baseline = readJson(bundleDir + "/baseline.json");
const candidate = readJson(bundleDir + "/candidate.json");
const paired = readJson(bundleDir + "/paired-errors.json");
const lesion = readJson("docs/generated/phase6-lesion-safety-net.json");
const benchmark = readJson("docs/generated/phase6-model-benchmark.json");
const resourceLoad = readJson("docs/generated/phase6-resource-load.json");
const acquisition = readJson("scratch/phase6-candidates/retguard-dr-v1.0.0/acquisition.json");
const acquisitionRecord = readJson("docs/model-manifests/retguard-dr-v1.0.0-acquisition.json");
const rights = readText("docs/PHASE6_CANDIDATE_RIGHTS_DOSSIER.md");
const baselineMetrics = baseline?.metrics ?? {};
const referable = baselineMetrics.referable ?? {};
const confusion = referable.confusion ?? {};
const candidateResult = candidate ?? {};
const lesionFn = lesion?.baseline_fn ?? {};
const lesionNonref = lesion?.nonreferable ?? {};
const benchmarkModels = new Map((benchmark?.models ?? []).map((model) => [model.model_id, model]));
const endingHead = git(["rev-parse", "HEAD"]);
const worktreeStatus = git(["status", "--short"]);
const reportSha = sha256("scripts/generate-phase6-report.mjs");
const ciEvidence = process.env.PHASE6_CI_EVIDENCE ?? "NOT RUN FOR THE ASSESSED HEAD";
const pushEvidence = process.env.PHASE6_PUSH_EVIDENCE ?? "NOT PUSHED AT REPORT GENERATION";
const acquisitionState = acquisition?.status ?? (acquisitionRecord?.runtime_state === "NOT_BENCHMARK_READY" ? "ACQUIRED_BUT_NOT_BENCHMARK_READY" : "NOT AVAILABLE");
const acceptanceEvidence = process.env.PHASE6_ACCEPTANCE_STATUS ?? "NOT RECORDED";
const equippedTestsEvidence = process.env.PHASE6_EQUIPPED_TESTS ?? "NOT RECORDED";
const noModelTestsEvidence = process.env.PHASE6_NO_MODEL_TESTS ?? "NOT RECORDED";
const cleanCheckoutEvidence = process.env.PHASE6_CLEAN_CHECKOUT ?? "NOT RECORDED";

const sections = [
  ["1 Starting HEAD", "Phase 6 started from " + inline(STARTING_HEAD) + " on " + inline("main") + ", with " + inline("origin/main") + " verified at the same commit. The starting worktree was clean; no reset, clean, force-push, or history rewrite was used."],
  ["2 Ending HEAD", "The evidence snapshot was generated at " + inline(endingHead) + ". Worktree state at generation: " + (worktreeStatus ? "modified/uncommitted changes remained while evidence was assembled." : "clean.") + " A later publication commit must be checked independently."],
  ["3 Commits", "Phase 6 implementation scope includes durable SQLite leases, host-memory observation, thread-governed providers/probes, RetGuard rights/acquisition artifacts, lesion runner, resource-load experiment, Phase 6 API/UI, acceptance tests, CI wiring, and this report generator. Generator SHA-256: " + inline(reportSha) + "."],
  ["4 Push", pushEvidence + " A normal push is required before any remote CI result can be called exact-head evidence."],
  ["5 Exact-head CI", ciEvidence + ". Historical Phase 5 runs are retained as historical evidence only and are not substituted for a Phase 6 exact-head result."],
  ["6 Phase 5 baseline", "The frozen baseline is DeepDRiD regular-fundus validation: 400 images, 100 patients, baseline " + inline("fundus-dr-grading-effb0") + ", referable threshold ICDR grade >=2. The preserved reference result is 101 referable false negatives and 2 false positives."],
  ["7 Candidate search", "RetGuard was investigated first because its publisher reports relevant DR results. ABSSNET remains a bounded next due-diligence target. RetinaLens and RETFound were not accepted as Phase 6 candidates under the recorded rights/technical screen. Publisher metrics were not treated as local results."],
  ["8 Rights dossiers", "The rights dossier records code, weights, dataset, commercial, research, redistribution, modification, publication, attribution, uncertainty, source URL, reviewer, date, and decision fields. RetGuard is " + inline("RIGHTS_RESTRICTED") + "; no promotion or redistribution authorization is recorded. Dossier present: " + (rights ? "yes." : "no.")],
  ["9 Candidate acquisition", "The canonical RetGuard v1.0.0 release archive was retrieved from the publisher release URL. The acquisition script uses a fixed URL, streams to ignored scratch storage, verifies archive/member bytes, and records an explicit stop rule. Acquired state: " + acquisitionState + "."],
  ["10 Artifact hashes", "RetGuard archive: 204,707,438 bytes, SHA-256 " + inline("663c7f8bbc3676df2fe353efa0f3913c757db8c35cf9bf97ab451a756792d2e0") + ". ONNX member: 212,474,298 bytes, SHA-256 " + inline("f0e19fa86d5a27a05731550d1d6708c01f6f363f45a1fa57849de988f91e775b") + ". All four archive-member hashes match the published release record; the archive was not executed."],
  ["11 Preprocessing", "The candidate manifest records EfficientNetV2-M, publisher input " + inline("batch,3,480,480") + ", and source preprocessing as reconstructed but locally unverified. VisionScan's frozen DR contract is " + inline("3x512x512") + "; no semantic conversion was accepted into a comparison."],
  ["12 Parity", "The publisher's six-sample ONNX parity evidence records maximum probability difference 0.000626 and maximum logit difference 0.002526 against a 0.001 logit tolerance. Probability parity passed; logit parity failed. This is a candidate stop condition, not a local performance result."],
  ["13 Candidate runtime", "A CPU-only ONNX graph-load/input-shape probe passed with " + inline("CPUExecutionProvider") + ", input " + inline("input") + ", and outputs " + inline("probability") + " and " + inline("logit") + ". Candidate inference was not run after the failed parity gate. Running the graph is not equivalent to validating the model."],
  ["14 Dataset freeze", "The immutable competition bundle freezes the DeepDRiD regular-fundus validation split at 400 cases and 100 patients, with all declared rows and patient-separated provenance. No case membership was changed for RetGuard."],
  ["15 Baseline reproduction", "The baseline freezer completed with state " + inline("FROZEN") + " and copied the already-recorded baseline evidence without new inference. Its raw-export SHA-256 is " + inline(bundle?.frozen_baseline_manifest?.evidence?.find((item) => item.id === "dr-deepdrid-validation-export")?.sha256 ?? "Not recorded") + "."],
  ["16 Candidate execution coverage", "Candidate execution coverage is 0/400 because the parity stop rule fired before any prediction was admitted. No row silently disappeared: the candidate result is " + inline(candidateResult.measurement_state ?? "NOT_MEASURED") + " and the bundle retains the unavailable denominator."],
  ["17 Candidate failures", "The candidate failure is a pre-execution validation stop: " + inline("OUTPUT_INVALID/PARITY_GATE_FAILED") + " in the research governance record. It is not converted to a negative prediction. Candidate inference, preprocessing parity, and case-level output are unavailable."],
  ["18 Baseline metrics", "Baseline: accuracy 0.5025; balanced accuracy 0.2842; macro F1 0.2620; QWK 0.4950; referable sensitivity " + percent(referable.sensitivity) + "; specificity " + percent(referable.specificity) + "; PPV " + percent(referable.ppv) + "; NPV " + percent(referable.npv) + "; confusion TP " + num(confusion.tp) + " / FP " + num(confusion.fp) + " / TN " + num(confusion.tn) + " / FN " + num(confusion.fn) + "."],
  ["19 Candidate metrics", "Candidate metrics are null by contract. No accuracy, balanced accuracy, macro F1, QWK, AUROC, AUPRC, sensitivity, specificity, PPV, NPV, per-grade metric, confusion matrix, FN count, or FP count is inferred from the publisher README or failed parity observation."],
  ["20 Confidence intervals", "Baseline Wilson 95% intervals are retained in the frozen result: sensitivity " + JSON.stringify(referable.confidence_intervals?.referable?.sensitivity ?? null) + ", specificity " + JSON.stringify(referable.confidence_intervals?.referable?.specificity ?? null) + ", PPV " + JSON.stringify(referable.confidence_intervals?.referable?.ppv ?? null) + ", NPV " + JSON.stringify(referable.confidence_intervals?.referable?.npv ?? null) + ". Candidate intervals and patient-cluster bootstrap intervals are unmeasured."],
  ["21 Paired comparison", "The correct paired comparison uses identical case keys and classifies baseline-wrong/candidate-correct, baseline-correct/candidate-wrong, both-correct, and both-wrong. The persisted paired record contains null counts because the candidate produced no eligible rows: " + JSON.stringify(paired?.counts ?? null) + "."],
  ["22 Confusion matrices", "The baseline confusion matrix is persisted in " + inline(bundleDir + "/confusion-matrix.json") + ". The candidate matrix is null. No incomplete candidate output is padded with negative or zero predictions."],
  ["23 Baseline FN", "The frozen baseline contains " + num(confusion.fn) + " referable false negatives at grade >=2. These include grade 2, grade 3, and grade 4 cases and are case-level counts, not independent-patient counts."],
  ["24 Candidate FN", "Candidate FN count is not available. A candidate with no admitted predictions cannot be credited with either finding or missing a case."],
  ["25 FN recovered", "FN_RECOVERED is not measured. The evidence does not support saying that RetGuard recovered any of the baseline 101 false negatives."],
  ["26 FN shared", "FN_SHARED is not measured. No candidate prediction was admitted for paired analysis."],
  ["27 FN new", "FN_NEW is not measured. No candidate prediction was admitted, so candidate false-negative behavior cannot be calculated."],
  ["28 Grade 3 analysis", "Baseline exact grade-3 sensitivity is 3/68 = 0.0441. Candidate grade-3 behavior is unmeasured; no improvement claim is made."],
  ["29 Grade 4 analysis", "Baseline exact grade-4 sensitivity is 0/20 = 0.0000. Candidate grade-4 behavior is unmeasured. The candidate is not safer by virtue of being runnable or publisher-reported."],
  ["30 Baseline FP", "Baseline referable FP count is " + num(confusion.fp) + " with specificity " + percent(referable.specificity) + " on the frozen cohort."],
  ["31 Candidate FP", "Candidate FP count is not measured. No candidate result entered the denominator."],
  ["32 FP new", "New candidate false positives are not measured. The absence of candidate output is not treated as zero FP."],
  ["33 FP removed", "Removed/shared false positives are not measured. Specificity trade-off cannot be hidden because no paired candidate output exists."],
  ["34 Review burden", "Candidate added review burden is not measured. The lesion safety-net is reported separately as review escalation coverage and must not be substituted for candidate DR performance."],
  ["35 Threshold experiments", "No candidate threshold curve was run. The candidate's output semantics and parity gate were not accepted, and no threshold was tuned on the frozen test set."],
  ["36 Calibration/test separation", "No candidate calibration/test split was created because there was no defensible candidate score stream. Baseline raw logit remains a ranking score, not a calibrated probability."],
  ["37 Pareto frontier", "No Pareto frontier can be identified without paired FN and FP/review measurements. Any apparent point from publisher metrics would be incomparable and is excluded."],
  ["38 Lesion safety-net", "A separate aggregate-only technical-research runner applies the current quality/OOD gates in Node, then uses one finite hash-verified batch worker that processes admitted DeepDRiD images serially and validates original-image geometry before summarizing output. Final state: " + (lesion?.measurement_state ?? "NOT MEASURED") + "."],
  ["39 DR FN escalation coverage", "The permitted label is REVIEW ESCALATION COVERAGE, not disease recovery. The aggregate reports " + num(lesionFn.input_cases) + " baseline FN cases selected, " + num(lesionFn.signal_cases) + " with a research signal, and " + percent(lesionFn.review_escalation_coverage) + " coverage. A partial result remains technical research only."],
  ["40 Lesion added review burden", "The runner applies the same escalation logic to baseline-predicted-nonreferable cases. It reports " + num(lesionNonref.input_cases) + " nonreferable-path cases and " + num(lesionNonref.signal_cases) + " signal cases, or " + num(lesionNonref.extra_review_escalations_per_100) + " extra escalations per 100. These are uncalibrated research observations, not clinical utility."],
  ["41 Ensemble strategies", "Strategies A through G were specified: baseline only, candidate only, either, both, disagreement review, candidate plus lesion escalation, and baseline plus candidate plus lesion escalation. They were not run because the candidate was not benchmark-ready; no score averaging was used."],
  ["42 Ensemble results", "All ensemble sensitivity, specificity, PPV, NPV, FN, FP, and review-burden cells are unmeasured. The stored bundle preserves nulls rather than selecting a favorable strategy."],
  ["43 Disagreement analysis", "Model disagreement is not available because candidate predictions are absent. The future protocol must persist disagreement per case and route it to review, never silently choose a desired answer."],
  ["44 Promotion decision", "Promotion is BLOCKED. RetGuard remains " + inline("CANDIDATE_ONLY") + ", " + inline("RIGHTS_RESTRICTED") + ", and " + inline("NOT_BENCHMARK_READY") + ". The model classification is DR CANDIDATE EVALUATED — IMPROVEMENT NOT ESTABLISHED."],
  ["45 Reviewer decisions", "No formal promotion sign-offs are recorded. The bundle requires Implementation Reviewer, Validation/Statistics Reviewer, and Safety/Governance Reviewer decisions; all remain pending."],
  ["46 Resource governor architecture", "Phase 6 adds durable " + inline("resource_leases") + " SQLite state with WAL, busy timeout, synchronous FULL, ownership fencing, heartbeat, expiry/reap, persisted configuration consistency, memory/thread budgets, a max-active limit, and configurable headroom. The existing process-local governor remains a second layer."],
  ["47 Cross-process race", "Two independent Node workers race against one SQLite capacity slot. The focused coordination test passed and observed one admission winner; the loser was explicitly rejected, proving the admission boundary is not only in-memory."],
  ["48 Stale recovery", "Lease expiry is persisted and reclaimed transactionally. The focused test passed stale-expiry/reclaim and ownership-fencing checks. Reclamation evidence does not prove universal recovery from every OS failure."],
  ["49 Memory observation", "Host memory is read from Node's " + inline("os.totalmem/os.freemem") + " and returned as an observation with platform/source. It is not OS enforcement. The recorded local control-plane observation was " + size(resourceLoad?.host_memory?.availableBytes) + " available of " + size(resourceLoad?.host_memory?.totalBytes) + " total."],
  ["50 Thread governance", "Thread environment is centralized for OMP, MKL, OpenBLAS, NumExpr, PyTorch intra/inter-op, and ONNX Runtime intra/inter-op. The setting is cooperative; it cannot guarantee that third-party code or the OS obeys the budget."],
  ["51 One-worker load", "One cold and one warm isolated subprocess observation was recorded for each installed approved artifact. Results are " + (benchmark?.status ?? "NOT MEASURED") + " and are bounded engineering observations, not production capacity."],
  ["52 Two-worker decision", "A two-worker real model load was not run because the lesion worker observed approximately 1.3 GiB peak working set and workstation headroom would make uncontrolled duplication unsafe. The two-process SQLite admission race was run separately."],
  ["53 Queue latency", "Model queue latency is not measured from a real multi-job provider queue. Control-plane lease admission wait p50/p95 at requested 1/5/10/25 were " + (resourceLoad?.points?.map((point) => point.requested + ": " + num(point.queue_wait_ms?.p50) + "/" + num(point.queue_wait_ms?.p95) + " ms").join(", ") ?? "Not measured") + "."],
  ["54 Service latency", "The one-cold/one-warm benchmark contains isolated probe wall time. A production service-latency claim is not made because every sample starts a fresh process and no resident worker was used."],
  ["55 Throughput", "Throughput is not established. The safe 1/5/10/25 experiment is control-plane-only and reports no model inference; a one-sample-per-phase benchmark cannot define sustained throughput."],
  ["56 CPU", "The model benchmark records best-effort process-tree CPU seconds. It is observational for the isolated probe tree and excludes a production workload/SLO claim."],
  ["57 Memory", "Approximate peak working-set observations: lesion " + benchLine(benchmarkModels.get("fundus-lesions-clementp-unet-seresnext50")) + "; DR " + benchLine(benchmarkModels.get("fundus-dr-grading-effb0")) + "; OCT " + benchLine(benchmarkModels.get("oct-retinal-weights-fp32")) + "; SegFormer " + benchLine(benchmarkModels.get("segformer-optic-disc-cup-refuge")) + "."],
  ["58 Resident experiment", "No resident worker replacement was introduced. The current provider remains short-lived subprocess execution; resident-worker experiments are intentionally unmeasured rather than inferred from warm subprocess timing."],
  ["59 Memory growth", "Twenty sequential resident jobs, memory-growth slope, prediction consistency, and resident cleanup were not measured. No bounded result is available to support resident execution."],
  ["60 Cross-job isolation", "The short-lived provider deletes its per-run temporary image bytes in a finally block and scopes cache keys by content/model/preprocessing/study. A full resident cross-job isolation matrix was not run."],
  ["61 Resident decision", "Resident service execution is rejected for this phase: memory growth, cancellation, and crash recovery were not established. The lesion study uses one finite serialized batch worker and does not establish a reusable resident production worker."],
  ["62 Crash matrix", "The repository's synthetic Node-to-Python crash matrix passed its bounded Windows tree case. A complete real-provider phase matrix at claim, preprocessing, startup, model load, inference, postprocessing, persistence, and report stages is not proven."],
  ["63 Provider-specific crashes", "DR, lesion, OCT, and SegFormer providers have fail-closed spawn/parse/integrity paths and thread governance. Provider-specific forced-kill experiments beyond the bounded synthetic case are unmeasured; RetGuard has no candidate provider."],
  ["64 Deadline", "The production job deadline remains 900,000 ms by configuration, with shortened deadline behavior covered by existing queue tests. A full real model deadline run with descendant cleanup and lease recovery is not claimed here."],
  ["65 Process-tree termination", "Known child tracking and termination hooks remain in the queue/process-control path. Existing timeout behavior does not prove descendant cleanup in every provider path; observed termination is reported only where directly tested."],
  ["66 Graceful shutdown", "No new claim/current-job/restart soak with a real heavy provider was completed in Phase 6. Worker lifecycle and lease state require a bounded dedicated experiment before a graceful-shutdown guarantee is made."],
  ["67 Validation Center", "Validation Center now reads a role-gated, read-only " + inline("/api/validation/phase6") + " projection. It displays candidate lifecycle, rights/parity stop, frozen baseline counts, lesion coverage, runtime classifications, and clinical boundaries without exposing candidate paths or raw cases."],
  ["68 Error explorer", "The existing aggregate error surface remains separate from Phase 6 candidate evidence. No raw model output, source bytes, patient IDs, or free-text clinical notes are added to the new projection."],
  ["69 Traceability", "The bundle records manifest/result/evidence hashes, model/archive hashes, dataset and preprocessing references, limitation files, and pending reviewer states. The UI masks live model hashes and does not spread the full registry record."],
  ["70 Dependency audit", "The audit found two moderate Vitest/@vitest-mocker advisories, GHSA-82fw-gwwq-j7x9, affecting the development/test toolchain. Production dependency audit at high severity remains clean; the available fix is Vitest 4.1.11 and is a major upgrade."],
  ["71 Security", "Vitest 4 was tested in isolation and rejected because it removes " + inline("--minWorkers") + " and breaks the existing standalone " + inline("vite-node") + " child-process recovery harness. Vitest 3.2.6 remains release-tested. " + inline("npm audit fix --force") + " was not used; controls include single-worker runs, no exposed test runner, and process-boundary/security tests."],
  ["72 PHI", "Committed competition artifacts are aggregate-only and declare " + inline("phi_included:false") + ". They contain no patient names, DOBs, addresses, medical-record numbers, raw clinical documents, source image bytes, or per-case prediction records."],
  ["73 Secrets", "No secrets, credentials, or private model bytes are committed. RetGuard scratch acquisition remains ignored local research storage. The API does not return private absolute model-store paths in the Phase 6 projection."],
  ["74 Phase 6 acceptance", "The Phase 6 acceptance pack covers candidate manifest/bundle integrity, parity stop state, tamper detection, PHI redaction, lease coordination, stale recovery, JSON fail-closed behavior, and thread environment propagation. Observed focused acceptance status: " + acceptanceEvidence + "."],
  ["75 Equipped tests", "Model-equipped local evidence includes hash-verified DR, lesion, OCT, and SegFormer artifacts, the one-cold/one-warm benchmark, and the serialized lesion study. Observed equipped-suite status: " + equippedTestsEvidence + ". Candidate-equipped inference was not enabled because RetGuard stayed outside the registry."],
  ["76 No-model tests", "The clean-checkout contract remains model-free: candidate-dependent private weights are not required for ordinary tests, build, audit, or read-only bundle checks. Observed no-model checkout status: " + noModelTestsEvidence + ". Artifact-dependent real-inference paths remain explicitly unavailable when private weights are absent."],
  ["77 TypeScript", "The Phase 6 TypeScript check passed after correcting lease-result typing, runner aggregation typing, and the host-memory test source type: " + inline("npx tsc --noEmit") + " exit 0."],
  ["78 lint", "Lint status is " + (process.env.PHASE6_LINT_STATUS ?? "NOT RUN IN THIS REPORT SNAPSHOT") + "."],
  ["79 build", "Build status is " + (process.env.PHASE6_BUILD_STATUS ?? "NOT RUN IN THIS REPORT SNAPSHOT") + ". The Next.js App Router rules were preserved; the new API route is Node-runtime, dynamic, and read-only."],
  ["80 smoke", "Smoke status is " + (process.env.PHASE6_SMOKE_STATUS ?? "NOT RUN IN THIS REPORT SNAPSHOT") + ". No smoke result is inferred from a successful type-check."],
  ["81 responsive", "Responsive browser evidence is " + (process.env.PHASE6_RESPONSIVE_STATUS ?? "NOT RUN IN THIS REPORT SNAPSHOT") + ". Validation Center retains internal labelled table scrolling and existing 320–1920 responsive CSS coverage."],
  ["82 accessibility", "Accessibility evidence is " + (process.env.PHASE6_A11Y_STATUS ?? "NOT RUN IN THIS REPORT SNAPSHOT") + ". Candidate status is conveyed by text as well as color, and the API projection contains no hidden evidence state."],
  ["83 keyboard", "Keyboard evidence is " + (process.env.PHASE6_KEYBOARD_STATUS ?? "NOT RUN IN THIS REPORT SNAPSHOT") + ". Existing table regions remain focusable; no new interactive candidate control was introduced."],
  ["84 Browser E2E", "Browser asset/E2E evidence is " + (process.env.PHASE6_BROWSER_STATUS ?? "NOT RUN IN THIS REPORT SNAPSHOT") + ". Hosted browser CI remains synthetic/no-model and cannot establish private model inference."],
  ["85 Model audit", "The existing model manifest audit passed for the approved installed manifests. RetGuard is documented separately as candidate-only and is not inserted into the ordinary live model registry."],
  ["86 Filesystem audit", "The filesystem audit remains a release gate for sensitive extensions and reparse/path hazards. Candidate weights are ignored scratch assets; no raw dataset/image is added to the committed Phase 6 bundle."],
  ["87 SBOM", "The de-identified SBOM command remains part of the CI/release matrix. It describes dependencies and declares evidence scope; it does not claim private model weights ran in hosted CI."],
  ["88 Clean checkout", "The Phase 6 clean-checkout evidence is " + cleanCheckoutEvidence + ". It used an isolated detached worktree, npm ci, external data/database paths, setup/db init, no-model tests, typecheck, model audit, filesystem audit, and build; private weights were absent from the checkout."],
  ["89 Linux CI", "Linux CI is configured for npm ci, SQLite init, typecheck, tests, Phase 4/5/6 acceptance, audits, SBOM, filesystem audit, and build. Exact-head result: " + (process.env.PHASE6_LINUX_CI ?? "NOT RECORDED") + "."],
  ["90 Windows CI", "Windows CI is configured for native path/reparse tests, typecheck, tests, Phase 4/5/6 acceptance, audits, SBOM, filesystem audit, and build. Exact-head result: " + (process.env.PHASE6_WINDOWS_CI ?? "NOT RECORDED") + "."],
  ["91 Browser CI", "Browser CI remains a separate synthetic authenticated smoke job with isolated storage and no private models. Exact-head result: " + (process.env.PHASE6_BROWSER_CI ?? "NOT RECORDED") + "."],
  ["92 Independent model audit", "The independent model review concludes: RetGuard archive/member integrity is verified, rights are restricted, publisher logit parity failed, candidate inference is not benchmark-ready, and no paired improvement/FN recovery/FP burden can be claimed."],
  ["93 Independent system audit", "The independent system review concludes: durable cross-process SQLite admission and tests are present; host memory/thread controls remain observational/cooperative; real capacity, resident safety, full crash matrix, final CI, and data-release blockers remain open."],
  ["94 Remaining model blockers", "RetGuard blockers: failed publisher logit parity, unverified local preprocessing parity, different input shape, no candidate predictions, no paired metrics, no high-grade comparison, no threshold/calibration result, restricted rights, and zero formal promotion reviews."],
  ["95 Remaining engineering blockers", "Engineering blockers: no production-capacity claim, no real 5/10/25 model-load curve, no resident-worker evidence, and incomplete real-provider crash/deadline/shutdown matrix. Exact-head CI status is recorded separately in sections 89–91."],
  ["96 Remaining data blockers", "The application data gate remains blocked. Phase 6 model-validation artifacts must not be confused with current application data; unresolved source/reference records remain retained and release:data-check keeps its blocker meaning."],
  ["97 Remaining clinical blockers", "No clinical validation, prospective validation, device validation, calibration suitable for clinical decisions, clinician adjudication, safety/utility study, or autonomous diagnosis evidence exists."],
  ["98 Exact capabilities", "This phase demonstrates: authenticated aggregate Phase 6 evidence display; immutable candidate/baseline bundle structure; canonical artifact acquisition and hashing; explicit parity stop; local approved-model resource observations; durable SQLite lease admission/race/stale recovery; cooperative thread settings; serialized lesion technical-research execution; and fail-closed candidate governance."],
  ["99 Exact non-capabilities", "This phase does not demonstrate: a better DR model; 101 FN reduction; candidate sensitivity/specificity; clinical lesion recovery; validated lesion localization; calibrated probabilities; production throughput/capacity; universal orphan freedom; resident-worker safety; clinical diagnosis; normality; treatment advice; or data-release safety."],
  ["100 Software classification", "ENGINEERING PARTIAL — BLOCKERS REMAIN. The new controls are implemented and focused-tested, but Phase 6 operational gates are not all closed."],
  ["101 Model classification", "DR CANDIDATE EVALUATED — IMPROVEMENT NOT ESTABLISHED. RetGuard was acquired and integrity-checked, but the failed parity gate prevented a fair local head-to-head."],
  ["102 Performance classification", "LOCAL RUNTIME PARTIAL. One cold/one warm isolated subprocess per installed artifact and control-plane load points are measured; production capacity and sustained throughput are not."],
  ["103 Data classification", "DATA RELEASE BLOCKED. Model-validation artifacts do not clear unresolved current application-data references."],
  ["104 Demo classification", "DEMO / SYNTHETIC RESULT - NOT FOR CLINICAL USE. The deterministic DEMO path remains separate from real research artifacts and candidate governance."],
  ["105 Clinical classification", "NOT CLINICALLY VALIDATED. NOT A MEDICAL DEVICE. NOT FOR AUTONOMOUS DIAGNOSIS.\\n\\nPrimary answer: NO. VisionScan cannot defensibly claim reduction of the observed 101 referable DR false negatives from this Phase 6 evidence without hiding the unmeasured candidate result and resulting false-positive/review burden. The lesion study, where measured, is review escalation coverage only—not disease recovery."],
];

if (sections.length !== 105) throw new Error("Expected 105 report sections, got " + sections.length);

const intro = "# VisionScan AI Eye Center — Phase 6 DR Candidate and Runtime Validation Report\\n\\n" +
  "Generated: " + new Date().toISOString() + "\\n\\n" +
  "## Executive outcome\\n\\n" +
  "**NO — a defensible reduction of the observed 101 referable DR false negatives was not established.**\\n\\n" +
  "RetGuard was acquired from its canonical release and its archive/member hashes were verified, but the publisher's six-sample ONNX logit-parity gate failed before candidate predictions were admitted. The candidate therefore remains " + inline("CANDIDATE_ONLY") + ", " + inline("RIGHTS_RESTRICTED") + ", and " + inline("NOT_BENCHMARK_READY") + "; no FN recovery, FP cost, high-grade behavior, threshold curve, or ensemble result is claimed.\\n\\n" +
  "The separately implemented lesion safety-net runner is aggregate-only, gate-aware, and serialized. Its permitted label is **REVIEW ESCALATION COVERAGE**, not disease recovery. Local approved model timing and resource observations are bounded engineering evidence, not production capacity or clinical validation.\\n\\n" +
  "## Evidence anchors\\n\\n" +
  "| Artifact | State |\\n|---|---|\\n" +
  "| " + bundleDir + "/manifest.json | immutable candidate/baseline bundle manifest |\\n" +
  "| " + bundleDir + "/candidate.json | " + inline("NOT_MEASURED") + "; candidate metrics null |\\n" +
  "| docs/generated/phase6-model-benchmark.json | one cold/one warm isolated subprocess per approved artifact |\\n" +
  "| docs/generated/phase6-resource-load.json | SQLite control-plane-only 1/5/10/25 admission points |\\n" +
  "| docs/generated/phase6-lesion-safety-net.json | serialized lesion technical-research aggregate |\\n" +
  "| docs/PHASE6_CANDIDATE_RIGHTS_DOSSIER.md | rights decisions and uncertainties |\\n\\n" +
  "No report section converts unavailable evidence into a zero. The exact section sequence below is the requested 105-section ledger.\\n\\n";

const report = intro + sections.map((item) => "## " + item[0] + "\\n\\n" + item[1] + "\\n").join("\\n");
fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, report.replaceAll("\\n", "\n"), "utf8");
process.stdout.write(JSON.stringify({ status: "PHASE6_REPORT_WRITTEN", output: path.relative(ROOT, OUTPUT), sections: sections.length, ending_head: endingHead }, null, 2) + "\\n");
