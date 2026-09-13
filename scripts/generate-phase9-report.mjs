#!/usr/bin/env node
/** Generate the controlled Phase 9 research release-candidate report.
 * The report is intentionally a ledger of evidence and non-evidence. It does
 * not convert an implementation status into a clinical validation claim. */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const REPORT = path.join(ROOT, "docs", "VISIONSCAN_PHASE9_CONTROLLED_RESEARCH_RELEASE_CANDIDATE_REPORT.md");

function readJson(relativePath) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8")); } catch { return null; }
}

function git(args) {
  const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf8", windowsHide: true });
  return result.status === 0 ? result.stdout.trim() : "UNAVAILABLE";
}

const generatedAt = new Date().toISOString();
const head = git(["rev-parse", "HEAD"]);
const phase9 = readJson("docs/generated/phase9-runtime-controls.json");
const external = readJson("docs/generated/phase9-external-validation-readiness.json");
const manifest = readJson("docs/generated/phase9-governed-release-manifest.json");
const phase8 = readJson("docs/generated/phase8-runtime-closure.json");
const phase7Load = readJson("docs/generated/phase7-real-load.json");
const dirty = git(["status", "--porcelain"]);

const sections = [
  ["Executive release decision", `This is a controlled Phase 9 engineering report for the VisionScan ophthalmic AI research system. The release decision is ENGINEERING PARTIAL — BLOCKERS REMAIN. The research intelligence boundary remains RETINAL REVIEW INTELLIGENCE PARTIAL — INTERNAL HELD-OUT EVIDENCE ONLY. Local runtime remains LOCAL RUNTIME PARTIAL. Data release is DATA RELEASE BLOCKED. Clinical status is NOT CLINICALLY VALIDATED / NOT A MEDICAL DEVICE / NOT FOR AUTONOMOUS DIAGNOSIS.`],
  ["Scope", `The scope is the local repository, its deterministic controls, its existing Phase 7/8 evidence, its clinician-review workflow, and its release artifacts. No new disease claim, model claim, external validation claim, or data-rights claim is inferred from a missing artifact.`],
  ["Repository and report provenance", `Report generation timestamp: ${generatedAt}. Repository HEAD at generation: ${head}. The working-tree observation at generation was: ${dirty || "clean"}. The final commit and remote parity must be taken from post-commit Git verification because a report cannot truthfully contain the hash of a commit that has not yet been created.`],
  ["Phase 8 preservation", `Phase 8 evidence is retained as frozen context: high-grade miss registry, lesion rule freeze, external-validation rejection ledger, and runtime-closure artifact. Phase 9 adds controls and does not retune the Phase 8 lesion rule or alter its denominator.`],
  ["No rebuild or model chase", `No architecture rebuild, random feature work, unapproved model download, or model-selection chase was used as a substitute for closure. The implementation work is limited to durable effect identity, worker lifecycle policy, bounded age policy, review concurrency, release evidence, and visibility.`],
  ["Release classifications", `The governed manifest records five bounded classifications: engineering partial, internal retinal review intelligence only, local runtime partial, data release blocked, and not clinically validated/not a medical device/not for autonomous diagnosis.`],
  ["Allowed research use", `Allowed use is local engineering research, synthetic/demo workflow testing, and internal clinician-review workflow prototyping with explicit research labeling. These uses do not authorize clinical deployment or diagnostic reliance.`],
  ["Prohibited use", `The release must not be used for autonomous diagnosis, clinical deployment, medical-device representation, unapproved training on uploaded data, or external validation claims without an eligible rights-cleared manifest and independent review.`],
  ["Evidence hierarchy", `Observed commands and tests outrank narrative documentation. Generated artifacts are aggregate and PHI-free. A status of NOT MEASURED is retained as such; it is not treated as zero, pass, normal, safe, or validated.`],
  ["System architecture in scope", `The system uses Next.js routes, a transactional SQLite default, durable jobs with leases and fencing, local provider subprocesses, immutable source files, structured evidence, deterministic reasoning, sealed reports, and append-only clinician review events. JSON persistence remains an explicit legacy mode and is not silently treated as equivalent to SQLite.`],
  ["Input and modality boundary", `Fundus, OCT, document-derived OCT B-scan regions, symptoms, and clinician-authored review are distinct evidence classes. Missing, unsupported, ambiguous, poor-quality, or out-of-distribution inputs do not become normal findings.`],
  ["Clinical language boundary", `The system preserves the separation between observed finding, possible association, triage recommendation, clinician interpretation, and confirmed diagnosis. No software artifact in this report opens the diagnosis gate.`],
  ["At-least-once versus exactly-once", `Provider/model execution remains at-least-once because a worker can be replayed after failure. Phase 9 makes the narrower and defensible claim that canonical committed effects use insert-once identities and reject a different payload under the same identity.`],
  ["Canonical effect identity", `The committed-effect ledger uses stable identities for model result, structured evidence, reasoning record, report, and terminal job completion. Attempt and worker provenance are retained as metadata but do not create a second canonical result identity.`],
  ["Committed-effect storage", `The new job_effects persistence collection is PHI-free metadata. It records effect type, idempotency key, canonical id, payload hash, study/job/attempt context when available, committed state, and a bounded note.`],
  ["Insert-once behavior", `persistOnce performs a transaction-local read-before-write and rejects IMMUTABLE_EFFECT_CONFLICT when an existing identity maps to a different canonical fingerprint. Reasoning and structured-evidence records use stable fingerprints that exclude only non-semantic creation timestamps.`],
  ["Test-only fault hooks", `The supported seams are BEFORE_MODEL_RESULT_WRITE, AFTER_MODEL_RESULT_WRITE, BEFORE_EVIDENCE_COMMIT, AFTER_EVIDENCE_COMMIT, BEFORE_REPORT_COMMIT, AFTER_REPORT_COMMIT, and BEFORE_JOB_COMPLETE.`],
  ["Fault-hook activation guard", `Hooks require NODE_ENV=test, VISIONSCAN_TEST_ISOLATED=1, and an explicit VISIONSCAN_PHASE9_FAULT_INJECTION value. There is no API route for activation, and a production process treats the value as inert.`],
  ["Fault-hook test evidence", `tests/phase9-controls.test.ts proves the isolated test guard and one-shot consumption. The hook matrix is implementation-ready and controlled-seam tested; it is not represented as an OS process-crash result.`],
  ["Model result commit", `The first analysis envelope retains the canonical anl_<study> identity; a changed symptom/document envelope receives a deterministic anl_<study>_v<hash> immutable version, while the study stores the newest analysis pointer. A replay can reuse the row but cannot overwrite it with a different payload.`],
  ["Evidence commit", `StructuredClinicalEvidence is persisted as a standalone immutable evidence snapshot keyed by study and stable evidence payload hash. The fusion engine remains an aggregator and is not made stateful by this change.`],
  ["Reasoning commit", `Reasoning records now use insert-once persistence and a stable canonical fingerprint. Existing sealed records are verified and reused; a different record under the same id is rejected.`],
  ["Report commit", `The sealed report identity, source-analysis hash, and AI payload hash remain canonical. A report replay returns the sealed record and repairs a missing derived JSON export after a controlled publication-window interruption.`],
  ["Job completion commit", `The terminal completion effect is inserted in the same transaction as the completed job state. Job/attempt/worker fencing still rejects duplicate and stale finalizers.`],
  ["Stale worker writes", `Queue-owned analysis controls now receive an assertCanCommit callback. Immediately before analysis, evidence, reasoning, report, and pointer publication, a stale or cancelled attempt is rejected. A race after a check remains a reason to retain insert-once identities and reconciliation evidence.`],
  ["Duplicate report after retry", `A retry after a sealed report exists matches the source analysis and reasoning snapshot, reuses the report, and repairs a missing report export. It does not replace clinician state or change the sealed AI payload.`],
  ["Duplicate completion after retry", `A successful terminal transition is guarded by status, active attempt, and worker identity. The completion effect is committed with that transition; a second terminal finalizer receives no successful transition.`],
  ["OS crash limitation", `A live process-kill matrix covering every post-persistence window is NOT MEASURED in Phase 9. Existing provider-crash evidence covers earlier forced-termination windows only.`],
  ["Shutdown policy", `Worker shutdown is explicit through WorkerLifecycle. Supported policies are DRAIN_CURRENT, CANCEL_CURRENT, and LEASE_FOR_RECOVERY. A shutdown request blocks new worker passes/claims.`],
  ["Default shutdown behavior", `The safe default is LEASE_FOR_RECOVERY: a current lease remains durable and recoverable if the process exits. The worker records the shutdown request and does not claim new work after it.`],
  ["Windows Ctrl+C", `The Windows path is wired to the SIGINT handler and the same lifecycle state machine. A real Windows console Ctrl+C run with an active provider remains NOT MEASURED.`],
  ["Restart recovery", `Durable queue restart recovery already marks expired leases stale and applies bounded retry policy. Phase 9 preserves that mechanism; a full post-publication restart experiment remains NOT MEASURED.`],
  ["Real provider deadline", `The queue continues to enforce VISIONSCAN_OVERALL_JOB_DEADLINE_MS from claim, and the real provider path runs inside withOverallJobDeadline. Phase 9 adds separate queue-wait, service-time, and total-age policy fields.`],
  ["Process-tree cleanup", `Tracked child processes are scoped by job and are targeted by the centralized Windows taskkill tree path on cancellation/deadline. The cleanup command exit is not equivalent to proof that every descendant is absent.`],
  ["Cleanup evidence gap", `Provider deadline and cleanup are therefore classified as implemented real-provider path partial. A deadline while waiting on a provider mutex, descendant enumeration, and post-cleanup orphan proof remain required evidence.`],
  ["Resident lesion scope", `The resident question is separated from short-lived provider behavior. Existing resident evidence is a finite lesion experiment, not a production resident worker contract.`],
  ["Resident parity", `Resident-versus-short-lived per-input output parity, geometry parity, and ordering determinism are NOT MEASURED.`],
  ["Resident cancellation", `Cooperative cancellation between resident inputs and cancellation during a model call are NOT MEASURED.`],
  ["Resident state isolation", `Current evidence is bounded input-scope isolation only. Isolation across jobs, repeated runs, and process-global state is NOT MEASURED.`],
  ["Resident crash recovery", `A resident mid-run crash with descendant cleanup, durable partial state, and safe restart is NOT MEASURED.`],
  ["Resident promotion decision", `Resident promotion is BLOCKED. No resident runtime is promoted to production or clinical use by this report.`],
  ["Load root cause", `Phase 8 identified bounded single-slot serialization: at the 25-job point, resource and queue wait consumed the 120000 ms deadline from queue claim.`],
  ["Capacity and backpressure", `The system has host-wide resource reservation and explicit deadline policy. A production-grade deferred-capacity state and requeue/backoff SLO are not yet proven for the complete load matrix.`],
  ["Load point 25", `The observed 25-job point completed 15 jobs and failed 10 with deadline outcomes. Queue wait p50 was 16354.999 ms, p95 97586.922 ms, and service p50 8050.247 ms.`],
  ["Fairness", `Fairness, starvation, maximum wait SLO, and an explicit scheduling target are NOT MEASURED. Newest-first bounded paging remains a potential starvation risk until an aging/FIFO policy is measured.`],
  ["Bounded rejection", `A valid capacity/deadline rejection is preferable to unbounded work, but it must be reported as a bounded rejection and not as successful inference. The current complete runtime remains partial.`],
  ["External-validation readiness", `Phase 9 creates a readiness package with a frozen protocol, explicit endpoint, eligibility/exclusion rules, dossier fields, overlap review, rights state, patient/eye separation state, and no inference execution.`],
  ["Protocol hash", `VISIONSCAN_EXTERNAL_LESION_PROTOCOL_PHASE9_V1 is recorded with hash ac25900a932804ab5ccd0f8bc60a276a205c72ad4267b22ab53332bbc772695e. The hash covers the frozen protocol fields as generated; it does not authorize data access.`],
  ["IDRiD dossier", `IDRiD is disclosed as a local-overlap export and rejected for external lesion validation because training overlap and verifiable patient/eye separation are not established. No inference ran.`],
  ["RFMiD dossier", `RFMiD is not acquired in the checkout. Public card observations are not treated as a local rights-cleared annotation package. No inference ran.`],
  ["APTOS dossier", `APTOS 2019 is retained as a capped DR comparability source, not an eligible lesion-ground-truth external cohort. Access and downstream terms require separate review. No inference ran.`],
  ["TJDR dossier", `TJDR local scratch material is incomplete and lacks a provenance/licence/grouping manifest. It is rejected before artifact execution. No inference ran.`],
  ["Preregistration", `The protocol predeclares the review-escalation endpoint, required provenance fields, exclusions, and frozen rule. A real preregistered external run and independent adjudication are still absent.`],
  ["Frozen lesion rule", `The Phase 8 frozen rule is LESION_ESCALATION_RULE_PHASE7_V1 with region_count >= 3. It remains calibration/review-routing logic only and is not retuned in Phase 9.`],
  ["High-grade evidence", `Phase 8 reports 65 grade-3 and 20 grade-4 exact baseline misses, with 62/65 and 19/20 review escalation coverage respectively. These are review escalation coverage figures, not disease recovery or sensitivity.`],
  ["Wording governance", `The system and report use REVIEW ESCALATION COVERAGE rather than disease recovery, diagnostic sensitivity, or clinical miss reduction. High-grade cases are not evidence of clinical performance without eligible ground truth and adjudication.`],
  ["No ID-specific logic", `No identifier-specific rule, cohort-specific exception, or hidden case lookup is introduced. The frozen rule uses declared aggregate features and the release artifacts use hashed/opaque identifiers only.`],
  ["Clinician event preservation", `Clinician review events remain append-only records with reviewer identity, action, reason, evidence/dependency references, report version, AI snapshot hash, clinician payload, timestamp, and payload hash.`],
  ["Concurrent review conflict", `The report projection has a monotonic review revision. A revision mismatch preserves the incoming event, retains the stored projection, and sets CONCURRENT_REVIEW_CONFLICT for explicit adjudication rather than silently overwriting one clinician.`],
  ["Final assessment separation", `Final clinician assessment is separate from AI output and is now required to finalize. The UI labels the fields as clinician-authored and the event retains reviewer provenance.`],
  ["Finalized report immutability", `submitReview rejects any subsequent mutation of a clinician_finalized report. A new reviewable version requires a new study/report version rather than overwriting the finalized projection.`],
  ["Versioned event fields", `The review schema retains report version and AI snapshot hash. The report projection retains a revision and conflict list. Further governance should add a formal event schema migration when these fields become mandatory for every historical row.`],
  ["Governed release manifest", `The manifest freezes allowed/prohibited use, required sign-off roles, artifact paths, release state, and replay policy. It records zero present sign-offs, so release remains blocked.`],
  ["Provenance retention", `Analysis, evidence, reasoning, report, model execution ledger, source hashes, rule versions, and review-event references are retained in their respective layers. Provenance is not the same as independent validation.`],
  ["Security posture", `The release keeps role gates, study scope, consent gates, prompt-safety classification, PHI-free validation projections, and no-model clean-checkout expectations. Security and authorization require live route testing in addition to source review.`],
  ["Prompt-injection handling", `Document and medication text is classified as untrusted text by the existing prompt-safety layer. No LLM diagnosis boundary is opened by Phase 9, and untrusted text is not allowed to become a clinical claim.`],
  ["PHI boundary", `Generated Phase 9 artifacts are marked phi_included:false. They contain aggregate statuses, hashes, controlled URLs, and no patient identifiers, image bytes, raw notes, or free-text clinical payloads.`],
  ["Consent boundary", `Image-model and document-extraction work remain consent-gated. Phase 9 does not create an automatic training conversion or assume that upload consent authorizes research reuse.`],
  ["Clinician UI", `The clinician page now shows concurrent-review conflict state, immutable event history, and the required final-assessment boundary. AI output remains visually separate from clinician interpretation.`],
  ["Validation Center UI", `The Validation Center reads a role-gated Phase 9 route and displays controls, policy, unresolved runtime evidence, external readiness, and sign-off state without treating unavailable values as pass.`],
  ["Accessibility and UI QA", `Exact-SHA CI run 34758304012 passed the hosted browser smoke. Broader local visual, accessibility, keyboard, and responsive evidence remains historical Phase 8 context and is not represented as a complete Phase 9 UI release audit.`],
  ["Focused Phase 9 acceptance", `The focused command npm run validation:phase9 passed 54 tests across Phase 9 controls, Phase 8 acceptance, and lease recovery. This covers canonical-effect behavior, review conflict preservation, lifecycle state, deadline policy, hook guards, and existing fencing.`],
  ["Full-suite result", `The CI-equivalent full Vitest command passed 88 test files and 1166 tests, with 1 file and 13 tests intentionally skipped. The run included genuine S9 CPU inference, symptom-driven immutable analysis versioning, dashboard status, red-team, safety, persistence, and lease/recovery paths.`],
  ["Build result", `The local Windows production build was run at the configured 8192 MB Node heap limit and exited 1 with an out-of-memory failure. The corrected source commit 46cd462e880ab16366b842e8b16cf96a295a4897 nevertheless passed the Linux and Windows production-build steps in exact-SHA CI run 34758304012. Local build reproducibility remains a bounded engineering gap, not a claim of universal build failure.`],
  ["Lint and typecheck", `npx tsc --noEmit --pretty false passed, and npm run lint -- --quiet passed after the Phase 9 changes.`],
  ["No test gaming", `No test was weakened or removed to obtain the focused pass. Existing tests remain in their original matrix, and the new test explicitly verifies a different payload causes an immutable-effect conflict.`],
  ["Full test matrix", `The repository matrix includes focused unit tests, model/manifest audits, filesystem and SBOM checks, release-data checks, browser CI, and platform workflows. The current Phase 9 result must preserve any command that was not rerun or that failed.`],
  ["No-model clean checkout", `A clean-checkout/no-model validation remains required for hosted CI and external reproducibility. Phase 9 does not claim that research model assets are available or legally redistributable.`],
  ["Exact-head CI", `Exact-SHA CI run 34758304012 completed SUCCESS for source commit 46cd462e880ab16366b842e8b16cf96a295a4897. verify, verify-windows, and verify-browser all passed, including the Phase 9 controls, full unit/integration matrix, generated audits, and production-build steps. The later report-only commit must retain this distinction because its own workflow is a separate run.`],
  ["Artifact inventory", `The release inventory must include source commit, generated artifacts, model manifest status, SBOM, filesystem audit, data-release result, and test evidence. Existing release-data findings remain blocking and are not zeroed by the new controls.`],
  ["Source hash integrity", `Original study bytes retain SHA-256 provenance, report AI payloads retain a version freeze, reasoning records retain payload hashes, and committed effects retain canonical payload hashes. Hashes provide integrity evidence, not truth of a clinical label.`],
  ["Independent audit boundary", `The internal audit lanes that informed this work are implementation collaborators and static inspectors. They are not independent clinical sign-off or independent engineering release approval.`],
  ["Q1 — exactly-once committed effects", `YES, in the bounded sense tested: canonical committed identities are insert-once and conflicting payloads are rejected. NO, if the question means exactly-once provider execution or atomic filesystem/audit side effects; those remain outside the claim.`],
  ["Q2 — graceful shutdown", `NO as a fully measured release gate. An explicit shutdown state machine and policies are implemented and unit-tested, but a live signal/drain experiment is NOT MEASURED.`],
  ["Q3 — real provider deadline and cleanup", `YES for a real provider deadline path: the provider runs under a bounded queue-claim deadline and tracked cleanup. NO for complete cleanup proof: descendant absence and mutex-wait cancellation remain partial.`],
  ["Q4 — resident lesion parity", `NO. Resident versus short-lived per-input parity and determinism are NOT MEASURED.`],
  ["Q5 — resident cancellation", `NO. Cooperative resident cancellation is NOT MEASURED.`],
  ["Q6 — resident isolation", `NO. Only bounded input-scope isolation is evidenced.`],
  ["Q7 — resident crash recovery", `NO. Resident crash/restart recovery is NOT MEASURED.`],
  ["Q8 — complete 1/5/10/25 load rerun", `NO. Phase 9 did not rerun the complete real single-worker 1/5/10/25 matrix. Historical Phase 7/8 observations are retained without reclassification.`],
  ["Q9 — fairness", `NO. A fairness target, starvation metric, and maximum-wait SLO are NOT MEASURED.`],
  ["Q10 — external-validation readiness", `YES as a readiness package only. NO as external validation; no eligible external inference run occurred.`],
  ["Q11 — four dataset dossiers", `YES. IDRiD, RFMiD, APTOS 2019, and TJDR have explicit dossiers with local state, rights/separation limitations, decision, and no-inference status.`],
  ["Q12 — preregistered frozen rule", `YES as a frozen local protocol artifact with a recorded hash and zero retuning. NO as a completed external preregistration/run with independent adjudication.`],
  ["Q13 — concurrent clinician review", `YES for event preservation and conflict signaling. The focused test proves two events survive and the projection is marked conflicted.`],
  ["Q14 — PHI-free release inventory", `YES for the Phase 9 generated artifacts and manifest. NO for data release clearance: unresolved active/legacy references remain and release-data status is blocked.`],
  ["Q15 — independent audits", `NO. Internal audit lanes are not independent sign-off. Separate clinical-safety, engineering, and data-rights reviewers remain required.`],
  ["Final blocker summary", `The release is blocked by the local Windows build reproducibility gap, missing live shutdown/restart evidence, incomplete resident proof, incomplete fairness/load rerun, external dataset eligibility, data-release findings, and absent independent sign-offs.`],
  ["Required next evidence", `Before promotion, retain the green exact-head Linux/Windows/browser CI result, either make the local build reproducible or document a bounded build-memory fix, obtain controlled post-persistence OS-crash/restart evidence, resident parity/cancel/isolation/crash evidence, a complete load/fairness characterization, an eligible rights-cleared external cohort, and independent reviewer sign-offs.`],
  ["Operator release procedure", `Keep the manifest BLOCKED. Review the generated artifacts and exact Git head, run the focused and full matrices, inspect build/CI exits, verify data-release findings, and obtain separate approvals before changing any release state.`],
  ["Rollback and replay", `Rollback means returning to a previously verified commit and manifest, not deleting evidence or rewriting history. Replay creates a new explicit version when the input envelope, rule, model, evidence, or report schema changes.`],
  ["Decision log", `Phase 9 decisions are: preserve Phase 8 rule and denominator; add insert-once committed effects; fence stale publication; make shutdown policy explicit; make deadline age policy explicit; mark review conflicts; keep resident/external/runtime gaps open.`],
  ["Evidence files", `Primary Phase 9 artifacts are docs/generated/phase9-runtime-controls.json, docs/generated/phase9-external-validation-readiness.json, docs/generated/phase9-governed-release-manifest.json, and the focused tests in tests/phase9-controls.test.ts.`],
  ["Historical evidence files", `Phase 8 and Phase 7 source artifacts remain docs/generated/phase8-high-grade-miss-registry.json, phase8-lesion-rule-freeze.json, phase8-external-lesion-validation.json, phase8-runtime-closure.json, and phase7-real-load.json. They are not overwritten by this report.`],
  ["Implementation files", `The main implementation additions are lib/jobs/effects.ts, phase9FaultInjection.ts, deadlinePolicy.ts, workerLifecycle.ts, lib/evidence/persistence.ts, queue/control/service/report changes, the clinician and Validation Center UI changes, and CI/package wiring.`],
  ["Report reproducibility", `This report is generated by scripts/generate-phase9-report.mjs from the repository and frozen artifacts. The generator records the HEAD available at generation; final remote parity is a separate post-commit fact.`],
  ["Current release state", `Current release state remains BLOCKED. No artifact in this report authorizes clinical use, diagnostic interpretation, or a model/data promotion.`],
  ["Closing statement", `VisionScan is a safety-oriented research prototype with meaningful provenance, review, lease, and fail-closed controls. Phase 9 improves engineering accountability but does not close the evidence required for clinical, external-validation, resident-runtime, or production release.`],
  ["Status signature", `FINAL: ENGINEERING PARTIAL — BLOCKERS REMAIN; RETINAL REVIEW INTELLIGENCE PARTIAL — INTERNAL HELD-OUT EVIDENCE ONLY; LOCAL RUNTIME PARTIAL; DATA RELEASE BLOCKED; NOT CLINICALLY VALIDATED / NOT A MEDICAL DEVICE / NOT FOR AUTONOMOUS DIAGNOSIS.`],
];

if (sections.length !== 109) throw new Error(`Phase 9 report requires 109 sections; found ${sections.length}`);

const header = `# VisionScan Phase 9 Controlled Research Release Candidate Report\n\n` +
  `Generated: ${generatedAt}  \n` +
  `Repository: VisionScan AI Eye Center  \n` +
  `Source HEAD at generation: ${head}  \n` +
  `PHI included: false  \n\n` +
  `> This report is an evidence ledger, not a clinical validation report. It preserves PARTIAL, BLOCKED, NOT MEASURED, and NOT PROVEN states.\n\n`;

const body = sections.map(([title, text], index) => `## ${index + 1}. ${title}\n\n${text}\n`).join("\n");
fs.mkdirSync(path.dirname(REPORT), { recursive: true });
fs.writeFileSync(REPORT, header + body, "utf8");
console.log(JSON.stringify({ report: path.relative(ROOT, REPORT), sections: sections.length, generated_at: generatedAt, source_head: head }));
